import "server-only";
import { Prisma, type DocumentKind, type DocumentStatus, type InvoiceDirection } from "@prisma/client";
import { fieldText, type ExtractedDocument } from "@/ai/schema";
import { needsHumanReview, problematicFields } from "@/ai/review";
import { assertStatusTransition, canDeleteDocument, canReprocessDocument } from "@/lib/document-status";
import { documentReadyToValidate } from "@/lib/document-readiness";
import { readConfidenceThresholds } from "@/lib/confidence";
import { ExtractionFailed, extractForOrganization, type ExtractionUsageDraft } from "@/services/extraction";
import { FIELD_LABELS } from "@/lib/field-labels";
import { captureException, logger } from "@/lib/logger";
import { publicErrorMessage } from "@/lib/security";
import { parseAmountToCents } from "@/lib/money";
import { isValidSiren } from "@/lib/siren";
import { companyKey, matchParty } from "@/lib/party-match";
import { refreshInvoiceAnomalies } from "@/services/anomalies";
import { compareInvoiceAndOrder } from "@/services/matching";
import { assertCanCreateInvoice, assertCanProcessDocuments, lockOrganization } from "@/services/billing";
import { recordProductEvent } from "@/services/product-events";
import { assertTenantStorageKey, getStorage, readForOrganization, validateUpload, type StorageProvider } from "@/services/storage";
import { writeAudit } from "@/server/audit";
import { prisma } from "@/server/db";
import { contextHash, executionDedupeKey } from "@/lib/automation-idempotency";
import { evaluateRules, type RuleAction, type RuleDefinition } from "@/workflows/engine";

function textValue(document: ExtractedDocument, key: string) {
  return fieldText(document.fields[key]);
}

function amountCents(document: ExtractedDocument, key: string) {
  return parseAmountToCents(textValue(document, key)) ?? 0;
}

