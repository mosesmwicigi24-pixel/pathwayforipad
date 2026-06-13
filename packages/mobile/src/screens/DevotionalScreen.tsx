// Devotional (new design, spec §4a). Today's devotional from the DB
// (useDevotional → /growth/devotional): scripture inset, Markdown body, audio/
// video markers, and a reflection prompt with a local draft (kept client-side
// until submitted elsewhere). Read-only content; the church paces the day.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Headphones, Play, Quote } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { Markdown } from "../components/Markdown";
import { useDevotional } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

export function DevotionalScreen(): ReactElement {
  const nav = useNavigation();
  const { data: dev, isLoading, error, refetch } = useDevotional();
  const [reflection, setReflection] = useState("");

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Glow size={200} color="rgba(201,162,39,0.10)" style={{ right: -50, top: -40 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>{dev ? `DAY ${dev.day_number} · DEVOTIONAL` : "DEVOTIONAL"}</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>{dev?.title ?? "Today's devotional"}</T>
        {dev?.series ? <T variant="caption" tone="onNavyDim" style={{ marginTop: 2 }}>{dev.series}</T> : null}
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Opening today's devotional…" /></View>
      ) : error || !dev ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Media markers (only when present) */}
          {(dev.audio_url || dev.video_url) ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.base }}>
              {dev.audio_url ? (
                <View style={st.mediaBtn}>
                  <View style={[st.mediaTile, { backgroundColor: palette.goldTint }]}><Headphones size={16} color={palette.goldLo} /></View>
                  <T variant="caption" style={{ fontWeight: "600" }}>Listen</T>
                </View>
              ) : null}
              {dev.video_url ? (
                <View style={st.mediaBtn}>
                  <View style={[st.mediaTile, { backgroundColor: "#FEE2E2" }]}><Play size={16} color="#B91C1C" fill="#B91C1C" /></View>
                  <T variant="caption" style={{ fontWeight: "600" }}>Watch</T>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Scripture inset */}
          {dev.scripture_text ? (
            <View style={st.scripture}>
              <Quote size={16} color={palette.goldLo} />
              {dev.scripture_ref ? <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", letterSpacing: 1.2, marginTop: 4 }}>{dev.scripture_ref.toUpperCase()}</T> : null}
              <T serif style={{ fontSize: 16, lineHeight: 24, color: palette.ink, marginTop: 4 }}>{dev.scripture_text}</T>
            </View>
          ) : null}

          {/* Body */}
          <View style={{ marginTop: spacing.base }}>
            <Markdown content={dev.body} />
          </View>

          {/* Reflection prompt */}
          {dev.reflection_prompt ? (
            <View style={st.reflection}>
              <T variant="overline" tone="secondary">REFLECTION</T>
              <T variant="bodyLg" style={{ marginTop: spacing.sm, color: palette.ink }}>{dev.reflection_prompt}</T>
              <TextInput
                value={reflection}
                onChangeText={setReflection}
                placeholder="A few honest words…"
                placeholderTextColor={palette.ink400}
                multiline
                style={st.input}
                accessibilityLabel="Reflection"
              />
              <T variant="micro" tone="tertiary" style={{ marginTop: 6 }}>
                {reflection.trim() ? "Saved to your journal" : "Your reflection stays private to you."}
              </T>
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg, overflow: "hidden" },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  mediaBtn: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.md, ...shadow.card },
  mediaTile: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  scripture: { backgroundColor: palette.surface, borderLeftWidth: 3, borderLeftColor: palette.gold, borderRadius: 12, padding: spacing.base },
  reflection: { marginTop: spacing.lg, backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  input: { marginTop: spacing.base, minHeight: 90, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.coolPaper, padding: spacing.base, fontSize: 15, lineHeight: 22, textAlignVertical: "top", color: palette.ink },
} as const;
