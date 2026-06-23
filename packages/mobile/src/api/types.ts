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
  description: string | null;
  location: string | null;
  visibility: string;
  category: string | null;
  cell_group_id: string | null;
  start_at: string;
  end_at: string;
  rescheduled: boolean;
  going: number;
}

/** A followable event series (Events tab "Series you follow"). */
export interface EventSeries {
  series_id: string;
  title: string;
  category: string | null;
  cadence: string;
  next_at: string | null;
  next_occurrence_id: string | null;
  next_end_at: string | null;
  location: string | null;
  following: boolean;
  new_count: number;
}

/** The member's cell summary card on the Events tab. */
export interface CellSummary {
  cell: {
    cell_group_id: string;
    name: string;
    members: number;
    leader: { name: string; role: string | null; avatar_url: string | null } | null;
    attendance: { attended: number; expected: number };
    next: { start_at: string; location: string | null } | null;
  } | null;
}

export interface EventDetail {
  event_id: string;
  title: string;
  occurs_at: string;
  description?: string | null;
  location?: string | null;
  category?: string | null;
  primary_image_url?: string | null;
  images?: string[];
  video_url?: string | null;
  rsvp_counts: { going?: number; maybe?: number; declined?: number };
  my_rsvp: "going" | "maybe" | "declined" | null;
}

// A post on an event's wall (attendee photo + caption).
export interface EventPost {
  post_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar: string | null;
  body: string | null;
  image_url: string | null;
  created_at: string;
  mine: boolean;
  rsvp_status: "going" | "maybe" | "declined" | null;
}

export interface GivingRecord {
  transaction_id: string;
  amount_minor: number;
  currency: string;
  status: string;
  fund: string;
  method: GivingMethod;
  provider_ref: string | null;
  created_at: string;
  settled_at: string | null;
}

// A single balanced ledger leg behind a gift (cash + fund accounts).
export interface GivingLedgerEntry {
  side: string; // 'debit' | 'credit'
  account: string; // 'cash:stripe' | 'fund:tithe' …
  amount_minor: number;
  currency: string;
}

// Full detail for one gift — every field plus the double-entry ledger trail.
export interface GivingDetail extends GivingRecord {
  schedule_id: string | null;
  ledger: GivingLedgerEntry[];
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
  last_run_at?: string | null;
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
  category: string | null;
  member_count: number;
  last_body: string | null;
  last_type: string | null;
  last_at: string | null;
  last_author: string | null;
  unread: number;
  avatar_url?: string | null; // the other member's photo, for DMs
}

export interface DiscoverSpace {
  conversation_id: string;
  title: string | null;
  topic: string | null;
  category: string | null;
  member_count: number;
}

export interface ChatInbox {
  conversations: ChatConversation[];
  discover_spaces: DiscoverSpace[];
}

