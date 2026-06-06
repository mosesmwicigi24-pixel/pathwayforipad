// Levels (Figma "LevelsOverview"). A calm map of the six-level discipleship
// pathway: a navy header with an overall progress ring + summary stats, the active
// level's Continue card, then a card per level (completed / active / locked). The
// hard-lock invariant (§1.9) is reflected visually — locked levels are dimmed and
// non-tappable; the server remains authoritative for what actually opens.
import { type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { BookOpen, Check, ChevronRight, Cross, Lock, Map } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { usePathway, useMe } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import type { LevelStatus } from "../api/types";

interface LevelView {
  id: number;
  title: string;
  subtitle: string;
  modules: number;
  completed: number;
  status: LevelStatus;
}

function firstName(full?: string | null): string {
  return (full ?? "Friend").trim().split(/\s+/)[0] ?? "Friend";
}

export function LevelsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: me } = useMe();

  const open = (id: number): void => nav.navigate("Level", { levelId: id });

  if (isLoading) {
    return (
      <View style={[st.screen, st.centerBox]}>
        <Loading label="Loading your pathway…" />
      </View>
    );
  }
  if (error || !pathway) {
    return (
      <View style={[st.screen, st.centerBox]}>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </View>
    );
  }

  const levels: LevelView[] = pathway.levels.map((l) => ({
    id: l.level_number,
    title: l.title,
    subtitle: l.theme ?? "",
    modules: l.total_modules,
    completed: l.completed_modules,
    status: l.status,
  }));
  const totalModules = levels.reduce((s, l) => s + l.modules, 0);
  const doneModules = levels.reduce((s, l) => s + l.completed, 0);
  const pct = totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0;
  const levelsDone = levels.filter((l) => l.status === "completed").length;
  const active = levels.find((l) => l.status === "active");

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
        {/* Navy header */}
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.12)" style={{ right: -60, top: -70 }} />
          <Glow size={96} color="rgba(95,143,200,0.15)" style={{ left: 24, top: 90 }} />
          <T variant="micro" tone="gold" style={st.kicker}>{`WELCOME BACK, ${firstName(me?.profile?.full_name).toUpperCase()}`}</T>
          <View style={st.headRow}>
            <View style={{ flex: 1, paddingRight: spacing.base }}>
              <T variant="display" tone="onNavy" style={{ letterSpacing: -1.2 }}>Your pathway is unfolding.</T>
              <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.md }}>
                A calm view of your discipleship journey, saved progress, and what opens next.
              </T>
            </View>
            <ProgressRing pct={pct} />
          </View>

          <View style={st.statRow}>
            <StatCard label="Levels" value={`${levelsDone}/${levels.length}`} />
            <StatCard label="Modules" value={`${doneModules}/${totalModules}`} />
            <StatCard label="Current" value={`L${pathway.current_level}`} />
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
          {active ? (
            <Pressable onPress={() => open(active.id)} style={({ pressed }) => [st.continueCard, pressed && st.press]}>
              <View style={st.continueIcon}>
                <BookOpen size={20} color={palette.navy} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" tone="gold">CONTINUE YOUR JOURNEY</T>
                <T variant="heading" style={{ marginTop: 2 }}>{`Level ${active.id}: ${active.title}`}</T>
                <View style={st.miniTrack}>
                  <View style={[st.miniFill, { width: `${active.modules > 0 ? Math.round((active.completed / active.modules) * 100) : 0}%` }]} />
                </View>
              </View>
              <ChevronRight size={20} color={palette.gold} />
            </Pressable>
          ) : null}

          <View style={st.sectionHead}>
            <View>
              <T variant="micro" tone="secondary" style={st.kicker}>{`${levels.length}-LEVEL PATHWAY`}</T>
              <T variant="title" style={{ marginTop: 2 }}>Choose your level</T>
            </View>
            <View style={st.mapChip}>
              <Map size={19} color={palette.navy} />
            </View>
          </View>

          <View style={{ gap: spacing.md }}>
            {levels.map((lvl) => (
              <LevelCard key={lvl.id} level={lvl} onTap={() => lvl.status !== "locked" && open(lvl.id)} />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <View style={st.statCard}>
      <T variant="micro" style={{ color: "rgba(255,255,255,0.38)", letterSpacing: 1.2, textTransform: "uppercase" }}>{label}</T>
      <T variant="heading" tone="onNavy" style={{ marginTop: 4, fontSize: 16 }}>{value}</T>
    </View>
  );
}

function ProgressRing({ pct }: { pct: number }): ReactElement {
  const size = 74;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={palette.gold}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </Svg>
      <View style={st.ringCenter}>
        <T variant="heading" tone="onNavy" style={{ fontSize: 18, letterSpacing: -0.8 }}>{`${pct}%`}</T>
        <T variant="micro" style={{ color: "rgba(255,255,255,0.35)", marginTop: -2, letterSpacing: 1, textTransform: "uppercase", fontSize: 9 }}>done</T>
      </View>
    </View>
  );
}

