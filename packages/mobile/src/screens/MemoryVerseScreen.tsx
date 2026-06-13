// Memory verses (new design, spec §4b). The verse library from the DB
// (useMemoryVerses) with per-member mastery; a type-from-memory practice scores
// the attempt locally (word overlap) and posts it — the SERVER decides mastery
// (≥90% match) and keeps the best score. Real data throughout.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Check } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useMemoryVerses } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import type { MemoryVerseRow } from "../api/types";

/** Word-overlap match the member sees while practicing; the server re-derives
 *  mastery from the posted pct, so this is presentation only. */
function matchPct(target: string, attempt: string): number {
  const norm = (x: string): string[] => x.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
  const want = norm(target);
  const got = new Set(norm(attempt));
  if (want.length === 0) return 0;
  const hit = want.filter((w) => got.has(w)).length;
  return Math.round((hit / want.length) * 100);
}

export function MemoryVerseScreen(): ReactElement {
  const nav = useNavigation();
  const { data: verses, isLoading, error, refetch } = useMemoryVerses();
  const [practice, setPractice] = useState<MemoryVerseRow | null>(null);

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>HIDE HIS WORD</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>Memory verses</T>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {isLoading ? <Loading label="Loading your verses…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}
        {(verses ?? []).map((v) => (
          <View key={v.memory_verse_id} style={[st.card, { marginBottom: spacing.sm }]}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <T variant="heading" style={{ flex: 1, fontSize: 15, color: palette.goldLo }}>{v.reference}</T>
              {v.status === "mastered" ? (
                <View style={st.masteredChip}>
                  <Check size={11} color={palette.successText} />
                  <T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Mastered</T>
                </View>
              ) : v.week_number ? (
                <View style={st.weekChip}><T variant="micro" style={{ color: palette.ink600 }}>{`Week ${v.week_number}`}</T></View>
              ) : null}
            </View>
            <T serif style={{ fontSize: 16, lineHeight: 24, color: palette.ink, marginTop: spacing.sm }}>{v.verse_text}</T>
            <View style={{ marginTop: spacing.md }}>
              <PButton variant={v.status === "mastered" ? "ghost" : "gold"} onPress={() => setPractice(v)}>
                {v.status === "mastered" ? "Practice again" : "Practice"}
              </PButton>
            </View>
          </View>
        ))}
        {!isLoading && (verses ?? []).length === 0 ? (
          <View style={st.card}><T variant="heading">No verses yet</T><T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Your church will add memory verses here.</T></View>
        ) : null}
      </ScrollView>

      {practice ? (
        <PracticeSheet
          verse={practice}
          onClose={() => setPractice(null)}
          onSaved={() => {
            setPractice(null);
            invalidateQueries("memoryVerses");
            void refetch();
          }}
        />
      ) : null}
    </View>
  );
}

function PracticeSheet({ verse, onClose, onSaved }: { verse: MemoryVerseRow; onClose: () => void; onSaved: () => void }): ReactElement {
  const [attempt, setAttempt] = useState("");
  const [busy, setBusy] = useState(false);
  const pct = matchPct(verse.verse_text, attempt);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      await NuruApi.practiceVerse(verse.memory_verse_id, pct);
      onSaved();
    } catch {
      setBusy(false);
    }
  }

  return (
    <View style={st.sheetWrap}>
      <Pressable style={st.sheetScrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={st.sheet}>
        <View style={st.grab} />
        <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>TYPE FROM MEMORY</T>
        <T variant="heading" style={{ color: palette.goldLo, marginTop: 4 }}>{verse.reference}</T>
        <TextInput
          value={attempt}
          onChangeText={setAttempt}
          placeholder="Begin typing the verse…"
          placeholderTextColor={palette.ink400}
          multiline
          autoFocus
          style={st.input}
          accessibilityLabel="Your attempt"
        />
        <View style={st.matchTrack}>
          <View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: pct >= 90 ? palette.success : palette.gold }} />
        </View>
        <T variant="micro" tone="tertiary" style={{ marginTop: 4 }}>{`${pct}% match${pct >= 90 ? " · mastered!" : ""}`}</T>
        <View style={{ marginTop: spacing.md }}>
          <PButton variant="gold" onPress={() => void save()} disabled={busy || attempt.trim().length === 0}>
            {busy ? "Saving…" : "Save practice"}
          </PButton>
        </View>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  masteredChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  weekChip: { backgroundColor: palette.surface, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  sheetWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "flex-end" },
  sheetScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: { backgroundColor: palette.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: spacing.xxl },
  grab: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: "rgba(10,37,64,0.15)", marginBottom: spacing.base },
  input: { marginTop: spacing.md, minHeight: 90, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, padding: spacing.base, fontSize: 16, lineHeight: 24, textAlignVertical: "top", color: palette.ink },
  matchTrack: { marginTop: spacing.md, height: 6, borderRadius: 3, backgroundColor: palette.track, overflow: "hidden" },
} as const;
