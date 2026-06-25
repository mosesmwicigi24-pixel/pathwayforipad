// Chat tab — "Nuru Connect" workspace (mobile Chat make). A Slack-style inbox
// split into three sections via a segmented control: #My Space (joined public
// spaces + discoverable ones), DM (direct messages), and My Groups (cell / cohort
// / leader rooms). A search field filters the active section; a "Quick help from
// Nuru" card opens the AI assistant; the compose FAB opens the DM directory. All
// data is real (GET /chat/conversations). Tapping a conversation opens its thread;
// an undiscovered space opens its preview first.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { CalendarClock, ChevronRight, Hash, MessageCircle, Pencil, Plus, Search, Sparkles, Users } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatConversation, ChatPerson, DiscoverSpace } from "../api/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { useChatInbox, useChatPeople, useMentor, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { NuruApi } from "../api/client";
import { Loading, ErrorState } from "../components/states";
import { Avatar } from "../components/Avatar";
import { NotificationBell } from "../components/NotificationBell";
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
  type ChatTab,
} from "./chatInbox";

const TABS: { key: ChatTab; label: string }[] = [
  { key: "spaces", label: "#My Space" },
  { key: "dms", label: "DM" },
  { key: "groups", label: "My Groups" },
];

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

  // Open (creating if needed) a DM with a member from the directory rail, then
  // jump into the thread. On return the inbox holds that DM, so the person shows
  // as a normal DM (no "+") and drops out of the directory rail.
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

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <T variant="micro" tone="gold" style={st.kicker}>WORKSPACE</T>
            <T serif tone="onNavy" style={{ fontSize: 30, marginTop: 2 }}>Nuru Connect</T>
            <T variant="caption" style={{ color: "rgba(255,255,255,0.65)", marginTop: 4 }}>
              {stats.unread} unread · {stats.spaces} {stats.spaces === 1 ? "space" : "spaces"}
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
        {isLoading ? <Loading label="Loading your conversations…" /> : null}
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
              <View style={st.nuruOrb}><Sparkles size={20} color="#fff" /></View>
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
      <SectionLabel icon="#" text="YOUR SPACES" />
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
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg }}>
            <SectionLabel icon="◎" text="DISCOVER SPACES" inline />
            <T variant="caption" tone="tertiary">{discover.length}</T>
          </View>
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
                    <T variant="heading" style={{ flexShrink: 1, fontSize: 17 }} numberOfLines={1}>{s.title ?? "Space"}</T>
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
  // the directory shows in the rail with a "+" to start a new DM. We match by
  // name since the DM inbox row is titled with the other member's full name.
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
      {/* Story rail: compose · existing partners · directory members (with +) */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.base, paddingVertical: spacing.sm }}>
        <Pressable accessibilityRole="button" accessibilityLabel="New message" onPress={onCompose} style={st.story}>
          <View style={[st.storyAvatar, { backgroundColor: palette.navy }]}>
            <T variant="heading" style={{ color: "#fff", fontSize: 15 }}>ME</T>
            <View style={st.storyPlus}><Plus size={12} color={palette.navy} /></View>
          </View>
          <T variant="micro" tone="tertiary" numberOfLines={1}>New chat</T>
        </Pressable>
        {dms.map((c) => (
          <Pressable key={c.conversation_id} accessibilityRole="button" accessibilityLabel={c.title ?? "Chat"} onPress={() => onOpen(c)} style={st.story}>
            <View style={[st.storyAvatar, st.storyRing, { backgroundColor: avatarColor(c.conversation_id) }]}>
              <T variant="heading" style={{ color: "#fff", fontSize: 15 }}>{initials(c.title)}</T>
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
            <View style={[st.storyAvatar, { backgroundColor: avatarColor(p.user_id) }]}>
              <T variant="heading" style={{ color: "#fff", fontSize: 15 }}>{initials(p.full_name)}</T>
              <View style={st.storyPlus}><Plus size={12} color={palette.navy} /></View>
            </View>
            <T variant="micro" tone="tertiary" numberOfLines={1} style={{ maxWidth: 64, textAlign: "center" }}>
              {p.full_name.split(" ")[0]}
            </T>
          </Pressable>
        ))}
      </ScrollView>

      <SectionLabel icon="✉" text="DIRECT MESSAGES" />
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
      <SectionLabel icon="◇" text="YOUR GROUPS" />
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={c.title ?? "Conversation"}
      onPress={onPress}
      style={({ pressed }) => [st.row, !first && st.rowDivider, pressed && { backgroundColor: palette.surface }]}
    >
      {hash ? (
        <View style={[st.avatarSquare, { backgroundColor: avatarColor(c.conversation_id) }]}><Hash size={20} color="#fff" /></View>
      ) : group ? (
        <View style={[st.avatarSquare, { backgroundColor: avatarColor(c.conversation_id) }]}><Users size={20} color="#fff" /></View>
      ) : (
        <Avatar uri={c.avatar_url} name={c.title} size={48} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T variant="heading" style={{ flexShrink: 1, fontSize: 15 }} numberOfLines={1}>
            {c.title ?? "Conversation"}{subtype ? <T variant="caption" tone="tertiary"> · {subtype}</T> : null}
          </T>
          {hash ? <CategoryPill category={c.category} /> : null}
          <View style={{ flex: 1 }} />
          <T variant="micro" tone={c.unread > 0 ? "gold" : "tertiary"} style={c.unread > 0 ? { fontWeight: "700" } : undefined}>
            {inboxTime(c.last_at)}
          </T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 3 }}>
          <T variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>{previewText(c)}</T>
          {c.unread > 0 ? (
            <View style={st.badge}><T variant="micro" style={{ color: palette.navy, fontWeight: "800" }}>{c.unread}</T></View>
          ) : null}
        </View>
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

function SectionLabel({ icon, text, inline }: { icon: string; text: string; inline?: boolean }): ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: inline ? 0 : spacing.lg, marginBottom: spacing.sm }}>
      <T variant="overline" tone="gold">{icon}</T>
      <T variant="overline" tone="gold">{text}</T>
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

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 56, paddingBottom: spacing.base, overflow: "hidden", borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  kicker: { letterSpacing: 2, textTransform: "uppercase" },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: spacing.base, height: 48, marginTop: spacing.base,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: { flex: 1, color: palette.onNavy, fontSize: 15, paddingVertical: 0 },
  nuruCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderRadius: 20, padding: spacing.base, marginBottom: spacing.base, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(201,162,39,0.35)", ...shadow.card,
  },
  nuruOrb: { width: 48, height: 48, borderRadius: 16, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
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
  group: { backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.base },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  tag: { paddingHorizontal: 8, height: 20, borderRadius: 6, alignItems: "center", justifyContent: "center" },
  avatarSquare: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  memberDot: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: palette.white },
  memberCount: { width: 34, height: 34, borderRadius: 17, marginLeft: -12, backgroundColor: palette.white, borderWidth: 1.5, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  avatarRound: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  discoverCard: { backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
  joinBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.navy, paddingHorizontal: spacing.base, height: 38, borderRadius: radii.pill },
  story: { alignItems: "center", gap: 6, width: 72 },
  storyAvatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  storyRing: { borderWidth: 2, borderColor: palette.gold },
  storyPlus: { position: "absolute", bottom: -2, right: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: palette.gold, borderWidth: 2, borderColor: palette.paper, alignItems: "center", justifyContent: "center" },
  emptyCard: { backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.lg },
  fab: { position: "absolute", right: spacing.lg, bottom: tabBarSpace, width: 60, height: 60, borderRadius: 30, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center", ...shadow.card },
} as const;
