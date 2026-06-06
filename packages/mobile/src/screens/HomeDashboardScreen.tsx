// Home (Figma "HomeTab"). The warm daily anchor: greeting, quick stats, a welcome
// video hero, quick-start shortcuts, the scripture of the day, and a Continue card
// that jumps back into the active level. Offline-first: everything renders instantly
// from local content; nothing here blocks on the network.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { BookOpen, CalendarDays, ChevronRight, Headphones, MessageCircle, Play } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, type as typ } from "../theme/tokens";
import { Card, GradientBg, T } from "../theme/components";
import { useAchievements, useMe, usePathway } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

function firstName(full?: string | null): string {
  return (full ?? "Friend").trim().split(/\s+/)[0] ?? "Friend";
}

function initials(full?: string | null): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NP";
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "NP";
}

export function HomeDashboardScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: me } = useMe();
  const { data: achievements } = useAchievements();

  if (isLoading) {
    return (
      <View style={[st.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Loading label="Loading your dashboard…" />
      </View>
    );
  }
  if (error || !pathway) {
    return (
      <View style={[st.screen, { alignItems: "center", justifyContent: "center" }]}>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </View>
    );
  }

  const active =
    pathway.levels.find((l) => l.status === "active") ??
    pathway.levels.find((l) => l.level_number === pathway.current_level) ??
    pathway.levels[0];
  const activePct = active && active.total_modules > 0 ? Math.round((active.completed_modules / active.total_modules) * 100) : 0;
  const totalModules = pathway.levels.reduce((s, l) => s + l.total_modules, 0);
  const doneModules = pathway.levels.reduce((s, l) => s + l.completed_modules, 0);
  const overallPct = totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0;
  const streak = achievements?.streak?.current ?? 0;

  const quickStats = [
    { label: "Current", value: `L${pathway.current_level}` },
    { label: "Streak", value: `${streak}d` },
    { label: "Progress", value: `${overallPct}%` },
  ] as const;

  const quickStarts = [
    { label: "Lesson", Icon: BookOpen, onPress: () => nav.navigate("Tabs", { screen: "Levels" }) },
    { label: "Audio", Icon: Headphones, onPress: () => nav.navigate("Tabs", { screen: "Levels" }) },
    { label: "Calendar", Icon: CalendarDays, onPress: () => nav.navigate("Tabs", { screen: "Calendar" }) },
    { label: "Chat", Icon: MessageCircle, onPress: () => nav.navigate("Tabs", { screen: "Chat" }) },
  ] as const;

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} showsVerticalScrollIndicator={false}>
      {/* Greeting */}
      <View style={st.headRow}>
        <View style={{ flex: 1 }}>
          <T variant="micro" tone="gold" style={st.kicker}>{todayLabel().toUpperCase()}</T>
          <T variant="title" style={{ marginTop: spacing.sm }}>{`${greeting()}, ${firstName(me?.profile?.full_name)}.`}</T>
          <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>Grace for today&apos;s step.</T>
        </View>
        <View style={st.avatar}>
          <T variant="label" style={{ color: palette.gold }}>{initials(me?.profile?.full_name)}</T>
        </View>
      </View>

      {/* Quick stats */}
      <View style={st.statRow}>
        {quickStats.map((s) => (
          <View key={s.label} style={st.statCard}>
            <T variant="heading" style={{ fontSize: 17 }}>{s.value}</T>
            <T variant="micro" tone="tertiary" style={{ marginTop: 4 }}>{s.label}</T>
          </View>
        ))}
      </View>

      {/* Welcome video */}
      <Pressable style={({ pressed }) => [st.videoCard, pressed && st.press]}>
        <View style={st.videoHero}>
          <GradientBg colors={[palette.navy, palette.navyMid, palette.gold]} />
          <View style={st.playBtn}>
            <Play size={22} color={palette.navy} fill={palette.navy} />
          </View>
          <View style={st.durBadge}>
            <T variant="micro" style={{ color: "rgba(255,255,255,0.85)" }}>2:05</T>
          </View>
        </View>
        <View style={{ padding: spacing.base }}>
          <T variant="overline" tone="gold">WELCOME VIDEO</T>
          <T variant="heading" style={{ marginTop: 4 }}>Welcome to Pathway Discipleship</T>
          <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>
            A short introduction to your journey, lessons, mentors, and next steps.
          </T>
        </View>
      </Pressable>

      {/* Quick starts */}
      <View style={st.quickRow}>
        {quickStarts.map(({ label, Icon, onPress }) => (
          <Pressable key={label} onPress={onPress} style={({ pressed }) => [st.quickCard, pressed && st.press]}>
            <Icon size={17} color={palette.navy} strokeWidth={1.9} />
            <T variant="micro" tone="secondary" style={{ marginTop: spacing.sm }}>{label}</T>
          </Pressable>
        ))}
      </View>

      {/* Scripture */}
      <Card accent style={{ marginTop: spacing.base, padding: spacing.lg }}>
        <T variant="overline" tone="gold">SCRIPTURE FOR TODAY</T>
        <T style={[typ.bodyLg, { marginTop: spacing.md, color: palette.ink }]}>
          &ldquo;Your word is a lamp for my feet, a light on my path.&rdquo;
        </T>
        <T variant="caption" tone="secondary" style={{ marginTop: spacing.md, fontWeight: "500" }}>Psalm 119:105</T>
      </Card>

      {/* Continue */}
      {active ? (
        <Pressable onPress={() => nav.navigate("Level", { levelId: active.level_number })} style={({ pressed }) => [st.continueCard, pressed && st.press]}>
          <View style={st.continueIcon}>
            <BookOpen size={19} color={palette.gold} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="gold">CONTINUE</T>
            <T variant="heading" tone="onNavy" style={{ marginTop: 2 }}>{`Level ${active.level_number}: ${active.title}`}</T>
            <View style={st.continueTrack}>
              <View style={[st.continueFill, { width: `${activePct}%` }]} />
            </View>
          </View>
          <ChevronRight size={18} color={palette.gold} />
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  body: { paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.xl },
  headRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.base },
  kicker: { letterSpacing: 1.6, textTransform: "uppercase" },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: palette.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  videoCard: {
    marginTop: spacing.base,
    backgroundColor: palette.white,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden",
    ...shadow.card,
  },
  videoHero: { height: 144, alignItems: "center", justifyContent: "center" },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.white,
    alignItems: "center",
    justifyContent: "center",
  },
  durBadge: {
    position: "absolute",
    right: 12,
    bottom: 12,
    backgroundColor: "rgba(0,0,0,0.25)",
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  quickRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.base },
  quickCard: {
    flex: 1,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.md,
  },
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.base,
    backgroundColor: palette.navy,
    borderRadius: 24,
    padding: spacing.base,
    ...shadow.card,
  },
  continueIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  continueTrack: { marginTop: spacing.sm, height: 4, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.10)", overflow: "hidden" },
  continueFill: { height: "100%", borderRadius: 4, backgroundColor: palette.gold },
  press: { transform: [{ scale: 0.99 }] },
} as const;
