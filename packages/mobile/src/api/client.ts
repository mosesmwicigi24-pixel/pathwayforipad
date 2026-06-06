// Mobile API client (spec §1.3, §5.3, §5.7). The base URL is configurable:
//   • iOS simulator     → http://localhost:8080/v1
//   • Android emulator  → http://10.0.2.2:8080/v1  (host alias; localhost is the emulator itself)
// Tokens come from a TokenVault (secure enclave); on 401 we rotate once and retry.
import axios, { type AxiosInstance } from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { MeResponse, PendingMutation, SyncPullResponse, SyncPushResponse, TokenPair } from "@nuru/shared";
import type { TokenVault } from "../auth/tokenVault";

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
