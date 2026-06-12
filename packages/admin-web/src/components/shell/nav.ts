// Portal navigation model (Pulse design, Contract Matrix W1):
// Dashboard · Curriculum (CMS) · Operations (ERP). Pure data + gating logic so
// the structure is unit-testable without rendering.
import { isAdminRole } from "../../util/jwt";

export type ScreenId =
  | "dashboard"
  | "curriculum"
  | "videos"
  | "members"
  | "cohort"
  | "reviews"
  | "attendance"
  | "events"
  | "announcements"
  | "badges"
  | "certificates"
  | "finance"
  | "audit";

export interface NavItem {
  id: ScreenId;
  label: string;
  /** Minimum visibility: leaders see leader screens; the rest are Admin+. */
  adminOnly: boolean;
}

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  { title: null, items: [{ id: "dashboard", label: "Dashboard", adminOnly: true }] },
  {
    title: "Curriculum",
    items: [
      { id: "curriculum", label: "Levels & Modules", adminOnly: true },
      { id: "videos", label: "Video Library", adminOnly: true },
    ],
  },
  {
    title: "Operations",
    items: [
      { id: "members", label: "Members", adminOnly: true },
      { id: "cohort", label: "My Cohort", adminOnly: false },
      { id: "reviews", label: "Reflection Queue", adminOnly: false },
      { id: "attendance", label: "Attendance", adminOnly: false },
      { id: "events", label: "Events", adminOnly: true },
      { id: "announcements", label: "Announcements", adminOnly: true },
      { id: "badges", label: "Badges", adminOnly: true },
      { id: "certificates", label: "Certificates", adminOnly: true },
      { id: "finance", label: "Finance", adminOnly: true },
      { id: "audit", label: "Audit Log", adminOnly: true },
    ],
  },
];

/** The nav as the signed-in role sees it (empty sections drop out). */
export function visibleSections(role: string | null): NavSection[] {
  const admin = isAdminRole(role);
  return NAV_SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => admin || !i.adminOnly) })).filter(
    (s) => s.items.length > 0,
  );
}

/** Where each role lands after sign-in. */
export function defaultScreen(role: string | null): ScreenId {
  return isAdminRole(role) ? "dashboard" : "cohort";
}

/** Guard for direct screen switches (e.g. stale state after role change). */
export function canSee(role: string | null, id: ScreenId): boolean {
  return visibleSections(role).some((s) => s.items.some((i) => i.id === id));
}
