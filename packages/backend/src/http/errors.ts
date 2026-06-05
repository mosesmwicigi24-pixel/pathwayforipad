// Standard error envelope + taxonomy (spec §3.2). Every error response is shaped
// as { error: { code, message, request_id, details? } }; the code → HTTP status
// map lives in @nuru/shared so client and server agree.
import { API_ERROR_CODES, type ApiErrorCode, type ErrorBody } from "@nuru/shared";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = API_ERROR_CODES[code];
    this.details = details;
  }

  toBody(requestId: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        request_id: requestId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}
