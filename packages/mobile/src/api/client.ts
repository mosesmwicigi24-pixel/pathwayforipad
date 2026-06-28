// Mobile API client (spec §1.3, §5.3, §5.7). The base URL is configurable:
//   • iOS simulator     → http://localhost:8080/v1
//   • Android emulator  → http://10.0.2.2:8080/v1  (host alias; localhost is the emulator itself)
// Tokens come from a TokenVault (secure enclave); on 401 we rotate once and retry.
import axios, { type AxiosInstance } from "axios";
import type { AxiosError, InternalAxiosRequestConfig } from "axios";
import type { LoginResult, MeResponse, MfaElevation, MfaEnroll, PendingMutation, SyncPullResponse, SyncPushResponse, TokenPair } from "@nuru/shared";
import type { TokenVault } from "../auth/tokenVault";
import { navigationRef } from "../navigation/navigationRef";
import { apiBaseUrl } from "../config";
import type {
  Achievements,
  AssembledQuiz,
  CalendarOccurrence,
  EventSeries,
  CellSummary,
  CertificateRow,
  CertificateVerification,
  CompleteResult,
  EventDetail,
  EventPost,
  PostReactionResult,
  ReactionKind,
  GivingIntentResult,
  GivingRecord,
  GivingDetail,
  GivingSchedule,
  Level,
  LevelModule,
  LevelEncouragement,
  ModuleDetail,
  GiftAssessment,
  GiftQuestionSet,
  MyAnnouncement,
  NotificationRow,
  ScripturePassage,
  MyGifts,
  MyRsvp,
  Devotional,
  MemoryVerseRow,
  ReadingPlanRow,
  ReadingPlanDetail,
  SegmentCompleteResult,
  ResourceRow,
  Moment,
  MentorInfo,
  Discipler,
  GrowthScore,
  ScoresSummary,
  NextAction,
  TailoredVerse,
  VerseReactions,
  PrayerWallPost,
  PrayerWallDetail,
  MyReflection,
  PathwaySummary,
  PrayerEntry,
  QuizResult,
  SavedVerse,
  ThreadDetail,
  ThreadSummary,
  ChatInbox,
  ChatThreadDetail,
  ChatReaders,
  ChatPerson,
  NuruTurn,
  WelcomeVideo,
  ReactionToggleResult,
  RhythmToday,
  FeaturedCell,
  AnnouncementDetail,
  FeaturedEvent,
  FeaturedAnnouncement,
} from "./types";

export const api: AxiosInstance = axios.create({
  baseURL: apiBaseUrl(), // env override → localhost default; App.tsx re-applies with Platform.OS
  // 30s, not 15s: password endpoints run Argon2id, which can take several seconds
  // on a small/cold server. A tight timeout aborts a request that is actually
  // succeeding and surfaces as a misleading "can't reach the server" error.
  timeout: 30_000,
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
          try {
            // SINGLE-FLIGHT refresh. The Home screen fires ~20 requests at once, so
            // an expired access token produces a burst of simultaneous 401s. Refresh
            // tokens are one-time-use + rotated, and reusing a burned token trips the
            // backend's reuse-detection and revokes the WHOLE family (logging the user
            // out). So every concurrent 401 must share ONE refresh — the first 401
            // spends the token, the rest await the same result. (§5.3)
            const pair = await refreshSession(vault, refreshToken);
            original.headers.Authorization = `Bearer ${pair.access_token}`;
            return api(original);
          } catch (refreshErr) {
            // Session is genuinely dead (refresh token revoked/expired) — the only
            // ways out besides explicit logout. Clear the vault and return to Login
            // so the user re-authenticates. (Offline failures are network errors,
            // not 401s, so they never reach here — the session stays put.)
            await vault.clear().catch(() => undefined);
            if (navigationRef.isReady()) navigationRef.reset({ index: 0, routes: [{ name: "Login" }] });
            return Promise.reject(refreshErr);
          }
        }
      }
      return Promise.reject(error);
    },
  );
}