/** A member the caller may start a DM with (GET /chat/people). */
export interface ChatPerson {
  user_id: string;
  full_name: string;
  role: string;
  avatar_url?: string | null;
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
  author_avatar?: string | null;
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
  category: string | null;
  member_count: number;
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

// ---- Certificates (member, real + verifiable; GET /certificates, GET /verify/{code}) ----
export interface CertificateRow {
  certificate_id: string;
  level_number: number;
  verification_code: string;
  issued_at: string;
  download_url: string;
}

export interface CertificateVerification {
  valid: boolean;
  revoked?: boolean;
  recipient_name?: string;
  level_number?: number;
  issued_at?: string;
  verification_code?: string;
  content_hash?: string;
  signature?: string;
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
  primary_image_url?: string | null;
  gallery_image_urls?: string[] | null;
  video_url?: string | null;
  opened: boolean;
}

// Full announcement detail (carousel images + body), served by GET /announcements/:id.
export interface AnnouncementDetail {
  announcement_id: string;
  title: string;
  body: string;
  sent_at: string | null;
  banner_expires_at: string | null;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  images: string[];
  video_url?: string | null;
  opened: boolean;
}

// Homepage-featured items for the mobile Home screen (null when none).
export interface FeaturedEvent {
  series_id: string;
  title: string;
  description: string | null;
  location: string | null;
  category: string | null;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  dtstart_local: string;
}

export interface FeaturedAnnouncement {
  announcement_id: string;
  title: string;
  body: string;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  sent_at: string | null;
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
  my_reflection?: string | null;
}

export interface RhythmToday {
  prayer: boolean;
  word: boolean;
  reflection: boolean;
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
  subtitle?: string | null;
  description: string | null;
  category: string | null;
  image_url?: string | null;
  day_count: number;
  current_day: number | null;
  completed_days: number[] | null;
  enrolled: boolean;
  completed_at: string | null;
}

export type PlanSegmentKind = "devotional" | "scripture" | "video" | "talk" | "reading";
export interface PlanSegment {
  segment_id: string;
  sort: number;
  kind: PlanSegmentKind;
  title: string;
  reference: string | null;
  content: string | null;
  video_url: string | null;
  image_url: string | null;
  completed: boolean;
}
export interface ReadingPlanDay {
  day_number: number;
  reference: string;
  title: string | null;
  content: string | null;
  segments?: PlanSegment[];
  completed?: boolean;
}

export interface ReadingPlanDetail extends Omit<ReadingPlanRow, "code" | "completed_at"> {
  days: ReadingPlanDay[];
}

export interface SegmentCompleteResult {
  segment_id: string;
  day_number: number;
  day_completed: boolean;
  progress: { plan_id: string; current_day: number; completed_days: number[]; completed_at: string | null } | null;
}

export interface ResourceRow {
  resource_id: string;
  title: string;
  author: string | null;
  kind: "book" | "audio" | "video" | "article";
  duration_label: string | null;
  url: string | null;
}

// Pathway trail encouragements (GET /levels/:n/encouragements). CMS-managed
// motivational content interleaved between modules, ordered by trail position.
export interface LevelEncouragement {
  encouragement_id: string;
  level_number: number;
  after_module_sequence: number;
  kind: "splash" | "cheer" | "sticker" | "note";
  title: string | null;
  body: string | null;
  image_url: string | null;
  scripture_ref: string | null;
  emoji: string | null;
}

export interface MentorInfo {
  mentor: { mentor_user_id: string; full_name: string; avatar_url: string | null; cell_name: string | null; established_at: string } | null;
  next_meeting_at: string | null;
  notes: Array<{ note_id: string; topic: string; note: string | null; met_at: string; next_meeting_at: string | null }>;
}

// Member growth score (0–100) with its sub-components (GET /me/scores/*).
export interface GrowthScore {
  score: number;
  band: string;
  components: Record<string, number>;
  detail: Record<string, number>;
}

// Server-decided "next best action" hero for Home (GET /me/home/next-action).
export interface NextAction {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  route: "pathway" | "module" | "prayer" | "memoryVerses" | "devotional" | "events" | "none";
  params?: { moduleId?: string };
  accent: "gold" | "navy" | "success" | "steady";
  priority: number;
}

// Prayer Wall — public, congregation-scoped prayer requests (GET /prayer-wall).
export interface PrayerReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface PrayerWallPost {
  post_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar: string | null;
  title: string | null;
  body: string;
  audio_url: string | null;
  audio_waveform: number[] | null;
  is_answered: boolean;
  created_at: string;
  mine: boolean;
  pray_count: number;
  i_prayed: boolean;
  comment_count: number;
  reactions: PrayerReaction[];
}
export interface PrayerWallComment {
  comment_id: string;
  author_user_id: string;
  author_name: string;
  author_avatar: string | null;
  body: string;
  audio_url: string | null;
  audio_waveform: number[] | null;
  created_at: string;
  mine: boolean;
}
export interface PrayerWallDetail {
  post: PrayerWallPost;
  comments: PrayerWallComment[];
}

// Composite of all five member scores + a weighted overall (GET /me/scores).
export interface ScoresSummary {
  overall: { score: number; band: string };
  habits: GrowthScore;
  curriculum: GrowthScore;
  attendance: GrowthScore;
  word: GrowthScore;
  prayer: GrowthScore;
}

// A discipler/mentor in the member's congregation, for the Home "Meet your
// discipler" carousel (GET /home/disciplers).
export interface Discipler {
  user_id: string;
  full_name: string;
  message: string | null;
  avatar_url: string | null;
  cell_name: string | null;
  role_label: string;
}

// Homepage welcome video (GET /home/welcome-video, PR #120). Shared base fields,
// then a source-dependent payload: external (youtube/vimeo/direct/private) carries
// a shareable link; hosted (cloudinary) carries a signed, expiring delivery URL.
export interface ContentReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
interface WelcomeVideoBase {
  media_asset_id: string;
  video_source: "cloudinary" | "youtube" | "vimeo" | "direct" | "private";
  caption: string | null;
  duration_sec: number | null;
  thumbnail_url?: string | null;
  // Reaction summary for the viewer (PR: home video social layer).
  reactions?: ContentReaction[];
  love_count?: number;
  liked?: boolean;
}
// Returned by POST /media/:id/reactions.
export interface ReactionToggleResult {
  on: boolean;
  reactions: ContentReaction[];
  love_count: number;
  liked: boolean;
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

// Homepage-featured cell ("This week at Nuru", GET /home/featured-cell, PR #125).
// Descriptive fields come from the cell row; members + avg_engagement are derived
// server-side from engagement_scores. The endpoint returns null when none is set.
export interface FeaturedCell {
  cell_group_id: string;
  name: string;
  discipler_name: string | null;
  discipler_role: string | null;
  focus: string | null;
  level_label: string | null;
  meets: string | null;
  room: string | null;
  next_session: string | null;
  tone: string | null;
  image_url: string | null;
  members: number;
  avg_engagement: number;
}
