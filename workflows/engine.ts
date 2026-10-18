export type ConditionOp =
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "eq"
  | "contains"
  | "equals"
  | "not_equals"
  | "greater_than"
  | "greater_or_equal"
  | "less_than"
  | "less_or_equal"
  | "is_empty"
  | "is_not_empty";

export type Condition = {
  field: string;
  op: ConditionOp;
  value: string | number;
};

export type RuleAction =
  | { type: "require_review"; reason?: string }
  | { type: "set_category"; category: string }
  | { type: "mark_reconciled" }
  | { type: "create_reminder_task" }
  | { type: "auto_validate" }
  | { type: "request_approval"; role?: "MANAGER" | "OWNER" }
  | { type: "create_notification"; title?: string; body?: string }
  | { type: "create_anomaly"; title?: string }
  | { type: "send_email" }
  | { type: "export" };

export type RuleDefinition = {
  id: string;
  name: string;
  trigger: string;
  conditions: { all: Condition[] };
  actions: RuleAction[];
};

export type RuleContext = Record<string, string | number | boolean | null>;

function compare(condition: Condition, context: RuleContext) {
  const current = context[condition.field];
  const op = condition.op;
  if (op === "is_empty") return current === undefined || current === null || current === "";
  if (op === "is_not_empty") return current !== undefined && current !== null && current !== "";
  if (current === undefined || current === null) return false;
  if (op === "contains") return String(current).toLowerCase().includes(String(condition.value).toLowerCase());
  if (op === "eq" || op === "equals") return String(current).toLowerCase() === String(condition.value).toLowerCase();
  if (op === "not_equals") return String(current).toLowerCase() !== String(condition.value).toLowerCase();
  const left = typeof current === "number" ? current : Number(current);
  const right = typeof condition.value === "number" ? condition.value : Number(condition.value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  if (op === "gt" || op === "greater_than") return left > right;
  if (op === "gte" || op === "greater_or_equal") return left >= right;
  if (op === "lt" || op === "less_than") return left < right;
  return left <= right;
}

export function evaluateRules(rules: RuleDefinition[], trigger: string, context: RuleContext) {
  return rules.filter(
    (rule) => rule.trigger === trigger && rule.conditions.all.every((condition) => compare(condition, context)),
  );
}
