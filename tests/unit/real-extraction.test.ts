import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { estimateCostMicros } from "@/ai/models";
import { setOcrEngine } from "@/ai/ocr";
import { needsHumanReview } from "@/ai/review";
import { extractedDocumentSchema } from "@/ai/schema";
import { runExtraction, type ExtractionModelClient } from "@/ai/strategy";
import {
  complexInvoice,
  deliveryNote,
  foreignCurrencyInvoice,
  invoiceImage,
  lowQualityInvoice,
  manyLinesInvoice,
  multiPageInvoice,
  normalInvoice,
  normalInvoiceText,
  purchaseOrder,
  scannedPdf,
  unknownSupplierInvoice,
} from "@/tests/fixtures/invoices";

function loadEnv() {
  if (process.env.DATABASE_URL && process.env.AUTH_SECRET) return;
  const text = readFileSync(".env", "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnv();

const prisma = process.env.DATABASE_URL ? new PrismaClient() : null;

const modelDocument = extractedDocumentSchema.parse({
  detected_document_type: "SUPPLIER_INVOICE",
  confidence: 0.93,
  warnings: [],
  missing_fields: [],
  fields: {
    invoice_number: { value: "SCAN-1", confidence: 0.93 },
    issue_date: { value: "2026-03-12", confidence: 0.93 },
    supplier_name: { value: "Atelier Scan", confidence: 0.93 },
    customer_name: { value: "Atlas Industrie", confidence: 0.93 },
    amount_ttc: { value: "10.00", confidence: 0.93 },
  },
  lines: [],
});

function spyModel() {
  const calls: Array<{ kind: string; text?: string; bytes?: number; mime?: string }> = [];
  const model: ExtractionModelClient = {
    provider: "openai",
    async completeText(input) {
      calls.push({ kind: "text", text: input.text });
      return { json: modelDocument, inputTokens: 1000, outputTokens: 100, model: input.model };
    },
    async completeImage(input) {
      calls.push({ kind: "image", bytes: input.bytes.byteLength, mime: input.mimeType });
      return { json: modelDocument, inputTokens: 200, outputTokens: 80, model: "gpt-4o" };
    },
  };
  return { model, calls };
}

const options = (model: ExtractionModelClient | null, mock = false) => ({
  mock,
  model,
  textModel: "gpt-4o-mini",
  visionModel: "gpt-4o",
});

describe("real document extraction", () => {
  afterEach(() => setOcrEngine(null));

  it("reads a normal invoice from the PDF text and does not call a model", async () => {
    const { model, calls } = spyModel();
    const file = normalInvoice();
    const result = await runExtraction(file, options(model));
    expect(calls).toHaveLength(0);
    expect(result.usage).toMatchObject({ strategy: "native_text", model: "fluxora-text", inputTokens: 0, estimatedCostMicros: 0 });
    expect(result.document.detected_document_type).toBe("SUPPLIER_INVOICE");
    expect(result.document.fields.invoice_number).toMatchObject({ value: "FAC-2026-100", page: 1, zone: "En-tête" });
    expect(result.document.fields.amount_ttc?.value).toBe("120.00");
    expect(result.document.fields.currency?.value).toBe("EUR");
    expect(result.document.fields.purchase_order_number?.value).toBe("BC-2026-0142");
    expect(result.document.lines).toHaveLength(1);
    expect(needsHumanReview(result.document)).toBe(false);
  });

  it("reads a complex invoice, a foreign currency, many lines and an unknown supplier", async () => {
    const complex = await runExtraction(complexInvoice(), options(null, true));
    expect(complex.document.lines.map((line) => line.vat_rate.value)).toEqual(["20", "5.5"]);
    expect(complex.document.fields.payment_terms?.value).toBe("30 jours");
    expect(complex.document.fields.amount_ttc?.value).toBe("381.10");
    expect(needsHumanReview(complex.document)).toBe(false);

    const foreign = await runExtraction(foreignCurrencyInvoice(), options(null, true));
    expect(foreign.document.fields.currency?.value).toBe("USD");
    expect(foreign.document.fields.amount_ttc?.value).toBe("100.00");
    expect(needsHumanReview(foreign.document)).toBe(false);

    const many = await runExtraction(manyLinesInvoice(), options(null, true));
    expect(many.document.lines).toHaveLength(12);
    expect(many.document.fields.amount_ttc?.value).toBe("144.00");

    const unknown = await runExtraction(unknownSupplierInvoice(), options(null, true));
    expect(unknown.document.fields.supplier_name?.value).toBe("Nordic Components Oy");
    expect(unknown.document.missing_fields).toContain("siren");
    expect(needsHumanReview(unknown.document)).toBe(true);
  });

  it("keeps a low-quality invoice for review and can ask a model for the text only", async () => {
    const local = await runExtraction(lowQualityInvoice(), options(null, true));
    expect(local.document.fields.amount_ttc?.value).toBeNull();
    expect(local.document.fields.amount_ttc?.source_text).toContain("12O,OO");
    expect(local.document.fields.supplier_name?.confidence).toBeLessThan(0.7);
    expect(needsHumanReview(local.document)).toBe(true);

    const { model, calls } = spyModel();
    const refined = await runExtraction(lowQualityInvoice(), options(model, false));
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toContain("F???");
    expect(calls[0]?.text).not.toContain("%PDF");
    expect(refined.usage.strategy).toBe("model_text");
    expect(refined.usage.estimatedCostMicros).toBe(estimateCostMicros("gpt-4o-mini", 1000, 100));
    expect(refined.document.fields.invoice_number?.value).toBe("SCAN-1");
  });

  it("reads several pages, a delivery note and a purchase order", async () => {
    const pages = await runExtraction(multiPageInvoice(), options(null, true));
    expect(pages.document.fields.invoice_number?.page).toBe(1);
    expect(pages.document.fields.amount_ttc?.page).toBe(2);
    expect(pages.document.fields.amount_ttc?.zone).toBe("Totaux");

    const note = await runExtraction(deliveryNote(), options(null, true));
    expect(note.document.detected_document_type).toBe("DELIVERY_NOTE");
    expect(note.document.fields.invoice_number?.value).toBe("BL-2026-3");

    const order = await runExtraction(purchaseOrder(), options(null, true));
    expect(order.document.detected_document_type).toBe("PURCHASE_ORDER");
    expect(order.document.fields.invoice_number?.value).toBe("BC-2026-77");
  });

  it("uses OCR before vision, and never sends a textless PDF to the model", async () => {
    const { model, calls } = spyModel();
    setOcrEngine({
      async recognize() {
        return [{ page: 1, text: normalInvoiceText() }];
      },
    });
    const scanned = await runExtraction(scannedPdf(), options(model, false));
    expect(calls).toHaveLength(0);
    expect(scanned.usage.strategy).toBe("ocr");
    expect(scanned.document.fields.invoice_number?.value).toBe("FAC-2026-100");

    setOcrEngine(null);
    const blank = invoiceImage("");
    const image = await runExtraction(blank, options(model, false));
    expect(calls.map((call) => call.kind)).toEqual(["image"]);
    expect(calls[0]?.mime).toBe("image/png");
    expect(calls[0]?.bytes).toBe(blank.bytes.byteLength);
    expect(image.usage.strategy).toBe("vision");
    expect(image.usage.model).toBe("gpt-4o");

    const blocked = spyModel();
    await expect(runExtraction(scannedPdf(), options(blocked.model, false))).rejects.toThrow(/fichier original est conservé/);
    expect(blocked.calls).toHaveLength(0);
  });

  it("prices a model call in micros and keeps the local result when the model fails", async () => {
    expect(estimateCostMicros("gpt-4o-mini", 1000, 0)).toBe(150);
    expect(estimateCostMicros("fluxora-text", 1000, 1000)).toBe(0);
    const model: ExtractionModelClient = {
      provider: "openai",
      async completeText() {
        throw new Error("indisponible");
      },
      async completeImage() {
        throw new Error("indisponible");
      },
    };
    const result = await runExtraction(lowQualityInvoice(), options(model, false));
    expect(result.usage.strategy).toBe("native_text");
    expect(result.document.warnings.join(" ")).toMatch(/modèle de secours/);
    expect(result.document.fields.invoice_number?.value).toBe("F???");
  });
});

describe("extraction persistence", () => {
  const organizationIds: string[] = [];

  afterAll(async () => {
    if (!prisma) return;
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
    await prisma.$disconnect();
  });

  it("stores provenance and a usage row, and keeps the original file when extraction fails", async () => {
    if (!prisma) return;
    const { getStorage } = await import("@/services/storage");
    const { processDocument } = await import("@/services/documents");
    const organization = await prisma.organization.create({ data: { name: `Extraction ${Date.now()}` } });
    organizationIds.push(organization.id);
    const storage = getStorage();

    const file = normalInvoice();
    const document = await prisma.document.create({
      data: {
        organizationId: organization.id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.bytes.byteLength,
        storageKey: "pending",
      },
    });
    const storageKey = `organizations/${organization.id}/documents/${document.id}/original`;
    await storage.put(storageKey, file.bytes);
    await prisma.document.update({ where: { id: document.id }, data: { storageKey } });

    await processDocument(document.id, { organizationId: organization.id });
    const processed = await prisma.document.findFirst({
      where: { id: document.id },
      include: { fields: true, invoice: true },
    });
    const usage = await prisma.aiUsage.findFirst({ where: { documentId: document.id, outcome: "success" } });
    expect(processed?.status).toBe("PROCESSED");
    expect(processed?.invoice?.status).not.toBe("VALIDATED");
    expect(processed?.invoice?.currency).toBe("EUR");
    expect(processed?.fields.find((field) => field.key === "invoice_number")).toMatchObject({
      value: "FAC-2026-100",
      page: 1,
      zone: "En-tête",
    });
    expect(processed?.fields.find((field) => field.key === "amount_ttc")?.sourceText).toContain("120.00");
    expect(usage).toMatchObject({ strategy: "native_text", model: "fluxora-text", provider: "fluxora" });
    expect((await storage.get(storageKey)).equals(file.bytes)).toBe(true);

    const brokenBytes = Buffer.from("%PDF-1.4\n%%EOF");
    const broken = await prisma.document.create({
      data: {
        organizationId: organization.id,
        filename: "facture-erreur.pdf",
        mimeType: "application/pdf",
        sizeBytes: brokenBytes.byteLength,
        storageKey: "pending",
        status: "RECEIVED",
      },
    });
    const brokenKey = `organizations/${organization.id}/documents/${broken.id}/original`;
    await storage.put(brokenKey, brokenBytes);
    await prisma.document.update({ where: { id: broken.id }, data: { storageKey: brokenKey } });
    await expect(processDocument(broken.id, { organizationId: organization.id, finalAttempt: true })).rejects.toThrow(/illisible/);
    const failed = await prisma.document.findFirst({ where: { id: broken.id } });
    const failure = await prisma.aiUsage.findFirst({ where: { documentId: broken.id, outcome: "failure" } });
    expect(failed?.status).toBe("ERROR");
    expect(failure?.strategy).toBe("unavailable");
    expect((await storage.get(brokenKey)).equals(brokenBytes)).toBe(true);
  });
});
