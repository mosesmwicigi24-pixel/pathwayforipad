// Prayer journal (new design, Contract Matrix M3 over B6). Private to you —
// no leader or admin can ever read it (§5.4 pastoral privacy). New prayer,
// mark answered (with an optional note of what God did), delete forever.
// Client-generated ids keep writes idempotent; entries sync across devices.
import { useState, type ReactElement } from "react";
import { Alert, Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Check, Trash2 } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { usePrayers, useScores } from "../api/hooks";
import { errorMessage, invalidateQueries, refreshQueries, setQueryData } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import type { PrayerEntry } from "../api/types";
import { Loading, ErrorState } from "../components/states";

const PRAYERS_KEY = "prayers";
const nowIso = (): string => new Date().toISOString();

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PrayerJournalScreen(): ReactElement {
  const nav = useNavigation();
  const kb = useKeyboardInset(); // lift compose fields above the keyboard (Android + iOS)
  const { data: prayers, isLoading, error, refetch } = usePrayers();
  const { data: scores } = useScores();
  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function refresh(): void {
    invalidateQueries("prayers");
    refreshQueries("scores"); // praying moves the Prayer score
    void refetch();
  }

  async function shareToWall(entryId: string): Promise<void> {
    Alert.alert("Share to the wall?", "Your congregation will see this request and can pray with you. You can make it private again anytime.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Share",
        onPress: () =>
          void NuruApi.sharePrayerToWall(entryId)
            .then(() => {
              invalidateQueries("prayerWall");
              invalidateQueries("prayerWallHome");
              Alert.alert("Shared", "Your prayer is now on the wall 🙏");
            })
            .catch((e) => Alert.alert("Couldn't share", errorMessage(e))),
      },
    ]);
  }

  async function save(): Promise<void> {
    setBusy(true);
    setActionError(null);
    const entry_id = uuidv4();
    const payload = { entry_id, title: title.trim() || null, body: body.trim(), client_mutation_id: uuidv4() };
    try {
      const { queued } = await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.upsertPrayer(payload),
        queued: { domain: "prayer_entries", op: "upsert", payload },
      });
      setTitle("");
      setBody("");
      setComposing(false);
      if (queued) {
        // Offline: show it immediately; the queued mutation replays on reconnect.
        const optimistic: PrayerEntry = {
          entry_id, title: payload.title, body: payload.body, is_answered: false,
          answered_note: null, answered_at: null, created_at: nowIso(), updated_at: nowIso(),
        };
        setQueryData<PrayerEntry[]>(PRAYERS_KEY, (prev) => [optimistic, ...(prev ?? [])]);
      } else {
        refresh();
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function markAnswered(entryId: string, entryBody: string, entryTitle: string | null): Promise<void> {
    const payload = { entry_id: entryId, title: entryTitle, body: entryBody, is_answered: true, client_mutation_id: uuidv4() };
    try {
      const { queued } = await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.upsertPrayer(payload),
        queued: { domain: "prayer_entries", op: "upsert", payload },
      });
      if (queued) {
        setQueryData<PrayerEntry[]>(PRAYERS_KEY, (prev) =>
          (prev ?? []).map((p) => (p.entry_id === entryId ? { ...p, is_answered: true, answered_at: nowIso() } : p)),
        );
      } else {
        refresh();
      }
    } catch (e) {
      setActionError(errorMessage(e));
    }
  }

  async function remove(entryId: string): Promise<void> {
    try {
      const { queued } = await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.deletePrayer(entryId),
        queued: { domain: "prayer_entries", op: "delete", payload: { entry_id: entryId } },
      });
      if (queued) {
        setQueryData<PrayerEntry[]>(PRAYERS_KEY, (prev) => (prev ?? []).filter((p) => p.entry_id !== entryId));
      } else {
        refresh();
      }
    } catch (e) {
      setActionError(errorMessage(e));
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
        <View style={{ flex: 1 }}>
          <T variant="heading" tone="onNavy">Prayer journal</T>
          <T variant="micro" tone="onNavyDim">Only you can read this — always.</T>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl + kb }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {scores && !composing ? (
          <View style={[st.card, st.scoreCard, { marginBottom: spacing.base }]}>
            <View style={st.scoreRing}>
              <T serif style={{ fontSize: 24, color: palette.navyDeep }}>{scores.prayer.score}</T>
              <T variant="micro" style={{ color: palette.ink600, marginTop: -3 }}>/100</T>
            </View>
            <View style={{ flex: 1 }}>
              <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 1.2 }}>PRAYER SCORE</T>
              <T variant="heading" style={{ color: palette.ink, marginTop: 1 }}>{scores.prayer.band}</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>Grows as you pray and journal — private to you</T>
            </View>
          </View>
        ) : null}
        {composing ? (
          <View style={[st.card, { gap: spacing.sm, marginBottom: spacing.base }]}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title (optional)"
              placeholderTextColor={palette.ink400}
              accessibilityLabel="Prayer title"
              style={st.input}
            />
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder="What are you praying for?"
              placeholderTextColor={palette.ink400}
              accessibilityLabel="Prayer"
              multiline
              style={[st.input, { height: 96, textAlignVertical: "top", paddingTop: spacing.md }]}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <PButton variant="gold" onPress={() => void save()} disabled={busy || body.trim().length === 0}>
                  {busy ? "Saving…" : "Save to journal"}
                </PButton>
              </View>
              <View style={{ flex: 1 }}>
                <PButton variant="ghost" onPress={() => setComposing(false)}>Cancel</PButton>
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.base }}>
            <PButton variant="gold" onPress={() => setComposing(true)}>New prayer</PButton>
          </View>
        )}

        {actionError ? <T variant="caption" style={{ color: palette.error, marginBottom: spacing.sm }}>{actionError}</T> : null}

        {isLoading ? <Loading label="Opening your journal…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {(prayers ?? []).map((p) => (
          <View key={p.entry_id} style={[st.card, { marginBottom: spacing.sm }, p.is_answered && st.answered]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              {p.is_answered ? (
                <View style={st.answeredBadge}>
                  <Check size={12} color={palette.white} />
                </View>
              ) : null}
              <T variant="heading" style={{ flex: 1, fontSize: 15 }} numberOfLines={1}>
                {p.title ?? (p.is_answered ? "Answered" : "Prayer")}
              </T>
              <T variant="micro" tone="tertiary">{when(p.created_at)}</T>
            </View>
            <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink }}>{p.body}</T>
            <View style={{ flexDirection: "row", gap: spacing.base, marginTop: spacing.md }}>
              {!p.is_answered ? (
                <Pressable accessibilityRole="button" onPress={() => void markAnswered(p.entry_id, p.body, p.title)}>
                  <T variant="caption" style={{ color: palette.navy, fontWeight: "600" }}>Mark answered</T>
                </Pressable>
              ) : (
                <T variant="caption" style={{ color: "#15803D", fontWeight: "600" }}>
                  {`Answered${p.answered_at ? ` · ${when(p.answered_at)}` : ""}`}
                </T>
              )}
              <Pressable accessibilityRole="button" accessibilityLabel="Share to the prayer wall" onPress={() => void shareToWall(p.entry_id)}>
                <T variant="caption" style={{ color: palette.goldLo, fontWeight: "700" }}>Share to wall ›</T>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Delete prayer" onPress={() => void remove(p.entry_id)}>
                <Trash2 size={16} color={palette.ink400} />
              </Pressable>
            </View>
          </View>
        ))}

        {!isLoading && (prayers ?? []).length === 0 ? (
          <View style={st.card}>
            <T variant="heading">Your quiet place</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              Write what you're carrying. When God answers, mark it — and build a record of faithfulness.
            </T>
          </View>
        ) : null}
      </ScrollView>
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
  card: {
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  scoreCard: { flexDirection: "row", alignItems: "center", gap: spacing.base },
  scoreRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 3, borderColor: palette.gold, alignItems: "center", justifyContent: "center", backgroundColor: palette.verseBg },
  answered: { borderColor: "rgba(21,128,61,0.30)" },
  answeredBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: "#15803D", alignItems: "center", justifyContent: "center" },
  input: {
    backgroundColor: palette.coolPaper,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.base,
    height: 48,
    fontSize: 15,
    color: palette.ink,
  },
} as const;