function parseDate(value: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function decimal(cents: number) {
  return (cents / 100).toFixed(2);
}

function invoiceStatus(dueAt: Date | null): "DUE" | "OVERDUE" | "SENT" {
  if (!dueAt) return "SENT";
  return dueAt.getTime() < Date.now() ? "OVERDUE" : "DUE";
}

function asRules(rows: Array<{ id: string; name: string; trigger: string; conditions: Prisma.JsonValue; actions: Prisma.JsonValue }>): RuleDefinition[] {
  return rows.flatMap((row) => {
    const conditions = row.conditions as RuleDefinition["conditions"];
    const actions = row.actions as RuleAction[];
    if (!conditions?.all || !Array.isArray(actions)) return [];
    return [{ id: row.id, name: row.name, trigger: row.trigger, conditions, actions }];
  });
}

async function findOrCreateParty(
  tx: Prisma.TransactionClient,
  kind: "supplier" | "customer",
  organizationId: string,
  name: string | null,
  siren: string | null,
  vatNumber: string | null,
) {
  if (!name) return null;
  if (kind === "supplier") {
    const parties = await tx.supplier.findMany({
      where: { organizationId },
      select: { id: true, name: true, siren: true, vatNumber: true },
    });
    const matched = matchParty(parties, { name, siren, vatNumber });
    if (matched) return tx.supplier.findFirst({ where: { id: matched.id, organizationId } });
    return tx.supplier.create({ data: { organizationId, name, siren, vatNumber, normalizedName: companyKey(name) } });
  }
  const parties = await tx.customer.findMany({
    where: { organizationId },
    select: { id: true, name: true, siren: true, vatNumber: true },
  });
  const matched = matchParty(parties, { name, siren, vatNumber });
  if (matched) return tx.customer.findFirst({ where: { id: matched.id, organizationId } });
  return tx.customer.create({ data: { organizationId, name, siren, vatNumber, normalizedName: companyKey(name) } });
}

export async function createUploadedDocuments(input: {
  organizationId: string;
  userId: string;
  files: Array<{ filename: string; mimeType: string; bytes: Buffer }>;
  storage?: StorageProvider;
}) {
  const organization = await prisma.organization.findFirst({
    where: { id: input.organizationId, deletedAt: null },
  });
  if (!organization) throw new Error("Organisation introuvable.");
  const incomingBytes = input.files.reduce((sum, file) => sum + file.bytes.byteLength, 0);
  const storageProvider = input.storage ?? getStorage();
  const written: string[] = [];
  let created;
  try {
  created = await prisma.$transaction(async (tx) => {
  await lockOrganization(tx, input.organizationId);
  await assertCanProcessDocuments(input.organizationId, input.files.length, incomingBytes, tx);

  const created = [];
  for (const file of input.files) {
    const filename = validateUpload(file.filename, file.mimeType, file.bytes);
    const document = await tx.document.create({
      data: {
        organizationId: input.organizationId,
        uploadedById: input.userId,
        filename,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        storageKey: "pending",
        status: "RECEIVED",
      },
    });
    const storageKey = pathKey(input.organizationId, document.id);
    assertTenantStorageKey(storageKey, input.organizationId);
    await storageProvider.put(storageKey, file.bytes);
    written.push(storageKey);
    const saved = await tx.document.update({
      where: { id: document.id },
      data: { storageKey },
    });
    created.push(saved);
  }
  return created;
  }, { timeout: 30_000 });
  } catch (error) {
    for (const key of written) {
      const referenced = await prisma.document.count({ where: { storageKey: key, organizationId: input.organizationId } });
      if (referenced > 0) continue;
      try {
        await storageProvider.delete(key);
      } catch {
        logger.warn("orphan_delete_failed", { organizationId: input.organizationId });
      }
    }
    throw error;
  }
  for (const saved of created) {
    await writeAudit({
      organizationId: input.organizationId,
      userId: input.userId,
      action: "document.uploaded",
      entityType: "Document",
      entityId: saved.id,
      documentId: saved.id,
      newValue: { filename: saved.filename, mimeType: saved.mimeType, sizeBytes: saved.sizeBytes },
    });
    await recordProductEvent({ organizationId: input.organizationId, userId: input.userId, name: "document_uploaded" });
  }
  return created;
}

function pathKey(organizationId: string, documentId: string) {
  return `organizations/${organizationId}/documents/${documentId}/original`;
}

const CLAIMABLE_STATUSES = ["RECEIVED", "PROCESSED", "NEEDS_REVIEW", "VALIDATED", "REJECTED", "ERROR"] as const;

export type ProcessingLease = { jobId: string; startedAt: Date };

export class ProcessingLeaseLost extends Error {
  constructor() {
    super("Bail de traitement perdu.");
    this.name = "ProcessingLeaseLost";
  }
}

let beforePersistForTests: (() => Promise<void>) | null = null;

export function setProcessingBeforePersistForTests(fn: (() => Promise<void>) | null) {
  if (process.env.NODE_ENV === "production") return;
  beforePersistForTests = fn;
}

async function holdsProcessingLease(db: Prisma.TransactionClient | typeof prisma, organizationId: string, lease: ProcessingLease) {
  const row = await db.job.findFirst({
    where: { id: lease.jobId, organizationId, status: "PROCESSING", startedAt: lease.startedAt },
    select: { id: true },
  });
  return Boolean(row);
}

async function claimDocument(tx: Prisma.TransactionClient, existing: { id: string; organizationId: string; uploadedById: string | null; status: DocumentStatus }, continueProcessing: boolean) {
  if (continueProcessing) {
    if (existing.status !== "PROCESSING") {
      assertStatusTransition(existing.status, "PROCESSING");
      await tx.document.update({ where: { id: existing.id }, data: { status: "PROCESSING", errorMessage: null } });
    }
    return true;
  }
  if (!canReprocessDocument(existing.status) && existing.status !== "RECEIVED") return false;
  assertStatusTransition(existing.status, "PROCESSING");
  const claimed = await tx.document.updateMany({
    where: { id: existing.id, status: { in: [...CLAIMABLE_STATUSES] }, deletedAt: null },
    data: { status: "PROCESSING", errorMessage: null },
  });
  if (claimed.count === 0) return false;
  await upsertAudit(tx, {
    organizationId: existing.organizationId,
    userId: existing.uploadedById,
    action: "document.processing_started",
    entityType: "Document",
    entityId: existing.id,
    documentId: existing.id,
    dedupeKey: `document.processing_started:${existing.id}`,
    oldValue: { status: existing.status },
    newValue: { status: "PROCESSING" },
  }, false);
  return true;
}

export async function processDocument(
  documentId: string,
  options?: { organizationId?: string; continueProcessing?: boolean; finalAttempt?: boolean; lease?: ProcessingLease; storage?: StorageProvider },
) {
  const existing = await prisma.document.findFirst({
    where: {
      id: documentId,
      deletedAt: null,
      ...(options?.organizationId ? { organizationId: options.organizationId } : {}),
    },
  });
  if (!existing) {
    if (options?.organizationId) throw new Error("Document introuvable.");
    return;
  }
  if (options?.lease) {
    const claimed = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, existing.organizationId);
      if (!(await holdsProcessingLease(tx, existing.organizationId, options.lease!))) throw new ProcessingLeaseLost();
      return claimDocument(tx, existing, options.continueProcessing === true);
    });
    if (!claimed) return;
  } else if (options?.continueProcessing) {
    if (existing.status !== "PROCESSING") {
      assertStatusTransition(existing.status, "PROCESSING");
      await prisma.document.update({ where: { id: documentId }, data: { status: "PROCESSING", errorMessage: null } });
    }
  } else {
    if (!canReprocessDocument(existing.status) && existing.status !== "RECEIVED") return;
    assertStatusTransition(existing.status, "PROCESSING");
    const claimed = await prisma.document.updateMany({
      where: { id: documentId, status: { in: [...CLAIMABLE_STATUSES] }, deletedAt: null },
      data: { status: "PROCESSING", errorMessage: null },
    });
    if (claimed.count === 0) return;
    await upsertAudit(prisma, {
      organizationId: existing.organizationId,
      userId: existing.uploadedById,
      action: "document.processing_started",
      entityType: "Document",
      entityId: documentId,
      documentId,
      dedupeKey: `document.processing_started:${documentId}`,
      oldValue: { status: existing.status },
      newValue: { status: "PROCESSING" },
    }, false);
  }

  const started = Date.now();
  logger.info("document_processing_started", { documentId, organizationId: existing.organizationId });
  const storage = options?.storage ?? getStorage();
  try {
    const bytes = await readForOrganization(storage, existing.organizationId, existing.storageKey);
    if (options?.lease && !(await holdsProcessingLease(prisma, existing.organizationId, options.lease))) throw new ProcessingLeaseLost();
    const extracted = await extractForOrganization({
      organizationId: existing.organizationId,
      documentId: existing.id,
      filename: existing.filename,
      mimeType: existing.mimeType,
      bytes,
      hintedKind: existing.kind === "UNKNOWN" ? undefined : existing.kind,
    });
    if (beforePersistForTests) await beforePersistForTests();
    await persistExtraction(existing.id, existing.organizationId, extracted.document, Date.now() - started, {
      usage: extracted.usage,
      lease: options?.lease,
    });
    logger.info("document_processing_completed", {
      documentId,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof ProcessingLeaseLost || (error instanceof Error && error.message === "Bail de traitement perdu.")) throw error;
    const durationMs = Date.now() - started;
    const message = publicErrorMessage(error, "Le traitement a échoué.");
    const usage = error instanceof ExtractionFailed ? error.usage : null;
    captureException(error, { documentId, durationMs, area: "document_processing" });
    await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, existing.organizationId);
      if (options?.lease && !(await holdsProcessingLease(tx, existing.organizationId, options.lease))) throw new ProcessingLeaseLost();
      if (usage) await tx.aiUsage.create({ data: usageRow(existing.organizationId, documentId, usage) });
      if (options?.finalAttempt) {
        assertStatusTransition("PROCESSING", "ERROR");
        await tx.document.update({
          where: { id: documentId },
          data: { status: "ERROR", errorMessage: message, processingMs: durationMs },
        });
        await upsertNotification(tx, {
          organizationId: existing.organizationId,
          userId: existing.uploadedById,
          title: "Document non traité",
          body: `Nous n'avons pas réussi à traiter « ${existing.filename} ». Vous pouvez réessayer.`,
          href: `/documents/${documentId}`,
          dedupeKey: `document.processing_failed:${documentId}`,
        });
      }
      await upsertAudit(tx, {
        organizationId: existing.organizationId,
        action: "document.processing_failed",
        entityType: "Document",
        entityId: documentId,
        documentId,
        dedupeKey: `document.processing_failed:${documentId}:${options?.finalAttempt ? "final" : "attempt"}`,
        newValue: { error: message, final: Boolean(options?.finalAttempt) },
      }, true);
    });
    throw error;
  }
}

