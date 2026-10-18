import { recognizeOcr } from "@/ai/ocr";
import { extractPdfPages } from "@/ai/pdf-text";
import { extractedDocumentSchema, type ExtractedDocument } from "@/ai/schema";
import { parseFrenchDocument, type TextPage } from "@/ai/text-extract";
import { MockAIProvider } from "@/ai/mock-provider";
import { estimateCostMicros } from "@/ai/models";
import { IMPORTANT_FIELDS } from "@/lib/field-labels";
import { AiProviderError, type ExtractionInput } from "@/ai/types";

const MIN_TEXT = 40;
const MAX_TEXT_CHARS = 6_000;
const MAX_IMAGE_BYTES = 1_500_000;

export type ExtractionStrategy = "native_text" | "ocr" | "model_text" | "vision" | "mock";

export type ModelCompletion = {
  json: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
};

export type ExtractionModelClient = {
  readonly provider: string;
  completeText(input: { model: string; text: string; filename: string }): Promise<ModelCompletion>;
  completeImage(input: { model: string; mimeType: string; bytes: Buffer; filename: string }): Promise<ModelCompletion>;
};

export type ExtractionRun = {
  document: ExtractedDocument;
  usage: {
    provider: string;
    model: string;
    strategy: ExtractionStrategy;
    inputTokens: number;
    outputTokens: number;
    estimatedCostMicros: number;
  };
};

export async function runExtraction(
  input: ExtractionInput,
  options: {
    mock: boolean;
    model: ExtractionModelClient | null;
    textModel: string;
    visionModel: string;
  },
): Promise<ExtractionRun> {
  const native = input.mimeType === "application/pdf" ? extractPdfPages(input.bytes) : [];
  if (textLength(native) >= MIN_TEXT) {
    return finishLocal(input, native, "native_text", "fluxora-text", options);
  }

  const ocr = await recognizeOcr(input);
  if (textLength(ocr) >= MIN_TEXT) {
    return finishLocal(input, ocr, "ocr", "fluxora-ocr", options);
  }

  if (input.mimeType.startsWith("image/") && options.model && !options.mock) {
    if (input.bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new AiProviderError("L'image est trop volumineuse pour le modèle. Le fichier original est conservé.");
    }
    const completion = await options.model.completeImage({
      model: options.visionModel,
      mimeType: input.mimeType,
      bytes: input.bytes,
      filename: input.filename,
    });
    return {
      document: readModelDocument(completion.json),
      usage: usageFrom(options.model.provider, "vision", completion),
    };
  }

  if (options.mock || !options.model) {
    if (options.mock) {
      const document = await new MockAIProvider().extractDocument(input);
      return {
        document,
        usage: {
          provider: "mock",
          model: "mock",
          strategy: "mock",
          inputTokens: 0,
          outputTokens: 0,
          estimatedCostMicros: 0,
        },
      };
    }
  }

  throw new AiProviderError(
    "Ce document ne contient pas de texte extractible. Le fichier original est conservé. Importez une image de la page ou relancez le traitement.",
  );
}

async function finishLocal(
  input: ExtractionInput,
  pages: TextPage[],
  strategy: "native_text" | "ocr",
  modelName: string,
  options: { mock: boolean; model: ExtractionModelClient | null; textModel: string },
): Promise<ExtractionRun> {
  const parsed = parseFrenchDocument(pages);
  if (needsModel(parsed) && options.model && !options.mock) {
    try {
      const excerpt = pages
        .map((page) => `Page ${page.page}\n${page.text}`)
        .join("\n")
        .slice(0, MAX_TEXT_CHARS);
      const completion = await options.model.completeText({
        model: options.textModel,
        text: `Fichier : ${input.filename}\n\n${excerpt}`,
        filename: input.filename,
      });
      return {
        document: readModelDocument(completion.json),
        usage: usageFrom(options.model.provider, "model_text", completion),
      };
    } catch {
      parsed.warnings.push("Le modèle de secours n'a pas répondu. L'extraction locale est conservée.");
    }
  }
  return {
    document: parsed,
    usage: {
      provider: "fluxora",
      model: modelName,
      strategy,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostMicros: 0,
    },
  };
}

function needsModel(document: ExtractedDocument) {
  if (document.confidence < 0.7) return true;
  return IMPORTANT_FIELDS.some((key) => {
    const field = document.fields[key];
    return !field || field.value === null || field.confidence < 0.7;
  });
}

function readModelDocument(value: unknown) {
  const result = extractedDocumentSchema.safeParse(value);
  if (!result.success) throw new AiProviderError("La réponse IA ne respecte pas le schéma attendu.");
  return result.data;
}

function usageFrom(provider: string, strategy: ExtractionStrategy, completion: ModelCompletion) {
  return {
    provider,
    model: completion.model,
    strategy,
    inputTokens: completion.inputTokens,
    outputTokens: completion.outputTokens,
    estimatedCostMicros: estimateCostMicros(completion.model, completion.inputTokens, completion.outputTokens),
  };
}

function textLength(pages: TextPage[]) {
  return pages.reduce((total, page) => total + page.text.trim().length, 0);
}
