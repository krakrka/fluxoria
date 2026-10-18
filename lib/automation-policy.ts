export const DEFAULT_AUTOMATION_SETTINGS = {
  autoValidateCents: 100_000,
  managerApprovalCents: 500_000,
  amountTolerancePercent: 1,
  amountToleranceCents: 100,
} as const;

export type AutomationSettings = {
  autoValidateCents: number;
  managerApprovalCents: number;
  amountTolerancePercent: number;
  amountToleranceCents: number;
};

export function readAutomationSettings(value: unknown): AutomationSettings {
  const settings = (value ?? {}) as Partial<AutomationSettings>;
  return {
    autoValidateCents: numberOr(settings.autoValidateCents, DEFAULT_AUTOMATION_SETTINGS.autoValidateCents),
    managerApprovalCents: numberOr(settings.managerApprovalCents, DEFAULT_AUTOMATION_SETTINGS.managerApprovalCents),
    amountTolerancePercent: numberOr(settings.amountTolerancePercent, DEFAULT_AUTOMATION_SETTINGS.amountTolerancePercent),
    amountToleranceCents: numberOr(settings.amountToleranceCents, DEFAULT_AUTOMATION_SETTINGS.amountToleranceCents),
  };
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export type ApprovalLevel = "AUTO" | "MANAGER" | "OWNER";

export function approvalLevelForAmount(totalCents: number, settings: AutomationSettings): ApprovalLevel {
  if (totalCents < settings.autoValidateCents) return "AUTO";
  if (totalCents < settings.managerApprovalCents) return "MANAGER";
  return "OWNER";
}

export function canAutoValidate(input: {
  totalCents: number;
  matchScore: number;
  anomalyCount: number;
  confidencePercent: number;
  settings: AutomationSettings;
}) {
  return (
    input.totalCents < input.settings.autoValidateCents &&
    input.matchScore >= 95 &&
    input.anomalyCount === 0 &&
    input.confidencePercent >= 90
  );
}

export function autoValidationReasons(input: {
  confidencePercent: number;
  matchScore: number;
  amountDeltaCents: number;
  anomalyCount: number;
  ruleName: string;
}) {
  return [
    `Confiance extraction : ${input.confidencePercent} %`,
    `Rapprochement commande : ${input.matchScore} %`,
    `Écart montant : ${(input.amountDeltaCents / 100).toFixed(2)} €`,
    input.anomalyCount === 0 ? "Aucune anomalie ouverte" : `${input.anomalyCount} anomalie(s) ouverte(s)`,
    `Règle appliquée : « ${input.ruleName} »`,
  ];
}
