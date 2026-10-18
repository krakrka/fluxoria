export const ROI_DISCLAIMER =
  "Estimation opérationnelle à partir des hypothèses de l'organisation. Ce n'est pas une économie comptable réelle.";

export type RoiSettings = {
  hourlyCostCents: number;
  manualMinutes: number;
  automatedMinutes: number;
};

export function readRoiSettings(value: unknown): RoiSettings {
  const settings = (value ?? {}) as Record<string, unknown>;
  const manualMinutes = numberOr(settings.manualMinutes, numberOr(settings.minutesPerDocument, 12));
  const automatedMinutes = Math.min(numberOr(settings.automatedMinutes, 4), manualMinutes);
  return {
    hourlyCostCents: numberOr(settings.hourlyCostCents, 3500),
    manualMinutes,
    automatedMinutes,
  };
}

export function isDemoOrganization(value: unknown) {
  return Boolean((value as { demo?: boolean } | null)?.demo);
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function estimateOperationalRoi(input: { autoValidated: number; processed: number; settings: RoiSettings }) {
  const savedPerInvoice = Math.max(0, input.settings.manualMinutes - input.settings.automatedMinutes);
  const savedMinutes = input.autoValidated * savedPerInvoice;
  const savedCents = Math.round((savedMinutes * input.settings.hourlyCostCents) / 60);
  const automationRate = input.processed === 0 ? null : input.autoValidated / input.processed;
  return { savedPerInvoice, savedMinutes, savedHours: savedMinutes / 60, savedCents, automationRate };
}
