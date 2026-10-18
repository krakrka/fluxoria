import type { ExtractedDocument } from "@/ai/schema";

export type ExtractionInput = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  hintedKind?: string;
};

export interface AIProvider {
  readonly name: string;
  extractDocument(input: ExtractionInput): Promise<ExtractedDocument>;
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}
