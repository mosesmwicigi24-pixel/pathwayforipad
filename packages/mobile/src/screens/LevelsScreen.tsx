// Pathway tab root — "Today's journey" hub (new design, spec §3 PathwayHub).
// Navy header (overall-progress ring + verse of the day); a TODAY rail with the
// live Continue card + Devotional / Reading-plan / Prayer-wall previews; a GROW
// stack of rich preview cards that surface what's happening on each growth page
// (memory verse + recall, discipler + next meeting, gifts, journal, saved verses,
// resources); then YOUR JOURNEY — vibrant per-level cards, unlocked ones live and
// locked ones colored with a padlock. Server stays authoritative for unlocking
// (§1.9): a level above current_level is never tappable.
import { Fragment, useCallback, useState, type ReactElement, type ReactNode } from "react";
import { Image, Pressable, RefreshControl, ScrollView, View } from "react-native";
import {
  BookMarked,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Flame,
  HandHeart,
  Library,
  Lock,
  PlayCircle,
  Quote,
  Sparkles,
  Sun,
  UserRoundCheck,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { Avatar } from "../components/Avatar";
import {
  useAchievements,
  useDevotional,
  useMemoryVerses,
  useMentor,
  useMyGifts,
  usePathway,
  usePlans,
  usePrayers,
  usePrayerWallHome,
  useResources,
  useScripture,
  useVerses,
} from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { isLevelLocked, lockedLevelLabel } from "./levelGating";
import type { PathwayLevel } from "../api/types";

// Per-level accent so the journey reads as a colourful ladder. Locked levels keep
// their colour (just dimmed + padlocked) so the path ahead stays inviting.
const LEVEL_ACCENTS = [
  { tint: palette.goldTint, fg: palette.goldLo, bar: palette.gold },
  { tint: "#E0E7FF", fg: "#4338CA", bar: "#6366F1" },
  { tint: "#DCFCE7", fg: "#15803D", bar: "#22C55E" },
  { tint: "#F3E8FF", fg: "#7E22CE", bar: "#A855F7" },
  { tint: "#FFE4E6", fg: "#BE123C", bar: "#F43F5E" },
  { tint: "#CFFAFE", fg: "#0E7490", bar: "#06B6D4" },
] as const;

// Interleaved imagery between the level cards. The Bible-study photo is a real,
// license-free image (Unsplash CDN); swap for an uploaded asset later if desired.
const BIBLE_STUDY_IMG = "https://images.unsplash.com/photo-1504052434569-70ad5836ab65?w=1200&q=80";
// Light breaking through — resonates with discovering God-given gifts.
const GIFTS_IMG = "https://images.unsplash.com/photo-1499209974431-9dddcece7f88?w=1200&q=80";

const snippet = (s: string | null | undefined, n: number): string => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export function LevelsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: achievements, refetch: refetchAch } = useAchievements();
  const { data: verse } = useScripture("Romans 12:2");
  // Live previews — each card mirrors what's on its page.
  const { data: devotional } = useDevotional();
  const { data: plans } = usePlans();
  const { data: wall } = usePrayerWallHome();
  const { data: prayers } = usePrayers();
  const { data: mentor } = useMentor();
  const { data: gifts } = useMyGifts();
  const { data: memoryVerses } = useMemoryVerses();
  const { data: savedVerses } = useVerses();
  const { data: resources } = useResources();
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

  // ── derive preview content ──────────────────────────────────────────
  const plan = plans?.find((p) => p.enrolled) ?? plans?.[0] ?? null;
  const planDone = plan?.completed_days?.length ?? 0;
  const planPct = plan && plan.day_count > 0 ? Math.round((planDone / plan.day_count) * 100) : 0;
  const topPrayer = wall?.[0] ?? null;
  const prayerCount = prayers?.length ?? 0;
  const answeredCount = prayers?.filter((p) => p.is_answered).length ?? 0;
  const latestPrayer = prayers?.[0] ?? null;
  const mv = memoryVerses?.find((v) => v.status === "learning") ?? memoryVerses?.[0] ?? null;
  const topGifts = gifts?.assessment?.top_gifts ?? [];
  const savedLatest = savedVerses?.[0] ?? null;
  const featured = resources?.[0] ?? null;
  const me = mentor?.mentor ?? null;

  return (
    <ScrollView
      style={st.screen}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
    >
      {/* ── Navy header with progress ring + verse ──────────────────── */}
      <View style={st.header}>
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

      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg, gap: spacing.base }}>
        {/* ── TODAY ──────────────────────────────────────────────────── */}
        <View style={st.sectionHead}>
          <T variant="micro" style={st.sectionLabel}>TODAY</T>
          {streak > 0 ? (
            <View style={st.streakChip}>
              <Flame size={11} color={palette.goldChipText} />
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700" }}>{`${streak}-day streak`}</T>
            </View>
          ) : null}
        </View>

        {/* Continue learning (deep navy) — the primary CTA */}
        {active ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Level", { levelId: active.level_number })}
            style={({ pressed }) => [st.continueCard, pressed && { transform: [{ scale: 0.99 }] }]}
          >
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

        {/* Today's Devotional — gold-accent hero preview */}
        <PreviewCard
          label="Today's devotional"
          Icon={Sun}
          tint={palette.goldTint}
          fg={palette.goldLo}
          accent
          onPress={() => nav.navigate("Devotional")}
          chip={devotional?.day_number ? { text: `Day ${devotional.day_number}`, bg: palette.goldChipBg, fg: palette.goldChipText } : undefined}
        >
          <T serif style={{ fontSize: 16, color: palette.ink, marginTop: 2 }} numberOfLines={1}>
            {devotional?.title ?? "A daily word to carry with you"}
          </T>
          {devotional?.scripture_ref ? (
            <T variant="micro" tone="gold" style={{ marginTop: 3 }}>{devotional.scripture_ref}</T>
          ) : null}
          <T variant="caption" tone="secondary" style={{ marginTop: 6 }} numberOfLines={2}>
            {snippet(devotional?.reflection_prompt ?? devotional?.scripture_text ?? devotional?.body, 110) || "Open today's reflection."}
          </T>
        </PreviewCard>

        {/* Reading plan + Prayer wall — side by side */}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <TwoUpCard
            label="Reading plan"
            Icon={BookOpen}
            tint="#E0E7FF"
            fg="#4338CA"
            onPress={() => (plan ? nav.navigate("PlanDetail", { planId: plan.plan_id, title: plan.title }) : nav.navigate("ReadingPlans"))}
            chip={plan?.enrolled ? { text: `${planPct}%`, bg: "#E0E7FF", fg: "#4338CA" } : undefined}
          >
            <T variant="heading" style={{ fontSize: 14, marginTop: 2 }} numberOfLines={2}>
              {plan?.title ?? "Read through Scripture"}
            </T>
            {plan?.enrolled ? (
              <>
                <View style={[st.miniTrack, { marginTop: 8 }]}>
                  <View style={{ width: `${planPct}%`, height: "100%", borderRadius: 2, backgroundColor: "#6366F1" }} />
                </View>
                <T variant="micro" tone="tertiary" style={{ marginTop: 6 }}>{`Day ${plan.current_day ?? planDone + 1} of ${plan.day_count}`}</T>
              </>
            ) : (
              <T variant="micro" tone="tertiary" style={{ marginTop: 4 }} numberOfLines={1}>
                {plans && plans.length > 0 ? `${plans.length} plans to start` : "Start a guided plan"}
              </T>
            )}
          </TwoUpCard>

          <TwoUpCard
            label="Prayer wall"
            Icon={Users}
            tint="#FCE7F3"
            fg="#BE185D"
            onPress={() => (topPrayer ? nav.navigate("PrayerWallDetail", { postId: topPrayer.post_id }) : nav.navigate("PrayerWall"))}
            chip={topPrayer ? { text: `🙏 ${topPrayer.pray_count}`, bg: "#FCE7F3", fg: "#BE185D" } : undefined}
          >
            {topPrayer ? (
              <>
                <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>
                  {snippet(topPrayer.title ?? topPrayer.body, 64)}
                </T>
                <T variant="micro" tone="tertiary" style={{ marginTop: 6 }} numberOfLines={1}>
                  {`${topPrayer.author_name}`}
                </T>
              </>
            ) : (
              <T variant="micro" tone="tertiary" style={{ marginTop: 4 }} numberOfLines={2}>Share a request to pray under.</T>
            )}
          </TwoUpCard>
        </View>

        {/* ── YOUR JOURNEY (the seven levels, each with a summary) ─────── */}
        <View style={st.sectionHead}>
          <T variant="micro" style={st.sectionLabel}>YOUR JOURNEY</T>
          <T variant="micro" tone="tertiary">{`Level ${pathway.current_level} of ${levels.length}`}</T>
        </View>
        <View style={{ gap: spacing.sm }}>
          {levels.map((lvl) => (
            <Fragment key={lvl.level_number}>
              <LevelCard
                level={lvl}
                currentLevel={pathway.current_level}
                isActive={active?.level_number === lvl.level_number}
                onPress={() => nav.navigate("Level", { levelId: lvl.level_number })}
              />
              {/* After Level 3: a Bible-study image that resonates with the Word. */}
              {lvl.level_number === 3 ? (
                <BibleStudyBanner onPress={() => nav.navigate("ReadingPlans")} />
              ) : null}
              {/* After Level 6: an in-app ad promoting the Pathway app. */}
              {lvl.level_number === 6 ? <PathwayAdBanner /> : null}
            </Fragment>
          ))}
        </View>

        {/* ── GROW ───────────────────────────────────────────────────── */}
        <View style={st.sectionHead}>
          <T variant="micro" style={st.sectionLabel}>GROW</T>
        </View>

        {/* Memory verses — the verse + how well it's hidden */}
        <PreviewCard
          label="Memory verses"
          Icon={Quote}
          tint="#FEF3C7"
          fg="#92400E"
          onPress={() => nav.navigate("MemoryVerses")}
          chip={
            mv
              ? mv.status === "mastered"
                ? { text: "Mastered", bg: palette.successBg, fg: palette.successText }
                : (mv.best_match_pct ?? 0) > 0
                  ? { text: `${mv.best_match_pct}% recall`, bg: "#FEF3C7", fg: "#92400E" }
                  : { text: "New", bg: "#FEF3C7", fg: "#92400E" }
              : undefined
          }
        >
          {mv ? (
            <>
              <T variant="micro" tone="gold" style={{ marginTop: 2 }}>{mv.reference}</T>
              <T serif style={{ fontSize: 15, lineHeight: 22, color: palette.ink, marginTop: 3 }} numberOfLines={2}>{mv.verse_text}</T>
            </>
          ) : (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Start hiding His Word in your heart.</T>
          )}
        </PreviewCard>

        {/* Your discipler — who walks with you + next meeting */}
        <PreviewCard
          label="Your discipler"
          Icon={UserRoundCheck}
          tint={palette.successBg}
          fg={palette.successText}
          onPress={() => nav.navigate("Mentor")}
        >
          {me ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 }}>
              <Avatar uri={me.avatar_url} name={me.full_name} size={34} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="heading" style={{ fontSize: 14 }} numberOfLines={1}>{me.full_name}</T>
                {mentor?.next_meeting_at ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                    <CalendarClock size={11} color={palette.ink400} />
                    <T variant="micro" tone="tertiary">{`Next: ${niceDate(mentor.next_meeting_at)}`}</T>
                  </View>
                ) : (
                  <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{me.cell_name ?? "Tap to see notes"}</T>
                )}
              </View>
            </View>
          ) : (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>A discipler will be assigned to walk with you.</T>
          )}
        </PreviewCard>

        {/* Spiritual gifts — image-backed feature with a clear call to the test */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={topGifts.length > 0 ? "View your spiritual gifts" : "Take the spiritual gifts test"}
          onPress={() => nav.navigate("Gifts")}
          style={({ pressed }) => [st.giftsFeature, pressed && { opacity: 0.92 }]}
        >
          <Image source={{ uri: GIFTS_IMG }} style={st.giftsImg} resizeMode="cover" />
          <View style={st.giftsShade} />
          <View style={st.giftsBody}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Sparkles size={14} color={palette.goldGlow} />
              <T variant="micro" tone="gold" style={{ letterSpacing: 1.6, fontWeight: "800" }}>SPIRITUAL GIFTS</T>
            </View>
            <T serif tone="onNavy" style={{ fontSize: 19, lineHeight: 24, marginTop: 4 }}>
              {topGifts.length > 0 ? "Your gift personality" : "Discover how God wired you"}
            </T>
            <T variant="caption" tone="onNavyDim" style={{ marginTop: 3 }} numberOfLines={2}>
              {topGifts.length > 0 ? topGifts.join(" · ") : "A short, personalized test reveals your top gifts and where to serve."}
            </T>
            <View style={st.giftsCta}>
              <T variant="label" style={{ color: palette.navyDeep, fontWeight: "800" }}>
                {topGifts.length > 0 ? "View your gifts" : "Take the test"}
              </T>
              <ChevronRight size={15} color={palette.navyDeep} />
            </View>
          </View>
        </Pressable>

        {/* Prayer journal — private; latest entry + counts */}
        <PreviewCard
          label="Prayer journal"
          Icon={HandHeart}
          tint="#FEE2E2"
          fg="#B91C1C"
          onPress={() => nav.navigate("PrayerJournal")}
          chip={prayerCount > 0 ? { text: `${prayerCount} · ${answeredCount} answered`, bg: "#FEE2E2", fg: "#B91C1C" } : { text: "Private", bg: palette.mutedBg, fg: palette.ink600 }}
        >
          {latestPrayer ? (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>
              {snippet(latestPrayer.title ?? latestPrayer.body, 110)}
            </T>
          ) : (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Pour out your heart — kept private to you.</T>
          )}
        </PreviewCard>

        {/* Verse library — latest saved + count */}
        <PreviewCard
          label="Verse library"
          Icon={Library}
          tint="#E0F2FE"
          fg="#0369A1"
          onPress={() => nav.navigate("VerseLibrary")}
          chip={savedVerses && savedVerses.length > 0 ? { text: `${savedVerses.length} saved`, bg: "#E0F2FE", fg: "#0369A1" } : undefined}
        >
          {savedLatest ? (
            <>
              <T variant="micro" tone="gold" style={{ marginTop: 2 }}>{savedLatest.reference}</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 3 }} numberOfLines={2}>{snippet(savedLatest.verse_text ?? savedLatest.note, 100)}</T>
            </>
          ) : (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Save the verses that speak to you.</T>
          )}
        </PreviewCard>

        {/* Resources — a featured item + count */}
        <PreviewCard
          label="Resources"
          Icon={BookMarked}
          tint="#DBEAFE"
          fg="#1D4ED8"
          onPress={() => nav.navigate("Resources")}
          chip={featured ? { text: featured.kind, bg: "#DBEAFE", fg: "#1D4ED8" } : undefined}
        >
          {featured ? (
            <>
              <T variant="heading" style={{ fontSize: 14, marginTop: 2 }} numberOfLines={1}>{featured.title}</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 3 }} numberOfLines={1}>
                {[featured.author, featured.duration_label].filter(Boolean).join(" · ") || "Tap to browse"}
              </T>
            </>
          ) : (
            <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>Books, audio and video to go deeper.</T>
          )}
        </PreviewCard>
      </View>
    </ScrollView>
  );
}

function niceDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

/** A compact, half-width preview for a 2-up row: icon + chip on top, label, body. */
function TwoUpCard({
  label,
  Icon,
  tint,
  fg,
  onPress,
  chip,
  children,
}: {
  label: string;
  Icon: LucideIcon;
  tint: string;
  fg: string;
  onPress: () => void;
  chip?: { text: string; bg: string; fg: string } | undefined;
  children: ReactNode;
}): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [st.twoUp, pressed && { opacity: 0.88 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <View style={[st.previewIcon, { backgroundColor: tint }]}>
          <Icon size={18} color={fg} />
        </View>
        {chip ? (
          <View style={[st.chip, { backgroundColor: chip.bg }]}>
            <T variant="micro" style={{ color: chip.fg, fontWeight: "700" }}>{chip.text}</T>
          </View>
        ) : null}
      </View>
      <T variant="micro" style={{ color: fg, fontWeight: "700", letterSpacing: 1.1, marginTop: spacing.sm }} numberOfLines={1}>
        {label.toUpperCase()}
      </T>
      {children}
    </Pressable>
  );
}

/** A rich, tappable preview card: icon tile + label (+ optional right chip), and
 *  a body that previews the live state of the destination page. */
function PreviewCard({
  label,
  Icon,
  tint,
  fg,
  onPress,
  chip,
  accent,
  children,
}: {
  label: string;
  Icon: LucideIcon;
  tint: string;
  fg: string;
  onPress: () => void;
  chip?: { text: string; bg: string; fg: string } | undefined;
  accent?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [st.previewCard, accent && st.previewAccent, pressed && { opacity: 0.88 }]}
    >
      <View style={[st.previewIcon, { backgroundColor: tint }]}>
        <Icon size={18} color={fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <T variant="micro" style={{ color: fg, fontWeight: "700", letterSpacing: 1.1, flex: 1 }} numberOfLines={1}>
            {label.toUpperCase()}
          </T>
          {chip ? (
            <View style={[st.chip, { backgroundColor: chip.bg }]}>
              <T variant="micro" style={{ color: chip.fg, fontWeight: "700" }}>{chip.text}</T>
            </View>
          ) : null}
        </View>
        {children}
      </View>
      <ChevronRight size={18} color={palette.ink300} style={{ alignSelf: "center" }} />
    </Pressable>
  );
}

