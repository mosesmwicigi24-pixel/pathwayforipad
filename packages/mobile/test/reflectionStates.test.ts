// M3: reflection review-state presentation — returned reopens the composer
// (the server re-locked the gate); approved/pending/deferred do not.
import { describe, it, expect } from "vitest";
import { REVIEW_BANNER, showReflectionComposer } from "../src/screens/reflectionStates";

describe("reflection review states (M3 over B3)", () => {
  it("covers every server state with a banner", () => {
    for (const state of ["pending", "approved", "returned", "deferred"]) {
      expect(REVIEW_BANNER[state]?.title).toBeTruthy();
    }
  });

  it("only 'returned' reopens the composer; no submission always shows it", () => {
    expect(showReflectionComposer(null)).toBe(true);
    expect(showReflectionComposer("returned")).toBe(true);
    expect(showReflectionComposer("pending")).toBe(false);
    expect(showReflectionComposer("approved")).toBe(false);
    expect(showReflectionComposer("deferred")).toBe(false);
    expect(showReflectionComposer("rejected")).toBe(false); // legacy state — read-only
  });
});
