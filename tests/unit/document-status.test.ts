import { describe, expect, it } from "vitest";
import { assertStatusTransition, canTransition, canValidateDocument } from "@/lib/document-status";

describe("document status", () => {
  it("allows the processing and validation edges", () => {
    expect(canTransition("RECEIVED", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSING", "NEEDS_REVIEW")).toBe(true);
    expect(canTransition("NEEDS_REVIEW", "VALIDATED")).toBe(true);
    expect(canTransition("VALIDATED", "REJECTED")).toBe(false);
    expect(canTransition("PROCESSING", "ERROR")).toBe(true);
    expect(canTransition("NEEDS_REVIEW", "REJECTED")).toBe(true);
    expect(canTransition("REJECTED", "PROCESSING")).toBe(true);
    expect(canTransition("ERROR", "PROCESSING")).toBe(true);
    expect(canTransition("PROCESSED", "NEEDS_REVIEW")).toBe(true);
    expect(canValidateDocument("PROCESSED")).toBe(true);
    expect(canValidateDocument("NEEDS_REVIEW")).toBe(true);
    expect(canValidateDocument("REJECTED")).toBe(false);
    expect(canValidateDocument("ERROR")).toBe(false);
  });

  it("refuses an incoherent transition", () => {
    expect(() => assertStatusTransition("RECEIVED", "VALIDATED")).toThrow(/Transition impossible/);
  });
});
