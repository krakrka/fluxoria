export function eurosToCents(value: number) {
  return Math.round(value * 100);
}

export function centsToEuros(cents: number) {
  return cents / 100;
}

export function parseAmountToCents(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value)
    .replace(/\s/g, "")
    .replace("€", "")
    .replace(",", ".");
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * 100);
}

export function formatEurFromCents(cents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

export function decimalToCents(value: { toString(): string } | number | string) {
  const parsed = parseAmountToCents(
    typeof value === "number" ? value : value.toString(),
  );
  return parsed ?? 0;
}

/** Estimated time saved. Assumptions are shown in the product, never as measured savings. */
export function estimateSavingsCents(
  processedCount: number,
  minutesPerDocument = 12,
  hourlyCents = 3500,
) {
  if (processedCount <= 0) return 0;
  return Math.round(processedCount * minutesPerDocument * (hourlyCents / 60));
}
