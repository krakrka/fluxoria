import { describe, expect, it } from "vitest";
import { documentReadyToValidate } from "@/lib/document-readiness";

const fields = [
  { key: "invoice_number", value: "FAC-1" },
  { key: "issue_date", value: "2026-09-01" },
  { key: "supplier_name", value: "Aciers Durand" },
  { key: "amount_ht", value: "100.00" },
  { key: "amount_vat", value: "20.00" },
  { key: "amount_ttc", value: "120.00" },
];

describe("document readiness", () => {
  it("accepts a consistent invoice and rejects a broken total", () => {
    expect(documentReadyToValidate({ kind: "SUPPLIER_INVOICE", fields }).ok).toBe(true);
    const broken = fields.map((field) => (field.key === "amount_ttc" ? { ...field, value: "200.00" } : field));
    expect(documentReadyToValidate({ kind: "SUPPLIER_INVOICE", fields: broken })).toMatchObject({
      ok: false,
    });
  });
});
