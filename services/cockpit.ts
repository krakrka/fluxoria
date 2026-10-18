import "server-only";
import { prisma } from "@/server/db";
import { estimateOperationalRoi, readRoiSettings } from "@/lib/roi";

export type AttentionItem = {
  id: string;
  type: "approval" | "anomaly" | "invoice" | "document";
  priority: number;
  title: string;
  detail: string;
  href: string;
  supplier: string;
  status: string;
  amountCents: number | null;
  createdAt: string;
};

const ACTIVITY_LABEL: Record<string, string> = {
  "document.uploaded": "Document reçu",
  "document.processed": "Document traité",
  "document.validated": "Document validé",
  "document.rejected": "Document rejeté",
  "invoice.auto_validated": "Validation automatique",
  "invoice.validated": "Facture validée",
  "approval.requested": "Approbation demandée",
  "approval.approved": "Approbation accordée",
  "approval.rejected": "Approbation rejetée",
  "anomaly.created": "Anomalie créée",
  "anomaly.resolved": "Anomalie résolue",
  "anomaly.ignored": "Anomalie ignorée",
  "anomaly.superseded": "Anomalie remplacée",
};

function cents(value: { toString(): string } | null | undefined) {
  if (!value) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export async function listAttention(organizationId: string): Promise<AttentionItem[]> {
  const visible = { organizationId, deletedAt: null };
  const [approvals, anomalies, reviewDocuments, errorDocuments, unmatched, lowConfidence] = await Promise.all([
    prisma.approval.findMany({
      where: { organizationId, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { invoice: { include: { supplier: true } } },
    }),
    prisma.anomaly.findMany({
      where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: { createdAt: "desc" },
      take: 40,
      include: { supplier: true, invoice: { select: { amountTtc: true, number: true } } },
    }),
    prisma.document.findMany({
      where: { ...visible, status: "NEEDS_REVIEW" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, filename: true, createdAt: true, status: true },
    }),
    prisma.document.findMany({
      where: { ...visible, status: "ERROR" },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, filename: true, createdAt: true, status: true, errorMessage: true },
    }),
    prisma.invoice.findMany({
      where: { organizationId, direction: "SUPPLIER", matchedPurchaseOrderId: null, status: { notIn: ["PAID", "VALIDATED", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { supplier: true },
    }),
    prisma.document.findMany({
      where: { ...visible, confidence: { lt: 0.7, not: null }, status: { notIn: ["ERROR", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, filename: true, createdAt: true, status: true, confidence: true },
    }),
  ]);

  const items: AttentionItem[] = [
    ...approvals.map((item) => ({
      id: `approval-${item.id}`,
      type: "approval" as const,
      priority: 1,
      title: item.invoice?.number ?? "Approbation en attente",
      detail: "Approbation en attente",
      href: `/approvals/${item.id}`,
      supplier: item.invoice?.supplier?.name ?? "",
      status: item.status,
      amountCents: item.amountCents,
      createdAt: item.createdAt.toISOString(),
    })),
    ...anomalies.filter((item) => item.severity === "CRITICAL").map((item) => ({
      id: `anomaly-${item.id}`,
      type: "anomaly" as const,
      priority: 1,
      title: item.title,
      detail: "Anomalie critique",
      href: `/anomalies/${item.id}`,
      supplier: item.supplier?.name ?? "",
      status: item.status,
      amountCents: cents(item.invoice?.amountTtc),
      createdAt: item.createdAt.toISOString(),
    })),
    ...anomalies.filter((item) => item.severity !== "CRITICAL").map((item) => ({
      id: `anomaly-${item.id}`,
      type: "anomaly" as const,
      priority: 2,
      title: item.title,
      detail: "Anomalie ouverte",
      href: `/anomalies/${item.id}`,
      supplier: item.supplier?.name ?? "",
      status: item.status,
      amountCents: cents(item.invoice?.amountTtc),
      createdAt: item.createdAt.toISOString(),
    })),
    ...errorDocuments.map((item) => ({
      id: `error-${item.id}`,
      type: "document" as const,
      priority: 1,
      title: item.filename,
      detail: item.errorMessage ?? "Document en erreur",
      href: `/documents/${item.id}`,
      supplier: "",
      status: item.status,
      amountCents: null,
      createdAt: item.createdAt.toISOString(),
    })),
    ...unmatched.map((item) => ({
      id: `po-${item.id}`,
      type: "invoice" as const,
      priority: 2,
      title: item.number,
      detail: "Facture sans bon de commande",
      href: `/invoices/${item.id}`,
      supplier: item.supplier?.name ?? "",
      status: item.status,
      amountCents: cents(item.amountTtc),
      createdAt: item.createdAt.toISOString(),
    })),
    ...reviewDocuments.map((item) => ({
      id: `review-${item.id}`,
      type: "document" as const,
      priority: 2,
      title: item.filename,
      detail: "Facture nécessitant une vérification",
      href: `/documents/${item.id}`,
      supplier: "",
      status: item.status,
      amountCents: null,
      createdAt: item.createdAt.toISOString(),
    })),
    ...lowConfidence.map((item) => ({
      id: `confidence-${item.id}`,
      type: "document" as const,
      priority: 3,
      title: item.filename,
      detail: `Facture à faible confiance · ${Math.round((item.confidence ?? 0) * 100)} %`,
      href: `/documents/${item.id}`,
      supplier: "",
      status: item.status,
      amountCents: null,
      createdAt: item.createdAt.toISOString(),
    })),
  ];
  return items.sort((left, right) => left.priority - right.priority || right.createdAt.localeCompare(left.createdAt));
}

export function filterAttention(
  items: AttentionItem[],
  filters: { type?: string; priority?: string; status?: string; supplier?: string; from?: string; sort?: string },
) {
  const supplier = filters.supplier?.trim().toLowerCase() ?? "";
  const from = filters.from ? new Date(filters.from) : null;
  const filtered = items.filter((item) => {
    if (filters.type && item.type !== filters.type) return false;
    if (filters.priority && String(item.priority) !== filters.priority) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (supplier && !item.supplier.toLowerCase().includes(supplier) && !item.title.toLowerCase().includes(supplier)) return false;
    if (from && !Number.isNaN(from.getTime()) && new Date(item.createdAt) < from) return false;
    return true;
  });
  if (filters.sort === "date") return filtered.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (filters.sort === "amount") return filtered.sort((left, right) => (right.amountCents ?? -1) - (left.amountCents ?? -1));
  return filtered.sort((left, right) => left.priority - right.priority || right.createdAt.localeCompare(left.createdAt));
}

export async function getOperationalKpis(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const [organization, monthInvoices, autoValidated, humanValidated, openAnomalies, validatedDocuments] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } }),
    prisma.invoice.findMany({
      where: { organizationId, direction: "SUPPLIER", createdAt: { gte: monthStart } },
      select: { amountTtc: true, autoValidated: true, status: true },
    }),
    prisma.invoice.count({ where: { organizationId, direction: "SUPPLIER", autoValidated: true, createdAt: { gte: monthStart } } }),
    prisma.invoice.count({ where: { organizationId, direction: "SUPPLIER", autoValidated: false, status: "VALIDATED", createdAt: { gte: monthStart } } }),
    prisma.anomaly.count({ where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    prisma.document.count({ where: { organizationId, status: "VALIDATED", deletedAt: null } }),
  ]);
  const settings = readRoiSettings(organization?.settings);
  const processed = monthInvoices.length;
  const amountCents = monthInvoices.reduce((sum, invoice) => sum + (cents(invoice.amountTtc) ?? 0), 0);
  const roi = estimateOperationalRoi({ autoValidated, processed, settings });
  const decided = autoValidated + humanValidated;
  return {
    settings,
    processed,
    amountCents,
    autoValidated,
    openAnomalies,
    validatedDocuments,
    autoValidationRate: decided === 0 ? null : autoValidated / decided,
    ...roi,
  };
}

export async function listActivity(organizationId: string) {
  const rows = await prisma.auditLog.findMany({
    where: {
      organizationId,
      action: { in: Object.keys(ACTIVITY_LABEL) },
    },
    orderBy: { createdAt: "desc" },
    take: 12,
    include: { user: { select: { name: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    label: ACTIVITY_LABEL[row.action] ?? row.action,
    actor: row.user?.name ?? "Fluxora",
    createdAt: row.createdAt,
    href: row.documentId ? `/documents/${row.documentId}` : row.entityType === "Invoice" ? `/invoices/${row.entityId}` : "/audit",
  }));
}

export async function getOnboardingChecklist(organizationId: string) {
  const [organization, documents, suppliers, rules, validations] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId }, select: { sector: true, settings: true } }),
    prisma.document.count({ where: { organizationId, deletedAt: null } }),
    prisma.supplier.count({ where: { organizationId } }),
    prisma.automationRule.count({ where: { organizationId } }),
    prisma.document.count({ where: { organizationId, status: "VALIDATED", deletedAt: null } }),
  ]);
  const [invoiceValidations, autoValidated] = await Promise.all([
    prisma.invoice.count({ where: { organizationId, status: { in: ["VALIDATED", "PAID"] } } }),
    prisma.invoice.count({ where: { organizationId, autoValidated: true } }),
  ]);
  const steps = [
    { id: "organization", label: "Organisation configurée", done: Boolean(organization?.sector) },
    { id: "document", label: "Premier document importé", done: documents > 0 },
    { id: "supplier", label: "Premier fournisseur", done: suppliers > 0 },
    { id: "rule", label: "Première automatisation", done: rules > 0 },
    { id: "validation", label: "Première validation", done: validations > 0 || invoiceValidations > 0 },
    { id: "value", label: "Première valeur mesurée", done: autoValidated > 0 },
  ];
  return { steps, complete: steps.every((step) => step.done), demo: Boolean((organization?.settings as { demo?: boolean } | null)?.demo) };
}
