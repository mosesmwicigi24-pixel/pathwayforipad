// Dashboard presentation logic (W1) — pure and unit-tested: KPI card layout
// from the overview payload, and bar-height normalization for the attendance
// trend (rendered as plain divs, no chart dependency).
import type { OverviewKpis, AttendanceTrendPoint } from "../api/client";

export interface KpiCard {
  key: keyof OverviewKpis;
  label: string;
  value: string;
  /** "alert" renders red when the value is > 0 (things needing attention). */
  tone: "neutral" | "alert";
}

export function kpiCards(o: OverviewKpis): KpiCard[] {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const n = (v: number): string => String(v);
  return [
    { key: "total_members", label: "Total members", value: n(o.total_members), tone: "neutral" },
    { key: "active_learners", label: "Active learners (7d)", value: n(o.active_learners), tone: "neutral" },
    { key: "avg_engagement", label: "Avg engagement", value: pct(o.avg_engagement), tone: "neutral" },
    { key: "members_at_risk", label: "Members at risk", value: n(o.members_at_risk), tone: "alert" },
    { key: "pending_reviews", label: "Pending reviews", value: n(o.pending_reviews), tone: "neutral" },
    { key: "reviews_overdue", label: "Reviews overdue (>3d)", value: n(o.reviews_overdue), tone: "alert" },
    { key: "reflections_this_week", label: "Reflections this week", value: n(o.reflections_this_week), tone: "neutral" },
    { key: "certificates_this_month", label: "Certificates this month", value: n(o.certificates_this_month), tone: "neutral" },
    { key: "checked_in_this_week", label: "Checked in this week", value: n(o.checked_in_this_week), tone: "neutral" },
    { key: "modules_published", label: "Modules published", value: n(o.modules_published), tone: "neutral" },
    { key: "cohorts_running", label: "Cohorts running", value: n(o.cohorts_running), tone: "neutral" },
  ];
}

export interface TrendBar {
  week_start: string;
  check_ins: number;
  unique_members: number;
  /** 0..1 of the tallest bar — 0 stays 0 so empty weeks render flat. */
  height: number;
}

export function trendBars(trend: AttendanceTrendPoint[]): TrendBar[] {
  const max = Math.max(1, ...trend.map((t) => t.check_ins));
  return trend.map((t) => ({ ...t, height: t.check_ins / max }));
}

/** "2026-06-08" → "Jun 8" (labels under the trend bars). */
export function shortWeekLabel(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
