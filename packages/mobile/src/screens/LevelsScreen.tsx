// Pathway tab root — "Today's journey" hub (new design, spec §3 PathwayHub).
// Navy header with an overall-progress ring + verse of the day; then today's
// rhythm, a Continue-learning card into the active level, the six-level pathway
// list, an action grid into the growth screens, and a listen banner. Real
// pathway + scripture + achievements data; the server stays authoritative for
// unlocking (§1.9).
import { useCallback, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import {
  BookOpen,
  Check,
  ChevronRight,
  HandHeart,
  Library,
  Lock,
  PenLine,
  PlayCircle,
  Quote,
  Sparkles,
  Sun,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useAchievements, usePathway, useScripture } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import type { PathwayLevel } from "../api/types";

const RHYTHM: Array<{ key: string; label: string; Icon: LucideIcon }> = [
  { key: "prayer", label: "Prayer", Icon: HandHeart },
  { key: "word", label: "Word", Icon: BookOpen },
  { key: "reflection", label: "Reflection", Icon: PenLine },
];

export function LevelsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: achievements, refetch: refetchAch } = useAchievements();
  const { data: verse } = useScripture("Romans 12:2");
  const [rhythm, setRhythm] = useState<Record<string, boolean>>({ prayer: false, word: false, reflection: false });
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchAch()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchAch]);

  if (isLoading) {
    return (
      <View style={[st.screen, st.center]}>
        <Loading label="Loading your pathway…" />
      </View>
    );
  }
  if (error || !pathway) {
    return (
      <View style={[st.screen, st.center]}>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </View>
    );
  }

  const levels = pathway.levels;
  const active =
    levels.find((l) => l.status === "active") ??
    levels.find((l) => l.level_number === pathway.current_level) ??
    levels[0];
  const totalModules = levels.reduce((s, l) => s + l.total_modules, 0);
  const doneModules = levels.reduce((s, l) => s + l.completed_modules, 0);
  const overallPct = totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0;
  const activePct = active && active.total_modules > 0 ? Math.round((active.completed_modules / active.total_modules) * 100) : 0;
  const streak = achievements?.streak?.current ?? 0;
  const rhythmLeft = RHYTHM.filter((r) => !rhythm[r.key]).length;

  return (
    <ScrollView
      style={st.screen}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
    >
      {/* ── Navy header with progress ring + verse ──────────────────── */}
      <View style={st.header}>
        <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -70, top: -70 }} />
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="gold" style={st.kicker}>PATHWAY</T>
            <T serif tone="onNavy" style={st.h1}>Today's journey</T>
            <T variant="body" tone="onNavyDim" style={{ marginTop: 4 }}>Grace for today's step</T>
          </View>
          <View style={st.ring}>
            <T serif tone="onNavy" style={{ fontSize: 18 }}>{`${overallPct}%`}</T>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => nav.navigate("VerseLibrary")}
          style={({ pressed }) => [st.verseGlass, pressed && { opacity: 0.9 }]}
        >
          <View style={st.verseIcon}>
            <Quote size={15} color={palette.goldGlow} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="onNavyFaint" style={{ letterSpacing: 1.2 }}>VERSE OF THE DAY</T>
            <T serif tone="onNavy" style={{ fontSize: 14, lineHeight: 20, marginTop: 2 }} numberOfLines={2}>
              {verse?.text ?? "“Do not conform to the pattern of this world, but be transformed by the renewing of your mind.”"}
            </T>
            <T variant="micro" tone="gold" style={{ marginTop: 2 }}>{verse?.reference ?? "Romans 12:2"}</T>
          </View>
        </Pressable>
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
        {/* ── Today's rhythm ─────────────────────────────────────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Sun size={14} color={palette.goldLo} />
            <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4, flex: 1 }}>
              TODAY'S RHYTHM
            </T>
            <View style={st.streakChip}>
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "600" }}>{`🔥 ${streak}d`}</T>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            {RHYTHM.map(({ key, label, Icon }) => {
              const on = rhythm[key] === true;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  onPress={() => setRhythm((p) => ({ ...p, [key]: !p[key] }))}
                  style={[st.habitTile, on ? st.habitOn : st.habitOff]}
                >
                  <View style={[st.habitDot, { backgroundColor: on ? palette.gold : palette.white }]}>
                    <Icon size={14} color={on ? palette.navy : palette.ink400} />
                  </View>
                  <T variant="caption" style={{ fontWeight: "600", color: on ? palette.navy : palette.ink600 }}>{label}</T>
                </Pressable>
              );
            })}
          </View>
          <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm }}>
            {rhythmLeft === 0 ? "Beautiful — all three today." : `${rhythmLeft} step${rhythmLeft === 1 ? "" : "s"} left today`}
          </T>
        </View>

        {/* ── Continue learning (deep navy) ──────────────────────────── */}
        {active ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Level", { levelId: active.level_number })}
            style={({ pressed }) => [st.continueCard, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <Glow size={140} color="rgba(201,162,39,0.14)" style={{ right: -30, top: -30 }} />
            <View style={st.continueTile}>
              <PlayCircle size={22} color={palette.gold} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="micro" tone="gold" style={{ letterSpacing: 1.4, fontWeight: "700" }}>
                {`CONTINUE · LEVEL ${active.level_number}`}
              </T>
              <T serif tone="onNavy" style={{ fontSize: 18, marginTop: 2 }} numberOfLines={1}>{active.title}</T>
              <View style={[st.track, { marginTop: spacing.sm, backgroundColor: "rgba(255,255,255,0.12)" }]}>
                <View style={[st.fill, { width: `${activePct}%` }]} />
              </View>
              <T variant="micro" tone="onNavyDim" style={{ marginTop: 6 }}>
                {`${active.completed_modules} of ${active.total_modules} modules · ${activePct}%`}
              </T>
            </View>
            <ChevronRight size={18} color={palette.gold} />
          </Pressable>
        ) : null}

        {/* ── Six-level pathway ──────────────────────────────────────── */}
        <View style={st.card}>
          <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4 }}>SIX-LEVEL PATHWAY</T>
          <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
            {levels.map((lvl) => (
              <LevelRow
                key={lvl.level_number}
                level={lvl}
                isActive={active?.level_number === lvl.level_number}
                onPress={() => nav.navigate("Level", { levelId: lvl.level_number })}
              />
            ))}
          </View>
        </View>

        {/* ── Action grid → growth screens ───────────────────────────── */}
        <View style={st.actionGrid}>
          <ActionTile label="Prayer journal" sub="Private to you" Icon={HandHeart} tint="#FEE2E2" fg="#B91C1C" onPress={() => nav.navigate("PrayerJournal")} />
          <ActionTile label="Your discipler" sub="Mentor & cell" Icon={UserRoundCheck} tint={palette.successBg} fg={palette.successText} onPress={() => nav.navigate("Tabs", { screen: "Community" })} />
          <ActionTile label="Spiritual gifts" sub="Take assessment" Icon={Sparkles} tint="#F3E8FF" fg="#7E22CE" onPress={() => nav.navigate("Gifts")} />
          <ActionTile label="Verse library" sub="Saved scriptures" Icon={Library} tint="#E0F2FE" fg="#0369A1" onPress={() => nav.navigate("VerseLibrary")} />
        </View>

      </View>
    </ScrollView>
  );
}

