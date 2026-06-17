// Give screen — pure, render-free presentation helpers (no React Native imports),
// so they can be unit-tested in the node-based vitest suite (mirrors the
// reflectionStates.ts pattern). These lock the wire→label/colour mapping for the
// recurring-schedule detail and the giving-history status chips against the
// backend contracts (GET /giving/schedules, GET /giving/history).
import { palette } from "../theme/tokens";
import type { GivingMethod, GivingSchedule } from "../api/types";

/** Human cadence for a recurring schedule ("Every week" / "Every month"). */
export function freqLabel(frequency: GivingSchedule["frequency"]): string {
  return frequency === "weekly" ? "Every week" : "Every month";
}

const METHOD_LABELS: Record<GivingMethod, string> = {
  mpesa: "M-Pesa",
  airtel: "Airtel Money",
  card: "Card",
  paypal: "PayPal",
};

/** Friendly label for a payment method on a saved schedule. */
export function methodLabel(method: GivingMethod): string {
  return METHOD_LABELS[method] ?? method;
}

export interface ChipTone {
  bg: string;
  fg: string;
  label: string;
}

/** Map a giving-history status to a semantic chip (palette tokens only). */
export function historyStatusChip(status: string): ChipTone {
  switch (status) {
    case "succeeded":
    case "settled":
    case "completed":
      return { bg: palette.successBg, fg: palette.successText, label: "Succeeded" };
    case "processing":
      return { bg: palette.goldChipBg, fg: palette.goldChipText, label: "Processing" };
    case "failed":
      return { bg: "rgba(212,24,61,0.12)", fg: palette.error, label: "Failed" };
    case "refunded":
      return { bg: palette.mutedBg, fg: palette.ink600, label: "Refunded" };
    default:
      return { bg: palette.mutedBg, fg: palette.ink600, label: status.charAt(0).toUpperCase() + status.slice(1) };
  }
}
