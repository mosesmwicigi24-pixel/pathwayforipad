// API response/request DTOs — the wire shapes the API serialises, distinct from
// the raw row models in ./models.ts (§5.8 "Excessive data exposure"). Shared so
// the mobile + admin clients and the backend agree on the contract.
import type { UUID, ISODate, ISODateTime } from "./models.js";
import type { EnrollmentState, UserRole } from "./enums.js";

// --- Auth (§3.3, §5.3) ---
export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
}

export interface MfaElevation {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  mfa_enabled: boolean;
  /** One-time recovery codes — present ONLY on the call that first enables 2FA. */
  recovery_codes?: string[];
}

/** Begin TOTP enrollment: an otpauth:// URI (for the QR) + the base32 secret. */
export interface MfaEnroll {
  otpauth_uri: string;
  secret: string;
}

/** Returned by /auth/login when the account has 2FA on. */
export interface MfaChallenge {
  mfa_required: true;
  mfa_token: string;
}

export type LoginResult = TokenPair | MfaChallenge;

// --- Profile (§3.3 /me) ---
export interface UserProfile {
  user_id: UUID;
  email: string | null;
  full_name: string;
  phone_number: string | null;
  date_of_birth: ISODate | null;
  year_of_salvation: number | null;
  is_baptized: boolean;
  cell_group_id: UUID | null;
  congregation_id: UUID | null;
  role: UserRole;
  timezone: string;
  locale: string;
  is_minor: boolean;
  gender?: "male" | "female" | "prefer_not_to_say" | null;
  city?: string | null;
  country_code?: string | null;
  socials?: Record<string, string>;
  avatar_url?: string | null;
  mfa_enabled?: boolean;
  row_version: number;
}

export interface EnrollmentSummary {
  enrollment_id: UUID;
  current_level: number;
  state: EnrollmentState;
  started_at: ISODateTime;
}

export interface MeResponse {
  profile: UserProfile;
  enrollment: EnrollmentSummary | null;
}

// --- Radio Broadcast Studio + Virtual Audio Mixer (docs/RADIO_STUDIO_CONTRACT.md) ---

export type RadioCategory = "Sermon" | "Worship" | "Prayer" | "Bible Study" | "Conference";
export type RadioVisibility = "public" | "members" | "private";
export type RadioProgramStatus = "draft" | "scheduled" | "live" | "ended";
export type RadioRecordTarget = "cloud" | "local" | "both";
export type RadioReactionKind = "heart" | "amen" | "fire";
export type RadioTrackKind = "music" | "preaching" | "audio";
export type RadioLoopMode = "none" | "loop_all" | "repeat_one";

/** A reusable audio-library asset (music/preaching/audio). Members DO get audio_url. */
export interface RadioTrack {
  id: UUID;
  title: string;
  kind: RadioTrackKind;
  audio_url: string;
  duration_sec: number | null;
  size_bytes: number | null;
  created_by: UUID | null;
  created_at: ISODateTime;
}

/** One ordered slot in a session playlist, embedding its track. */
export interface RadioPlaylistItem {
  id: UUID;
  position: number;
  track: RadioTrack;
}

