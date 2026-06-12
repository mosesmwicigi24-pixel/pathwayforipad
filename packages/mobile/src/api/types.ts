// Wire shapes returned by the backend (snake_case, matching the API). Kept here
// so screens and hooks share one source of truth for server data.

export type LevelStatus = "completed" | "active" | "locked";
export type ModuleStatus = "completed" | "next" | "locked";

export interface Level {
  level_number: number;
  title: string;
  theme: string | null;
  required_exam_pass_mark: number;
}

export interface PathwayLevel {
  level_number: number;
  title: string;
  theme: string | null;
  total_modules: number;
  completed_modules: number;
  minutes: number;
  status: LevelStatus;
}

export interface PathwaySummary {
  current_level: number;
  levels: PathwayLevel[];
}

export interface LevelModule {
  module_id: string;
  level_number: number;
  module_sequence_number: number;
  title: string;
  summary: string | null;
  estimated_minutes: number | null;
  evaluation_kind: string;
  quiz_pass_mark: number;
  completed: boolean;
  status: ModuleStatus;
  progress: number;
  locked: boolean;
}

export interface ModuleDetail {
  module_id: string;
  level_number: number;
  module_sequence_number: number;
  title: string;
  lesson_content: string;
  summary: string | null;
  key_verses: string[] | null;
  video_url: string | null;
  evaluation_kind: string;
  estimated_minutes: number | null;
  quiz_pass_mark: number;
  current_version: number;
  locked: boolean;
}

export interface CompleteResult {
  progress_id: string;
  module_id: string;
  is_completed: boolean;
  duplicate: boolean;
  next_module_unlocked: boolean;
}

export interface CalendarOccurrence {
  occurrence_id: string;
  series_id: string;
  title: string;
  location: string | null;
  visibility: string;
  cell_group_id: string | null;
  start_at: string;
  end_at: string;
  rescheduled: boolean;
}

export interface EventDetail {
  event_id: string;
  title: string;
  occurs_at: string;
  rsvp_counts: { going?: number; maybe?: number; declined?: number };
  my_rsvp: "going" | "maybe" | "declined" | null;
}

export interface GivingRecord {
  transaction_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  fund: string;
  created_at: string;
  settled_at: string | null;
}

export interface QuizQuestion {
  question_id: string;
  q_type: "MultipleChoice" | "TrueFalse" | "FillInTheBlank";
  question_text: string;
  answer_options: string[] | null;
}

export interface AssembledQuiz {
  module_id: string;
  question_count: number;
  questions: QuizQuestion[];
}

export interface QuizResult {
  attempt_id: string;
  score_achieved: number;
  is_passed: boolean;
  pass_mark: number;
  unlocked_next_module_id: string | null;
  duplicate: boolean;
}

export interface Achievements {
  badges: Array<{
    code: string;
    name: string;
    description: string;
    category: string;
    icon_key: string | null;
    awarded_at: string;
  }>;
  streak: { current: number; longest: number };
}

// ---- Give v2 (Contract Matrix M2 over B7) ----
export type GivingMethod = "card" | "mpesa" | "airtel";

export interface GivingIntentResult {
  transaction_id: string;
  status: string;
  client_secret?: string; // card path
  provider?: string; // mobile-money path
  provider_ref?: string;
  reused: boolean;
}

export interface GivingSchedule {
  schedule_id: string;
  fund: string;
  amount_minor: number;
  currency: string;
  frequency: "weekly" | "monthly";
  method: GivingMethod;
  status: "active" | "cancelled";
  next_run_at: string;
  created_at: string;
}

// ---- Community discussions (Contract Matrix M2 over B8) ----
export interface ThreadSummary {
  thread_id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  author_name: string;
  author_user_id: string;
  comment_count: number;
}

export interface ThreadComment {
  comment_id: string;
  body: string;
  created_at: string;
  author_user_id: string;
  author_name: string;
}

export interface ThreadDetail {
  thread_id: string;
  title: string;
  body: string;
  is_pinned: boolean;
  is_locked: boolean;
  created_at: string;
  author_user_id: string;
  author_name: string;
  comments: ThreadComment[];
}

// ---- Growth domains (Contract Matrix M3 over B6) ----
export interface GiftQuestion {
  question_id: string;
  gift_key: string;
  prompt: string;
  sort: number;
}

export interface ServingTrack {
  track_key: string;
  title: string;
  description: string;
  gift_keys: string[];
  match_count: number;
}

export interface GiftAssessment {
  assessment_id: string;
  scores: Record<string, number>;
  top_gifts: string[];
  submitted_at: string;
}

export interface MyGifts {
  assessment: GiftAssessment | null;
  suggested_tracks: ServingTrack[];
}

export interface PrayerEntry {
  entry_id: string;
  title: string | null;
  body: string;
  is_answered: boolean;
  answered_note: string | null;
  answered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SavedVerse {
  saved_verse_id: string;
  reference: string;
  version: string;
  verse_text: string | null;
  note: string | null;
  created_at: string;
}

// ---- Module reflection review state (M3 over B3) ----
export interface MyReflection {
  reflection_id: string;
  module_id: string;
  body: string;
  state: "pending" | "approved" | "rejected" | "returned" | "deferred";
  feedback_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
}
