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

// Question types served by the backend (PR #117). New Figma-builder kinds plus
// the legacy kinds that still exist in older question banks.
export type QuestionType =
  | "multiple_choice"
  | "checkbox"
  | "dropdown"
  | "short_answer"
  | "paragraph"
  | "linear_scale"
  // legacy (pre-#117) kinds — still graded as single-select
  | "MultipleChoice"
  | "TrueFalse"
  | "FillInTheBlank";

// A structured choice (id is the value graded server-side; text is the label).
export interface QuestionChoice {
  id: string;
  text: string;
}

// linear_scale config. Answer signal (is_correct) is stripped server-side (§5.8).
export interface QuestionScale {
  min: number;
  max: number;
  min_label?: string;
  max_label?: string;
}

// Polymorphic answer_options (answer signal stripped before serving, §5.8):
//   • legacy `string[]`            — single-select options
//   • `{ choices: QuestionChoice[] }` — multiple_choice / checkbox / dropdown
//   • `{ scale: QuestionScale }`   — linear_scale
//   • null                         — short_answer / paragraph (free text)
export type AnswerOptions =
  | string[]
  | { choices: QuestionChoice[] }
  | { scale: QuestionScale }
  | null;

export interface QuizQuestion {
  question_id: string;
  q_type: QuestionType;
  question_text: string;
  answer_options: AnswerOptions;
  points?: number;
  required?: boolean;
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
  requires_manual_review: boolean;
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
export type GivingMethod = "card" | "mpesa" | "airtel" | "paypal";

export interface GivingIntentResult {
  transaction_id: string;
  status: string;
  client_secret?: string; // card path
  provider?: string; // mobile-money / paypal
  provider_ref?: string;
  approve_url?: string; // paypal: open this for the member to approve, then capture
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

// ---- Chat: DMs, cell groups, public spaces (mobile Chat make) ----
export type ChatKind = "dm" | "group" | "space";

export interface ChatConversation {
  conversation_id: string;
  kind: ChatKind;
  is_public: boolean;
  title: string | null;
  topic: string | null;
  member_count: number;
  last_body: string | null;
  last_type: string | null;
  last_at: string | null;
  last_author: string | null;
  unread: number;
}

export interface DiscoverSpace {
  conversation_id: string;
  title: string | null;
  topic: string | null;
  member_count: number;
}

export interface ChatInbox {
  conversations: ChatConversation[];
  discover_spaces: DiscoverSpace[];
}

export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ChatMessage {
  message_id: string;
  author_user_id: string;
  author_name: string;
  body: string;
  msg_type: "text" | "voice" | "image" | "file" | "video";
  attachment_url: string | null;
  attachment_meta: Record<string, unknown> | null;
  reply_to_id: string | null;
  reply_body: string | null;
  reply_author: string | null;
  ai_tag: "prayer" | "action" | "important" | null;
  is_edited: boolean;
  created_at: string;
  mine: boolean;
  reactions: ChatReaction[];
}

export interface ChatThreadDetail {
  conversation_id: string;
  kind: ChatKind;
  is_public: boolean;
  title: string | null;
  topic: string | null;
  joined: boolean;
  messages: ChatMessage[];
}

export interface NuruTurn {
  role: "user" | "assistant";
  text: string;
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

// ---- Notification center + home extras (Design spec D1) ----
export interface NotificationRow {
  notification_id: string;
  template: string;
  payload: Record<string, unknown>;
  status: string;
  scheduled_for: string;
  sent_at: string | null;
  read_at: string | null;
}

export interface MyAnnouncement {
  announcement_id: string;
  title: string;
  body: string;
  sent_at: string | null;
  banner_expires_at: string | null;
  opened: boolean;
}

export interface ScripturePassage {
  reference: string;
  version: string;
  text: string;
  copyright?: string;
}

// ---- My RSVPs (Community 'My RSVPs' segment, D3 over B2/B/calendar) ----
export interface MyRsvp {
  rsvp_id: string;
  status: "going" | "maybe" | "declined";
  updated_at: string;
  event_id: string;
  title: string;
  occurs_at: string;
  cell_group_id: string | null;
}

// ---- Growth content (Contract Matrix D5 over B9) ----
export interface Devotional {
  devotional_id: string;
  day_number: number;
  series: string | null;
  title: string;
  scripture_ref: string | null;
  scripture_text: string | null;
  body: string;
  reflection_prompt: string | null;
  audio_url: string | null;
  video_url: string | null;
}

export interface MemoryVerseRow {
  memory_verse_id: string;
  reference: string;
  verse_text: string;
  version: string;
  week_number: number | null;
  status: "learning" | "mastered";
  best_match_pct: number;
}

export interface ReadingPlanRow {
  plan_id: string;
  code: string;
  title: string;
  description: string | null;
  category: string | null;
  day_count: number;
  current_day: number | null;
  completed_days: number[] | null;
  enrolled: boolean;
  completed_at: string | null;
}

export interface ReadingPlanDay {
  day_number: number;
  reference: string;
  title: string | null;
  content: string | null;
}

export interface ReadingPlanDetail extends Omit<ReadingPlanRow, "code" | "completed_at"> {
  days: ReadingPlanDay[];
}

export interface ResourceRow {
  resource_id: string;
  title: string;
  author: string | null;
  kind: "book" | "audio" | "video" | "article";
  duration_label: string | null;
  url: string | null;
}

export interface MentorInfo {
  mentor: { mentor_user_id: string; full_name: string; cell_name: string | null; established_at: string } | null;
  next_meeting_at: string | null;
  notes: Array<{ note_id: string; topic: string; note: string | null; met_at: string; next_meeting_at: string | null }>;
}

// Homepage welcome video (GET /home/welcome-video, PR #120). Shared base fields,
// then a source-dependent payload: external (youtube/vimeo/direct/private) carries
// a shareable link; hosted (cloudinary) carries a signed, expiring delivery URL.
interface WelcomeVideoBase {
  media_asset_id: string;
  video_source: "cloudinary" | "youtube" | "vimeo" | "direct" | "private";
  caption: string | null;
  duration_sec: number | null;
}
export interface WelcomeVideoExternal extends WelcomeVideoBase {
  external_url: string | null;
  external_video_id: string | null;
}
export interface WelcomeVideoHosted extends WelcomeVideoBase {
  url: string | null;
  expires_at?: string;
}
export type WelcomeVideo = WelcomeVideoExternal | WelcomeVideoHosted;
