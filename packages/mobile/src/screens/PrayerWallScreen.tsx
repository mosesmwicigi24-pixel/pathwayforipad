// Prayer Wall — a public space where members post prayer requests others pray
// under (🙏 + emoji) and comment. Opt-in (separate from the private journal).
// Tap a request to open its own page; "+" composes a new one.
import { useCallback, useState, type ReactElement } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, MessageCircle, Plus, X, CheckCircle2 } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { Avatar } from "../components/Avatar";
import { usePrayerWall } from "../api/hooks";
import { invalidateQueries, errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { useVoiceNote, VoiceRecorderButton, VoiceNotePlayer } from "../components/voiceNote";
import type { PrayerWallPost } from "../api/types";

function ago(iso: string): string {
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function PrayerWallScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [sort, setSort] = useState<"latest" | "prayed">("latest");
  const { data: posts, isLoading, error, refetch } = usePrayerWall(sort);
  const [refreshing, setRefreshing] = useState(false);
  const [composing, setComposing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refetch(); } finally { setRefreshing(false); }
  }, [refetch]);

  const refreshAll = useCallback(() => {
    invalidateQueries("prayerWall");
    invalidateQueries("prayerWallHome");
    void refetch();
  }, [refetch]);

  async function pray(p: PrayerWallPost): Promise<void> {
    try {
      await NuruApi.prayerWallReact(p.post_id, "🙏");
      refreshAll();
    } catch { /* best-effort */ }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <T variant="micro" tone="gold" style={st.kicker}>PRAY FOR ONE ANOTHER</T>
          <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 2 }}>Prayer Wall</T>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="New prayer request" onPress={() => setComposing(true)} style={st.addBtn}>
          <Plus size={20} color={palette.navyDeep} />
        </Pressable>
      </View>

      <View style={st.sortRow}>
        {(["latest", "prayed"] as const).map((s) => (
          <Pressable key={s} onPress={() => setSort(s)} style={[st.sortChip, sort === s && st.sortChipOn]}>
            <T variant="caption" style={{ color: sort === s ? palette.navyDeep : palette.ink600, fontWeight: "700" }}>
              {s === "latest" ? "Latest" : "Most prayed"}
            </T>
          </Pressable>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl, gap: spacing.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {isLoading ? <Loading label="Loading the wall…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}
        {!isLoading && !error && (posts ?? []).length === 0 ? (
          <View style={{ alignItems: "center", paddingTop: spacing.xxl }}>
            <T serif style={{ fontSize: 18, color: palette.ink }}>No requests yet</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center" }}>Be the first to share a prayer for the family to stand with you.</T>
          </View>
        ) : null}
        {(posts ?? []).map((p) => (
          <Pressable key={p.post_id} onPress={() => nav.navigate("PrayerWallDetail", { postId: p.post_id })} style={({ pressed }) => [st.card, pressed && { opacity: 0.92 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Avatar uri={p.author_avatar} name={p.author_name} size={36} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{p.author_name}</T>
                <T variant="micro" tone="tertiary">{ago(p.created_at)}</T>
              </View>
              {p.is_answered ? (
                <View style={st.answeredChip}><CheckCircle2 size={11} color={palette.successText} /><T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Answered</T></View>
              ) : null}
            </View>
            {p.title ? <T variant="heading" style={{ marginTop: spacing.sm, color: palette.ink }}>{p.title}</T> : null}
            <T variant="body" tone="secondary" style={{ marginTop: 4 }} numberOfLines={3}>{p.body}</T>
            {p.audio_url ? <VoiceNotePlayer url={p.audio_url} waveform={p.audio_waveform} /> : null}
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.md }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Pray for this" onPress={() => void pray(p)} style={[st.prayBtn, p.i_prayed && st.prayBtnOn]}>
                <T style={{ fontSize: 15 }}>🙏</T>
                <T variant="caption" style={{ fontWeight: "700", color: p.i_prayed ? palette.navyDeep : palette.ink600 }}>{p.pray_count > 0 ? `${p.pray_count} praying` : "Pray"}</T>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <MessageCircle size={15} color={palette.ink400} />
                <T variant="caption" tone="tertiary">{p.comment_count}</T>
              </View>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={composing} animationType="slide" transparent onRequestClose={() => setComposing(false)}>
        <ComposeSheet onClose={() => setComposing(false)} onPosted={() => { setComposing(false); refreshAll(); }} />
      </Modal>
    </View>
  );
}

function ComposeSheet({ onClose, onPosted }: { onClose: () => void; onPosted: () => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kb = useKeyboardInset();
  const voice = useVoiceNote();

  async function post(): Promise<void> {
    const text = body.trim();
    if (!text && !voice.audioUrl) return;
    setBusy(true);
    setErr(null);
    try {
      await NuruApi.createPrayerWallPost({
        post_id: uuidv4(),
        title: title.trim() || null,
        body: text || "🎤 Voice prayer",
        audio_url: voice.audioUrl,
        audio_waveform: voice.audioUrl ? voice.waveform : null,
        client_mutation_id: uuidv4(),
      });
      onPosted();
    } catch (e) {
      setErr(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.scrim} onPress={onClose} />
      <View style={[st.sheet, { marginBottom: kb }]}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <T serif style={{ flex: 1, fontSize: 20, color: palette.ink }}>Share a prayer</T>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}><X size={20} color={palette.ink600} /></Pressable>
        </View>
        <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>The family in your congregation can pray with you.</T>
        <TextInput value={title} onChangeText={setTitle} placeholder="Title (optional)" placeholderTextColor={palette.ink400} style={st.titleInput} />
        <TextInput value={body} onChangeText={setBody} placeholder="What would you like prayer for?" placeholderTextColor={palette.ink400} multiline style={st.bodyInput} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
          <VoiceRecorderButton v={voice} onError={setErr} />
          <T variant="micro" tone="tertiary" style={{ flex: 1 }}>{voice.uploading ? "Uploading voice…" : "Add a voice note (optional)"}</T>
        </View>
        {err ? <T variant="caption" style={{ color: palette.error, marginTop: 6 }}>{err}</T> : null}
        <Pressable accessibilityRole="button" onPress={() => void post()} disabled={busy || (!body.trim() && !voice.audioUrl)} style={[st.postBtn, (busy || (!body.trim() && !voice.audioUrl)) && { opacity: 0.5 }]}>
          <T variant="heading" style={{ color: "#fff" }}>{busy ? "Posting…" : "Post to wall"}</T>
        </Pressable>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.gold, alignItems: "center", justifyContent: "center" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  sortRow: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.screen, paddingTop: spacing.md },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border },
  sortChipOn: { backgroundColor: palette.goldChipBg, borderColor: palette.gold },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  answeredChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  prayBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: radii.pill, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  prayBtnOn: { backgroundColor: palette.goldChipBg, borderColor: palette.gold },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl },
  titleInput: { marginTop: spacing.base, height: 44, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, paddingHorizontal: spacing.base, fontSize: 15, color: palette.ink },
  bodyInput: { marginTop: spacing.sm, minHeight: 110, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, padding: spacing.base, fontSize: 15, lineHeight: 22, textAlignVertical: "top", color: palette.ink },
  postBtn: { marginTop: spacing.base, height: 52, borderRadius: radii.button, backgroundColor: palette.navyDeep, alignItems: "center", justifyContent: "center" },
} as const;
