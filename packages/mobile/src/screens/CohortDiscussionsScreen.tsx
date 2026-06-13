// Cohort discussions (new design, spec §10 "Open cohort space"). The cell-scoped
// thread board, reachable from Community. Real data from B8: useThreads +
// createThread; client-generated ids make posting idempotent (§3.6). Members
// without a cell get a kind explainer.
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { ChevronLeft, MessageSquareText, Pin } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, PButton, T } from "../theme/components";
import { useThreads } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading } from "../components/states";

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function CohortDiscussionsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: threads, isLoading, error, refetch } = useThreads();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const noCell = error && errorMessage(error).toLowerCase().includes("cell");

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  async function post(): Promise<void> {
    setPosting(true);
    setPostError(null);
    try {
      await NuruApi.createThread({ thread_id: uuidv4(), title: title.trim(), body: body.trim(), client_mutation_id: uuidv4() });
      setTitle("");
      setBody("");
      setComposing(false);
      invalidateQueries("threads");
      void refetch();
    } catch (e) {
      setPostError(errorMessage(e));
    } finally {
      setPosting(false);
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Glow size={200} color="rgba(201,162,39,0.10)" style={{ right: -50, top: -40 }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => nav.goBack()}
          style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <ChevronLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>YOUR COHORT</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>Discussions</T>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {isLoading ? <Loading label="Loading your cohort…" /> : null}

        {noCell ? (
          <View style={st.card}>
            <T variant="heading">Join a cell group first</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              Discussions live inside your cell. Ask your leader to add you, and this space comes alive.
            </T>
          </View>
        ) : null}

        {!isLoading && !noCell ? (
          <>
            {composing ? (
              <View style={[st.card, { gap: spacing.sm }]}>
                <TextInput value={title} onChangeText={setTitle} placeholder="Topic title" placeholderTextColor={palette.ink400} accessibilityLabel="Thread title" style={st.input} />
                <TextInput
                  value={body}
                  onChangeText={setBody}
                  placeholder="What's on your heart?"
                  placeholderTextColor={palette.ink400}
                  accessibilityLabel="Thread body"
                  multiline
                  style={[st.input, { height: 96, textAlignVertical: "top", paddingTop: spacing.md }]}
                />
                {postError ? <T variant="caption" style={{ color: palette.error }}>{postError}</T> : null}
                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <PButton variant="gold" onPress={() => void post()} disabled={posting || title.trim().length < 3 || body.trim().length === 0}>
                      {posting ? "Posting…" : "Post to cohort"}
                    </PButton>
                  </View>
                  <View style={{ flex: 1 }}>
                    <PButton variant="ghost" onPress={() => setComposing(false)}>Cancel</PButton>
                  </View>
                </View>
              </View>
            ) : (
              <PButton variant="gold" onPress={() => setComposing(true)}>Start a discussion</PButton>
            )}

            <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
              {(threads ?? []).map((t) => (
                <Pressable
                  key={t.thread_id}
                  onPress={() => nav.navigate("Thread", { threadId: t.thread_id, title: t.title })}
                  style={({ pressed }) => [st.threadCard, pressed && { transform: [{ scale: 0.99 }] }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    {t.is_pinned ? <Pin size={14} color={palette.gold} /> : null}
                    <T variant="heading" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>{t.title}</T>
                  </View>
                  <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>{t.body}</T>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
                    <MessageSquareText size={13} color={palette.ink400} />
                    <T variant="micro" tone="tertiary">
                      {`${t.comment_count} ${t.comment_count === 1 ? "comment" : "comments"} · ${t.author_name} · ${ago(t.created_at)}`}
                      {t.is_locked ? " · locked" : ""}
                    </T>
                  </View>
                </Pressable>
              ))}
              {(threads ?? []).length === 0 ? (
                <View style={st.card}>
                  <T variant="heading">A quiet room, for now</T>
                  <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
                    Be the first — share what this week's module stirred in you.
                  </T>
                </View>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg, overflow: "hidden" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  threadCard: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  input: { backgroundColor: palette.coolPaper, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, paddingHorizontal: spacing.base, height: 48, fontSize: 15, color: palette.ink },
} as const;
