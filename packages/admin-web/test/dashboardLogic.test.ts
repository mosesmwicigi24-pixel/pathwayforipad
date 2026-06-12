// Dashboard presentation logic (W1): KPI mapping + trend normalization.
import { describe, it, expect } from "vitest";
import { kpiCards, trendBars, shortWeekLabel } from "../src/util/dashboardLogic";
import type { OverviewKpis } from "../src/api/client";

const overview: OverviewKpis = {
  total_members: 120,
  active_learners: 64,
  avg_engagement: 0.731,
  members_at_risk: 5,
  certificates_this_month: 3,
  reflections_this_week: 11,
  pending_reviews: 7,
  reviews_overdue: 0,
  modules_published: 51,
  cohorts_running: 9,
  checked_in_this_week: 88,
};

describe("kpiCards", () => {
  it("maps every overview field to a labelled card", () => {
    const cards = kpiCards(overview);
    expect(cards).toHaveLength(11);
    expect(cards.find((c) => c.key === "avg_engagement")?.value).toBe("73%"); // 0.731 → percent
    expect(cards.find((c) => c.key === "total_members")?.value).toBe("120");
  });

  it("marks attention metrics as alerts", () => {
    const cards = kpiCards(overview);
    expect(cards.find((c) => c.key === "members_at_risk")?.tone).toBe("alert");
    expect(cards.find((c) => c.key === "reviews_overdue")?.tone).toBe("alert");
    expect(cards.find((c) => c.key === "total_members")?.tone).toBe("neutral");
  });
});

describe("trendBars", () => {
  it("normalizes against the tallest week", () => {
    const bars = trendBars([
      { week_start: "2026-05-25", check_ins: 10, unique_members: 8 },
      { week_start: "2026-06-01", check_ins: 40, unique_members: 30 },
      { week_start: "2026-06-08", check_ins: 0, unique_members: 0 },
    ]);
    expect(bars[1]!.height).toBe(1);
    expect(bars[0]!.height).toBeCloseTo(0.25);
    expect(bars[2]!.height).toBe(0);
  });

  it("handles an all-zero trend without dividing by zero", () => {
    const bars = trendBars([{ week_start: "2026-06-08", check_ins: 0, unique_members: 0 }]);
    expect(bars[0]!.height).toBe(0);
  });
});

describe("shortWeekLabel", () => {
  it("formats ISO dates compactly and passes garbage through", () => {
    expect(shortWeekLabel("2026-06-08")).toBe("Jun 8");
    expect(shortWeekLabel("not-a-date")).toBe("not-a-date");
  });
});
