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
  GivingRecord,
  Level,
  LevelModule,
  ModuleDetail,
  PathwaySummary,
  QuizResult,
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
  async giving(body: { fund: string; amount_minor: number; currency: string; idempotency_key: string }): Promise<unknown> {
    const { data } = await api.post("/giving/intents", body);
    return data;
  },
};
