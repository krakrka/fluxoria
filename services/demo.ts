import "server-only";
import { prisma } from "@/server/db";
import { isDemoOrganization } from "@/lib/roi";
import { writeAudit } from "@/server/audit";

export async function organizationIsDemo(organizationId: string) {
  const organization = await prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
  return isDemoOrganization(organization?.settings);
}

export async function assertDemoAllowsDeletion(organizationId: string) {
  if (await organizationIsDemo(organizationId)) {
    throw new Error("Le mode démo empêche cette suppression. Utilisez la réinitialisation de la démonstration.");
  }
}

export async function resetDemoOrganization(input: { organizationId: string; userId: string }) {
  const organization = await prisma.organization.findFirst({ where: { id: input.organizationId } });
  if (!organization || !isDemoOrganization(organization.settings)) throw new Error("Cette organisation n'est pas une démonstration.");
  const supplier = await prisma.supplier.findFirst({ where: { organizationId: input.organizationId }, orderBy: { name: "asc" } });
  const manager = await prisma.organizationMember.findFirst({ where: { organizationId: input.organizationId, role: "MANAGER" } });
  await prisma.$transaction([
    prisma.notification.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.approval.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.anomaly.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.workflowExecution.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.reminder.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.payment.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.invoice.deleteMany({ where: { organizationId: input.organizationId } }),
    prisma.document.deleteMany({ where: { organizationId: input.organizationId } }),
  ]);
  if (!supplier) return;
  const autoInvoice = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      supplierId: supplier.id,
      direction: "SUPPLIER",
      number: "FAC-AUTO-700",
      issuedAt: new Date("2026-09-20"),
      dueAt: new Date("2026-10-20"),
      amountHt: "583.33",
      amountVat: "116.67",
      amountTtc: "700.00",
      status: "VALIDATED",
      autoValidated: true,
      matchStatus: "MATCH",
      reconciled: true,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      action: "invoice.auto_validated",
      entityType: "Invoice",
      entityId: autoInvoice.id,
      newValue: { explanation: ["Règle appliquée : « Factures inférieures à 1 000 € »"], rule: "Factures inférieures à 1 000 €" },
    },
  });
  const managerInvoice = await prisma.invoice.create({
    data: {
      organizationId: input.organizationId,
      supplierId: supplier.id,
      direction: "SUPPLIER",
      number: "FAC-MGR-2500",
      issuedAt: new Date("2026-09-21"),
      dueAt: new Date("2026-10-21"),
      amountHt: "2083.33",
      amountVat: "416.67",
      amountTtc: "2500.00",
      status: "DUE",
      matchStatus: "MATCH",
    },
  });
  await prisma.approval.create({
    data: {
      organizationId: input.organizationId,
      invoiceId: managerInvoice.id,
      assignedToId: manager?.userId,
      requiredRole: "MANAGER",
      reason: "Approbation manager de 1 000 à 5 000 €",
      amountCents: 250000,
      explanation: ["Montant : 2500.00 €", "Niveau demandé : manager"],
    },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "demo.reset",
    entityType: "Organization",
    entityId: input.organizationId,
    newValue: { restored: ["FAC-AUTO-700", "FAC-MGR-2500"] },
  });
}
