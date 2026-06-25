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
