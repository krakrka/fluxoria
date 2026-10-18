import "server-only";
import { Prisma, type InvoiceStatus } from "@prisma/client";
import type { AccountingConnector } from "@/connectors/accounting/types";
import { companyKey, matchParty } from "@/lib/party-match";
import { prisma } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { assertCanCreateInvoice, lockOrganization } from "@/services/billing";

const PAGE_SIZE = 20;

export async function listInvoices(query: {
  organizationId: string;
  q?: string;
  supplier?: string;
  status?: string;
  currency?: string;
  anomaly?: string;
  from?: string;
  to?: string;
  page?: number;
}) {
  const page = Math.max(1, query.page ?? 1);
  const and: Prisma.InvoiceWhereInput[] = [{ organizationId: query.organizationId }];
  if (query.status) and.push({ status: query.status as InvoiceStatus });
  if (query.currency) and.push({ currency: query.currency.toUpperCase() });
  if (query.supplier) and.push({ supplier: { name: { contains: query.supplier, mode: "insensitive" } } });
  if (query.from || query.to) {
    and.push({
      issuedAt: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(`${query.to}T23:59:59`) : undefined,
      },
    });
  }
  if (query.anomaly === "open") and.push({ anomalies: { some: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } } });
  if (query.q) {
    and.push({
      OR: [
        { number: { contains: query.q, mode: "insensitive" } },
        { purchaseOrderNumber: { contains: query.q, mode: "insensitive" } },
        { supplier: { name: { contains: query.q, mode: "insensitive" } } },
      ],
    });
  }
  const where = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { issuedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        supplier: { select: { id: true, name: true } },
        customer: { select: { name: true } },
        anomalies: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } }, select: { id: true } },
      },
    }),
  ]);
  return { rows, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export async function getInvoiceForOrganization(organizationId: string, invoiceId: string) {
  return prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      supplier: true,
      customer: true,
      document: { select: { id: true, filename: true, mimeType: true } },
      matchedPurchaseOrder: { include: { supplier: true } },
      anomalies: { orderBy: { createdAt: "desc" } },
      payments: true,
    },
  });
}

export async function validateSupplierInvoice(input: { organizationId: string; userId: string; invoiceId: string }) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
    include: { anomalies: { where: { status: "OPEN", severity: "CRITICAL" } } },
  });
  if (!invoice) throw new Error("Facture introuvable.");
  if (invoice.anomalies.length > 0) throw new Error("Une anomalie critique est encore ouverte.");
  await prisma.invoice.update({ where: { id: invoice.id }, data: { reconciled: true } });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "invoice.validated",
    entityType: "Invoice",
    entityId: invoice.id,
    documentId: invoice.documentId,
    oldValue: { reconciled: invoice.reconciled },
    newValue: { reconciled: true },
  });
}

export async function importExternalInvoice(input: {
  organizationId: string;
  userId: string;
  externalId: string;
  provider: string;
  number: string;
  supplierName: string;
  supplierSiren?: string | null;
  amountTtc: string;
  currency: string;
  issuedAt?: Date | null;
}) {
  const amount = new Prisma.Decimal(input.amountTtc);
  if (amount.lessThan(0)) throw new Error("Montant de facture invalide.");
  const result = await prisma.$transaction(async (tx) => {
  await lockOrganization(tx, input.organizationId);
  const existing = await tx.invoice.findFirst({
    where: { organizationId: input.organizationId, number: input.number },
  });
  if (existing) return { invoice: existing, created: false };
  await assertCanCreateInvoice(input.organizationId, tx);
  const parties = await tx.supplier.findMany({
    where: { organizationId: input.organizationId },
    select: { id: true, name: true, siren: true, vatNumber: true },
  });
  const matched = matchParty(parties, { name: input.supplierName, siren: input.supplierSiren ?? null, vatNumber: null });
  const supplier = matched
    ? await tx.supplier.findFirst({ where: { id: matched.id, organizationId: input.organizationId } })
    : await tx.supplier.create({
        data: {
          organizationId: input.organizationId,
          name: input.supplierName,
          siren: input.supplierSiren || null,
          normalizedName: companyKey(input.supplierName),
        },
      });
  if (!supplier) throw new Error("Fournisseur introuvable.");
  const invoice = await tx.invoice.create({
    data: {
      organizationId: input.organizationId,
      supplierId: supplier.id,
      direction: "SUPPLIER",
      number: input.number,
      issuedAt: input.issuedAt,
      amountHt: amount,
      amountVat: new Prisma.Decimal(0),
      amountTtc: amount,
      currency: input.currency || "EUR",
      status: "DRAFT",
    },
  });
  return { invoice, created: true as const };
  }, { timeout: 20_000 });
  if (result.created) {
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "invoice.imported",
      entityType: "Invoice",
      entityId: result.invoice.id,
      newValue: { provider: input.provider, externalId: input.externalId, number: result.invoice.number },
    });
  }
  return result;
}

export async function exportValidatedInvoice(input: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  connector: AccountingConnector;
  token: string;
}) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
    include: { supplier: true },
  });
  if (!invoice) throw new Error("Facture introuvable.");
  if (invoice.status !== "VALIDATED" && invoice.status !== "PAID" && !invoice.autoValidated) {
    throw new Error("Seule une facture validée peut être exportée.");
  }
  const result = await input.connector.exportInvoice(input.token, {
    number: invoice.number,
    supplierName: invoice.supplier?.name ?? null,
    amountTtc: invoice.amountTtc.toString(),
    currency: invoice.currency,
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "invoice.exported",
    entityType: "Invoice",
    entityId: invoice.id,
    newValue: { provider: input.connector.id, externalId: result.externalId },
  });
  return result;
}
