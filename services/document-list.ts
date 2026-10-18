import "server-only";
import { Prisma, type DocumentKind, type DocumentStatus } from "@prisma/client";
import { kindsForTypeFilter } from "@/lib/document-types";
import { DOCUMENT_STATUSES } from "@/lib/document-status";
import { prisma } from "@/server/db";

const PAGE_SIZE = 20;
const SORTS = {
  updated: { updatedAt: "desc" },
  date: { createdAt: "desc" },
  created: { createdAt: "desc" },
  amount: { amountCents: "desc" },
  confidence: { confidence: "desc" },
  name: { filename: "asc" },
  status: { status: "asc" },
} as const;

export type DocumentListQuery = {
  organizationId: string;
  q?: string;
  status?: string;
  type?: string;
  supplier?: string;
  customer?: string;
  from?: string;
  to?: string;
  minAmount?: string;
  maxAmount?: string;
  minConfidence?: string;
  sort?: string;
  page?: string;
};

function dateOrUndefined(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function listDocuments(query: DocumentListQuery) {
  const page = Math.max(1, Number(query.page) || 1);
  const and: Prisma.DocumentWhereInput[] = [{ organizationId: query.organizationId, deletedAt: null }];
  if (query.status && (DOCUMENT_STATUSES as readonly string[]).includes(query.status)) {
    and.push({ status: query.status as DocumentStatus });
  }
  const kinds = kindsForTypeFilter(query.type);
  if (kinds) and.push({ kind: { in: kinds as DocumentKind[] } });
  if (query.q) {
    and.push({
      OR: [
        { filename: { contains: query.q, mode: "insensitive" } },
        {
          fields: {
            some: {
              key: { in: ["invoice_number", "supplier_name", "customer_name", "purchase_order_number"] },
              value: { contains: query.q, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }
  if (query.supplier) {
    and.push({ fields: { some: { key: "supplier_name", value: { contains: query.supplier, mode: "insensitive" } } } });
  }
  if (query.customer) {
    and.push({ fields: { some: { key: "customer_name", value: { contains: query.customer, mode: "insensitive" } } } });
  }
  const from = dateOrUndefined(query.from);
  const to = dateOrUndefined(query.to);
  if (from || to) and.push({ createdAt: { gte: from, lte: to ? new Date(to.getTime() + 86_400_000 - 1) : undefined } });
  const minConfidence = query.minConfidence ? Number(query.minConfidence) : undefined;
  if (minConfidence !== undefined && !Number.isNaN(minConfidence)) {
    and.push({ confidence: { gte: minConfidence / 100 } });
  }
  const minAmount = query.minAmount ? Number(query.minAmount) : undefined;
  const maxAmount = query.maxAmount ? Number(query.maxAmount) : undefined;
  if ((minAmount !== undefined && !Number.isNaN(minAmount)) || (maxAmount !== undefined && !Number.isNaN(maxAmount))) {
    const rows = await prisma.$queryRaw<Array<{ documentId: string }>>`
      SELECT "documentId" FROM "DocumentField"
      WHERE "organizationId" = ${query.organizationId}
        AND key = 'amount_ttc'
        AND value ~ '^[0-9]+([.,][0-9]+)?$'
        AND REPLACE(value, ',', '.')::numeric >= ${minAmount ?? 0}
        AND REPLACE(value, ',', '.')::numeric <= ${maxAmount ?? 999999999}
    `;
    and.push({ id: { in: rows.map((row) => row.documentId) } });
  }

  const where = { AND: and };
  const orderBy = SORTS[query.sort as keyof typeof SORTS] ?? SORTS.updated;
  const [total, documents] = await Promise.all([
    prisma.document.count({ where }),
    prisma.document.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        fields: {
          where: { key: { in: ["supplier_name", "customer_name", "issue_date", "amount_ttc", "invoice_number"] } },
        },
      },
    }),
  ]);

  return { documents, total, page, pageSize: PAGE_SIZE, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}
