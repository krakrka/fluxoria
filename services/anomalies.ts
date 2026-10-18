import "server-only";
import { Prisma } from "@prisma/client";
import { runAnomalyAutomation, runInvoiceAutomation } from "@/services/automation";
import { findDuplicate } from "@/lib/duplicates";
import { readAutomationSettings } from "@/lib/automation-policy";
import { amountsWithinTolerance } from "@/lib/match-tolerances";
import { prisma } from "@/server/db";
import { compareInvoiceAndOrder } from "@/services/matching";

type Db = Prisma.TransactionClient | typeof prisma;

type Issue = {
  type:
    | "AMOUNT_MISMATCH"
    | "QUANTITY_MISMATCH"
    | "SUPPLIER_MISMATCH"
    | "CURRENCY_MISMATCH"
    | "MISSING_PURCHASE_ORDER"
    | "DUPLICATE_INVOICE"
    | "LOW_CONFIDENCE"
    | "MISSING_REQUIRED_FIELD";
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  expectedValue?: string;
  actualValue?: string;
  fingerprint: string;
  purchaseOrderId?: string | null;
  metadata?: Record<string, unknown>;
};

function cents(value: { toString(): string } | number | null | undefined) {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value.toString().replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export async function refreshInvoiceAnomalies(db: Db, organizationId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      supplier: true,
      document: { include: { lines: { orderBy: { position: "asc" } } } },
      matchedPurchaseOrder: { include: { supplier: true, lines: { orderBy: { position: "asc" } } } },
    },
  });
  if (!invoice || invoice.direction !== "SUPPLIER") return;
  const organization = await db.organization.findFirst({ where: { id: organizationId }, select: { settings: true } });
  const tolerances = readAutomationSettings(organization?.settings);

  if (!invoice.matchedPurchaseOrderId && !invoice.purchaseOrderNumber && invoice.supplierId) {
    const orders = await db.purchaseOrder.findMany({
      where: { organizationId, supplierId: invoice.supplierId, currency: invoice.currency },
      include: { supplier: true, lines: true },
    });
    const invoiceCents = cents(invoice.amountTtc);
    const candidates = orders.filter((order) => amountsWithinTolerance(invoiceCents, cents(order.amountTtc), tolerances));
    if (candidates.length === 1) {
      await db.invoice.update({
        where: { id: invoice.id },
        data: {
          matchedPurchaseOrderId: candidates[0].id,
          purchaseOrderNumber: candidates[0].number,
          matchStatus: "PARTIAL_MATCH",
          reconciled: false,
        },
      });
      invoice.matchedPurchaseOrderId = candidates[0].id;
      invoice.purchaseOrderNumber = candidates[0].number;
      invoice.matchedPurchaseOrder = candidates[0];
    }
  }

  const issues: Issue[] = [];
  const documentId = invoice.documentId;
  if (invoice.document && invoice.document.confidence !== null && invoice.document.confidence < 0.7) {
    issues.push({
      type: "LOW_CONFIDENCE",
      severity: "WARNING",
      title: "Confiance faible",
      description: "L'extraction de cette facture demande une vérification humaine.",
      actualValue: `${Math.round(invoice.document.confidence * 100)} %`,
      fingerprint: `LOW_CONFIDENCE:${documentId ?? invoice.id}`,
    });
  }
  const missing = Array.isArray(invoice.document?.missingFields) ? invoice.document.missingFields.filter((item): item is string => typeof item === "string") : [];
  for (const field of missing) {
    issues.push({
      type: "MISSING_REQUIRED_FIELD",
      severity: "WARNING",
      title: "Champ obligatoire manquant",
      description: `Le champ ${field} n'a pas été extrait.`,
      actualValue: field,
      fingerprint: `MISSING_REQUIRED_FIELD:${documentId ?? invoice.id}:${field}`,
    });
  }

  const others = await db.invoice.findMany({
    where: { organizationId, direction: "SUPPLIER", id: { not: invoice.id }, supplierId: invoice.supplierId },
    select: { id: true, number: true, issuedAt: true, amountTtc: true, supplierId: true },
  });
  const duplicate = findDuplicate(
    {
      id: invoice.id,
      number: invoice.number,
      issuedAt: invoice.issuedAt,
      amountCents: cents(invoice.amountTtc),
      supplierId: invoice.supplierId,
    },
    others.map((other) => ({
      id: other.id,
      number: other.number,
      issuedAt: other.issuedAt,
      amountCents: cents(other.amountTtc),
      supplierId: other.supplierId,
    })),
  );
  if (duplicate) {
    issues.push({
      type: "DUPLICATE_INVOICE",
      severity: "CRITICAL",
      title: "Facture potentiellement dupliquée",
      description: "Une autre facture du même fournisseur porte le même numéro, ou la même date et le même montant.",
      expectedValue: duplicate.other.number,
      actualValue: invoice.number,
      fingerprint: `DUPLICATE_INVOICE:${invoice.supplierId}:${invoice.number.toLowerCase()}:${duplicate.reason}`,
      metadata: { otherInvoiceId: duplicate.other.id, reason: duplicate.reason },
    });
  }

  const order = invoice.matchedPurchaseOrder;
  if (!order) {
    issues.push({
      type: "MISSING_PURCHASE_ORDER",
      severity: "WARNING",
      title: "Facture sans bon de commande",
      description: invoice.purchaseOrderNumber
        ? `Aucun bon de commande ${invoice.purchaseOrderNumber} n'a été trouvé dans l'organisation.`
        : "Aucun bon de commande n'est associé à cette facture.",
      expectedValue: invoice.purchaseOrderNumber ?? "Bon de commande",
      actualValue: "Introuvable",
      fingerprint: `MISSING_PURCHASE_ORDER:${documentId ?? invoice.id}`,
    });
  } else {
    const result = compareInvoiceAndOrder(
      {
        name: invoice.supplier?.name ?? "",
        purchaseOrderNumber: invoice.purchaseOrderNumber,
        totalTtcCents: cents(invoice.amountTtc),
        currency: invoice.currency,
        lines: (invoice.document?.lines ?? []).map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPriceCents: cents(line.unitPrice),
        })),
      },
      {
        name: order.supplier?.name ?? "",
        purchaseOrderNumber: order.number,
        totalTtcCents: cents(order.amountTtc),
        currency: order.currency,
        lines: order.lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPriceCents: cents(line.unitPrice),
        })),
      },
      tolerances,
    );
    const supplierCheck = result.checks.find((check) => check.key === "supplier");
    const currencyCheck = result.checks.find((check) => check.key === "currency");
    const amountCheck = result.checks.find((check) => check.key === "amount");
    const quantityCheck = result.checks.find((check) => check.key === "quantities");
    if (supplierCheck?.state === "fail") {
      issues.push({
        type: "SUPPLIER_MISMATCH",
        severity: "CRITICAL",
        title: "Fournisseur différent",
        description: "Le fournisseur de la facture ne correspond pas à celui du bon de commande.",
        expectedValue: order.supplier?.name ?? "—",
        actualValue: invoice.supplier?.name ?? "—",
        fingerprint: `SUPPLIER_MISMATCH:${documentId ?? invoice.id}`,
        purchaseOrderId: order.id,
      });
    }
    if (currencyCheck?.state === "fail") {
      issues.push({
        type: "CURRENCY_MISMATCH",
        severity: "CRITICAL",
        title: "Devise différente",
        description: "La devise de la facture n'est pas celle du bon de commande.",
        expectedValue: order.currency,
        actualValue: invoice.currency,
        fingerprint: `CURRENCY_MISMATCH:${documentId ?? invoice.id}`,
        purchaseOrderId: order.id,
      });
    }
    if (amountCheck?.state !== "ok") {
      const delta = Math.abs(cents(invoice.amountTtc) - cents(order.amountTtc));
      issues.push({
        type: "AMOUNT_MISMATCH",
        severity: delta > 5000 ? "CRITICAL" : "WARNING",
        title: "Écart de montant",
        description: "Le montant TTC de la facture sort de la tolérance du bon de commande.",
        expectedValue: order.amountTtc.toString(),
        actualValue: invoice.amountTtc.toString(),
        fingerprint: `AMOUNT_MISMATCH:${documentId ?? invoice.id}`,
        purchaseOrderId: order.id,
      });
    }
    if (quantityCheck?.state === "fail") {
      issues.push({
        type: "QUANTITY_MISMATCH",
        severity: "WARNING",
        title: "Écart de quantité",
        description: "Une quantité de ligne ne correspond pas au bon de commande.",
        fingerprint: `QUANTITY_MISMATCH:${documentId ?? invoice.id}`,
        purchaseOrderId: order.id,
      });
    }
  }

  let createdCritical = false;
  for (const issue of issues) {
    const existing = await db.anomaly.findFirst({
      where: { organizationId, fingerprint: issue.fingerprint, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    });
    if (existing) {
      await db.anomaly.update({
        where: { id: existing.id },
        data: {
          invoiceId: invoice.id,
          documentId,
          supplierId: invoice.supplierId,
          purchaseOrderId: issue.purchaseOrderId ?? invoice.matchedPurchaseOrderId,
          description: issue.description,
          expectedValue: issue.expectedValue,
          actualValue: issue.actualValue,
          metadata: (issue.metadata ?? {}) as Prisma.InputJsonValue,
        },
      });
      continue;
    }
    await db.anomaly.create({
      data: {
        organizationId,
        documentId,
        invoiceId: invoice.id,
        purchaseOrderId: issue.purchaseOrderId ?? invoice.matchedPurchaseOrderId,
        supplierId: invoice.supplierId,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        expectedValue: issue.expectedValue,
        actualValue: issue.actualValue,
        fingerprint: issue.fingerprint,
        metadata: (issue.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
    await db.auditLog.upsert({
      where: { organizationId_dedupeKey: { organizationId, dedupeKey: `anomaly.created:${issue.fingerprint}` } },
      create: {
        organizationId,
        action: "anomaly.created",
        entityType: "Anomaly",
        entityId: invoice.id,
        documentId,
        dedupeKey: `anomaly.created:${issue.fingerprint}`,
        newValue: { type: issue.type, title: issue.title },
      },
      update: { entityId: invoice.id },
    });
    if (issue.severity === "CRITICAL" || issue.type === "MISSING_PURCHASE_ORDER" || issue.type === "DUPLICATE_INVOICE" || issue.type === "AMOUNT_MISMATCH") {
      createdCritical = true;
    }
    if (issue.severity === "CRITICAL") {
      const created = await db.anomaly.findFirst({
        where: { organizationId, invoiceId: invoice.id, fingerprint: issue.fingerprint },
      });
      if (created) await runAnomalyAutomation(db, organizationId, created);
    }
  }
  if (createdCritical) {
    await db.notification.create({
      data: {
        organizationId,
        title: "Anomalie à examiner",
        body: `La facture ${invoice.number} demande une décision.`,
        href: `/invoices/${invoice.id}`,
      },
    });
  }

  const activeFingerprints = new Set(issues.map((issue) => issue.fingerprint));
  const stale = await db.anomaly.findMany({
    where: {
      organizationId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      OR: [{ invoiceId: invoice.id }, ...(documentId ? [{ documentId }] : [])],
    },
  });
  for (const anomaly of stale) {
    if (activeFingerprints.has(anomaly.fingerprint)) continue;
    await db.anomaly.update({
      where: { id: anomaly.id },
      data: { status: "SUPERSEDED", resolvedAt: new Date() },
    });
    await db.auditLog.create({
      data: {
        organizationId,
        action: "anomaly.superseded",
        entityType: "Anomaly",
        entityId: anomaly.id,
        documentId,
        oldValue: { status: anomaly.status, fingerprint: anomaly.fingerprint },
        newValue: { status: "SUPERSEDED", reason: "La nouvelle extraction ne reproduit plus cette anomalie." },
      },
    });
  }

  await runInvoiceAutomation(db, organizationId, invoice.id);
}

export async function setAnomalyStatus(input: {
  organizationId: string;
  userId: string;
  anomalyId: string;
  status: "ACKNOWLEDGED" | "RESOLVED" | "IGNORED";
  comment?: string;
}) {
  const anomaly = await prisma.anomaly.findFirst({
    where: { id: input.anomalyId, organizationId: input.organizationId },
  });
  if (!anomaly) throw new Error("Anomalie introuvable.");
  if (anomaly.status === "RESOLVED" || anomaly.status === "IGNORED") throw new Error("Cette anomalie est déjà close.");
  const closed = input.status !== "ACKNOWLEDGED";
  await prisma.anomaly.update({
    where: { id: anomaly.id },
    data: {
      status: input.status,
      resolvedAt: closed ? new Date() : null,
      resolvedById: closed ? input.userId : null,
    },
  });
  await prisma.auditLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      action: input.status === "RESOLVED" ? "anomaly.resolved" : input.status === "IGNORED" ? "anomaly.ignored" : "anomaly.acknowledged",
      entityType: "Anomaly",
      entityId: anomaly.id,
      documentId: anomaly.documentId,
      oldValue: { status: anomaly.status },
      newValue: { status: input.status, comment: input.comment ?? null },
    },
  });
}
