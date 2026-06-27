// Pathway hub — the Figma "PathwayHub" make. The journey reads as a vertical trail
// of the six levels: connected stations on a gold rail (completed / active /
// locked), a Continue card themed in the active level's gradient, an auto-rotating
// Reminders banner, the active level expanded inline to a 3-module preview, per-level
// certificate + stars + stats, image-rich encouragement waypoints woven after each
// level (badges, a word from your discipler, verses, cheers, event + video cards),
// and a sunrise "Commissioned" summit card where the trail ends. Server stays
// authoritative for unlocking (§1.9): a level above current_level is never tappable.
import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Animated, Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Svg, Circle } from "react-native-svg";
import {
  Award,
  BookMarked,
  BookOpen,
  Check,
  CheckCircle2,
  Library,
  ChevronRight,
  Clock,
  Download,
  Lock,
  PenLine,
  PlayCircle,
  Quote,
  Sparkles,
  Star,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import {
  useAchievements,
  useLevelModules,
  useMe,
  useMentor,
  usePathway,
} from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { cdnImage } from "../util/cdnImage";
import { isLevelLocked, lockedLevelLabel } from "./levelGating";
import type { LevelModule, PathwayLevel } from "../api/types";

const NAVY = palette.navy;
const GOLD = palette.gold;
const GOLD_LO = "#A8861C";

// Per-level gradient so the journey reads as a colourful ascent. (Navy → accent.)
const LEVEL_GRADIENTS: readonly [string, string, string][] = [
  ["#123B62", "#0A2540", "#D8B84D"],
  ["#0A2540", "#315F8C", "#C9A227"],
  ["#1C2A44", "#334155", "#8B7355"],
  ["#0F2B46", "#1E4E6E", "#7EA7C7"],
  ["#14213D", "#5C4A22", "#C9A227"],
  ["#081C36", "#17324F", "#E7D9A3"],
];
const gradientFor = (n: number): readonly [string, string, string] =>
  LEVEL_GRADIENTS[(n - 1) % LEVEL_GRADIENTS.length] ?? LEVEL_GRADIENTS[1]!;

// A lively palette so the inline module rows feel alive — locked rows keep their
// colour (just padlocked), never going grey.
const MOD_COLORS = ["#C9A227", "#6366F1", "#16A34A", "#0EA5E9", "#A855F7", "#DC2626", "#0891B2", "#D97706", "#DB2777"];

// Imagery for event & video waypoints (license-free Unsplash CDN; cdnImage is a
// no-op for non-Cloudinary URLs).
const IMG_GATHERING = "https://images.unsplash.com/photo-1444664361762-afba083a4d77?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const IMG_WORSHIP = "https://images.unsplash.com/photo-1510384742052-1abcb6282645?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const IMG_BIBLE = "https://images.unsplash.com/photo-1497621122273-f5cfb6065c56?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const IMG_COMMISSIONED = "https://images.unsplash.com/photo-1513759565286-20e9c5fad06b?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";

const img = (uri: string): string => cdnImage(uri, { width: 1080 }) ?? uri;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
function firstName(full: string | null | undefined): string {
  return (full ?? "").trim().split(/\s+/)[0] || "friend";
}
function formatDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ── Encouragement waypoints woven into the trail ──────────────────────────────
type Encourage =
  | { kind: "badge"; name: string; desc: string; earned: boolean; stars?: number; emoji: string }
  | { kind: "mentor"; name: string; initials: string; quote: string }
  | { kind: "verse"; ref: string; text: string }
  | { kind: "cheer"; emoji: string; text: string }
  | { kind: "announcement"; tag: string; title: string; meta: string; image: string }
  | { kind: "video"; title: string; meta: string; duration: string; image: string };

const VERSE_POOL: { ref: string; text: string }[] = [
  { ref: "Philippians 1:6", text: "He who began a good work in you will carry it on to completion." },
  { ref: "Psalm 119:105", text: "Your word is a lamp for my feet, a light on my path." },
  { ref: "Isaiah 40:31", text: "Those who hope in the Lord will renew their strength; they will soar on wings like eagles." },
];
const CHEER_POOL: { emoji: string; text: string }[] = [
  { emoji: "⛰️", text: "Over halfway to the summit — every page is forming Christ in you." },
  { emoji: "🔥", text: "You're on a roll — keep showing up, heaven is cheering you on." },
];

// Build a small set of encouragement waypoints to render after a level, varied by
// the level's status so the trail stays inviting end-to-end.
function waypointsFor(level: PathwayLevel, mentorName: string | null): Encourage[] {
  const champion = (level.title.split(/\s+/)[0] ?? "Faith").replace(/^\w/, (c) => c.toUpperCase());
  if (level.status === "completed") {
    const out: Encourage[] = [
      { kind: "badge", name: `${champion} Champion`, desc: "Level complete", earned: true, stars: 3, emoji: "🏆" },
    ];
    if (level.level_number % 2 === 1) {
      out.push({ kind: "announcement", tag: "Testimony", title: "First baptisms in your cohort", meta: "This week at Nuru · tap to read", image: IMG_GATHERING });
    }
    return out;
  }
  if (level.status === "active") {
    return [
      {
        kind: "mentor",
        name: mentorName ?? "your discipler",
        initials: (mentorName ?? "ND").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "ND",
        quote: "You're growing beautifully — press on, the best is still ahead.",
      },
      { kind: "announcement", tag: "Event", title: "Mid-cohort retreat · this Saturday", meta: "Sat 6:00 PM · Lakeview Camp", image: IMG_GATHERING },
      { kind: "video", title: "Watch: What is the Church?", meta: "Teaching · 6 min", duration: "6:12", image: IMG_WORSHIP },
    ];
  }
  // locked — alternate a verse, a video teaser, or a cheer
  const mod = level.level_number % 3;
  if (mod === 0) return [{ kind: "cheer", ...CHEER_POOL[0]! }];
  if (mod === 1) return [{ kind: "verse", ...VERSE_POOL[level.level_number % VERSE_POOL.length]! }];
  return [{ kind: "video", title: "Preview: what's ahead", meta: "Teaching · 8 min", duration: "8:05", image: IMG_BIBLE }];
}

export function LevelsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: me } = useMe();
  const { data: mentorInfo } = useMentor();
  const { data: achievements, refetch: refetchAch } = useAchievements();
  const [refreshing, setRefreshing] = useState(false);

  const levels = pathway?.levels ?? [];
  const active =
    levels.find((l) => l.status === "active") ??
    levels.find((l) => l.level_number === pathway?.current_level) ??
    levels[0];
  // The active level's real modules drive the Continue card + the inline preview.
  const { data: activeModules } = useLevelModules(active?.level_number ?? null);

  async function onRefresh(): Promise<void> {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchAch()]);
    } finally {
      setRefreshing(false);
    }
  }

  if (isLoading && !pathway) {
    return (
      <View style={[st.screen, st.center]}>
        <Loading label="Loading your pathway…" />
      </View>
    );
  }
  if (error || !pathway || !active) {
    return (
      <View style={[st.screen, st.center]}>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </View>
    );
  }

  const totalModules = levels.reduce((s, l) => s + l.total_modules, 0);
  const doneModules = levels.reduce((s, l) => s + l.completed_modules, 0);
  const overallPct = totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0;
  const activePct = active.total_modules > 0 ? Math.round((active.completed_modules / active.total_modules) * 100) : 0;

  // The single in-progress module (or the next one up) inside the active level.
  const activeModule =
    activeModules?.find((m) => !m.completed && !m.locked) ??
    activeModules?.find((m) => !m.completed) ??
    null;
  const mentorName = mentorInfo?.mentor?.full_name ?? null;
  const streak = achievements?.streak?.current ?? 0;

  return (
    <ScrollView
      style={st.screen}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={GOLD} />}
    >
      {/* ── Header — your position on the journey ─────────────────────────── */}
      <View style={st.header}>
        <GradientBg colors={["#0A2540", "#081C36"]} />
        <View style={st.headerTopRow}>
          <T variant="micro" tone="gold" style={{ letterSpacing: 1.8, fontWeight: "700" }}>YOUR PATHWAY</T>
          {streak > 0 ? (
            <View style={st.streakChip}>
              <Sparkles size={11} color={palette.goldChipText} />
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700" }}>{`${streak}-day streak`}</T>
            </View>
          ) : null}
        </View>
        <View style={st.headerMain}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T serif tone="onNavy" style={st.h1}>{`${greeting()}, ${firstName(me?.profile?.full_name)}`}</T>
            <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }} numberOfLines={1}>
              {`Level ${active.level_number} of ${levels.length} · ${active.title}`}
            </T>
            <T variant="micro" tone="onNavyFaint" style={{ marginTop: 6 }}>{`${doneModules} of ${totalModules} modules complete`}</T>
          </View>
          <ProgressRing pct={overallPct} />
        </View>
        {/* Six-level progress ribbon */}
        <View style={st.ribbon}>
          {levels.map((l) => {
            const w = l.status === "completed" ? 100 : l.status === "active" ? activePct : 0;
            return (
              <View key={l.level_number} style={st.ribbonTrack}>
                <View style={{ width: `${w}%`, height: "100%", borderRadius: 4, backgroundColor: GOLD }} />
              </View>
            );
          })}
        </View>
      </View>

      <View style={st.body}>
        {/* ── Continue · the active module (themed in the level gradient) ──── */}
        {activeModule ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Continue ${activeModule.title}`}
            onPress={() => nav.navigate("Level", { levelId: active.level_number })}
            style={({ pressed }) => [st.continueCard, pressed && st.press]}
          >
            <GradientBg colors={gradientFor(active.level_number)} radius={radii.card} />
            <View style={st.continueOverlay} />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <T variant="micro" tone="gold" style={{ letterSpacing: 1.4, fontWeight: "800" }}>PICK UP WHERE YOU LEFT OFF</T>
              <View style={st.offlinePill}>
                <Download size={8} color={palette.onNavy} />
                <T variant="micro" style={{ color: palette.onNavy, fontWeight: "700", fontSize: 8 }}>Offline</T>
              </View>
            </View>
            <T serif tone="onNavy" style={{ fontSize: 20, lineHeight: 25, marginTop: 6 }} numberOfLines={2}>{activeModule.title}</T>
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: spacing.sm }}>
              <View style={st.tonePill}><T variant="micro" style={{ color: palette.onNavy, fontWeight: "700", fontSize: 8 }} numberOfLines={1}>{active.title}</T></View>
              <T variant="micro" tone="onNavyDim">{`Module ${activeModule.module_sequence_number} of ${active.total_modules} · ${activeModule.estimated_minutes ?? 10} min`}</T>
            </View>
            <View style={[st.track, { marginTop: spacing.md, backgroundColor: "rgba(255,255,255,0.2)" }]}>
              <View style={{ width: `${Math.max(activeModule.progress, 6)}%`, height: "100%", borderRadius: 3, backgroundColor: palette.white }} />
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <PlayCircle size={11} color="rgba(255,255,255,0.75)" />
                <T variant="micro" tone="onNavyDim">{activeModule.progress > 0 ? `${activeModule.progress}% in` : "Start now"}</T>
              </View>
              <View style={st.continueBtn}>
                <T variant="micro" style={{ color: NAVY, fontWeight: "800" }}>Continue</T>
                <ChevronRight size={14} color={NAVY} />
              </View>
            </View>
          </Pressable>
        ) : null}

        {/* ── Reminders · auto-rotating nudges ──────────────────────────────── */}
        <RemindersBanner
          items={[
            { tag: "Due today", title: `Reflection · ${activeModule?.title ?? "your module"}`, sub: "Finish your module with a few honest words", Icon: PenLine, colors: ["#C9A227", "#9A7A2A"], onPress: () => nav.navigate("Level", { levelId: active.level_number }) },
            { tag: "Today", title: "Devotional · the renewed mind", sub: "6 min · Inner transformation", Icon: Sparkles, colors: ["#0A2540", "#081C36"], onPress: () => nav.navigate("Devotional") },
            { tag: "Reading plan", title: "Gospel of John · Day 4", sub: "John 4:1–26 is waiting for you", Icon: BookOpen, colors: ["#4F46E5", "#3730A3"], onPress: () => nav.navigate("ReadingPlans") },
            { tag: "Almost there", title: `${active.title} · ${activePct}%`, sub: "Finish this level to earn your certificate", Icon: Award, colors: ["#16A34A", "#15803D"], onPress: () => nav.navigate("Level", { levelId: active.level_number }) },
            { tag: "Verse library", title: "Revisit a verse you saved", sub: "Hide His Word in your heart", Icon: Library, colors: ["#0EA5E9", "#0369A1"], onPress: () => nav.navigate("VerseLibrary") },
            { tag: "Resources", title: "Go deeper this week", sub: "Books, audio & video for the journey", Icon: BookMarked, colors: ["#7C3AED", "#4C1D95"], onPress: () => nav.navigate("Resources") },
          ]}
        />

        {/* ── The journey · a vertical trail of the six levels ──────────────── */}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 }}>
          <T variant="micro" style={{ color: GOLD_LO, fontWeight: "700", letterSpacing: 2 }}>THE JOURNEY</T>
          <T variant="micro" tone="tertiary">{`Level ${pathway.current_level} of ${levels.length}`}</T>
        </View>

        <View>
          {levels.map((lvl, i) => {
            const last = i === levels.length - 1;
            const segmentDone = lvl.status === "completed";
            const waypoints = waypointsFor(lvl, mentorName);
            const locked = isLevelLocked(lvl.level_number, pathway.current_level, lvl.status);
            return (
              <View key={lvl.level_number} style={{ flexDirection: "row", gap: spacing.md }}>
                <View style={{ alignItems: "center" }}>
                  <JourneyNode status={lvl.status} index={lvl.level_number} />
                  {!last ? <View style={[st.connector, { backgroundColor: segmentDone ? GOLD : "rgba(10,37,64,0.10)" }]} /> : null}
                </View>
                <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : spacing.md }}>
                  <LevelStation
                    level={lvl}
                    locked={locked}
                    currentLevel={pathway.current_level}
                    modules={lvl.status === "active" ? activeModules ?? null : null}
                    onOpen={() => nav.navigate("Level", { levelId: lvl.level_number })}
                  />
                  {waypoints.map((w, idx) => (
                    <View key={idx} style={{ marginTop: spacing.sm }}>
                      <TrailEncouragement data={w} />
                    </View>
                  ))}
                </View>
              </View>
            );
          })}
        </View>

        {/* ── The summit — commissioned ─────────────────────────────────────── */}
        <View style={st.summit}>
          <Image source={{ uri: img(IMG_COMMISSIONED) }} style={st.summitImg} resizeMode="cover" />
          <View style={st.summitShade} />
          <View style={st.summitBody}>
            <T style={{ fontSize: 26 }}>👑</T>
            <T variant="micro" style={{ color: "#E6C068", fontWeight: "700", letterSpacing: 2.2, marginTop: 4 }}>THE SUMMIT</T>
            <T serif tone="onNavy" style={{ fontSize: 19, marginTop: 2 }}>Commissioned</T>
            <T variant="caption" tone="onNavyDim" style={{ marginTop: 2 }}>Sent to make disciples · Matthew 28:19</T>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

// ── Journey node — completed / active (pulsing) / locked ──────────────────────
function JourneyNode({ status, index }: { status: PathwayLevel["status"]; index: number }): ReactElement {
  const done = status === "completed";
  const active = status === "active";
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  return (
    <View style={st.nodeWrap}>
      {active ? (
        <Animated.View
          style={[
            st.nodePulse,
            { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.5] }) }] },
          ]}
        />
      ) : null}
      <View style={[st.node, { backgroundColor: done || active ? GOLD : "#EEF1F5", borderWidth: active ? 2 : 0, borderColor: NAVY }]}>
        {done ? <CheckCircle2 size={17} color={NAVY} /> : active ? <PlayCircle size={17} color={NAVY} /> : <Lock size={13} color="#9CA3AF" />}
        {!done && !active ? (
          <View style={st.nodeNum}><T variant="micro" style={{ color: "#9CA3AF", fontWeight: "800", fontSize: 7 }}>{index}</T></View>
        ) : null}
      </View>
    </View>
  );
}

// ── Level station card (with the active level's inline module window) ─────────
function LevelStation({
  level,
  locked,
  currentLevel,
  modules,
  onOpen,
}: {
  level: PathwayLevel;
  locked: boolean;
  currentLevel: number;
  modules: LevelModule[] | null;
  onOpen: () => void;
}): ReactElement {
  const done = level.status === "completed";
  const active = level.status === "active";
  const pct = level.total_modules > 0 ? Math.round((level.completed_modules / level.total_modules) * 100) : 0;
  const remaining = Math.max(0, level.total_modules - level.completed_modules);
  const subtitle = level.theme ?? level.description ?? "";

  // A compact ~3-module window around the active module.
  const moduleWindow: LevelModule[] = useMemo(() => {
    if (!modules || modules.length === 0) return [];
    const idx = Math.max(0, modules.findIndex((m) => !m.completed && !m.locked));
    return modules.slice(idx, idx + 3);
  }, [modules]);

  const Wrap = ({ children }: { children: ReactNode }): ReactElement =>
    locked ? (
      <View style={[st.station, st.stationLocked]}>{children}</View>
    ) : (
      <Pressable accessibilityRole="button" accessibilityLabel={`Level ${level.level_number}: ${level.title}`} onPress={onOpen} style={({ pressed }) => [st.station, active && st.stationActive, pressed && st.press]}>
        {children}
      </Pressable>
    );

  return (
    <Wrap>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" style={{ color: GOLD_LO, fontWeight: "700", letterSpacing: 1.6 }}>{`LEVEL ${level.level_number}`}</T>
          <T serif style={{ fontSize: 15, color: NAVY, fontWeight: "600", marginTop: 1 }} numberOfLines={1}>{level.title}</T>
          {subtitle ? <T variant="micro" tone="secondary" style={{ marginTop: 1 }} numberOfLines={1}>{subtitle}</T> : null}
        </View>
        <StatusPill status={level.status} />
      </View>

      {/* Active — progress + the modules within */}
      {active ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm }}>
            <View style={st.miniTrack}><View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: GOLD }} /></View>
            <T variant="micro" tone="tertiary">{`${level.completed_modules}/${level.total_modules}`}</T>
          </View>
          {moduleWindow.length > 0 ? (
            <View style={{ marginTop: spacing.md, gap: 6 }}>
              {moduleWindow.map((m) => (
                <ModuleRow key={m.module_id} m={m} color={MOD_COLORS[(m.module_sequence_number - 1) % MOD_COLORS.length] as string} onPress={onOpen} />
              ))}
              {modules && modules.length > moduleWindow.length ? (
                <Pressable accessibilityRole="button" onPress={onOpen} style={({ pressed }) => [st.viewAll, pressed && st.press]}>
                  <T variant="micro" style={{ color: GOLD, fontWeight: "700" }}>{`View all ${modules.length} modules`}</T>
                  <ChevronRight size={12} color={GOLD} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}

      {/* Related stats */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: spacing.md }}>
        <MiniStat Icon={BookOpen} label={`${level.completed_modules}/${level.total_modules} modules`} />
        <MiniStat Icon={Clock} label={formatDuration(level.minutes)} />
        {done ? <MiniStat Icon={Star} label="3 stars" gold /> : null}
        {active ? <MiniStat Icon={Sparkles} label={`${pct}% done`} gold /> : null}
      </View>

      {/* Certificate row */}
      <CertificateRow status={level.status} pct={pct} remaining={remaining} />

      {/* Encouragement line */}
      <T serif style={{ fontSize: 11, fontStyle: "italic", marginTop: spacing.sm, color: done ? "#7A5A14" : active ? GOLD_LO : "#9CA3AF" }}>
        {done
          ? "Crowned — well run. 🎉"
          : active
            ? remaining <= 1
              ? "One step from your certificate — finish strong!"
              : `Just ${remaining} modules to earn your certificate. Keep going!`
            : locked
              ? lockedLevelLabel(currentLevel)
              : "A new certificate is waiting for you here."}
      </T>
    </Wrap>
  );
}

function ModuleRow({ m, color, onPress }: { m: LevelModule; color: string; onPress: () => void }): ReactElement {
  const done = m.completed;
  const active = !m.completed && !m.locked;
  const locked = m.locked;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Module ${m.module_sequence_number}: ${m.title}${locked ? ", locked" : ""}`}
      disabled={locked}
      onPress={locked ? undefined : onPress}
      style={({ pressed }) => [
        st.modRow,
        { backgroundColor: active ? `${color}26` : `${color}10`, borderColor: active ? `${color}88` : `${color}33` },
        pressed && !locked && st.press,
      ]}
    >
      <View style={[st.modIcon, { backgroundColor: done || active ? color : `${color}26` }]}>
        {done ? <Check size={15} color={palette.white} /> : active ? <PlayCircle size={16} color={palette.white} /> : <Lock size={14} color={color} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="caption" style={{ color: NAVY, fontWeight: active ? "700" : "600" }} numberOfLines={1}>{m.title}</T>
        <T variant="micro" style={{ color: done ? "#16A34A" : active ? GOLD_LO : color, fontWeight: "600", marginTop: 1 }} numberOfLines={1}>
          {done ? "Completed" : active ? `${m.estimated_minutes ?? 10} min · in progress` : "Locked"}
        </T>
      </View>
      {active ? <View style={st.resumeChip}><T variant="micro" style={{ color: GOLD, fontWeight: "700" }}>Resume</T></View> : locked ? <Lock size={13} color={color} /> : null}
    </Pressable>
  );
}

