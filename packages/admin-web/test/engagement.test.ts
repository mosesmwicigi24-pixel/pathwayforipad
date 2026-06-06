// Portal engagement helpers — pure logic (band colour, formatting, ascending sort).
import { describe, it, expect } from "vitest";
import { bandColor, bandLabel, formatPct, sortByEngagement } from "../src/util/engagement";

describe("portal engagement helpers (§1.8)", () => {
  it("maps bands to colours, with a fallback", () => {
    expect(bandColor("thriving")).toBe("#16a34a");
    expect(bandColor("at_risk")).toBe("#b91c1c");
    expect(bandColor("mystery")).toBe("#6b7280");
  });

  it("humanises band labels and formats percentages", () => {
    expect(bandLabel("at_risk")).toBe("at risk");
    expect(formatPct(0.4)).toBe("40%");
    expect(formatPct(1)).toBe("100%");
  });

  it("sorts ascending by engagement (at-risk first)", () => {
    const sorted = sortByEngagement([
      { user_id: "a", e_score: 0.8 },
      { user_id: "b", e_score: 0.2 },
      { user_id: "c", e_score: 0.5 },
    ]);
    expect(sorted.map((r) => r.user_id)).toEqual(["b", "c", "a"]);
  });
});
