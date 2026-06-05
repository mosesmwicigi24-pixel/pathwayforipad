// Tunable business/operational constants — the single source of truth from
// spec Appendix B.2. Values match the body of the document exactly. Changing
// any of these is a product/operational decision read from config, not a code
// change (see Appendix B "Change Discipline"); every change is auditable.

export const ENGAGEMENT = {
  /** wₕ — habits weight (§1.8) */
  WEIGHT_HABITS: 0.4,
  /** w_c — curriculum weight (§1.8) */
  WEIGHT_CURRICULUM: 0.35,
  /** wₐ — attendance weight (§1.8) */
  WEIGHT_ATTENDANCE: 0.25,
  /** rolling scoring window, days (§1.8) */
  WINDOW_DAYS: 30,
  /** active-day target that saturates Hᵢ (§1.8) */
  HABIT_ACTIVE_DAY_TARGET: 20,
  /** Cᵢ denominator — total modules in the framework (§1.8) */
  CURRICULUM_MODULE_COUNT: 45,
} as const;

// Engagement banding thresholds (§1.8). Bands are inclusive of their lower bound.
export const ENGAGEMENT_BAND_THRESHOLDS = {
  thriving: 0.75, // ≥ 0.75
  steady: 0.55, // 0.55–0.74
  watch: 0.4, // 0.40–0.54
  // at_risk: < 0.40
} as const;

export const CURRICULUM = {
  LEVEL_COUNT: 5,
  MODULE_COUNT: 45,
  /** default module quiz pass mark, % (§2.2) */
  DEFAULT_QUIZ_PASS_MARK: 70,
  /** default level exam pass mark, % (§1.9) */
  DEFAULT_EXAM_PASS_MARK: 80,
} as const;

export const MEDIA = {
  /** transcode cap (§4.5) */
  MAX_RESOLUTION: "720p",
  MAX_FPS: 30,
} as const;

export const AUTH = {
  /** access-token TTL, seconds — 15 min (§5.3) */
  ACCESS_TTL_SECONDS: 900,
  REFRESH_ROTATION: "rotating+reuse-detection" as const,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,
} as const;

export const RETENTION = {
  /** raw interaction-event prune, months (§5.9) */
  INTERACTION_EVENT_MONTHS: 13,
  /** backup retention / PITR window, days (§4.7) */
  BACKUP_DAYS: 30,
} as const;

export const SLO = {
  AVAILABILITY: 0.999,
  READ_P95_MS: 300,
  WRITE_P95_MS: 600,
  SYNC_PUSH_SUCCESS: 0.995,
  PAYMENT_WEBHOOK_P99_MS: 5000,
} as const;

export const DR = {
  RPO: "~0",
  RTO_MINUTES: 30,
} as const;

/** Derive the engagement band from a composite score (§1.8). */
export function engagementBand(eScore: number): "thriving" | "steady" | "watch" | "at_risk" {
  if (eScore >= ENGAGEMENT_BAND_THRESHOLDS.thriving) return "thriving";
  if (eScore >= ENGAGEMENT_BAND_THRESHOLDS.steady) return "steady";
  if (eScore >= ENGAGEMENT_BAND_THRESHOLDS.watch) return "watch";
  return "at_risk";
}
