import { describe, expect, it } from "vitest";
import { approvalLevelForAmount, canAutoValidate, DEFAULT_AUTOMATION_SETTINGS } from "@/lib/automation-policy";
import { evaluateRules } from "@/workflows/engine";

const settings = { ...DEFAULT_AUTOMATION_SETTINGS };

describe("approval thresholds", () => {
  it("keeps 999.99 euros on automatic validation", () => {
    expect(approvalLevelForAmount(99_999, settings)).toBe("AUTO");
  });

  it("sends 1000 euros to a manager", () => {
    expect(approvalLevelForAmount(100_000, settings)).toBe("MANAGER");
  });

  it("sends 4999 euros to a manager", () => {
    expect(approvalLevelForAmount(499_900, settings)).toBe("MANAGER");
  });

  it("sends 5000 euros to the owner", () => {
    expect(approvalLevelForAmount(500_000, settings)).toBe("OWNER");
  });

  it("sends 5000.01 euros to the owner", () => {
    expect(approvalLevelForAmount(500_001, settings)).toBe("OWNER");
  });
});

describe("auto validation guards", () => {
  it("accepts a safe invoice", () => {
    expect(canAutoValidate({ totalCents: 70_000, matchScore: 98, anomalyCount: 0, confidencePercent: 97, settings })).toBe(true);
  });

  it("refuses an anomaly, a weak match or a large amount", () => {
    expect(canAutoValidate({ totalCents: 70_000, matchScore: 98, anomalyCount: 1, confidencePercent: 97, settings })).toBe(false);
    expect(canAutoValidate({ totalCents: 70_000, matchScore: 80, anomalyCount: 0, confidencePercent: 97, settings })).toBe(false);
    expect(canAutoValidate({ totalCents: 250_000, matchScore: 100, anomalyCount: 0, confidencePercent: 99, settings })).toBe(false);
  });
});

describe("condition operators", () => {
  const rule = {
    id: "r",
    name: "Seuil",
    trigger: "invoice.created",
    conditions: {
      all: [
        { field: "invoice.total", op: "greater_or_equal" as const, value: 1000 },
        { field: "invoice.total", op: "less_than" as const, value: 5000 },
      ],
    },
    actions: [{ type: "request_approval" as const, role: "MANAGER" as const }],
  };

  it("matches 1000 and 4999 and skips 5000", () => {
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 1000 })).toHaveLength(1);
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 4999 })).toHaveLength(1);
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 5000 })).toHaveLength(0);
    expect(evaluateRules([rule], "invoice.created", { "invoice.total": 5000.01 })).toHaveLength(0);
  });

  it("supports equals, contains and empty checks", () => {
    expect(evaluateRules([{ ...rule, conditions: { all: [{ field: "invoice.currency", op: "equals", value: "EUR" }] } }], "invoice.created", { "invoice.currency": "eur" })).toHaveLength(1);
    expect(evaluateRules([{ ...rule, conditions: { all: [{ field: "invoice.supplier", op: "contains", value: "durand" }] } }], "invoice.created", { "invoice.supplier": "Aciers Durand" })).toHaveLength(1);
    expect(evaluateRules([{ ...rule, conditions: { all: [{ field: "invoice.supplier", op: "not_equals", value: "Autre" }] } }], "invoice.created", { "invoice.supplier": "Durand" })).toHaveLength(1);
    expect(evaluateRules([{ ...rule, conditions: { all: [{ field: "missing", op: "is_empty", value: "" }] } }], "invoice.created", {})).toHaveLength(1);
    expect(evaluateRules([{ ...rule, conditions: { all: [{ field: "invoice.supplier", op: "is_not_empty", value: "" }] } }], "invoice.created", { "invoice.supplier": "Durand" })).toHaveLength(1);
  });
});
