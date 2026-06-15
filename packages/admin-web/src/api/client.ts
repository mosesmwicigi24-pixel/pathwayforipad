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

export interface ReviewItem {
  review_id: string;
  user_id: string;
  full_name?: string;
  level_number: number;
  reflection_text: string;
  submitted_at: string;
}

export const PortalApi = {
  /** Email + password sign-in (argon2 verified server-side). */
  async login(email: string, password: string): Promise<DevSession> {
    const { data } = await api.post<DevSession>("/auth/login", { email, password });
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
}
export interface EngagementReport {
  bands: Record<string, number>;
  cells: EngagementCellRow[];
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
}

export const SystemApi = {
  countries: () => unwrap(api.get<{ data: Country[] }>("/admin/countries")),
  createCountry: (body: Record<string, unknown>) => api.post<Country>("/admin/countries", body).then((r) => r.data),
  updateCountry: (code: string, body: Record<string, unknown>) => api.put<Country>(`/admin/countries/${code}`, body).then((r) => r.data),
  languages: () => unwrap(api.get<{ data: Language[] }>("/admin/languages")),
  createLanguage: (body: Record<string, unknown>) => api.post<Language>("/admin/languages", body).then((r) => r.data),
  updateLanguage: (code: string, body: Record<string, unknown>) => api.put<Language>(`/admin/languages/${code}`, body).then((r) => r.data),
  deleteLanguage: (code: string) => api.delete<{ deleted: boolean }>(`/admin/languages/${code}`).then((r) => r.data),
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
  difficulty: "beginner" | "intermediate" | "advanced";
  objectives: string | null;
  tags: string | null;
  visibility: "members" | "leaders" | "public";
  required: boolean;
  current_version: number;
  row_version: number;
}

export interface AdminQuestion {
  question_id: string;
  module_id: string;
  q_type: "MultipleChoice" | "TrueFalse" | "FillInTheBlank";
  question_text: string;
  answer_options: string[] | null;
  correct_answer: string;
  difficulty_rating: number;
  is_active: boolean;
  explanation: string | null;
  points: number;
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
  updateExam: (n: number, body: { required_exam_pass_mark: number; exam_question_count?: number | null }) =>
    api.put<AdminLevel>(`/admin/levels/${n}/exam`, body).then((r) => r.data),

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
  sort: number;
  is_active: boolean;
}
export interface PlanRow {
  plan_id: string;
  code: string;
  title: string;
  description: string | null;
  category: string | null;
  day_count: number;
  day_total?: number;
  sort: number;
  is_active: boolean;
}
export interface PlanDayRow {
  plan_day_id?: string;
  day_number: number;
  reference: string;
  title: string | null;
  content: string | null;
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

// ---- Operations (ERP, W3 over B1/B2/B3/B5) ----
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
}

export interface MemberDetail {
  user_id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  is_minor: boolean;
  is_baptized: boolean;
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
  event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  visibility: string;
  cell_group_id: string | null;
}

export interface EventRoster {
  checked_in: Array<{ attendance_id: string; user_id: string; full_name: string; method: string; note: string | null; checked_in_at: string }>;
  guests: Array<{ guest_id: string; guest_name: string; phone: string | null; first_time: boolean; created_at: string }>;
  rsvp_no_show: Array<{ user_id: string; full_name: string }>;
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
  members: (q: { search?: string; band?: string; level?: number; cursor?: string } = {}) =>
    api.get<{ data: MemberRow[]; next_cursor: string | null }>("/admin/members", { params: q }).then((r) => r.data),
  memberDetail: (userId: string) => api.get<MemberDetail>(`/admin/members/${userId}`).then((r) => r.data),
  addMember: (body: { full_name: string; phone_number: string; email?: string; date_of_birth?: string; cell_group_id: string; start_level?: number; start_module_sequence?: number }) =>
    api.post<MemberRow>("/admin/members", body).then((r) => r.data),
  setMemberStart: (userId: string, body: { start_level: number; start_module_sequence: number }) =>
    api
      .patch<{ user_id: string; current_level: number; start_level: number; start_module_sequence: number }>(
        `/admin/members/${userId}/enrollment`,
        body,
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
  manualCheckIn: (eventId: string, body: { user_id: string; note?: string }) =>
    api.post(`/admin/events/${eventId}/checkins`, body).then((r) => r.data),
  addGuest: (eventId: string, body: { guest_name: string; phone?: string; first_time?: boolean }) =>
    api.post(`/admin/events/${eventId}/guests`, body).then((r) => r.data),
  createSeries: (body: Record<string, unknown>) => api.post("/admin/events/series", body).then((r) => r.data),
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
};

// ---- Badges / Certificates / Finance / Audit (W4 over B1 + gamification) ----
export interface BadgeRow {
  code: string;
  name: string;
  description: string;
  category: "journey" | "consistency" | "community" | "service";
  icon_key: string | null;
  earned_count: number;
}

export interface CertificateRow {
  certificate_id: string;
  user_id: string;
  full_name: string;
  level_number: number | null;
  verification_code: string;
  issued_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
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
  createBadge: (body: Record<string, unknown>) => api.post("/admin/badges", body).then((r) => r.data),
  retireBadge: (code: string) => api.delete(`/admin/badges/${code}`).then((r) => r.data),

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

  financeSummary: () => api.get<{ funds: FundSummary[] }>("/admin/finance/summary").then((r) => r.data),
  transactions: (q: { fund?: string; status?: string; before?: string } = {}) =>
    api
      .get<{ data: TransactionRow[]; next_cursor: string | null }>("/admin/finance/transactions", { params: q })
      .then((r) => r.data),
  ledger: (limit = 100) =>
    api.get<{ data: LedgerRow[] }>("/admin/finance/ledger", { params: { limit } }).then((r) => r.data.data),

  audit: (q: { actor_id?: string; action?: string; entity?: string; before?: number } = {}) =>
    api.get<{ data: AuditRow[]; next_cursor: number | null }>("/admin/audit", { params: q }).then((r) => r.data),
};

// ---- Video Library (W2; Features v2 §V) ----
export type MediaStatus = "uploading" | "transcoding" | "ready" | "failed";

export interface MediaAssetRow {
  media_asset_id: string;
  kind: string;
  status: MediaStatus;
  provider: string;
  duration_sec: number | null;
  error_detail: string | null;
  created_at: string;
  attached_module_title: string | null;
  attached_module_id: string | null;
  is_stuck: boolean;
}

export interface UploadSession {
  upload_id: string;
  media_asset_id: string;
  signed_put_url: string;
  expires_at: string;
}

export const MediaApi = {
  list: () => api.get<{ data: MediaAssetRow[]; total: number; stuck: number }>("/admin/media").then((r) => r.data),
  createUpload: (kind = "lesson_video") =>
    api.post<UploadSession>("/admin/media/uploads", { kind }).then((r) => r.data),
  completeUpload: (uploadId: string) =>
    api.post<{ status: string }>(`/admin/media/uploads/${uploadId}/complete`, {}).then((r) => r.data),
  archive: (assetId: string) =>
    api.delete<{ archived: boolean }>(`/admin/media/${assetId}`).then((r) => r.data),
};
