// Giving statement — pure, render-free helpers (no React Native imports) so the
// month grouping, totals, and label logic can be unit-tested in node-vitest
// (mirrors givingHelpers.ts / chatInbox.ts). Backs GivingStatementScreen.
import type { GivingRecord } from "../api/types";

const SETTLED = new Set(["succeeded", "settled", "completed"]);

/** A gift counts toward totals only once it has settled (processing/refunded
 *  gifts still appear in the list, but never inflate the amounts). */
export function isSettled(status: string): boolean {
  return SETTLED.has(status);
}

/** Grand total of settled gifts, in minor units. */
export function statementTotalMinor(records: GivingRecord[]): number {
  return records.reduce((sum, r) => sum + (isSettled(r.status) ? r.amount_minor : 0), 0);
}


export interface DayGroup {
  key: string; // "2026-05-18"
  label: string; // "Mon, 18 May 2026"
  totalMinor: number; // settled-only day total
  records: GivingRecord[]; // most-recent first
}

/** Group records by calendar day, newest day first, each carrying a settled-only
 *  subtotal. Records within a day stay newest-first. Used by the statement so
 *  every gift is listed under its own date heading. */
export function groupByDay(records: GivingRecord[]): DayGroup[] {
  const sorted = [...records].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const groups = new Map<string, GivingRecord[]>();
  for (const r of sorted) {
    const key = r.created_at.slice(0, 10); // YYYY-MM-DD
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, rows]) => ({
      key,
      label: dayLabel(rows[0]!.created_at),
      totalMinor: statementTotalMinor(rows),
      records: rows,
    }));
}

/** "Mon, 18 May 2026" from an ISO timestamp. */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

/** A short, uppercase provider reference for display ("Ref QFR8K2"). */
export function shortRef(ref: string | null): string | null {
  if (!ref) return null;
  const trimmed = ref.replace(/[^a-zA-Z0-9]/g, "");
  if (!trimmed) return null;
  return trimmed.slice(-8).toUpperCase();
}
