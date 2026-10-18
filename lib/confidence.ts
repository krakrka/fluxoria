export const DEFAULT_CONFIDENCE_THRESHOLDS = {
  high: 90,
  medium: 70,
};

export type ConfidenceThresholds = {
  high: number;
  medium: number;
};

export function readConfidenceThresholds(value: unknown): ConfidenceThresholds {
  const settings = (value ?? {}) as { confidenceHigh?: unknown; confidenceMedium?: unknown };
  const high = typeof settings.confidenceHigh === "number" ? settings.confidenceHigh : DEFAULT_CONFIDENCE_THRESHOLDS.high;
  const medium = typeof settings.confidenceMedium === "number" ? settings.confidenceMedium : DEFAULT_CONFIDENCE_THRESHOLDS.medium;
  if (high <= medium || high > 100 || medium < 0) return { ...DEFAULT_CONFIDENCE_THRESHOLDS };
  return { high, medium };
}

export function toConfidencePercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const scaled = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

export function confidenceBand(percent: number, thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
  if (percent >= thresholds.high) return "high" as const;
  if (percent >= thresholds.medium) return "medium" as const;
  return "low" as const;
}

export const CONFIDENCE_BAND_LABEL = {
  high: "Haute confiance",
  medium: "Confiance moyenne",
  low: "Faible confiance",
} as const;

export const CONFIDENCE_DISCLAIMER = "Niveau de confiance estimé par Fluxora.";