type FactDb = Prisma.TransactionClient | typeof prisma;

async function upsertNotification(
  db: FactDb,
  data: { organizationId: string; userId?: string | null; title: string; body: string; href?: string | null; dedupeKey: string },
) {
  await db.notification.upsert({
    where: { organizationId_dedupeKey: { organizationId: data.organizationId, dedupeKey: data.dedupeKey } },
    create: {
      organizationId: data.organizationId,
      userId: data.userId ?? null,
      title: data.title,
      body: data.body,
      href: data.href ?? null,
      dedupeKey: data.dedupeKey,
    },
    update: { title: data.title, body: data.body, href: data.href ?? null },
  });
}

async function upsertAudit(
  db: FactDb,
  data: {
    organizationId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId: string;
    documentId?: string | null;
    dedupeKey: string;
    oldValue?: Prisma.InputJsonValue;
    newValue?: Prisma.InputJsonValue;
  },
  refresh: boolean,
) {
  await db.auditLog.upsert({
    where: { organizationId_dedupeKey: { organizationId: data.organizationId, dedupeKey: data.dedupeKey } },
    create: {
      organizationId: data.organizationId,
      userId: data.userId ?? null,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      documentId: data.documentId ?? null,
      dedupeKey: data.dedupeKey,
      oldValue: data.oldValue,
      newValue: data.newValue,
    },
    update: refresh ? { entityId: data.entityId, newValue: data.newValue } : {},
  });
}