/** A vibrant per-level card. Unlocked → tappable with progress; locked → keeps
 *  its colour (dimmed) with a padlock and the unlock hint. §1.9 hard-lock. */
function LevelCard({
  level,
  currentLevel,
  isActive,
  onPress,
}: {
  level: PathwayLevel;
  currentLevel: number;
  isActive: boolean;
  onPress: () => void;
}): ReactElement {
  const accent = LEVEL_ACCENTS[(level.level_number - 1) % LEVEL_ACCENTS.length] ?? LEVEL_ACCENTS[0];
  const completed = level.status === "completed";
  const locked = isLevelLocked(level.level_number, currentLevel, level.status);
  const pct = level.total_modules > 0 ? Math.round((level.completed_modules / level.total_modules) * 100) : 0;
  return (
    <Pressable
      onPress={locked ? undefined : onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityState={{ disabled: locked }}
      accessibilityLabel={
        locked ? `Level ${level.level_number}: ${level.title}, locked. ${lockedLevelLabel(currentLevel)}` : `Level ${level.level_number}: ${level.title}`
      }
      style={({ pressed }) => [
        st.levelCard,
        isActive && { borderColor: accent.bar, backgroundColor: "#FFFDF7" },
        locked && { opacity: 0.74 },
        pressed && !locked && { opacity: 0.9 },
      ]}
    >
      <View style={[st.levelBar, { backgroundColor: accent.bar }]} />
      <View style={[st.levelBadge, { backgroundColor: accent.tint }]}>
        {locked ? (
          <Lock size={18} color={accent.fg} />
        ) : completed ? (
          <Check size={18} color={accent.fg} />
        ) : (
          <T serif style={{ fontSize: 17, color: accent.fg }}>{level.level_number}</T>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="micro" style={{ color: accent.fg, fontWeight: "700", letterSpacing: 1.1 }} numberOfLines={1}>
          {`LEVEL ${level.level_number}${level.theme ? ` · ${level.theme}` : ""}`}
        </T>
        <T variant="heading" style={{ fontSize: 15, marginTop: 1 }} numberOfLines={1}>{level.title}</T>
        {level.description ? (
          <T variant="caption" tone="secondary" style={{ marginTop: 4, lineHeight: 18 }} numberOfLines={2}>{level.description}</T>
        ) : null}
        {locked ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
            <Lock size={11} color={palette.ink400} />
            <T variant="micro" tone="tertiary">{lockedLevelLabel(currentLevel)}</T>
          </View>
        ) : (
          <>
            <View style={[st.miniTrack, { marginTop: 8 }]}>
              <View style={{ width: `${pct}%`, height: "100%", borderRadius: 2, backgroundColor: accent.bar }} />
            </View>
            <T variant="micro" tone="tertiary" style={{ marginTop: 5 }}>
              {`${level.completed_modules} of ${level.total_modules} modules · ${pct}%`}
            </T>
          </>
        )}
      </View>
      {locked ? (
        <View style={st.lockPill}>
          <Lock size={13} color={palette.ink400} />
        </View>
      ) : completed ? (
        <View style={[st.lockPill, { backgroundColor: palette.successBg }]}>
          <Check size={13} color={palette.successText} />
        </View>
      ) : (
        <ChevronRight size={18} color={accent.fg} style={{ alignSelf: "center" }} />
      )}
    </Pressable>
  );
}

/** A real Bible-study photo with a scripture overlay — placed after Level 3. */
function BibleStudyBanner({ onPress }: { onPress: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Study the Word — open reading plans" onPress={onPress} style={({ pressed }) => [st.banner, pressed && { opacity: 0.92 }]}>
      <Image source={{ uri: BIBLE_STUDY_IMG }} style={st.bannerImg} resizeMode="cover" />
      <View style={st.bannerShade} />
      <View style={st.bannerBody}>
        <T variant="micro" tone="gold" style={{ letterSpacing: 1.6, fontWeight: "800" }}>GO DEEPER</T>
        <T serif tone="onNavy" style={{ fontSize: 19, lineHeight: 24, marginTop: 3 }}>Study the Word together</T>
        <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }} numberOfLines={2}>
          “Be diligent… a worker who correctly handles the word of truth.” — 2 Timothy 2:15
        </T>
      </View>
    </Pressable>
  );
}

