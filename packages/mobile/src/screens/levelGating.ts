// Hard-lock gating (§1.9) — pure so it's unit-testable, no React/RN imports.
// A level above the member's current_level is locked: the client must never offer
// a path into higher-level content. The server stays authoritative (the API also
// refuses), so if the server already marks a level "locked" we honor that too.

/** Whether a level should render as a non-tappable, dimmed locked card (§1.9). */
export function isLevelLocked(
  levelNumber: number,
  currentLevel: number,
  serverStatus?: string,
): boolean {
  if (serverStatus === "locked") return true;
  return levelNumber > currentLevel;
}

/** Member-facing label on a locked level card. */
export function lockedLevelLabel(currentLevel: number): string {
  return `Complete Level ${currentLevel} to unlock`;
}
