// Plan day reader (YouVersion-style). Pages through a day's segments one at a
// time — a devotional, scripture readings, "Talk it Over" — with the video/body,
// and a footer "Day X • i of n" + next. Advancing marks the segment complete
// (server); finishing the last one rolls the day up and returns to the plan.
import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, ChevronRight, Check } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing } from "../theme/tokens";
import { T } from "../theme/components";
import { Markdown } from "../components/Markdown";
import { VideoPlayer } from "../components/VideoPlayer";
import { NuruApi } from "../api/client";
import { usePlan, queryKeys } from "../api/hooks";
import { errorMessage, refreshQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";

const KIND_LABEL: Record<string, string> = {
  devotional: "DEVOTIONAL", scripture: "SCRIPTURE", reading: "READING", video: "WATCH", talk: "TALK IT OVER",
};

export function PlanDayScreen(): ReactElement {
  const nav = useNavigation();
  const { planId, dayNumber, title } = useRoute<RouteProp<RootStackParamList, "PlanDay">>().params;
  const { data: plan, isLoading, error, refetch } = usePlan(planId);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);

  const day = useMemo(() => plan?.days.find((d) => d.day_number === dayNumber), [plan, dayNumber]);
  const segments = day?.segments ?? [];
  const seg = segments[index];
  const total = segments.length;
  const isLast = index >= total - 1;

  async function advance(): Promise<void> {
    if (!seg) return;
    setBusy(true);
    try { await NuruApi.completePlanSegment(seg.segment_id); }
    catch { /* best-effort; reader still advances */ }
    finally { setBusy(false); }
    refreshQueries(queryKeys.plan(planId));
    if (isLast) nav.goBack();
    else setIndex((i) => i + 1);
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
          <ArrowLeft size={20} color={palette.ink} />
        </Pressable>
        <T variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1, fontWeight: "600" }}>{title ?? plan?.title ?? "Plan"}</T>
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Opening today's reading…" /></View>
      ) : error || !plan ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : !seg ? (
        <View style={st.center}><T variant="caption" tone="tertiary">No readings for this day yet.</T></View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
            {seg.video_url ? (
              <View style={{ marginBottom: spacing.base }}>
                <VideoPlayer uri={seg.video_url} poster={seg.image_url} height={210} radius={14} />
              </View>
            ) : null}
            <T variant="micro" tone="gold" style={{ letterSpacing: 1.6 }}>{KIND_LABEL[seg.kind] ?? "READING"}</T>
            <T serif style={{ fontSize: 24, color: palette.ink, marginTop: 4 }}>{seg.title}</T>
            {seg.reference ? (
              <T variant="caption" style={{ marginTop: 6, fontWeight: "700", color: palette.goldLo }}>{seg.reference}</T>
            ) : null}
            {seg.content ? (
              <View style={{ marginTop: spacing.base }}><Markdown content={seg.content} /></View>
            ) : null}
            {seg.completed ? (
              <View style={st.doneTag}><Check size={13} color={palette.successText} /><T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Completed</T></View>
            ) : null}
          </ScrollView>

          {/* Footer: Day X • i of n + next */}
          <View style={st.footer}>
            <View style={{ flex: 1 }}>
              <T variant="caption" style={{ fontWeight: "700", color: palette.ink }}>{`Day ${dayNumber}`}</T>
              <T variant="micro" tone="tertiary">{`${index + 1} of ${total}`}</T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={isLast ? "Finish day" : "Next"} disabled={busy} onPress={() => void advance()} style={[st.nextBtn, busy && { opacity: 0.6 }]}>
              {isLast ? <Check size={22} color={palette.onNavy} /> : <ChevronRight size={24} color={palette.onNavy} />}
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.md, backgroundColor: palette.coolPaper },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: palette.border },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  doneTag: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.lg, alignSelf: "flex-start", backgroundColor: palette.successBg, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xl, backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.border },
  nextBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
} as const;
