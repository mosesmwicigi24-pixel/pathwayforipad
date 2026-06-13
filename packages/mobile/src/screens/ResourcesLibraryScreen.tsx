// Resources library (new design, spec §4g). Real resources from the DB
// (useResources) with a kind filter (All / Book / Audio / Video / Article).
import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, BookOpen, FileText, Headphones, Video, type LucideIcon } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useResources } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import type { ResourceRow } from "../api/types";

const KIND_META: Record<ResourceRow["kind"], { Icon: LucideIcon; tint: string; fg: string }> = {
  book: { Icon: BookOpen, tint: "#E0E7FF", fg: "#4338CA" },
  audio: { Icon: Headphones, tint: palette.goldTint, fg: palette.goldLo },
  video: { Icon: Video, tint: "#FEE2E2", fg: "#B91C1C" },
  article: { Icon: FileText, tint: palette.successBg, fg: palette.successText },
};
const FILTERS = ["all", "book", "audio", "video", "article"] as const;

export function ResourcesLibraryScreen(): ReactElement {
  const nav = useNavigation();
  const { data: resources, isLoading, error, refetch } = useResources();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");

  const shown = useMemo(
    () => (resources ?? []).filter((r) => filter === "all" || r.kind === filter),
    [resources, filter],
  );

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>LIBRARY</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>Resources</T>
      </View>

      <View style={st.filterRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.screen }}>
          {FILTERS.map((f) => {
            const on = filter === f;
            return (
              <Pressable key={f} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setFilter(f)} style={[st.chip, on && { backgroundColor: palette.navy, borderColor: palette.navy }]}>
                <T variant="caption" style={{ fontWeight: on ? "600" : "400", color: on ? palette.white : palette.ink600, textTransform: "capitalize" }}>{f}</T>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingTop: spacing.md, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
        {isLoading ? <Loading label="Loading library…" /> : null}
        {error ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}
        {shown.map((r) => {
          const meta = KIND_META[r.kind];
          return (
            <View key={r.resource_id} style={[st.card, { marginBottom: spacing.sm }]}>
              <View style={[st.tile, { backgroundColor: meta.tint }]}><meta.Icon size={18} color={meta.fg} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading" style={{ fontSize: 14 }} numberOfLines={2}>{r.title}</T>
                <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>
                  {[r.author, r.duration_label].filter(Boolean).join(" · ")}
                </T>
              </View>
            </View>
          );
        })}
        {!isLoading && shown.length === 0 ? (
          <View style={[st.card, { justifyContent: "center" }]}><T variant="caption" tone="secondary">No resources in this category yet.</T></View>
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
  filterRow: { paddingTop: spacing.md },
  chip: { borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, paddingHorizontal: 14, paddingVertical: 8 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
} as const;
