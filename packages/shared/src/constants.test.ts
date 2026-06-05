import { describe, it, expect } from "vitest";
import { ENGAGEMENT, engagementBand } from "./constants.js";

describe("engagement scoring constants (spec §1.8)", () => {
  it("weights sum to 1.0", () => {
    const sum = ENGAGEMENT.WEIGHT_HABITS + ENGAGEMENT.WEIGHT_CURRICULUM + ENGAGEMENT.WEIGHT_ATTENDANCE;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("bands per the §1.8 thresholds", () => {
    expect(engagementBand(0.8)).toBe("thriving");
    expect(engagementBand(0.75)).toBe("thriving");
    expect(engagementBand(0.6)).toBe("steady");
    expect(engagementBand(0.45)).toBe("watch"); // the PRD's Eᵢ=0.45 example
    expect(engagementBand(0.39)).toBe("at_risk");
  });
});
