// Pure, render-free helpers for the Events tab ("Gathered together" make). No
// React/RN imports so the week-strip math, live detection, filtering, and label
// formatting are unit-tested in node-vitest. EventsScreen.tsx is a thin view.
import type { CalendarOccurrence } from "../api/types";

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** An occurrence is "live" when now falls within [start, end]. */
export function isLive(occ: Pick<CalendarOccurrence, "start_at" | "end_at">, now: number = Date.now()): boolean {
  return new Date(occ.start_at).getTime() <= now && now <= new Date(occ.end_at).getTime();
}

export interface WeekDay {
  iso: string; // midday ISO of the day (stable key)
  dow: string; // single-letter weekday (M T W …)
  day: number; // day of month
  isToday: boolean;
  hasEvent: boolean;
}

const DOW = ["S", "M", "T", "W", "T", "F", "S"];

/** The Mon→Sun week containing `now`, each day flagged today / has-event. */
export function weekStrip(occurrences: CalendarOccurrence[], now: number = Date.now()): WeekDay[] {
  const today = new Date(now);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const shift = (monday.getDay() + 6) % 7; // 0 if Monday
  monday.setDate(monday.getDate() - shift);
  const eventDays = new Set(occurrences.map((o) => new Date(o.start_at)).map((d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    return {
      iso: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).toISOString(),
      dow: DOW[d.getDay()] as string,
      day: d.getDate(),
      isToday: sameDay(d, today),
      hasEvent: eventDays.has(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`),
    };
  });
}

/** "JUNE 2026" for the strip header. */
export function monthLabel(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-US", { month: "long", year: "numeric" }).toUpperCase();
}

/** "Wed, Jun 10" for the header subtitle. */
export function todayLabel(now: number = Date.now()): string {
  return new Date(now).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** "9:00 AM – 10:30 AM" */
export function timeRange(start: string, end: string): string {
  return `${timeOf(start)} – ${timeOf(end)}`;
}

export const EVENT_CATEGORIES = ["All", "Worship", "Cell", "Leaders", "Youth"] as const;

export function matchesCategory(occ: CalendarOccurrence, category: string): boolean {
  if (category === "All") return true;
  return (occ.category ?? "").toLowerCase() === category.toLowerCase();
}

export function matchesSearch(occ: CalendarOccurrence, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [occ.title, occ.location].some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Colored badge tint for a category (mirrors the make's per-category accents). */
export function categoryColor(category: string | null): string {
  switch ((category ?? "").toLowerCase()) {
    case "worship": return "#C89B3C";
    case "youth": return "#22B07D";
    case "leaders": return "#3FA9F5";
    case "cell": return "#6366F1";
    case "marketplace": return "#E07B39";
    default: return "#68758A";
  }
}

/** Forward countdown to a start time ("5 days to go", "8 hours to go",
 *  "45 min to go", "Happening now"). UI may add emphasis (e.g. a trailing !). */
export function countdown(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "Happening now";
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${Math.max(1, mins)} min to go`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} to go`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} to go`;
}

/** Relative "time ago" for announcements ("2h ago", "Yesterday", "2d ago"). */
export function timeAgo(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const diff = now - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "Just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
