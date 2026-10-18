import type { ExtractionInput } from "@/ai/types";

export type OcrPage = { page: number; text: string };

export type OcrEngine = {
  recognize(input: ExtractionInput): Promise<OcrPage[]>;
};

let custom: OcrEngine | null = null;

export function setOcrEngine(engine: OcrEngine | null) {
  custom = engine;
}

export async function recognizeOcr(input: ExtractionInput): Promise<OcrPage[]> {
  if (custom) return custom.recognize(input);
  if (input.mimeType !== "image/png") return [];
  const text = readPngText(input.bytes);
  return text ? [{ page: 1, text }] : [];
}

export function readPngText(bytes: Buffer) {
  if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return "";
  const parts: string[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "tEXt") {
      const separator = data.indexOf(0);
      if (separator >= 0) parts.push(data.subarray(separator + 1).toString("latin1"));
    }
    if (type === "IEND") break;
    offset += 12 + length;
  }
  return parts.join("\n").trim();
}
