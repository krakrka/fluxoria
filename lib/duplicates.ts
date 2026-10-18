export type DuplicateCandidate = {
  id: string;
  number: string;
  issuedAt: Date | null;
  amountCents: number;
  supplierId: string | null;
};

function sameDay(left: Date | null, right: Date | null) {
  if (!left || !right) return false;
  return left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
}

export function findDuplicate(current: DuplicateCandidate, others: DuplicateCandidate[]) {
  const byNumber = others.find(
    (other) =>
      other.id !== current.id &&
      other.supplierId &&
      other.supplierId === current.supplierId &&
      other.number.trim().toLowerCase() === current.number.trim().toLowerCase(),
  );
  if (byNumber) return { other: byNumber, reason: "number" as const };
  const byAmount = others.find(
    (other) =>
      other.id !== current.id &&
      other.supplierId &&
      other.supplierId === current.supplierId &&
      sameDay(other.issuedAt, current.issuedAt) &&
      other.amountCents === current.amountCents,
  );
  if (byAmount) return { other: byAmount, reason: "amount" as const };
  return null;
}
