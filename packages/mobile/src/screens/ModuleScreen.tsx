// Lesson reader (spec §1.7; Figma "LessonReader"). Distraction-free reader: a navy
// header, the Markdown lesson body from the database, an optional reflection block
// (for reflection-gated modules), and a sticky "Mark complete". Completion posts to
// the server (the authority for gating, §1.1) and then invalidates the pathway and
// module-list caches so the next module unlocks immediately.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { Markdown } from "../components/Markdown";
import { Loading, ErrorState } from "../components/states";
import { useModule, useMyReflection, queryKeys } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries, useMutation } from "../api/query";
import { REVIEW_BANNER, showReflectionComposer } from "./reflectionStates";

export function ModuleScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { moduleId } = useRoute<RouteProp<RootStackParamList, "Module">>().params;
  const { data: module, isLoading, error, refetch } = useModule(moduleId);
  const [reflection, setReflection] = useState("");
  const complete = useMutation((body?: { reflection_text?: string }) => NuruApi.completeModule(moduleId, body));

  const needsReflection = module?.evaluation_kind === "reflection";
  const { data: myReflection, refetch: refetchReflection } = useMyReflection(needsReflection ? moduleId : null);
  const banner = myReflection ? REVIEW_BANNER[myReflection.state] : undefined;
  const showComposer = needsReflection && showReflectionComposer(myReflection?.state ?? null);
  const canComplete = !showComposer || reflection.trim().length > 0;

  async function onComplete(): Promise<void> {
    if (!module) return;
    try {
      const res = await complete.mutate(showComposer ? { reflection_text: reflection.trim() } : undefined);
      // Refresh everything completion affects so the next module unlocks instantly.
      invalidateQueries("pathway");
      invalidateQueries(`levelModules:${module.level_number}`);
      invalidateQueries("achievements");
      invalidateQueries(`module:${moduleId}`);
      if (needsReflection) {
        invalidateQueries(queryKeys.myReflection(moduleId));
        void refetchReflection(); // a resubmission resets the state to pending
        setReflection("");
      }
      if (module.evaluation_kind === "quiz") {
        nav.navigate("Quiz", { moduleId });
      } else if (res.next_module_unlocked || res.is_completed) {
        nav.goBack();
      }
    } catch {
      // error surfaced via complete.error below
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      {/* Navy header */}
      <View style={st.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.iconBtn}>
            <ChevronLeft size={20} color={palette.onNavy} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="onNavyDim" style={{ letterSpacing: 1.4 }}>
              {module ? `LESSON · MODULE ${module.module_sequence_number}` : "LESSON"}
            </T>
            <T variant="heading" tone="onNavy" style={{ marginTop: 2 }}>
              {module?.title ?? "Loading…"}
            </T>
          </View>
          {module?.estimated_minutes != null ? (
            <View style={st.minutesPill}>
              <T variant="caption" tone="onNavyDim">{`${module.estimated_minutes} min`}</T>
            </View>
          ) : null}
        </View>
      </View>

      {isLoading ? (
        <Loading label="Loading lesson…" />
      ) : error || !module ? (
        <View style={{ padding: spacing.screen }}>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
            {module.summary ? (
              <View style={st.summary}>
                <T variant="overline" tone="gold">IN THIS LESSON</T>
                <T variant="bodyLg" style={{ marginTop: spacing.sm, color: palette.ink }}>{module.summary}</T>
              </View>
            ) : null}

            {/* Lesson body (Markdown from the database) */}
            <View style={{ marginTop: spacing.base }}>
              <Markdown content={module.lesson_content} />
            </View>

            {/* Key verses */}
            {module.key_verses && module.key_verses.length > 0 ? (
              <View style={st.verses}>
                <T variant="overline" tone="secondary">KEY VERSES</T>
                <View style={st.verseChips}>
                  {module.key_verses.map((v) => (
                    <View key={v} style={st.verseChip}>
                      <T variant="caption" style={{ color: palette.goldLo, fontWeight: "600" }}>{v}</T>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Reflection review state (M3 over B3): the leader's decision */}
            {needsReflection && myReflection && banner ? (
              <View style={[st.reflection, { backgroundColor: banner.bg, borderColor: "transparent" }]}>
                <T variant="heading" style={{ color: banner.fg, fontSize: 15 }}>{banner.title}</T>
                <T variant="caption" style={{ color: banner.fg, marginTop: 4, opacity: 0.9 }}>{banner.body}</T>
                {myReflection.feedback_notes ? (
                  <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, fontStyle: "italic" }}>
                    &ldquo;{myReflection.feedback_notes}&rdquo;
                  </T>
                ) : null}
              </View>
            ) : null}

            {/* Reflection composer: first submission, or a returned resubmit */}
            {showComposer ? (
              <View style={st.reflection}>
                <T variant="overline" tone="secondary">
                  {banner?.resubmit ? "REVISE YOUR REFLECTION" : "REFLECTION (REQUIRED)"}
                </T>
                <T variant="bodyLg" style={{ marginTop: spacing.sm, color: palette.ink }}>
                  {banner?.resubmit
                    ? "Take your leader's feedback in, then resubmit."
                    : "Write what God is showing you before you continue."}
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
            ) : null}

            {complete.error ? (
              <T variant="caption" style={{ color: palette.error, marginTop: spacing.base }}>
                {errorMessage(complete.error)}
              </T>
            ) : null}
          </ScrollView>

          {/* Sticky CTA */}
          <View style={st.footer}>
            <PButton
              variant="primary"
              disabled={!canComplete || complete.isLoading}
              onPress={() => void onComplete()}
            >
              {complete.isLoading ? "Saving…" : "Mark complete & continue"}
            </PButton>
          </View>
        </>
      )}
    </View>
  );
}

const st = {
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.base, paddingTop: 52, paddingBottom: spacing.base },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  minutesPill: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 6 },
  summary: {
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.30)",
    backgroundColor: palette.urgentBg,
    padding: spacing.lg,
  },
  verses: { marginTop: spacing.lg },
  verseChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  verseChip: {
    backgroundColor: palette.goldTint,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  reflection: { marginTop: spacing.lg, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, padding: spacing.lg, ...shadow.card },
  input: {
    marginTop: spacing.base,
    minHeight: 96,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.coolPaper,
    padding: spacing.base,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: "top",
    color: palette.ink,
  },
  footer: { borderTopWidth: 1, borderTopColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.screen, paddingTop: spacing.base, paddingBottom: spacing.lg },
} as const;