function usageRow(organizationId: string, documentId: string, usage: ExtractionUsageDraft) {
  return {
    organizationId,
    documentId,
    provider: usage.provider,
    model: usage.model,
    strategy: usage.strategy,
    outcome: usage.outcome,
    durationMs: usage.durationMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    estimatedCostMicros: usage.estimatedCostMicros,
    error: usage.error?.slice(0, 500),
  };
}

async function persistExtraction(
  documentId: string,
  organizationId: string,
  extracted: ExtractedDocument,
  durationMs: number,
  context: { usage: ExtractionUsageDraft; lease?: ProcessingLease },
) {
  const siren = textValue(extracted, "siren");
  const organization = await prisma.organization.findFirst({
    where: { id: organizationId },
    select: { settings: true },
  });
  const thresholds = readConfidenceThresholds(organization?.settings);
  const warnings = [...extracted.warnings];
  if (siren && !isValidSiren(siren)) warnings.push("Le SIREN extrait ne passe pas le contrôle de clé.");
  const weak = problematicFields({ ...extracted, warnings }, thresholds);
  if (weak.length > 0) {
    warnings.push(`Champs à corriger : ${weak.map((key) => FIELD_LABELS[key] ?? key).join(", ")}`);
  }
  const review = needsHumanReview({ ...extracted, warnings }, thresholds);
  const kind = extracted.detected_document_type as DocumentKind;
  const supplierName = textValue(extracted, "supplier_name");
  const customerName = textValue(extracted, "customer_name");
  const poNumber = textValue(extracted, "purchase_order_number");

  await prisma.$transaction(async (tx) => {
    await lockOrganization(tx, organizationId);
    if (context.lease && !(await holdsProcessingLease(tx, organizationId, context.lease))) throw new ProcessingLeaseLost();
    await tx.aiUsage.create({ data: usageRow(organizationId, documentId, context.usage) });
    const previous = await tx.document.findFirst({
      where: { id: documentId, organizationId },
      include: { fields: true },
    });
    if (previous && (previous.fields.length > 0 || previous.processedAt)) {
      await tx.documentProcessingRun.create({
        data: {
          organizationId,
          documentId,
          outcome: previous.status,
          kind: previous.kind,
          confidence: previous.confidence,
          snapshot: {
            fields: previous.fields.map((field) => ({
              key: field.key,
              value: field.value,
              confidence: field.confidence,
              source: field.source,
            })),
            warnings: previous.warnings,
          },
          finishedAt: new Date(),
        },
      });
    }
    await tx.documentField.deleteMany({ where: { documentId, organizationId } });
    await tx.documentLine.deleteMany({ where: { documentId, organizationId } });
    await tx.invoice.deleteMany({ where: { documentId, organizationId } });
    await tx.purchaseOrder.deleteMany({ where: { documentId, organizationId } });

    await tx.documentField.createMany({
      data: Object.entries(extracted.fields).map(([key, field]) => ({
        organizationId,
        documentId,
        key,
        label: FIELD_LABELS[key] ?? key,
        value: field.value === null ? null : String(field.value),
        confidence: field.confidence,
        source: "AI" as const,
        page: field.page ?? null,
        zone: field.zone ?? null,
        sourceText: field.source_text ?? null,
        validated: false,
      })),
    });

    const preserved = (previous?.fields ?? []).filter((field) => field.source === "USER" || field.validated);
    for (const kept of preserved) {
      const restored = await tx.documentField.updateMany({
        where: { documentId, organizationId, key: kept.key },
        data: {
          value: kept.value,
          confidence: kept.confidence,
          source: kept.source,
          validated: kept.validated,
          validatedById: kept.validatedById,
        },
      });
      if (restored.count === 0) {
        await tx.documentField.create({
          data: {
            organizationId,
            documentId,
            key: kept.key,
            label: kept.label,
            value: kept.value,
            confidence: kept.confidence,
            source: kept.source,
            validated: kept.validated,
            validatedById: kept.validatedById,
          },
        });
      }
    }

    await tx.documentLine.createMany({
      data: extracted.lines.map((line, position) => ({
        organizationId,
        documentId,
        position,
        description: fieldText(line.description) ?? "Ligne",
        quantity: new Prisma.Decimal(fieldText(line.quantity) ?? "0"),
        unitPrice: new Prisma.Decimal(fieldText(line.unit_price) ?? "0"),
        vatRate: new Prisma.Decimal(fieldText(line.vat_rate) ?? "0"),
        amountHt: new Prisma.Decimal(fieldText(line.amount_ht) ?? "0"),
        confidence: line.description.confidence,
      })),
    });

    const direction: InvoiceDirection = kind === "CUSTOMER_INVOICE" ? "CUSTOMER" : "SUPPLIER";
    let invoiceId: string | null = null;
    if (kind === "INVOICE" || kind === "SUPPLIER_INVOICE" || kind === "CUSTOMER_INVOICE") {
      await assertCanCreateInvoice(organizationId, tx);
      const supplier = await findOrCreateParty(tx, "supplier", organizationId, supplierName, siren, textValue(extracted, "vat_number"));
      const customer = await findOrCreateParty(tx, "customer", organizationId, customerName, null, null);
      const dueAt = parseDate(textValue(extracted, "due_date"));
      const invoice = await tx.invoice.create({
        data: {
          organizationId,
          documentId,
          supplierId: direction === "SUPPLIER" ? supplier?.id : kind === "INVOICE" ? supplier?.id : null,
          customerId: direction === "CUSTOMER" ? customer?.id : null,
          direction,
          number:
            preserved.find((field) => field.key === "invoice_number")?.value ??
            textValue(extracted, "invoice_number") ??
            `DOC-${documentId.slice(-6)}`,
          issuedAt: parseDate(textValue(extracted, "issue_date")),
          dueAt,
          amountHt: decimal(amountCents(extracted, "amount_ht")),
          amountVat: decimal(amountCents(extracted, "amount_vat")),
          amountTtc: decimal(amountCents(extracted, "amount_ttc")),
          currency: textValue(extracted, "currency") ?? "EUR",
          paymentTerms: textValue(extracted, "payment_terms"),
          purchaseOrderNumber: poNumber,
          status: invoiceStatus(dueAt),
        },
      });
      invoiceId = invoice.id;
      if (poNumber && direction === "SUPPLIER") {
        await reconcileInvoice(tx, organizationId, invoice.id);
      }
    }

    if (kind === "PURCHASE_ORDER") {
      const supplier = await findOrCreateParty(tx, "supplier", organizationId, supplierName, siren, textValue(extracted, "vat_number"));
      await tx.purchaseOrder.create({
        data: {
          organizationId,
          documentId,
          supplierId: supplier?.id,
          number: poNumber ?? textValue(extracted, "invoice_number") ?? `BC-${documentId.slice(-6)}`,
          issuedAt: parseDate(textValue(extracted, "issue_date")),
          amountHt: decimal(amountCents(extracted, "amount_ht")),
          amountTtc: decimal(amountCents(extracted, "amount_ttc")),
          lines: {
            create: extracted.lines.map((line, position) => ({
              organizationId,
              position,
              description: fieldText(line.description) ?? "Ligne",
              quantity: new Prisma.Decimal(fieldText(line.quantity) ?? "0"),
              unitPrice: new Prisma.Decimal(fieldText(line.unit_price) ?? "0"),
              amountHt: new Prisma.Decimal(fieldText(line.amount_ht) ?? "0"),
            })),
          },
        },
      });
    }

    const rules = asRules(
      await tx.automationRule.findMany({
        where: { organizationId, enabled: true, trigger: "DOCUMENT_PROCESSED" },
        orderBy: { priority: "asc" },
      }),
    );
    const invoice = invoiceId
      ? await tx.invoice.findFirst({ where: { id: invoiceId, organizationId }, include: { supplier: true } })
      : null;
    const ruleContext = {
      amountTtc: (amountCents(extracted, "amount_ttc") / 100),
      supplierName: supplierName ?? "",
      customerName: customerName ?? "",
      purchaseOrderNumber: poNumber ?? "",
      hasMatchingOrder: invoice?.matchStatus === "MATCH" || invoice?.matchStatus === "PARTIAL_MATCH",
      matchStatus: invoice?.matchStatus ?? "UNMATCHED",
      isOverdue: invoice?.status === "OVERDUE",
      documentKind: kind,
    };
    const matched = evaluateRules(rules, "DOCUMENT_PROCESSED", ruleContext);

    let status: DocumentStatus = review ? "NEEDS_REVIEW" : "PROCESSED";
    assertStatusTransition("PROCESSING", status);
    let category: string | null = null;
    let reconciled = invoice?.reconciled ?? false;
    for (const rule of matched) {
      const startedRule = Date.now();
      for (const action of rule.actions) {
        if (action.type === "require_review") status = "NEEDS_REVIEW";
        if (action.type === "set_category") category = action.category;
        if (action.type === "mark_reconciled" && invoice?.matchStatus === "MATCH") reconciled = true;
        if (action.type === "create_reminder_task") {
          const reminderKey = executionDedupeKey({
            ruleId: rule.id,
            trigger: "DOCUMENT_PROCESSED",
            entityId: documentId,
            actionType: "create_reminder_task",
            contextHash: contextHash(ruleContext),
          });
          await upsertNotification(tx, {
            organizationId,
            title: "Relance à préparer",
            body: rule.name,
            href: invoiceId ? `/invoices/${invoiceId}` : `/documents/${documentId}`,
            dedupeKey: `reminder:${reminderKey}`,
          });
        }
      }
      if (actionNeedsReview(rule.actions)) status = "NEEDS_REVIEW";
      const executionKey = executionDedupeKey({
        ruleId: rule.id,
        trigger: "DOCUMENT_PROCESSED",
        entityId: documentId,
        actionType: "evaluate",
        contextHash: contextHash(ruleContext),
      });
      await tx.workflowExecution.upsert({
        where: { organizationId_dedupeKey: { organizationId, dedupeKey: executionKey } },
        create: {
          organizationId,
          ruleId: rule.id,
          documentId,
          status: "COMPLETED",
          finishedAt: new Date(),
          durationMs: Date.now() - startedRule,
          dedupeKey: executionKey,
          trigger: "DOCUMENT_PROCESSED",
          context: ruleContext as Prisma.InputJsonValue,
          result: { rule: rule.name, actions: rule.actions } as Prisma.InputJsonValue,
        },
        update: { status: "COMPLETED" },
      });
    }

    if (invoiceId && (category || reconciled)) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { category: category ?? undefined, reconciled },
      });
    }

    await tx.document.update({
      where: { id: documentId },
      data: {
        status,
        kind,
        confidence: extracted.confidence,
        amountCents: (() => {
          const keptTotal = preserved.find((field) => field.key === "amount_ttc")?.value;
          return keptTotal ? parseAmountToCents(keptTotal) : amountCents(extracted, "amount_ttc");
        })(),
        warnings,
        missingFields: extracted.missing_fields,
        processingMs: durationMs,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    await upsertAudit(tx, {
      organizationId,
      action: "document.processed",
      entityType: "Document",
      entityId: documentId,
      documentId,
      dedupeKey: `document.processed:${documentId}`,
      newValue: {
        kind,
        status,
        confidence: extracted.confidence,
        provider: "validated-schema",
        warnings,
      },
    }, true);
    await upsertNotification(tx, {
      organizationId,
      title: status === "NEEDS_REVIEW" ? "Vérification nécessaire" : "Document traité",
      body:
        status === "NEEDS_REVIEW"
          ? `Votre document « ${previous?.filename ?? "document"} » nécessite une vérification.`
          : `Document « ${previous?.filename ?? "document"} » traité avec succès.`,
      href: `/documents/${documentId}`,
      dedupeKey: `document.processing_outcome:${documentId}`,
    });
    await tx.productEvent.upsert({
      where: { organizationId_dedupeKey: { organizationId, dedupeKey: `document_processed:${documentId}` } },
      create: {
        organizationId,
        userId: previous?.uploadedById ?? null,
        name: "document_processed",
        dedupeKey: `document_processed:${documentId}`,
      },
      update: { name: "document_processed" },
    });
    if (invoiceId) await refreshInvoiceAnomalies(tx, organizationId, invoiceId);
  });
}

