import { readFileSync } from "fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const text = readFileSync(".env", "utf8");
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("DATABASE_URL="));
  return line?.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

const databaseUrl = loadDatabaseUrl();
if (databaseUrl) process.env.DATABASE_URL = databaseUrl;
const prisma = databaseUrl ? new PrismaClient({ datasources: { db: { url: databaseUrl } } }) : null;

describe("invoice automation flow", () => {
  const suffix = `phase4-${Date.now()}`;
  let organizationId = "";

  afterAll(async () => {
    if (!prisma || !organizationId) return;
    await prisma.organization.deleteMany({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  it("validates a safe invoice once, asks approval above the threshold, and stays inside the tenant", async () => {
    if (!prisma) return;
    const { installDefaultInvoiceRules, runInvoiceAutomation, decideApproval } = await import("@/services/automation");
    const organization = await prisma.organization.create({ data: { name: `Auto ${suffix}` } });
    organizationId = organization.id;
    const other = await prisma.organization.create({ data: { name: `Auto autre ${suffix}` } });
    const user = await prisma.user.create({
      data: {
        name: "Camille",
        email: `auto.${suffix}@fluxora.test`,
        passwordHash: "hash",
        memberships: { create: { organizationId, role: "OWNER" } },
      },
    });
    await installDefaultInvoiceRules(organizationId, user.id);
    const document = await prisma.document.create({
      data: {
        organizationId,
        filename: "facture-700.pdf",
        mimeType: "application/pdf",
        sizeBytes: 12,
        storageKey: `organizations/${organizationId}/documents/pending/original`,
        confidence: 0.97,
        status: "PROCESSED",
      },
    });
    const safe = await prisma.invoice.create({
      data: {
        organizationId,
        documentId: document.id,
        direction: "SUPPLIER",
        number: `FAC-700-${suffix}`,
        amountHt: "583.33",
        amountVat: "116.67",
        amountTtc: "700.00",
        matchStatus: "MATCH",
      },
    });
    await runInvoiceAutomation(prisma, organizationId, safe.id);
    await runInvoiceAutomation(prisma, organizationId, safe.id);
    const validated = await prisma.invoice.findFirst({ where: { id: safe.id, organizationId } });
    expect(validated?.status).toBe("VALIDATED");
    expect(validated?.autoValidated).toBe(true);
    expect(await prisma.approval.count({ where: { invoiceId: safe.id } })).toBe(0);
    expect(await prisma.workflowExecution.count({ where: { organizationId, documentId: document.id, status: "COMPLETED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { organizationId, title: "Facture validée automatiquement" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { organizationId, entityId: safe.id, action: "invoice.auto_validated" } })).toBe(1);

    const managerInvoice = await prisma.invoice.create({
      data: {
        organizationId,
        direction: "SUPPLIER",
        number: `FAC-2500-${suffix}`,
        amountHt: "2083.33",
        amountVat: "416.67",
        amountTtc: "2500.00",
        matchStatus: "MATCH",
      },
    });
    await runInvoiceAutomation(prisma, organizationId, managerInvoice.id);
    await runInvoiceAutomation(prisma, organizationId, managerInvoice.id);
    const approvals = await prisma.approval.findMany({ where: { organizationId, invoiceId: managerInvoice.id } });
    expect(approvals).toHaveLength(1);
    expect(approvals[0]?.requiredRole).toBe("MANAGER");
    expect(approvals[0]?.status).toBe("PENDING");

    const ownerInvoice = await prisma.invoice.create({
      data: {
        organizationId,
        direction: "SUPPLIER",
        number: `FAC-8000-${suffix}`,
        amountHt: "6666.67",
        amountVat: "1333.33",
        amountTtc: "8000.00",
      },
    });
    await prisma.anomaly.create({
      data: {
        organizationId,
        invoiceId: ownerInvoice.id,
        type: "AMOUNT_MISMATCH",
        severity: "CRITICAL",
        title: "Écart",
        description: "Écart",
        fingerprint: `AMOUNT_MISMATCH:${ownerInvoice.id}`,
      },
    });
    await runInvoiceAutomation(prisma, organizationId, ownerInvoice.id);
    const blocked = await prisma.invoice.findFirst({ where: { id: ownerInvoice.id } });
    expect(blocked?.autoValidated).toBe(false);
    const ownerApproval = await prisma.approval.findFirst({ where: { organizationId, invoiceId: ownerInvoice.id } });
    expect(ownerApproval?.requiredRole).toBe("OWNER");

    await decideApproval({
      organizationId,
      userId: user.id,
      role: "OWNER",
      approvalId: approvals[0].id,
      decision: "APPROVED",
    });
    const decided = await prisma.invoice.findFirst({ where: { id: managerInvoice.id } });
    expect(decided?.status).toBe("VALIDATED");
    expect(await prisma.auditLog.count({ where: { organizationId, action: "approval.approved" } })).toBe(1);

    const rejected = await prisma.approval.create({
      data: {
        organizationId,
        invoiceId: ownerInvoice.id,
        requiredRole: "OWNER",
        reason: "Second avis",
        amountCents: 800000,
        status: "PENDING",
      },
    });
    await expect(decideApproval({
      organizationId,
      userId: user.id,
      role: "MEMBER",
      approvalId: ownerApproval!.id,
      decision: "APPROVED",
    })).rejects.toThrow("Action non autorisée");
    await expect(decideApproval({
      organizationId: other.id,
      userId: user.id,
      role: "OWNER",
      approvalId: ownerApproval!.id,
      decision: "REJECTED",
      comment: "Hors tenant",
    })).rejects.toThrow("Approbation introuvable");
    await decideApproval({
      organizationId,
      userId: user.id,
      role: "OWNER",
      approvalId: rejected.id,
      decision: "REJECTED",
      comment: "Montant contesté",
    });
    const refused = await prisma.invoice.findFirst({ where: { id: ownerInvoice.id } });
    expect(refused?.status).toBe("REJECTED");
    expect(await prisma.notification.count({ where: { organizationId, title: "Approbation refusée" } })).toBe(1);
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
