import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";

export type SearchGroup = {
  type: string;
  items: Array<{ id: string; title: string; detail: string; href: string }>;
};

export async function searchOrganization(organizationId: string, rawQuery: string): Promise<SearchGroup[]> {
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 2) return [];
  const contains = { contains: query, mode: "insensitive" as const };
  const token = query.toUpperCase().replace(/\s+/g, "_");
  const documentStatus = (["RECEIVED", "PROCESSING", "PROCESSED", "NEEDS_REVIEW", "VALIDATED", "REJECTED", "ERROR"] as const).find((value) => value === token);
  const invoiceStatus = (["DRAFT", "SENT", "DUE", "OVERDUE", "PAID", "VALIDATED", "REJECTED"] as const).find((value) => value === token);
  const anomalyType = (["AMOUNT_MISMATCH", "QUANTITY_MISMATCH", "SUPPLIER_MISMATCH", "CURRENCY_MISMATCH", "MISSING_PURCHASE_ORDER", "DUPLICATE_INVOICE", "LOW_CONFIDENCE", "MISSING_REQUIRED_FIELD"] as const).find((value) => value === token);
  const anomalyStatus = (["OPEN", "ACKNOWLEDGED", "RESOLVED", "IGNORED", "SUPERSEDED"] as const).find((value) => value === token);
  const approvalStatus = (["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const).find((value) => value === token);
  const amount = Number(query.replace(/\s/g, "").replace(",", "."));
  const amountFilter = Number.isFinite(amount) ? [{ amountTtc: new Prisma.Decimal(amount.toFixed(2)) }] : [];

  const [documents, invoices, suppliers, customers, orders, anomalies, approvals] = await Promise.all([
    prisma.document.findMany({
      where: { organizationId, deletedAt: null, OR: [{ filename: contains }, ...(documentStatus ? [{ status: documentStatus }] : [])] },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, filename: true, status: true },
    }),
    prisma.invoice.findMany({
      where: {
        organizationId,
        OR: [
          { number: contains },
          ...(invoiceStatus ? [{ status: invoiceStatus }] : []),
          { purchaseOrderNumber: contains },
          { supplier: { name: contains } },
          { supplier: { siren: contains } },
          { customer: { name: contains } },
          { customer: { siren: contains } },
          ...amountFilter,
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { supplier: { select: { name: true } }, customer: { select: { name: true } } },
    }),
    prisma.supplier.findMany({
      where: { organizationId, OR: [{ name: contains }, { siren: contains }, { vatNumber: contains }] },
      take: 8,
      select: { id: true, name: true, siren: true },
    }),
    prisma.customer.findMany({
      where: { organizationId, OR: [{ name: contains }, { siren: contains }] },
      take: 8,
      select: { id: true, name: true, siren: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { organizationId, OR: [{ number: contains }, { supplier: { name: contains } }] },
      take: 8,
      select: { id: true, number: true, supplier: { select: { name: true } } },
    }),
    prisma.anomaly.findMany({
      where: { organizationId, OR: [{ title: contains }, ...(anomalyType ? [{ type: anomalyType }] : []), ...(anomalyStatus ? [{ status: anomalyStatus }] : []), { supplier: { name: contains } }] },
      take: 8,
      select: { id: true, title: true, status: true },
    }),
    prisma.approval.findMany({
      where: { organizationId, OR: [{ reason: contains }, ...(approvalStatus ? [{ status: approvalStatus }] : []), { invoice: { number: contains } }, { invoice: { supplier: { name: contains } } }] },
      take: 8,
      include: { invoice: { select: { number: true } } },
    }),
  ]);

  return [
    { type: "Documents", items: documents.map((item) => ({ id: item.id, title: item.filename, detail: item.status, href: `/documents/${item.id}` })) },
    { type: "Factures", items: invoices.map((item) => ({ id: item.id, title: item.number, detail: item.supplier?.name ?? item.customer?.name ?? item.status, href: `/invoices/${item.id}` })) },
    { type: "Fournisseurs", items: suppliers.map((item) => ({ id: item.id, title: item.name, detail: item.siren ?? "—", href: `/suppliers/${item.id}` })) },
    { type: "Clients", items: customers.map((item) => ({ id: item.id, title: item.name, detail: item.siren ?? "—", href: `/customers/${item.id}` })) },
    { type: "Bons de commande", items: orders.map((item) => ({ id: item.id, title: item.number, detail: item.supplier?.name ?? "—", href: `/orders/${item.id}` })) },
    { type: "Anomalies", items: anomalies.map((item) => ({ id: item.id, title: item.title, detail: item.status, href: `/anomalies/${item.id}` })) },
    { type: "Approbations", items: approvals.map((item) => ({ id: item.id, title: item.invoice?.number ?? item.reason, detail: item.status, href: `/approvals/${item.id}` })) },
  ].filter((group) => group.items.length > 0);
}
