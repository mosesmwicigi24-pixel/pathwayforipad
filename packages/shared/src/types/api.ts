// API envelope + error taxonomy — §3.1 conventions and §3.2 error catalog.

export interface ErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

// §3.2 error catalog (code → typical HTTP status).
export const API_ERROR_CODES = {
  VALIDATION_FAILED: 400,
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN_SCOPE: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VERSION_STALE: 409,
  GATE_LOCKED: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  UPSTREAM_UNAVAILABLE: 503,
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_CODES;

// Cursor-paginated list envelope (§3.1 — no offset pagination on large tables).
export interface Paginated<T> {
  data: T[];
  next_cursor: string | null;
}

// Money is always { amount_minor, currency } on the wire (§3.1).
export interface Money {
  amount_minor: number;
  currency: string;
}
