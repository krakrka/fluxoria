import { describe, expect, it } from "vitest";
import { estimateOperationalRoi, isDemoOrganization, readRoiSettings } from "@/lib/roi";

describe("operational ROI", () => {
  it("estimates saved time from the gap between manual and automated minutes", () => {
    const settings = readRoiSettings({ hourlyCostCents: 6000, manualMinutes: 12, automatedMinutes: 4 });
    const roi = estimateOperationalRoi({ autoValidated: 100, processed: 120, settings });
    expect(roi.savedPerInvoice).toBe(8);
    expect(roi.savedMinutes).toBe(800);
    expect(roi.savedHours).toBeCloseTo(800 / 60);
    expect(roi.savedCents).toBe(Math.round((800 * 6000) / 60));
    expect(roi.automationRate).toBeCloseTo(100 / 120);
  });

  it("returns an empty rate when no invoice was processed", () => {
    const roi = estimateOperationalRoi({ autoValidated: 0, processed: 0, settings: readRoiSettings({}) });
    expect(roi.automationRate).toBeNull();
    expect(roi.savedMinutes).toBe(0);
  });

  it("recognises only an explicit demo flag", () => {
    expect(isDemoOrganization({ demo: true })).toBe(true);
    expect(isDemoOrganization({})).toBe(false);
  });
});
