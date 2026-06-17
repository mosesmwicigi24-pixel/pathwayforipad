// Portal v2 nav model — structure + title resolution. Role-based gating returns
// with RBAC (P3); for now the shell shows the full nav and resolves page titles.
import { describe, it, expect } from "vitest";
import { navGroups, titleFor } from "../src/components/shell/nav";

describe("portal nav model", () => {
  it("has the four Figma-make groups in order", () => {
    expect(navGroups.map((g) => g.label)).toEqual(["Portal", "Curriculum", "Operations", "System"]);
  });

  it("exposes the System section (Users, Roles, Congregations, Countries, Languages)", () => {
    const system = navGroups.find((g) => g.label === "System");
    expect(system?.items.map((i) => i.path)).toEqual(["/users", "/roles", "/congregations", "/countries", "/languages"]);
  });

  it("every nav item has a unique path", () => {
    const paths = navGroups.flatMap((g) => g.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("resolves static and param-route titles", () => {
    expect(titleFor("/")).toBe("Dashboard");
    expect(titleFor("/cell-engagement")).toBe("Cell Engagement");
    expect(titleFor("/cell-engagement/abc")).toBe("Cell Detail");
    expect(titleFor("/cms/level/3")).toBe("CMS — Level Detail");
  });

  it("falls back to the brand name for unknown routes", () => {
    expect(titleFor("/totally-unknown")).toBe("Nuru Pathway");
  });
});
