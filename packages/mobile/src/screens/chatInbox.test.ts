import { describe, it, expect } from "vitest";
import {
  groupInbox,
  inboxStats,
  tabCounts,
  matchesConversation,
  matchesDiscover,
  previewText,
  initials,
  avatarColor,
  inboxTime,
  groupKindLabel,
  categoryTag,
  CHAT_AVATAR_COLORS,
} from "./chatInbox";
import type { ChatConversation, ChatInbox } from "../api/types";

function convo(over: Partial<ChatConversation>): ChatConversation {
  return {
    conversation_id: "c1",
    kind: "dm",
    is_public: false,
    title: "Someone",
    topic: null,
    category: null,
    member_count: 2,
    last_body: null,
    last_type: null,
    last_at: null,
    last_author: null,
    unread: 0,
    ...over,
  };
}

const inbox: ChatInbox = {
  conversations: [
    convo({ conversation_id: "s1", kind: "space", title: "testimonies", unread: 5, topic: "Praise reports" }),
    convo({ conversation_id: "s2", kind: "space", title: "prayer-wall", unread: 0 }),
    convo({ conversation_id: "d1", kind: "dm", title: "Faith Wanjiku", unread: 1, last_body: "thanks", last_author: "Faith Wanjiku" }),
    convo({ conversation_id: "g1", kind: "group", title: "Karen East cell", unread: 5, last_type: "voice", last_author: "Pr. Mwangi" }),
  ],
  discover_spaces: [
    { conversation_id: "x1", title: "youth-ablaze", topic: "For the youth movement", category: "youth", member_count: 210 },
  ],
};

describe("groupInbox", () => {
  it("splits conversations by kind and carries discover spaces", () => {
    const g = groupInbox(inbox);
    expect(g.spaces.map((c) => c.conversation_id)).toEqual(["s1", "s2"]);
    expect(g.dms.map((c) => c.conversation_id)).toEqual(["d1"]);
    expect(g.groups.map((c) => c.conversation_id)).toEqual(["g1"]);
    expect(g.discover.map((c) => c.conversation_id)).toEqual(["x1"]);
  });

  it("is safe on undefined input", () => {
    const g = groupInbox(undefined);
    expect(g).toEqual({ spaces: [], dms: [], groups: [], discover: [] });
  });
});

describe("inboxStats + tabCounts", () => {
  it("sums unread and counts joined spaces", () => {
    expect(inboxStats(inbox)).toEqual({ unread: 11, spaces: 2 });
  });
  it("counts items per tab", () => {
    expect(tabCounts(groupInbox(inbox))).toEqual({ spaces: 2, dms: 1, groups: 1 });
  });
});

describe("search", () => {
  it("matches conversation across title, body, topic, author", () => {
    const c = convo({ title: "prayer-wall", last_body: "surgery", topic: "requests", last_author: "David O" });
    expect(matchesConversation(c, "PRAY")).toBe(true);
    expect(matchesConversation(c, "surg")).toBe(true);
    expect(matchesConversation(c, "david")).toBe(true);
    expect(matchesConversation(c, "zzz")).toBe(false);
    expect(matchesConversation(c, "  ")).toBe(true); // blank matches all
  });
  it("matches discover on title/topic", () => {
    const s = { conversation_id: "x", title: "serve-team", topic: "outreach", category: "service", member_count: 1 };
    expect(matchesDiscover(s, "serve")).toBe(true);
    expect(matchesDiscover(s, "outreach")).toBe(true);
    expect(matchesDiscover(s, "nope")).toBe(false);
  });
});

describe("previewText", () => {
  it("prefixes author for groups/spaces but not DMs", () => {
    expect(previewText(convo({ kind: "space", last_body: "Got the job!", last_author: "Grace M." }))).toBe("Grace M.: Got the job!");
    expect(previewText(convo({ kind: "dm", last_body: "thanks", last_author: "Faith W" }))).toBe("thanks");
  });
  it("labels voice and other media", () => {
    expect(previewText(convo({ kind: "group", last_type: "voice", last_author: "Pr. Mwangi" }))).toBe("Pr. Mwangi: 🎤 Voice message");
  });
  it("falls back to topic or a default", () => {
    expect(previewText(convo({ topic: "A public space" }))).toBe("A public space");
    expect(previewText(convo({}))).toBe("No messages yet");
  });
});

describe("initials + avatarColor", () => {
  it("takes up to two initials", () => {
    expect(initials("Faith Wanjiku")).toBe("FW");
    expect(initials("David")).toBe("D");
    expect(initials("")).toBe("·");
    expect(initials("  pr esther njoroge ")).toBe("PE");
  });
  it("avatarColor is deterministic and within the palette", () => {
    const a = avatarColor("conversation-123");
    expect(a).toBe(avatarColor("conversation-123"));
    expect(CHAT_AVATAR_COLORS).toContain(a);
  });
});

describe("inboxTime", () => {
  const now = new Date("2026-06-20T12:00:00Z").getTime();
  it("shows time for today", () => {
    const t = inboxTime("2026-06-20T06:30:00Z", now);
    expect(t).toMatch(/AM|PM/);
  });
  it("shows Yesterday, weekday, then date", () => {
    expect(inboxTime("2026-06-19T06:30:00Z", now)).toBe("Yesterday");
    expect(inboxTime("2026-06-16T06:30:00Z", now)).toMatch(/Mon|Tue|Wed|Thu|Fri|Sat|Sun/);
    expect(inboxTime("2026-05-01T06:30:00Z", now)).toMatch(/May/);
    expect(inboxTime(null, now)).toBe("");
  });
});

describe("categoryTag", () => {
  it("uppercases a category or returns null when absent", () => {
    expect(categoryTag("youth")).toBe("YOUTH");
    expect(categoryTag("  marketplace ")).toBe("MARKETPLACE");
    expect(categoryTag(null)).toBeNull();
    expect(categoryTag("")).toBeNull();
  });
});

describe("groupKindLabel", () => {
  it("derives a subtype from the title", () => {
    expect(groupKindLabel(convo({ title: "Karen East cell" }))).toBe("Cell");
    expect(groupKindLabel(convo({ title: "Jericho '25 Cohort" }))).toBe("Cohort");
    expect(groupKindLabel(convo({ title: "Multipliers Leaders" }))).toBe("Leaders");
    expect(groupKindLabel(convo({ title: "Random room" }))).toBeNull();
  });
});