function MiniStat({ Icon, label, gold }: { Icon: LucideIcon; label: string; gold?: boolean }): ReactElement {
  return (
    <View style={[st.miniStat, gold && { backgroundColor: "rgba(201,162,39,0.14)" }]}>
      <Icon size={9} color={gold ? GOLD_LO : "#68758A"} />
      <T variant="micro" style={{ color: gold ? GOLD_LO : "#68758A", fontWeight: "600" }}>{label}</T>
    </View>
  );
}

function CertificateRow({ status, pct, remaining }: { status: PathwayLevel["status"]; pct: number; remaining: number }): ReactElement {
  if (status === "completed") {
    return (
      <View style={st.certEarned}>
        <View style={st.certSeal}><Award size={18} color={NAVY} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="caption" style={{ color: "#7A5A14", fontWeight: "700" }}>Certificate earned</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 1 }}>
            {[0, 1, 2].map((i) => <Star key={i} size={11} color={GOLD} fill={GOLD} />)}
            <T variant="micro" style={{ color: "#9A7A2A", marginLeft: 4 }}>Honors</T>
          </View>
        </View>
        <View style={st.certView}><T variant="micro" style={{ color: GOLD, fontWeight: "700" }}>View</T></View>
      </View>
    );
  }
  if (status === "active") {
    return (
      <View style={st.certActive}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <Award size={13} color={GOLD} />
            <T variant="micro" style={{ color: "#7A5A14", fontWeight: "600" }}>Certificate in progress</T>
          </View>
          <T variant="micro" style={{ color: GOLD_LO, fontWeight: "700" }}>{`${pct}%`}</T>
        </View>
        <View style={[st.miniTrack, { marginTop: 6 }]}><View style={{ width: `${pct}%`, height: "100%", borderRadius: 3, backgroundColor: GOLD }} /></View>
        <T variant="micro" tone="tertiary" style={{ marginTop: 6 }}>{`${remaining} module${remaining === 1 ? "" : "s"} left to unlock it`}</T>
      </View>
    );
  }
  return (
    <View style={st.certAwait}>
      <View style={st.certAwaitIcon}><Award size={14} color="#9CA3AF" /></View>
      <T variant="micro" style={{ color: "#9CA3AF" }}>Certificate awaiting you</T>
    </View>
  );
}

