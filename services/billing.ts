import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import {
  UPGRADE_HINT,
  automationLimitMessage,
  documentLimitMessage,
  invoiceLimitMessage,
  limitFor,
  planCatalog,
  trialDays,
  userLimitMessage,
  type PlanId,
} from "@/lib/plans";
import { recordProductEvent } from "@/services/product-events";

export { planCatalog as PLAN_LIMITS_CATALOG, limitFor, planCatalog };
export const PLAN_LIMITS = new Proxy({} as ReturnType<typeof planCatalog>, {
  get(_target, key) {
    return planCatalog()[key as PlanId];
  },
  ownKeys() {
    return ["STARTER", "PRO", "BUSINESS"];
  },
  getOwnPropertyDescriptor() {
    return { enumerable: true, configurable: true };
  },
});

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export function currentPeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function trialRemainingDays(trialEndsAt: Date | null, now = new Date()) {
  if (!trialEndsAt) return 0;
  return Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000));
}

export async function startTrial(organizationId: string, now = new Date()) {
  const ends = new Date(now.getTime() + trialDays() * 86_400_000);
  return prisma.subscription.upsert({
    where: { organizationId },
    update: {},
    create: {
      organizationId,
      status: "TRIALING",
      plan: "STARTER",
      trialEndsAt: ends,
      currentPeriodStart: now,
      currentPeriodEnd: ends,
    },
  });
}

type QuotaDb = Pick<typeof prisma, "subscription" | "organization" | "document" | "invoice" | "organizationMember" | "automationRule" | "workflowExecution" | "usageRecord">;

export async function assertSubscriptionAllows(organizationId: string, db: Pick<typeof prisma, "subscription"> = prisma) {
  const subscription = await db.subscription.findUnique({ where: { organizationId } });
  if (!subscription) return;
  if (subscription.status === "ACTIVE" || subscription.status === "PAST_DUE") return;
  if (subscription.status === "TRIALING" && subscription.trialEndsAt && subscription.trialEndsAt.getTime() > Date.now()) return;
  throw new PlanLimitError("Votre essai est terminé. Choisissez un plan pour continuer.");
}

export async function assertCanProcessDocuments(
  organizationId: string,
  incomingFiles: number,
  incomingBytes: number,
  db: QuotaDb = prisma,
) {
  await assertSubscriptionAllows(organizationId, db);
  const organization = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const limits = limitFor(organization.plan);
  const usage = await snapshotUsage(organizationId, new Date(), db);
  if (usage.documents + incomingFiles > limits.documentsPerMonth) {
    throw new PlanLimitError(`${documentLimitMessage(limits.documentsPerMonth)} ${UPGRADE_HINT}`);
  }
  if (usage.storageBytes + incomingBytes > limits.storageBytes) {
    throw new PlanLimitError(`Vous avez atteint la limite de stockage de votre plan. ${UPGRADE_HINT}`);
  }
}

export async function lockOrganization(db: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> }, organizationId: string) {
  if (!/^[a-z0-9]+$/i.test(organizationId)) throw new Error("Organisation introuvable.");
  // Read Committed does not serialize the count by itself. This row lock does, until the transaction commits.
  await db.$queryRaw(Prisma.sql`SELECT id FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`);
}

export async function assertCanCreateInvoice(organizationId: string, db: QuotaDb = prisma) {
  await assertSubscriptionAllows(organizationId, db);
  const organization = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const limits = limitFor(organization.plan);
  const invoices = await db.invoice.count({
    where: { organizationId, createdAt: { gte: currentPeriodStart() } },
  });
  if (invoices >= limits.invoicesPerMonth) {
    throw new PlanLimitError(`${invoiceLimitMessage(limits.invoicesPerMonth)} ${UPGRADE_HINT}`);
  }
}

export async function assertCanInvite(organizationId: string, db: QuotaDb = prisma) {
  const organization = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const limits = limitFor(organization.plan);
  const users = await db.organizationMember.count({ where: { organizationId } });
  if (users >= limits.users) throw new PlanLimitError(`${userLimitMessage(limits.users)} ${UPGRADE_HINT}`);
}

