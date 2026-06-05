// Domain enums — mirror the PostgreSQL ENUM types declared in spec §2.2.
// Keep these in lockstep with the migrations; CI should fail if they drift.

export const USER_ROLES = ["Student", "Instructor", "Admin", "SuperAdmin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const QUESTION_TYPES = ["MultipleChoice", "TrueFalse", "FillInTheBlank"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const ENROLLMENT_STATES = ["active", "paused", "completed", "withdrawn"] as const;
export type EnrollmentState = (typeof ENROLLMENT_STATES)[number];

export const REVIEW_STATES = ["pending", "approved", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const TXN_STATUSES = [
  "requires_action",
  "processing",
  "succeeded",
  "failed",
  "refunded",
] as const;
export type TxnStatus = (typeof TXN_STATUSES)[number];

export const LEDGER_SIDES = ["debit", "credit"] as const;
export type LedgerSide = (typeof LEDGER_SIDES)[number];

export const NOTIF_CHANNELS = ["push", "email"] as const;
export type NotifChannel = (typeof NOTIF_CHANNELS)[number];

export const NOTIF_STATUSES = ["scheduled", "sent", "failed", "suppressed"] as const;
export type NotifStatus = (typeof NOTIF_STATUSES)[number];

export const ENGAGEMENT_BANDS = ["thriving", "steady", "watch", "at_risk"] as const;
export type EngagementBand = (typeof ENGAGEMENT_BANDS)[number];

export const OUTBOX_STATUSES = ["pending", "processing", "done", "dead"] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];
