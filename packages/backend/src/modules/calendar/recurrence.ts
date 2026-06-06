// Recurrence engine (Features v2 §C.0/§D.2). Expands an RRULE in the series'
// IANA timezone (not UTC) so occurrences hold their wall-clock across DST. The
// RRULE is validated against an allow-list first — recurrence-expansion bombs are
// a DoS vector (§C.4). Pure functions; no DB.
import { RRule } from "rrule";
import { DateTime } from "luxon";
import { ApiError } from "../../http/errors.js";

const ALLOWED_FREQ = new Set([RRule.DAILY, RRule.WEEKLY, RRule.MONTHLY]);
const MAX_INTERVAL = 4;
const MAX_COUNT = 260;
const MAX_UNTIL_MONTHS = 18;

export interface SeriesSpec {
  timezone: string; // IANA
  dtstart_local: string | Date; // wall-clock anchor in `timezone`
  duration_min: number;
  rrule: string | null;
}

export interface Occurrence {
  start_at: string; // UTC ISO
  end_at: string; // UTC ISO
}

/** Validate an RRULE against the allow-list. Throws 422 UNPROCESSABLE on violation. */
export function validateRrule(rrule: string): void {
  let opts;
  try {
    opts = RRule.parseString(rrule);
  } catch {
    throw new ApiError("UNPROCESSABLE", "Unparseable RRULE");
  }
  if (opts.freq === undefined || !ALLOWED_FREQ.has(opts.freq)) {
    throw new ApiError("UNPROCESSABLE", "RRULE FREQ must be DAILY, WEEKLY or MONTHLY");
  }
  if (opts.interval !== undefined && opts.interval !== null && opts.interval > MAX_INTERVAL) {
    throw new ApiError("UNPROCESSABLE", `RRULE INTERVAL must be ≤ ${MAX_INTERVAL}`);
  }
  const hasCount = opts.count !== undefined && opts.count !== null;
  const hasUntil = opts.until !== undefined && opts.until !== null;
  if (!hasCount && !hasUntil) {
    throw new ApiError("UNPROCESSABLE", "Recurring series must set COUNT or UNTIL (no unbounded rules)");
  }
  if (hasCount && (opts.count as number) > MAX_COUNT) {
    throw new ApiError("UNPROCESSABLE", `RRULE COUNT must be ≤ ${MAX_COUNT}`);
  }
  if (hasUntil) {
    const limit = DateTime.utc().plus({ months: MAX_UNTIL_MONTHS });
    if (DateTime.fromJSDate(opts.until as Date) > limit) {
      throw new ApiError("UNPROCESSABLE", `RRULE UNTIL must be within ${MAX_UNTIL_MONTHS} months`);
    }
  }
}

// Interpret a naive wall-clock Date (whose UTC fields ARE the local fields) in the
// given zone, returning the real UTC instant.
function wallClockToUtc(naive: Date, zone: string): DateTime {
  return DateTime.fromObject(
    {
      year: naive.getUTCFullYear(),
      month: naive.getUTCMonth() + 1,
      day: naive.getUTCDate(),
      hour: naive.getUTCHours(),
      minute: naive.getUTCMinutes(),
    },
    { zone },
  );
}

/**
 * Expand a series into UTC occurrences overlapping [fromUtc, toUtc], capped at
 * maxInstances. One-off series (rrule = null) yield a single occurrence.
 */
// Read the wall-clock components of a naive local timestamp WITHOUT applying any
// timezone (avoids the new Date("...no Z...") local-parse pitfall). Accepts the
// "YYYY-MM-DD[ T]HH:MM[:SS]" string the service produces via to_char.
function wallClockParts(local: string | Date): { y: number; mo: number; d: number; h: number; mi: number } {
  const s = typeof local === "string" ? local : local.toISOString();
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s);
  if (!m) throw new ApiError("VALIDATION_FAILED", "Invalid dtstart_local");
  return { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]! };
}

export function expandOccurrences(
  series: SeriesSpec,
  fromUtc: Date,
  toUtc: Date,
  maxInstances: number,
): Occurrence[] {
  const wc = wallClockParts(series.dtstart_local);
  // Treat the stored wall-clock as floating: build a UTC Date carrying those fields.
  const floatingDtstart = new Date(Date.UTC(wc.y, wc.mo - 1, wc.d, wc.h, wc.mi));

  const out: Occurrence[] = [];
  const emit = (naive: Date): void => {
    const startDt = wallClockToUtc(naive, series.timezone);
    const start = startDt.toUTC();
    const end = startDt.plus({ minutes: series.duration_min }).toUTC();
    const startMs = start.toMillis();
    if (startMs >= fromUtc.getTime() && startMs <= toUtc.getTime()) {
      out.push({ start_at: start.toISO()!, end_at: end.toISO()! });
    }
  };

  if (!series.rrule) {
    emit(floatingDtstart);
    return out;
  }

  const opts = RRule.parseString(series.rrule);
  opts.dtstart = floatingDtstart;
  const rule = new RRule(opts);
  rule.all((date, i) => {
    if (i >= maxInstances) return false;
    emit(date);
    return true;
  });
  return out;
}