function actionNeedsReview(actions: RuleAction[]) {
  return actions.some((action) => action.type === "require_review");
}

async function reconcileInvoice(tx: Prisma.TransactionClient, organizationId: string, invoiceId: string) {
  const invoice = await tx.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      supplier: true,
      document: { include: { lines: { orderBy: { position: "asc" } } } },
    },
  });
  if (!invoice?.purchaseOrderNumber) return;
  const order = await tx.purchaseOrder.findFirst({
    where: {
      organizationId,
      number: { equals: invoice.purchaseOrderNumber, mode: "insensitive" },
    },
    include: { supplier: true, lines: { orderBy: { position: "asc" } } },
  });
  if (!order) return;
  const result = compareInvoiceAndOrder(
    {
      name: invoice.supplier?.name ?? "",
      purchaseOrderNumber: invoice.purchaseOrderNumber,
      totalTtcCents: parseAmountToCents(invoice.amountTtc.toString()) ?? 0,
      lines: (invoice.document?.lines ?? []).map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: parseAmountToCents(line.unitPrice.toString()) ?? 0,
      })),
    },
    {
      name: order.supplier?.name ?? "",
      purchaseOrderNumber: order.number,
      totalTtcCents: parseAmountToCents(order.amountTtc.toString()) ?? 0,
      lines: order.lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: parseAmountToCents(line.unitPrice.toString()) ?? 0,
      })),
    },
  );
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      matchStatus: result.status,
      matchedPurchaseOrderId: order.id,
      reconciled: result.status === "MATCH" ? invoice.reconciled : false,
    },
  });
  if (invoice.documentId) {
    await upsertAudit(tx, {
      organizationId,
      action: "invoice.matched",
      entityType: "Invoice",
      entityId: invoice.id,
      documentId: invoice.documentId,
      dedupeKey: `invoice.matched:${invoice.documentId}:${order.id}`,
      newValue: { status: result.status, purchaseOrderId: order.id, diffs: result.diffs } as Prisma.InputJsonValue,
    }, true);
  }
}

