/** USD per 1M tokens. Unknown model ids reuse the mini rates so a new model still leaves an estimate. */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
  "fluxora-text": { input: 0, output: 0 },
  "fluxora-ocr": { input: 0, output: 0 },
  mock: { input: 0, output: 0 },
};

export function textModelId() {
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export function visionModelId() {
  return process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
}

export function estimateCostMicros(model: string, inputTokens: number, outputTokens: number) {
  const price = PRICE_PER_MILLION[model] ?? PRICE_PER_MILLION["gpt-4o-mini"];
  const usd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  return Math.round(usd * 1_000_000);
}