function LevelCard({ level, onTap }: { level: LevelView; onTap: () => void }): ReactElement {
  const completed = level.status === "completed";
  const active = level.status === "active";
  const locked = level.status === "locked";
  const pct = level.modules > 0 ? Math.round((level.completed / level.modules) * 100) : 0;
  const iconBg = active ? palette.navy : completed ? palette.goldTint : palette.mutedBg;
  const iconFg = active ? palette.gold : completed ? palette.goldLo : palette.ink400;

  return (
    <Pressable
      onPress={locked ? undefined : onTap}
      disabled={locked}
      style={({ pressed }) => [
        st.levelCard,
        active && { borderColor: "rgba(201,162,39,0.45)" },
        locked && { opacity: 0.6 },
        pressed && !locked && st.press,
      ]}
    >
      <View style={[st.levelIcon, { backgroundColor: iconBg }]}>
        {completed ? <Check size={19} color={iconFg} /> : locked ? <Lock size={17} color={iconFg} /> : <Cross size={18} color={iconFg} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={st.levelTopRow}>
          <T variant="micro" tone="gold" style={{ letterSpacing: 1.4, textTransform: "uppercase" }}>{`Level ${level.id}`}</T>
          <Badge status={level.status} />
        </View>
        <T variant="heading" style={{ marginTop: 4 }}>{level.title}</T>
        <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{level.subtitle}</T>

        {locked ? (
          <View style={st.lockRow}>
            <Lock size={12} color={palette.ink400} />
            <T variant="caption" tone="tertiary">{`Complete Level ${level.id - 1} to unlock`}</T>
          </View>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <View style={st.levelMeta}>
              <T variant="caption" tone="secondary">{`${level.completed}/${level.modules} modules`}</T>
              <T variant="caption" style={{ color: palette.navy, fontWeight: "500" }}>{`${pct}%`}</T>
            </View>
            <View style={st.track}>
              <View style={[st.fill, { width: `${pct}%` }]} />
            </View>
          </View>
        )}
      </View>
    </Pressable>
  );
}

function Badge({ status }: { status: LevelStatus }): ReactElement {
  const map = {
    completed: { label: "Complete", bg: palette.goldTint, fg: palette.urgentText },
    active: { label: "Active", bg: palette.activeBadgeBg, fg: palette.activeBadgeText },
    locked: { label: "Locked", bg: palette.mutedBg, fg: palette.ink400 },
  } as const;
  const m = map[status];
  return (
    <View style={[st.badge, { backgroundColor: m.bg }]}>
      <T variant="micro" style={{ color: m.fg }}>{m.label}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  centerBox: { alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: palette.navy,
    paddingHorizontal: spacing.screen,
    paddingTop: 54,
    paddingBottom: spacing.lg,
    overflow: "hidden",
  },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  headRow: { flexDirection: "row", alignItems: "flex-end", marginTop: spacing.md },
  statRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    backgroundColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  ringCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  continueCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.base,
    backgroundColor: palette.white,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.35)",
    padding: spacing.base,
    marginBottom: spacing.lg,
    ...shadow.card,
  },
  continueIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(10,37,64,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  miniTrack: { marginTop: spacing.md, height: 8, borderRadius: 8, backgroundColor: palette.track, overflow: "hidden" },
  miniFill: { height: "100%", borderRadius: 8, backgroundColor: palette.gold },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: spacing.md },
  mapChip: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: palette.white,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  levelCard: {
    flexDirection: "row",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  levelIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  levelTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  badge: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 4 },
  lockRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  levelMeta: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  track: { height: 6, borderRadius: 6, backgroundColor: palette.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 6, backgroundColor: palette.gold },
  press: { transform: [{ scale: 0.99 }] },
} as const;
