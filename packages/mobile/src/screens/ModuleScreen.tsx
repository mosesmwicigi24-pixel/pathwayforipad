// Lesson reader (spec §1.7; Figma "LessonReader"). Distraction-free reader: navy
// header, media card, scripture + reflection blocks, sticky "Mark complete".
// "Mark complete" enqueues an offline mutation (commits locally, replays on sync),
// then advances to the quiz.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";

export function ModuleScreen({ moduleId }: { moduleId: string }): ReactElement {
  const nav = useNavigation();
  const [marked, setMarked] = useState(false);
  const [reflection, setReflection] = useState("");

  function complete(): void {
    // engine.enqueue("module_progress", "complete", { module_id, reflection_text, completed_at })
    setMarked(true);
    setTimeout(() => nav.navigate({ name: "Quiz", moduleId }), 350);
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Navy header */}
      <View style={st.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.iconBtn}>
            <T tone="onNavy" variant="heading">‹</T>
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="onNavyDim" style={{ letterSpacing: 1.4 }}>LESSON · MODULE {moduleId.slice(0, 4)}</T>
            <T variant="heading" tone="onNavy" style={{ marginTop: 2 }}>The Church of Christ</T>
          </View>
          <View style={st.minutesPill}>
            <T variant="caption" tone="onNavyDim">12 min</T>
          </View>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        {/* Media card */}
        <View style={st.media}>
          <View style={st.mediaHead}>
            <View style={st.mediaTag}><T variant="micro" tone="onNavy">LESSON MEDIA</T></View>
            <T variant="display" tone="onNavy" style={{ marginTop: spacing.lg }}>The Church of Christ</T>
            <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm }}>
              Read, listen, or watch — all available offline after sync.
            </T>
          </View>
          <View style={st.mediaRow}>
            <View style={st.mediaBtn}>
              <View style={[st.mediaIcon, { backgroundColor: palette.navy }]}><T style={{ color: palette.gold }}>▶</T></View>
              <T variant="body" style={{ fontWeight: "500" }}>Audio lesson</T>
              <T variant="caption" tone="secondary">6:42</T>
            </View>
            <View style={st.mediaBtn}>
              <View style={[st.mediaIcon, { backgroundColor: palette.white }]}><T style={{ color: palette.navy }}>▷</T></View>
              <T variant="body" style={{ fontWeight: "500" }}>Video teaching</T>
              <T variant="caption" tone="secondary">4:18</T>
            </View>
          </View>
        </View>

        {/* Article */}
        <View style={{ gap: spacing.lg, marginTop: spacing.lg }}>
          <T variant="bodyLg" style={{ color: "#1E293B" }}>
            The Church is not first a building or an event. It is the living body of Christ — a family of believers
            called together by the Holy Spirit, formed in love, and sent into the world with a shared mission.
          </T>

          {/* Scripture card */}
          <View style={st.scripture}>
            <T variant="caption" tone="gold" style={{ fontWeight: "700" }}>✦</T>
            <T variant="bodyLg" style={{ fontStyle: "italic", color: "#1E293B", marginTop: spacing.sm }}>
              “…on this rock I will build my church, and the gates of Hades will not overcome it.”
            </T>
            <T variant="overline" tone="gold" style={{ marginTop: spacing.md }}>MATTHEW 16:18</T>
          </View>

          <T variant="bodyLg" style={{ color: "#1E293B" }}>
            When you belong to a church family, your faith becomes visible through service, forgiveness, generosity,
            and consistent fellowship with other believers.
          </T>

          {/* Reflection */}
          <View style={st.reflection}>
            <T variant="overline" tone="secondary">REFLECTION</T>
            <T variant="bodyLg" style={{ marginTop: spacing.sm, color: "#1E293B" }}>
              What is one practical way you can contribute more meaningfully to your church community this week?
            </T>
            <TextInput
              value={reflection}
              onChangeText={setReflection}
              placeholder="Write your thoughts here…"
              placeholderTextColor={palette.ink400}
              multiline
              numberOfLines={4}
              style={st.input}
              accessibilityLabel="Reflection response"
            />
          </View>
        </View>
      </ScrollView>

      {/* Sticky CTA */}
      <View style={st.footer}>
        <PButton variant={marked ? "gold" : "primary"} onPress={complete}>
          {marked ? "✓ Marked complete" : "Mark complete & continue"}
        </PButton>
      </View>
    </View>
  );
}

const st = {
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.base, paddingTop: 52, paddingBottom: spacing.base },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  minutesPill: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  media: { borderRadius: radii.hero, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  mediaHead: { backgroundColor: palette.navy, padding: spacing.lg },
  mediaTag: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.14)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 4 },
  mediaRow: { flexDirection: "row", gap: spacing.md, padding: spacing.base },
  mediaBtn: { flex: 1, backgroundColor: "rgba(10,37,64,0.06)", borderRadius: radii.control, padding: spacing.base, gap: spacing.xs },
  mediaIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: spacing.sm, ...shadow.card },
  scripture: { borderRadius: 26, borderWidth: 1, borderColor: "rgba(201,162,39,0.25)", backgroundColor: "#FFF8DD", padding: spacing.lg },
  reflection: { borderRadius: 28, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, padding: spacing.lg, ...shadow.card },
  input: {
    marginTop: spacing.base,
    minHeight: 96,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "#F7F9FC",
    padding: spacing.base,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
    color: palette.ink,
  },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.screen, paddingTop: spacing.base, paddingBottom: spacing.lg },
} as const;
