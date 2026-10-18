import { z } from "zod";

export const documentKindSchema = z.enum([
  "INVOICE",
  "SUPPLIER_INVOICE",
  "CUSTOMER_INVOICE",
  "PURCHASE_ORDER",
  "DELIVERY_NOTE",
  "QUOTE",
  "TRANSPORT_DOCUMENT",
  "CREDIT_NOTE",
  "RECEIPT",
  "QUALITY_DOCUMENT",
  "CMR",
  "INTERVENTION_REPORT",
  "OTHER",
  "UNKNOWN",
]);

export const extractedFieldSchema = z.object({
  value: z.union([z.string(), z.number(), z.null()]),
  confidence: z.number().min(0).max(1),
  validated: z.boolean().default(false),
  source: z.enum(["ai", "user", "system"]).default("ai"),
  page: z.number().int().min(1).nullable().optional(),
  zone: z.string().max(80).nullable().optional(),
  source_text: z.string().max(240).nullable().optional(),
});

export const extractedLineSchema = z.object({
  description: extractedFieldSchema,
  quantity: extractedFieldSchema,
  unit_price: extractedFieldSchema,
  vat_rate: extractedFieldSchema,
  amount_ht: extractedFieldSchema,
});

export const extractedDocumentSchema = z
  .object({
    detected_document_type: documentKindSchema,
    confidence: z.number().min(0).max(1),
    warnings: z.array(z.string()),
    missing_fields: z.array(z.string()),
    fields: z.record(extractedFieldSchema),
    lines: z.array(extractedLineSchema),
  })
  .strict();

export type ExtractedField = z.infer<typeof extractedFieldSchema>;
export type ExtractedDocument = z.infer<typeof extractedDocumentSchema>;

export function fieldText(field: ExtractedField | undefined) {
  if (!field || field.value === null || field.value === undefined) return null;
  return String(field.value);
}
