// Home (new design, spec §1 — docs/MOBILE_DESIGN_SPEC.md). The warm daily
// anchor: navy header (serif greeting, EAT date, bell with unread badge,
// level status chip), featured welcome video, the real resume card, today's
// rhythm with streak, progress snapshot, story card, upcoming events, the
// verse for today (WEB default per D-M4), encouragement, and announcements —
// real data wherever the API serves it; spec demo content elsewhere.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";
import {
  BadgeCheck,
  Bell,
  BookMarked,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Flame,
  HandCoins,
  HandHeart,
  Heart,
  MapPin,
  Megaphone,
  MessageSquareText,
  Play,
  Quote,
  Share2,
  Sparkles,
  Sun,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { T } from "../theme/components";
import {
  useAchievements,
  useCalendar,
  useFeaturedCell,
  useDisciplers,
  useRhythmToday,
  useMentor,
  useFeaturedEvent,
  useFeaturedAnnouncement,
  useCellSummary,
  useScores,
  useNextAction,
  useDailyGreeting,
  usePrayerWallHome,
  usePlans,
  usePrayers,
  useMe,
  useMyAnnouncements,
  useNotifications,
  usePathway,
  useScripture,
  useWelcomeVideo,
} from "../api/hooks";
import type { ContentReaction, WelcomeVideo, NextAction } from "../api/types";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { VideoPlayer } from "../components/VideoPlayer";
import { ShareToChatSheet } from "../components/ShareToChatSheet";
import { DisciplerCarousel } from "../components/DisciplerCarousel";
import { PrayerWallCarousel } from "../components/PrayerWallCarousel";
import { FitImage } from "../components/FitImage";
import { Avatar } from "../components/Avatar";

// Emoji reactions on the home video (❤️ is the dedicated Like; these are extras).
const VIDEO_EMOJIS = ["🙏", "🔥", "🎉", "👏"];
const SOCIAL_BTN = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white };
const EMOJI_BTN = { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white };

function todayKicker(): string {
  const d = new Date();
  const date = d
    .toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    .toUpperCase()
    .replace(",", " ·");
  return `${date} · EAT`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(full?: string | null): string {
  return (full ?? "Friend").trim().split(/\s+/)[0] ?? "Friend";
}

function nextGatheringLabel(startIso: string, location: string | null): string {
  const date = new Date(startIso).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });
  return location ? `${date} · ${location}` : date;
}

function heroAccent(accent: "gold" | "navy" | "success" | "steady"): string {
  return accent === "success" ? palette.success : accent === "steady" ? palette.steady : accent === "navy" ? palette.goldGlow : palette.gold;
}

// The playable URL for the welcome video. External sources (youtube/vimeo/
// direct/private) carry a shareable external_url; hosted (cloudinary) carries a
// signed delivery url. Fed to the inline VideoPlayer and the share-to-chat sheet.
function welcomeVideoUrl(v: WelcomeVideo): string | null {
  if ("external_url" in v) return v.external_url;
  return v.url;
}

// "Grow your faith" quick-access grid → the growth screens (D5/B9). Matches the
// Figma HomeTab tools row (6 tiles + discipler).
const GROW: Array<{ label: string; sub: string; route: "Devotional" | "ReadingPlans" | "PrayerJournal" | "PrayerWall" | "MemoryVerses" | "Gifts" | "Resources"; Icon: LucideIcon; tint: string; fg: string }> = [
  { label: "Devotional", sub: "Today's devotional", route: "Devotional", Icon: Sun, tint: "#FFF4DA", fg: palette.goldLo },
  { label: "Reading plan", sub: "Continue your plan", route: "ReadingPlans", Icon: BookMarked, tint: "#EEF2FF", fg: "#6366F1" },
  { label: "Memory verses", sub: "Practice & master", route: "MemoryVerses", Icon: Quote, tint: "#FFF4DA", fg: palette.goldLo },
  { label: "Spiritual gifts", sub: "Take assessment", route: "Gifts", Icon: Sparkles, tint: "#F3E8FF", fg: "#A855F7" },
];

// Placeholder story image (Figma "This week at Nuru"); shown only when no real
// featured cell is set.
const STORY_PHOTO = "https://images.unsplash.com/photo-1735968664648-a0df97339343?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=80&w=1080";
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

const RHYTHM: Array<{ key: "prayer" | "word" | "reflection"; label: string }> = [
  { key: "prayer", label: "Prayer" },
  { key: "word", label: "Word" },
  { key: "reflection", label: "Reflection" },
];

