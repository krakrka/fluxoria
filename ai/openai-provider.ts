import { buildExtractionPrompt } from "@/ai/prompt";
import { runExtraction, type ExtractionModelClient, type ModelCompletion } from "@/ai/strategy";
import { extractedDocumentSchema } from "@/ai/schema";
import { AiProviderError, type AIProvider, type ExtractionInput } from "@/ai/types";
import { textModelId, visionModelId } from "@/ai/models";
import { getEnv } from "@/lib/env";

const MAX_TEXT_CHARS = 6_000;
const MAX_IMAGE_BYTES = 1_500_000;

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";

  async extractDocument(input: ExtractionInput) {
    const env = getEnv();
    if (!env.OPENAI_API_KEY) throw new AiProviderError("OPENAI_API_KEY est absente.");
    const result = await runExtraction(input, {
      mock: false,
      model: createOpenAiModelClient(env.OPENAI_API_KEY),
      textModel: env.OPENAI_MODEL,
      visionModel: visionModelId(),
    });
    return result.document;
  }
}

export function createOpenAiModelClient(apiKey: string): ExtractionModelClient {
  return {
    provider: "openai",
    completeText: ({ model, text, filename }) =>
      complete(apiKey, model, [
        { type: "text", text: `Fichier : ${filename}\n\n${text.slice(0, MAX_TEXT_CHARS)}` },
      ]),
    completeImage: ({ model, mimeType, bytes, filename }) => {
      if (!mimeType.startsWith("image/")) {
        throw new AiProviderError("Seul un fichier image peut être envoyé au modèle de vision.");
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        throw new AiProviderError("L'image est trop volumineuse pour le modèle. Le fichier original est conservé.");
      }
      return complete(apiKey, model, [
        { type: "text", text: `Fichier : ${filename}` },
        { type: "image_url", image_url: { url: `data:${mimeType};base64,${bytes.toString("base64")}` } },
      ]);
    },
  };
}

async function complete(apiKey: string, model: string, content: unknown[]): Promise<ModelCompletion> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model || textModelId(),
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: buildExtractionPrompt() },
        { role: "user", content },
      ],
    }),
  });
  if (!response.ok) throw new AiProviderError(`Le fournisseur IA a répondu ${response.status}.`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new AiProviderError("Réponse IA vide.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new AiProviderError("La réponse IA n'est pas un JSON valide.");
  }
  const parsed = extractedDocumentSchema.safeParse(json);
  if (!parsed.success) throw new AiProviderError("La réponse IA ne respecte pas le schéma attendu.");
  return {
    json: parsed.data,
    inputTokens: payload.usage?.prompt_tokens ?? Math.ceil(JSON.stringify(content).length / 4),
    outputTokens: payload.usage?.completion_tokens ?? Math.ceil(raw.length / 4),
    model: model || textModelId(),
  };
}
