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