export function HomeDashboardScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway, isLoading, error, refetch } = usePathway();
  const { data: me, refetch: refetchMe } = useMe();
  const { data: achievements, refetch: refetchAch } = useAchievements();
  const { data: notifications, refetch: refetchNotifs } = useNotifications();
  const { data: announcements, refetch: refetchAnnouncements } = useMyAnnouncements();
  const { width: winW } = useWindowDimensions();
  const annSlideW = winW - spacing.screen * 2; // one full-width announcement card per page
  const { data: verse } = useScripture("Psalm 119:105");
  const { data: welcomeVideo, refetch: refetchWelcomeVideo } = useWelcomeVideo();
  const { data: featuredCell, refetch: refetchFeaturedCell } = useFeaturedCell();
  const { data: rhythmServer } = useRhythmToday();
  const { data: mentorInfo } = useMentor();
  const { data: disciplers } = useDisciplers();
  const { data: wallPosts } = usePrayerWallHome();
  const { data: plans } = usePlans();
  const { data: prayers } = usePrayers();
  const discipler = mentorInfo?.mentor ?? null;
  const plan = plans?.find((p) => p.enrolled) ?? plans?.[0] ?? null;
  const planDone = plan?.completed_days?.length ?? 0;
  const planPct = plan && plan.day_count > 0 ? Math.round((planDone / plan.day_count) * 100) : 0;
  const prayerCount = prayers?.length ?? 0;
  const answeredCount = prayers?.filter((p) => p.is_answered).length ?? 0;
  const latestPrayer = prayers?.[0] ?? null;
  const { data: featuredEvent, refetch: refetchFeaturedEvent } = useFeaturedEvent();
  const { data: featuredAnnouncement, refetch: refetchFeaturedAnnouncement } = useFeaturedAnnouncement();
  const { data: cellSummary } = useCellSummary();
  const { data: scores } = useScores();
  const { data: nextAction } = useNextAction();
  const { data: dailyGreeting } = useDailyGreeting();
  const [refreshing, setRefreshing] = useState(false);

  // Home video social state (❤️ Like / emoji reactions / share), seeded from the
  // server payload then updated optimistically from the toggle response.
  const [react, setReact] = useState<{ reactions: ContentReaction[]; love_count: number; liked: boolean }>({ reactions: [], love_count: 0, liked: false });
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    if (welcomeVideo) setReact({ reactions: welcomeVideo.reactions ?? [], love_count: welcomeVideo.love_count ?? 0, liked: !!welcomeVideo.liked });
  }, [welcomeVideo]);
  const reactionFor = useCallback((emoji: string): ContentReaction | undefined => react.reactions.find((r) => r.emoji === emoji), [react]);
  const toggleVideoReaction = useCallback(async (emoji: string): Promise<void> => {
    if (!welcomeVideo) return;
    try {
      const res = await NuruApi.toggleMediaReaction(welcomeVideo.media_asset_id, emoji);
      setReact({ reactions: res.reactions, love_count: res.love_count, liked: res.liked });
    } catch { /* best-effort, like chat reactions */ }
  }, [welcomeVideo]);

  // Pull-to-refresh re-pulls every Home data source from the backend.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        refetchMe(),
        refetchAch(),
        refetchNotifs(),
        refetchAnnouncements(),
        refetchWelcomeVideo(),
        refetchFeaturedCell(),
        refetchFeaturedEvent(),
        refetchFeaturedAnnouncement(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchMe, refetchAch, refetchNotifs, refetchAnnouncements, refetchWelcomeVideo, refetchFeaturedCell, refetchFeaturedEvent, refetchFeaturedAnnouncement]);
  const [fromIso, toIso] = useMemo(() => {
    const now = new Date();
    // 30-day window so the "next gathering" fallback can look beyond this week.
    return [now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString()];
  }, []);
  const { data: occurrences } = useCalendar(fromIso, toIso);

  // Today's rhythm — seeded from the server (interaction_events, EAT day) and
  // completed by a real action: tapping a tile records it (prayer), and Word /
  // Reflection also tick organically (opening the devotional / saving a reflection).
  const [rhythm, setRhythm] = useState<Record<string, boolean>>({ prayer: false, word: false, reflection: false });
  useEffect(() => {
    if (rhythmServer) setRhythm({ prayer: rhythmServer.prayer, word: rhythmServer.word, reflection: rhythmServer.reflection });
  }, [rhythmServer]);
  const rhythmDone = RHYTHM.filter((r) => rhythm[r.key]).length;
  async function markRhythm(kind: "prayer" | "word" | "reflection"): Promise<void> {
    if (rhythm[kind]) return; // already done today (completions are one-way)
    setRhythm((p) => ({ ...p, [kind]: true })); // optimistic
    try {
      const next = await NuruApi.completeRhythm(kind);
      setRhythm({ prayer: next.prayer, word: next.word, reflection: next.reflection });
    } catch { setRhythm((p) => ({ ...p, [kind]: false })); }
  }

  // Server-driven hero → screen. The mapping is the only client-side knowledge;
  // the server decides WHICH action, the client just knows how to navigate each.
  function goAction(a: NextAction): void {
    switch (a.route) {
      case "module":
        if (a.params?.moduleId) nav.navigate("Module", { moduleId: a.params.moduleId });
        else nav.navigate("Tabs", { screen: "Pathway" });
        break;
      case "pathway": nav.navigate("Tabs", { screen: "Pathway" }); break;
      case "events": nav.navigate("Tabs", { screen: "Events" }); break;
      case "prayer": nav.navigate("PrayerJournal"); break;
      case "memoryVerses": nav.navigate("MemoryVerses"); break;
      case "devotional": nav.navigate("Devotional"); break;
      case "none": break;
    }
  }

  if (isLoading) {
    return (
      <View style={[st.screen, st.center]}>
        <Loading label="Loading your dashboard…" />
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

  const active =
    pathway.levels.find((l) => l.status === "active") ??
    pathway.levels.find((l) => l.level_number === pathway.current_level) ??
    pathway.levels[0];
  const activePct = active && active.total_modules > 0 ? Math.round((active.completed_modules / active.total_modules) * 100) : 0;
  const totalModules = pathway.levels.reduce((s, l) => s + l.total_modules, 0);
  const doneModules = pathway.levels.reduce((s, l) => s + l.completed_modules, 0);
  const overallPct = totalModules > 0 ? Math.round((doneModules / totalModules) * 100) : 0;
  const streak = achievements?.streak?.current ?? 0;
  const unread = notifications?.unread ?? 0;
  const modulesLeft = active ? active.total_modules - active.completed_modules : 0;
  // Real attendance from the member's cell summary (§ cell-summary).
  const cell = cellSummary?.cell ?? null;
  const attendancePct = cell && cell.attendance.expected > 0 ? Math.round((cell.attendance.attended / cell.attendance.expected) * 100) : 0;
  const habitsPct = Math.round((rhythmDone / 3) * 100);
  // Show the welcome-video card only when one is set AND it resolves to an
  // openable link (hosted videos with no key come back as url:null).
  const welcomeUrl = welcomeVideo ? welcomeVideoUrl(welcomeVideo) : null;

  const openAnnouncement = (id: string, title?: string): void => {
    void NuruApi.openAnnouncement(id)
      .then(() => {
        invalidateQueries("myAnnouncements");
        void refetchAnnouncements();
      })
      .catch(() => undefined);
    nav.navigate("AnnouncementDetail", { announcementId: id, ...(title ? { title } : {}) });
  };

  return (
    <ScrollView
      style={st.screen}
      contentContainerStyle={{ paddingBottom: tabBarSpace }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
    >
      {/* ── Navy header ─────────────────────────────────────────────── */}
      <View style={st.header}>
        {/* Row 1 — date · notifications */}
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <T variant="micro" tone="gold" style={[st.kicker, { flex: 1 }]}>{todayKicker()}</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => nav.navigate("Notifications")}
            style={({ pressed }) => [st.bellBtn, pressed && { transform: [{ scale: 0.95 }] }]}
          >
            <Bell size={20} color={palette.onNavy} strokeWidth={1.8} />
            {unread > 0 ? (
              <View style={st.bellBadge}>
                <T variant="micro" style={{ color: palette.navy, fontWeight: "700", fontSize: 10 }}>
                  {unread > 9 ? "9+" : String(unread)}
                </T>
              </View>
            ) : null}
          </Pressable>
        </View>

        {/* Row 2 — greeting · progress ring */}
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: spacing.lg }}>
          <View style={{ flex: 1, minWidth: 0, paddingRight: spacing.base }}>
            <T serif tone="onNavy" style={st.greeting}>{`${greeting()}, ${firstName(me?.profile?.full_name)}.`}</T>
            <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.sm, lineHeight: 21 }}>
              {dailyGreeting?.greeting ?? "Grace for today's step."}
            </T>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Pathway progress ${overallPct}%`}
            onPress={() => nav.navigate("Tabs", { screen: "Pathway" })}
            style={({ pressed }) => [st.ring, pressed && { opacity: 0.85 }]}
          >
            <T serif tone="onNavy" style={{ fontSize: 17 }}>{`${overallPct}%`}</T>
            <T variant="micro" tone="onNavyFaint" style={{ fontSize: 8, letterSpacing: 1.2 }}>DONE</T>
          </Pressable>
        </View>

        {active ? (
          <View style={st.statusChip}>
            <T variant="caption" style={{ color: palette.goldGlow, fontWeight: "600" }}>
              {`Level ${active.level_number} · ${active.completed_modules} of ${active.total_modules} modules · ${streak}d streak`}
            </T>
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
        {/* ── Next best action (server-driven hero, personal to this member) ── */}
        {nextAction?.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={nextAction.action.title}
            onPress={() => goAction(nextAction.action as NextAction)}
            style={({ pressed }) => [st.heroCard, pressed && { opacity: 0.94 }]}
          >
            <View style={[st.heroAccent, { backgroundColor: heroAccent(nextAction.action.accent) }]} />
            <View style={{ flex: 1 }}>
              <T variant="micro" style={{ color: palette.goldGlow, fontWeight: "700", letterSpacing: 1.4 }}>FOR YOU TODAY</T>
              <T serif tone="onNavy" style={{ fontSize: 19, marginTop: 4 }}>{nextAction.action.title}</T>
              <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>{nextAction.action.body}</T>
              <View style={st.heroCta}>
                <T variant="caption" style={{ color: palette.navyDeep, fontWeight: "800" }}>{nextAction.action.cta_label}</T>
                <ChevronRight size={14} color={palette.navyDeep} />
              </View>
            </View>
          </Pressable>
        ) : null}

        {/* ── Featured welcome video (real, PR #120; hidden when none set) ── */}
        {welcomeVideo && welcomeUrl ? (
          <View style={st.featuredCard}>
            <View style={st.channelRow}>
              <View style={st.channelAvatar}>
                <T variant="micro" style={{ color: palette.gold, fontWeight: "700" }}>N</T>
              </View>
              <T variant="caption" style={{ fontWeight: "600" }}>Nuru Pathway</T>
              <BadgeCheck size={14} color={palette.gold} />
              <View style={{ flex: 1 }} />
              <T variant="micro" tone="tertiary" style={{ letterSpacing: 1.2 }}>FEATURED</T>
            </View>
            {/* Inline playback (react-native-video); poster = thumbnail when set. */}
            <VideoPlayer uri={welcomeUrl} poster={welcomeVideo.thumbnail_url ?? null} height={200} radius={16} />
            <T variant="heading" style={{ marginTop: spacing.md, fontSize: 17 }}>Welcome to the Pathway</T>
            {welcomeVideo.caption ? (
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{welcomeVideo.caption}</T>
            ) : (
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>Start here — what the journey looks like</T>
            )}
            {/* ❤️ Like · emoji reactions (with counts) · Share to chat — X-style. */}
            <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={react.liked ? "Unlike" : "Like"}
                onPress={() => void toggleVideoReaction("❤️")}
                style={[SOCIAL_BTN, react.liked ? { backgroundColor: "#FDE7EA", borderColor: "#F5C2C7" } : null]}
              >
                <Heart size={16} color={react.liked ? palette.error : palette.ink600} fill={react.liked ? palette.error : "transparent"} />
                <T variant="caption" style={{ fontWeight: "600", color: react.liked ? palette.error : palette.ink600 }}>
                  {react.love_count > 0 ? String(react.love_count) : "Like"}
                </T>
              </Pressable>
              {VIDEO_EMOJIS.map((e) => {
                const r = reactionFor(e);
                return (
                  <Pressable
                    key={e}
                    accessibilityRole="button"
                    accessibilityLabel={`React ${e}`}
                    onPress={() => void toggleVideoReaction(e)}
                    style={[EMOJI_BTN, r?.mine ? { borderColor: palette.gold, backgroundColor: palette.goldChipBg } : null]}
                  >
                    <T variant="caption">{e}{r && r.count > 0 ? ` ${r.count}` : ""}</T>
                  </Pressable>
                );
              })}
              <View style={{ flex: 1 }} />
              <Pressable accessibilityRole="button" accessibilityLabel="Share" onPress={() => setShareOpen(true)} style={SOCIAL_BTN}>
                <Share2 size={16} color={palette.ink600} />
                <T variant="caption" style={{ fontWeight: "600", color: palette.ink600 }}>Share</T>
              </Pressable>
            </View>
          </View>
        ) : null}
        {shareOpen && welcomeVideo && welcomeUrl ? (
          <ShareToChatSheet videoUrl={welcomeUrl} caption={welcomeVideo.caption} onClose={() => setShareOpen(false)} />
        ) : null}

        {/* ── Verse for today (moved up: right after the intro video, D-M4) ── */}
        <View style={st.verseCard}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <BookOpen size={13} color={palette.goldChipText} />
            <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>
              VERSE FOR TODAY
            </T>
            <View style={{ flex: 1 }} />
            <View style={st.versionPill}>
              <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>{verse?.version ?? "WEB"} ▾</T>
            </View>
          </View>
          <T serif style={{ fontSize: 18, lineHeight: 27, color: palette.ink, marginTop: spacing.md }}>
            {verse?.text ?? "“Your word is a lamp to my feet, and a light for my path.”"}
          </T>
          <T variant="caption" tone="secondary" style={{ marginTop: spacing.sm, fontWeight: "500" }}>
            {`${verse?.reference ?? "Psalm 119:105"} · ${verse?.version ?? "WEB"}`}
          </T>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            <Pressable onPress={() => nav.navigate("VerseLibrary")} style={st.versePillBtn}>
              <Heart size={13} color={palette.ink600} />
              <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>Save</T>
            </Pressable>
            <View style={st.versePillBtn}>
              <Share2 size={13} color={palette.ink600} />
              <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>Share</T>
            </View>
          </View>
        </View>

        {/* ── Prayer Wall (public requests, auto-advancing) ──────────── */}
        {wallPosts && wallPosts.length > 0 ? (
          <PrayerWallCarousel
            posts={wallPosts}
            onOpen={(postId) => nav.navigate("PrayerWallDetail", { postId })}
            onSeeAll={() => nav.navigate("PrayerWall")}
          />
        ) : null}

        {/* ── Reading plan + Prayer journal (moved up: before This week) ─ */}
        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reading plan"
            onPress={() => (plan ? nav.navigate("PlanDetail", { planId: plan.plan_id, title: plan.title }) : nav.navigate("ReadingPlans"))}
            style={({ pressed }) => [st.homeMini, pressed && { opacity: 0.9 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={[st.homeMiniIcon, { backgroundColor: "#E0E7FF" }]}><BookOpen size={18} color="#4338CA" /></View>
              {plan?.enrolled ? <View style={[st.homeChip, { backgroundColor: "#E0E7FF" }]}><T variant="micro" style={{ color: "#4338CA", fontWeight: "700" }}>{`${planPct}%`}</T></View> : null}
            </View>
            <T variant="micro" style={{ color: "#4338CA", fontWeight: "700", letterSpacing: 1.1, marginTop: spacing.sm }}>READING PLAN</T>
            <T variant="heading" style={{ fontSize: 14, marginTop: 2 }} numberOfLines={2}>{plan?.title ?? "Read through Scripture"}</T>
            {plan?.enrolled ? (
              <>
                <View style={[st.miniTrack, { marginTop: 8 }]}><View style={{ width: `${planPct}%`, height: "100%", borderRadius: 2, backgroundColor: "#6366F1" }} /></View>
                <T variant="micro" tone="tertiary" style={{ marginTop: 6 }}>{`Day ${plan.current_day ?? planDone + 1} of ${plan.day_count}`}</T>
              </>
            ) : (
              <T variant="micro" tone="tertiary" style={{ marginTop: 4 }} numberOfLines={1}>{plans && plans.length > 0 ? `${plans.length} plans to start` : "Start a guided plan"}</T>
            )}
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Prayer journal"
            onPress={() => nav.navigate("PrayerJournal")}
            style={({ pressed }) => [st.homeMini, pressed && { opacity: 0.9 }]}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={[st.homeMiniIcon, { backgroundColor: "#FEE2E2" }]}><HandHeart size={18} color="#B91C1C" /></View>
              <View style={[st.homeChip, { backgroundColor: prayerCount > 0 ? "#FEE2E2" : palette.mutedBg }]}>
                <T variant="micro" style={{ color: prayerCount > 0 ? "#B91C1C" : palette.ink600, fontWeight: "700" }}>{prayerCount > 0 ? `${answeredCount} answered` : "Private"}</T>
              </View>
            </View>
            <T variant="micro" style={{ color: "#B91C1C", fontWeight: "700", letterSpacing: 1.1, marginTop: spacing.sm }}>PRAYER JOURNAL</T>
            {latestPrayer ? (
              <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>{latestPrayer.title ?? latestPrayer.body}</T>
            ) : (
              <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>Pour out your heart — private to you.</T>
            )}
          </Pressable>
        </View>

        {/* ── This week at Nuru (real featured cell, PR #125; hidden when none) ── */}
        {featuredCell ? (
          <View style={[st.card, { padding: 0, overflow: "hidden" }]}>
            {featuredCell.image_url ? (
              <FitImage uri={featuredCell.image_url} />
            ) : null}
            <View style={{ padding: spacing.base }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Users size={13} color={palette.goldChipText} />
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>
                THIS WEEK AT NURU
              </T>
            </View>
            <T serif style={{ fontSize: 18, color: palette.ink, marginTop: spacing.md }}>{featuredCell.name}</T>
            {featuredCell.discipler_name ? (
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                {featuredCell.discipler_role
                  ? `${featuredCell.discipler_name} · ${featuredCell.discipler_role}`
                  : featuredCell.discipler_name}
              </T>
            ) : null}
            {featuredCell.focus || featuredCell.level_label ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
                {featuredCell.focus ? (
                  <View style={st.weekChip}>
                    <Target size={12} color={palette.goldLo} />
                    <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>{featuredCell.focus}</T>
                  </View>
                ) : null}
                {featuredCell.level_label ? (
                  <View style={st.weekChip}>
                    <Sparkles size={12} color={palette.goldLo} />
                    <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>{featuredCell.level_label}</T>
                  </View>
                ) : null}
              </View>
            ) : null}
            {featuredCell.meets || featuredCell.next_session ? (
              <View style={st.weekMeetRow}>
                <View style={st.weekMeetTile}>
                  <CalendarClock size={14} color={palette.goldLo} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {featuredCell.meets ? (
                    <T variant="caption" style={{ fontWeight: "600", color: palette.ink }}>{featuredCell.meets}</T>
                  ) : null}
                  {featuredCell.next_session ? (
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{`Next: ${featuredCell.next_session}`}</T>
                  ) : null}
                </View>
              </View>
            ) : null}
            {/* Room + members detail row */}
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
              {featuredCell.room ? (
                <View style={st.weekChip}>
                  <MapPin size={12} color={palette.goldLo} />
                  <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>{featuredCell.room}</T>
                </View>
              ) : null}
              <View style={st.weekChip}>
                <Users size={12} color={palette.goldLo} />
                <T variant="micro" style={{ fontWeight: "600", color: palette.ink600 }}>
                  {`${featuredCell.members} ${featuredCell.members === 1 ? "member" : "members"}`}
                </T>
              </View>
            </View>
            </View>
          </View>
        ) : null}

        {/* ── Meet your discipler (auto-advancing carousel) ──────────── */}
        {disciplers && disciplers.length > 0 ? <DisciplerCarousel disciplers={disciplers} /> : null}

        {/* ── Featured event (homepage toggle) ───────────────────────── */}
        {featuredEvent ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              nav.navigate("EventDetail", {
                eventId: featuredEvent.series_id,
                title: featuredEvent.title,
                startAt: featuredEvent.dtstart_local,
                ...(featuredEvent.location ? { location: featuredEvent.location } : {}),
              })
            }
            style={({ pressed }) => [st.card, { padding: 0, overflow: "hidden" }, pressed && { opacity: 0.9 }]}
          >
            {featuredEvent.primary_image_url ? (
              <FitImage uri={featuredEvent.primary_image_url} />
            ) : null}
            <View style={{ padding: spacing.base }}>
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>FEATURED EVENT</T>
              <T serif style={{ fontSize: 18, color: palette.ink, marginTop: spacing.sm }}>{featuredEvent.title}</T>
              {featuredEvent.location ? <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{featuredEvent.location}</T> : null}
            </View>
          </Pressable>
        ) : null}

        {/* ── Featured announcement (homepage toggle) ────────────────── */}
        {featuredAnnouncement ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => openAnnouncement(featuredAnnouncement.announcement_id, featuredAnnouncement.title)}
            style={({ pressed }) => [st.card, { padding: 0, overflow: "hidden" }, pressed && { opacity: 0.9 }]}
          >
            {featuredAnnouncement.primary_image_url ? (
              <FitImage uri={featuredAnnouncement.primary_image_url} />
            ) : null}
            <View style={{ padding: spacing.base }}>
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>FEATURED ANNOUNCEMENT</T>
              <T serif style={{ fontSize: 18, color: palette.ink, marginTop: spacing.sm }}>{featuredAnnouncement.title}</T>
              {featuredAnnouncement.body ? (
                <T variant="body" tone="secondary" style={{ marginTop: 6 }} numberOfLines={3}>{featuredAnnouncement.body}</T>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md }}>
                {featuredAnnouncement.sent_at ? (
                  <T variant="micro" tone="tertiary">{new Date(featuredAnnouncement.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</T>
                ) : null}
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", marginLeft: "auto" }}>Read more ›</T>
              </View>
            </View>
          </Pressable>
        ) : null}

        {/* ── Resume card (real pathway data) ────────────────────────── */}
        {active ? (
          <View style={st.card}>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={st.resumeTile}>
                <Play size={20} color={palette.goldLo} fill={palette.goldLo} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <T variant="micro" style={st.resumeKicker}>{`CONTINUE · LEVEL ${active.level_number}`}</T>
                <T serif style={st.resumeTitle}>{active.title}</T>
                <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>
                  {`${active.completed_modules} of ${active.total_modules} modules`}
                </T>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md }}>
              <View style={st.track}>
                <View style={[st.fill, { width: `${activePct}%` }]} />
              </View>
              <T variant="caption" style={{ color: palette.goldLo, fontWeight: "600" }}>{`${activePct}% complete`}</T>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => nav.navigate("Level", { levelId: active.level_number })}
              style={({ pressed }) => [st.continueBtn, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              <T variant="heading" style={{ color: palette.goldGlow, fontSize: 15 }}>Continue ›</T>
            </Pressable>
          </View>
        ) : null}

        {/* ── Today's rhythm ─────────────────────────────────────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <T variant="heading" style={{ flex: 1, fontSize: 15 }}>
              {rhythmDone === 3 ? "Today's rhythm complete 🎉" : "Today's rhythm"}
            </T>
            <View style={st.streakChip}>
              <Flame size={12} color={palette.goldChipText} fill={palette.goldChipText} />
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "600" }}>{`${streak}-day streak`}</T>
            </View>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            {RHYTHM.map(({ key, label }) => {
              const done = rhythm[key] === true;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: done }}
                  onPress={() => void markRhythm(key)}
                  style={[st.habitTile, { backgroundColor: done ? palette.successBg : palette.goldChipBg }]}
                >
                  <View style={[st.habitDot, { backgroundColor: done ? palette.successText : palette.white }]}>
                    {done ? <Check size={12} color={palette.white} /> : <Clock size={12} color={palette.goldLo} />}
                  </View>
                  <T variant="caption" style={{ fontWeight: "600", color: done ? palette.successText : palette.goldChipText }}>
                    {label}
                  </T>
                  <T variant="micro" style={{ color: done ? palette.successText : palette.goldChipText, opacity: 0.8 }}>
                    {done ? "DONE" : "PENDING"}
                  </T>
                </Pressable>
              );
            })}
          </View>
          {!rhythm.reflection ? (
            <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm }}>
              Complete reflection to keep your rhythm.
            </T>
          ) : null}
        </View>

        {/* ── Reflection due today (when this lesson still needs one) ──── */}
        {active && !rhythm.reflection ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Level", { levelId: active.level_number })}
            style={({ pressed }) => [st.reflectBanner, pressed && { opacity: 0.92 }]}
          >
            <View style={st.reflectIcon}>
              <MessageSquareText size={16} color={palette.goldLo} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 14 }}>Reflection due today</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 1 }} numberOfLines={1}>{active.title}</T>
            </View>
            <View style={st.reflectBtn}>
              <T variant="micro" style={{ color: palette.goldGlow, fontWeight: "700" }}>Start reflection</T>
            </View>
          </Pressable>
        ) : null}

        {/* ── Your progress ──────────────────────────────────────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <T variant="heading" style={{ flex: 1, fontSize: 15 }}>Your progress</T>
            <Pressable onPress={() => nav.navigate("Tabs", { screen: "Pathway" })}>
              <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>View pathway ›</T>
            </Pressable>
          </View>
          {scores ? (
            <>
              {/* Overall ring + band, then the five growth scores as bars. The
                  numbers are server-authoritative and personal to this member. */}
              <View style={st.overallRow}>
                <View style={st.overallRing}>
                  <T serif style={{ fontSize: 24, color: palette.navyDeep }}>{scores.overall.score}</T>
                  <T variant="micro" style={{ color: palette.ink600, marginTop: -3 }}>/100</T>
                </View>
                <View style={{ flex: 1 }}>
                  <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 1.2 }}>OVERALL GROWTH</T>
                  <T variant="heading" style={{ color: palette.ink, marginTop: 1 }}>{scores.overall.band}</T>
                  <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>Your rhythm across the disciplines</T>
                </View>
              </View>
              <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                {(
                  [
                    { label: "Habits", s: scores.habits.score, fill: palette.gold },
                    { label: "Word", s: scores.word.score, fill: palette.steady },
                    { label: "Prayer", s: scores.prayer.score, fill: palette.goldLo },
                    { label: "Curriculum", s: scores.curriculum.score, fill: palette.navy },
                    { label: "Attendance", s: scores.attendance.score, fill: palette.success },
                  ] as const
                ).map((m) => (
                  <View key={m.label} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <T variant="caption" style={{ width: 86, color: palette.ink600 }}>{m.label}</T>
                    <View style={[st.miniTrack, { flex: 1, height: 8, borderRadius: 4 }]}>
                      <View style={{ width: `${m.s}%`, height: "100%", borderRadius: 4, backgroundColor: m.fill }} />
                    </View>
                    <T variant="caption" style={{ width: 30, textAlign: "right", fontWeight: "700", color: palette.ink }}>{m.s}</T>
                  </View>
                ))}
              </View>
            </>
          ) : (
            /* Fallback before scores load — the lightweight computed snapshot. */
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              {(
                [
                  { label: "Habits", value: `${habitsPct}%`, fill: palette.gold, pct: habitsPct },
                  { label: "Curriculum", value: `${overallPct}%`, fill: palette.navy, pct: overallPct },
                  { label: "Attendance", value: `${attendancePct}%`, fill: palette.success, pct: attendancePct },
                ] as const
              ).map((m) => (
                <View key={m.label} style={st.metricTile}>
                  <T serif style={{ fontSize: 22, color: palette.ink }}>{m.value}</T>
                  <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{m.label}</T>
                  <View style={[st.miniTrack, { marginTop: spacing.sm }]}>
                    <View style={{ width: `${m.pct}%`, height: "100%", borderRadius: 2, backgroundColor: m.fill }} />
                  </View>
                </View>
              ))}
            </View>
          )}
          {active && modulesLeft > 0 ? (
            <View style={st.targetStrip}>
              <View style={st.targetTile}>
                <Target size={14} color={palette.goldLo} />
              </View>
              <T variant="caption" tone="secondary">
                <T variant="caption" style={{ fontWeight: "700", color: palette.ink }}>{`${modulesLeft} module${modulesLeft === 1 ? "" : "s"}`}</T>
                {` left before Level ${active.level_number + 1}`}
              </T>
            </View>
          ) : null}
        </View>

        {/* ── Grow your faith ────────────────────────────────────────── */}
        <View style={st.card}>
          <T variant="heading" style={{ fontSize: 15, marginBottom: spacing.md }}>Grow your faith</T>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
            {GROW.map((g) => (
              <Pressable
                key={g.label}
                accessibilityRole="button"
                onPress={() => nav.navigate(g.route)}
                style={({ pressed }) => [st.growTile, pressed && { opacity: 0.9 }]}
              >
                <View style={[st.growIcon, { backgroundColor: g.tint }]}>
                  <g.Icon size={16} color={g.fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{g.label}</T>
                  <T variant="micro" tone="tertiary" numberOfLines={1}>{g.sub}</T>
                </View>
              </Pressable>
            ))}
          </View>
          {/* Your discipler → Mentor */}
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Mentor")}
            style={({ pressed }) => [st.disciplerRow, pressed && { opacity: 0.9 }]}
          >
            <Avatar uri={discipler?.avatar_url} name={discipler?.full_name} size={36} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.2 }}>YOUR DISCIPLER</T>
              <T variant="caption" style={{ fontWeight: "700", color: palette.ink, marginTop: 1 }} numberOfLines={1}>{discipler?.full_name ?? "Meet your discipler"}</T>
            </View>
            <ChevronRight size={16} color={palette.ink300} />
          </Pressable>
        </View>

        {/* ── This week at Nuru — story card (placeholder when no featured cell) ── */}
        {!featuredCell ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Tabs", { screen: "Events" })}
            style={({ pressed }) => [st.card, { padding: 0, overflow: "hidden" }, pressed && { opacity: 0.95 }]}
          >
            <FitImage uri={STORY_PHOTO} />
            <View style={{ padding: spacing.base }}>
              <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>THIS WEEK AT NURU</T>
              <T serif style={{ fontSize: 18, color: palette.ink, marginTop: spacing.sm }}>Cohort C-04's first baptisms</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 4, lineHeight: 20 }} numberOfLines={2}>
                Fourteen learners marked a new beginning on Sunday. A glimpse of grace as the journey continues.
              </T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm }}>
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700" }}>Read more</T>
                <ChevronRight size={13} color={palette.goldLo} />
              </View>
            </View>
          </Pressable>
        ) : null}

        {/* ── Upcoming — month grid + per-day events + next live (real calendar) ── */}
        <UpcomingCalendar
          occurrences={occurrences ?? []}
          onSeeAll={() => nav.navigate("Calendar")}
          onOpenEvent={(e) => nav.navigate("EventDetail", { eventId: e.occurrence_id, title: e.title, startAt: e.start_at, endAt: e.end_at, location: e.location })}
        />

        {/* ── Encouragement ──────────────────────────────────────────── */}
        <View style={st.encourageStrip}>
          <View style={st.encourageTile}>
            <Sparkles size={14} color={palette.goldLo} />
          </View>
          <T serif style={{ flex: 1, fontSize: 14, fontStyle: "italic", color: palette.ink600 }}>
            {rhythmDone === 3
              ? "Beautifully done today."
              : "You're one reflection away from completing this week's rhythm."}
          </T>
        </View>

        {/* ── Your cohort (real cell-summary where available) ──────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ minWidth: 0 }}>
              <T variant="heading" style={{ fontSize: 15 }}>Your cohort</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{cell?.name ?? "Your discipleship cell"}</T>
            </View>
            {cell?.leader ? <Avatar uri={cell.leader.avatar_url} name={cell.leader.name} size={36} /> : null}
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md }}>
            <CohortStat icon={<Users size={13} color={palette.goldLo} />} label="Leader" value={cell?.leader?.name ?? "Not assigned"} />
            <CohortStat icon={<CalendarClock size={13} color={palette.goldLo} />} label="Next gathering" value={cell?.next ? nextGatheringLabel(cell.next.start_at, cell.next.location) : "TBA"} />
            <CohortStat icon={<Sparkles size={13} color={palette.goldLo} />} label="Members" value={cell ? `${cell.members} member${cell.members === 1 ? "" : "s"}` : "—"} />
            <CohortStat icon={<Flame size={13} color={palette.goldLo} />} label="Attendance" value={cell ? `${cell.attendance.attended}/${Math.max(cell.attendance.expected, cell.attendance.attended)} this month` : "—"} />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Tabs", { screen: "Chat" })}
            style={({ pressed }) => [st.cohortBtn, pressed && { opacity: 0.9 }]}
          >
            <T variant="caption" style={{ fontWeight: "700", color: palette.ink }}>Open community ›</T>
          </Pressable>
        </View>

        {/* ── Announcements — full cards (image + key info) as a carousel ── */}
        {(announcements ?? []).length > 0 ? (
          <View>
            <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: spacing.sm }}>
              <T variant="overline" tone="gold" style={{ flex: 1 }}>ANNOUNCEMENTS</T>
              <Pressable onPress={() => nav.navigate("Tabs", { screen: "Events" })}>
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>View all ›</T>
              </Pressable>
            </View>
            <ScrollView
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              decelerationRate="fast"
              snapToInterval={annSlideW + spacing.md}
              style={{ marginHorizontal: -spacing.screen }}
              contentContainerStyle={{ paddingHorizontal: spacing.screen, gap: spacing.md }}
            >
              {(announcements ?? []).slice(0, 3).map((a) => (
                <Pressable
                  key={a.announcement_id}
                  accessibilityRole="button"
                  accessibilityLabel={a.title}
                  onPress={() => openAnnouncement(a.announcement_id, a.title)}
                  style={({ pressed }) => [st.annCard, { width: annSlideW }, pressed && { opacity: 0.92 }]}
                >
                  <View>
                    {a.primary_image_url ? (
                      <FitImage uri={a.primary_image_url} />
                    ) : (
                      <View style={[st.annCardImgWrap, { alignItems: "center", justifyContent: "center", backgroundColor: palette.navy }]}>
                        <Megaphone size={26} color={palette.gold} />
                      </View>
                    )}
                    {a.video_url ? <View style={st.annPlayBadge}><Play size={13} color="#fff" fill="#fff" /></View> : null}
                    {!a.opened ? <View style={st.annNewBadge}><T variant="micro" style={{ color: palette.navyDeep, fontWeight: "800" }}>NEW</T></View> : null}
                  </View>
                  <View style={{ padding: spacing.base }}>
                    <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{a.title}</T>
                    <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={3}>{a.body}</T>
                    <T variant="micro" tone="tertiary" style={{ marginTop: spacing.sm }}>
                      {a.sent_at ? new Date(a.sent_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : ""}
                    </T>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        ) : null}

        {/* ── Give — lead members to give (M-Pesa-first Give tab) ─────── */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Give"
          onPress={() => nav.navigate("Tabs", { screen: "Give" })}
          style={({ pressed }) => [st.giveCard, pressed && { opacity: 0.92 }]}
        >
          <View style={st.giveIcon}>
            <HandCoins size={22} color="#fff" />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" style={{ color: palette.goldChipText, fontWeight: "700", letterSpacing: 1.4 }}>GIVE</T>
            <T serif style={{ fontSize: 17, color: palette.ink, marginTop: 2 }}>Sow into the work of God</T>
            <T variant="caption" tone="secondary" style={{ marginTop: 2 }} numberOfLines={2}>Bring your tithe or offering — M-Pesa, card and more.</T>
          </View>
          <ChevronRight size={20} color={palette.ink400} />
        </Pressable>
      </View>
    </ScrollView>
  );
}

// Upcoming — Figma month-grid + per-day events, over the real calendar.
type CalOcc = { occurrence_id: string; title: string; start_at: string; end_at: string; location: string | null; primary_image_url: string | null };
function UpcomingCalendar({ occurrences, onSeeAll, onOpenEvent }: { occurrences: CalOcc[]; onSeeAll: () => void; onOpenEvent: (e: CalOcc) => void }): ReactElement {
  const today = useMemo(() => new Date(), []);
  const year = today.getFullYear();
  const month = today.getMonth();
  const monthLabel = today.toLocaleDateString("en-US", { month: "long" }).toUpperCase();
  const todayDate = today.getDate();
  const [selected, setSelected] = useState(todayDate);

  const byDay = useMemo(() => {
    const m = new Map<number, CalOcc[]>();
    for (const o of occurrences) {
      const d = new Date(o.start_at);
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        (m.get(day) ?? m.set(day, []).get(day)!).push(o);
      }
    }
    return m;
  }, [occurrences, year, month]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7; // Mon-first
  const cells: Array<number | null> = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const dayEvents = byDay.get(selected) ?? [];
  // The soonest upcoming occurrence (used to fill the TODAY slot when today is empty).
  const nextOcc = useMemo(() => {
    const now = Date.now();
    return [...occurrences]
      .filter((o) => new Date(o.start_at).getTime() >= now)
      .sort((a, b) => (a.start_at < b.start_at ? -1 : 1))[0] ?? null;
  }, [occurrences]);
  const showNextInToday = selected === todayDate && dayEvents.length === 0 && !!nextOcc;

  return (
    <View style={st.card}>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <T variant="heading" style={{ flex: 1, fontSize: 15 }}>Upcoming</T>
        <Pressable onPress={onSeeAll}><T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>See all ›</T></Pressable>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.md, marginTop: spacing.md }}>
        <View style={[st.calBox, { flex: 1.1 }]}>
          <T variant="micro" style={{ textAlign: "center", color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4, marginBottom: 4 }}>{monthLabel}</T>
          <View style={st.calRow}>
            {WEEKDAYS.map((d, i) => (<T key={`dow${i}`} variant="micro" tone="tertiary" style={st.calDow}>{d}</T>))}
          </View>
          <View style={st.calGrid}>
            {cells.map((d, idx) => {
              if (d === null) return <View key={`pad${idx}`} style={st.calCell} />;
              const isToday = d === todayDate;
              const isSel = d === selected;
              const hasEvent = byDay.has(d);
              return (
                <Pressable key={d} onPress={() => setSelected(d)} style={[st.calCell, isSel && { backgroundColor: palette.navy }, !isSel && isToday && { backgroundColor: palette.goldChipBg }]}>
                  <T variant="micro" style={{ fontWeight: "600", color: isSel ? palette.white : palette.ink }}>{d}</T>
                  {hasEvent ? <View style={[st.calDot, { backgroundColor: isSel ? palette.gold : palette.goldLo }]} /> : null}
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          {showNextInToday && nextOcc ? (
            // Nothing today → label the slot with the NEXT event's real date (not
            // "TODAY"), then list that event with its details + thumbnail.
            <>
              <T variant="micro" tone="tertiary" style={{ fontWeight: "700", letterSpacing: 0.6 }}>
                {new Date(nextOcc.start_at).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
              </T>
              <View style={{ marginTop: 6 }}>
                <CalEventMini
                  ev={nextOcc}
                  onOpen={onOpenEvent}
                  label={new Date(nextOcc.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  subtitle="Next gathering"
                />
              </View>
            </>
          ) : (
            <>
              <T variant="micro" tone="tertiary" style={{ fontWeight: "700", letterSpacing: 0.6 }}>
                {selected === todayDate ? "TODAY" : `${monthLabel.slice(0, 3)} ${selected}`}{dayEvents.length ? ` · ${dayEvents.length}` : ""}
              </T>
              {dayEvents.length === 0 ? (
                <View style={st.calEmpty}>
                  <CalendarClock size={18} color={palette.ink300} />
                  <T variant="micro" tone="tertiary" style={{ marginTop: 4 }}>No events</T>
                </View>
              ) : (
                <View style={{ gap: spacing.sm, marginTop: 6 }}>
                  {dayEvents.slice(0, 3).map((ev) => (
                    <CalEventMini
                      key={ev.occurrence_id}
                      ev={ev}
                      onOpen={onOpenEvent}
                      label={new Date(ev.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                    />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// One event row in the Upcoming card's right panel: thumbnail (when set) over
// the time/date label, title, location, and an optional italic subtitle.
function CalEventMini({ ev, onOpen, label, subtitle }: { ev: CalOcc; onOpen: (e: CalOcc) => void; label: string; subtitle?: string }): ReactElement {
  return (
    <Pressable onPress={() => onOpen(ev)} style={st.calEvent}>
      {ev.primary_image_url ? (
        <FitImage uri={ev.primary_image_url} radius={10} maxHeight={260} style={{ marginBottom: 6 }} />
      ) : null}
      <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700" }}>{label}</T>
      <T variant="caption" style={{ fontWeight: "700", color: palette.ink, marginTop: 1 }} numberOfLines={2}>{ev.title}</T>
      {ev.location ? <T variant="micro" tone="tertiary" numberOfLines={1}>{ev.location}</T> : null}
      {subtitle ? <T variant="micro" tone="tertiary" style={{ marginTop: 2, fontStyle: "italic" }}>{subtitle}</T> : null}
    </Pressable>
  );
}

function CohortStat({ icon, label, value }: { icon: ReactElement; label: string; value: string }): ReactElement {
  return (
    <View style={st.cohortStat}>
      <View style={st.cohortStatIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="micro" tone="tertiary" style={{ fontWeight: "600", letterSpacing: 0.3 }} numberOfLines={1}>{label}</T>
        <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{value}</T>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: palette.navy,
    paddingHorizontal: spacing.screen,
    paddingTop: 60,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },
  kicker: { letterSpacing: 2.4, fontWeight: "600" },
  greeting: { fontSize: 28, lineHeight: 36, fontWeight: "600" },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 5, borderColor: palette.gold, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(201,162,39,0.08)" },
  bellBtn: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: palette.gold,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  statusChip: {
    alignSelf: "flex-start",
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.55)",
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  card: {
    backgroundColor: palette.white,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  featuredCard: {
    backgroundColor: "#EEF0F3",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  channelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md },
  channelAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  thumb: { height: 170, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: palette.gold,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.6)",
  },
  resumeTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  resumeKicker: { color: palette.goldLo, fontWeight: "700", letterSpacing: 1.8 },
  resumeTitle: { fontSize: 19, color: palette.ink, marginTop: 2 },
  track: { flex: 1, height: 6, borderRadius: 3, backgroundColor: palette.track, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3, backgroundColor: palette.gold },
  continueBtn: {
    marginTop: spacing.md,
    backgroundColor: palette.navy,
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 14,
  },
  streakChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: palette.goldChipBg,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  habitTile: { flex: 1, alignItems: "center", gap: 4, borderRadius: 14, paddingVertical: spacing.md },
  habitDot: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  metricTile: { flex: 1, backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  miniTrack: { height: 4, borderRadius: 2, backgroundColor: palette.track, overflow: "hidden" },
  homeMini: { flex: 1, minHeight: 132, backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  homeMiniIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  homeChip: { borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  giveCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.goldChipBg, borderRadius: 20, borderWidth: 1, borderColor: "#F0E0B8", padding: spacing.base, ...shadow.card },
  giveIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.goldLo, alignItems: "center", justifyContent: "center" },
  heroCard: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.navyDeep, borderRadius: radii.card, padding: spacing.base, ...shadow.card },
  heroAccent: { width: 4, borderRadius: 2, alignSelf: "stretch" },
  heroCta: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", marginTop: spacing.md, backgroundColor: palette.gold, borderRadius: radii.pill, paddingVertical: 7, paddingHorizontal: 14 },
  overallRow: { flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.md },
  overallRing: { width: 68, height: 68, borderRadius: 34, borderWidth: 3, borderColor: palette.gold, alignItems: "center", justifyContent: "center", backgroundColor: palette.verseBg },
  targetStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  targetTile: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  featChip: { backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  reflectBanner: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: palette.goldChipBg, borderWidth: 1, borderColor: palette.goldTint,
    borderRadius: 18, padding: spacing.base,
  },
  reflectIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  reflectBtn: { backgroundColor: palette.navy, borderRadius: radii.pill, paddingHorizontal: spacing.base, paddingVertical: 9 },
  growTile: {
    width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md,
  },
  growIcon: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  disciplerRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border,
    borderRadius: 14, padding: spacing.md, marginTop: spacing.sm,
  },
  disciplerAvatar: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#16A34A", alignItems: "center", justifyContent: "center" },
  // Upcoming calendar grid
  calBox: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: spacing.sm },
  calRow: { flexDirection: "row" },
  calDow: { width: `${100 / 7}%`, textAlign: "center", fontSize: 9 },
  calGrid: { flexDirection: "row", flexWrap: "wrap" },
  calCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  calDot: { position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: 2 },
  calEmpty: { backgroundColor: palette.surface, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg, marginTop: 6 },
  calEvent: { backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  // Your cohort
  cohortAvatar: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: palette.white },
  cohortStat: { width: "48%", flexGrow: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  cohortStatIcon: { width: 28, height: 28, borderRadius: 8, backgroundColor: palette.white, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  weekChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: palette.surface,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  weekMeetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 14,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  weekMeetTile: { width: 28, height: 28, borderRadius: 9, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  eventRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  eventDate: { width: 46, height: 46, borderRadius: 14, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  verseCard: {
    backgroundColor: palette.verseBg,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.35)",
    padding: spacing.base,
  },
  versionPill: { backgroundColor: palette.white, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: palette.border },
  versePillBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: palette.white,
    borderRadius: radii.pill,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: palette.border,
  },
  encourageStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 16,
    padding: spacing.md,
  },
  encourageTile: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.white, alignItems: "center", justifyContent: "center", ...shadow.card },
  annRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  annCard: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  annCardImgWrap: { height: 140, backgroundColor: palette.mutedBg },
  annPlayBadge: { position: "absolute", top: 10, left: 10, width: 30, height: 30, borderRadius: 15, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  annNewBadge: { position: "absolute", top: 10, right: 10, backgroundColor: palette.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  annTile: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.tintBlue, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  cohortBtn: {
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 12,
  },
} as const;
