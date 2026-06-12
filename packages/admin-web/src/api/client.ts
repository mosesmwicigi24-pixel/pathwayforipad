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
  /** DEV ONLY: mint a session by email (no OAuth). 404s in production. */
  async devLogin(email: string): Promise<DevSession> {
    const { data } = await api.post<DevSession>("/auth/dev-login", { email });
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

export const AdminApi = {
  async overview(): Promise<OverviewKpis> {
    const { data } = await api.get<OverviewKpis>("/admin/reports/overview");
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
};

// ---- Curriculum CMS (Admin/SuperAdmin) ----
export type EvaluationKind = "none" | "reflection" | "quiz" | "exit_exam";
export type ModuleStatus = "draft" | "published" | "archived";

export interface AdminLevel {
  level_number: number;
  title: string;
  theme: string | null;
  required_exam_pass_mark: string;
  exam_question_count: number | null;
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
  createLevel: (body: { title: string; theme?: string; required_exam_pass_mark?: number }) =>
    api.post<AdminLevel>("/admin/levels", body).then((r) => r.data),
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
  deleteQuestion: (qid: string) => api.delete<{ deleted: boolean }>(`/admin/questions/${qid}`).then((r) => r.data),
};
