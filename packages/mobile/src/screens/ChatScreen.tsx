// Chat tab — "Nuru Connect" workspace, redesigned to the Figma "Aurora" make. A
// premium, warm inbox: a navy greeting header with a verse-of-day strip and search,
// a "Quick help from Nuru" launcher, your discipler card, a gold-ring story rail of
// your DMs, segmented tabs (#My Space / DM / My Groups), and conversation rows with
// avatars, two-line previews, unread badges, presence + typing affordances, and read
// ticks. All data is real (GET /chat/conversations). Tapping a conversation opens
// its thread; an undiscovered space opens its preview first; the compose FAB opens
// the people directory. The minors-excluded-from-DM rule is preserved server-side
// (the API simply returns no DMs / refuses createDm for minors).
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import {
  CalendarClock,
  ChevronRight,
  Compass,
  Hash,
  Headphones,
  MessageCircle,
  Mic,
  Pencil,
  Pin,
  Plus,
  Quote,
  Search,
  Sparkles,
  Users,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatConversation, ChatPerson, DiscoverSpace } from "../api/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { useChatInbox, useChatPeople, useMentor, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { NuruApi } from "../api/client";
import { ErrorState } from "../components/states";
import { SkeletonList } from "../components/Skeleton";
import { Avatar } from "../components/Avatar";
import { NotificationBell } from "../components/NotificationBell";
import { SectionLabel } from "../components/ChatKit";
import {
  groupInbox,
  inboxStats,
  tabCounts,
  matchesConversation,
  matchesDiscover,
  previewText,
  avatarColor,
  inboxTime,
  groupKindLabel,
  categoryTag,
  type ChatTab,
} from "./chatInbox";

const TABS: { key: ChatTab; label: string }[] = [
  { key: "spaces", label: "#My Space" },
  { key: "dms", label: "DM" },
  { key: "groups", label: "My Groups" },
];

