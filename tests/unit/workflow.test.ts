import { describe, expect, it } from "vitest";
import { evaluateRules } from "@/workflows/engine";

const rules = [
  {
    id: "high",
    name: "Montant élevé",
    trigger: "DOCUMENT_PROCESSED",
    conditions: { all: [{ field: "amountTtc", op: "gt" as const, value: 5000 }] },
    actions: [{ type: "require_review" as const, reason: "Montant" }],
  },
  {
    id: "supplier",
    name: "Catégorie acier",
    trigger: "DOCUMENT_PROCESSED",
    conditions: { all: [{ field: "supplierName", op: "eq" as const, value: "Aciers Durand" }] },
    actions: [{ type: "set_category" as const, category: "Matières premières" }],
  },
  {
    id: "overdue",
    name: "Relance",
    trigger: "INVOICE_OVERDUE",
    conditions: { all: [{ field: "isOverdue", op: "eq" as const, value: "true" }] },
    actions: [{ type: "create_reminder_task" as const }],
  },
];

describe("workflow engine", () => {
  it("asks for review above 5000 euros", () => {
    const matched = evaluateRules(rules, "DOCUMENT_PROCESSED", { amountTtc: 5400, supplierName: "Bureau Plus" });
    expect(matched.map((rule) => rule.id)).toEqual(["high"]);
  });

  it("applies a supplier category without matching the amount rule", () => {
    const matched = evaluateRules(rules, "DOCUMENT_PROCESSED", { amountTtc: 200, supplierName: "Aciers Durand" });
    expect(matched.map((rule) => rule.id)).toEqual(["supplier"]);
  });

  it("ignores rules for another trigger", () => {
    const matched = evaluateRules(rules, "INVOICE_OVERDUE", { isOverdue: true, amountTtc: 9000 });
    expect(matched.map((rule) => rule.id)).toEqual(["overdue"]);
  });
});
