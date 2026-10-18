export const MATCH_TOLERANCES = {
  amountTolerancePercent: 0.01,
  amountToleranceCents: 100,
  quantityTolerance: 0,
} as const;

export function amountsWithinTolerance(
  leftCents: number,
  rightCents: number,
  tolerances?: { amountTolerancePercent: number; amountToleranceCents: number },
) {
  const delta = Math.abs(leftCents - rightCents);
  const base = Math.max(Math.abs(leftCents), Math.abs(rightCents));
  const percent = tolerances ? tolerances.amountTolerancePercent / 100 : MATCH_TOLERANCES.amountTolerancePercent;
  const cents = tolerances?.amountToleranceCents ?? MATCH_TOLERANCES.amountToleranceCents;
  const allowed = Math.max(cents, Math.round(base * percent));
  return delta <= allowed;
}

export function quantitiesWithinTolerance(left: number, right: number) {
  return Math.abs(left - right) <= MATCH_TOLERANCES.quantityTolerance;
}