export async function updateDocumentField(input: {
  organizationId: string;
  userId: string;
  documentId: string;
  key: string;
  value: string;
}) {
  const field = await prisma.documentField.findFirst({
    where: {
      documentId: input.documentId,
      organizationId: input.organizationId,
      key: input.key,
      document: { deletedAt: null },
    },
  });
  if (!field) throw new Error("Champ introuvable.");
  const updated = await prisma.documentField.update({
    where: { id: field.id },
    data: {
      value: input.value,
      confidence: 1,
      source: "USER",
      validated: true,
      validatedById: input.userId,
      validatedAt: new Date(),
    },
  });
  if (input.key === "amount_ttc") {
    await prisma.document.updateMany({
      where: { id: input.documentId, organizationId: input.organizationId },
      data: { amountCents: parseAmountToCents(input.value) },
    });
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "document.field_updated",
    entityType: "DocumentField",
    entityId: field.id,
    documentId: input.documentId,
    oldValue: { key: field.key, value: field.value },
    newValue: { key: field.key, value: input.value },
  });
  await syncRecordFromFields(input.organizationId, input.documentId);
  return updated;
}

async function syncRecordFromFields(organizationId: string, documentId: string) {
  const [document, fields] = await Promise.all([
    prisma.document.findFirst({ where: { id: documentId, organizationId } }),
    prisma.documentField.findMany({ where: { documentId, organizationId } }),
  ]);
  if (!document) return;
  const value = (key: string) => fields.find((field) => field.key === key)?.value ?? null;
  if (document.kind === "INVOICE" || document.kind === "SUPPLIER_INVOICE" || document.kind === "CUSTOMER_INVOICE") {
    const dueAt = parseDate(value("due_date"));
    await prisma.invoice.updateMany({
      where: { documentId, organizationId },
      data: {
        number: value("invoice_number") ?? undefined,
        amountHt: decimal(parseAmountToCents(value("amount_ht")) ?? 0),
        amountVat: decimal(parseAmountToCents(value("amount_vat")) ?? 0),
        amountTtc: decimal(parseAmountToCents(value("amount_ttc")) ?? 0),
        currency: value("currency") ?? "EUR",
        paymentTerms: value("payment_terms"),
        purchaseOrderNumber: value("purchase_order_number"),
        issuedAt: parseDate(value("issue_date")),
        dueAt,
        status: invoiceStatus(dueAt),
      },
    });
    const supplierName = value("supplier_name");
    if (supplierName && document.kind === "SUPPLIER_INVOICE") {
      const supplier = await prisma.supplier.findFirst({
        where: { organizationId, name: { equals: supplierName, mode: "insensitive" } },
      });
      const linked = supplier
        ? supplier
        : await prisma.supplier.create({ data: { organizationId, name: supplierName } });
      await prisma.invoice.updateMany({
        where: { documentId, organizationId },
        data: { supplierId: linked.id },
      });
    }
  }
}