function StatusPill({ status }: { status: PathwayLevel["status"] }): ReactElement {
  const map = {
    completed: { label: "Complete", bg: "#DCFCE7", fg: "#166534" },
    active: { label: "In progress", bg: "rgba(201,162,39,0.14)", fg: "#7A5A14" },
    locked: { label: "Locked", bg: "#EEF1F5", fg: "#9CA3AF" },
  } as const;
  const s = map[status];
  return <View style={[st.statusPill, { backgroundColor: s.bg }]}><T variant="micro" style={{ color: s.fg, fontWeight: "700", letterSpacing: 0.5 }}>{s.label.toUpperCase()}</T></View>;
}

// ── Auto-rotating reminders banner with dot pagination ────────────────────────
type Reminder = { tag: string; title: string; sub: string; Icon: LucideIcon; colors: [string, string]; onPress: () => void };
function RemindersBanner({ items }: { items: Reminder[] }): ReactElement | null {
  const [i, setI] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => {
      Animated.timing(fade, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
        setI((p) => (p + 1) % items.length);
        Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
      });
    }, 4500);
    return () => clearInterval(t);
  }, [items.length, fade]);

  const r = items[i] ?? items[0];
  if (!r) return null;
  const { Icon } = r;
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Sparkles size={11} color={GOLD_LO} />
          <T variant="micro" style={{ color: GOLD_LO, fontWeight: "700", letterSpacing: 1.8 }}>REMINDERS</T>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {items.map((_, idx) => (
            <View key={idx} style={{ height: 6, width: idx === i ? 16 : 6, borderRadius: 3, backgroundColor: idx === i ? GOLD : "rgba(10,37,64,0.18)" }} />
          ))}
        </View>
      </View>
      <Animated.View style={{ opacity: fade }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${r.tag}: ${r.title}`} onPress={r.onPress} style={({ pressed }) => [st.reminder, pressed && st.press]}>
          <GradientBg colors={r.colors} radius={20} />
          <View style={st.reminderIcon}><Icon size={20} color={palette.white} /></View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700", letterSpacing: 1.4 }}>{r.tag.toUpperCase()}</T>
            <T serif tone="onNavy" style={{ fontSize: 14, marginTop: 1 }} numberOfLines={1}>{r.title}</T>
            <T variant="micro" style={{ color: "rgba(255,255,255,0.8)", marginTop: 1 }} numberOfLines={1}>{r.sub}</T>
          </View>
          <ChevronRight size={18} color={palette.white} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ── Trail encouragement waypoints (badge / mentor / verse / cheer / event / video) ─
function TrailEncouragement({ data }: { data: Encourage }): ReactElement {
  if (data.kind === "badge") {
    const earned = data.earned;
    return (
      <View style={[st.encBadge, earned ? st.encBadgeEarned : st.encBadgeLocked]}>
        <View style={[st.encBadgeEmoji, { backgroundColor: earned ? palette.white : "#EEF1F5", opacity: earned ? 1 : 0.7 }]}><T style={{ fontSize: 20 }}>{data.emoji}</T></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <T variant="micro" style={{ color: earned ? GOLD_LO : "#9CA3AF", fontWeight: "700", letterSpacing: 1.4 }}>{earned ? "BADGE EARNED" : "BADGE TO EARN"}</T>
            {!earned ? <Lock size={8} color="#9CA3AF" /> : null}
          </View>
          <T serif style={{ fontSize: 13, color: earned ? NAVY : "#68758A", fontWeight: "600", marginTop: 1 }} numberOfLines={1}>{data.name}</T>
          {earned && data.stars ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, marginTop: 2 }}>
              {Array.from({ length: data.stars }, (_, i) => <Star key={i} size={10} color={GOLD} fill={GOLD} />)}
              <T variant="micro" style={{ color: "#9A7A2A", marginLeft: 4 }}>{data.desc}</T>
            </View>
          ) : (
            <T variant="micro" tone="tertiary" style={{ marginTop: 1 }} numberOfLines={1}>{data.desc}</T>
          )}
        </View>
      </View>
    );
  }
  if (data.kind === "mentor") {
    return (
      <View style={st.encMentor}>
        <View style={st.encMentorAvatar}><T variant="micro" style={{ color: palette.white, fontWeight: "700" }}>{data.initials}</T></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" style={{ color: "#15803D", fontWeight: "700", letterSpacing: 1.2 }}>{`A WORD FROM ${data.name.toUpperCase()}`}</T>
          <T serif style={{ fontSize: 11, fontStyle: "italic", color: "#14532D", lineHeight: 16, marginTop: 2 }}>{`“${data.quote}”`}</T>
        </View>
      </View>
    );
  }
  if (data.kind === "verse") {
    return (
      <View style={st.encVerse}>
        <View style={st.encVerseIcon}><Quote size={13} color={GOLD} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T serif style={{ fontSize: 11, color: NAVY, lineHeight: 16 }}>{`“${data.text}”`}</T>
          <T variant="micro" style={{ color: GOLD_LO, fontWeight: "700", marginTop: 2 }}>{data.ref}</T>
        </View>
      </View>
    );
  }
  if (data.kind === "announcement") {
    return (
      <View style={st.encMedia}>
        <Image source={{ uri: img(data.image) }} style={st.encMediaImg} resizeMode="cover" />
        <View style={st.encMediaShade} />
        <View style={st.encMediaTag}><T variant="micro" style={{ color: NAVY, fontWeight: "700", letterSpacing: 1 }}>{data.tag.toUpperCase()}</T></View>
        <View style={st.encMediaCaption}>
          <T serif tone="onNavy" style={{ fontSize: 15 }} numberOfLines={1}>{data.title}</T>
          <T variant="micro" style={{ color: "rgba(255,255,255,0.85)", marginTop: 1 }} numberOfLines={1}>{data.meta}</T>
        </View>
      </View>
    );
  }
  if (data.kind === "video") {
    return (
      <View style={st.encMedia}>
        <Image source={{ uri: img(data.image) }} style={st.encMediaImg} resizeMode="cover" />
        <View style={st.encMediaShade} />
        <BreathingPlay />
        <View style={st.encMediaDuration}><T variant="micro" style={{ color: palette.white, fontWeight: "700" }}>{data.duration}</T></View>
        <View style={st.encMediaCaption}>
          <T variant="micro" style={{ color: "#E6C068", fontWeight: "700", letterSpacing: 1.4 }}>WATCH</T>
          <T serif tone="onNavy" style={{ fontSize: 15 }} numberOfLines={1}>{data.title}</T>
          <T variant="micro" style={{ color: "rgba(255,255,255,0.85)", marginTop: 1 }} numberOfLines={1}>{data.meta}</T>
        </View>
      </View>
    );
  }
  // cheer
  return (
    <View style={st.encCheer}>
      <T style={{ fontSize: 18 }}>{data.emoji}</T>
      <T serif style={{ flex: 1, fontSize: 11, fontStyle: "italic", color: "#7A5A14", lineHeight: 15 }}>{data.text}</T>
    </View>
  );
}

function BreathingPlay(): ReactElement {
  const s = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(s, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(s, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [s]);
  return (
    <View style={st.playWrap} pointerEvents="none">
      <Animated.View style={[st.playBtn, { transform: [{ scale: s.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) }] }]}>
        <PlayCircle size={28} color={NAVY} fill={NAVY} />
      </Animated.View>
    </View>
  );
}

function ProgressRing({ pct }: { pct: number }): ReactElement {
  const size = 64;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={GOLD} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${c}`} strokeDashoffset={offset} />
      </Svg>
      <T serif tone="onNavy" style={{ fontSize: 14 }}>{`${pct}%`}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F4F0E8" },
  center: { alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.lg, borderBottomLeftRadius: 30, borderBottomRightRadius: 30, overflow: "hidden" },
  headerTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  streakChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  headerMain: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: spacing.sm, gap: spacing.md },
  h1: { fontSize: 22, lineHeight: 27, fontWeight: "600" },
  ribbon: { flexDirection: "row", gap: 6, marginTop: spacing.base },
  ribbonTrack: { flex: 1, height: 6, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.14)", overflow: "hidden" },
  body: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    paddingHorizontal: spacing.screen,
    paddingTop: spacing.lg,
    gap: spacing.lg,
  },
  continueCard: { borderRadius: radii.card, borderWidth: 1, borderColor: "rgba(201,162,39,0.2)", padding: spacing.base, overflow: "hidden", ...shadow.card },
  continueOverlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.12)" },
  offlinePill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radii.pill, paddingHorizontal: 6, paddingVertical: 2 },
  tonePill: { backgroundColor: "rgba(255,255,255,0.18)", borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, maxWidth: 160 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  continueBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: GOLD, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 7 },
  press: { transform: [{ scale: 0.99 }], opacity: 0.96 },
  // journey
  nodeWrap: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  nodePulse: { position: "absolute", width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(201,162,39,0.45)" },
  node: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  nodeNum: { position: "absolute", bottom: -2, right: -2, width: 15, height: 15, borderRadius: 8, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  connector: { width: 3, flex: 1, borderRadius: 2, minHeight: 18, marginTop: 2 },
  station: { borderRadius: 20, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, padding: spacing.md, ...shadow.card },
  stationActive: { borderColor: "rgba(201,162,39,0.4)" },
  stationLocked: { backgroundColor: palette.surface, opacity: 0.85 },
  statusPill: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3, alignSelf: "flex-start" },
  miniTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(10,37,64,0.08)", overflow: "hidden" },
  // module rows
  modRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: 12, borderWidth: 1, padding: spacing.sm },
  modIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  resumeChip: { backgroundColor: NAVY, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  viewAll: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(201,162,39,0.4)", backgroundColor: "rgba(201,162,39,0.05)", paddingVertical: spacing.sm },
  miniStat: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#EEF1F5", borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  // certificate
  certEarned: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: "rgba(201,162,39,0.35)", backgroundColor: "rgba(201,162,39,0.10)", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  certSeal: { width: 36, height: 36, borderRadius: 18, backgroundColor: GOLD, alignItems: "center", justifyContent: "center" },
  certView: { backgroundColor: NAVY, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  certActive: { marginTop: spacing.md, borderRadius: 16, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(201,162,39,0.5)", backgroundColor: palette.surface, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  certAwait: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, borderRadius: 16, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  certAwaitIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "#EEF1F5", alignItems: "center", justifyContent: "center" },
  // reminders
  reminder: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 20, padding: spacing.md, overflow: "hidden" },
  reminderIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.18)", alignItems: "center", justifyContent: "center" },
  // encouragements
  encBadge: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 16, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  encBadgeEarned: { backgroundColor: "rgba(201,162,39,0.12)", borderWidth: 1, borderColor: "rgba(201,162,39,0.35)" },
  encBadgeLocked: { backgroundColor: palette.surface, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(10,37,64,0.18)" },
  encBadgeEmoji: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(201,162,39,0.35)" },
  encMentor: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: 16, backgroundColor: "#F0FDF4", borderWidth: 1, borderColor: "#BBF7D0", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  encMentorAvatar: { width: 36, height: 36, borderRadius: 14, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  encVerse: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: 16, backgroundColor: "#FFF8E6", borderWidth: 1, borderColor: "rgba(201,162,39,0.25)", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  encVerseIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: "rgba(201,162,39,0.14)", alignItems: "center", justifyContent: "center" },
  encMedia: { height: 160, borderRadius: 20, overflow: "hidden", backgroundColor: NAVY, borderWidth: 1, borderColor: palette.border, justifyContent: "flex-end" },
  encMediaImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  encMediaShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.32)" },
  encMediaTag: { position: "absolute", top: 12, left: 12, backgroundColor: GOLD, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  encMediaDuration: { position: "absolute", top: 12, right: 12, backgroundColor: "rgba(11,31,51,0.7)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  encMediaCaption: { padding: spacing.md },
  playWrap: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: GOLD, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: "rgba(255,255,255,0.3)" },
  encCheer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: 16, backgroundColor: "rgba(201,162,39,0.10)", borderWidth: 1, borderColor: "rgba(201,162,39,0.33)", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  // summit
  summit: { height: 176, borderRadius: 22, overflow: "hidden", backgroundColor: NAVY, justifyContent: "flex-end", ...shadow.card },
  summitImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  summitShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.55)" },
  summitBody: { alignItems: "center", padding: spacing.base },
} as const;
