// Portal navigation model — rebuilt to the Figma make "Nuru Pathway Web Portal"
// (docs/WEB_PORTAL_DESIGN_SPEC.md). Pure data + role gating so the structure is
// unit-testable without rendering. Admins/SuperAdmins get the full portal;
// instructors keep their leader subset (cohort + reflection + attendance + events).
import {
  LayoutDashboard,
  AlignLeft,
  BookOpen,
  Layers,
  Edit3,
  HelpCircle,
  Video,
  TrendingUp,
  Users,
  MessageSquare,
  CalendarDays,
  ClipboardCheck,
  Wallet,
  Award,
  Star,
  Megaphone,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react";
import { isAdminRole } from "../../util/jwt";

export type ScreenId =
  | "dashboard"
  | "curriculum-levels"
  | "cms"
  | "level-detail"
  | "module-editor"
  | "quiz-builder"
  | "videos"
  | "cohort-engagement"
  | "members"
  | "member-profile"
  | "cohort"
  | "reviews"
  | "attendance"
  | "events"
  | "finance"
  | "certificates"
  | "badges"
  | "announcements"
  | "audit";

export interface NavItem {
  id: ScreenId;
  label: string;
  icon: LucideIcon;
  /** Minimum visibility: leaders see leader screens; the rest are Admin+. */
  adminOnly: boolean;
  /** Hidden from the sidebar (reached contextually, e.g. a member row). */
  hidden?: boolean;
}

export interface NavSection {
  title: string | null;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  { title: "Portal", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard, adminOnly: true }] },
  {
    title: "Curriculum",
    items: [
      { id: "curriculum-levels", label: "Curriculum Levels", icon: AlignLeft, adminOnly: true },
      { id: "cms", label: "CMS — Curriculum", icon: BookOpen, adminOnly: true },
      { id: "level-detail", label: "Level Detail", icon: Layers, adminOnly: true },
      { id: "module-editor", label: "Module Editor", icon: Edit3, adminOnly: true },
      { id: "quiz-builder", label: "Quiz Builder", icon: HelpCircle, adminOnly: true },
      { id: "videos", label: "Video Library", icon: Video, adminOnly: true },
    ],
  },
  {
    title: "Operations",
    items: [
      { id: "cohort-engagement", label: "Cohort Engagement", icon: TrendingUp, adminOnly: true },
      { id: "members", label: "Members", icon: Users, adminOnly: true },
      { id: "member-profile", label: "Member Profile", icon: Users, adminOnly: true, hidden: true },
      { id: "cohort", label: "My Cohort", icon: TrendingUp, adminOnly: false },
      { id: "reviews", label: "Reflection Queue", icon: MessageSquare, adminOnly: false },
      { id: "attendance", label: "Attendance", icon: ClipboardCheck, adminOnly: false },
      { id: "events", label: "Events", icon: CalendarDays, adminOnly: false },
      { id: "finance", label: "Finance", icon: Wallet, adminOnly: true },
      { id: "certificates", label: "Certificates", icon: Award, adminOnly: true },
      { id: "badges", label: "Badges", icon: Star, adminOnly: true },
      { id: "announcements", label: "Announcements", icon: Megaphone, adminOnly: true },
      { id: "audit", label: "Audit Log", icon: ShieldAlert, adminOnly: true },
    ],
  },
];

/** Page title shown in the top bar for each screen. */
export const SCREEN_TITLES: Record<ScreenId, string> = {
  dashboard: "Dashboard",
  "curriculum-levels": "Curriculum Levels",
  cms: "CMS — Curriculum",
  "level-detail": "CMS — Level Detail",
  "module-editor": "Module Editor",
  "quiz-builder": "Quiz Builder",
  videos: "Video Library",
  "cohort-engagement": "Cohort Engagement",
  members: "Members",
  "member-profile": "Member Profile",
  cohort: "My Cohort",
  reviews: "Reflection Queue",
  attendance: "Attendance",
  events: "Events & Attendance",
  finance: "Finance",
  certificates: "Certificates & Badges",
  badges: "Badges Catalog",
  announcements: "Announcements",
  audit: "Audit Log",
};

/** The nav as the signed-in role sees it (empty sections + hidden items drop out). */
export function visibleSections(role: string | null): NavSection[] {
  const admin = isAdminRole(role);
  return NAV_SECTIONS.map((s) => ({
    ...s,
    items: s.items.filter((i) => !i.hidden && (admin || !i.adminOnly)),
  })).filter((s) => s.items.length > 0);
}

/** Where each role lands after sign-in. */
export function defaultScreen(role: string | null): ScreenId {
  return isAdminRole(role) ? "dashboard" : "cohort";
}

/** Guard for direct screen switches (e.g. stale state after role change). */
export function canSee(role: string | null, id: ScreenId): boolean {
  if (isAdminRole(role)) return true; // admins can reach every screen incl. hidden ones
  return visibleSections(role).some((s) => s.items.some((i) => i.id === id));
}
