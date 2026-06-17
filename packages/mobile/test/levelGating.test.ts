// §1.9 hard-lock gating — a level above the member's current_level is locked and
// non-tappable on the client; the server stays authoritative either way.
import { describe, it, expect } from "vitest";
import { isLevelLocked, lockedLevelLabel } from "../src/screens/levelGating";

describe("level gating (§1.9 hard-lock)", () => {
  it("locks levels above current_level", () => {
    expect(isLevelLocked(3, 2)).toBe(true);
    expect(isLevelLocked(6, 1)).toBe(true);
  });

  it("does not lock the current or completed levels", () => {
    expect(isLevelLocked(2, 2)).toBe(false); // current
    expect(isLevelLocked(1, 2)).toBe(false); // below current (completed)
  });

  it("honors a server 'locked' status even at/below current_level", () => {
    expect(isLevelLocked(2, 2, "locked")).toBe(true);
    expect(isLevelLocked(1, 5, "locked")).toBe(true);
  });

  it("a non-locked server status does not unlock a level above current_level", () => {
    expect(isLevelLocked(4, 2, "active")).toBe(true);
    expect(isLevelLocked(4, 2, "completed")).toBe(true);
  });

  it("labels the locked card with the level to complete", () => {
    expect(lockedLevelLabel(2)).toBe("Complete Level 2 to unlock");
  });
});
