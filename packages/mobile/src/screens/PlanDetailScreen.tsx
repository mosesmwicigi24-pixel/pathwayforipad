// Reading-plan detail — YouVersion-style. Cover art, a horizontal day strip,
// "Day X of N", and the day's SEGMENT checklist (Devotional, scripture readings,
// Talk it Over). Each segment opens the day reader (PlanDayScreen); completion is
// server-backed (per-segment → rolls up to the day). Church-paced (no calendar).
import { useEffect, useState, type ReactElement } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, Check, ChevronRight, BookOpen, Quote, Video as VideoIcon, MessagesSquare } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { PlanSegmentKind } from "../api/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, PButton, T } from "../theme/components";
import { usePlan } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

const kindIcon = (kind: PlanSegmentKind, color: string): ReactElement => {
  if (kind === "devotional") return <BookOpen size={15} color={color} />;
  if (kind === "scripture" || kind === "reading") return <Quote size={15} color={color} />;
  if (kind === "video") return <VideoIcon size={15} color={color} />;
  return <MessagesSquare size={15} color={color} />; // talk
};

export function PlanDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { planId, title } = useRoute<RouteProp<RootStackParamList, "PlanDetail">>().params;
  const { data: plan, isLoading, error, refetch } = usePlan(planId);
  const [selectedDay, setSelectedDay] = useState(1);

  // Default the day strip to where the member is in the plan.
  useEffect(() => {
    if (plan) setSelectedDay(Math.min(Math.max(plan.current_day ?? 1, 1), plan.day_count));
  }, [plan?.current_day, plan?.day_count]);

  const completed = new Set(plan?.completed_days ?? []);
  const day = plan?.days.find((d) => d.day_number === selectedDay) ?? plan?.days[0];
  const segments = day?.segments ?? [];
  const openReader = (): void => nav.navigate("PlanDay", { planId, dayNumber: selectedDay, ...(plan?.title ? { title: plan.title } : {}) });

  return (
    <View style={st.screen}>
      {isLoading ? (
        <View style={st.center}><Loading label="Loading plan…" /></View>
      ) : error || !plan ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          {/* Cover */}
          <View style={{ height: 200 }}>
            {plan.image_url ? (
              <Image source={{ uri: plan.image_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
            ) : (
              <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} />
            )}
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.backBtn}>
              <ArrowLeft size={20} color={palette.onNavy} />
            </Pressable>
          </View>

          <View style={{ padding: spacing.screen }}>
            <T serif style={{ fontSize: 24, color: palette.ink }}>{plan.title ?? title}</T>
            {plan.subtitle ? <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{plan.subtitle}</T> : null}
            {plan.description ? <T variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>{plan.description}</T> : null}

            {/* Day strip */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.lg }} contentContainerStyle={{ gap: spacing.sm, paddingRight: spacing.screen }}>
              {plan.days.map((d) => {
                const sel = d.day_number === selectedDay;
                const done = completed.has(d.day_number) || d.completed === true;
                return (
                  <Pressable
                    key={d.day_number}
                    accessibilityRole="button"
                    onPress={() => setSelectedDay(d.day_number)}
                    style={[st.dayChip, sel && { borderColor: palette.ink, borderWidth: 2 }, done && !sel && { backgroundColor: palette.successBg }]}
                  >
                    <T variant="caption" style={{ fontWeight: "800", color: done ? palette.successText : palette.ink }}>{d.day_number}</T>
                    {done ? <Check size={11} color={palette.successText} /> : <T variant="micro" tone="tertiary">Day</T>}
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Day header */}
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.lg }}>
              <T variant="heading" style={{ flex: 1, fontSize: 18 }}>{`Day ${selectedDay} of ${plan.day_count}`}</T>
              <View style={st.countPill}>
                <T variant="micro" style={{ fontWeight: "700", color: palette.ink600 }}>{`${completed.size} done`}</T>
              </View>
            </View>
            {day?.title ? <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{day.title}</T> : null}

            {/* Segment checklist */}
            <View style={{ marginTop: spacing.base }}>
              {segments.length === 0 ? (
                <T variant="caption" tone="tertiary">{day?.reference ?? "No readings for this day yet."}</T>
              ) : (
                segments.map((s) => (
                  <Pressable key={s.segment_id} accessibilityRole="button" onPress={openReader} style={st.segRow}>
                    <View style={[st.segCircle, s.completed && { backgroundColor: palette.successText, borderColor: palette.successText }]}>
                      {s.completed ? <Check size={13} color="#fff" /> : kindIcon(s.kind, palette.ink400)}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="body" numberOfLines={1} style={{ color: palette.ink }}>{s.title}</T>
                      {s.reference ? <T variant="micro" tone="tertiary">{s.reference}</T> : null}
                    </View>
                    <ChevronRight size={18} color={palette.ink400} />
                  </Pressable>
                ))
              )}
            </View>

            {segments.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <PButton variant="primary" onPress={openReader}>Start Reading</PButton>
              </View>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  backBtn: { position: "absolute", top: 50, left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  dayChip: { width: 60, height: 64, borderRadius: radii.control, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center", gap: 2, ...shadow.card },
  countPill: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: palette.white },
  segRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
  segCircle: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: palette.border, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface },
} as const;
