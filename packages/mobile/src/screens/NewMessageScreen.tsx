// New message — the DM directory picker (mobile "Chat" make). Lists members the
// caller may message (GET /chat/people: same congregation, minor-safe — minors
// never appear and a minor caller gets an empty list). Tapping a person opens (or
// reuses) the 1:1 DM and jumps into the thread. Reached from the inbox compose FAB.
import { useState, type ReactElement } from "react";
import { ActivityIndicator, Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Search, X } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { ChatPerson } from "../api/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useChatPeople, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { NuruApi } from "../api/client";
import { Loading, ErrorState } from "../components/states";
import { initials, avatarColor } from "./chatInbox";

export function NewMessageScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [query, setQuery] = useState("");
  const { data, isLoading, error, refetch } = useChatPeople(query.trim());
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  async function open(person: ChatPerson): Promise<void> {
    setOpeningId(person.user_id);
    setOpenError(null);
    try {
      const { conversation_id } = await NuruApi.createDm(person.user_id);
      refreshQueries(queryKeys.chatInbox);
      nav.replace("ChatThread", { conversationId: conversation_id, title: person.full_name });
    } catch (e) {
      setOpenError(errorMessage(e));
    } finally {
      setOpeningId(null);
    }
  }

  const people = data?.people ?? [];

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => nav.goBack()}
          style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <T variant="micro" tone="gold" style={st.kicker}>NEW MESSAGE</T>
          <T serif tone="onNavy" style={{ fontSize: 22, marginTop: 2 }}>Start a chat</T>
        </View>
      </View>

      <View style={st.searchWrap}>
        <View style={st.search}>
          <Search size={18} color={palette.ink400} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search people"
            placeholderTextColor={palette.ink400}
            accessibilityLabel="Search people"
            autoCorrect={false}
            style={st.searchInput}
          />
          {query.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear" onPress={() => setQuery("")}>
              <X size={16} color={palette.ink400} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingTop: spacing.sm, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {openError ? <T variant="caption" style={{ color: palette.error, marginBottom: spacing.sm }}>{openError}</T> : null}
        {isLoading ? <Loading label="Finding people…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {!isLoading && !error && people.length === 0 ? (
          <View style={st.empty}>
            <T variant="heading">No one to message yet</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center" }}>
              {query ? "No members match your search." : "Direct messages open up as more members join your congregation."}
            </T>
          </View>
        ) : null}

        {people.map((p) => (
          <Pressable
            key={p.user_id}
            accessibilityRole="button"
            accessibilityLabel={`Message ${p.full_name}`}
            onPress={() => void open(p)}
            disabled={openingId !== null}
            style={({ pressed }) => [st.row, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <View style={[st.avatar, { backgroundColor: avatarColor(p.user_id) }]}>
              <T variant="heading" style={{ color: "#fff", fontSize: 15 }}>{initials(p.full_name)}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{p.full_name}</T>
              <T variant="caption" tone="secondary" numberOfLines={1}>{p.role}</T>
            </View>
            {openingId === p.user_id ? <ActivityIndicator color={palette.gold} /> : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.base, paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  searchWrap: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingBottom: spacing.base },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.10)", borderRadius: radii.pill, paddingHorizontal: spacing.base, height: 46,
  },
  searchInput: { flex: 1, color: palette.onNavy, fontSize: 15, paddingVertical: 0 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border,
    padding: spacing.base, marginBottom: spacing.sm, ...shadow.card,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
} as const;
