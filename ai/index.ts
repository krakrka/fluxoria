import "server-only";
import { isMockAiMode } from "@/lib/env";
import { MockAIProvider } from "@/ai/mock-provider";
import { OpenAIProvider } from "@/ai/openai-provider";
import type { AIProvider } from "@/ai/types";

export function getAIProvider(): AIProvider {
  if (isMockAiMode()) return new MockAIProvider();
  return new OpenAIProvider();
}