export async function validateDocument(input: { organizationId: string; userId: string; documentId: string }) {
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId, deletedAt: null },
    include: { fields: true },
  });
  if (!document) throw new Error("Document introuvable.");
  assertStatusTransition(document.status, "VALIDATED");
  const readiness = documentReadyToValidate({
    kind: document.kind,
    fields: document.fields.map((field) => ({ key: field.key, value: field.value })),
  });
  if (!readiness.ok) throw new Error(readiness.message);
  await prisma.documentField.updateMany({
    where: { documentId: input.documentId, organizationId: input.organizationId },
    data: { validated: true, validatedById: input.userId, validatedAt: new Date() },
  });
  await prisma.document.update({
    where: { id: document.id },
    data: { status: "VALIDATED" },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "document.validated",
    entityType: "Document",
    entityId: document.id,
    documentId: document.id,
    oldValue: { status: document.status },
    newValue: { status: "VALIDATED" },
  });
}

export async function rejectDocument(input: {
  organizationId: string;
  userId: string;
  documentId: string;
  reason: string;
}) {
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId, deletedAt: null },
  });
  if (!document) throw new Error("Document introuvable.");
  assertStatusTransition(document.status, "REJECTED");
  await prisma.document.update({
    where: { id: document.id },
    data: { status: "REJECTED", rejectionReason: input.reason, errorMessage: null },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "document.rejected",
    entityType: "Document",
    entityId: document.id,
    documentId: document.id,
    oldValue: { status: document.status },
    newValue: { status: "REJECTED", reason: input.reason },
  });
}

