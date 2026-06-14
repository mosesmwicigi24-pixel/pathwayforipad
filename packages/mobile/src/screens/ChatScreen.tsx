// Chat tab (new design, mobile "Chat" make). A unified inbox — DMs, your cell
// group, and joined spaces — with unread counts + last-message previews, a
// "Discover spaces" rail, and a doorway to the Nuru AI assistant. All data is
// real (GET /chat/conversations). Tapping a conversation opens the thread; a
// space you haven't joined opens its preview first.
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Hash, Sparkles, Users } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatConversation, DiscoverSpace } from "../api/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useChatInbox } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

function ago(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function preview(c: ChatConversation): string {
  if (!c.last_body && !c.last_type) return c.topic ?? "No messages yet";
  if (c.last_type && c.last_type !== "text") return `📎 ${c.last_type}`;
  const who = c.last_author ? `${c.last_author.split(" ")[0]}: ` : "";
  return `${who}${c.last_body ?? ""}`;
}

export function ChatScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data, isLoading, error, refetch } = useChatInbox();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Glow size={200} color="rgba(201,162,39,0.10)" style={{ right: -50, top: -40 }} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <T variant="micro" tone="gold" style={st.kicker}>YOUR PEOPLE</T>
            <T serif tone="onNavy" style={{ fontSize: 26, marginTop: 2 }}>Chat</T>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ask Nuru"
            onPress={() => nav.navigate("Nuru")}
            style={({ pressed }) => [st.nuruBtn, pressed && { transform: [{ scale: 0.96 }] }]}
          >
            <Sparkles size={18} color="#fff" />
            <T variant="micro" style={{ color: "#fff", fontWeight: "700" }}>Nuru</T>
          </Pressable>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {isLoading ? <Loading label="Loading your conversations…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {/* Ask Nuru banner */}
        {!isLoading && !error ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Nuru")}
            style={({ pressed }) => [st.nuruCard, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <View style={st.nuruOrb}><Sparkles size={20} color="#fff" /></View>
            <View style={{ flex: 1 }}>
              <T variant="heading" tone="onNavy" style={{ fontSize: 15 }}>Ask Nuru ✨</T>
              <T variant="caption" style={{ color: "rgba(255,255,255,0.7)", marginTop: 2 }}>
                Summarize a chat, draft an encouragement, find prayer
              </T>
            </View>
          </Pressable>
        ) : null}

        {/* Conversations */}
        {(data?.conversations ?? []).map((c) => (
          <Pressable
            key={c.conversation_id}
            accessibilityRole="button"
            onPress={() => nav.navigate("ChatThread", { conversationId: c.conversation_id, ...(c.title ? { title: c.title } : {}) })}
            style={({ pressed }) => [st.row, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <ConvoAvatar conversation={c} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <T variant="heading" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>{c.title ?? "Conversation"}</T>
                <T variant="micro" tone="tertiary">{ago(c.last_at)}</T>
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 2 }}>
                <T variant="caption" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>{preview(c)}</T>
                {c.unread > 0 ? (
                  <View style={st.badge}><T variant="micro" style={{ color: palette.navy, fontWeight: "800" }}>{c.unread}</T></View>
                ) : null}
              </View>
            </View>
          </Pressable>
        ))}

        {!isLoading && !error && (data?.conversations ?? []).length === 0 ? (
          <View style={st.card}>
            <T variant="heading">No conversations yet</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              Join a space below, or message someone from your cell.
            </T>
          </View>
        ) : null}

        {/* Discover spaces */}
        {(data?.discover_spaces ?? []).length > 0 ? (
          <>
            <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>DISCOVER SPACES</T>
            {(data?.discover_spaces ?? []).map((s: DiscoverSpace) => (
              <Pressable
                key={s.conversation_id}
                accessibilityRole="button"
                onPress={() => nav.navigate("SpacePreview", { conversationId: s.conversation_id, ...(s.title ? { title: s.title } : {}) })}
                style={({ pressed }) => [st.spaceRow, pressed && { transform: [{ scale: 0.99 }] }]}
              >
                <View style={st.spaceIcon}><Hash size={18} color={palette.gold} /></View>
                <View style={{ flex: 1 }}>
                  <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{s.title ?? "Space"}</T>
                  <T variant="caption" tone="secondary" numberOfLines={1}>
                    {s.topic ?? "A public space"} · {s.member_count} {s.member_count === 1 ? "member" : "members"}
                  </T>
                </View>
              </Pressable>
            ))}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ConvoAvatar({ conversation }: { conversation: ChatConversation }): ReactElement {
  if (conversation.kind === "space") {
    return <View style={st.avatarSpace}><Hash size={18} color={palette.gold} /></View>;
  }
  if (conversation.kind === "group") {
    return <View style={st.avatarGroup}><Users size={18} color={palette.navy} /></View>;
  }
  const initials = (conversation.title ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return <View style={st.avatarDm}><T variant="heading" style={{ color: "#fff", fontSize: 15 }}>{initials || "·"}</T></View>;
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg, overflow: "hidden" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  nuruBtn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#7c3aed", paddingHorizontal: spacing.md, height: 38, borderRadius: 19,
  },
  nuruCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.navy, borderRadius: 18, padding: spacing.base, marginBottom: spacing.base,
    ...shadow.card,
  },
  nuruOrb: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#7c3aed", alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border,
    padding: spacing.base, marginBottom: spacing.sm, ...shadow.card,
  },
  spaceRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: "rgba(201,162,39,0.25)",
    padding: spacing.base, marginBottom: spacing.sm,
  },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base },
  badge: { minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 11, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  avatarSpace: { width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(201,162,39,0.14)", alignItems: "center", justifyContent: "center" },
  avatarGroup: { width: 46, height: 46, borderRadius: 14, backgroundColor: "rgba(11,31,51,0.08)", alignItems: "center", justifyContent: "center" },
  avatarDm: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  spaceIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.14)", alignItems: "center", justifyContent: "center" },
} as const;
