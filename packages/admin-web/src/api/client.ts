// Axios client for the portal. Injects the gateway-issued JWT (§1.3). Base URL is
// the versioned API surface (§3.1). The portal is online-only (§1.3).
import axios from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";

let accessToken: string | null = null;
export function setAccessToken(token: string | null): void {
  accessToken = token;
}

let refreshHandler: (() => Promise<string | null>) | null = null;
export function setRefreshHandler(fn: (() => Promise<string | null>) | null): void {
  refreshHandler = fn;
}

export const api = axios.create({
  // Relative "/v1": in dev the Vite proxy forwards to the backend (no CORS); in
  // prod the portal is served behind the same gateway. VITE_API_BASE can override.
  baseURL: import.meta.env.VITE_API_BASE ?? "/v1",
  timeout: 15_000,
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Rotate the access token once on a 401 and replay the request.
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && refreshHandler && original && !original._retry) {
      original._retry = true;
      const token = await refreshHandler();
      if (token) {
        setAccessToken(token);
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      }
    }
    return Promise.reject(error);
  },
);

export interface CohortMember {
  user_id: string;
  full_name?: string;
  h_score: number;
  c_score: number;
  a_score: number;
  e_score: number;
  band: string;
  last_active_days_ago?: number | null;
}

export interface CohortPage {
  data: CohortMember[];
  next_cursor: string | null;
}

export interface DevSession {
  access_token: string;
  refresh_token: string;
}

/** Returned by /auth/login when the account has 2FA on. */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
}

export type LoginResult = DevSession | MfaChallenge;

export interface ReviewItem {
  review_id: string;
  user_id: string;
  full_name?: string;
  level_number: number;
  reflection_text: string;
  submitted_at: string;
}

export const PortalApi = {
  /** Email + password sign-in (argon2 verified server-side). Returns a session,
   *  OR a 2FA challenge when the account has a second factor on. */
  async login(email: string, password: string): Promise<LoginResult> {
    const { data } = await api.post<LoginResult>("/auth/login", { email, password });
    return data;
  },
  /** Complete a 2FA login: exchange the challenge token + a TOTP/recovery code. */
  async loginCompleteMfa(mfaToken: string, code: string): Promise<DevSession> {
    const { data } = await api.post<DevSession>("/auth/login/mfa", { mfa_token: mfaToken, code });
    return data;
  },
  /** DEV ONLY: mint a session by email (no OAuth). 404s in production. */
  async devLogin(email: string): Promise<DevSession> {
    const { data } = await api.post<DevSession>("/auth/dev-login", { email });
    return data;
  },
  /** Request a password-reset email (always succeeds — no account enumeration). */
  async forgotPassword(email: string): Promise<{ sent: boolean }> {
    const { data } = await api.post<{ sent: boolean }>("/auth/password/forgot", { email });
    return data;
  },
  /** Consume an emailed reset token and set a new password. */
  async resetPassword(token: string, newPassword: string): Promise<{ reset: boolean }> {
    const { data } = await api.post<{ reset: boolean }>("/auth/password/reset", {
      token,
      new_password: newPassword,
    });
    return data;
  },
  async cohort(
    cellId: string,
    opts: { band?: string; cursor?: string; limit?: number } = {},
  ): Promise<CohortPage> {
    const { data } = await api.get<CohortPage>(`/cohorts/${cellId}/members`, { params: opts });
    return data;
  },
  async reviews(): Promise<ReviewItem[]> {
    const { data } = await api.get<{ data: ReviewItem[] }>("/reviews");
    return data.data;
  },
  async decideReview(
    reviewId: string,
    decision: "approve" | "reject",
    feedbackNotes?: string,
  ): Promise<{ state: string; leveled_up: boolean }> {
    const { data } = await api.post<{ state: string; leveled_up: boolean }>(
      `/reviews/${reviewId}/decision`,
      { decision, ...(feedbackNotes ? { feedback_notes: feedbackNotes } : {}) },
    );
    return data;
  },
};

// ---- Admin reports (ERP Dashboard, B1 ⟷ W1) ----
export interface OverviewKpis {
  total_members: number;
  active_learners: number;
  avg_engagement: number;
  members_at_risk: number;
  certificates_this_month: number;
  reflections_this_week: number;
  pending_reviews: number;
  reviews_overdue: number;
  modules_published: number;
  cohorts_running: number;
  checked_in_this_week: number;
}

export interface AttendanceTrendPoint {
  week_start: string;
  check_ins: number;
  unique_members: number;
}

export interface RecentEventRow {
  event_id: string;
  title: string;
  occurs_at: string;
  checked_in: number;
  rsvp_going: number;
}

export interface ConsentRow {
  consent_id: string;
  user_id: string;
  full_name: string;
  guardian_name: string;
  relationship: string;
  granted_at: string;
  renew_by: string;
}

export interface EngagementCellRow {
  cell_group_id: string;
  name: string;
  members: number;
  avg_engagement: number;
  at_risk: number;
  discipler_name?: string | null;
  discipler_role?: string | null;
  focus?: string | null;
  level_label?: string | null;
  meets?: string | null;
  room?: string | null;
  next_session?: string | null;
  tone?: string | null;
  image_url?: string | null;
  // Homepage-featured cell ("This week at Nuru"); single-row invariant (PR #125).
  is_featured?: boolean;
}
export interface EngagementReport {
  bands: Record<string, number>;
  cells: EngagementCellRow[];
}
export interface CreateCellBody {
  name: string;
  discipler_name?: string;
  discipler_role?: string;
  focus?: string;
  level_label?: string;
  meets?: string;
  room?: string;
  next_session?: string;
  tone?: string;
  image_url?: string | null;
  meeting_cadence?: number;
}

export const AdminApi = {
  async overview(): Promise<OverviewKpis> {
    const { data } = await api.get<OverviewKpis>("/admin/reports/overview");
    return data;
  },
  async engagementReport(): Promise<EngagementReport> {
    const { data } = await api.get<EngagementReport>("/admin/reports/engagement");
    return data;
  },
  async createCell(body: CreateCellBody): Promise<EngagementCellRow> {
    const { data } = await api.post<EngagementCellRow>("/admin/cells", body);
    return data;
  },
  async updateCell(cellId: string, body: Partial<CreateCellBody>): Promise<EngagementCellRow> {
    const { data } = await api.patch<EngagementCellRow>(`/admin/cells/${cellId}`, body);
    return data;
  },
  // Feature this cell on the mobile homepage ("This week at Nuru"); unsets any
  // other (single-row invariant enforced server-side, PR #125).
  setFeaturedCell: (cellId: string) =>
    api.post<{ is_featured: true }>(`/admin/cells/${cellId}/homepage`, {}).then((r) => r.data),
  clearFeaturedCell: (cellId: string) =>
    api.delete<{ is_featured: false }>(`/admin/cells/${cellId}/homepage`).then((r) => r.data),
  async attendanceReport(weeks = 8): Promise<{ trend: AttendanceTrendPoint[]; recent_events: RecentEventRow[] }> {
    const { data } = await api.get<{ trend: AttendanceTrendPoint[]; recent_events: RecentEventRow[] }>(
      "/admin/reports/attendance",
      { params: { weeks } },
    );
    return data;
  },
  async consentsReport(): Promise<ConsentRow[]> {
    const { data } = await api.get<{ data: ConsentRow[] }>("/admin/reports/consents");
    return data.data;
  },
  async levelsReport(): Promise<LevelsReport> {
    const { data } = await api.get<LevelsReport>("/admin/reports/levels");
    return data;
  },
  async notifications(): Promise<NotificationFeedItem[]> {
    const { data } = await api.get<{ data: NotificationFeedItem[] }>("/admin/notifications");
    return data.data;
  },
  markNotifications: (action: "read" | "unread" | "dismiss", ids: string[]) =>
    api.post<{ updated: number }>(`/admin/notifications/${action}`, { ids }).then((r) => r.data),
};

