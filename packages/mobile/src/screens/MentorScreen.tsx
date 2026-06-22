// Mentor / discipler (new design, spec §4e). Real data from /growth/mentor:
// the discipler from the relationship tree, the next meeting, and the
// conversation log. When no discipler is assigned, a gentle explainer.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ArrowLeft, CalendarDays, UserRoundCheck } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";
import { useMentor } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase() || "NP";
}
function dateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function dateOnly(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MentorScreen(): ReactElement {
  const nav = useNavigation();
  const { data, isLoading, error, refetch } = useMentor();
  const mentor = data?.mentor ?? null;

  return (
    <View style={st.screen}>
      <View style={st.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.backBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
          <ArrowLeft size={20} color={palette.onNavy} />
        </Pressable>
        <T variant="micro" tone="gold" style={st.kicker}>YOUR DISCIPLER</T>
        <T serif tone="onNavy" style={{ fontSize: 24, marginTop: 4 }}>{mentor?.full_name ?? "Mentorship"}</T>
        {mentor?.cell_name ? <T variant="caption" tone="onNavyDim" style={{ marginTop: 2 }}>{`Cell · ${mentor.cell_name}`}</T> : null}
      </View>

      {isLoading ? (
        <View style={st.center}><Loading label="Loading…" /></View>
      ) : error ? (
        <View style={st.center}><ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /></View>
      ) : !mentor ? (
        <View style={{ padding: spacing.screen }}>
          <View style={st.card}>
            <View style={st.iconTile}><UserRoundCheck size={20} color={palette.goldLo} /></View>
            <T variant="heading" style={{ marginTop: spacing.md }}>No discipler yet</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
              When your leader pairs you with a discipler, you'll see your meetings and notes here.
            </T>
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>
          {/* Identity */}
          <View style={[st.card, { flexDirection: "row", alignItems: "center", gap: spacing.md }]}>
            <View style={st.avatar}><T variant="label" style={{ color: palette.gold }}>{initials(mentor.full_name)}</T></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading">{mentor.full_name}</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {`Walking with you since ${dateOnly(mentor.established_at)}`}
              </T>
            </View>
          </View>

          {/* Next meeting */}
          {data?.next_meeting_at ? (
            <View style={[st.card, { marginTop: spacing.base, flexDirection: "row", alignItems: "center", gap: spacing.md }]}>
              <View style={st.iconTile}><CalendarDays size={18} color={palette.goldLo} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" tone="secondary" style={{ letterSpacing: 1.2 }}>NEXT MEETING</T>
                <T variant="heading" style={{ fontSize: 15, marginTop: 2 }}>{dateTime(data.next_meeting_at)}</T>
              </View>
            </View>
          ) : null}

          {/* Conversation history */}
          <T variant="overline" tone="secondary" style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>CONVERSATION HISTORY</T>
          {(data?.notes ?? []).length > 0 ? (
            (data?.notes ?? []).map((n) => (
              <View key={n.note_id} style={[st.card, { marginBottom: spacing.sm }]}>
                <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                  <T variant="heading" style={{ flex: 1, fontSize: 14 }}>{n.topic}</T>
                  <T variant="micro" tone="tertiary">{dateOnly(n.met_at)}</T>
                </View>
                {n.note ? <T variant="caption" tone="secondary" style={{ marginTop: 4, fontStyle: "italic" }}>{n.note}</T> : null}
              </View>
            ))
          ) : (
            <View style={st.card}><T variant="caption" tone="secondary">Your meeting notes will appear here after your first session.</T></View>
          )}
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
  card: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  iconTile: { width: 40, height: 40, borderRadius: 12, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
} as const;