/** Admin projection — includes the ingest secrets (stream_key/ingest_url/ingest_provider). */
export interface RadioProgram {
  id: UUID;
  title: string;
  description: string | null;
  category: RadioCategory;
  speaker: string | null;
  location: string | null;
  artwork_url: string | null;
  tags: string[];
  visibility: RadioVisibility;
  scheduled_at: ISODateTime | null;
  duration_min: number | null;
  repeat: string | null;
  timezone: string | null;
  status: RadioProgramStatus;
  loop_mode: RadioLoopMode;
  is_live: boolean;
  live_started_at: ISODateTime | null;
  live_ended_at: ISODateTime | null;
  audio_url: string | null;
  audio_duration_sec: number | null;
  auto_go_live: boolean;
  record_broadcast: boolean;
  record_target: RadioRecordTarget | null;
  peak_listeners: number;
  ingest_provider: string | null;
  ingest_url: string | null;
  stream_key: string | null;
  hls_url: string | null;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

/**
 * Member/public projection — OMITS stream_key, ingest_url, ingest_provider.
 * The detail/now-playing reads populate `tracks` with the ordered session playlist
 * (each item embeds its track incl. audio_url) so the player can play the session.
 */
export type RadioProgramPublic = Omit<RadioProgram, "stream_key" | "ingest_url" | "ingest_provider"> & {
  tracks?: RadioPlaylistItem[];
};

export interface RadioReactionCounts {
  heart: number;
  amen: number;
  fire: number;
}

export interface RadioComment {
  id: UUID;
  program_id: UUID;
  member_id: UUID;
  body: string;
  hidden: boolean;
  client_event_id: string | null;
  created_at: ISODateTime;
  /** Comment author's display name (users LEFT JOIN — null when the member is gone). */
  author_name?: string | null;
  author_avatar_url?: string | null;
}

/** One real listener in a live program's roster (server-authoritative presence). */
export interface RadioListener {
  user_id: UUID;
  name: string;
  avatar_url: string | null;
}

/** Live listener roster + real active count (GET /radio/programs/:id/listeners). */
export interface RadioListenerRoster {
  count: number;
  listeners: RadioListener[];
}

/** Operational health of a live broadcast (admin live status bar). */
export interface StreamHealth {
  cpu: number;
  memory: number;
  bitrate: number;
  latency: number;
  dropped: number;
  stability: number;
  listeners: number;
  /** Current on-air track from the stream's icy metadata (null when unknown). */
  now_playing?: string | null;
}

/** A single mixer channel strip within a scene. */
export interface MixerChannel {
  id: string;
  name: string;
  sub?: string;
  color?: string;
  level?: number;
  pan?: number;
  muted?: boolean;
  solo?: boolean;
}

export interface MixerScene {
  id: UUID;
  name: string;
  hint: string | null;
  channels: MixerChannel[];
  is_default: boolean;
  created_by: UUID | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface MixerJingle {
  id: UUID;
  label: string;
  color: string | null;
  audio_url: string | null;
  sort: number;
  created_by: UUID | null;
  created_at: ISODateTime;
}

// --- Radio request bodies ---

export interface CreateRadioProgramBody {
  title: string;
  description?: string;
  category: RadioCategory;
  speaker?: string;
  location?: string;
  artwork_url?: string;
  tags?: string[];
  visibility?: RadioVisibility;
  scheduled_at?: ISODateTime;
  duration_min?: number;
  repeat?: string;
  timezone?: string;
  loop_mode?: RadioLoopMode;
  audio_url?: string;
  audio_duration_sec?: number;
  auto_go_live?: boolean;
  record_broadcast?: boolean;
  record_target?: RadioRecordTarget;
}

export type UpdateRadioProgramBody = Partial<CreateRadioProgramBody> & {
  status?: RadioProgramStatus;
};

/** Bare result of POST /admin/media/audio/upload (no media_assets row). */
export interface AudioUploadResult {
  url: string;
  duration_sec: number | null;
}

export interface RadioReactBody {
  kind: RadioReactionKind;
  client_event_id: string;
}

export interface RadioCommentBody {
  body: string;
  client_event_id: string;
}

export interface CreateRadioTrackBody {
  title: string;
  kind: RadioTrackKind;
  audio_url: string;
  duration_sec?: number;
  size_bytes?: number;
}

export interface AddPlaylistItemBody {
  track_id: UUID;
}

export interface ReorderPlaylistBody {
  item_ids: UUID[];
}

export interface MixerSceneBody {
  name: string;
  hint?: string;
  channels?: MixerChannel[];
  is_default?: boolean;
}

export type MixerSceneUpdateBody = Partial<MixerSceneBody>;

export interface MixerJingleBody {
  label: string;
  color?: string;
  audio_url?: string;
  sort?: number;
}

// --- LIVE MIX control (liquidsoap engine on the VPS) ---

/** The four live-mix channels the engine exposes. */
export type MixerLiveChannels = "mic" | "bed" | "jingle" | "master";

/** POST /admin/radio/mixer/live/levels — gains are ints 0..100; at least one channel. */
export interface MixerLiveLevelsBody {
  channels: Partial<Record<MixerLiveChannels, number>>;
}

/** The three live-mix buses carrying a 3-band peaking EQ. */
export type MixerEqBus = "mic" | "bed" | "master";

/** The three EQ bands per bus. */
export type MixerEqBand = "low" | "mid" | "high";

/** POST /admin/radio/mixer/live/eq — per-bus band gains in dB (−12..+12, default 0); at least one value overall. */
export interface MixerLiveEqBody {
  bands: Partial<Record<MixerEqBus, Partial<Record<MixerEqBand, number>>>>;
}

/** POST /admin/radio/mixer/live/scene — apply a saved mixer scene to the live mix. */
export interface MixerLiveSceneBody {
  scene_id: UUID;
}

/** POST /admin/radio/mixer/live/jingle — fire a server-hosted jingle on air. */
export interface MixerLiveJingleBody {
  jingle_id: UUID;
}

/** GET /admin/radio/mixer/live/status — never 503s; gains (0..100) when connected. */
export interface MixerLiveStatus {
  connected: boolean;
  gains?: Record<string, number>;
}