export interface NotificationFeedItem {
  id: string;
  title: string;
  message: string | null;
  category: "success" | "info" | "warning" | "security";
  at: string; // ISO timestamp
  href: string | null;
  read: boolean;
}

export interface MeProfile {
  user_id: string;
  email: string | null;
  full_name: string;
  phone_number: string;
  role: string;
  locale: string | null;
  created_at: string;
  account_status: string;
  require_2fa: boolean;
  role_keys: string[];
  row_version: number;
}
export interface MeActivityRow { audit_id: number; action: string; entity: string; entity_id: string | null; occurred_at: string }

export const MeApi = {
  me: () => api.get<{ profile: MeProfile; enrollment: unknown }>("/me").then((r) => r.data),
  updateMe: (body: Record<string, unknown>) => api.patch<{ user_id: string; row_version: number }>("/me", body).then((r) => r.data),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ changed: boolean }>("/me/password", { current_password, new_password }).then((r) => r.data),
  activity: () => api.get<{ data: MeActivityRow[] }>("/me/activity").then((r) => r.data.data),
};

export interface LevelAnalyticsRow {
  level_number: number;
  title: string;
  theme: string | null;
  duration: string | null;
  status: string;
  color: string;
  modules_total: number;
  modules_published: number;
  modules_draft: number;
  modules_archived: number;
  learners: number;
  completion_pct: number;
  certificates: number;
}
export interface LevelsReport {
  levels: LevelAnalyticsRow[];
  trend: Array<Record<string, string | number>>;
}

// ---- System reference data (Final Pathway Portal "System" section) ----
export interface Country {
  code: string;
  name: string;
  flag: string | null;
  region: string | null;
  subregion: string | null;
  dial_code: string | null;
  currency: string | null;
  status: "active" | "inactive";
}
export interface Language {
  code: string;
  name: string;
  native_name: string;
  direction: "ltr" | "rtl";
  is_default: boolean;
  coverage: number;
  status: "active" | "inactive";
}
export interface Congregation {
  congregation_id: string;
  name: string;
  country: string;
  timezone: string;
  created_at: string;
  cell_count: number;
  member_count: number;
}
export type Capability = "view" | "create" | "edit" | "delete" | "approve" | "export";
export interface RolePermission { module_id: string; capability: Capability }
export interface SystemRole {
  role_key: string;
  name: string;
  role_type: "system" | "staff" | "field";
  description: string;
  is_system: boolean;
  status: "active" | "inactive";
  user_count: number;
  permissions: RolePermission[];
}

export interface SystemUser {
  user_id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  country_code: string | null;
  locale: string | null;
  account_status: "active" | "invited" | "suspended";
  require_2fa: boolean;
  last_active: string | null;
  role_keys: string[];
  discipler_message: string | null;
  avatar_url: string | null;
}

export const SystemApi = {
  countries: () => unwrap(api.get<{ data: Country[] }>("/admin/countries")),
  createCountry: (body: Record<string, unknown>) => api.post<Country>("/admin/countries", body).then((r) => r.data),
  updateCountry: (code: string, body: Record<string, unknown>) => api.put<Country>(`/admin/countries/${code}`, body).then((r) => r.data),
  languages: () => unwrap(api.get<{ data: Language[] }>("/admin/languages")),
  createLanguage: (body: Record<string, unknown>) => api.post<Language>("/admin/languages", body).then((r) => r.data),
  updateLanguage: (code: string, body: Record<string, unknown>) => api.put<Language>(`/admin/languages/${code}`, body).then((r) => r.data),
  deleteLanguage: (code: string) => api.delete<{ deleted: boolean }>(`/admin/languages/${code}`).then((r) => r.data),
  congregations: () => unwrap(api.get<{ data: Congregation[] }>("/admin/congregations")),
  createCongregation: (body: Record<string, unknown>) => api.post<Congregation>("/admin/congregations", body).then((r) => r.data),
  updateCongregation: (id: string, body: Record<string, unknown>) => api.put<Congregation>(`/admin/congregations/${id}`, body).then((r) => r.data),
  deleteCongregation: (id: string) => api.delete<{ deleted: boolean }>(`/admin/congregations/${id}`).then((r) => r.data),
  roles: () => unwrap(api.get<{ data: SystemRole[] }>("/admin/roles")),
  createRole: (body: { name: string; role_type?: string; description?: string; copy_from?: string }) =>
    api.post<SystemRole>("/admin/roles", body).then((r) => r.data),
  updateRole: (key: string, body: Record<string, unknown>) => api.put<SystemRole>(`/admin/roles/${key}`, body).then((r) => r.data),
  setRolePermissions: (key: string, permissions: RolePermission[]) =>
    api.put<{ role_key: string; count: number }>(`/admin/roles/${key}/permissions`, { permissions }).then((r) => r.data),
  deleteRole: (key: string) => api.delete<{ deleted: boolean }>(`/admin/roles/${key}`).then((r) => r.data),
  users: () => unwrap(api.get<{ data: SystemUser[] }>("/admin/users")),
  createUser: (body: Record<string, unknown>) => api.post<SystemUser>("/admin/users", body).then((r) => r.data),
  updateUser: (id: string, body: Record<string, unknown>) => api.put<SystemUser>(`/admin/users/${id}`, body).then((r) => r.data),
  deleteUser: (id: string) => api.delete<{ deleted: boolean }>(`/admin/users/${id}`).then((r) => r.data),
};

// ---- Curriculum CMS (Admin/SuperAdmin) ----
export type EvaluationKind = "none" | "reflection" | "quiz" | "exit_exam";
export type ModuleStatus = "draft" | "published" | "archived";

