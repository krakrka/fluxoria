import { describe, expect, it } from "vitest";
import { validateUploadBytes } from "@/lib/upload-validation";

const pdf = Buffer.from("%PDF-1.4\n%%EOF");
const max = 10 * 1024 * 1024;

describe("upload validation", () => {
  it("accepts a real PDF signature and rejects a renamed text file", () => {
    expect(validateUploadBytes("facture.pdf", "application/pdf", pdf, max)).toBe("facture.pdf");
    expect(() => validateUploadBytes("facture.pdf", "application/pdf", Buffer.from("bonjour"), max)).toThrow(/Format refusé/);
  });

  it("rejects an empty file and a file over the limit", () => {
    expect(() => validateUploadBytes("facture.pdf", "application/pdf", Buffer.alloc(0), max)).toThrow(/vide/);
    expect(() => validateUploadBytes("facture.pdf", "application/pdf", Buffer.concat([pdf, Buffer.alloc(max)]), max)).toThrow(/10 MB/);
  });
});
