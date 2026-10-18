import { createHash } from "crypto";

/**
 * Idempotence des automatisations.
 *
 * La clé est stable pour un même événement et un même état métier :
 * organisation implicite + règle + déclencheur + entité + action + hash du contexte.
 *
 * - COMPLETED ou SKIPPED avec le même hash : l'évaluation a déjà eu lieu, on ne recommence pas.
 * - FAILED avec le même hash : l'exécution peut être rejouée.
 * - RUNNING récent : une autre exécution est en cours, on ne double rien.
 * - Hash différent : la facture ou l'anomalie a changé, une nouvelle évaluation est autorisée.
 *   Une règle inapplicable hier peut donc s'appliquer après correction.
 */
export function contextHash(context: Record<string, string | number | boolean | null>) {
  const stable = Object.keys(context)
    .sort()
    .map((key) => [key, context[key]]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

export function executionDedupeKey(input: {
  ruleId: string;
  trigger: string;
  entityId: string;
  actionType: string;
  contextHash: string;
}) {
  return [input.ruleId, input.trigger, input.entityId, input.actionType, input.contextHash].join(":");
}

export type ExecutionClaim = "execute" | "retry" | "skip" | "concurrent";

export function sameContextDecision(status: "COMPLETED" | "SKIPPED" | "FAILED" | "RUNNING" | null): ExecutionClaim {
  if (status === null) return "execute";
  if (status === "FAILED") return "retry";
  if (status === "RUNNING") return "concurrent";
  return "skip";
}