export async function deleteDocument(input: { organizationId: string; userId: string; documentId: string }) {
  const document = await prisma.document.findFirst({
    where: { id: input.documentId, organizationId: input.organizationId, deletedAt: null },
  });
  if (!document) throw new Error("Document introuvable.");
  if (!canDeleteDocument(document.status)) throw new Error("Ce document est encore en cours de traitement.");
  await prisma.document.update({
    where: { id: document.id },
    data: { deletedAt: new Date() },
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "document.deleted",
    entityType: "Document",
    entityId: document.id,
    documentId: document.id,
    oldValue: { filename: document.filename, status: document.status },
    newValue: { deleted: true },
  });
}

export async function linkInvoiceSupplier(input: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  supplierId: string;
}) {
  const [invoice, supplier] = await Promise.all([
    prisma.invoice.findFirst({ where: { id: input.invoiceId, organizationId: input.organizationId } }),
    prisma.supplier.findFirst({ where: { id: input.supplierId, organizationId: input.organizationId } }),
  ]);
  if (!invoice || !supplier) throw new Error("Facture ou fournisseur introuvable.");
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { supplierId: supplier.id },
  });
  if (invoice.documentId) {
    await prisma.documentField.updateMany({
      where: { documentId: invoice.documentId, organizationId: input.organizationId, key: "supplier_name" },
      data: { value: supplier.name, source: "USER", validated: true, confidence: 1 },
    });
  }
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "invoice.supplier_linked",
    entityType: "Invoice",
    entityId: invoice.id,
    documentId: invoice.documentId,
    oldValue: { supplierId: invoice.supplierId },
    newValue: { supplierId: supplier.id, supplierName: supplier.name },
  });
}

export async function linkInvoiceToOrder(input: {
  organizationId: string;
  userId: string;
  invoiceId: string;
  purchaseOrderId: string;
}) {
  const order = await prisma.purchaseOrder.findFirst({
    where: { id: input.purchaseOrderId, organizationId: input.organizationId },
  });
  const invoice = await prisma.invoice.findFirst({
    where: { id: input.invoiceId, organizationId: input.organizationId },
  });
  if (!invoice || !order) throw new Error("Facture ou commande introuvable.");
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { purchaseOrderNumber: order.number, matchedPurchaseOrderId: order.id },
  });
  if (invoice.documentId) {
    await prisma.documentField.updateMany({
      where: {
        documentId: invoice.documentId,
        organizationId: input.organizationId,
        key: "purchase_order_number",
      },
      data: { value: order.number, source: "USER", validated: true, confidence: 1 },
    });
  }
  await prisma.$transaction(async (tx) => {
    await reconcileInvoice(tx, input.organizationId, invoice.id);
    await refreshInvoiceAnomalies(tx, input.organizationId, invoice.id);
  });
  await writeAudit({
    organizationId: input.organizationId,
    userId: input.userId,
    action: "invoice.order_linked",
    entityType: "Invoice",
    entityId: invoice.id,
    documentId: invoice.documentId,
    oldValue: { purchaseOrderNumber: invoice.purchaseOrderNumber },
    newValue: { purchaseOrderNumber: order.number, purchaseOrderId: order.id },
  });
}

export async function getMatchForInvoice(organizationId: string, invoiceId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: {
      supplier: true,
      document: { include: { lines: { orderBy: { position: "asc" } } } },
      matchedPurchaseOrder: { include: { supplier: true, lines: { orderBy: { position: "asc" } } } },
    },
  });
  if (!invoice?.matchedPurchaseOrder) return null;
  const order = invoice.matchedPurchaseOrder;
  return compareInvoiceAndOrder(
    {
      name: invoice.supplier?.name ?? "",
      purchaseOrderNumber: invoice.purchaseOrderNumber,
      totalTtcCents: parseAmountToCents(invoice.amountTtc.toString()) ?? 0,
      lines: (invoice.document?.lines ?? []).map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: parseAmountToCents(line.unitPrice.toString()) ?? 0,
      })),
    },
    {
      name: order.supplier?.name ?? "",
      purchaseOrderNumber: order.number,
      totalTtcCents: parseAmountToCents(order.amountTtc.toString()) ?? 0,
      lines: order.lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity),
        unitPriceCents: parseAmountToCents(line.unitPrice.toString()) ?? 0,
      })),
    },
  );
}
