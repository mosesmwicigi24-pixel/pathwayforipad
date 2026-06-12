// M1 retab: the app's five primary destinations are the new design's, in order.
import { describe, it, expect } from "vitest";
import { TAB_ORDER, TAB_LABELS } from "../src/navigation/tabs";

describe("tab structure (Contract Matrix M1)", () => {
  it("is Home · Pathway · Give · Community · Profile, in that order", () => {
    expect([...TAB_ORDER]).toEqual(["Home", "Pathway", "Give", "Community", "Profile"]);
  });

  it("retires the old destinations (Levels/Calendar/Portal/Chat)", () => {
    const labels = Object.values(TAB_LABELS);
    for (const gone of ["Levels", "Calendar", "Portal", "Chat"]) {
      expect(labels).not.toContain(gone);
    }
  });

  it("labels every tab", () => {
    for (const name of TAB_ORDER) expect(TAB_LABELS[name]).toBeTruthy();
  });
});
