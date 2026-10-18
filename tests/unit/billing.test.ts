import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/security";
import { documentLimitMessage, planCatalog } from "@/lib/plans";
import { can } from "@/lib/permissions";

function loadEnv() {
  if (process.env.DATABASE_URL && process.env.AUTH_SECRET) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnv();

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;
const suffix = `bill-${Date.now()}`;

function sign(payload: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

describe("commercial billing", () => {
  const organizationIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it("reads configurable prices and blocks a member from billing", () => {
    delete process.env.PLAN_STARTER_PRICE_CENTS;
    delete process.env.PLAN_PRO_PRICE_CENTS;
    delete process.env.PLAN_BUSINESS_PRICE_CENTS;
    const plans = planCatalog();
    expect(plans.STARTER.price).toBe("99 € / mois");
    expect(plans.PRO.price).toBe("299 € / mois");
    expect(plans.BUSINESS.price).toBe("Sur devis");
    expect(documentLimitMessage(plans.STARTER.documentsPerMonth)).toBe("Vous avez atteint votre limite de 100 documents ce mois-ci.");
    expect(can("MEMBER", "billing.manage")).toBe(false);
    expect(can("OWNER", "billing.manage")).toBe(true);
    expect(() => assertSameOrigin(new Request("http://localhost/api/documents", { headers: { origin: "https://evil.test", host: "localhost" } }))).toThrow(/Origine/);
  });

  it("signs up with a trial, verifies the email, and invites without storing a password", async () => {
    if (!prisma) return;
    const { registerOrganization, verifyEmail, inviteMember, createEmailVerification } = await import("@/services/organization");
    const email = `owner.${suffix}@fluxora.test`;
    const organization = await registerOrganization({
      name: "Olivia",
      email,
      password: "Fluxora-Demo-2026",
      organizationName: `Cabinet ${suffix}`,
    });
    organizationIds.push(organization.id);
    const subscription = await prisma.subscription.findUnique({ where: { organizationId: organization.id } });
    expect(subscription?.status).toBe("TRIALING");
    expect(subscription?.trialEndsAt && subscription.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
    const mails = await prisma.mailDelivery.findMany({ where: { organizationId: organization.id } });
    expect(mails.map((mail) => mail.template).sort()).toEqual(["onboarding", "verification"]);
    expect(mails.every((mail) => !mail.subject.includes("token"))).toBe(true);
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.emailVerifiedAt).toBeNull();
    const token = await createEmailVerification(user!.id);
    await verifyEmail(token);
    const verified = await prisma.user.findUnique({ where: { email } });
    expect(verified?.emailVerifiedAt).not.toBeNull();

    await inviteMember({
      organizationId: organization.id,
      actorId: user!.id,
      actorRole: "OWNER",
      name: "Nora",
      email: `member.${suffix}@fluxora.test`,
      password: "temporary-secret",
      role: "MEMBER",
    });
    const invitation = await prisma.mailDelivery.findFirst({
      where: { toAddress: `member.${suffix}@fluxora.test`, template: "invitation" },
    });
    expect(invitation?.template).toBe("invitation");
    expect(JSON.stringify(invitation)).not.toContain("temporary-secret");
  });

  it("activates a plan only from the webhook and ignores a repeated event", async () => {
    if (!prisma) return;
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const { verifyStripeSignature } = await import("@/services/stripe-billing");
    const organization = await prisma.organization.create({ data: { name: `Pay ${suffix}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    await prisma.subscription.create({
      data: { organizationId: organization.id, status: "TRIALING", plan: "STARTER", trialEndsAt: new Date(Date.now() + 86_400_000) },
    });
    const secret = "whsec_phase8";
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    const event = {
      id: `evt_${suffix}`,
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          customer: `cus_${suffix}`,
          subscription: `sub_${suffix}`,
          metadata: { organizationId: organization.id, plan: "PRO" },
        },
      },
    };
    const payload = JSON.stringify(event);
    expect(verifyStripeSignature(payload, "t=1,v1=nope", secret)).toBe(false);
    const header = sign(payload, secret);
    const call = () =>
      POST(new Request("http://localhost/api/stripe/webhook", {
        method: "POST",
        headers: { "stripe-signature": header, "content-type": "application/json" },
        body: payload,
      }));
    const first = await call();
    const second = await call();
    expect(first.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
    const saved = await prisma.organization.findUnique({ where: { id: organization.id }, include: { subscription: true } });
    expect(saved?.plan).toBe("PRO");
    expect(saved?.subscription?.status).toBe("ACTIVE");
    expect(await prisma.billingEvent.count({ where: { stripeEventId: event.id } })).toBe(1);
    const untouched = await prisma.subscription.findUnique({ where: { organizationId: organization.id } });
    expect(untouched?.status).toBe("ACTIVE");
  });

  it("stops new documents when the trial is over and keeps usage inside the tenant", async () => {
    if (!prisma) return;
    const { assertCanProcessDocuments, snapshotUsage } = await import("@/services/billing");
    const organization = await prisma.organization.create({ data: { name: `Trial ${suffix}` } });
    const other = await prisma.organization.create({ data: { name: `Other ${suffix}` } });
    organizationIds.push(organization.id, other.id);
    await prisma.subscription.create({
      data: { organizationId: organization.id, status: "TRIALING", plan: "STARTER", trialEndsAt: new Date(Date.now() - 86_400_000) },
    });
    await expect(assertCanProcessDocuments(organization.id, 1, 10)).rejects.toThrow(/essai est terminé/);
    await prisma.document.create({
      data: { organizationId: other.id, filename: "a.pdf", mimeType: "application/pdf", sizeBytes: 10, storageKey: `organizations/${other.id}/a` },
    });
    const usage = await snapshotUsage(organization.id);
    const otherUsage = await snapshotUsage(other.id);
    expect(usage.documents).toBe(0);
    expect(otherUsage.documents).toBe(1);
    expect(otherUsage.organizationId).toBe(other.id);
  });

  it("anonymizes an account and closes an organization without deleting the audit", async () => {
    if (!prisma) return;
    const { deleteAccount, deleteOrganization } = await import("@/services/organization");
    const organization = await prisma.organization.create({ data: { name: `Close ${suffix}` } });
    organizationIds.push(organization.id);
    const owner = await prisma.user.create({
      data: { name: "Owner", email: `close.${suffix}@fluxora.test`, passwordHash: "hash", activeOrganizationId: organization.id },
    });
    const member = await prisma.user.create({
      data: { name: "Member", email: `gone.${suffix}@fluxora.test`, passwordHash: "hash", activeOrganizationId: organization.id },
    });
    await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: owner.id, role: "OWNER" } });
    await prisma.organizationMember.create({ data: { organizationId: organization.id, userId: member.id, role: "MEMBER" } });
    const audit = await prisma.auditLog.create({
      data: { organizationId: organization.id, userId: member.id, action: "member.invited", entityType: "User", entityId: member.id },
    });
    await deleteAccount(member.id);
    const tombstone = await prisma.user.findUnique({ where: { id: member.id } });
    expect(tombstone?.email).toContain("invalid.fluxora");
    expect(tombstone?.name).toBe("Compte supprimé");
    expect(await prisma.auditLog.findUnique({ where: { id: audit.id } })).toMatchObject({ action: "member.invited" });
    await expect(deleteAccount(owner.id)).rejects.toThrow(/organisations/);
    await deleteOrganization(organization.id);
    const closed = await prisma.organization.findUnique({ where: { id: organization.id } });
    expect(closed?.deletedAt).toBeTruthy();
    expect(await prisma.auditLog.findUnique({ where: { id: audit.id } })).toBeTruthy();
    expect(await prisma.organizationMember.count({ where: { organizationId: organization.id } })).toBe(0);
  });

  it("retries a billing event after a failed apply and trusts the price over stale metadata", async () => {
    if (!prisma) return;
    const { handleStripeEvent, planFromStripeObject } = await import("@/services/stripe-billing");
    const previousPrice = process.env.STRIPE_PRICE_STARTER;
    process.env.STRIPE_PRICE_STARTER = "price_starter_phase26";
    try {
      expect(planFromStripeObject({
        metadata: { plan: "PRO" },
        items: { data: [{ price: { id: "price_starter_phase26" } }] },
      })).toBe("STARTER");
      const organizationForFailure = await prisma.organization.create({ data: { name: `Fail ${suffix}`, plan: "STARTER" } });
      organizationIds.push(organizationForFailure.id);
      const missing = `evt_missing_${suffix}`;
      const broken = {
        id: missing,
        type: "customer.subscription.updated",
        data: {
          object: {
            id: `sub_bad_${suffix}`,
            status: "active",
            metadata: { organizationId: organizationForFailure.id, plan: "PRO" },
            current_period_start: Number.NaN,
          },
        },
      };
      await expect(handleStripeEvent(broken)).rejects.toBeTruthy();
      expect(await prisma.billingEvent.count({ where: { stripeEventId: missing } })).toBe(0);
      await expect(handleStripeEvent(broken)).rejects.toBeTruthy();

      const organization = await prisma.organization.create({ data: { name: `Plan ${suffix}`, plan: "PRO" } });
      organizationIds.push(organization.id);
      await prisma.subscription.create({
        data: { organizationId: organization.id, status: "ACTIVE", plan: "PRO", stripeSubscriptionId: `sub_plan_${suffix}` },
      });
      await handleStripeEvent({
        id: `evt_plan_${suffix}`,
        type: "customer.subscription.updated",
        data: {
          object: {
            id: `sub_plan_${suffix}`,
            customer: `cus_plan_${suffix}`,
            status: "active",
            metadata: { organizationId: organization.id, plan: "PRO" },
            items: { data: [{ price: { id: "price_starter_phase26" } }] },
          },
        },
      });
      const saved = await prisma.organization.findUnique({ where: { id: organization.id } });
      expect(saved?.plan).toBe("STARTER");

      const raced = await Promise.allSettled([
        handleStripeEvent({
          id: `evt_race_${suffix}`,
          type: "checkout.session.completed",
          data: {
            object: {
              payment_status: "paid",
              customer: `cus_race_${suffix}`,
              subscription: `sub_race_${suffix}`,
              metadata: { organizationId: organization.id, plan: "PRO" },
            },
          },
        }),
        handleStripeEvent({
          id: `evt_race_${suffix}`,
          type: "checkout.session.completed",
          data: {
            object: {
              payment_status: "paid",
              customer: `cus_race_${suffix}`,
              subscription: `sub_race_${suffix}`,
              metadata: { organizationId: organization.id, plan: "PRO" },
            },
          },
        }),
      ]);
      expect(raced.some((result) => result.status === "fulfilled")).toBe(true);
      expect(await prisma.billingEvent.count({ where: { stripeEventId: `evt_race_${suffix}`, appliedAt: { not: null } } })).toBe(1);

      const leased = await prisma.organization.create({ data: { name: `Lease ${suffix}`, plan: "PRO" } });
      organizationIds.push(leased.id);
      const leaseId = `evt_lease_${suffix}`;
      await prisma.billingEvent.create({
        data: {
          stripeEventId: leaseId,
          type: "customer.subscription.updated",
          organizationId: leased.id,
          createdAt: new Date(Date.now() - 11 * 60 * 1000),
        },
      });
      const leaseEvent = {
        id: leaseId,
        type: "customer.subscription.updated",
        data: {
          object: {
            id: `sub_lease_${suffix}`,
            status: "active",
            metadata: { organizationId: leased.id, plan: "STARTER" },
          },
        },
      };
      await handleStripeEvent(leaseEvent);
      expect((await prisma.organization.findUnique({ where: { id: leased.id } }))?.plan).toBe("STARTER");
      expect((await handleStripeEvent(leaseEvent)).duplicate).toBe(true);

      const fenced = await prisma.organization.create({ data: { name: `Fence ${suffix}`, plan: "BUSINESS" } });
      organizationIds.push(fenced.id);
      await prisma.subscription.create({
        data: { organizationId: fenced.id, status: "ACTIVE", plan: "BUSINESS" },
      });
      const fenceId = `evt_fence_${suffix}`;
      await prisma.billingEvent.create({
        data: {
          stripeEventId: fenceId,
          type: "customer.subscription.updated",
          organizationId: fenced.id,
          createdAt: new Date(Date.now() - 11 * 60 * 1000),
        },
      });
      const { setBillingBeforeApplyForTests } = await import("@/services/stripe-billing");
      setBillingBeforeApplyForTests(async () => {
        await prisma.billingEvent.updateMany({
          where: { stripeEventId: fenceId },
          data: { createdAt: new Date(), appliedAt: new Date() },
        });
      });
      try {
        await expect(handleStripeEvent({
          id: fenceId,
          type: "customer.subscription.updated",
          data: {
            object: {
              id: `sub_fence_${suffix}`,
              status: "active",
              metadata: { organizationId: fenced.id, plan: "STARTER" },
            },
          },
        })).rejects.toThrow(/en cours/);
      } finally {
        setBillingBeforeApplyForTests(null);
      }
      expect((await prisma.organization.findUnique({ where: { id: fenced.id } }))?.plan).toBe("BUSINESS");
      expect(await prisma.billingEvent.count({ where: { stripeEventId: fenceId, appliedAt: { not: null } } })).toBe(1);
    } finally {
      if (previousPrice === undefined) delete process.env.STRIPE_PRICE_STARTER;
      else process.env.STRIPE_PRICE_STARTER = previousPrice;
    }
  });

  it("limits invoice creation without using that quota to block a document upload", async () => {
    if (!prisma) return;
    const { assertCanCreateInvoice, assertCanProcessDocuments } = await import("@/services/billing");
    const { importExternalInvoice } = await import("@/services/invoices");
    const previous = process.env.PLAN_STARTER_INVOICES;
    process.env.PLAN_STARTER_INVOICES = "1";
    const organization = await prisma.organization.create({ data: { name: `Inv ${suffix}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    const user = await prisma.user.create({
      data: { name: "Quota", email: `quota.${suffix}@fluxora.test`, passwordHash: "hash" },
    });
    try {
      await importExternalInvoice({
        organizationId: organization.id,
        userId: user.id,
        externalId: "ext-1",
        provider: "TEST",
        number: "Q-1",
        supplierName: "Atelier Quota",
        amountTtc: "10.00",
        currency: "EUR",
      });
      await expect(assertCanProcessDocuments(organization.id, 1, 10)).resolves.toBeUndefined();
      await expect(assertCanCreateInvoice(organization.id)).rejects.toThrow(/factures/);
      const raceOrg = await prisma.organization.create({ data: { name: `Race ${suffix}`, plan: "STARTER" } });
      organizationIds.push(raceOrg.id);
      const raced = await Promise.allSettled([
        importExternalInvoice({
          organizationId: raceOrg.id,
          userId: user.id,
          externalId: "ext-2",
          provider: "TEST",
          number: "Q-2",
          supplierName: "Atelier Quota",
          amountTtc: "11.00",
          currency: "EUR",
        }),
        importExternalInvoice({
          organizationId: raceOrg.id,
          userId: user.id,
          externalId: "ext-3",
          provider: "TEST",
          number: "Q-3",
          supplierName: "Atelier Quota",
          amountTtc: "12.00",
          currency: "EUR",
        }),
      ]);
      expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.invoice.count({ where: { organizationId: raceOrg.id } })).toBe(1);

      const sameOrg = await prisma.organization.create({ data: { name: `Same ${suffix}`, plan: "STARTER" } });
      organizationIds.push(sameOrg.id);
      process.env.PLAN_STARTER_INVOICES = "10";
      const duplicated = await Promise.allSettled([
        importExternalInvoice({
          organizationId: sameOrg.id,
          userId: user.id,
          externalId: "ext-4",
          provider: "TEST",
          number: "Q-SAME",
          supplierName: "Atelier Quota",
          amountTtc: "13.00",
          currency: "EUR",
        }),
        importExternalInvoice({
          organizationId: sameOrg.id,
          userId: user.id,
          externalId: "ext-5",
          provider: "TEST",
          number: "Q-SAME",
          supplierName: "Atelier Quota",
          amountTtc: "13.00",
          currency: "EUR",
        }),
      ]);
      expect(duplicated.every((result) => result.status === "fulfilled")).toBe(true);
      expect(await prisma.invoice.count({ where: { organizationId: sameOrg.id, number: "Q-SAME" } })).toBe(1);

      process.env.PLAN_STARTER_INVOICES = "1";
      const otherOrg = await prisma.organization.create({ data: { name: `Other ${suffix}`, plan: "STARTER" } });
      organizationIds.push(otherOrg.id);
      const separated = await Promise.allSettled([
        importExternalInvoice({
          organizationId: raceOrg.id,
          userId: user.id,
          externalId: "ext-6",
          provider: "TEST",
          number: "Q-A",
          supplierName: "Atelier Quota",
          amountTtc: "14.00",
          currency: "EUR",
        }),
        importExternalInvoice({
          organizationId: otherOrg.id,
          userId: user.id,
          externalId: "ext-7",
          provider: "TEST",
          number: "Q-B",
          supplierName: "Atelier Quota",
          amountTtc: "15.00",
          currency: "EUR",
        }),
      ]);
      expect(separated.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.invoice.count({ where: { organizationId: otherOrg.id } })).toBe(1);
      expect(await prisma.invoice.count({ where: { organizationId: raceOrg.id } })).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.PLAN_STARTER_INVOICES;
      else process.env.PLAN_STARTER_INVOICES = previous;
    }
  });

  it("keeps a billing notice pending until a later attempt, then sends it once", async () => {
    if (!prisma) return;
    const { handleStripeEvent, setBillingNoticeForTests, deliverBillingNotice, NOTICE_MAX_ATTEMPTS } = await import("@/services/stripe-billing");
    const organization = await prisma.organization.create({ data: { name: `Notice ${suffix}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    let calls = 0;
    setBillingNoticeForTests(async () => {
      calls += 1;
      if (calls === 1) throw new Error("smtp down");
      return "sent";
    });
    const event = {
      id: `evt_notice_${suffix}`,
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          customer: `cus_notice_${suffix}`,
          subscription: `sub_notice_${suffix}`,
          metadata: { organizationId: organization.id, plan: "PRO" },
        },
      },
    };
    try {
      await expect(handleStripeEvent(event)).rejects.toThrow(/Notification/);
      expect((await prisma.organization.findUnique({ where: { id: organization.id } }))?.plan).toBe("PRO");
      const parked = await prisma.billingNotice.findFirst({ where: { organizationId: organization.id } });
      expect(parked?.status).toBe("PENDING");
      expect(parked?.attempts).toBe(1);
      expect(parked?.lastError).toBe("smtp down");
      const tooSoon = await handleStripeEvent(event);
      expect(tooSoon.duplicate).toBe(true);
      expect(tooSoon.notice).toBe("pending");
      expect(calls).toBe(1);
      const dueAt = new Date((parked?.nextAttemptAt?.getTime() ?? 0) + 1);
      expect(await deliverBillingNotice(parked?.billingEventId ?? "", dueAt)).toBe("sent");
      expect(calls).toBe(2);
      expect(await prisma.subscription.count({ where: { organizationId: organization.id } })).toBe(1);
      calls = 0;
      const noticeId = (await prisma.billingEvent.findUnique({ where: { stripeEventId: event.id } }))?.id ?? "";
      await prisma.billingNotice.updateMany({
        where: { organizationId: organization.id },
        data: { status: "PROCESSING", leaseUntil: new Date(Date.now() - 60_000), leaseToken: null, sentAt: null, attempts: 1 },
      });
      setBillingNoticeForTests(async () => {
        calls += 1;
        return "sent";
      });
      await Promise.all([deliverBillingNotice(noticeId), deliverBillingNotice(noticeId)]);
      expect(calls).toBe(1);
      expect((await prisma.billingNotice.findFirst({ where: { organizationId: organization.id } }))?.status).toBe("SENT");

      const exhausted = await prisma.organization.create({ data: { name: `Notice fail ${suffix}`, plan: "STARTER" } });
      organizationIds.push(exhausted.id);
      const failEvent = {
        id: `evt_fail_${suffix}`,
        type: "checkout.session.completed",
        data: {
          object: {
            payment_status: "paid",
            metadata: { organizationId: exhausted.id, plan: "PRO" },
          },
        },
      };
      setBillingNoticeForTests(async () => "failed");
      await expect(handleStripeEvent(failEvent)).rejects.toThrow(/Notification/);
      const failNoticeId = (await prisma.billingEvent.findUnique({ where: { stripeEventId: failEvent.id } }))?.id ?? "";
      for (let attempt = 0; attempt < NOTICE_MAX_ATTEMPTS; attempt += 1) {
        const current = await prisma.billingNotice.findFirst({ where: { organizationId: exhausted.id } });
        if (!current || current.status === "FAILED") break;
        try {
          await deliverBillingNotice(failNoticeId, new Date(current.nextAttemptAt.getTime() + 1));
        } catch {
          // Une tentative refusée laisse la ligne en attente.
        }
      }
      const failed = await prisma.billingNotice.findFirst({ where: { organizationId: exhausted.id } });
      expect(failed?.status).toBe("FAILED");
      expect(failed?.attempts).toBe(NOTICE_MAX_ATTEMPTS);
      expect(await deliverBillingNotice(failNoticeId)).toBe("failed");
    } finally {
      setBillingNoticeForTests(null);
    }
  });

  it("does not mark a billing notice sent when email is not configured", async () => {
    if (!prisma) return;
    const { handleStripeEvent, setBillingNoticeForTests } = await import("@/services/stripe-billing");
    const organization = await prisma.organization.create({ data: { name: `Notice off ${suffix}`, plan: "STARTER" } });
    organizationIds.push(organization.id);
    setBillingNoticeForTests(null);
    const result = await handleStripeEvent({
      id: `evt_off_${suffix}`,
      type: "checkout.session.completed",
      data: {
        object: {
          payment_status: "paid",
          metadata: { organizationId: organization.id, plan: "PRO" },
        },
      },
    });
    expect(result.notice).toBe("not_configured");
    const notice = await prisma.billingNotice.findFirst({ where: { organizationId: organization.id } });
    expect(notice?.status).toBe("PENDING");
    expect(notice?.sentAt).toBeNull();
    expect(notice?.lastError).toBe("email_not_configured");
  });

  it("serializes invites and automations with the organization lock", async () => {
    if (!prisma) return;
    const { inviteMember, createRule } = await import("@/services/organization");
    const { installDefaultInvoiceRules } = await import("@/services/automation");
    const previousUsers = process.env.PLAN_STARTER_USERS;
    const previousRules = process.env.PLAN_STARTER_AUTOMATIONS;
    process.env.PLAN_STARTER_USERS = "1";
    process.env.PLAN_STARTER_AUTOMATIONS = "1";
    const organization = await prisma.organization.create({ data: { name: `Seat ${suffix}`, plan: "STARTER" } });
    const other = await prisma.organization.create({ data: { name: `Seat other ${suffix}`, plan: "STARTER" } });
    organizationIds.push(organization.id, other.id);
    const actor = await prisma.user.create({
      data: { name: "Actor", email: `actor.${suffix}@fluxora.test`, passwordHash: "hash" },
    });
    try {
      const invited = await Promise.allSettled([
        inviteMember({
          organizationId: organization.id,
          actorId: actor.id,
          actorRole: "OWNER",
          name: "Un",
          email: `one.${suffix}@fluxora.test`,
          password: "MotDePasse-Test-1",
          role: "MEMBER",
        }),
        inviteMember({
          organizationId: organization.id,
          actorId: actor.id,
          actorRole: "OWNER",
          name: "Deux",
          email: `two.${suffix}@fluxora.test`,
          password: "MotDePasse-Test-1",
          role: "MEMBER",
        }),
      ]);
      expect(invited.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.organizationMember.count({ where: { organizationId: organization.id } })).toBe(1);
      await inviteMember({
        organizationId: other.id,
        actorId: actor.id,
        actorRole: "OWNER",
        name: "Trois",
        email: `three.${suffix}@fluxora.test`,
        password: "MotDePasse-Test-1",
        role: "MEMBER",
      });
      expect(await prisma.organizationMember.count({ where: { organizationId: other.id } })).toBe(1);

      await expect(installDefaultInvoiceRules(organization.id, actor.id)).rejects.toThrow(/automatisation/i);
      expect(await prisma.automationRule.count({ where: { organizationId: organization.id } })).toBe(0);
      const raced = await Promise.allSettled([
        createRule({
          organizationId: organization.id,
          userId: actor.id,
          name: "Règle A",
          trigger: "invoice.created",
          conditions: [{ field: "invoice.total", op: "greater_than", value: "10" }],
          action: "create_notification",
        }),
        createRule({
          organizationId: organization.id,
          userId: actor.id,
          name: "Règle B",
          trigger: "invoice.created",
          conditions: [{ field: "invoice.total", op: "greater_than", value: "20" }],
          action: "create_notification",
        }),
      ]);
      expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.automationRule.count({ where: { organizationId: organization.id } })).toBe(1);
    } finally {
      if (previousUsers === undefined) delete process.env.PLAN_STARTER_USERS;
      else process.env.PLAN_STARTER_USERS = previousUsers;
      if (previousRules === undefined) delete process.env.PLAN_STARTER_AUTOMATIONS;
      else process.env.PLAN_STARTER_AUTOMATIONS = previousRules;
    }
  }, 20_000);
});
