import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { contextHash, executionDedupeKey, sameContextDecision } from "@/lib/automation-idempotency";
import { ruleSchema } from "@/lib/schemas";
import { can } from "@/lib/permissions";
import { evaluateRules } from "@/workflows/engine";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

describe("idempotence keys", () => {
  const base = { "invoice.total": 700, "invoice.matchScore": 100, "invoice.anomalyCount": 0, "invoice.confidence": 50 };

  it("keeps the same key when the business context is unchanged", () => {
    const first = contextHash(base);
    const second = contextHash({ "invoice.confidence": 50, "invoice.total": 700, "invoice.anomalyCount": 0, "invoice.matchScore": 100 });
    expect(first).toBe(second);
    expect(sameContextDecision("SKIPPED")).toBe("skip");
    expect(sameContextDecision("COMPLETED")).toBe("skip");
  });

  it("changes the key when the invoice is corrected and allows a failed retry", () => {
    const before = contextHash(base);
    const after = contextHash({ ...base, "invoice.confidence": 97 });
    expect(before).not.toBe(after);
    expect(executionDedupeKey({ ruleId: "r", trigger: "invoice.created", entityId: "i", actionType: "auto_validate", contextHash: before }))
      .not.toBe(executionDedupeKey({ ruleId: "r", trigger: "invoice.created", entityId: "i", actionType: "auto_validate", contextHash: after }));
    expect(sameContextDecision("FAILED")).toBe("retry");
    expect(sameContextDecision("RUNNING")).toBe("concurrent");
    expect(sameContextDecision(null)).toBe("execute");
  });
});

describe("multiple conditions", () => {
  it("accepts three AND conditions and rejects an empty list", () => {
    const parsed = ruleSchema.safeParse({
      name: "Seuil combiné",
      trigger: "invoice.created",
      conditions: [
        { field: "invoice.total", op: "greater_or_equal", value: "1000" },
        { field: "invoice.matchScore", op: "less_than", value: "95" },
        { field: "invoice.supplier", op: "equals", value: "Aciers Durand" },
      ],
      action: "request_approval",
      actionValue: "MANAGER",
    });
    expect(parsed.success).toBe(true);
    expect(ruleSchema.safeParse({ name: "Vide", trigger: "invoice.created", conditions: [], action: "auto_validate" }).success).toBe(false);
  });

  it("matches only when every condition is true", () => {
    const rule = {
      id: "combined",
      name: "Combinée",
      trigger: "invoice.created",
      conditions: {
        all: [
          { field: "invoice.total", op: "greater_or_equal" as const, value: 1000 },
          { field: "invoice.matchScore", op: "less_than" as const, value: 95 },
          { field: "invoice.supplier", op: "equals" as const, value: "Aciers Durand" },
        ],
      },
      actions: [{ type: "request_approval" as const, role: "MANAGER" as const }],
    };
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 2500, "invoice.matchScore": 80, "invoice.supplier": "Aciers Durand" })).toHaveLength(1);
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 2500, "invoice.matchScore": 98, "invoice.supplier": "Aciers Durand" })).toHaveLength(0);
  });
});

