// Reading-plan detail (new design, spec §4d). Real plan + days + my progress
// (usePlan); start to enroll, mark a day complete to advance — both hit the
// server (idempotent). The day grid reflects completed_days from the DB.
import { useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, Check } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { palette, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { usePlan, queryKeys } from "../api/hooks";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";

export function PlanDetailScreen(): ReactElement {
  const nav = useNavigation();
  const { planId, title } = useRoute<RouteProp<RootStackParamList, "PlanDetail">>().params;
  const { data: plan, isLoading, error, refetch } = usePlan(planId);
  const [busy, setBusy] = useState(false);

  const completed = new Set(plan?.completed_days ?? []);

  function refresh(): void {
    invalidateQueries(queryKeys.plan(planId));
    invalidateQueries("plans");
    void refetch();
  }
  async function start(): Promise<void> {
    setBusy(true);
    try {
      await NuruApi.startPlan(planId);
      refresh();
    } finally {
      setBusy(false);
    }
  }
  async function completeDay(day: number): Promise<void> {
    try {
      await NuruApi.completePlanDay(planId, day);
      refresh();
    } catch {
      /* surfaced on next load */
    }
  }

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>READING PLAN</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>{plan?.title ?? title ?? "Plan"}</T>
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Loading plan…" /></View>
      ) : error || !plan ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          {plan.description ? <T variant="body" tone="secondary" style={{ marginBottom: spacing.base }}>{plan.description}</T> : null}

          {!plan.enrolled ? (
            <PButton variant="gold" onPress={() => void start()} disabled={busy}>{busy ? "Starting…" : "Start this plan"}</PButton>
          ) : (
            <View style={st.card}>
              <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>{`DAY ${Math.min(plan.current_day ?? 1, plan.day_count)} OF ${plan.day_count}`}</T>
              <T variant="caption" tone="tertiary" style={{ marginTop: 2 }}>{`${completed.size} ${completed.size === 1 ? "day" : "days"} complete`}</T>
            </View>
          )}

          <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>DAYS</T>
          {plan.days.map((d) => {
            const done = completed.has(d.day_number);
            return (
              <View key={d.day_number} style={[st.dayCard, done && { borderColor: "rgba(21,128,61,0.3)" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                  <View style={[st.dayNum, { backgroundColor: done ? palette.successBg : palette.surface }]}>
                    {done ? <Check size={14} color={palette.successText} /> : <T variant="caption" style={{ fontWeight: "700", color: palette.ink600 }}>{d.day_number}</T>}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <T variant="heading" style={{ fontSize: 14 }}>{d.reference}</T>
                    {d.title ? <T variant="micro" tone="tertiary">{d.title}</T> : null}
                  </View>
                </View>
                {d.content ? <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm }}>{d.content}</T> : null}
                {plan.enrolled && !done ? (
                  <View style={{ marginTop: spacing.md }}>
                    <PButton variant="ghost" onPress={() => void completeDay(d.day_number)}>Mark day complete</PButton>
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  dayCard: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card },
  dayNum: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
} as const;
