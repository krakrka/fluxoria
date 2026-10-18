import { describe, expect, it } from "vitest";
import { confidenceBand, toConfidencePercent } from "@/lib/confidence";

describe("confidence", () => {
  it("normalizes a ratio to a percentage and bands it", () => {
    expect(toConfidencePercent(0.974)).toBe(97);
    expect(toConfidencePercent(97)).toBe(97);
    expect(confidenceBand(97)).toBe("high");
    expect(confidenceBand(80)).toBe("medium");
    expect(confidenceBand(54)).toBe("low");
  });

  it("accepts configurable thresholds", () => {
    expect(confidenceBand(85, { high: 95, medium: 80 })).toBe("medium");
  });
});
