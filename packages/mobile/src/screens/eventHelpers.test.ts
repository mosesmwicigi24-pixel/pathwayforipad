import { describe, it, expect } from "vitest";
import {
  sameDay,
  isLive,
  weekStrip,
  monthLabel,
  todayLabel,
  timeRange,
  matchesCategory,
  matchesSearch,
  categoryColor,
  timeAgo,
  countdown,
  EVENT_CATEGORIES,
} from "./eventHelpers";
import type { CalendarOccurrence } from "../api/types";

function occ(over: Partial<CalendarOccurrence>): CalendarOccurrence {
  return {
    occurrence_id: "o1",
    series_id: "s1",
    title: "Midweek Prayer Service",
    description: null,
    location: "Main Sanctuary",
    visibility: "congregation",
    category: "worship",
    cell_group_id: null,
    primary_image_url: null,
    start_at: "2026-06-10T06:00:00Z",
    end_at: "2026-06-10T07:30:00Z",
    rescheduled: false,
    going: 124,
    ...over,
  };
}

describe("isLive", () => {
  it("is true only within the event window", () => {
    const o = occ({ start_at: "2026-06-10T06:00:00Z", end_at: "2026-06-10T07:30:00Z" });
    expect(isLive(o, new Date("2026-06-10T06:30:00Z").getTime())).toBe(true);
    expect(isLive(o, new Date("2026-06-10T08:00:00Z").getTime())).toBe(false);
    expect(isLive(o, new Date("2026-06-10T05:00:00Z").getTime())).toBe(false);
  });
});

describe("weekStrip", () => {
  const now = new Date("2026-06-10T09:00:00Z").getTime(); // a Wednesday
  it("returns Mon→Sun with today flagged and event dots", () => {
    const strip = weekStrip([occ({ start_at: "2026-06-12T06:00:00Z" })], now);
    expect(strip).toHaveLength(7);
    expect(strip[0]!.dow).toBe("M");
    expect(strip[6]!.dow).toBe("S");
    const today = strip.find((d) => d.isToday)!;
    expect(today.day).toBe(10);
    // Jun 12 (Friday) carries an event dot
    expect(strip.find((d) => d.day === 12)!.hasEvent).toBe(true);
    expect(strip.find((d) => d.day === 11)!.hasEvent).toBe(false);
  });
});

describe("labels", () => {
  const now = new Date("2026-06-10T09:00:00Z").getTime();
  it("formats month + today + time range", () => {
    expect(monthLabel(now)).toBe("JUNE 2026");
    expect(todayLabel(now)).toMatch(/Jun 10/);
    expect(timeRange("2026-06-10T06:00:00Z", "2026-06-10T07:30:00Z")).toMatch(/–/);
  });
});

describe("filters", () => {
  it("matchesCategory respects All + case-insensitive match", () => {
    expect(matchesCategory(occ({ category: "worship" }), "All")).toBe(true);
    expect(matchesCategory(occ({ category: "worship" }), "Worship")).toBe(true);
    expect(matchesCategory(occ({ category: "youth" }), "Worship")).toBe(false);
    expect(matchesCategory(occ({ category: null }), "Worship")).toBe(false);
  });
  it("matchesSearch over title + location", () => {
    expect(matchesSearch(occ({ title: "Sunday Worship" }), "sunday")).toBe(true);
    expect(matchesSearch(occ({ location: "Hall B" }), "hall")).toBe(true);
    expect(matchesSearch(occ({ title: "X", location: "Y" }), "zzz")).toBe(false);
    expect(matchesSearch(occ({}), "  ")).toBe(true);
  });
  it("exposes the canonical category set", () => {
    expect(EVENT_CATEGORIES).toContain("All");
    expect(EVENT_CATEGORIES).toContain("Youth");
  });
});

describe("categoryColor + timeAgo", () => {
  it("maps categories to distinct accents", () => {
    expect(categoryColor("worship")).not.toBe(categoryColor("youth"));
    expect(categoryColor(null)).toBeTruthy();
  });
  it("formats relative time", () => {
    const now = new Date("2026-06-10T12:00:00Z").getTime();
    expect(timeAgo("2026-06-10T10:00:00Z", now)).toBe("2h ago");
    expect(timeAgo("2026-06-09T10:00:00Z", now)).toBe("Yesterday");
    expect(timeAgo("2026-06-08T10:00:00Z", now)).toBe("2d ago");
    expect(timeAgo(null, now)).toBe("");
  });
});

describe("countdown", () => {
  const now = new Date("2026-06-10T12:00:00Z").getTime();
  it("counts days, hours, minutes to a future start", () => {
    expect(countdown("2026-06-15T12:00:00Z", now)).toBe("5 days to go");
    expect(countdown("2026-06-11T12:00:00Z", now)).toBe("1 day to go");
    expect(countdown("2026-06-10T20:00:00Z", now)).toBe("8 hours to go");
    expect(countdown("2026-06-10T13:00:00Z", now)).toBe("1 hour to go");
    expect(countdown("2026-06-10T12:45:00Z", now)).toBe("45 min to go");
  });
  it("shows 'Happening now' once the start has passed", () => {
    expect(countdown("2026-06-10T11:59:00Z", now)).toBe("Happening now");
  });
});

describe("sameDay", () => {
  it("compares calendar days (local)", () => {
    expect(sameDay(new Date(2026, 5, 10, 1, 0), new Date(2026, 5, 10, 23, 0))).toBe(true);
    expect(sameDay(new Date(2026, 5, 10), new Date(2026, 5, 11))).toBe(false);
  });
});
