// Lesson reader (spec §1.7; Figma "LessonReader"). Distraction-free reader: a navy
// header, the Markdown lesson body from the database, an optional reflection block
// (for reflection-gated modules), and a sticky "Mark complete". Completion posts to
// the server (the authority for gating, §1.1) and then invalidates the pathway and
// module-list caches so the next module unlocks immediately.
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, ScrollView, TextInput, View, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { Check, ChevronLeft, ChevronRight, Headphones, Pause, PenLine, Play, Video } from "lucide-react-native";
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { Markdown } from "../components/Markdown";
import { Loading, ErrorState } from "../components/states";
import { useModule, useMyReflection, queryKeys } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries, useMutation } from "../api/query";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { REVIEW_BANNER, showReflectionComposer } from "./reflectionStates";
import { useKeyboardInset } from "../components/useKeyboardInset";

export function ModuleScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { moduleId } = useRoute<RouteProp<RootStackParamList, "Module">>().params;
  const { data: module, isLoading, error, refetch } = useModule(moduleId);
  // Live content: refetch when the screen regains focus, and poll every 20s while
  // it's open, so an admin's edit to the lesson appears almost immediately without
  // an app restart (server stays the source of truth; §1.1).
  useFocusEffect(
    useCallback(() => {
      void refetch();
      const id = setInterval(() => void refetch(), 20_000);
      return () => clearInterval(id);
    }, [refetch]),
  );
  const [reflection, setReflection] = useState("");
  // Completion is online-first; offline it queues a module_progress:complete
  // mutation that replays on reconnect (server stays authoritative for gating).
  const complete = useMutation((body?: { reflection_text?: string }) =>
    writeThrough({
      engine: getSyncEngine(),
      connectivity: getConnectivity(),
      online: () => NuruApi.completeModule(moduleId, body),
      queued: {
        domain: "module_progress",
        op: "complete",
        payload: { module_id: moduleId, ...(body?.reflection_text ? { reflection_text: body.reflection_text } : {}) },
      },
    }),
  );

  const needsReflection = module?.evaluation_kind === "reflection";
  const { data: myReflection, refetch: refetchReflection } = useMyReflection(needsReflection ? moduleId : null);
  const banner = myReflection ? REVIEW_BANNER[myReflection.state] : undefined;
  const showComposer = needsReflection && showReflectionComposer(myReflection?.state ?? null);
  const canComplete = !showComposer || reflection.trim().length > 0;

  // Read/Listen/Watch/Reflect proof (new design, spec §6). The Read step
  // completes on scroll; Listen/Watch when the member opens the media; Reflect
  // when a reflection is submitted (or the module needs none). Informational —
  // the server stays authoritative for actual gating (§1.1).
  const [proof, setProof] = useState({ read: false, listen: false, watch: false });
  const [readPct, setReadPct] = useState(0); // scroll-through progress (Figma gold bar)
  const kbInset = useKeyboardInset();
  const reflectDone = !needsReflection || (!!myReflection && !showComposer);
  const proofSteps = [
    { key: "read", label: "Read", Icon: Check, done: proof.read },
    { key: "listen", label: "Listen", Icon: Headphones, done: proof.listen },
    { key: "watch", label: "Watch", Icon: Play, done: proof.watch },
    { key: "reflect", label: "Reflect", Icon: PenLine, done: reflectDone },
  ] as const;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const max = Math.max(1, contentSize.height - layoutMeasurement.height);
    setReadPct(Math.min(1, Math.max(0, contentOffset.y / max)));
    if (contentOffset.y + layoutMeasurement.height >= contentSize.height - 80 && !proof.read) {
      setProof((p) => ({ ...p, read: true }));
    }
  }

  async function onComplete(): Promise<void> {
    if (!module) return;
    try {
      const out = await complete.mutate(showComposer ? { reflection_text: reflection.trim() } : undefined);
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
      if (out.queued) {
        nav.goBack(); // offline: completion will reconcile on reconnect
        return;
      }
      const res = out.result;
      if (module.evaluation_kind === "quiz") {
        nav.navigate("Quiz", { moduleId });
      } else if (res && (res.next_module_unlocked || res.is_completed)) {
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
            <T variant="micro" tone="gold" style={{ letterSpacing: 1.4 }}>
              {module ? `LESSON · MODULE ${module.module_sequence_number}` : "LESSON"}
            </T>
            <T serif tone="onNavy" style={{ marginTop: 2, fontSize: 20 }}>
              {module?.title ?? "Loading…"}
            </T>
          </View>
          {module?.estimated_minutes != null ? (
            <View style={st.minutesPill}>
              <T variant="caption" tone="onNavyDim">{`${module.estimated_minutes} min`}</T>
            </View>
          ) : null}
        </View>

        {/* Read · Listen · Watch · Reflect proof row (spec §6) */}
        {module ? (
          <View style={st.proofRow}>
            {proofSteps.map((s) => (
              <View key={s.key} style={[st.proofChip, s.done ? st.proofOn : st.proofOff]}>
                <s.Icon size={11} color={s.done ? palette.navy : "rgba(255,255,255,0.7)"} />
                <T variant="micro" style={{ color: s.done ? palette.navy : "rgba(255,255,255,0.7)", fontWeight: "600" }}>
                  {s.label}
                </T>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Reading-progress bar (Figma gold gradient) */}
      <View style={st.readTrack}>
        <View style={[st.readFill, { width: `${Math.round(readPct * 100)}%` }]} />
      </View>

      {isLoading ? (
        <Loading label="Loading lesson…" />
      ) : error || !module ? (
        <View style={{ padding: spacing.screen }}>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={{ padding: spacing.screen, paddingBottom: 130 + kbInset }}
            showsVerticalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Lesson media hero (Figma "Lesson media") — gradient banner + audio/video */}
            <View style={st.mediaHero}>
              <View style={st.mediaBanner}>
                <View style={st.mediaPill}>
                  <T variant="micro" tone="onNavy" style={{ letterSpacing: 1.4, fontWeight: "600" }}>LESSON MEDIA</T>
                </View>
                <View style={{ marginTop: "auto" }}>
                  <T serif tone="onNavy" style={{ fontSize: 24, lineHeight: 28, fontWeight: "600" }} numberOfLines={2}>
                    {module.title}
                  </T>
                  <T variant="caption" tone="onNavyDim" style={{ marginTop: 6 }}>
                    Read, listen, or watch — all available offline after sync.
                  </T>
                </View>
              </View>
              <View style={st.mediaBtnRow}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setProof((p) => ({ ...p, listen: true }))}
                  style={({ pressed }) => [st.mediaBtn, pressed && { opacity: 0.85 }]}
                >
                  <View style={[st.mediaTile, { backgroundColor: palette.navy }]}>
                    {proof.listen ? <Pause size={16} color={palette.gold} /> : <Play size={16} color={palette.gold} fill={palette.gold} />}
                  </View>
                  <T variant="caption" style={{ fontWeight: "600", marginTop: spacing.sm }}>Audio lesson</T>
                  <T variant="micro" tone="tertiary">{proof.listen ? "Playing" : "6:42"}</T>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setProof((p) => ({ ...p, watch: true }))}
                  style={({ pressed }) => [st.mediaBtn, pressed && { opacity: 0.85 }]}
                >
                  <View style={[st.mediaTile, { backgroundColor: palette.white, ...shadow.card }]}>
                    <Video size={16} color={palette.navy} />
                  </View>
                  <T variant="caption" style={{ fontWeight: "600", marginTop: spacing.sm }}>Video teaching</T>
                  <T variant="micro" tone="tertiary">{proof.watch ? "Watched" : "4:18"}</T>
                </Pressable>
              </View>
            </View>

            {module.summary ? (
              <View style={[st.summary, { marginTop: spacing.base }]}>
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View your reflection"
                onPress={() => nav.navigate("Reflection", { moduleId })}
                style={({ pressed }) => [st.reflection, { backgroundColor: banner.bg, borderColor: "transparent" }, pressed && { opacity: 0.9 }]}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <T variant="heading" style={{ color: banner.fg, fontSize: 15, flex: 1 }}>{banner.title}</T>
                  <ChevronRight size={16} color={banner.fg} />
                </View>
                <T variant="caption" style={{ color: banner.fg, marginTop: 4, opacity: 0.9 }}>{banner.body}</T>
                {myReflection.feedback_notes ? (
                  <T variant="body" style={{ marginTop: spacing.sm, color: palette.ink, fontStyle: "italic" }}>
                    &ldquo;{myReflection.feedback_notes}&rdquo;
                  </T>
                ) : null}
              </Pressable>
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
          <View style={[st.footer, { marginBottom: kbInset }]}>
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
  proofRow: { flexDirection: "row", gap: 6, marginTop: spacing.base },
  proofChip: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: radii.pill, paddingVertical: 7 },
  proofOn: { backgroundColor: palette.gold },
  proofOff: { backgroundColor: "rgba(255,255,255,0.08)" },
  readTrack: { height: 4, backgroundColor: "rgba(0,0,0,0.05)" },
  readFill: { height: "100%", backgroundColor: palette.gold },
  mediaHero: { overflow: "hidden", borderRadius: 28, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  mediaBanner: { height: 168, padding: spacing.lg, backgroundColor: palette.navy, overflow: "hidden", justifyContent: "flex-start" },
  mediaPill: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.16)", borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 5 },
  mediaBtnRow: { flexDirection: "row", gap: spacing.md, padding: spacing.base },
  mediaBtn: {
    flex: 1,
    backgroundColor: "rgba(10,37,64,0.06)",
    borderRadius: 18,
    padding: spacing.base,
  },
  mediaTile: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
} as const;
