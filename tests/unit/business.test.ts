import { describe, expect, it } from "vitest";
import { findDuplicate } from "@/lib/duplicates";
import { amountsWithinTolerance, quantitiesWithinTolerance } from "@/lib/match-tolerances";
import { companyKey, matchParty, sameCompanyName } from "@/lib/party-match";
import { compareInvoiceAndOrder } from "@/services/matching";

describe("party matching", () => {
  it("treats legal form variants as the same company name", () => {
    expect(sameCompanyName("ACME INDUSTRIE SAS", "Acme Industrie")).toBe(true);
    expect(sameCompanyName("ACME INDUSTRIE S.A.S.", "Acme Industrie")).toBe(true);
    expect(companyKey("Masa")).toBe("masa");
  });

  it("prefers SIREN, then VAT, then normalized name", () => {
    const parties = [
      { id: "siren", name: "Autre", siren: "552100554", vatNumber: null },
      { id: "vat", name: "Autre TVA", siren: null, vatNumber: "FR44552100554" },
      { id: "name", name: "Acme Industrie SAS", siren: null, vatNumber: null },
    ];
    expect(matchParty(parties, { name: "Inconnu", siren: "552100554", vatNumber: null })?.id).toBe("siren");
    expect(matchParty(parties, { name: "Inconnu", siren: null, vatNumber: "FR44552100554" })?.id).toBe("vat");
    expect(matchParty(parties, { name: "Acme Industrie", siren: null, vatNumber: null })?.id).toBe("name");
  });
});

describe("duplicates and tolerances", () => {
  it("detects the same supplier and invoice number", () => {
    const result = findDuplicate(
      { id: "b", number: "FAC-1", issuedAt: new Date("2026-09-01"), amountCents: 1000, supplierId: "s" },
      [{ id: "a", number: "fac-1", issuedAt: new Date("2026-08-01"), amountCents: 2000, supplierId: "s" }],
    );
    expect(result?.reason).toBe("number");
  });

  it("detects the same supplier, day and amount", () => {
    const result = findDuplicate(
      { id: "b", number: "FAC-2", issuedAt: new Date("2026-09-01T10:00:00Z"), amountCents: 1500, supplierId: "s" },
      [{ id: "a", number: "FAC-9", issuedAt: new Date("2026-09-01T18:00:00Z"), amountCents: 1500, supplierId: "s" }],
    );
    expect(result?.reason).toBe("amount");
  });

  it("accepts one percent or one euro and rejects a quantity change", () => {
    expect(amountsWithinTolerance(10000, 10050)).toBe(true);
    expect(amountsWithinTolerance(100000, 112000)).toBe(false);
    expect(quantitiesWithinTolerance(2, 2)).toBe(true);
    expect(quantitiesWithinTolerance(2, 3)).toBe(false);
  });
});

describe("currency mismatch", () => {
  it("fails the currency check without hiding the amount", () => {
    const order = {
      name: "Aciers Durand",
      purchaseOrderNumber: "BC-1",
      totalTtcCents: 12000,
      currency: "EUR",
      lines: [],
    };
    const result = compareInvoiceAndOrder({ ...order, currency: "USD" }, order);
    expect(result.checks.find((check) => check.key === "currency")?.state).toBe("fail");
    expect(result.score).toBeLessThan(100);
  });
});