/** An in-app ad promoting the Pathway app — placed after Level 6. */
function PathwayAdBanner(): ReactElement {
  return (
    <View style={st.adCard} accessibilityRole="image" accessibilityLabel="Nuru Pathway — your discipleship journey">
      <GradientBg colors={[palette.navyDeep, palette.navy, palette.navy700]} radius={radii.card} />
      <View style={st.adRow}>
        <View style={st.adMark}>
          <Sparkles size={24} color={palette.gold} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="micro" tone="gold" style={{ letterSpacing: 1.6, fontWeight: "800" }}>NURU PATHWAY</T>
          <T serif tone="onNavy" style={{ fontSize: 19, lineHeight: 24, marginTop: 2 }}>Keep growing, every day</T>
        </View>
      </View>
      <T variant="caption" tone="onNavyDim" style={{ marginTop: spacing.sm }}>
        Devotionals, your levels, prayer, and your church family — all in one place. Invite a friend to walk the journey with you.
      </T>
      <View style={st.adPill}>
        <T variant="micro" style={{ color: palette.navyDeep, fontWeight: "800", letterSpacing: 0.4 }}>YOUR JOURNEY, EVERY DAY</T>
      </View>
    </View>
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
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs },
  sectionLabel: { color: palette.goldLo, fontWeight: "700", letterSpacing: 2 },
  streakChip: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
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
  previewCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  previewAccent: { borderColor: "rgba(201,162,39,0.45)", backgroundColor: palette.verseBg },
  twoUp: {
    flex: 1,
    minHeight: 132,
    backgroundColor: palette.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  giftsFeature: { height: 168, borderRadius: radii.card, overflow: "hidden", justifyContent: "flex-end", backgroundColor: palette.navy, ...shadow.card },
  giftsImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  giftsShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(28,16,54,0.58)" },
  giftsBody: { padding: spacing.base },
  giftsCta: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: spacing.md, backgroundColor: palette.gold, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 7 },
  previewIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  chip: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  giftChip: { backgroundColor: "#F3E8FF", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  miniTrack: { height: 4, borderRadius: 2, backgroundColor: palette.track, overflow: "hidden" },
  levelCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: spacing.md,
    paddingRight: spacing.base,
    paddingLeft: spacing.base + 6,
    overflow: "hidden",
    ...shadow.card,
  },
  levelBar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 5 },
  levelBadge: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  lockPill: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.mutedBg, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  banner: { height: 150, borderRadius: radii.card, overflow: "hidden", justifyContent: "flex-end", backgroundColor: palette.navy, marginVertical: 2, ...shadow.card },
  bannerImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  bannerShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.5)" },
  bannerBody: { padding: spacing.base },
  adCard: { borderRadius: radii.card, overflow: "hidden", padding: spacing.base, marginVertical: 2, backgroundColor: palette.navyDeep, ...shadow.card },
  adRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  adMark: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(201,162,39,0.16)", alignItems: "center", justifyContent: "center" },
  adPill: { alignSelf: "flex-start", marginTop: spacing.md, backgroundColor: palette.gold, borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6 },
} as const;