function LevelRow({ level, isActive, onPress }: { level: PathwayLevel; isActive: boolean; onPress: () => void }): ReactElement {
  const completed = level.status === "completed";
  const locked = level.status === "locked";
  const pct = level.total_modules > 0 ? Math.round((level.completed_modules / level.total_modules) * 100) : 0;
  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        st.levelRow,
        isActive && { backgroundColor: "rgba(201,162,39,0.10)", borderColor: "rgba(201,162,39,0.4)" },
        locked && { opacity: 0.55 },
        pressed && !locked && { opacity: 0.85 },
      ]}
    >
      <View style={[st.levelTile, { backgroundColor: completed ? palette.goldTint : isActive ? palette.gold : palette.mutedBg }]}>
        {locked ? (
          <Lock size={15} color={palette.ink400} />
        ) : completed ? (
          <Check size={15} color={palette.goldLo} />
        ) : (
          <T variant="caption" style={{ fontWeight: "700", color: isActive ? palette.navy : palette.ink600 }}>{`L${level.level_number}`}</T>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="heading" style={{ fontSize: 14 }} numberOfLines={1}>{level.title}</T>
        <View style={[st.miniTrack, { marginTop: 6 }]}>
          <View style={{ width: `${pct}%`, height: "100%", borderRadius: 2, backgroundColor: completed || isActive ? palette.gold : palette.lockedFill }} />
        </View>
      </View>
      <T variant="micro" tone="tertiary">{`${pct}%`}</T>
    </Pressable>
  );
}

function ActionTile({
  label,
  sub,
  Icon,
  tint,
  fg,
  onPress,
}: {
  label: string;
  sub: string;
  Icon: LucideIcon;
  tint: string;
  fg: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [st.actionTile, pressed && { opacity: 0.85 }]}>
      <View style={[st.actionIcon, { backgroundColor: tint }]}>
        <Icon size={18} color={fg} />
      </View>
      <T variant="heading" style={{ fontSize: 14, marginTop: spacing.sm }}>{label}</T>
      <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{sub}</T>
    </Pressable>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: palette.navy,
    paddingHorizontal: spacing.screen,
    paddingTop: 58,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: "hidden",
  },
  kicker: { letterSpacing: 2.4, fontWeight: "600" },
  h1: { fontSize: 26, lineHeight: 32, marginTop: spacing.sm, fontWeight: "600" },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 5, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  verseGlass: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.base,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.33)",
    backgroundColor: "rgba(255,255,255,0.06)",
    padding: spacing.md,
  },
  verseIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.15)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  streakChip: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  habitTile: { flex: 1, alignItems: "center", gap: 4, borderRadius: 14, paddingVertical: spacing.md, borderWidth: 1 },
  habitOn: { backgroundColor: "rgba(201,162,39,0.12)", borderColor: "rgba(201,162,39,0.45)" },
  habitOff: { backgroundColor: palette.surface, borderColor: "transparent" },
  habitDot: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.navyDeep,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.33)",
    padding: spacing.base,
    overflow: "hidden",
    ...shadow.card,
  },
  continueTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(201,162,39,0.15)", alignItems: "center", justifyContent: "center" },
  track: { height: 6, borderRadius: 3, backgroundColor: palette.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: palette.gold },
  levelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "transparent",
    padding: spacing.sm,
  },
  levelTile: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  miniTrack: { height: 4, borderRadius: 2, backgroundColor: palette.track, overflow: "hidden" },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionTile: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: palette.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
} as const;