export async function assertCanAddAutomation(organizationId: string, incoming = 1, db: QuotaDb = prisma) {
  const organization = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!organization) throw new Error("Organisation introuvable.");
  const limits = limitFor(organization.plan);
  const count = await db.automationRule.count({ where: { organizationId } });
  if (count + incoming > limits.automations) throw new PlanLimitError(`${automationLimitMessage(limits.automations)} ${UPGRADE_HINT}`);
}

export async function snapshotUsage(organizationId: string, now = new Date(), db: QuotaDb = prisma) {
  const periodStart = currentPeriodStart(now);
  const documents = await db.document.count({ where: { organizationId, deletedAt: null, createdAt: { gte: periodStart } } });
  const invoices = await db.invoice.count({ where: { organizationId, createdAt: { gte: periodStart } } });
  const users = await db.organizationMember.count({ where: { organizationId } });
  const storage = await db.document.aggregate({ where: { organizationId, deletedAt: null }, _sum: { sizeBytes: true } });
  const automationRuns = await db.workflowExecution.count({ where: { organizationId, status: "COMPLETED", startedAt: { gte: periodStart } } });
  const storageBytes = storage._sum.sizeBytes ?? 0;
  const record = await db.usageRecord.upsert({
    where: { organizationId_periodStart: { organizationId, periodStart } },
    update: { documents, invoices, users, storageBytes, automationRuns },
    create: { organizationId, periodStart, documents, invoices, users, storageBytes, automationRuns },
  });
  return record;
}

export async function billingOverview(organizationId: string) {
  const [organization, subscription, usage] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId } }),
    prisma.subscription.findUnique({ where: { organizationId } }),
    snapshotUsage(organizationId),
  ]);
  if (!organization) throw new Error("Organisation introuvable.");
  const limits = limitFor(subscription?.status === "ACTIVE" ? subscription.plan : organization.plan);
  return {
    organization,
    subscription,
    usage,
    limits,
    trialDaysLeft: subscription?.status === "TRIALING" ? trialRemainingDays(subscription.trialEndsAt) : null,
    plans: planCatalog(),
  };
}

export async function applySubscriptionUpdate(input: {
  organizationId: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "INCOMPLETE";
  plan?: PlanId;
  periodStart?: Date | null;
  periodEnd?: Date | null;
  cancelAtPeriodEnd?: boolean;
  invoiceUrl?: string | null;
}, db: Pick<typeof prisma, "subscription" | "organization"> = prisma) {
  const existing = await db.subscription.findUnique({ where: { organizationId: input.organizationId } });
  const plan = input.plan ?? existing?.plan ?? "STARTER";
  await db.subscription.upsert({
    where: { organizationId: input.organizationId },
    update: {
      stripeCustomerId: input.stripeCustomerId ?? existing?.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId ?? existing?.stripeSubscriptionId,
      status: input.status,
      plan,
      currentPeriodStart: input.periodStart === undefined ? existing?.currentPeriodStart : input.periodStart,
      currentPeriodEnd: input.periodEnd === undefined ? existing?.currentPeriodEnd : input.periodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? existing?.cancelAtPeriodEnd ?? false,
      latestInvoiceUrl: input.invoiceUrl === undefined ? existing?.latestInvoiceUrl : input.invoiceUrl,
    },
    create: {
      organizationId: input.organizationId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      status: input.status,
      plan,
      currentPeriodStart: input.periodStart,
      currentPeriodEnd: input.periodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd ?? false,
      latestInvoiceUrl: input.invoiceUrl,
    },
  });
  if (input.status === "ACTIVE" || input.status === "PAST_DUE" || input.status === "TRIALING") {
    await db.organization.update({ where: { id: input.organizationId }, data: { plan } });
  }
  if (db !== prisma) {
    return {
      started: input.status === "ACTIVE" && existing?.status !== "ACTIVE",
      converted: input.status === "ACTIVE" && existing?.status === "TRIALING",
    };
  }
  if (input.status === "ACTIVE" && existing?.status !== "ACTIVE") {
    await recordProductEvent({ organizationId: input.organizationId, name: "subscription_started" });
    if (existing?.status === "TRIALING") {
      await recordProductEvent({ organizationId: input.organizationId, name: "trial_converted" });
    }
  }
  return { started: false, converted: false };
}

export function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
