// Verse library (new design, Contract Matrix M3 over B6). "Your verse
// library": saved scriptures with an optional note, deduped per translation
// server-side, synced across devices. Client-generated ids = idempotent saves.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, BookMarked, Trash2 } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { useVerses } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";

export function VerseLibraryScreen(): ReactElement {
  const nav = useNavigation();
  const { data: verses, isLoading, error, refetch } = useVerses();
  const [adding, setAdding] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function refresh(): void {
    invalidateQueries("verses");
    void refetch();
  }

  async function save(): Promise<void> {
    setBusy(true);
    setActionError(null);
    try {
      await NuruApi.saveVerse({
        saved_verse_id: uuidv4(),
        reference: reference.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        client_mutation_id: uuidv4(),
      });
      setReference("");
      setNote("");
      setAdding(false);
      refresh();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await NuruApi.deleteVerse(id);
      refresh();
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
        <T variant="heading" tone="onNavy">Verse library</T>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {adding ? (
          <View style={[st.card, { gap: spacing.sm, marginBottom: spacing.base }]}>
            <TextInput
              value={reference}
              onChangeText={setReference}
              placeholder="Reference — e.g. John 3:16"
              placeholderTextColor={palette.ink400}
              accessibilityLabel="Verse reference"
              style={st.input}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="Why this verse? (optional)"
              placeholderTextColor={palette.ink400}
              accessibilityLabel="Note"
              multiline
              style={[st.input, { height: 72, textAlignVertical: "top", paddingTop: spacing.md }]}
            />
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <PButton variant="gold" onPress={() => void save()} disabled={busy || reference.trim().length < 3}>
                  {busy ? "Saving…" : "Save verse"}
                </PButton>
              </View>
              <View style={{ flex: 1 }}>
                <PButton variant="ghost" onPress={() => setAdding(false)}>Cancel</PButton>
              </View>
            </View>
          </View>
        ) : (
          <View style={{ marginBottom: spacing.base }}>
            <PButton variant="gold" onPress={() => setAdding(true)}>Save a verse</PButton>
          </View>
        )}

        {actionError ? <T variant="caption" style={{ color: palette.error, marginBottom: spacing.sm }}>{actionError}</T> : null}

        {isLoading ? <Loading label="Opening your library…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {(verses ?? []).map((v) => (
          <View key={v.saved_verse_id} style={[st.card, { marginBottom: spacing.sm }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <BookMarked size={15} color={palette.gold} />
              <T variant="heading" style={{ flex: 1, fontSize: 15 }}>{`${v.reference} · ${v.version}`}</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Remove verse" onPress={() => void remove(v.saved_verse_id)}>
                <Trash2 size={16} color={palette.ink400} />
              </Pressable>
            </View>
            {v.verse_text ? (
              <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, fontStyle: "italic" }}>
                &ldquo;{v.verse_text}&rdquo;
              </T>
            ) : null}
            {v.note ? <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>{v.note}</T> : null}
          </View>
        ))}

        {!isLoading && (verses ?? []).length === 0 ? (
          <View style={st.card}>
            <T variant="heading">Build your library</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              Save the verses that carry you — they'll be here on every device, even offline.
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
