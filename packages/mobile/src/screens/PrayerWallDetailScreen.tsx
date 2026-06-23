// A single prayer request on its own page: the post, who's praying (🙏 + emoji
// reactions), the author's controls (mark answered / make private), and comments
// where the family can encourage and pray. Text + emoji (via keyboard).
import { useState, type ReactElement } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, CheckCircle2, Send, Trash2 } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { Avatar } from "../components/Avatar";
import { usePrayerWallPost } from "../api/hooks";
import { invalidateQueries, errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { useKeyboardInset } from "../components/useKeyboardInset";

const QUICK = ["🙏", "❤️", "🕊️", "🙌", "✨"];
const when = (iso: string): string => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function PrayerWallDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { postId } = useRoute<RouteProp<RootStackParamList, "PrayerWallDetail">>().params;
  const { data, isLoading, error, refetch } = usePrayerWallPost(postId);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const kb = useKeyboardInset();

  const refresh = (): void => {
    invalidateQueries(`prayerWallPost:${postId}`);
    invalidateQueries("prayerWall");
    invalidateQueries("prayerWallHome");
    void refetch();
  };

  async function react(emoji: string): Promise<void> {
    try { await NuruApi.prayerWallReact(postId, emoji); refresh(); } catch { /* best-effort */ }
  }
  async function comment(): Promise<void> {
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    try {
      await NuruApi.prayerWallComment(postId, { comment_id: uuidv4(), body, client_mutation_id: uuidv4() });
      setDraft("");
      refresh();
    } catch { /* keep draft */ } finally { setSending(false); }
  }
  async function toggleAnswered(): Promise<void> {
    if (!data) return;
    try { await NuruApi.prayerWallAnswered(postId, !data.post.is_answered); refresh(); } catch { /* best-effort */ }
  }
  function confirmRemove(): void {
    Alert.alert("Make private?", "This removes your request from the wall.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void NuruApi.deletePrayerWallPost(postId).then(() => { invalidateQueries("prayerWall"); invalidateQueries("prayerWallHome"); nav.goBack(); }).catch(() => undefined) },
    ]);
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T serif tone="onNavy" style={{ fontSize: 20 }}>Prayer</T>
      </View>

      {isLoading ? (
        <View style={{ paddingTop: spacing.xl }}><Loading label="Opening…" /></View>
      ) : error || !data ? (
        <View style={{ padding: spacing.screen }}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
            <View style={st.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                <Avatar uri={data.post.author_avatar} name={data.post.author_name} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="heading" style={{ color: palette.ink }} numberOfLines={1}>{data.post.author_name}</T>
                  <T variant="micro" tone="tertiary">{when(data.post.created_at)}</T>
                </View>
                {data.post.is_answered ? (
                  <View style={st.answeredChip}><CheckCircle2 size={12} color={palette.successText} /><T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Answered</T></View>
                ) : null}
              </View>
              {data.post.title ? <T serif style={{ fontSize: 18, color: palette.ink, marginTop: spacing.md }}>{data.post.title}</T> : null}
              <T variant="bodyLg" style={{ color: palette.ink, marginTop: spacing.sm }}>{data.post.body}</T>

              {/* Reaction bar */}
              <View style={st.reactBar}>
                {QUICK.map((e) => {
                  const r = data.post.reactions.find((x) => x.emoji === e);
                  const mine = r?.mine ?? false;
                  return (
                    <Pressable key={e} onPress={() => void react(e)} style={[st.reactChip, mine && st.reactChipOn]}>
                      <T style={{ fontSize: 15 }}>{e}</T>
                      {r && r.count > 0 ? <T variant="micro" style={{ color: mine ? palette.navyDeep : palette.ink600, fontWeight: "700" }}>{r.count}</T> : null}
                    </Pressable>
                  );
                })}
              </View>

              {data.post.mine ? (
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                  <Pressable onPress={() => void toggleAnswered()} style={st.ownerBtn}>
                    <CheckCircle2 size={14} color={palette.successText} />
                    <T variant="caption" style={{ color: palette.ink, fontWeight: "700" }}>{data.post.is_answered ? "Mark unanswered" : "Mark answered"}</T>
                  </Pressable>
                  <Pressable onPress={confirmRemove} style={st.ownerBtn}>
                    <Trash2 size={14} color={palette.error} />
                    <T variant="caption" style={{ color: palette.error, fontWeight: "700" }}>Make private</T>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <T variant="micro" tone="tertiary" style={{ fontWeight: "700", letterSpacing: 0.6, marginTop: spacing.lg, marginBottom: spacing.sm }}>
              {data.comments.length > 0 ? `${data.comments.length} ${data.comments.length === 1 ? "REPLY" : "REPLIES"}` : "BE THE FIRST TO ENCOURAGE"}
            </T>
            {data.comments.map((cm) => (
              <View key={cm.comment_id} style={[st.card, { marginBottom: spacing.sm }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Avatar uri={cm.author_avatar} name={cm.author_name} size={28} />
                  <T variant="caption" style={{ flex: 1, fontWeight: "700", color: palette.ink }} numberOfLines={1}>{cm.author_name}</T>
                  <T variant="micro" tone="tertiary">{when(cm.created_at)}</T>
                </View>
                <T variant="body" style={{ color: palette.ink, marginTop: 6 }}>{cm.body}</T>
              </View>
            ))}
          </ScrollView>

          <View style={[st.composer, { marginBottom: kb }]}>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Write an encouragement…" placeholderTextColor={palette.ink400} multiline style={st.input} />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={() => void comment()} disabled={sending || !draft.trim()} style={[st.sendBtn, (sending || !draft.trim()) && { opacity: 0.5 }]}>
              <Send size={18} color="#fff" />
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  answeredChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  reactBar: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  reactChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  reactChipOn: { backgroundColor: palette.goldChipBg, borderColor: palette.gold },
  ownerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, padding: spacing.sm, backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.border },
  input: { flex: 1, maxHeight: 120, minHeight: 44, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, paddingHorizontal: spacing.base, paddingTop: 12, fontSize: 15, color: palette.ink },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: palette.navyDeep, alignItems: "center", justifyContent: "center" },
} as const;
