import { describe, expect, it } from "vitest";
import { compareInvoiceAndOrder } from "@/services/matching";

const order = {
  name: "Aciers Durand",
  purchaseOrderNumber: "BC-2026-0142",
  totalTtcCents: 120000,
  lines: [{ description: "Tole acier", quantity: 10, unitPriceCents: 10000 }],
};

describe("invoice matching", () => {
  it("returns MATCH and still lists every compared field", () => {
    const result = compareInvoiceAndOrder(
      {
        name: "Aciers Durand",
        purchaseOrderNumber: "BC-2026-0142",
        totalTtcCents: 120000,
        lines: [{ description: "Tole acier", quantity: 10, unitPriceCents: 10000 }],
      },
      order,
    );
    expect(result.status).toBe("MATCH");
    expect(result.diffs.length).toBeGreaterThan(3);
    expect(result.diffs.every((diff) => diff.equal)).toBe(true);
  });

  it("returns PARTIAL_MATCH when the supplier and order match but the price does not", () => {
    const result = compareInvoiceAndOrder(
      {
        ...order,
        totalTtcCents: 132000,
        lines: [{ description: "Tole acier", quantity: 10, unitPriceCents: 11000 }],
      },
      order,
    );
    expect(result.status).toBe("PARTIAL_MATCH");
    expect(result.diffs.find((diff) => diff.field === "total")?.equal).toBe(false);
  });

  it("returns MISMATCH when the supplier differs and does not hide the other diffs", () => {
    const result = compareInvoiceAndOrder({ ...order, name: "Transport Loire" }, order);
    expect(result.status).toBe("MISMATCH");
    expect(result.diffs.find((diff) => diff.field === "supplier")?.equal).toBe(false);
    expect(result.diffs.find((diff) => diff.field === "total")).toBeDefined();
  });
});