export type LevelStatus = "published" | "draft" | "in_review";
export interface AdminLevel {
  level_number: number;
  title: string;
  theme: string | null;
  required_exam_pass_mark: string;
  exam_question_count: number | null;
  duration: string | null;
  status: LevelStatus;
  locked: boolean;
  color: string;
  published_count: string;
  draft_count: string;
  archived_count: string;
  // Figma QuizSettings for the level final exam (may be absent on older list rows).
  exam_show_answers?: boolean;
  exam_show_score?: boolean;
  exam_shuffle?: boolean;
}

export interface AdminModuleSummary {
  module_id: string;
  level_number: number;
  module_sequence_number: number;
  title: string;
  summary: string | null;
  status: ModuleStatus;
  evaluation_kind: EvaluationKind;
  active_question_count: string;
}

export interface AdminModule extends AdminModuleSummary {
  lesson_content: string;
  key_verses: string[] | null;
  quiz_pass_mark: string;
  estimated_minutes: number | null;
  video_url: string | null;
  media_asset_id: string | null;
  time_limit_sec: number | null;
  max_attempts: number | null;
  quiz_shuffle: boolean;
  quiz_show_answers: boolean;
  quiz_show_score: boolean;
  difficulty: "beginner" | "intermediate" | "advanced";
  objectives: string | null;
  tags: string | null;
  visibility: "members" | "leaders" | "public";
  required: boolean;
  current_version: number;
  row_version: number;
}

/** Legacy enum values are still accepted server-side; the Figma builder emits the six lowercase types. */
export type QuestionType =
  | "multiple_choice"
  | "checkbox"
  | "dropdown"
  | "short_answer"
  | "paragraph"
  | "linear_scale"
  | "MultipleChoice"
  | "TrueFalse"
  | "FillInTheBlank";

/** Structured choice stored under answer_options.choices for the Figma choice types. */
export interface QuestionChoice {
  id?: string | null;
  text: string;
  is_correct: boolean;
}

/** linear_scale config stored under answer_options.scale. */
export interface QuestionScale {
  min: number;
  max: number;
  min_label: string | null;
  max_label: string | null;
}

/**
 * answer_options JSONB is polymorphic by type:
 *  - legacy choice types: string[]
 *  - Figma choice types: { choices: QuestionChoice[] }
 *  - linear_scale: { scale: QuestionScale }
 *  - short_answer/paragraph: null
 */
export type AnswerOptions =
  | string[]
  | { choices: QuestionChoice[] }
  | { scale: QuestionScale }
  | null;

export interface AdminQuestion {
  question_id: string;
  module_id: string;
  q_type: QuestionType;
  question_text: string;
  answer_options: AnswerOptions;
  /** Scalar for single-select, JSON array string for checkbox, "" for manual/scale. */
  correct_answer: string;
  difficulty_rating: number;
  is_active: boolean;
  explanation: string | null;
  points: number;
  required: boolean;
}

export interface ModuleVersion {
  version_id: string;
  version_number: number;
  edited_by_name: string | null;
  created_at: string;
}

const unwrap = <T>(p: Promise<{ data: { data: T } }>): Promise<T> => p.then((r) => r.data.data);

export const CurriculumApi = {
  levels: () => unwrap(api.get<{ data: AdminLevel[] }>("/admin/levels")),
  createLevel: (body: Record<string, unknown>) =>
    api.post<AdminLevel>("/admin/levels", body).then((r) => r.data),
  updateLevel: (n: number, body: Record<string, unknown>) =>
    api.put<AdminLevel>(`/admin/levels/${n}`, body).then((r) => r.data),
  updateExam: (
    n: number,
    body: {
      required_exam_pass_mark: number;
      exam_question_count?: number | null;
      exam_show_answers?: boolean;
      exam_show_score?: boolean;
      exam_shuffle?: boolean;
    },
  ) => api.put<AdminLevel>(`/admin/levels/${n}/exam`, body).then((r) => r.data),

  modules: (n: number) => unwrap(api.get<{ data: AdminModuleSummary[] }>(`/admin/levels/${n}/modules`)),
  module: (id: string) => api.get<AdminModule>(`/admin/modules/${id}`).then((r) => r.data),
  createModule: (body: Record<string, unknown>) =>
    api.post<AdminModule>("/admin/modules", body).then((r) => r.data),
  updateModule: (id: string, body: Record<string, unknown>) =>
    api.put<AdminModule>(`/admin/modules/${id}`, body).then((r) => r.data),
  publish: (id: string) => api.post<AdminModule>(`/admin/modules/${id}/publish`).then((r) => r.data),
  unpublish: (id: string) => api.post<AdminModule>(`/admin/modules/${id}/unpublish`).then((r) => r.data),
  archive: (id: string) => api.delete<AdminModule>(`/admin/modules/${id}`).then((r) => r.data),
  reorder: (id: string, toSequence: number) =>
    unwrap(api.post<{ data: AdminModuleSummary[] }>(`/admin/modules/${id}/reorder`, { to_sequence: toSequence })),
  versions: (id: string) => unwrap(api.get<{ data: ModuleVersion[] }>(`/admin/modules/${id}/versions`)),
  revert: (id: string, versionNumber: number) =>
    api.post<AdminModule>(`/admin/modules/${id}/revert`, { version_number: versionNumber }).then((r) => r.data),

  questions: (id: string) => unwrap(api.get<{ data: AdminQuestion[] }>(`/admin/modules/${id}/questions`)),
  addQuestions: (id: string, questions: Array<Record<string, unknown>>) =>
    api.post<{ added: number }>(`/admin/modules/${id}/questions`, { questions }).then((r) => r.data),
  updateQuestion: (qid: string, body: Record<string, unknown>) =>
    api.put<AdminQuestion>(`/admin/questions/${qid}`, body).then((r) => r.data),
  deleteQuestion: (qid: string) => api.delete<{ deleted: boolean }>(`/admin/questions/${qid}`).then((r) => r.data),
};

// ---- Growth content authoring (Admin+, WP5 over B9) ----
export interface DevotionalRow {
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
  is_published: boolean;
}
export interface VerseRow {
  memory_verse_id: string;
  reference: string;
  verse_text: string;
  version: string;
  week_number: number | null;
  release_date: string | null;
  sort: number;
  is_active: boolean;
}
export interface PlanRow {
  plan_id: string;
  code: string;
  title: string;
  subtitle?: string | null;
  description: string | null;
  category: string | null;
  image_url?: string | null;
  day_count: number;
  day_total?: number;
  sort: number;
  is_active: boolean;
}
export interface PlanSegmentRow {
  segment_id?: string;
  sort?: number;
  kind: "devotional" | "scripture" | "video" | "talk" | "reading";
  title: string;
  reference?: string | null;
  content?: string | null;
  video_url?: string | null;
  image_url?: string | null;
}
export interface PlanDayRow {
  plan_day_id?: string;
  day_number: number;
  reference: string;
  title: string | null;
  content: string | null;
  segments?: PlanSegmentRow[];
}
export interface ResourceAdminRow {
  resource_id: string;
  title: string;
  author: string | null;
  kind: "book" | "audio" | "video" | "article";
  duration_label: string | null;
  url: string | null;
  sort: number;
  is_active: boolean;
}

