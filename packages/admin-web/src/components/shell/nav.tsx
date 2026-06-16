// Portal navigation model — the four sidebar groups + per-route page titles,
// rebuilt to the "Final Pathway Portal" Figma make. Routes drive react-router.
import {
  BookOpen, LayoutDashboard, Users, CalendarDays, Wallet, Award, Layers,
  TrendingUp, MessageSquare, MessagesSquare, Video, Star, HelpCircle, AlignLeft, Bell,
  Shield, Globe, Languages as LanguagesIcon, UserCog, type LucideIcon,
} from "lucide-react";

export interface NavItem { path: string; label: string; icon: LucideIcon }
export interface NavGroup { label: string; items: NavItem[] }

export const navGroups: NavGroup[] = [
  {
    label: "Portal",
    items: [
      { path: "/", label: "Dashboard", icon: LayoutDashboard },
      { path: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    label: "Curriculum",
    items: [
      { path: "/curriculum-levels", label: "Curriculum Levels", icon: AlignLeft },
      { path: "/cms", label: "CMS — Curriculum", icon: BookOpen },
      { path: "/level-detail", label: "Level Detail", icon: Layers },
      { path: "/quiz-builder", label: "Level Quiz Builder", icon: HelpCircle },
      { path: "/video-library", label: "Video Library", icon: Video },
    ],
  },
  {
    label: "Operations",
    items: [
      { path: "/cell-engagement", label: "Cell Engagement", icon: TrendingUp },
      { path: "/members", label: "Members", icon: Users },
      { path: "/reflection-queue", label: "Reflection Queue", icon: MessageSquare },
      { path: "/chat", label: "Chat", icon: MessagesSquare },
      { path: "/events", label: "Events", icon: CalendarDays },
      { path: "/finance", label: "Finance", icon: Wallet },
      { path: "/certificates", label: "Certificates", icon: Award },
      { path: "/badges", label: "Badges", icon: Star },
    ],
  },
  {
    label: "System",
    items: [
      { path: "/users", label: "Users", icon: UserCog },
      { path: "/roles", label: "Roles & Permissions", icon: Shield },
      { path: "/countries", label: "Countries", icon: Globe },
      { path: "/languages", label: "Languages", icon: LanguagesIcon },
    ],
  },
];

export const pageTitles: Record<string, string> = {
  "/": "Dashboard",
  "/curriculum-levels": "Curriculum Levels",
  "/cms": "CMS — Curriculum",
  "/level-detail": "CMS — Level Detail",
  "/module-editor": "Module Editor",
  "/quiz-builder": "Level Quiz Builder",
  "/video-library": "Video Library",
  "/dashboard": "Dashboard",
  "/cell-engagement": "Cell Engagement",
  "/members": "Members",
  "/member-profile": "Member Profile",
  "/profile": "My Profile",
  "/notifications": "Notifications",
  "/reflection-queue": "Reflection Queue",
  "/chat": "Chat",
  "/events": "Events & Attendance",
  "/finance": "Finance",
  "/certificates": "Certificates & Badges",
  "/badges": "Badges Catalog",
  "/users": "System Users",
  "/roles": "Roles & Permissions",
  "/countries": "Countries",
  "/languages": "Languages",
};

export function titleFor(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname] as string;
  if (pathname.startsWith("/cell-engagement/")) return "Cell Detail";
  if (pathname.startsWith("/cms/level/")) return "CMS — Level Detail";
  return "Nuru Pathway";
}