describe("reevaluation and concurrency", () => {
  const suffix = `phase41-${Date.now()}`;
  const organizationIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    if (organizationIds.length) await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { email: { contains: suffix } } });
    await prisma.$disconnect();
  });

  it("replays a skipped invoice after correction, keeps an unchanged skip, and retries a failure once", async () => {
    if (!prisma) return;
    const { runInvoiceAutomation } = await import("@/services/automation");
    const organization = await prisma.organization.create({ data: { name: `Fiable ${suffix}` } });
    organizationIds.push(organization.id);
    const workflow = await prisma.workflow.create({ data: { organizationId: organization.id, name: "Auto", definition: {} } });
    const rule = await prisma.automationRule.create({
      data: {
        organizationId: organization.id,
        workflowId: workflow.id,
        name: "Petites factures",
        trigger: "invoice.created",
        conditions: { all: [{ field: "invoice.total", op: "less_than", value: 1000 }] },
        actions: [{ type: "auto_validate" }],
      },
    });
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        filename: "faible.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        storageKey: "pending",
        confidence: 0.4,
        status: "PROCESSED",
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: organization.id,
        documentId: document.id,
        direction: "SUPPLIER",
        number: `FAC-SKIP-${suffix}`,
        amountHt: "583.33",
        amountVat: "116.67",
        amountTtc: "700.00",
        matchStatus: "MATCH",
      },
    });
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    const skipped = await prisma.workflowExecution.findMany({ where: { organizationId: organization.id, ruleId: rule.id } });
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.status).toBe("SKIPPED");
    expect((await prisma.invoice.findFirst({ where: { id: invoice.id } }))?.autoValidated).toBe(false);

    await prisma.document.update({ where: { id: document.id }, data: { confidence: 0.97 } });
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    const afterCorrection = await prisma.workflowExecution.findMany({ where: { organizationId: organization.id, ruleId: rule.id } });
    expect(afterCorrection).toHaveLength(2);
    expect(afterCorrection.some((row) => row.status === "COMPLETED")).toBe(true);
    expect((await prisma.invoice.findFirst({ where: { id: invoice.id } }))?.status).toBe("VALIDATED");
    const notifications = await prisma.notification.count({ where: { organizationId: organization.id, title: "Facture validée automatiquement" } });
    expect(notifications).toBe(1);
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    expect(await prisma.workflowExecution.count({ where: { organizationId: organization.id, ruleId: rule.id, status: "COMPLETED" } })).toBe(1);

    const completed = afterCorrection.find((row) => row.status === "COMPLETED");
    await prisma.workflowExecution.update({ where: { id: completed!.id }, data: { status: "FAILED", error: "coupure" } });
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "DRAFT", autoValidated: false, reconciled: false } });
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    const retried = await prisma.workflowExecution.findMany({ where: { organizationId: organization.id, dedupeKey: completed!.dedupeKey } });
    expect(retried).toHaveLength(1);
    expect(retried[0]?.status).toBe("COMPLETED");
    expect((await prisma.invoice.findFirst({ where: { id: invoice.id } }))?.autoValidated).toBe(true);
  });

  it("does nothing until a correction makes the rule applicable", async () => {
    if (!prisma) return;
    const { runInvoiceAutomation } = await import("@/services/automation");
    const organization = await prisma.organization.create({ data: { name: `Seuil ${suffix}` } });
    organizationIds.push(organization.id);
    await prisma.automationRule.create({
      data: {
        organizationId: organization.id,
        name: "Sous 1000",
        trigger: "invoice.created",
        conditions: {
          all: [
            { field: "invoice.total", op: "less_than", value: 1000 },
            { field: "invoice.matchScore", op: "greater_or_equal", value: 95 },
          ],
        },
        actions: [{ type: "create_notification", title: "Règle devenue applicable" }],
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: organization.id,
        direction: "SUPPLIER",
        number: `FAC-LATER-${suffix}`,
        amountHt: "1666.67",
        amountVat: "333.33",
        amountTtc: "2000.00",
        matchStatus: "UNMATCHED",
      },
    });
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    expect(await prisma.workflowExecution.count({ where: { organizationId: organization.id } })).toBe(0);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { amountHt: "333.33", amountVat: "66.67", amountTtc: "400.00", matchStatus: "MATCH" } });
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, title: "Règle devenue applicable" } })).toBe(1);
    await runInvoiceAutomation(prisma, organization.id, invoice.id);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, title: "Règle devenue applicable" } })).toBe(1);
  });

  it("lets only one of two concurrent runs create the approval and the notification", async () => {
    if (!prisma) return;
    const { runInvoiceAutomation } = await import("@/services/automation");
    const organization = await prisma.organization.create({ data: { name: `Course ${suffix}` } });
    organizationIds.push(organization.id);
    const manager = await prisma.user.create({
      data: {
        name: "Manager",
        email: `manager.${suffix}@fluxora.test`,
        passwordHash: "hash",
        memberships: { create: { organizationId: organization.id, role: "MANAGER" } },
      },
    });
    await prisma.user.create({
      data: {
        name: "Employé",
        email: `employee.${suffix}@fluxora.test`,
        passwordHash: "hash",
        memberships: { create: { organizationId: organization.id, role: "MEMBER" } },
      },
    });
    await prisma.automationRule.create({
      data: {
        organizationId: organization.id,
        name: "Manager",
        trigger: "invoice.created",
        conditions: { all: [{ field: "invoice.total", op: "greater_or_equal", value: 1000 }] },
        actions: [{ type: "request_approval", role: "MANAGER" }],
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        organizationId: organization.id,
        direction: "SUPPLIER",
        number: `FAC-RACE-${suffix}`,
        amountHt: "2083.33",
        amountVat: "416.67",
        amountTtc: "2500.00",
        matchStatus: "MATCH",
      },
    });
    await Promise.all([
      runInvoiceAutomation(prisma, organization.id, invoice.id),
      runInvoiceAutomation(prisma, organization.id, invoice.id),
    ]);
    const approvals = await prisma.approval.findMany({ where: { organizationId: organization.id, invoiceId: invoice.id } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.requiredRole).toBe("MANAGER");
    expect(approvals[0]?.assignedToId).toBe(manager.id);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, title: "Approbation demandée" } })).toBe(1);
    expect(await prisma.workflowExecution.count({ where: { organizationId: organization.id, status: "COMPLETED" } })).toBe(1);

    const { decideApproval } = await import("@/services/automation");
    const employee = await prisma.organizationMember.findFirst({ where: { organizationId: organization.id, role: "MEMBER" } });
    await expect(decideApproval({
      organizationId: organization.id,
      userId: employee!.userId,
      role: "MEMBER",
      approvalId: approvals[0].id,
      decision: "APPROVED",
    })).rejects.toThrow("Action non autorisée");
    expect(can("MANAGER", "org.update")).toBe(false);
    expect(can("MANAGER", "members.manage")).toBe(false);
    expect(can("MANAGER", "billing.manage")).toBe(false);
    await decideApproval({
      organizationId: organization.id,
      userId: manager.id,
      role: "MANAGER",
      approvalId: approvals[0].id,
      decision: "REJECTED",
      comment: "Pièce manquante",
    });
    expect((await prisma.invoice.findFirst({ where: { id: invoice.id } }))?.status).toBe("REJECTED");
    expect(await prisma.auditLog.count({ where: { organizationId: organization.id, action: "approval.rejected" } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId: organization.id, title: "Approbation refusée" } })).toBe(1);
  });
});
