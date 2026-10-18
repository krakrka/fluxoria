import "server-only";
import { estimateSavingsCents } from "@/lib/money";
import { prisma } from "@/server/db";

export async function getDashboard(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const visible = { organizationId, deletedAt: null };

  const [documents, needsReview, errors, todayCount, executions, recent, overdueAmount, invoicesToProcess, invoicesWithoutOrder, criticalAnomalies, monthInvoiced, openAnomalyInvoices, pendingApprovals, autoValidatedInvoices, lowConfidenceDocuments, todayApprovals, todayAnomalies, todayUnmatched, todayLowConfidence] = await Promise.all([
    prisma.document.groupBy({
      by: ["status"],
      where: visible,
      _count: { _all: true },
    }),
    prisma.document.count({ where: { ...visible, status: "NEEDS_REVIEW" } }),
    prisma.document.count({ where: { ...visible, status: "ERROR" } }),
    prisma.document.count({ where: { ...visible, createdAt: { gte: today } } }),
    prisma.workflowExecution.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { user: { select: { name: true } } },
    }),
    prisma.invoice.aggregate({
      where: { organizationId, direction: "CUSTOMER", status: "OVERDUE" },
      _sum: { amountTtc: true },
    }),
    prisma.invoice.count({ where: { organizationId, direction: "SUPPLIER", status: { notIn: ["PAID", "VALIDATED", "REJECTED"] } } }),
    prisma.invoice.count({ where: { organizationId, direction: "SUPPLIER", matchedPurchaseOrderId: null } }),
    prisma.anomaly.count({ where: { organizationId, status: "OPEN", severity: "CRITICAL" } }),
    prisma.invoice.aggregate({
      where: { organizationId, direction: "SUPPLIER", issuedAt: { gte: monthStart } },
      _sum: { amountTtc: true },
    }),
    prisma.anomaly.findMany({
      where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, invoiceId: { not: null } },
      select: { invoiceId: true },
      distinct: ["invoiceId"],
    }),
    prisma.approval.count({ where: { organizationId, status: "PENDING" } }),
    prisma.invoice.count({ where: { organizationId, autoValidated: true } }),
    prisma.document.count({ where: { ...visible, confidence: { lt: 0.7, not: null } } }),
    prisma.approval.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 4,
      include: { invoice: { select: { number: true } } },
    }),
    prisma.anomaly.findMany({
      where: { organizationId, status: "OPEN", severity: "CRITICAL" },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, title: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, direction: "SUPPLIER", matchedPurchaseOrderId: null, status: { notIn: ["PAID", "VALIDATED", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, number: true },
    }),
    prisma.document.findMany({
      where: { ...visible, confidence: { lt: 0.7, not: null } },
      orderBy: { createdAt: "desc" },
      take: 4,
      select: { id: true, filename: true },
    }),
  ]);
  const anomalyInvoiceIds = openAnomalyInvoices.flatMap((row) => (row.invoiceId ? [row.invoiceId] : []));
  const anomalyAmount = anomalyInvoiceIds.length
    ? await prisma.invoice.aggregate({ where: { organizationId, id: { in: anomalyInvoiceIds } }, _sum: { amountTtc: true } })
    : null;

  const count = (status: string) => documents.find((row) => row.status === status)?._count._all ?? 0;
  const received = documents.reduce((sum, row) => sum + row._count._all, 0);
  const processed = count("PROCESSED") + count("VALIDATED");
  const finished = processed + needsReview + errors + count("REJECTED");
  const automationRate = finished === 0 ? null : count("PROCESSED") / finished;
  const organization = await prisma.organization.findFirst({ where: { id: organizationId } });
  const settings = (organization?.settings ?? {}) as { minutesPerDocument?: number; hourlyCostCents?: number };

  return {
    received,
    processed,
    validated: count("VALIDATED"),
    needsReview,
    errors,
    todayCount,
    automationRate,
    automations: executions,
    estimatedSavingsCents: estimateSavingsCents(
      processed,
      settings.minutesPerDocument ?? 12,
      settings.hourlyCostCents ?? 3500,
    ),
    overdueAmount: overdueAmount._sum.amountTtc?.toString() ?? "0",
    invoicesToProcess,
    invoicesWithoutOrder,
    invoicesWithAnomaly: anomalyInvoiceIds.length,
    criticalAnomalies,
    monthInvoiced: monthInvoiced._sum.amountTtc?.toString() ?? "0",
    anomalyAmount: anomalyAmount?._sum.amountTtc?.toString() ?? "0",
    recent,
    monthStart,
    pendingApprovals,
    autoValidatedInvoices,
    lowConfidenceDocuments,
    needsIntervention: invoicesToProcess,
    todayApprovals,
    todayAnomalies,
    todayUnmatched,
    todayLowConfidence,
  };
}
