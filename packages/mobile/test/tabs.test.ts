// Tab structure: the new design's primary destinations, in order. The Chat make
// adds a sixth tab (Chat); the Events make renames Community → Events; the Plans
// make (YouVersion-style reading plans) inserts a Plans tab after Pathway.
import { describe, it, expect } from "vitest";
import { TAB_ORDER, TAB_LABELS } from "../src/navigation/tabs";

describe("tab structure (Contract Matrix M1 + Chat/Events/Plans makes)", () => {
  it("is Home · Pathway · Plans · Events · Chat · Give · Profile, in that order", () => {
    expect([...TAB_ORDER]).toEqual(["Home", "Pathway", "Plans", "Events", "Chat", "Give", "Profile"]);
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
