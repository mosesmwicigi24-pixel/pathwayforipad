// Persistence-facing domain models — one interface per §2 table.
// These describe row shapes; API response DTOs (which never serialise raw rows,
// per §5.8 "Excessive data exposure") live in ./dto.ts.

import type {
  EngagementBand,
  EnrollmentState,
  LedgerSide,
  NotifChannel,
  NotifStatus,
  OutboxStatus,
  QuestionType,
  ReviewState,
  TxnStatus,
  UserRole,
} from "./enums.js";

export type UUID = string;
export type ISODateTime = string; // TIMESTAMPTZ rendered ISO-8601 with offset
export type ISODate = string; // DATE
export type MinorUnits = number; // BIGINT money in the currency's minor unit (§2.1)
export type CurrencyCode = string; // ISO 4217

// --- Organisation ---
export interface Congregation {
  congregation_id: UUID;
  name: string;
  country: string; // ISO 3166-1 alpha-2
  timezone: string;
  created_at: ISODateTime;
}

export interface CellGroup {
  cell_group_id: UUID;
  congregation_id: UUID;
  name: string;
  leader_user_id: UUID | null;
  meeting_cadence: number; // expected check-ins / 30d (Aᵢ baseline)
  created_at: ISODateTime;
}

// --- Identity & RBAC ---
export interface User {
  user_id: UUID;
  email: string | null;
  full_name: string;
  phone_number: string;
  date_of_birth: ISODate;
  year_of_salvation: number | null;
  is_baptized: boolean;
  cell_group_id: UUID | null;
  congregation_id: UUID;
  role: UserRole;
  timezone: string;
  locale: string;
  is_minor: boolean; // derived from date_of_birth (§5.9)
  created_at: ISODateTime;
  updated_at: ISODateTime;
  deleted_at: ISODateTime | null;
}

export interface OAuthIdentity {
  identity_id: UUID;
  user_id: UUID;
  provider: "kingschat" | "google" | "apple" | string;
  provider_sub: string;
  linked_at: ISODateTime;
}

export interface LeaderAssignment {
  assignment_id: UUID;
  leader_user_id: UUID;
  cell_group_id: UUID;
  assigned_at: ISODateTime;
}

// --- Curriculum ---
export interface Level {
  level_number: number; // 1..5
  title: string;
  theme: string | null;
  required_exam_pass_mark: number;
}

export interface Module {
  module_id: UUID;
  level_number: number;
  module_sequence_number: number;
  title: string;
  lesson_content: string;
  video_url: string | null;
  evaluation_kind: string | null;
  estimated_minutes: number | null;
  quiz_pass_mark: number;
  is_published: boolean;
  current_version: number;
}

export interface QuestionBankItem {
  question_id: UUID;
  module_id: UUID;
  q_type: QuestionType;
  question_text: string;
  answer_options: unknown | null; // JSONB localized choice arrays
  correct_answer: string;
  difficulty_rating: number;
  is_active: boolean;
}

// --- Enrollment & progress ---
export interface Enrollment {
  enrollment_id: UUID;
  user_id: UUID;
  current_level: number;
  state: EnrollmentState;
  started_at: ISODateTime;
  completed_at: ISODateTime | null;
}

export interface ModuleProgress {
  progress_id: UUID;
  enrollment_id: UUID;
  module_id: UUID;
  is_completed: boolean;
  completed_at: ISODateTime | null;
  client_mutation_id: UUID | null; // idempotent offline completion
  row_version: number;
}

// --- Assessment ---
export interface QuizAttempt {
  attempt_id: UUID;
  progress_id: UUID;
  score_achieved: number;
  is_passed: boolean;
  question_set: UUID[]; // JSONB: served question_ids
  client_mutation_id: UUID | null;
  attempted_at: ISODateTime;
}

export interface ReflectionReview {
  review_id: UUID;
  user_id: UUID;
  level_number: number;
  reflection_text: string;
  state: ReviewState;
  reviewed_by: UUID | null;
  feedback_notes: string | null;
  submitted_at: ISODateTime;
  reviewed_at: ISODateTime | null;
}

// --- Attendance & engagement ---
export interface AttendanceLog {
  attendance_id: UUID;
  user_id: UUID;
  event_id: string;
  client_scan_id: UUID | null;
  checked_in_at: ISODateTime;
}

export interface EngagementScore {
  user_id: UUID;
  cell_group_id: UUID | null;
  h_score: number; // Hᵢ ∈ [0,1]
  c_score: number; // Cᵢ ∈ [0,1]
  a_score: number; // Aᵢ ∈ [0,1]
  e_score: number; // composite
  band: EngagementBand;
  window_end: ISODate;
  computed_at: ISODateTime;
}

// --- Financial (§2 funds/ledger) ---
export interface Fund {
  fund_id: UUID;
  code: "tithe" | "offering" | "general" | "media" | string;
  name: string;
  is_active: boolean;
}

export interface Transaction {
  transaction_id: UUID;
  user_id: UUID;
  fund_id: UUID | null;
  amount_minor: MinorUnits;
  currency: CurrencyCode;
  status: TxnStatus;
  stripe_payment_intent: string | null;
  idempotency_key: string;
  created_at: ISODateTime;
  settled_at: ISODateTime | null;
}

export interface LedgerEntry {
  entry_id: UUID;
  transaction_id: UUID;
  account: string; // 'cash:stripe' | 'fund:tithe' ...
  side: LedgerSide;
  amount_minor: MinorUnits;
  currency: CurrencyCode;
  created_at: ISODateTime;
}

export interface ProcessedWebhook {
  event_id: string;
  provider: string;
  payload_hash: string;
  processed_at: ISODateTime;
}

// --- Certificates & notifications ---
export interface Certificate {
  certificate_id: UUID;
  user_id: UUID;
  level_number: number | null; // null = full-program
  verification_code: string;
  pdf_object_key: string;
  content_hash: string;
  signature: string;
  issued_at: ISODateTime;
}

export interface Notification {
  notification_id: UUID;
  user_id: UUID;
  channel: NotifChannel;
  template: string;
  payload: Record<string, unknown>;
  status: NotifStatus;
  scheduled_for: ISODateTime;
  sent_at: ISODateTime | null;
}

// --- Sync bookkeeping ---
export interface ClientDevice {
  device_id: UUID;
  user_id: UUID;
  platform: "ios" | "android" | string;
  app_version: string | null;
  last_seen_at: ISODateTime | null;
  sync_cursors: Record<string, number>;
}

export interface OutboxRecord {
  outbox_id: UUID;
  topic: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  available_at: ISODateTime;
  created_at: ISODateTime;
}
