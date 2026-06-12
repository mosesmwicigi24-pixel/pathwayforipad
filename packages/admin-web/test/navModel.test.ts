// Portal nav model (W1): role gating, landing screens, and section structure.
import { describe, it, expect } from "vitest";
import { visibleSections, defaultScreen, canSee } from "../src/components/shell/nav";

describe("portal nav gating", () => {
  it("admins see Dashboard, Curriculum and all Operations screens", () => {
    const sections = visibleSections("Admin");
    const ids = sections.flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toContain("dashboard");
    expect(ids).toContain("curriculum");
    expect(ids).toContain("members");
    expect(ids).toContain("finance");
    expect(ids).toContain("audit");
  });

  it("instructors see only the leader screens — no dashboard/finance/audit", () => {
    const ids = visibleSections("Instructor").flatMap((s) => s.items.map((i) => i.id));
    expect(ids).toEqual(["cohort", "reviews", "attendance"]);
  });

  it("lands admins on the dashboard, leaders on their cohort", () => {
    expect(defaultScreen("SuperAdmin")).toBe("dashboard");
    expect(defaultScreen("Admin")).toBe("dashboard");
    expect(defaultScreen("Instructor")).toBe("cohort");
    expect(defaultScreen(null)).toBe("cohort");
  });

  it("canSee guards direct screen switches by role", () => {
    expect(canSee("Instructor", "finance")).toBe(false);
    expect(canSee("Instructor", "reviews")).toBe(true);
    expect(canSee("Admin", "finance")).toBe(true);
  });

  it("drops sections that end up empty for the role", () => {
    const titles = visibleSections("Instructor").map((s) => s.title);
    expect(titles).not.toContain("Curriculum");
  });
});
