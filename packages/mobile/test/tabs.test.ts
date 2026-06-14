// Tab structure: the new design's primary destinations, in order. The Chat make
// adds a sixth tab (Chat) between Community and Give.
import { describe, it, expect } from "vitest";
import { TAB_ORDER, TAB_LABELS } from "../src/navigation/tabs";

describe("tab structure (Contract Matrix M1 + Chat make)", () => {
  it("is Home · Pathway · Community · Chat · Give · Profile, in that order", () => {
    expect([...TAB_ORDER]).toEqual(["Home", "Pathway", "Community", "Chat", "Give", "Profile"]);
  });

  it("retires the old destinations (Levels/Calendar/Portal)", () => {
    const labels = Object.values(TAB_LABELS);
    for (const gone of ["Levels", "Calendar", "Portal"]) {
      expect(labels).not.toContain(gone);
    }
  });

  it("labels every tab", () => {
    for (const name of TAB_ORDER) expect(TAB_LABELS[name]).toBeTruthy();
  });
});
