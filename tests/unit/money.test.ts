import { describe, expect, it } from "vitest";
import { estimateSavingsCents, eurosToCents, parseAmountToCents } from "@/lib/money";

describe("money", () => {
  it("converts euros to cents without floating drift", () => {
    expect(eurosToCents(10.1)).toBe(1010);
    expect(eurosToCents(0.1 + 0.2)).toBe(30);
  });

  it("parses French amounts", () => {
    expect(parseAmountToCents("1 245,50 €")).toBe(124550);
    expect(parseAmountToCents("")).toBeNull();
  });

  it("estimates savings from an explicit assumption", () => {
    expect(estimateSavingsCents(0)).toBe(0);
    expect(estimateSavingsCents(2, 12, 3500)).toBe(1400);
  });
});
