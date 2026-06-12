// Mobile API client (spec §1.3, §5.3, §5.7). The base URL is configurable:
//   • iOS simulator     → http://localhost:8080/v1
//   • Android emulator  → http://10.0.2.2:8080/v1  (host alias; localhost is the emulator itself)
// Tokens come from a TokenVault (secure enclave); on 401 we rotate once and retry.
import axios, { type AxiosInstance } from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { MeResponse, PendingMutation, SyncPullResponse, SyncPushResponse, TokenPair } from "@nuru/shared";
import type { TokenVault } from "../auth/tokenVault";
import type {
  Achievements,
  AssembledQuiz,
  CalendarOccurrence,
  CompleteResult,
  EventDetail,
  GivingIntentResult,
  GivingRecord,
  GivingSchedule,
  Level,
  LevelModule,
  ModuleDetail,
  GiftAssessment,
  GiftQuestion,
  MyGifts,
  MyReflection,
  PathwaySummary,
  PrayerEntry,
  QuizResult,
  SavedVerse,
  ThreadDetail,
  ThreadSummary,
} from "./types";

export const api: AxiosInstance = axios.create({
  baseURL: "http://localhost:8080/v1",
  timeout: 15_000,
});

export function configureApiBase(url: string): void {
  api.defaults.baseURL = url;
}

/** Wire the vault: attach the access token, and refresh-retry once on 401 (§5.3). */
export function installAuth(vault: TokenVault): void {
  api.interceptors.request.use(async (config) => {
    const token = await vault.getAccess();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });
  api.interceptors.response.use(
    (res) => res,
    async (error: AxiosError) => {
      const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
      if (error.response?.status === 401 && original && !original._retry) {
        original._retry = true;
        const refreshToken = await vault.getRefresh();
        if (refreshToken) {
          const pair = await NuruApi.refresh(refreshToken);
          await vault.setTokens(pair.access_token, pair.refresh_token);
          original.headers.Authorization = `Bearer ${pair.access_token}`;
          return api(original);
        }
      }
      return Promise.reject(error);
    },
  );
}

