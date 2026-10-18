import { IMPORTANT_FIELDS } from "@/lib/field-labels";
import { confidenceBand, DEFAULT_CONFIDENCE_THRESHOLDS, type ConfidenceThresholds } from "@/lib/confidence";
import type { ExtractedDocument } from "@/ai/schema";

export function needsHumanReview(document: ExtractedDocument, thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
  if (document.warnings.length > 0 || document.missing_fields.length > 0) return true;
  if (confidenceBand(Math.round(document.confidence * 100), thresholds) === "low") return true;
  return problematicFields(document, thresholds).length > 0;
}

export function problematicFields(document: ExtractedDocument, thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
  return IMPORTANT_FIELDS.filter((key) => {
    const field = document.fields[key];
    if (!field || field.value === null || String(field.value).trim() === "") return true;
    return confidenceBand(Math.round(field.confidence * 100), thresholds) === "low";
  });
}
