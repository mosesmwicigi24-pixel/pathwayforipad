// Thread detail (new design, Contract Matrix M2 over B8). The conversation:
// original post + comments in order, with a composer at the bottom. Locked
// threads stay readable but the composer explains itself instead of failing.
// Client-generated comment ids make replies idempotent (§3.6).
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Lock, Pin } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useThread, queryKeys } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { Loading, ErrorState } from "../components/states";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ThreadScreen(): ReactElement {
  const nav = useNavigation();
  const route = useRoute<RouteProp<RootStackParamList, "Thread">>();
  const { threadId } = route.params;
  const { data: thread, isLoading, error, refetch } = useThread(threadId);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function post(): Promise<void> {
    setPosting(true);
    setPostError(null);
    try {
      const payload = { comment_id: uuidv4(), body: comment.trim(), client_mutation_id: uuidv4() };
      await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.addComment(threadId, payload),
        queued: { domain: "discussion_comments", op: "create", payload: { thread_id: threadId, ...payload } },
      });
      setComment("");
      invalidateQueries(queryKeys.thread(threadId));
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => nav.goBack()}
          style={({ pressed }) => [st.iconBtn, pressed && { transform: [{ scale: 0.95 }] }]}
        >
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="heading" tone="onNavy" style={{ flex: 1 }} numberOfLines={1}>
          {thread?.title ?? route.params.title ?? "Discussion"}
        </T>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Loading label="Opening the conversation…" />
        </View>
      ) : error || !thread ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </View>
      ) : (
        <>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.lg }} showsVerticalScrollIndicator={false}>
            {/* Original post */}
            <View style={st.post}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {thread.is_pinned ? <Pin size={14} color={palette.gold} /> : null}
                <T variant="micro" tone="tertiary">{`${thread.author_name} · ${when(thread.created_at)}`}</T>
              </View>
              <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink }}>{thread.body}</T>
            </View>

            {/* Comments */}
            <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
              {`${thread.comments.length} ${thread.comments.length === 1 ? "COMMENT" : "COMMENTS"}`}
            </T>
            {thread.comments.map((c) => (
              <View key={c.comment_id} style={st.comment}>
                <T variant="micro" tone="tertiary">{`${c.author_name} · ${when(c.created_at)}`}</T>
                <T variant="body" style={{ marginTop: 4, color: palette.ink }}>{c.body}</T>
              </View>
            ))}
            {thread.comments.length === 0 ? (
              <T variant="caption" tone="secondary">No comments yet — be the first to respond.</T>
            ) : null}
          </ScrollView>

          {/* Composer */}
          <View style={st.composer}>
            {thread.is_locked ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm }}>
                <Lock size={14} color={palette.ink400} />
                <T variant="caption" tone="secondary">Your leader has closed this conversation.</T>
              </View>
            ) : (
              <>
                <TextInput
                  value={comment}
                  onChangeText={setComment}
                  placeholder="Add to the conversation…"
                  placeholderTextColor={palette.ink400}
                  accessibilityLabel="Comment"
                  multiline
                  style={st.input}
                />
                {postError ? <T variant="caption" style={{ color: palette.error, marginTop: 4 }}>{postError}</T> : null}
                <View style={{ marginTop: spacing.sm }}>
                  <PButton variant="gold" onPress={() => void post()} disabled={posting || comment.trim().length === 0}>
                    {posting ? "Posting…" : "Comment"}
                  </PButton>
                </View>
              </>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.navy,
    paddingTop: 54,
    paddingBottom: spacing.base,
    paddingHorizontal: spacing.lg,
  },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  post: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.25)",
    padding: spacing.base,
    ...shadow.card,
  },
  comment: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.white,
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  input: {
    backgroundColor: palette.coolPaper,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.md,
    minHeight: 48,
    maxHeight: 120,
    fontSize: 15,
    color: palette.ink,
    textAlignVertical: "top",
  },
} as const;
