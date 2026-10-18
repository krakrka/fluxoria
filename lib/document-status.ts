export const DOCUMENT_STATUSES = [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "NEEDS_REVIEW",
  "VALIDATED",
  "REJECTED",
  "ERROR",
] as const;

export type DocumentStatusName = (typeof DOCUMENT_STATUSES)[number];

/**
 * PROCESSED and ERROR can return to PROCESSING so a confirmed reprocess
 * or a failed job can run again. The other edges follow the product graph.
 */
export const DOCUMENT_TRANSITIONS: Record<DocumentStatusName, readonly DocumentStatusName[]> = {
  RECEIVED: ["PROCESSING"],
  PROCESSING: ["PROCESSED", "NEEDS_REVIEW", "ERROR"],
  PROCESSED: ["VALIDATED", "NEEDS_REVIEW", "REJECTED", "PROCESSING"],
  NEEDS_REVIEW: ["VALIDATED", "REJECTED", "PROCESSING"],
  VALIDATED: ["PROCESSING"],
  REJECTED: ["PROCESSING"],
  ERROR: ["PROCESSING"],
};

export function canTransition(from: string, to: string) {
  const allowed = DOCUMENT_TRANSITIONS[from as DocumentStatusName];
  return Boolean(allowed?.includes(to as DocumentStatusName));
}

export function assertStatusTransition(from: string, to: string) {
  if (!canTransition(from, to)) {
    throw new Error(`Transition impossible : ${from} vers ${to}.`);
  }
}

export function canValidateDocument(status: string) {
  return canTransition(status, "VALIDATED");
}

export function canRejectDocument(status: string) {
  return canTransition(status, "REJECTED");
}

export function canReprocessDocument(status: string) {
  return status !== "PROCESSING" && canTransition(status, "PROCESSING");
}

export function canDeleteDocument(status: string) {
  return status !== "PROCESSING";
}
