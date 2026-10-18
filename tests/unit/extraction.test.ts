import { describe, expect, it } from "vitest";
import { extractedDocumentSchema } from "@/ai/schema";
import { needsHumanReview } from "@/ai/review";
import { MockAIProvider } from "@/ai/mock-provider";

const field = (value: string | null, confidence: number) => ({
  value,
  confidence,
  validated: false,
  source: "ai" as const,
});

function sample(confidence = 0.96) {
  return {
    detected_document_type: "SUPPLIER_INVOICE",
    confidence,
    warnings: [],
    missing_fields: [],
    fields: {
      invoice_number: field("FAC-2026-00421", 0.97),
      issue_date: field("2026-09-12", 0.95),
      supplier_name: field("Aciers Durand", 0.93),
      customer_name: field("Atlas Industrie", 0.93),
      amount_ttc: field("1245.50", confidence),
    },
    lines: [],
  };
}

describe("extraction schema", () => {
  it("accepts a structured extraction and rejects untrusted shapes", () => {
    expect(extractedDocumentSchema.parse(sample())).toMatchObject({
      fields: { invoice_number: { value: "FAC-2026-00421", validated: false } },
    });
    expect(extractedDocumentSchema.safeParse({ ...sample(), extra: true }).success).toBe(false);
    expect(extractedDocumentSchema.safeParse({ ...sample(), confidence: 2 }).success).toBe(false);
  });

  it("asks for review when confidence is low or a warning exists", () => {
    expect(needsHumanReview(extractedDocumentSchema.parse(sample(0.62)))).toBe(true);
    expect(needsHumanReview(extractedDocumentSchema.parse({ ...sample(), warnings: ["Ambigu"] }))).toBe(true);
    expect(needsHumanReview(extractedDocumentSchema.parse(sample()))).toBe(false);
  });
});

describe("mock provider", () => {
  const provider = new MockAIProvider();

  it("returns schema-valid data and fails closed on an unreadable file", async () => {
    const extracted = await provider.extractDocument({
      filename: "facture-fournisseur.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF"),
    });
    expect(extracted.detected_document_type).toBe("SUPPLIER_INVOICE");
    expect(extracted.fields.invoice_number?.validated).toBe(false);
    const quote = await provider.extractDocument({
      filename: "devis-atelier.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-devis"),
    });
    expect(quote.detected_document_type).toBe("QUOTE");
    const otherBytes = await provider.extractDocument({
      filename: "facture-b.pdf",
      mimeType: "application/pdf",
      bytes: Buffer.from("%PDF-autre-contenu-999"),
    });
    expect(otherBytes.fields.amount_ttc?.value).not.toBe(extracted.fields.amount_ttc?.value);
    await expect(
      provider.extractDocument({ filename: "facture-erreur.pdf", mimeType: "application/pdf", bytes: Buffer.from("%PDF") }),
    ).rejects.toThrow(/illisible/);
  });
});
