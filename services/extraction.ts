import "server-only";
import { createOpenAiModelClient } from "@/ai/openai-provider";
import { runExtraction } from "@/ai/strategy";
import { textModelId, visionModelId } from "@/ai/models";
import type { ExtractionInput } from "@/ai/types";
import { getEnv, isMockAiMode } from "@/lib/env";

export type ExtractionUsageDraft = {
  provider: string;
  model: string;
  strategy: string;
  outcome: "success" | "failure";
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostMicros?: number;
  error?: string;
};

export class ExtractionFailed extends Error {
  readonly usage: ExtractionUsageDraft;

  constructor(message: string, usage: ExtractionUsageDraft) {
    super(message);
    this.name = "ExtractionFailed";
    this.usage = usage;
  }
}

export async function extractForOrganization(input: ExtractionInput & { organizationId: string; documentId: string }) {
  const started = Date.now();
  const mock = isMockAiMode();
  const env = getEnv();
  const model = !mock && env.OPENAI_API_KEY ? createOpenAiModelClient(env.OPENAI_API_KEY) : null;
  try {
    const result = await runExtraction(input, {
      mock,
      model,
      textModel: env.OPENAI_MODEL || textModelId(),
      visionModel: visionModelId(),
    });
    return {
      document: result.document,
      usage: {
        provider: result.usage.provider,
        model: result.usage.model,
        strategy: result.usage.strategy,
        outcome: "success" as const,
        durationMs: Date.now() - started,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        estimatedCostMicros: result.usage.estimatedCostMicros,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction interrompue.";
    throw new ExtractionFailed(message, {
      provider: model?.provider ?? (mock ? "mock" : "fluxora"),
      model: "none",
      strategy: "unavailable",
      outcome: "failure",
      durationMs: Date.now() - started,
      error: message.slice(0, 500),
    });
  }
}