export const NuruApi = {
  /** DEV ONLY: mint a session by email (no OAuth). 404s in production. */
  async devLogin(email: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/dev-login", { email });
    return data;
  },
  async refresh(refreshToken: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/token/refresh", { refresh_token: refreshToken });
    return data;
  },
  async me(): Promise<MeResponse> {
    const { data } = await api.get<MeResponse>("/me");
    return data;
  },
  // ---- Curriculum / pathway (real DB reads, server-gated) ----
  async levels(): Promise<Level[]> {
    const { data } = await api.get<{ data: Level[] }>("/levels");
    return data.data;
  },
  async pathway(): Promise<PathwaySummary> {
    const { data } = await api.get<PathwaySummary>("/me/pathway");
    return data;
  },
  async levelModules(levelNumber: number): Promise<LevelModule[]> {
    const { data } = await api.get<{ data: LevelModule[] }>(`/levels/${levelNumber}/modules`);
    return data.data;
  },
  async module(moduleId: string): Promise<ModuleDetail> {
    const { data } = await api.get<ModuleDetail>(`/modules/${moduleId}`);
    return data;
  },
  async completeModule(moduleId: string, body?: { reflection_text?: string }): Promise<CompleteResult> {
    const { data } = await api.post<CompleteResult>(`/modules/${moduleId}/complete`, body ?? {});
    return data;
  },
  // ---- Quiz (server-assembled, server-scored, §1.3/§3.7) ----
  async quiz(moduleId: string): Promise<AssembledQuiz> {
    const { data } = await api.get<AssembledQuiz>(`/modules/${moduleId}/quiz`);
    return data;
  },
  async submitQuiz(
    moduleId: string,
    body: { client_mutation_id: string; answers: Array<{ question_id: string; given_answer: string }> },
  ): Promise<QuizResult> {
    const { data } = await api.post<QuizResult>(`/modules/${moduleId}/quiz/attempts`, body);
    return data;
  },
  // ---- Calendar ----
  async calendar(from: string, to: string): Promise<CalendarOccurrence[]> {
    const { data } = await api.get<{ data: CalendarOccurrence[] }>("/calendar", { params: { from, to } });
    return data.data;
  },
  async event(eventId: string): Promise<EventDetail> {
    const { data } = await api.get<EventDetail>(`/events/${eventId}`);
    return data;
  },
  async rsvp(eventId: string, status: "going" | "maybe" | "declined"): Promise<unknown> {
    const { data } = await api.post(`/events/${eventId}/rsvp`, { status });
    return data;
  },
  // ---- Giving / achievements ----
  async givingHistory(): Promise<GivingRecord[]> {
    const { data } = await api.get<{ data: GivingRecord[] }>("/giving/history");
    return data.data;
  },
  async achievements(): Promise<Achievements> {
    const { data } = await api.get<Achievements>("/me/achievements");
    return data;
  },
  async logout(refreshToken: string): Promise<void> {
    await api.post("/auth/logout", { refresh_token: refreshToken });
  },
  async pull(body: { device_id?: string; cursors: Record<string, number> }): Promise<SyncPullResponse> {
    const { data } = await api.post<SyncPullResponse>("/sync/pull", body);
    return data;
  },
  async push(body: { device_id?: string; mutations: PendingMutation[] }): Promise<SyncPushResponse> {
    const { data } = await api.post<SyncPushResponse>("/sync/push", body);
    return data;
  },
  async giving(body: {
    fund: string;
    amount_minor: number;
    currency: string;
    method?: "card" | "mpesa" | "airtel";
    phone_number?: string;
    idempotency_key: string;
  }): Promise<GivingIntentResult> {
    const { data } = await api.post<GivingIntentResult>("/giving/intents", body);
    return data;
  },

  // ---- Recurring giving (M2 over B7; managed ONLINE-only, §3.6) ----
  async schedules(): Promise<GivingSchedule[]> {
    const { data } = await api.get<{ data: GivingSchedule[] }>("/giving/schedules");
    return data.data;
  },
  async createSchedule(body: {
    fund: string;
    amount_minor: number;
    currency: string;
    frequency: "weekly" | "monthly";
    method?: "card" | "mpesa" | "airtel";
    idempotency_key: string;
  }): Promise<unknown> {
    const { data } = await api.post("/giving/schedules", body);
    return data;
  },
  async cancelSchedule(id: string): Promise<unknown> {
    const { data } = await api.post(`/giving/schedules/${id}/cancel`);
    return data;
  },

  // ---- Community discussions (M2 over B8; client-generated ids = idempotent) ----
  async threads(): Promise<ThreadSummary[]> {
    const { data } = await api.get<{ data: ThreadSummary[] }>("/community/threads");
    return data.data;
  },
  async thread(id: string): Promise<ThreadDetail> {
    const { data } = await api.get<ThreadDetail>(`/community/threads/${id}`);
    return data;
  },
  async createThread(body: { thread_id: string; title: string; body: string; client_mutation_id: string }): Promise<unknown> {
    const { data } = await api.post("/community/threads", body);
    return data;
  },
  async addComment(
    threadId: string,
    body: { comment_id: string; body: string; client_mutation_id: string },
  ): Promise<unknown> {
    const { data } = await api.post(`/community/threads/${threadId}/comments`, body);
    return data;
  },

  // ---- Growth domains (M3 over B6; server-scored, user-private) ----
  async giftQuestions(): Promise<GiftQuestion[]> {
    const { data } = await api.get<{ data: GiftQuestion[] }>("/gifts/questions");
    return data.data;
  },
  async submitGifts(body: {
    client_mutation_id: string;
    answers: Array<{ question_id: string; value: number }>;
  }): Promise<GiftAssessment & { duplicate: boolean }> {
    const { data } = await api.post<GiftAssessment & { duplicate: boolean }>("/gifts/assessments", body);
    return data;
  },
  async myGifts(): Promise<MyGifts> {
    const { data } = await api.get<MyGifts>("/me/gifts");
    return data;
  },

  async prayers(): Promise<PrayerEntry[]> {
    const { data } = await api.get<{ data: PrayerEntry[] }>("/me/prayers");
    return data.data;
  },
  async upsertPrayer(body: {
    entry_id: string;
    title?: string | null;
    body: string;
    is_answered?: boolean;
    answered_note?: string | null;
    client_mutation_id?: string;
  }): Promise<unknown> {
    const { data } = await api.put("/me/prayers", body);
    return data;
  },
  async deletePrayer(entryId: string): Promise<unknown> {
    const { data } = await api.delete(`/me/prayers/${entryId}`);
    return data;
  },

  async verses(): Promise<SavedVerse[]> {
    const { data } = await api.get<{ data: SavedVerse[] }>("/me/verses");
    return data.data;
  },
  async saveVerse(body: {
    saved_verse_id: string;
    reference: string;
    version?: string;
    verse_text?: string | null;
    note?: string | null;
    client_mutation_id?: string;
  }): Promise<unknown> {
    const { data } = await api.put("/me/verses", body);
    return data;
  },
  async deleteVerse(savedVerseId: string): Promise<unknown> {
    const { data } = await api.delete(`/me/verses/${savedVerseId}`);
    return data;
  },

  // ---- Module reflection review state (M3 over B3); null = none submitted ----
  async myReflection(moduleId: string): Promise<MyReflection | null> {
    try {
      const { data } = await api.get<MyReflection>(`/modules/${moduleId}/reflection`);
      return data;
    } catch (e) {
      if ((e as AxiosError).response?.status === 404) return null;
      throw e;
    }
  },
};
