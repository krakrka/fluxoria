import { describe, expect, it } from "vitest";
import { findValidSirens, isValidSiren, isValidSiret, vatFromSiren } from "@/lib/siren";
import { buildSimplePdf } from "@/services/pdf";

describe("siren", () => {
  it("checks the Luhn key and builds a VAT number", () => {
    const [siren] = findValidSirens(1);
    expect(isValidSiren(siren)).toBe(true);
    expect(isValidSiren("123456789")).toBe(false);
    expect(vatFromSiren(siren)).toMatch(/^FR\d{2}\d{9}$/);
    expect(isValidSiret("12345")).toBe(false);
  });
});

describe("pdf", () => {
  it("builds a readable header", () => {
    const pdf = buildSimplePdf(["Facture FAC-2026-00421", "Total 1245.50 EUR"]);
    expect(pdf.subarray(0, 5).toString("utf8")).toBe("%PDF-");
  });
});