export interface EncouragementRow {
  encouragement_id: string;
  level_number: number;
  after_module_sequence: number;
  kind: "splash" | "cheer" | "sticker" | "note" | "celebration" | "nudge" | "verse";
  title: string | null;
  body: string | null;
  image_url: string | null;
  scripture_ref: string | null;
  emoji: string | null;
  is_active: boolean;
  sort_order: number;
}

const G = "/admin/growth";
export const GrowthAdminApi = {
  devotionals: () => unwrap(api.get<{ data: DevotionalRow[] }>(`${G}/devotionals`)),
  createDevotional: (b: Record<string, unknown>) => api.post(`${G}/devotionals`, b).then((r) => r.data),
  updateDevotional: (id: string, b: Record<string, unknown>) => api.put(`${G}/devotionals/${id}`, b).then((r) => r.data),
  deleteDevotional: (id: string) => api.delete(`${G}/devotionals/${id}`).then((r) => r.data),

  verses: () => unwrap(api.get<{ data: VerseRow[] }>(`${G}/memory-verses`)),
  createVerse: (b: Record<string, unknown>) => api.post(`${G}/memory-verses`, b).then((r) => r.data),
  updateVerse: (id: string, b: Record<string, unknown>) => api.put(`${G}/memory-verses/${id}`, b).then((r) => r.data),
  deleteVerse: (id: string) => api.delete(`${G}/memory-verses/${id}`).then((r) => r.data),

  plans: () => unwrap(api.get<{ data: PlanRow[] }>(`${G}/plans`)),
  plan: (id: string) => api.get<PlanRow & { days: PlanDayRow[] }>(`${G}/plans/${id}`).then((r) => r.data),
  createPlan: (b: Record<string, unknown>) => api.post(`${G}/plans`, b).then((r) => r.data),
  updatePlan: (id: string, b: Record<string, unknown>) => api.put(`${G}/plans/${id}`, b).then((r) => r.data),
  deletePlan: (id: string) => api.delete(`${G}/plans/${id}`).then((r) => r.data),

  resources: () => unwrap(api.get<{ data: ResourceAdminRow[] }>(`${G}/resources`)),
  createResource: (b: Record<string, unknown>) => api.post(`${G}/resources`, b).then((r) => r.data),
  updateResource: (id: string, b: Record<string, unknown>) => api.put(`${G}/resources/${id}`, b).then((r) => r.data),
  deleteResource: (id: string) => api.delete(`${G}/resources/${id}`).then((r) => r.data),
};

