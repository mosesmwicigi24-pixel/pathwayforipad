// Pure helpers for the "Nuru Connect" chat inbox (mobile Chat make). Kept free of
// React/RN so the grouping, search, counts, and label logic can be unit-tested
// without a renderer. The screen (ChatScreen.tsx) is a thin view over these.
import type { ChatConversation, ChatInbox, DiscoverSpace } from "../api/types";

export type ChatTab = "spaces" | "dms" | "groups";

export interface GroupedInbox {
  spaces: ChatConversation[]; // joined public spaces (kind 'space')
  dms: ChatConversation[]; // 1:1 direct messages (kind 'dm')
  groups: ChatConversation[]; // cell / cohort / leader rooms (kind 'group')
  discover: DiscoverSpace[]; // public spaces not yet joined
}

/** Split the flat inbox into the three workspace tabs + discoverable spaces. */
export function groupInbox(inbox: ChatInbox | undefined): GroupedInbox {
  const conversations = inbox?.conversations ?? [];
  return {
    spaces: conversations.filter((c) => c.kind === "space"),
    dms: conversations.filter((c) => c.kind === "dm"),
    groups: conversations.filter((c) => c.kind === "group"),
    discover: inbox?.discover_spaces ?? [],
  };
}

/** Header summary: total unread across everything + count of joined spaces. */
export function inboxStats(inbox: ChatInbox | undefined): { unread: number; spaces: number } {
  const conversations = inbox?.conversations ?? [];
  return {
    unread: conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
    spaces: conversations.filter((c) => c.kind === "space").length,
  };
}

/** Per-tab unread/total badge counts shown on the segmented control. */
export function tabCounts(g: GroupedInbox): Record<ChatTab, number> {
  return { spaces: g.spaces.length, dms: g.dms.length, groups: g.groups.length };
}

/** Case-insensitive search over a conversation's title, last message, and topic. */
export function matchesConversation(c: ChatConversation, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [c.title, c.last_body, c.topic, c.last_author].some((f) => (f ?? "").toLowerCase().includes(q));
}

export function matchesDiscover(s: DiscoverSpace, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [s.title, s.topic].some((f) => (f ?? "").toLowerCase().includes(q));
}

/** Last-message preview line: "Name: body", a media label, or a fallback. */
export function previewText(c: ChatConversation): string {
  if (!c.last_body && !c.last_type) return c.topic ?? "No messages yet";
  // DMs don't prefix the author (the title already names the person); groups and
  // spaces show "Author: …" exactly as the make does ("Grace M.:", "David O.:").
  const who = c.last_author && c.kind !== "dm" ? `${c.last_author}: ` : "";
  if (c.last_type && c.last_type !== "text") {
    const label = c.last_type === "voice" ? "🎤 Voice message" : `📎 ${c.last_type}`;
    return `${who}${label}`;
  }
  return `${who}${c.last_body ?? ""}`;
}

/** Up to two initials from a name (DM/people avatars). */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  return parts.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

// Avatar accent colors for #space / group / person tiles — mirrors the Figma's
// rotating gold/purple/blue/green/orange/pink/teal set. Deterministic per seed so
// a given conversation keeps its color across renders.
export const CHAT_AVATAR_COLORS = [
  "#C89B3C", // gold
  "#6366F1", // indigo
  "#3FA9F5", // blue
  "#22B07D", // green
  "#E07B39", // orange
  "#EC4899", // pink
  "#14B8A6", // teal
] as const;

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return CHAT_AVATAR_COLORS[h % CHAT_AVATAR_COLORS.length] as string;
}

/**
 * Inbox timestamp like the make: time for today ("9:42 AM"), "Yesterday",
 * weekday within the last week ("Tue"), else a short date ("Mar 3"). `now` is
 * injectable for deterministic tests.
 */
export function inboxTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso);
  const today = new Date(now);
  const startOf = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dayDiff = Math.round((startOf(today) - startOf(then)) / 86_400_000);
  if (dayDiff <= 0) return then.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return then.toLocaleDateString("en-US", { weekday: "short" });
  return then.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Normalize a space category into a short uppercase pill label, or null. */
export function categoryTag(category: string | null | undefined): string | null {
  const c = (category ?? "").trim();
  return c ? c.toUpperCase() : null;
}

/** A human label for a group room's subtype, derived from its title suffix. */
export function groupKindLabel(c: ChatConversation): string | null {
  const t = (c.title ?? "").toLowerCase();
  if (t.includes("cell")) return "Cell";
  if (t.includes("cohort")) return "Cohort";
  if (t.includes("leader") || t.includes("multiplier")) return "Leaders";
  return null;
}