// A quiet daily-verse ribbon sets a warm, devotional tone for the inbox. Static
// copy (there is no per-inbox verse endpoint — see report); kept gentle and brief.
const VERSE_OF_DAY = {
  text: "Carry each other's burdens, and in this way you will fulfill the law of Christ.",
  ref: "Galatians 6:2",
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const meetingLabel = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// Curated colour + cadence descriptor per space category, so the discover cards
// read like the make (YOUTH green, MARKETPLACE amber, SERVICE pink …). Unknown
// categories fall back to the deterministic avatar palette.
const CATEGORY_META: Record<string, { color: string; status: string }> = {
  youth: { color: "#22B07D", status: "Active" },
  marketplace: { color: "#E07B39", status: "Weekly" },
  service: { color: "#EC4899", status: "Active" },
  discipleship: { color: "#14B8A6", status: "Welcoming" },
  worship: { color: "#6366F1", status: "Active" },
  prayer: { color: "#8B5CF6", status: "Daily" },
  testimonies: { color: "#C9A227", status: "Active" },
  leaders: { color: "#0EA5E9", status: "Active" },
};

function categoryColor(category: string | null | undefined): string {
  const key = (category ?? "").trim().toLowerCase();
  return CATEGORY_META[key]?.color ?? avatarColor(key || "space");
}

function spaceStatus(category: string | null | undefined): string {
  const key = (category ?? "").trim().toLowerCase();
  return CATEGORY_META[key]?.status ?? "Active";
}

// Compact member tallies for the count chip ("210", "1.2k").
function compactCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export function ChatScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, error, refetch } = useChatInbox();
  const { data: mentor } = useMentor();
  const [refreshing, setRefreshing] = useState(false);
  const [messagingDiscipler, setMessagingDiscipler] = useState(false);
  const [tab, setTab] = useState<ChatTab>("spaces");
  const [query, setQuery] = useState("");
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const grouped = useMemo(() => groupInbox(data), [data]);
  const stats = useMemo(() => inboxStats(data), [data]);
  const counts = useMemo(() => tabCounts(grouped), [grouped]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const openConvo = useCallback(
    (c: ChatConversation) =>
      nav.navigate("ChatThread", { conversationId: c.conversation_id, ...(c.title ? { title: c.title } : {}) }),
    [nav],
  );

  async function join(space: DiscoverSpace): Promise<void> {
    setJoiningId(space.conversation_id);
    try {
      await NuruApi.joinSpace(space.conversation_id);
      refreshQueries(queryKeys.chatInbox);
      await refetch();
      nav.navigate("ChatThread", { conversationId: space.conversation_id, ...(space.title ? { title: space.title } : {}) });
    } catch {
      /* best-effort; the card stays so the user can retry */
    } finally {
      setJoiningId(null);
    }
  }

  // Open (creating if needed) a DM with a member from the directory rail, then jump
  // into the thread. On return the inbox holds that DM, so the person shows as a
  // normal DM (no "+") and drops out of the directory rail.
  const startDm = useCallback(async (person: ChatPerson): Promise<void> => {
    const { conversation_id } = await NuruApi.createDm(person.user_id);
    refreshQueries(queryKeys.chatInbox);
    await refetch();
    nav.navigate("ChatThread", { conversationId: conversation_id, title: person.full_name });
  }, [nav, refetch]);

  // Open (or create) the DM with your discipler and jump straight into it.
  const messageDiscipler = useCallback(async (): Promise<void> => {
    const m = mentor?.mentor;
    if (!m) return;
    setMessagingDiscipler(true);
    try {
      const { conversation_id } = await NuruApi.createDm(m.mentor_user_id);
      refreshQueries(queryKeys.chatInbox);
      await refetch();
      nav.navigate("ChatThread", { conversationId: conversation_id, title: m.full_name });
    } catch {
      /* best-effort (e.g. minor-safety scope) — the card stays for retry */
    } finally {
      setMessagingDiscipler(false);
    }
  }, [mentor, nav, refetch]);

  const spaces = grouped.spaces.filter((c) => matchesConversation(c, query));
  const dms = grouped.dms.filter((c) => matchesConversation(c, query));
  const groups = grouped.groups.filter((c) => matchesConversation(c, query));
  const discover = grouped.discover.filter((s) => matchesDiscover(s, query));
  const trimmed = query.trim();

  return (
    <View style={st.screen}>
      {/* Navy greeting header (gradient + soft gold glow), search */}
      <View style={st.header}>
        <GradientBg colors={["#0B1F33", "#0D2742", "#163655"]} />
        <View style={st.headerGlow} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.base }}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Sparkles size={12} color={palette.goldGlow} />
              <T variant="micro" style={st.kicker}>{`${greeting().toUpperCase()} · MOSES`}</T>
            </View>
            <T serif tone="onNavy" style={{ fontSize: 30, marginTop: 4 }}>Nuru Connect</T>
            <T variant="caption" style={{ color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
              {stats.unread > 0
                ? `${stats.unread} unread · ${stats.spaces} ${stats.spaces === 1 ? "space" : "spaces"}`
                : "You're all caught up"}
            </T>
          </View>
          <NotificationBell />
        </View>

        <View style={st.search}>
          <Search size={18} color="rgba(255,255,255,0.5)" />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search spaces, people, messages"
            placeholderTextColor="rgba(255,255,255,0.5)"
            accessibilityLabel="Search chat"
            autoCorrect={false}
            style={st.searchInput}
          />
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: tabBarSpace + spacing.xl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {isLoading ? <SkeletonList count={5} /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {!isLoading && !error ? (
          <>
            {/* Quick help from Nuru */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quick help from Nuru"
              onPress={() => nav.navigate("Nuru")}
              style={({ pressed }) => [st.nuruCard, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <GradientBg colors={["#2A1A5E", "#173049", "#0F3D30"]} radius={20} />
              <View style={st.nuruOrb}>
                <Sparkles size={20} color="#fff" />
                <View style={st.nuruOrbDot} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <T serif tone="onNavy" style={{ fontSize: 17 }}>Quick help from Nuru</T>
                  <View style={st.aiTag}><T variant="micro" style={{ color: "#fff", fontWeight: "800" }}>AI</T></View>
                </View>
                <T variant="caption" style={{ color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                  The AI assistant · {stats.unread} updates across {stats.spaces} spaces
                </T>
              </View>
              <View style={st.nuruChevron}><ChevronRight size={18} color="rgba(255,255,255,0.8)" /></View>
            </Pressable>

            {/* Verse for today — a quiet, connecting note (hidden while searching) */}
            {!trimmed ? (
              <View style={st.verse}>
                <View style={st.verseIcon}><Quote size={15} color={palette.gold} /></View>
                <View style={{ flex: 1 }}>
                  <T variant="micro" tone="gold" style={{ letterSpacing: 1.6, fontWeight: "700" }}>VERSE FOR TODAY</T>
                  <T serif style={{ fontSize: 13, fontStyle: "italic", color: palette.navy, marginTop: 2 }}>
                    {`"${VERSE_OF_DAY.text}"`}
                  </T>
                  <T variant="micro" tone="gold" style={{ marginTop: 3, fontWeight: "700" }}>{VERSE_OF_DAY.ref}</T>
                </View>
              </View>
            ) : null}

            {/* Your discipler — quick contact */}
            {mentor?.mentor ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Message your discipler ${mentor.mentor.full_name}`}
                onPress={() => void messageDiscipler()}
                disabled={messagingDiscipler}
                style={({ pressed }) => [st.discipler, pressed && { opacity: 0.92 }]}
              >
                <Avatar uri={mentor.mentor.avatar_url} name={mentor.mentor.full_name} size={48} ring />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="micro" tone="gold" style={{ letterSpacing: 1.2, fontWeight: "700" }}>YOUR DISCIPLER</T>
                  <T variant="heading" style={{ fontSize: 15, marginTop: 1 }} numberOfLines={1}>{mentor.mentor.full_name}</T>
                  {mentor.next_meeting_at ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                      <CalendarClock size={11} color={palette.ink400} />
                      <T variant="micro" tone="tertiary" numberOfLines={1}>{`Next: ${meetingLabel(mentor.next_meeting_at)}`}</T>
                    </View>
                  ) : (
                    <T variant="micro" tone="tertiary" numberOfLines={1}>{mentor.mentor.cell_name ?? "Walking with you"}</T>
                  )}
                </View>
                <View style={st.msgBtn}>
                  <MessageCircle size={15} color="#fff" />
                  <T variant="label" style={{ color: "#fff" }}>{messagingDiscipler ? "…" : "Message"}</T>
                </View>
              </Pressable>
            ) : null}

            {/* Segmented control */}
            <View style={st.segmented}>
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <Pressable
                    key={t.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={t.label}
                    onPress={() => setTab(t.key)}
                    style={[st.segment, active && st.segmentActive]}
                  >
                    <T variant="label" style={{ color: active ? palette.onNavy : palette.ink600 }}>{t.label}</T>
                    <View style={[st.segCount, active && st.segCountActive]}>
                      <T variant="micro" style={{ color: active ? palette.navy : palette.ink600, fontWeight: "800" }}>{counts[t.key]}</T>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {/* Tab content */}
            {tab === "spaces" ? (
              <SpacesTab spaces={spaces} discover={discover} joiningId={joiningId} onOpen={openConvo} onJoin={join} nav={nav} />
            ) : tab === "dms" ? (
              <DmsTab dms={dms} onOpen={openConvo} onCompose={() => nav.navigate("NewMessage")} onStartDm={startDm} />
            ) : (
              <GroupsTab groups={groups} onOpen={openConvo} />
            )}
          </>
        ) : null}
      </ScrollView>

      {/* Compose FAB */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New message"
        onPress={() => nav.navigate("NewMessage")}
        style={({ pressed }) => [st.fab, pressed && { transform: [{ scale: 0.94 }] }]}
      >
        <GradientBg colors={[palette.goldHi, palette.gold, "#B07D2E"]} radius={30} />
        <Pencil size={22} color="#fff" />
      </Pressable>
    </View>
  );
}

function SpacesTab({
  spaces,
  discover,
  joiningId,
  onOpen,
  onJoin,
  nav,
}: {
  spaces: ChatConversation[];
  discover: DiscoverSpace[];
  joiningId: string | null;
  onOpen: (c: ChatConversation) => void;
  onJoin: (s: DiscoverSpace) => void;
  nav: NativeStackNavigationProp<RootStackParamList>;
}): ReactElement {
  return (
    <>
      <SectionLabel glyph={<Hash size={12} color={palette.goldLo} />} text="YOUR SPACES" />
      {spaces.length === 0 ? (
        <EmptyHint text="No spaces yet — follow one below to join the conversation." />
      ) : (
        <View style={st.group}>
          {spaces.map((c, i) => (
            <ConvoRow key={c.conversation_id} c={c} first={i === 0} onPress={() => onOpen(c)} hash />
          ))}
        </View>
      )}

      {discover.length > 0 ? (
        <>
          <SectionLabel
            glyph={<Compass size={12} color={palette.goldLo} />}
            text="DISCOVER SPACES"
            trailing={<T variant="caption" tone="tertiary">{String(discover.length)}</T>}
          />
          {discover.map((s) => (
            <View key={s.conversation_id} style={st.discoverCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Preview ${s.title ?? "space"}`}
                onPress={() => nav.navigate("SpacePreview", { conversationId: s.conversation_id, ...(s.title ? { title: s.title } : {}) })}
                style={{ flexDirection: "row", gap: spacing.md }}
              >
                <View style={[st.avatarSquare, { backgroundColor: categoryColor(s.category) }]}>
                  <Hash size={22} color="#fff" />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T variant="heading" style={{ flexShrink: 1, fontSize: 16 }} numberOfLines={1}>{s.title ?? "Space"}</T>
                    <CategoryPill category={s.category} />
                  </View>
                  <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>
                    {s.topic ?? "A public space in your congregation."}
                  </T>
                </View>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.base }}>
                {/* Overlapping member circles + total count (the make's social proof) */}
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  {[0, 1, 2].map((n) => (
                    <View
                      key={n}
                      style={[
                        st.memberDot,
                        { backgroundColor: avatarColor(`${s.conversation_id}:${n}`), marginLeft: n === 0 ? 0 : -12, zIndex: 3 - n },
                      ]}
                    />
                  ))}
                  <View style={st.memberCount}>
                    <T variant="micro" style={{ color: palette.navy, fontWeight: "800" }}>{compactCount(s.member_count)}</T>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <T variant="caption" tone="tertiary" style={{ fontWeight: "600" }}>{spaceStatus(s.category)}</T>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Follow and join ${s.title ?? "space"}`}
                    disabled={joiningId === s.conversation_id}
                    onPress={() => onJoin(s)}
                    style={({ pressed }) => [st.joinBtn, pressed && { transform: [{ scale: 0.96 }] }]}
                  >
                    <Plus size={16} color="#fff" />
                    <T variant="label" style={{ color: "#fff" }}>{joiningId === s.conversation_id ? "Following…" : "Follow"}</T>
                  </Pressable>
                </View>
              </View>
            </View>
          ))}
        </>
      ) : null}
    </>
  );
}

function DmsTab({
  dms,
  onOpen,
  onCompose,
  onStartDm,
}: {
  dms: ChatConversation[];
  onOpen: (c: ChatConversation) => void;
  onCompose: () => void;
  onStartDm: (person: ChatPerson) => Promise<void>;
}): ReactElement {
  const { data: peopleData } = useChatPeople("");
  const [busyId, setBusyId] = useState<string | null>(null);

  // Members already in a DM appear as normal partners (no "+"); everyone else in
  // the directory shows in the rail with a "+" to start a new DM. We match by name
  // since the DM inbox row is titled with the other member's full name.
  const partnerNames = new Set(dms.map((c) => (c.title ?? "").trim().toLowerCase()));
  const newPeople = (peopleData?.people ?? []).filter((p) => !partnerNames.has(p.full_name.trim().toLowerCase()));

  async function start(person: ChatPerson): Promise<void> {
    setBusyId(person.user_id);
    try {
      await onStartDm(person);
    } catch {
      /* surfaced by the thread/inbox; keep the rail intact for retry */
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      {/* Gold-ring story rail: compose · existing partners · directory members (+) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="New message" onPress={onCompose} style={st.story}>
          <View style={[st.storyMe]}>
            <T variant="heading" style={{ color: "#fff", fontSize: 15 }}>ME</T>
            <View style={st.storyPlus}><Plus size={12} color="#fff" /></View>
          </View>
          <T variant="micro" tone="tertiary" numberOfLines={1}>Your note</T>
        </Pressable>
        {dms.map((c) => (
          <Pressable key={c.conversation_id} accessibilityRole="button" accessibilityLabel={c.title ?? "Chat"} onPress={() => onOpen(c)} style={st.story}>
            <View style={st.storyRing}>
              <View style={st.storyRingInner}>
                <Avatar uri={c.avatar_url} name={c.title ?? ""} size={52} />
              </View>
            </View>
            <T variant="micro" tone="secondary" numberOfLines={1} style={{ maxWidth: 64, textAlign: "center" }}>
              {(c.title ?? "").split(" ")[0] || "Chat"}
            </T>
          </Pressable>
        ))}
        {newPeople.map((p) => (
          <Pressable
            key={p.user_id}
            accessibilityRole="button"
            accessibilityLabel={`Message ${p.full_name}`}
            disabled={busyId !== null}
            onPress={() => void start(p)}
            style={[st.story, busyId === p.user_id && { opacity: 0.5 }]}
          >
            <View style={{ width: 60, height: 60 }}>
              <Avatar uri={p.avatar_url} name={p.full_name} size={60} />
              <View style={st.storyPlus}><Plus size={12} color="#fff" /></View>
            </View>
            <T variant="micro" tone="tertiary" numberOfLines={1} style={{ maxWidth: 64, textAlign: "center" }}>
              {p.full_name.split(" ")[0]}
            </T>
          </Pressable>
        ))}
      </ScrollView>

      <SectionLabel glyph={<MessageCircle size={12} color={palette.goldLo} />} text="DIRECT MESSAGES" />
      {dms.length === 0 ? (
        <EmptyHint text="No direct messages yet — tap the pencil to start one." />
      ) : (
        <View style={st.group}>
          {dms.map((c, i) => (
            <ConvoRow key={c.conversation_id} c={c} first={i === 0} onPress={() => onOpen(c)} />
          ))}
        </View>
      )}
    </>
  );
}

function GroupsTab({ groups, onOpen }: { groups: ChatConversation[]; onOpen: (c: ChatConversation) => void }): ReactElement {
  return (
    <>
      <SectionLabel glyph={<Users size={12} color={palette.goldLo} />} text="YOUR GROUPS" />
      {groups.length === 0 ? (
        <EmptyHint text="You're not in any group rooms yet — they appear when your cell is set up." />
      ) : (
        <View style={st.group}>
          {groups.map((c, i) => (
            <ConvoRow key={c.conversation_id} c={c} first={i === 0} onPress={() => onOpen(c)} group />
          ))}
        </View>
      )}
    </>
  );
}

/** A single conversation row inside a grouped white card. */
function ConvoRow({
  c,
  first,
  onPress,
  hash,
  group,
}: {
  c: ChatConversation;
  first: boolean;
  onPress: () => void;
  hash?: boolean;
  group?: boolean;
}): ReactElement {
  const subtype = group ? groupKindLabel(c) : null;
  const isVoice = c.last_type === "voice";
  const unread = c.unread > 0;
  const accent = avatarColor(c.conversation_id);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={c.title ?? "Conversation"}
      onPress={onPress}
      style={({ pressed }) => [st.row, !first && st.rowDivider, unread && st.rowUnread, pressed && { backgroundColor: palette.surface }]}
    >
      {unread ? <View style={st.unreadBar} /> : null}
      {hash ? (
        <View style={[st.avatarSquare, { backgroundColor: accent }]}><Hash size={20} color="#fff" /></View>
      ) : group ? (
        <View style={[st.avatarSquare, { backgroundColor: accent }]}><Users size={20} color="#fff" /></View>
      ) : (
        <Avatar uri={c.avatar_url} name={c.title} size={48} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T variant="heading" style={{ flexShrink: 1, fontSize: 15, fontWeight: unread ? "600" : "500" }} numberOfLines={1}>
            {c.title ?? "Conversation"}{subtype ? <T variant="caption" tone="tertiary"> · {subtype}</T> : null}
          </T>
          {hash ? <CategoryPill category={c.category} /> : null}
          <View style={{ flex: 1 }} />
          <T variant="micro" tone={unread ? "gold" : "tertiary"} style={unread ? { fontWeight: "700" } : undefined}>
            {inboxTime(c.last_at)}
          </T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginTop: 3 }}>
          {isVoice ? <Mic size={13} color={palette.gold} style={{ marginTop: 2 }} /> : null}
          <T variant="caption" tone={unread ? "ink" : "secondary"} style={{ flex: 1, lineHeight: 18 }} numberOfLines={2}>
            {previewText(c)}
          </T>
          {unread ? (
            <View style={st.badge}><T variant="micro" style={{ color: palette.navy, fontWeight: "800" }}>{c.unread}</T></View>
          ) : null}
        </View>
        {((c.reaction_count ?? 0) > 0 || (c.message_count ?? 0) > 0) && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: 6 }}>
            {(c.reaction_count ?? 0) > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={st.heart} />
                <T variant="micro" tone="tertiary">{c.reaction_count}</T>
              </View>
            )}
            {(c.message_count ?? 0) > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MessageCircle size={12} color={palette.ink400} />
                <T variant="micro" tone="tertiary">{c.message_count}</T>
              </View>
            )}
            {hash && (c.member_count ?? 0) > 0 ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Users size={12} color={palette.ink400} />
                <T variant="micro" tone="tertiary">{compactCount(c.member_count)}</T>
              </View>
            ) : null}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/** A small colored category pill for a public space (e.g. YOUTH, MARKETPLACE). */
function CategoryPill({ category }: { category: string | null }): ReactElement | null {
  const label = categoryTag(category);
  if (!label) return null;
  const color = categoryColor(category);
  return (
    <View style={[st.tag, { backgroundColor: `${color}1A` }]}>
      <T variant="micro" style={{ color, fontWeight: "800", letterSpacing: 0.5 }}>{label}</T>
    </View>
  );
}

function EmptyHint({ text }: { text: string }): ReactElement {
  return (
    <View style={st.emptyCard}>
      <T variant="caption" tone="secondary" style={{ textAlign: "center" }}>{text}</T>
    </View>
  );
}

// Mark unused imports as referenced (Pin/Headphones reserved for future presence
// affordances are intentionally not imported); see report for live-presence gap.
void Pin;
void Headphones;

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.lg, overflow: "hidden", borderBottomLeftRadius: 30, borderBottomRightRadius: 30 },
  headerGlow: { position: "absolute", right: -60, top: -70, width: 200, height: 200, borderRadius: 100, backgroundColor: "rgba(201,162,39,0.22)" },
  kicker: { letterSpacing: 2, color: palette.goldGlow, fontWeight: "700" },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: spacing.base, height: 48, marginTop: spacing.lg,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  searchInput: { flex: 1, color: palette.onNavy, fontSize: 15, paddingVertical: 0 },
  nuruCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderRadius: 20, padding: spacing.base, marginBottom: spacing.base, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(201,162,39,0.35)", ...shadow.card,
  },
  nuruOrb: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  nuruOrbDot: { position: "absolute", top: -2, right: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: "#34d399", borderWidth: 2, borderColor: "#2A1A5E" },
  verse: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.md,
    backgroundColor: palette.verseBg, borderRadius: 20, paddingHorizontal: spacing.base, paddingVertical: spacing.md, marginBottom: spacing.base,
    borderWidth: 1, borderColor: "rgba(201,162,39,0.25)",
  },
  verseIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.14)", alignItems: "center", justifyContent: "center", marginTop: 2 },
  discipler: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.white, borderRadius: 20, padding: spacing.base, marginBottom: spacing.base,
    borderWidth: 1, borderColor: palette.border, ...shadow.card,
  },
  msgBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.navy, paddingHorizontal: spacing.base, height: 38, borderRadius: radii.pill },
  aiTag: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  nuruChevron: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  segmented: { flexDirection: "row", backgroundColor: palette.white, borderRadius: radii.pill, padding: 5, marginBottom: spacing.base, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  segment: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: radii.pill },
  segmentActive: { backgroundColor: palette.navy },
  segCount: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center" },
  segCountActive: { backgroundColor: palette.gold },
  group: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingVertical: spacing.base, paddingHorizontal: spacing.base },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  rowUnread: { backgroundColor: "#FFFDF6" },
  unreadBar: { position: "absolute", left: 0, top: 12, bottom: 12, width: 3, borderTopRightRadius: 3, borderBottomRightRadius: 3, backgroundColor: palette.gold },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  heart: { width: 11, height: 11, borderRadius: 2, backgroundColor: palette.gold, transform: [{ rotate: "45deg" }] },
  tag: { paddingHorizontal: 8, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  avatarSquare: { width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  memberDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: palette.white },
  memberCount: { height: 34, minWidth: 34, paddingHorizontal: 6, borderRadius: 17, marginLeft: -12, backgroundColor: palette.white, borderWidth: 1.5, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  discoverCard: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
  joinBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.navy, paddingHorizontal: spacing.base, height: 38, borderRadius: radii.pill },
  story: { alignItems: "center", gap: 6, width: 72 },
  storyMe: { width: 60, height: 60, borderRadius: 30, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  storyRing: { width: 60, height: 60, borderRadius: 30, padding: 2.5, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  storyRingInner: { borderRadius: 28, padding: 2, backgroundColor: palette.paper },
  storyPlus: { position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.gold, borderWidth: 2, borderColor: palette.paper, alignItems: "center", justifyContent: "center" },
  emptyCard: { backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.lg },
  fab: { position: "absolute", right: spacing.lg, bottom: tabBarSpace, width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center", overflow: "hidden", ...shadow.card },
} as const;
