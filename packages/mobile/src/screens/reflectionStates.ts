// Reflection review-state presentation (Contract Matrix M3 over B3) — pure so
// it's unit-testable. "returned" re-locks the gate and reopens the composer
// for a resubmission; "pending"/"deferred" pass; the SERVER decides gating.
export interface ReviewBanner {
  title: string;
  body: string;
  bg: string;
  fg: string;
  resubmit: boolean;
}

export const REVIEW_BANNER: Record<string, ReviewBanner> = {
  pending: {
    title: "Reflection awaiting review",
    body: "Your leader will read it soon — you can keep moving in the meantime.",
    bg: "rgba(10,37,64,0.06)",
    fg: "#0A2540",
    resubmit: false,
  },
  approved: {
    title: "Reflection approved",
    body: "Your leader has read and approved your reflection.",
    bg: "rgba(21,128,61,0.10)",
    fg: "#15803D",
    resubmit: false,
  },
  returned: {
    title: "Reflection returned",
    body: "Your leader asked you to go deeper — revise below and resubmit to unlock the next module.",
    bg: "rgba(217,119,6,0.12)",
    fg: "#92400E",
    resubmit: true,
  },
  deferred: {
    title: "Reflection noted",
    body: "Your leader set this aside for a conversation — nothing is blocked.",
    bg: "rgba(10,37,64,0.06)",
    fg: "#0A2540",
    resubmit: false,
  },
};

/** Whether the composer should show: first submission, or a returned resubmit. */
export function showReflectionComposer(state: string | null): boolean {
  if (state === null) return true; // nothing submitted yet
  return REVIEW_BANNER[state]?.resubmit === true;
}
