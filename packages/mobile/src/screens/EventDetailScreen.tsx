// Event detail (Figma "EventDetail"). The full view for a calendar occurrence —
// navy header with date/time chips and a details card. The data comes from the
// real calendar projection (passed in from the Calendar screen); projected
// occurrences are virtual (no materialized event row), so this is a read view.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Clock, MapPin, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function EventDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { title, startAt, endAt, location } = useRoute<RouteProp<RootStackParamList, "EventDetail">>().params;

  const timeRange = endAt ? `${timeLabel(startAt)} – ${timeLabel(endAt)}` : timeLabel(startAt);

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -48, top: -48 }} />
          <Pressable onPress={() => nav.goBack()} style={({ pressed }) => [st.closeBtn, pressed && { transform: [{ scale: 0.95 }] }]} accessibilityRole="button" accessibilityLabel="Close">
            <X size={19} color="rgba(255,255,255,0.75)" />
          </Pressable>
          <T variant="micro" tone="gold" style={st.kicker}>EVENT DETAILS</T>
          <T tone="onNavy" style={st.title}>{title}</T>
          <View style={st.chips}>
            <Chip>{dateLabel(startAt)}</Chip>
            <Chip>{timeRange}</Chip>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
          <View style={st.card}>
            <T variant="overline" tone="secondary">WHEN & WHERE</T>
            <View style={{ marginTop: spacing.base, gap: spacing.sm }}>
              <View style={st.metaRow}><Clock size={15} color={palette.ink600} /><T variant="caption" tone="secondary">{`${dateLabel(startAt)} · ${timeRange}`}</T></View>
              <View style={st.metaRow}><MapPin size={15} color={palette.ink600} /><T variant="caption" tone="secondary">{location || "Location to be announced"}</T></View>
            </View>
          </View>

          <View style={[st.card, { marginTop: spacing.base }]}>
            <T variant="overline" tone="secondary">DETAILS</T>
            <T variant="body" tone="secondary" style={{ marginTop: spacing.sm }}>
              This event is part of your church and pathway schedule. Add it to your plans and arrive a few minutes early.
            </T>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function Chip({ children }: { children: string }): ReactElement {
  return (
    <View style={st.chip}>
      <T variant="caption" style={{ color: "rgba(255,255,255,0.70)" }}>{children}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 52, paddingBottom: spacing.lg, overflow: "hidden" },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center", marginBottom: spacing.base },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -1.2, lineHeight: 34, color: palette.onNavy, marginTop: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.base },
  chip: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
  card: { backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
} as const;
