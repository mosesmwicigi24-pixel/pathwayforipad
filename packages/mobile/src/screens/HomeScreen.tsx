// Pathway home (spec §1.3; Figma "PathwayTab"). Renders the cached module list
// from the local store on launch, then a background sync reconciles — no spinner
// on a dropped tower. Navy hero with a gold progress bar, then module cards
// (completed / next / locked) on the design system.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { getLocalStore } from "../db/localStoreProvider";
import type { SyncRow } from "../db/localStore";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Pill, ProgressBar, Screen, T } from "../theme/components";
import { BottomTabBar } from "../navigation/BottomTabBar";

type Status = "completed" | "next" | "locked";

interface ModuleVM {
  id: string;
  seq: number;
  title: string;
  summary: string;
  minutes: number | null;
  status: Status;
  progress: number;
}

function toVM(rows: SyncRow[]): ModuleVM[] {
  return rows.map((r, i) => {
    const completed = Boolean(r.is_completed);
    const locked = Boolean(r.locked);
    const status: Status = completed ? "completed" : locked ? "locked" : "next";
    return {
      id: String(r.module_id),
      seq: Number(r.module_sequence_number ?? i + 1),
      title: String(r.title ?? "Module"),
      summary: String(r.summary ?? ""),
      minutes: r.estimated_minutes == null ? null : Number(r.estimated_minutes),
      status,
      progress: completed ? 100 : typeof r.progress === "number" ? r.progress : 0,
    };
  });
}

export function HomeScreen(): ReactElement {
  const nav = useNavigation();
  const [modules, setModules] = useState<ModuleVM[]>([]);
  const [syncing, setSyncing] = useState(true);

  useEffect(() => {
    void getLocalStore()
      .cacheList("modules")
      .then((rows) => {
        setModules(toVM(rows));
        setSyncing(false);
      });
  }, []);

  const done = modules.filter((m) => m.status === "completed").length;
  const pct = modules.length ? Math.round((done / modules.length) * 100) : 0;
  const minutesLeft = useMemo(
    () => modules.filter((m) => m.status !== "completed").reduce((acc, m) => acc + (m.minutes ?? 0), 0),
    [modules],
  );

  return (
    <View style={{ flex: 1 }}>
      <Screen padded={false}>
      {/* Navy hero */}
      <View style={hero.wrap}>
        <View style={hero.row}>
          <View />
          {syncing ? (
            <Pill bg="rgba(255,255,255,0.08)" color={palette.onNavyFaint}>
              Syncing offline
            </Pill>
          ) : (
            <View />
          )}
        </View>
        <View style={hero.card}>
          <T variant="overline" tone="gold">CURRENT LEVEL</T>
          <T variant="display" tone="onNavy" style={{ marginTop: spacing.sm }}>Your Pathway</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm }}>
            Keep going — one module at a time.
          </T>
          <View style={hero.progressRow}>
            <View style={{ flex: 1 }}>
              <View style={hero.progressLabels}>
                <T variant="caption" tone="onNavyDim">{done} of {modules.length} modules</T>
                <T variant="caption" tone="onNavyDim">{pct}%</T>
              </View>
              <ProgressBar pct={pct} fill={palette.gold} track={palette.trackDark} />
            </View>
            <View style={hero.minutes}>
              <T variant="caption" tone="gold">≈ {minutesLeft} min</T>
            </View>
          </View>
        </View>
      </View>

      {/* Module list */}
      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
        <View style={listHead}>
          <View>
            <T variant="overline" tone="secondary">COURSE MODULES</T>
            <T variant="title" style={{ marginTop: spacing.xs }}>Learn step by step</T>
          </View>
          <Pill>{`${modules.length} lessons`}</Pill>
        </View>

        {modules.length === 0 && !syncing ? (
          <View style={[card.wrap, { justifyContent: "center", paddingVertical: spacing.xl }]}>
            <T tone="secondary">No modules cached yet — pull to sync.</T>
          </View>
        ) : null}

        <View style={{ gap: spacing.md }}>
          {modules.map((m) => (
            <ModuleCard key={m.id} m={m} onPress={() => nav.navigate({ name: "Module", moduleId: m.id })} />
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => nav.navigate({ name: "Giving" })}
          style={{ marginTop: spacing.lg, alignSelf: "center" }}
        >
          <T tone="secondary" variant="caption">Give →</T>
        </Pressable>
      </View>
      </Screen>
      <BottomTabBar active="Home" />
    </View>
  );
}

function ModuleCard({ m, onPress }: { m: ModuleVM; onPress: () => void }): ReactElement {
  const locked = m.status === "locked";
  const completed = m.status === "completed";
  const next = m.status === "next";
  const iconBg = completed ? palette.goldTint : next ? palette.navy : palette.mutedBg;
  const iconFg = completed ? palette.goldLo : next ? palette.gold : palette.ink400;
  const fill = completed ? palette.gold : next ? palette.navy : palette.lockedFill;

  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={`Module ${m.seq}: ${m.title}${locked ? ", locked" : ""}`}
      style={({ pressed }) => [
        card.wrap,
        next && { borderColor: "rgba(201,162,39,0.5)" },
        locked && { opacity: 0.55 },
        pressed && !locked && { transform: [{ scale: 0.985 }] },
      ]}
    >
      <View style={[card.icon, { backgroundColor: iconBg }]}>
        <T variant="heading" style={{ color: iconFg }}>{completed ? "✓" : locked ? "•" : "▸"}</T>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={card.metaRow}>
          <T variant="caption" tone="secondary">Module {m.seq}</T>
          {m.minutes != null ? <T variant="caption" tone="secondary">{m.minutes} min</T> : null}
        </View>
        <T variant="heading" style={{ marginTop: 2 }}>{m.title}</T>
        {m.summary ? (
          <T variant="body" tone="secondary" style={{ marginTop: 2 }}>{m.summary}</T>
        ) : null}
        <View style={{ marginTop: spacing.md }}>
          <ProgressBar pct={m.progress} fill={fill} height={6} />
        </View>
      </View>
    </Pressable>
  );
}

const hero = {
  wrap: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 52, paddingBottom: spacing.lg },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.base,
    minHeight: 24,
  },
  card: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderRadius: radii.hero,
    padding: spacing.lg,
  },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.lg },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: spacing.sm },
  minutes: {
    backgroundColor: "rgba(201,162,39,0.15)",
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
} as const;

const listHead = {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "flex-end",
  marginBottom: spacing.base,
} as const;

const card = {
  wrap: {
    flexDirection: "row",
    gap: spacing.base,
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
} as const;