// Pathway trail encouragements (level-scoped). Admin CRUD over the new
// /admin/levels/:n/encouragements + /admin/encouragements/:id endpoints.
export const EncouragementsAdminApi = {
  list: (level: number) => unwrap(api.get<{ data: EncouragementRow[] }>(`/admin/levels/${level}/encouragements`)),
  create: (level: number, b: Record<string, unknown>) => api.post(`/admin/levels/${level}/encouragements`, b).then((r) => r.data),
  update: (id: string, b: Record<string, unknown>) => api.put(`/admin/encouragements/${id}`, b).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/encouragements/${id}`).then((r) => r.data),
};

// ---- Operations (ERP, W3 over B1/B2/B3/B5) ----
// Figma member vocabularies (must match the backend §1.1 enums in adminops).
export type Programme = "new_believer" | "foundations" | "serving_track" | "leadership_prep";
export type Gender = "female" | "male" | "other";
/** Derived list status: "graduated" overrides the server-computed engagement band. */
export type MemberStatus = "graduated" | "thriving" | "steady" | "watch" | "at_risk";

export interface MemberRow {
  user_id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  is_minor: boolean;
  created_at: string;
  cell_name: string | null;
  cell_group_id: string | null;
  current_level: number | null;
  start_level: number | null;
  start_module_sequence: number | null;
  e_score: number | null;
  band: string | null;
  last_activity: string | null;
  // Figma member fields (PR #123). `status` is server-derived (graduated|band|null).
  gender: Gender | null;
  city: string | null;
  programme: Programme | null;
  country_code: string | null;
  age: number | null;
  status: MemberStatus | null;
}

export interface MemberResultModule {
  module_id: string;
  sequence: number;
  title: string;
  completed: boolean;
  best_score: number | null;
  passed: boolean;
  attempts: number;
}
export interface MemberResultLevel {
  level_number: number;
  title: string;
  module_count: number;
  modules_completed: number;
  module_average: number | null;
  level_score: number | null;
  completed: boolean;
  exam: { score: number | null; passed: boolean; attempts: number } | null;
  modules: MemberResultModule[];
}
export interface MemberResults {
  user: { user_id: string; full_name: string };
  summary: {
    current_level: number;
    modules_total: number;
    modules_completed: number;
    modules_passed: number;
    avg_module_score: number | null;
    overall_score: number | null;
    levels_completed: number;
    badges: number;
    certificates: number;
  };
  levels: MemberResultLevel[];
  badges: Array<{ code: string; name: string; category: string; description: string | null; awarded_at: string }>;
  certificates: Array<{ level_number: number; level_title: string | null; verification_code: string; issued_at: string }>;
}

export interface MemberDetail {
  user_id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  is_minor: boolean;
  is_baptized: boolean;
  // Figma member fields (PR #123).
  gender: Gender | null;
  city: string | null;
  programme: Programme | null;
  country_code: string | null;
  date_of_birth: string | null;
  age: number | null;
  status: MemberStatus | null;
  graduated: boolean;
  graduated_at: string | null;
  cell_group_id: string | null;
  cell_name: string | null;
  language: string | null;
  created_at: string;
  last_activity: string | null;
  enrollment: {
    current_level: number;
    level_title: string | null;
    start_level: number | null;
    state: string | null;
    started_at: string | null;
    completed_at: string | null;
    graduated_at: string | null;
  };
  engagement: { e_score: number | null; band: string | null };
  metrics: {
    habits_pct: number;
    active_days_30: number;
    curriculum_pct: number;
    modules_done: number;
    modules_total: number;
    attendance_pct: number;
    attended: number;
    events_held: number;
    current_streak_days: number;
    longest_streak_days: number;
  };
  guardian: {
    name: string;
    relationship: string;
    consent: string;
    granted_at: string | null;
    revoked_at: string | null;
    consent_version: string | null;
  } | null;
  certificates: Array<{ certificate_id: string; level_number: number | null; verification_code: string; issued_at: string; level_title: string }>;
  badges: Array<{ code: string; name: string; description: string; category: string; icon_key: string | null; awarded_at: string }>;
  timeline: Array<{ kind: string; label: string; module_title: string | null; occurred_at: string }>;
}

export interface ReflectionRow {
  reflection_id: string;
  user_id: string;
  full_name: string;
  module_id: string;
  module_title: string;
  level_number: number;
  body: string;
  state: string;
  submitted_at: string;
  reviewed_at: string | null;
  overdue: boolean;
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
  original_start_at: string;
  rescheduled?: boolean;
}

export interface EventExceptionBody {
  original_start_at: string;
  is_cancelled?: boolean;
  new_start_at?: string | null;
  new_end_at?: string | null;
  note?: string;
}

export interface EventRoster {
  checked_in: Array<{ attendance_id: string; user_id: string; full_name: string; method: string; note: string | null; checked_in_at: string }>;
  guests: Array<{ guest_id: string; guest_name: string; phone: string | null; first_time: boolean; created_at: string }>;
  rsvp_no_show: Array<{ user_id: string; full_name: string }>;
}

// RSVP roster for one materialized occurrence (calendar service, PR #127).
export type RsvpResponse = "going" | "maybe" | "declined" | "no_response";
export interface RsvpRosterRow {
  user_id: string;
  full_name: string;
  response: RsvpResponse;
  cell_name: string | null;
  responded_at: string;
}
export interface RsvpRoster {
  event_id: string;
  buckets: {
    going: RsvpRosterRow[];
    maybe: RsvpRosterRow[];
    declined: RsvpRosterRow[];
    no_response: RsvpRosterRow[];
  };
  counts: { going: number; maybe: number; declined: number; no_response: number };
  // "cell" when the occurrence is cell-scoped (no_response is populated); "none" for
  // congregation-wide occurrences (no_response left empty — too costly to derive).
  no_response_scope: "cell" | "none";
}

// Series row returned by pause/resume (calendar service, PR #127). Only the fields
// the Events page reads are typed; the row carries more.
export interface EventSeriesRow {
  series_id: string;
  title: string;
  is_paused: boolean;
}

export type ReflectionState = "pending" | "approved" | "rejected" | "returned" | "deferred";

export interface ReflectionHistoryRow {
  audit_id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  occurred_at: string;
}

export const OpsApi = {
  members: (
    q: {
      search?: string;
      band?: string;
      level?: number;
      cell_group_id?: string;
      gender?: Gender;
      programme?: Programme;
      country_code?: string;
      cursor?: string;
    } = {},
  ) => api.get<{ data: MemberRow[]; next_cursor: string | null }>("/admin/members", { params: q }).then((r) => r.data),
  memberDetail: (userId: string) => api.get<MemberDetail>(`/admin/members/${userId}`).then((r) => r.data),
  memberResults: (userId: string) => api.get<MemberResults>(`/admin/members/${userId}/results`).then((r) => r.data),
  addMember: (body: {
    full_name: string;
    phone_number: string;
    email?: string;
    date_of_birth?: string;
    cell_group_id: string;
    gender?: Gender;
    city?: string;
    programme?: Programme;
    country_code?: string;
    language?: string;
    is_baptized?: boolean;
    start_level?: number;
    start_module_sequence?: number;
  }) => api.post<MemberRow>("/admin/members", body).then((r) => r.data),
  updateMember: (
    userId: string,
    body: {
      full_name?: string;
      phone_number?: string;
      email?: string | null;
      date_of_birth?: string | null;
      gender?: Gender | null;
      city?: string | null;
      programme?: Programme | null;
      country_code?: string | null;
      language?: string | null;
      is_baptized?: boolean;
      cell_group_id?: string;
    },
  ) => api.patch<MemberRow>(`/admin/members/${userId}`, body).then((r) => r.data),
  setMemberStart: (userId: string, body: { start_level: number; start_module_sequence: number }) =>
    api
      .patch<{ user_id: string; current_level: number; start_level: number; start_module_sequence: number }>(
        `/admin/members/${userId}/enrollment`,
        body,
      )
      .then((r) => r.data),
  // Mark / unmark a member Graduated (lifecycle flag; band stays server-computed, §1.1).
  setGraduation: (userId: string, graduated: boolean) =>
    api
      .patch<{ user_id: string; full_name: string; graduated: boolean; graduated_at: string | null; status: MemberStatus | null }>(
        `/admin/members/${userId}/graduation`,
        { graduated },
      )
      .then((r) => r.data),

  reflections: (q: { state?: ReflectionState; overdue?: boolean } = {}) =>
    api.get<{ data: ReflectionRow[] }>("/admin/reflections", { params: q }).then((r) => r.data.data),
  decideReflection: (id: string, body: { decision: "approve" | "return" | "defer"; feedback_notes?: string; pastoral_note?: string }) =>
    api.post<{ state: string }>(`/admin/reflections/${id}/decision`, body).then((r) => r.data),
  reflectionHistory: (id: string) =>
    api.get<{ data: ReflectionHistoryRow[] }>(`/admin/reflections/${id}/history`).then((r) => r.data.data),

  calendar: (fromIso: string, toIso: string) =>
    api.get<{ data: CalendarOccurrence[] }>("/calendar", { params: { from: fromIso, to: toIso } }).then((r) => r.data.data),
  roster: (eventId: string) => api.get<EventRoster>(`/admin/events/${eventId}/attendance`).then((r) => r.data),
  rsvpRoster: (occurrenceId: string) =>
    api.get<RsvpRoster>(`/admin/events/${occurrenceId}/rsvps`).then((r) => r.data),
  manualCheckIn: (eventId: string, body: { user_id: string; note?: string }) =>
    api.post(`/admin/events/${eventId}/checkins`, body).then((r) => r.data),
  addGuest: (eventId: string, body: { guest_name: string; phone?: string; first_time?: boolean }) =>
    api.post(`/admin/events/${eventId}/guests`, body).then((r) => r.data),
  // Signed image upload for events/announcements. Bytes go direct to Cloudinary
  // (see uploadToCloudinary), never our server.
  signAdminImage: (folder: "events" | "announcements" | "disciplers") =>
    api.post<CloudinarySignResult>("/admin/media/images/sign", { folder }).then((r) => r.data),
  createSeries: (body: Record<string, unknown>) => api.post("/admin/events/series", body).then((r) => r.data),
  updateSeries: (seriesId: string, body: Record<string, unknown>) =>
    api.put(`/admin/events/series/${seriesId}`, body).then((r) => r.data),
  deleteSeries: (seriesId: string) =>
    api.delete(`/admin/events/series/${seriesId}`).then((r) => r.data),
  setSeriesHomepage: (seriesId: string) =>
    api.post(`/admin/events/series/${seriesId}/homepage`, {}).then((r) => r.data),
  clearSeriesHomepage: (seriesId: string) =>
    api.delete(`/admin/events/series/${seriesId}/homepage`).then((r) => r.data),
  pauseSeries: (seriesId: string) =>
    api.post<EventSeriesRow>(`/admin/events/series/${seriesId}/pause`, {}).then((r) => r.data),
  resumeSeries: (seriesId: string) =>
    api.post<EventSeriesRow>(`/admin/events/series/${seriesId}/resume`, {}).then((r) => r.data),
  addEventException: (seriesId: string, body: EventExceptionBody) =>
    api.post(`/admin/events/series/${seriesId}/exceptions`, body).then((r) => r.data),
  cancelOccurrence: (seriesId: string, originalStartAt: string, note?: string) =>
    OpsApi.addEventException(seriesId, { original_start_at: originalStartAt, is_cancelled: true, ...(note ? { note } : {}) }),
  rescheduleOccurrence: (seriesId: string, originalStartAt: string, newStartAt: string, newEndAt: string, note?: string) =>
    OpsApi.addEventException(seriesId, {
      original_start_at: originalStartAt,
      new_start_at: newStartAt,
      new_end_at: newEndAt,
      ...(note ? { note } : {}),
    }),
};

// ---- Announcements (W3 over B5) ----
export type AnnouncementChannel = "push" | "email" | "sms" | "whatsapp" | "banner";

export interface AnnouncementRow {
  announcement_id: string;
  title: string;
  body: string;
  channels: AnnouncementChannel[];
  audience_kind: "all" | "cells" | "level";
  status: "draft" | "scheduled" | "sent" | "cancelled";
  scheduled_at: string | null;
  sent_at: string | null;
  created_at: string;
  delivered_count?: number;
  opened_count?: number;
  primary_image_url: string | null;
  gallery_image_urls: string[] | null;
  is_featured: boolean;
}

export interface AnnouncementStats {
  channel: string;
  targeted: number;
  delivered: number;
  suppressed: number;
  opened: number;
}

export const AnnouncementsApi = {
  list: (status?: string) =>
    api
      .get<{ data: AnnouncementRow[] }>("/admin/announcements", { params: status ? { status } : {} })
      .then((r) => r.data.data),
  create: (body: Record<string, unknown>) =>
    api.post<AnnouncementRow>("/admin/announcements", body).then((r) => r.data),
  get: (id: string) =>
    api.get<AnnouncementRow & { stats: AnnouncementStats[] }>(`/admin/announcements/${id}`).then((r) => r.data),
  send: (id: string) =>
    api.post<{ recipients: number; deliveries: number }>(`/admin/announcements/${id}/send`).then((r) => r.data),
  cancel: (id: string) => api.post(`/admin/announcements/${id}/cancel`).then((r) => r.data),
  update: (id: string, body: Record<string, unknown>) =>
    api.put<AnnouncementRow>(`/admin/announcements/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/admin/announcements/${id}`).then((r) => r.data),
  setHomepage: (id: string) =>
    api.post(`/admin/announcements/${id}/homepage`, {}).then((r) => r.data),
  clearHomepage: (id: string) =>
    api.delete(`/admin/announcements/${id}/homepage`).then((r) => r.data),
  // Attach / clear a Video Library video on an announcement.
  setVideo: (id: string, url: string) =>
    api.post<AnnouncementRow>(`/admin/announcements/${id}/video`, { url }).then((r) => r.data),
  clearVideo: (id: string) =>
    api.delete<AnnouncementRow>(`/admin/announcements/${id}/video`).then((r) => r.data),
};

// ---- Badges / Certificates / Finance / Audit (W4 over B1 + gamification) ----
export interface BadgeRow {
  code: string;
  name: string;
  description: string;
  category: "journey" | "consistency" | "community" | "service";
  icon_key: string | null;
  earned_count: number;
  is_active?: boolean;
}

export interface CertificateRow {
  certificate_id: string;
  user_id: string;
  full_name: string;
  level_number: number | null;
  level_title: string | null;
  verification_code: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  content_hash: string;
  signature: string;
}

export interface CertificateVerification {
  valid: boolean;
  revoked?: boolean;
  recipient_name?: string;
  level_number?: number | null;
  issued_at?: string;
  verification_code?: string;
  content_hash?: string;
  signature?: string;
}

export interface FundSummary {
  code: string;
  name: string;
  currency: string | null;
  total_minor: number;
  month_minor: number;
  gift_count: number;
}

export interface TransactionRow {
  transaction_id: string;
  full_name: string | null;
  amount_minor: number;
  currency: string;
  status: string;
  fund: string | null;
  method: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface LedgerRow {
  entry_id: string;
  transaction_id: string;
  account: string;
  side: string;
  amount_minor: number;
  currency: string;
  created_at: string;
}

export interface FinanceTrendPoint {
  m: string;
  month: string;
  total_minor: number;
}

export interface FinanceAuditRow {
  audit_id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  actor_type: "System" | "Admin";
}

export interface TransactionDetail {
  transaction: TransactionRow & {
    fund_name: string | null;
    provider_ref: string | null;
    stripe_payment_intent: string | null;
    idempotency_key: string | null;
  };
  ledger_entries: LedgerRow[];
}

export interface FinanceConfig {
  funds: { code: string; name: string; is_active: boolean }[];
  providers: { key: string; label: string; enabled: boolean }[];
  step_up_required: boolean;
}

export interface AuditRow {
  audit_id: number;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: Record<string, unknown> | null;
  created_at: string;
}

export const ConfigApi = {
  badges: () => api.get<{ data: BadgeRow[] }>("/badges").then((r) => r.data.data),
  // Admin catalog incl. deactivated badges (is_active flag); members use badges().
  adminBadges: () => api.get<{ data: BadgeRow[] }>("/admin/badges").then((r) => r.data.data),
  createBadge: (body: Record<string, unknown>) => api.post("/admin/badges", body).then((r) => r.data),
  retireBadge: (code: string) => api.delete(`/admin/badges/${code}`).then((r) => r.data),
  reactivateBadge: (code: string) => api.post(`/admin/badges/${code}/reactivate`, {}).then((r) => r.data),

  certificates: (before?: string) =>
    api
      .get<{ data: CertificateRow[]; next_cursor: string | null }>("/admin/certificates", {
        params: before ? { before } : {},
      })
      .then((r) => r.data),
  issueCertificate: (body: { user_id: string; level_number: number | null }) =>
    api.post("/admin/certificates", body).then((r) => r.data),
  revokeCertificate: (id: string, reason: string) =>
    api.post(`/admin/certificates/${id}/revoke`, { reason }).then((r) => r.data),
  // Public, server-authoritative verification: recomputes the hash + checks the
  // signature + revocation (§5.5). 404 → no certificate with that code.
  verifyCertificate: (code: string) =>
    api.get<CertificateVerification>(`/verify/${encodeURIComponent(code)}`).then((r) => r.data),

  financeSummary: () => api.get<{ funds: FundSummary[] }>("/admin/finance/summary").then((r) => r.data),
  transactions: (q: { fund?: string; status?: string; before?: string } = {}) =>
    api
      .get<{ data: TransactionRow[]; next_cursor: string | null }>("/admin/finance/transactions", { params: q })
      .then((r) => r.data),
  ledger: (limit = 100) =>
    api.get<{ data: LedgerRow[] }>("/admin/finance/ledger", { params: { limit } }).then((r) => r.data.data),
  financeTrend: (months = 6) =>
    api.get<{ data: FinanceTrendPoint[] }>("/admin/finance/trend", { params: { months } }).then((r) => r.data.data),
  financeAudit: (q: { actor?: "All" | "System" | "Admin"; limit?: number } = {}) =>
    api.get<{ data: FinanceAuditRow[] }>("/admin/finance/audit", { params: q }).then((r) => r.data.data),
  transactionDetail: (id: string) =>
    api.get<TransactionDetail>(`/admin/finance/transactions/${id}`).then((r) => r.data),
  financeConfig: () => api.get<FinanceConfig>("/admin/finance/config").then((r) => r.data),

  audit: (q: { actor_id?: string; action?: string; entity?: string; before?: number } = {}) =>
    api.get<{ data: AuditRow[]; next_cursor: number | null }>("/admin/audit", { params: q }).then((r) => r.data),
};

// ---- Video Library (W2; Features v2 §V) ----
export type MediaStatus = "uploading" | "transcoding" | "ready" | "failed";
// cloudinary = hosted/transcoded; the rest are externally-hosted, best-effort gated.
export type VideoSource = "cloudinary" | "youtube" | "vimeo" | "direct" | "private";

export interface MediaAssetRow {
  media_asset_id: string;
  kind: string;
  status: MediaStatus;
  provider: string;
  video_source: VideoSource;
  external_url: string | null;
  external_video_id: string | null;
  caption: string | null;
  level_number: number | null;
  is_homepage: boolean;
  thumbnail_url: string | null;
  duration_sec: number | null;
  error_detail: string | null;
  created_at: string;
  attached_module_title: string | null;
  attached_module_id: string | null;
  is_stuck: boolean;
  views: number | null;
  completion: number | null;
}

export interface UploadSession {
  upload_id: string;
  media_asset_id: string;
  signed_put_url: string;
  expires_at: string;
}

export interface MediaListFilter {
  status?: MediaStatus;
  video_source?: VideoSource;
  level?: number;
  attached?: boolean;
  q?: string;
}

export interface RegisterExternalInput {
  video_source: Exclude<VideoSource, "cloudinary">;
  url: string;
  title?: string;
  caption?: string;
  level_number?: number;
}

export interface PatchAssetInput {
  title?: string;
  caption?: string;
  level_number?: number | null;
  video_source?: Exclude<VideoSource, "cloudinary">;
  url?: string;
}

export interface CloudinaryUploadSignature {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
  upload_url: string;
}

export const MediaApi = {
  list: (filter: MediaListFilter = {}) => {
    const params: Record<string, string> = {};
    if (filter.status) params.status = filter.status;
    if (filter.video_source) params.video_source = filter.video_source;
    if (typeof filter.level === "number") params.level = String(filter.level);
    if (typeof filter.attached === "boolean") params.attached = filter.attached ? "true" : "false";
    if (filter.q) params.q = filter.q;
    return api.get<{ data: MediaAssetRow[]; total: number; stuck: number }>("/admin/media", { params }).then((r) => r.data);
  },
  // get / registerExternal / patchAsset return a leaner server row than the list
  // projection; the page refetches via list() for the full shape, so type these loosely.
  get: (assetId: string) =>
    api.get<Partial<MediaAssetRow> & { media_asset_id: string }>(`/admin/media/${assetId}`).then((r) => r.data),
  signUpload: (folder: "events" | "announcements" | "videos" = "videos") =>
    api.post<CloudinaryUploadSignature>("/admin/media/images/sign", { folder }).then((r) => r.data),
  // Upload a video to OUR storage (VPS disk), not Cloudinary — in PARALLEL CHUNKS.
  // A single TCP stream can't fill the pipe to a distant VPS, so we split the file
  // into ~8 MB chunks and PUT several at once (≈3× faster in practice), then
  // finalize. Each chunk retries a couple times for resilience on flaky links.
  uploadVideo: async (
    file: File,
    meta: { title?: string; caption?: string; level_number?: number } = {},
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Partial<MediaAssetRow> & { media_asset_id: string }> => {
    const base = (api.defaults.baseURL ?? "/v1").replace(/\/+$/, "");
    const CHUNK = 8 * 1024 * 1024; // 8 MB
    const CONCURRENCY = 6;
    const total = file.size;
    const chunkCount = Math.max(1, Math.ceil(total / CHUNK));
    const uploadId =
      globalThis.crypto?.randomUUID?.() ??
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        ((+c) ^ (Math.floor(Math.random() * 256) & (15 >> (+c / 4)))).toString(16),
      );
    const loaded = new Array<number>(chunkCount).fill(0);
    const report = (): void => { if (onProgress) onProgress(loaded.reduce((a, b) => a + b, 0), total); };

    const putChunk = (i: number): Promise<void> =>
      new Promise<void>((resolve, reject) => {
        const start = i * CHUNK;
        const end = Math.min(start + CHUNK, total);
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `${base}/admin/media/videos/chunk?upload_id=${uploadId}&index=${i}`);
        if (accessToken) xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.upload.onprogress = (ev) => { loaded[i] = ev.loaded; report(); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) { loaded[i] = end - start; report(); resolve(); }
          else reject(new Error(`Chunk ${i} failed (${xhr.status})`));
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(file.slice(start, end));
      });
    const putChunkRetry = async (i: number): Promise<void> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await putChunk(i); return; } catch (e) { lastErr = e; loaded[i] = 0; report(); }
      }
      throw lastErr instanceof Error ? lastErr : new Error(`Chunk ${i} failed`);
    };

    // Worker pool: CONCURRENCY chunks in flight at once.
    let next = 0;
    const worker = async (): Promise<void> => { while (next < chunkCount) { const i = next++; await putChunkRetry(i); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunkCount) }, () => worker()));

    const { data } = await api.post<Partial<MediaAssetRow> & { media_asset_id: string }>(
      "/admin/media/videos/finalize",
      {
        upload_id: uploadId,
        total_chunks: chunkCount,
        filename: file.name,
        ...(meta.title ? { title: meta.title } : {}),
        ...(meta.caption ? { caption: meta.caption } : {}),
        ...(typeof meta.level_number === "number" ? { level_number: meta.level_number } : {}),
      },
    );
    return data;
  },
  createUpload: (kind = "lesson_video") =>
    api.post<UploadSession>("/admin/media/uploads", { kind }).then((r) => r.data),
  completeUpload: (uploadId: string) =>
    api.post<{ status: string }>(`/admin/media/uploads/${uploadId}/complete`, {}).then((r) => r.data),
  registerExternal: (input: RegisterExternalInput) =>
    api.post<Partial<MediaAssetRow> & { media_asset_id: string }>("/admin/media/external", input).then((r) => r.data),
  patchAsset: (assetId: string, input: PatchAssetInput) =>
    api.patch<Partial<MediaAssetRow> & { media_asset_id: string }>(`/admin/media/${assetId}`, input).then((r) => r.data),
  // Thumbnail (poster): upload an image file OR a frame captured from the video.
  // Bytes go to our own storage; returns the updated asset row (with thumbnail_url).
  uploadThumbnail: (assetId: string, file: Blob, filename = "thumbnail.jpg") => {
    const form = new FormData();
    form.append("file", file, filename);
    return api.post<Partial<MediaAssetRow> & { media_asset_id: string }>(`/admin/media/${assetId}/thumbnail`, form).then((r) => r.data);
  },
  clearThumbnail: (assetId: string) =>
    api.delete<Partial<MediaAssetRow> & { media_asset_id: string }>(`/admin/media/${assetId}/thumbnail`).then((r) => r.data),
  setHomepage: (assetId: string) =>
    api.post<{ is_homepage: true }>(`/admin/media/${assetId}/homepage`, {}).then((r) => r.data),
  clearHomepage: (assetId: string) =>
    api.delete<{ is_homepage: false }>(`/admin/media/${assetId}/homepage`).then((r) => r.data),
  archive: (assetId: string) =>
    api.delete<{ archived: boolean }>(`/admin/media/${assetId}`).then((r) => r.data),
};

// ---- Chat (oversight console over the member-facing mobile chat; chat module) ----
export type ChatKind = "dm" | "group" | "space";
export type ChatAiTag = "prayer" | "action" | "important" | null;
export type ChatMsgType = "text" | "voice" | "image" | "file" | "video";

export interface ChatReaction { emoji: string; count: number; mine: boolean }

export interface ChatConversationRow {
  conversation_id: string;
  kind: ChatKind;
  is_public: boolean;
  title: string | null;
  topic: string | null;
  member_count: number;
  last_body: string | null;
  last_type: ChatMsgType | null;
  last_at: string | null;
  last_author: string | null;
  unread: number;
  flagged?: number; // moderation: count of flagged-but-visible messages (admin list)
}

export interface ChatDiscoverSpace {
  conversation_id: string;
  title: string | null;
  topic: string | null;
  member_count: number;
}

export interface ChatMessageRow {
  message_id: string;
  author_user_id: string;
  author_name: string;
  body: string;
  msg_type: ChatMsgType;
  attachment_url: string | null;
  attachment_meta: Record<string, unknown> | null;
  reply_to_id: string | null;
  ai_tag: ChatAiTag;
  is_edited: boolean;
  created_at: string;
  reply_body: string | null;
  reply_author: string | null;
  mine: boolean;
  reactions: ChatReaction[];
  // Moderation state — only present in the admin/oversight view (server-authoritative).
  is_flagged?: boolean;
  flag_reason?: string | null;
  is_hidden?: boolean;
  moderated_at?: string | null;
}

export interface ChatConversationDetail {
  conversation_id: string;
  kind: ChatKind;
  is_public: boolean;
  topic: string | null;
  title: string | null;
  joined: boolean;
  messages: ChatMessageRow[];
}

export interface ChatList {
  conversations: ChatConversationRow[];
  discover_spaces: ChatDiscoverSpace[];
}

export interface SendChatMessageBody {
  message_id: string; // client-generated uuid (offline-first contract)
  body?: string;
  msg_type?: ChatMsgType;
  attachment_url?: string;
  attachment_meta?: Record<string, unknown>;
  reply_to_id?: string;
}

// Cloudinary signed-upload params returned by POST /v1/chat/attachments/sign.
// Bytes go direct to Cloudinary (multipart POST to upload_url), never our server.
export interface CloudinarySignResult {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
  upload_url: string;
}

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  resource_type: string;
}

/** Multipart POST the file straight to Cloudinary using the server-signed params. */
export async function uploadToCloudinary(
  sign: CloudinarySignResult,
  file: File,
): Promise<CloudinaryUploadResult> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sign.api_key);
  form.append("timestamp", String(sign.timestamp));
  form.append("folder", sign.folder);
  form.append("signature", sign.signature);
  const res = await fetch(sign.upload_url, { method: "POST", body: form });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Cloudinary upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  const data = (await res.json()) as CloudinaryUploadResult;
  return data;
}

export const ChatApi = {
  conversations: () => api.get<ChatList>("/chat/conversations").then((r) => r.data),
  signAttachment: (body: { content_type: string; kind?: "image" | "voice" | "video" | "file" }) =>
    api.post<CloudinarySignResult>("/chat/attachments/sign", body).then((r) => r.data),
  conversation: (id: string) =>
    api.get<ChatConversationDetail>(`/chat/conversations/${id}`).then((r) => r.data),
  sendMessage: (id: string, body: SendChatMessageBody) =>
    api
      .post<{ message_id: string; duplicate: boolean }>(`/chat/conversations/${id}/messages`, body)
      .then((r) => r.data),
  markRead: (id: string) =>
    api.post<{ conversation_id: string }>(`/chat/conversations/${id}/read`, {}).then((r) => r.data),
  toggleReaction: (messageId: string, emoji: string) =>
    api
      .post<{ message_id: string; emoji: string; on: boolean }>(`/chat/messages/${messageId}/reactions`, { emoji })
      .then((r) => r.data),
  // Moderation (Admin/SuperAdmin). Server-authoritative — these mutate the message row.
  flagMessage: (id: string, reason?: string) =>
    api
      .post<ChatModerationResult>(`/chat/messages/${id}/flag`, reason ? { reason } : {})
      .then((r) => r.data),
  unflagMessage: (id: string) =>
    api.post<ChatModerationResult>(`/chat/messages/${id}/unflag`, {}).then((r) => r.data),
  removeMessage: (id: string) =>
    api.post<ChatModerationResult>(`/chat/messages/${id}/remove`, {}).then((r) => r.data),
  restoreMessage: (id: string) =>
    api.post<ChatModerationResult>(`/chat/messages/${id}/restore`, {}).then((r) => r.data),
  // Curate a public space for the congregation (Instructor+; admins qualify).
  createSpace: (body: { conversation_id: string; title: string; topic?: string }) =>
    api
      .post<{ conversation_id: string; duplicate: boolean }>("/chat/spaces", body)
      .then((r) => r.data),
};

export interface ChatModerationResult {
  message_id: string;
  is_flagged: boolean;
  is_hidden: boolean;
}

// ---- Nuru AI assistant (assistant module; provider resolved server-side) ----
export interface AssistantTurn { role: "user" | "assistant"; text: string }

export const AssistantApi = {
  chat: (body: { messages: AssistantTurn[]; conversation_id?: string }) =>
    api.post<{ reply: string }>("/assistant/chat", body).then((r) => r.data),
};
