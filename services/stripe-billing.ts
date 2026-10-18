import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { existsSync } from "node:fs";
import { Prisma } from "@prisma/client";
import { logger } from "@/lib/logger";
import { publicErrorMessage } from "@/lib/security";
import { prisma } from "@/server/db";
import { applySubscriptionUpdate, isUniqueConflict } from "@/services/billing";
import { sendMail } from "@/services/mail";
import { recordProductEvent } from "@/services/product-events";
import type { PlanId } from "@/lib/plans";
import { publicAppOrigin } from "@/lib/app-origin";

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export function stripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET_KEY ?? "",
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
    prices: {
      STARTER: process.env.STRIPE_PRICE_STARTER ?? "",
      PRO: process.env.STRIPE_PRICE_PRO ?? "",
      BUSINESS: process.env.STRIPE_PRICE_BUSINESS ?? "",
    } as Record<PlanId, string>,
  };
}

export function appOrigin() {
  return publicAppOrigin();
}

export function billingConfigured() {
  const config = stripeConfig();
  return Boolean(config.secretKey && config.webhookSecret && config.prices.STARTER && config.prices.PRO);
}

export function verifyStripeSignature(payload: string, header: string | null, secret: string, now = Date.now()) {
  if (!header || !secret) return false;
  const pieces = header.split(",");
  const timestamp = pieces.find((piece) => piece.startsWith("t="))?.slice(2);
  const signatures = pieces.filter((piece) => piece.startsWith("v1=")).map((piece) => piece.slice(3));
  if (!timestamp || signatures.length === 0) return false;
  const age = Math.abs(now - Number(timestamp) * 1000);
  if (!Number.isFinite(age) || age > 5 * 60 * 1000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  const left = Buffer.from(expected);
  return signatures.some((signature) => {
    const right = Buffer.from(signature);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

const BILLING_CLAIM_MS = 10 * 60 * 1000;
export const NOTICE_LEASE_MS = 2 * 60 * 1000;
export const NOTICE_MAX_ATTEMPTS = 8;
const NOTICE_BACKOFF_MS = [30_000, 120_000, 600_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000, 86_400_000];

export type BillingNoticeResult = "none" | "sent" | "pending" | "not_configured" | "failed" | "busy";

let beforeBillingApply: (() => Promise<void>) | null = null;
let billingNotice: ((organizationId: string) => Promise<"sent" | "skipped" | "failed">) | null = null;

export function setBillingBeforeApplyForTests(fn: (() => Promise<void>) | null) {
  if (process.env.NODE_ENV === "production") return;
  beforeBillingApply = fn;
}

export function setBillingNoticeForTests(fn: ((organizationId: string) => Promise<"sent" | "skipped" | "failed">) | null) {
  if (process.env.NODE_ENV === "production") return;
  billingNotice = fn;
}

function configuredTestSender(): ((organizationId: string) => Promise<"sent" | "skipped" | "failed">) | null {
  if (process.env.NODE_ENV === "production") return null;
  const mode = process.env.BILLING_NOTICE_TEST_MODE;
  if (mode !== "sent" && mode !== "skipped" && mode !== "failed" && mode !== "hold") return null;
  return async () => {
    if (mode === "hold") {
      const gate = process.env.BILLING_NOTICE_HOLD_GATE;
      const started = Date.now();
      while (Date.now() - started < 15_000) {
        if (gate && existsSync(gate)) break;
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
      return "sent";
    }
    return mode;
  };
}

export async function handleStripeEvent(event: StripeEvent) {
  const existing = await prisma.billingEvent.findUnique({ where: { stripeEventId: event.id } });
  if (existing?.appliedAt) {
    const notice = await deliverBillingNotice(existing.id);
    return { duplicate: true, notice };
  }

  let claimId = "";
  let claimCreatedAt = new Date(0);
  if (!existing) {
    try {
      const created = await prisma.billingEvent.create({
        data: { stripeEventId: event.id, type: event.type, organizationId: organizationIdFrom(event) },
      });
      claimId = created.id;
      claimCreatedAt = created.createdAt;
    } catch (error) {
      if (!isUniqueConflict(error)) throw error;
      const raced = await prisma.billingEvent.findUnique({ where: { stripeEventId: event.id } });
      if (raced?.appliedAt) {
        const notice = await deliverBillingNotice(raced.id);
        return { duplicate: true, notice };
      }
      throw new Error("Événement de facturation encore en cours.");
    }
  } else if (Date.now() - existing.createdAt.getTime() < BILLING_CLAIM_MS) {
    throw new Error("Événement de facturation encore en cours.");
  } else {
    const renewedAt = new Date();
    const renewed = await prisma.billingEvent.updateMany({
      where: { id: existing.id, appliedAt: null, createdAt: existing.createdAt },
      data: { createdAt: renewedAt },
    });
    if (renewed.count !== 1) throw new Error("Événement de facturation encore en cours.");
    claimId = existing.id;
    claimCreatedAt = renewedAt;
  }

  let outcome: { notify: boolean; started: boolean; converted: boolean; organizationId: string };
  try {
    if (beforeBillingApply) await beforeBillingApply();
    outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "BillingEvent" WHERE id = ${claimId} FOR UPDATE`);
      const owned = await tx.billingEvent.findFirst({
        where: { id: claimId, appliedAt: null, createdAt: claimCreatedAt },
      });
      if (!owned) throw new Error("Événement de facturation encore en cours.");
      const result = await dispatch(event, tx);
      await tx.billingEvent.update({
        where: { id: claimId },
        data: { appliedAt: new Date() },
      });
      if (result.notify && result.organizationId) {
        await tx.billingNotice.create({
          data: { billingEventId: claimId, organizationId: result.organizationId, status: "PENDING" },
        });
      }
      return result;
    }, { timeout: 20_000 });
  } catch (error) {
    await prisma.billingEvent.deleteMany({ where: { id: claimId, appliedAt: null, createdAt: claimCreatedAt } });
    throw error;
  }
  if (outcome.started) {
    await recordProductEvent({ organizationId: outcome.organizationId, name: "subscription_started" });
    if (outcome.converted) await recordProductEvent({ organizationId: outcome.organizationId, name: "trial_converted" });
  }
  const notice = outcome.notify ? await deliverBillingNotice(claimId) : "none";
  await billingNoticeHealth();
  return { duplicate: false, notice };
}

export async function createCheckoutUrl(input: { organizationId: string; email: string; plan: PlanId; fetchImpl?: FetchImpl }) {
  if (input.plan === "BUSINESS" && !stripeConfig().prices.BUSINESS) {
    throw new Error("Le plan Business est sur devis. La souscription en ligne concerne Starter et Pro.");
  }
  const config = stripeConfig();
  const price = config.prices[input.plan];
  if (!config.secretKey || !config.webhookSecret || !price) throw new Error("Billing non configuré");
  const subscription = await prisma.subscription.findUnique({ where: { organizationId: input.organizationId } });
  let customer = subscription?.stripeCustomerId ?? "";
  if (!customer) {
    const created = await stripeForm(config.secretKey, "/v1/customers", {
      email: input.email,
      "metadata[organizationId]": input.organizationId,
    }, input.fetchImpl);
    customer = String(created.id ?? "");
  }
  const session = await stripeForm(config.secretKey, "/v1/checkout/sessions", {
    mode: "subscription",
    customer,
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${appOrigin()}/billing?checkout=pending`,
    cancel_url: `${appOrigin()}/billing?checkout=cancel`,
    "metadata[organizationId]": input.organizationId,
    "metadata[plan]": input.plan,
    "subscription_data[metadata][organizationId]": input.organizationId,
    "subscription_data[metadata][plan]": input.plan,
  }, input.fetchImpl);
  const url = session.url;
  if (typeof url !== "string" || !url) throw new Error("Stripe n'a pas renvoyé d'adresse de paiement.");
  return url;
}

export async function createPortalUrl(organizationId: string, fetchImpl?: FetchImpl) {
  const config = stripeConfig();
  if (!billingConfigured()) throw new Error("Billing non configuré");
  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!subscription?.stripeCustomerId) throw new Error("Aucun client Stripe. Souscrivez d'abord à un plan.");
  const session = await stripeForm(config.secretKey, "/v1/billing_portal/sessions", {
    customer: subscription.stripeCustomerId,
    return_url: `${appOrigin()}/billing`,
  }, fetchImpl);
  const url = session.url;
  if (typeof url !== "string" || !url) throw new Error("Stripe n'a pas ouvert le portail.");
  return url;
}

export async function requestCancellation(organizationId: string, fetchImpl?: FetchImpl) {
  const config = stripeConfig();
  if (!billingConfigured()) throw new Error("Billing non configuré");
  const subscription = await prisma.subscription.findUnique({ where: { organizationId } });
  if (!subscription?.stripeSubscriptionId) throw new Error("Aucun abonnement Stripe à annuler.");
  await stripeForm(config.secretKey, `/v1/subscriptions/${subscription.stripeSubscriptionId}`, {
    cancel_at_period_end: "true",
  }, fetchImpl);
}

async function dispatch(event: StripeEvent, tx: Prisma.TransactionClient) {
  const empty = { notify: false, started: false, converted: false, organizationId: "" };
  const object = event.data.object;
  if (event.type === "checkout.session.completed") {
    const organizationId = text(object.metadata, "organizationId");
    const plan = asPlan(text(object.metadata, "plan"));
    if (!organizationId || object.payment_status !== "paid" || !plan) return empty;
    const applied = await applySubscriptionUpdate({
      organizationId,
      stripeCustomerId: textValue(object.customer),
      stripeSubscriptionId: textValue(object.subscription),
      status: "ACTIVE",
      plan,
    }, tx);
    return { notify: true, started: applied.started, converted: applied.converted, organizationId };
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const organizationId = text(object.metadata, "organizationId") ?? (await organizationBySubscription(textValue(object.id), tx));
    if (!organizationId) return empty;
    const plan = planFromStripeObject(object);
    const applied = await applySubscriptionUpdate({
      organizationId,
      stripeCustomerId: textValue(object.customer),
      stripeSubscriptionId: textValue(object.id),
      status: event.type === "customer.subscription.deleted" ? "CANCELED" : mapStatus(textValue(object.status)),
      plan: plan ?? undefined,
      periodStart: unixDate(object.current_period_start),
      periodEnd: unixDate(object.current_period_end),
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
    }, tx);
    return { ...empty, started: applied.started, converted: applied.converted, organizationId };
  }
  if (event.type === "invoice.paid") {
    const organizationId = await organizationByCustomer(textValue(object.customer), tx);
    if (!organizationId) return empty;
    const applied = await applySubscriptionUpdate({
      organizationId,
      status: "ACTIVE",
      invoiceUrl: textValue(object.hosted_invoice_url),
    }, tx);
    return { ...empty, started: applied.started, converted: applied.converted, organizationId };
  }
  return empty;
}

export async function deliverBillingNotice(billingEventId: string, now = new Date()): Promise<BillingNoticeResult> {
  const notice = await prisma.billingNotice.findUnique({ where: { billingEventId } });
  if (!notice) return "none";
  if (notice.status === "SENT") return "sent";
  if (notice.status === "FAILED") return "failed";
  if (notice.status === "PROCESSING" && notice.leaseUntil && notice.leaseUntil.getTime() > now.getTime()) return "busy";
  return attemptNotice(notice.id, now);
}

export async function deliverDueBillingNotices(now = new Date()) {
  const due = await prisma.billingNotice.findMany({
    where: {
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      ],
    },
    take: 20,
    select: { id: true },
  });
  for (const notice of due) await attemptNotice(notice.id, now).catch(() => undefined);
  return billingNoticeHealth(now);
}

export async function billingNoticeHealth(now = new Date()) {
  const [pending, processing, expired, failed, oldestPending, oldestFailed] = await Promise.all([
    prisma.billingNotice.count({ where: { status: "PENDING" } }),
    prisma.billingNotice.count({ where: { status: "PROCESSING", leaseUntil: { gt: now } } }),
    prisma.billingNotice.count({ where: { status: "PROCESSING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] } }),
    prisma.billingNotice.count({ where: { status: "FAILED" } }),
    prisma.billingNotice.findFirst({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
    prisma.billingNotice.findFirst({ where: { status: "FAILED" }, orderBy: { updatedAt: "asc" }, select: { updatedAt: true } }),
  ]);
  const ageSeconds = (date: Date | undefined) => (date ? Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000)) : null);
  if (expired > 0 || failed > 0) logger.warn("billing_notice_stuck", { pending, processing, expired, failed });
  return {
    pending,
    processing,
    expired,
    failed,
    oldestPendingAgeSeconds: ageSeconds(oldestPending?.createdAt),
    oldestFailedAgeSeconds: ageSeconds(oldestFailed?.updatedAt),
  };
}

async function attemptNotice(id: string, now: Date): Promise<BillingNoticeResult> {
  const token = randomBytes(16).toString("hex");
  const claimed = await prisma.billingNotice.updateMany({
    where: {
      id,
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "PROCESSING", OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
      ],
    },
    data: {
      status: "PROCESSING",
      leaseToken: token,
      leaseUntil: new Date(now.getTime() + NOTICE_LEASE_MS),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) {
    const current = await prisma.billingNotice.findUnique({ where: { id } });
    if (!current) return "none";
    if (current.status === "SENT") return "sent";
    if (current.status === "FAILED") return "failed";
    if (current.status === "PENDING") return "pending";
    return "busy";
  }
  const row = await prisma.billingNotice.findUnique({ where: { id } });
  if (!row || row.leaseToken !== token) return "busy";
  try {
    const sender = billingNotice ?? configuredTestSender();
    const result = sender
      ? await sender(row.organizationId)
      : await notifyBilling(row.organizationId, row.id);
    if (result === "sent") {
      const marked = await prisma.billingNotice.updateMany({
        where: { id, leaseToken: token, status: "PROCESSING" },
        data: { status: "SENT", sentAt: new Date(), leaseUntil: null, leaseToken: null, lastError: null },
      });
      if (marked.count !== 1) {
        logger.warn("billing_notice_lease_lost", { noticeId: id });
        return "busy";
      }
      return "sent";
    }
    if (result === "skipped") {
      await releaseNotice(id, token, {
        status: "PENDING",
        attempts: { decrement: 1 },
        nextAttemptAt: new Date(now.getTime() + 15 * 60 * 1000),
        lastError: "email_not_configured",
      });
      logger.warn("billing_notice_not_configured", { noticeId: id, organizationId: row.organizationId });
      return "not_configured";
    }
    return failNotice(id, token, row.attempts, now, "provider_rejected");
  } catch (error) {
    return failNotice(id, token, row.attempts, now, publicErrorMessage(error, "provider_unavailable"));
  }
}

async function failNotice(id: string, token: string, attempts: number, now: Date, reason: string): Promise<BillingNoticeResult> {
  const failed = attempts >= NOTICE_MAX_ATTEMPTS;
  const delay = NOTICE_BACKOFF_MS[Math.min(Math.max(attempts, 1), NOTICE_BACKOFF_MS.length) - 1];
  await releaseNotice(id, token, {
    status: failed ? "FAILED" : "PENDING",
    nextAttemptAt: new Date(now.getTime() + delay),
    lastError: reason.slice(0, 200),
  });
  logger.warn("billing_notice_retry", { noticeId: id, attempts, status: failed ? "failed" : "pending" });
  if (failed) return "failed";
  throw new Error("Notification d'abonnement non envoyée.");
}

async function releaseNotice(id: string, token: string, data: Prisma.BillingNoticeUpdateManyMutationInput) {
  await prisma.billingNotice.updateMany({
    where: { id, leaseToken: token, status: "PROCESSING" },
    data: { ...data, leaseToken: null, leaseUntil: null },
  });
}

async function notifyBilling(organizationId: string, noticeId: string): Promise<"sent" | "skipped" | "failed"> {
  if (process.env.EMAIL_DELIVERY_ENABLED !== "true" || !process.env.EMAIL_API_URL || !process.env.EMAIL_API_KEY) return "skipped";
  const owner = await prisma.organizationMember.findFirst({
    where: { organizationId, role: "OWNER" },
    include: { user: { select: { email: true } } },
  });
  if (!owner) return "skipped";
  const sent = await sendMail({
    to: owner.user.email,
    template: "billing",
    subject: "Abonnement Fluxora",
    text: "Votre abonnement est actif.",
    organizationId,
    idempotencyKey: noticeId,
  });
  return sent.delivered ? "sent" : "failed";
}

async function organizationBySubscription(subscriptionId: string | null, tx: Prisma.TransactionClient) {
  if (!subscriptionId) return null;
  const row = await tx.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  return row?.organizationId ?? null;
}

async function organizationByCustomer(customerId: string | null, tx: Prisma.TransactionClient) {
  if (!customerId) return null;
  const row = await tx.subscription.findFirst({ where: { stripeCustomerId: customerId } });
  return row?.organizationId ?? null;
}

function organizationIdFrom(event: StripeEvent) {
  return text(event.data.object.metadata, "organizationId");
}

function text(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asPlan(value: string | null): PlanId | null {
  if (value === "STARTER" || value === "PRO" || value === "BUSINESS") return value;
  return null;
}

export function planFromStripeObject(object: Record<string, unknown>): PlanId | null {
  return planFromPrice(object) ?? asPlan(text(object.metadata, "plan"));
}

function planFromPrice(object: Record<string, unknown>) {
  const items = object.items as { data?: Array<{ price?: { id?: string } }> } | undefined;
  const priceId = items?.data?.[0]?.price?.id;
  if (!priceId) return null;
  const prices = stripeConfig().prices;
  const found = (Object.keys(prices) as PlanId[]).find((plan) => prices[plan] === priceId);
  return found ?? null;
}

function mapStatus(status: string | null): "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE" {
  if (status === "trialing") return "TRIALING";
  if (status === "active") return "ACTIVE";
  if (status === "past_due") return "PAST_DUE";
  if (status === "canceled") return "CANCELED";
  return "INCOMPLETE";
}

function unixDate(value: unknown) {
  return typeof value === "number" ? new Date(value * 1000) : null;
}

async function stripeForm(secret: string, path: string, fields: Record<string, string>, fetchImpl: FetchImpl = fetch) {
  const body = new URLSearchParams(fields);
  const response = await fetchImpl(`https://api.stripe.com${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = (await response.json()) as { url?: string; id?: string };
  if (!response.ok) {
    logger.warn("stripe_request_failed", { status: response.status });
    throw new Error("Stripe a refusé la demande.");
  }
  return payload;
}
