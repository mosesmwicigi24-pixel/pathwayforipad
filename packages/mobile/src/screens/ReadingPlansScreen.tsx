// Reading plans (new design, spec §4d). Plans from the DB (usePlans) with my
// enrollment + progress; tap a plan → PlanDetailScreen. Active plans show a
// progress bar; all data real.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, BookMarked } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { usePlans } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

export function ReadingPlansScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: plans, isLoading, error, refetch } = usePlans();

  const active = (plans ?? []).filter((p) => p.enrolled);
  const browse = (plans ?? []).filter((p) => !p.enrolled);

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>READ · REFLECT · APPLY</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>Reading plans</T>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {isLoading ? <Loading label="Loading plans…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

        {active.length > 0 ? (
          <>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>ACTIVE PLANS</T>
            {active.map((p) => {
              const done = p.completed_days?.length ?? 0;
              const pct = p.day_count > 0 ? Math.round((done / p.day_count) * 100) : 0;
              return (
                <Pressable key={p.plan_id} onPress={() => nav.navigate("PlanDetail", { planId: p.plan_id, title: p.title })} style={({ pressed }) => [st.card, { marginBottom: spacing.sm }, pressed && { opacity: 0.9 }]}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <View style={st.tile}><BookMarked size={18} color={palette.goldLo} /></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{p.title}</T>
                      <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{`Day ${Math.min(p.current_day ?? 1, p.day_count)} of ${p.day_count}`}</T>
                      <View style={[st.track, { marginTop: 6 }]}>
                        <View style={{ width: `${pct}%`, height: "100%", borderRadius: 2, backgroundColor: palette.gold }} />
                      </View>
                    </View>
                  </View>
                </Pressable>
              );
            })}
          </>
        ) : null}

        {browse.length > 0 ? (
          <>
            <T variant="overline" tone="secondary" style={{ marginTop: active.length ? spacing.lg : 0, marginBottom: spacing.sm }}>BROWSE PLANS</T>
            {browse.map((p) => (
              <Pressable key={p.plan_id} onPress={() => nav.navigate("PlanDetail", { planId: p.plan_id, title: p.title })} style={({ pressed }) => [st.card, { marginBottom: spacing.sm }, pressed && { opacity: 0.9 }]}>
                <T variant="heading" style={{ fontSize: 15 }}>{p.title}</T>
                {p.description ? <T variant="caption" tone="secondary" style={{ marginTop: 2 }} numberOfLines={2}>{p.description}</T> : null}
                <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm }}>{`${p.category ?? "Plan"} · ${p.day_count} days`}</T>
              </Pressable>
            ))}
          </>
        ) : null}

        {!isLoading && (plans ?? []).length === 0 ? (
          <View style={st.card}><T variant="heading">No plans yet</T><T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Reading plans will appear here soon.</T></View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.lg },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  tile: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  track: { height: 4, borderRadius: 2, backgroundColor: palette.track, overflow: "hidden" },
} as const;
