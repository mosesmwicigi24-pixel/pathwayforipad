// Maps API/axios errors to friendly portal messages, with explicit 401/403 handling.
import axios from "axios";

export function errorMessage(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const status = e.response?.status;
    if (status === 401) return "Your session expired — please sign in again.";
    if (status === 403) return "You don't have access to this cohort.";
    const body = e.response?.data as { error?: { message?: string } } | undefined;
    return body?.error?.message ?? fallback;
  }
  return fallback;
}