// A single in-flight refresh shared across all concurrent 401s, so the one-time-use
// refresh token is spent exactly once per expiry (preventing the reuse-detection
// logout). The gate resets once the refresh settles so the next genuine expiry can
// refresh again.
let refreshInFlight: Promise<TokenPair> | null = null;
function refreshSession(vault: TokenVault, refreshToken: string): Promise<TokenPair> {
  if (!refreshInFlight) {
    refreshInFlight = NuruApi.refresh(refreshToken).then(async (pair) => {
      await vault.setTokens(pair.access_token, pair.refresh_token);
      return pair;
    });
    // Clear the gate after it settles (either way) without swallowing the result.
    void refreshInFlight.then(
      () => { refreshInFlight = null; },
      () => { refreshInFlight = null; },
    );
  }
  return refreshInFlight;
}

// Cloudinary signed-upload params from POST /chat/attachments/sign. The upload is a
// multipart POST to `upload_url` (https://api.cloudinary.com/v1_1/<cloud>/auto/upload).
export interface CloudinarySign {
  cloud_name: string;
  api_key: string;
  timestamp: number;
  folder: string;
  signature: string;
  upload_url: string;
}

export const NuruApi = {
  /** DEV ONLY: mint a session by email (no OAuth). 404s in production. */
  async devLogin(email: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/dev-login", { email });
    return data;
  },
  /** Email + password sign-in. Returns a token pair, OR a 2FA challenge when the
   *  account has a second factor on — complete it via loginCompleteMfa. */
  async login(email: string, password: string): Promise<LoginResult> {
    const { data } = await api.post<LoginResult>("/auth/login", { email, password });
    return data;
  },
  /** Second step of a 2FA login: exchange the challenge token + code for a session. */
  async loginCompleteMfa(mfaToken: string, code: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/login/mfa", { mfa_token: mfaToken, code });
    return data;
  },
  /** Begin TOTP enrollment — returns an otpauth:// URI (QR) + the base32 secret. */
  async mfaEnroll(): Promise<MfaEnroll> {
    const { data } = await api.post<MfaEnroll>("/auth/mfa/enroll", {});
    return data;
  },
  /** Confirm enrollment with the first code; on first enable returns recovery codes. */
  async mfaVerify(code: string): Promise<MfaElevation> {
    const { data } = await api.post<MfaElevation>("/auth/mfa/verify", { code });
    return data;
  },
  /** Turn 2FA off (requires a current TOTP or recovery code). */
  async mfaDisable(code: string): Promise<{ mfa_enabled: boolean }> {
    const { data } = await api.post<{ mfa_enabled: boolean }>("/auth/mfa/disable", { code });
    return data;
  },
  /** Self-service sign-up; returns a session (auto sign-in). */
  async register(fullName: string, email: string, password: string): Promise<TokenPair> {
    const { data } = await api.post<TokenPair>("/auth/register", {
      full_name: fullName,
      email,
      password,
    });
    return data;
  },
  /** Request a password-reset link. Always resolves (no account enumeration). */
  async forgotPassword(email: string): Promise<{ sent: boolean; dev_token?: string }> {
    const { data } = await api.post<{ sent: boolean; dev_token?: string }>("/auth/password/forgot", {
      email,
    });
    return data;
  },
  /** Consume a reset token and set a new password. */
  async resetPassword(token: string, newPassword: string): Promise<{ reset: boolean }> {
    const { data } = await api.post<{ reset: boolean }>("/auth/password/reset", {
      token,
      new_password: newPassword,
    });
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
  /** Persist editable profile fields (optimistic concurrency via row_version). */
  async updateMe(
    patch: Record<string, unknown>,
    rowVersion: number,
  ): Promise<{ user_id: string; row_version: number }> {
    const { data } = await api.patch<{ user_id: string; row_version: number }>("/me", {
      ...patch,
      row_version: rowVersion,
    });
    return data;
  },
  /** Change the account password (current + new). */
  async changePassword(currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
    const { data } = await api.post<{ changed: boolean }>("/me/password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
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
  async levelEncouragements(levelNumber: number): Promise<LevelEncouragement[]> {
    const { data } = await api.get<{ data: LevelEncouragement[] }>(`/levels/${levelNumber}/encouragements`);
    return data.data;
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
  async myRsvps(): Promise<MyRsvp[]> {
    const { data } = await api.get<{ data: MyRsvp[] }>("/me/rsvps");
    return data.data;
  },
  async rsvp(eventId: string, status: "going" | "maybe" | "declined"): Promise<unknown> {
    const { data } = await api.post(`/events/${eventId}/rsvp`, { status });
    return data;
  },
  async eventPosts(eventId: string): Promise<EventPost[]> {
    const { data } = await api.get<{ data: EventPost[] }>(`/events/${encodeURIComponent(eventId)}/posts`);
    return data.data;
  },
  async createEventPost(eventId: string, body: { post_id: string; body?: string | null; image_url?: string | null; client_mutation_id?: string }): Promise<{ post_id: string }> {
    const { data } = await api.post<{ post_id: string }>(`/events/${encodeURIComponent(eventId)}/posts`, body);
    return data;
  },
  async reactToEventPost(eventId: string, postId: string, kind: ReactionKind | null): Promise<PostReactionResult> {
    const { data } = await api.post<PostReactionResult>(
      `/events/${encodeURIComponent(eventId)}/posts/${encodeURIComponent(postId)}/react`,
      { kind },
    );
    return data;
  },
  async eventSeries(): Promise<EventSeries[]> {
    const { data } = await api.get<{ data: EventSeries[] }>("/calendar/series");
    return data.data;
  },
  async followSeries(seriesId: string): Promise<{ series_id: string; following: boolean }> {
    const { data } = await api.post<{ series_id: string; following: boolean }>(`/calendar/series/${seriesId}/follow`, {});
    return data;
  },
  async cellSummary(): Promise<CellSummary> {
    const { data } = await api.get<CellSummary>("/me/cell-summary");
    return data;
  },
  // ---- Giving / achievements ----
  async givingHistory(): Promise<GivingRecord[]> {
    const { data } = await api.get<{ data: GivingRecord[] }>("/giving/history");
    return data.data;
  },
  async givingDetail(transactionId: string): Promise<GivingDetail> {
    const { data } = await api.get<GivingDetail>(`/giving/transactions/${transactionId}`);
    return data;
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
    method?: "card" | "mpesa" | "airtel" | "paypal";
    phone_number?: string;
    idempotency_key: string;
  }): Promise<GivingIntentResult> {
    const { data } = await api.post<GivingIntentResult>("/giving/intents", body);
    return data;
  },
  async capturePayPalGift(orderId: string): Promise<{ status: string }> {
    const { data } = await api.post<{ status: string }>("/giving/paypal/capture", { order_id: orderId });
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

  // ---- Chat: DMs, cell groups, public spaces (mobile Chat make) ----
  async chatInbox(): Promise<ChatInbox> {
    // Always the member's own inbox (their Spaces/DMs/Groups). scope=mine matters
    // for staff accounts: without it a moderator gets the oversight inbox (every
    // conversation, with no DM name/photo) instead of their personal one.
    const { data } = await api.get<ChatInbox>("/chat/conversations", { params: { scope: "mine" } });
    return data;
  },
  async chatConversation(id: string): Promise<ChatThreadDetail> {
    const { data } = await api.get<ChatThreadDetail>(`/chat/conversations/${id}`);
    return data;
  },
  async sendChatMessage(
    conversationId: string,
    body: {
      message_id: string;
      body: string;
      reply_to_id?: string;
      msg_type?: "text" | "image" | "voice" | "video" | "file";
      attachment_url?: string;
      attachment_meta?: Record<string, unknown>;
      client_mutation_id: string;
    },
  ): Promise<unknown> {
    const { data } = await api.post(`/chat/conversations/${conversationId}/messages`, body);
    return data;
  },
  async markChatRead(conversationId: string): Promise<unknown> {
    const { data } = await api.post(`/chat/conversations/${conversationId}/read`, {});
    return data;
  },
  async toggleChatReaction(messageId: string, emoji: string): Promise<{ on: boolean }> {
    const { data } = await api.post<{ on: boolean }>(`/chat/messages/${messageId}/reactions`, { emoji });
    return data;
  },
  // Read receipts: who has seen my message (the "eye" / Seen-by view).
  async chatMessageReaders(messageId: string): Promise<ChatReaders> {
    const { data } = await api.get<ChatReaders>(`/chat/messages/${messageId}/readers`);
    return data;
  },
  // Author-only edit / delete of a sent message (online; mirrors reactions).
  async editChatMessage(messageId: string, body: string): Promise<{ message_id: string; body: string; is_edited: boolean }> {
    const { data } = await api.patch<{ message_id: string; body: string; is_edited: boolean }>(`/chat/messages/${messageId}`, { body });
    return data;
  },
  async deleteChatMessage(messageId: string): Promise<{ deleted: boolean }> {
    const { data } = await api.delete<{ deleted: boolean }>(`/chat/messages/${messageId}`);
    return data;
  },
  async createDm(userId: string): Promise<{ conversation_id: string }> {
    const { data } = await api.post<{ conversation_id: string }>("/chat/dms", { user_id: userId });
    return data;
  },
  async chatPeople(q?: string): Promise<{ people: ChatPerson[] }> {
    const { data } = await api.get<{ people: ChatPerson[] }>("/chat/people", q ? { params: { q } } : undefined);
    return data;
  },
  async joinSpace(conversationId: string): Promise<{ conversation_id: string; joined: boolean }> {
    const { data } = await api.post<{ conversation_id: string; joined: boolean }>(`/chat/spaces/${conversationId}/join`, {});
    return data;
  },

  // ---- Chat attachments (bytes go direct to Cloudinary, never our server) ----
  async signChatAttachment(body: {
    content_type: string;
    kind?: "image" | "voice" | "video" | "file";
  }): Promise<CloudinarySign> {
    const { data } = await api.post<CloudinarySign>("/chat/attachments/sign", body);
    return data;
  },
  /** Upload my profile photo to our server (multipart); returns the stored URL. */
  async uploadAvatar(asset: { uri: string; name: string; type: string }): Promise<{ avatar_url: string }> {
    const form = new FormData();
    form.append("file", { uri: asset.uri, name: asset.name, type: asset.type } as unknown as Blob);
    const { data } = await api.post<{ avatar_url: string }>("/me/avatar", form);
    return data;
  },
  /** Multipart POST a local RN file straight to Cloudinary with the server-signed params. */
  async uploadChatAttachment(
    sign: CloudinarySign,
    asset: { uri: string; name: string; type: string },
  ): Promise<{ secure_url: string; public_id: string; bytes: number }> {
    const form = new FormData();
    // RN's FormData accepts a {uri,name,type} file object (typed loosely).
    form.append("file", { uri: asset.uri, name: asset.name, type: asset.type } as unknown as Blob);
    form.append("api_key", sign.api_key);
    form.append("timestamp", String(sign.timestamp));
    form.append("folder", sign.folder);
    form.append("signature", sign.signature);
    const res = await fetch(sign.upload_url, { method: "POST", body: form });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
    }
    const data = (await res.json()) as { secure_url: string; public_id: string; bytes: number };
    return data;
  },
  async resolveMediaUrl(key: string): Promise<{ url: string; expires_at: string }> {
    const { data } = await api.get<{ url: string; expires_at: string }>("/media/url", { params: { key } });
    return data;
  },

  // ---- Nuru AI assistant (server-side proxy; key never on device) ----
  async assistantHistory(): Promise<{ messages: Array<{ role: "user" | "assistant"; text: string; created_at: string }> }> {
    const { data } = await api.get<{ messages: Array<{ role: "user" | "assistant"; text: string; created_at: string }> }>("/assistant/history");
    return data;
  },
  async assistantChat(body: { messages: NuruTurn[]; conversation_id?: string; context_limit?: number }): Promise<{ reply: string }> {
    const { data } = await api.post<{ reply: string }>("/assistant/chat", body);
    return data;
  },

  // ---- Growth domains (M3 over B6; server-scored, user-private) ----
  async giftQuestions(): Promise<GiftQuestionSet> {
    const { data } = await api.get<GiftQuestionSet>("/gifts/questions");
    return data;
  },
  async submitGifts(body: {
    client_mutation_id: string;
    set_id: string;
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

  // ---- Notification center + home extras (D1) ----
  async notifications(): Promise<{ data: NotificationRow[]; unread: number }> {
    const { data } = await api.get<{ data: NotificationRow[]; unread: number }>("/me/notifications");
    return data;
  },
  async markNotificationsRead(ids?: string[]): Promise<{ marked: number }> {
    const { data } = await api.post<{ marked: number }>("/me/notifications/read", ids?.length ? { ids } : {});
    return data;
  },
  async myAnnouncements(): Promise<MyAnnouncement[]> {
    const { data } = await api.get<{ data: MyAnnouncement[] }>("/me/announcements");
    return data.data;
  },
  async openAnnouncement(id: string): Promise<unknown> {
    const { data } = await api.post(`/announcements/${id}/open`);
    return data;
  },
  async announcement(id: string): Promise<AnnouncementDetail> {
    const { data } = await api.get<AnnouncementDetail>(`/announcements/${id}`);
    return data;
  },
  async featuredEvent(): Promise<FeaturedEvent | null> {
    const { data } = await api.get<{ data: FeaturedEvent | null }>("/home/featured-event");
    return data.data;
  },
  async featuredAnnouncement(): Promise<FeaturedAnnouncement | null> {
    const { data } = await api.get<{ data: FeaturedAnnouncement | null }>("/home/featured-announcement");
    return data.data;
  },
  async scripture(ref: string, version?: string): Promise<ScripturePassage> {
    const { data } = await api.get<ScripturePassage>("/scripture", {
      params: { ref, ...(version ? { version } : {}) },
    });
    return data;
  },

  // ---- Growth content (D5 over B9) ----
  async devotional(): Promise<Devotional> {
    const { data } = await api.get("/growth/devotional");
    return data as Devotional;
  },
  async memoryVerses(): Promise<MemoryVerseRow[]> {
    const { data } = await api.get<{ data: MemoryVerseRow[] }>("/growth/memory-verses");
    return data.data;
  },
  async practiceVerse(memory_verse_id: string, match_pct: number): Promise<unknown> {
    const { data } = await api.post("/growth/memory-verses/practice", { memory_verse_id, match_pct });
    return data;
  },
  async plans(): Promise<ReadingPlanRow[]> {
    const { data } = await api.get<{ data: ReadingPlanRow[] }>("/growth/plans");
    return data.data;
  },
  async plan(id: string): Promise<ReadingPlanDetail> {
    const { data } = await api.get(`/growth/plans/${id}`);
    return data as ReadingPlanDetail;
  },
  async startPlan(id: string): Promise<unknown> {
    const { data } = await api.post(`/growth/plans/${id}/start`);
    return data;
  },
  async completePlanDay(id: string, day_number: number): Promise<unknown> {
    const { data } = await api.post(`/growth/plans/${id}/complete-day`, { day_number });
    return data;
  },
  /** Mark one plan-day segment complete (YouVersion reader). */
  async completePlanSegment(segmentId: string): Promise<SegmentCompleteResult> {
    const { data } = await api.post<SegmentCompleteResult>(`/growth/segments/${segmentId}/complete`, {});
    return data;
  },
  async resources(): Promise<ResourceRow[]> {
    const { data } = await api.get<{ data: ResourceRow[] }>("/growth/resources");
    return data.data;
  },
  async moments(): Promise<Moment[]> {
    const { data } = await api.get<{ data: Moment[] }>("/moments");
    return data.data;
  },
  async mentor(): Promise<MentorInfo> {
    const { data } = await api.get("/growth/mentor");
    return data as MentorInfo;
  },

  // ---- Growth scores (server-authoritative; GET /me/scores/*) ----
  async wordScore(): Promise<GrowthScore> {
    const { data } = await api.get<GrowthScore>("/me/scores/word");
    return data;
  },
  async scores(): Promise<ScoresSummary> {
    const { data } = await api.get<ScoresSummary>("/me/scores");
    return data;
  },
  // ---- Server-driven Home: the next-best-action hero (GET /me/home/next-action) ----
  async nextAction(): Promise<{ action: NextAction | null }> {
    const { data } = await api.get<{ action: NextAction | null }>("/me/home/next-action");
    return data;
  },
  async dailyGreeting(): Promise<{ greeting: string }> {
    const { data } = await api.get<{ greeting: string }>("/me/home/greeting");
    return data;
  },
  // Tailored "Verse for today" — server chooses the reference for this member.
  async homeVerse(): Promise<TailoredVerse> {
    const { data } = await api.get<TailoredVerse>("/me/home/verse");
    return data;
  },
  // Verse-of-the-day reactions — community counts + my reaction (one per member/day,
  // exclusive: tapping a new emoji moves my vote; tapping my current one clears it).
  async verseReactions(): Promise<VerseReactions> {
    const { data } = await api.get<VerseReactions>("/me/home/verse/reactions");
    return data;
  },
  async setVerseReaction(emoji: string): Promise<VerseReactions> {
    const { data } = await api.post<VerseReactions>("/me/home/verse/reactions", { emoji });
    return data;
  },
  // ---- Prayer Wall (public, opt-in; GET/POST /prayer-wall) ----
  async prayerWall(sort?: "latest" | "prayed"): Promise<PrayerWallPost[]> {
    const { data } = await api.get<{ data: PrayerWallPost[] }>(`/prayer-wall${sort ? `?sort=${sort}` : ""}`);
    return data.data;
  },
  async prayerWallHome(): Promise<PrayerWallPost[]> {
    const { data } = await api.get<{ data: PrayerWallPost[] }>("/home/prayer-wall");
    return data.data;
  },
  async prayerWallGet(postId: string): Promise<PrayerWallDetail> {
    const { data } = await api.get<PrayerWallDetail>(`/prayer-wall/${postId}`);
    return data;
  },
  async createPrayerWallPost(body: { post_id: string; title?: string | null; body: string; audio_url?: string | null; audio_waveform?: number[] | null; client_mutation_id?: string }): Promise<{ post_id: string }> {
    const { data } = await api.post<{ post_id: string }>("/prayer-wall", body);
    return data;
  },
  async prayerWallReact(postId: string, emoji: string): Promise<{ on: boolean }> {
    const { data } = await api.post<{ on: boolean }>(`/prayer-wall/${postId}/reactions`, { emoji });
    return data;
  },
  async prayerWallComment(postId: string, body: { comment_id: string; body: string; audio_url?: string | null; audio_waveform?: number[] | null; client_mutation_id?: string }): Promise<{ comment_id: string }> {
    const { data } = await api.post<{ comment_id: string }>(`/prayer-wall/${postId}/comments`, body);
    return data;
  },
  async prayerWallAnswered(postId: string, answered: boolean): Promise<{ is_answered: boolean }> {
    const { data } = await api.post<{ is_answered: boolean }>(`/prayer-wall/${postId}/answered`, { answered });
    return data;
  },
  async deletePrayerWallPost(postId: string): Promise<{ deleted: boolean }> {
    const { data } = await api.delete<{ deleted: boolean }>(`/prayer-wall/${postId}`);
    return data;
  },
  async sharePrayerToWall(entryId: string): Promise<{ post_id: string }> {
    const { data } = await api.post<{ post_id: string }>(`/me/prayers/${entryId}/share-to-wall`);
    return data;
  },
  // ---- Disciplers carousel (Home "Meet your discipler", GET /home/disciplers) ----
  async disciplers(): Promise<Discipler[]> {
    const { data } = await api.get<{ data: Discipler[] }>("/home/disciplers");
    return data.data;
  },

  // ---- Homepage welcome video (PR #120); null when none is set ----
  async welcomeVideo(): Promise<WelcomeVideo | null> {
    const { data } = await api.get<WelcomeVideo | null>("/home/welcome-video");
    return data;
  },
  /** Toggle a reaction (emoji; ❤️ = Like) on a media asset. */
  async toggleMediaReaction(mediaAssetId: string, emoji: string): Promise<ReactionToggleResult> {
    const { data } = await api.post<ReactionToggleResult>(`/media/${mediaAssetId}/reactions`, { emoji });
    return data;
  },

  // ---- Homepage-featured cell ("This week at Nuru", PR #125); null when none ----
  async featuredCell(): Promise<FeaturedCell | null> {
    const { data } = await api.get<FeaturedCell | null>("/home/featured-cell");
    return data;
  },

  // ---- Today's Rhythm (prayer / word / reflection) ----
  async rhythmToday(): Promise<RhythmToday> {
    const { data } = await api.get<RhythmToday>("/me/rhythm/today");
    return data;
  },
  async completeRhythm(kind: "prayer" | "word" | "reflection"): Promise<RhythmToday> {
    const { data } = await api.post<RhythmToday>("/me/rhythm/complete", { kind });
    return data;
  },
  // ---- Devotional reflection (saved; also marks the Reflection rhythm) ----
  async saveDevotionalReflection(devotionalId: string, body: string): Promise<{ saved: true }> {
    const { data } = await api.post<{ saved: true }>("/growth/devotional/reflection", {
      devotional_id: devotionalId,
      body,
    });
    return data;
  },

  // ---- Certificates (member, real + verifiable) ----
  async certificates(): Promise<CertificateRow[]> {
    const { data } = await api.get<{ data: CertificateRow[] }>("/certificates");
    return data.data;
  },
  /** Public verification endpoint (no auth needed; bearer is harmless). */
  async verifyCertificate(code: string): Promise<CertificateVerification> {
    const { data } = await api.get<CertificateVerification>(`/verify/${encodeURIComponent(code)}`);
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
