// Home (new design, spec §1 — docs/MOBILE_DESIGN_SPEC.md). The warm daily
// anchor: navy header (serif greeting, EAT date, bell with unread badge,
// level status chip), featured welcome video, the real resume card, today's
// rhythm with streak, progress snapshot, story card, upcoming events, the
// verse for today (WEB default per D-M4), encouragement, and announcements —
// real data wherever the API serves it; spec demo content elsewhere.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import {
  BadgeCheck,
  Bell,
  BookOpen,
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  Flame,
  Heart,
  Megaphone,
  Play,
  Share2,
  Sparkles,
  Target,
  Users,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, Glow, T } from "../theme/components";
import {
  useAchievements,
  useCalendar,
  useFeaturedCell,
  useMe,
  useMyAnnouncements,
  useNotifications,
  usePathway,
  useScripture,
  useWelcomeVideo,
} from "../api/hooks";
import type { WelcomeVideo } from "../api/types";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading, ErrorState } from "../components/states";

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

// The single link the welcome-video card opens. External sources (youtube/vimeo/
// direct/private) carry a shareable external_url; hosted (cloudinary) carries a
// signed delivery url. No video player dependency ships in the app, so both paths
// hand off to the OS via Linking.openURL (same pattern as GivingScreen).
function welcomeVideoUrl(v: WelcomeVideo): string | null {
  if ("external_url" in v) return v.external_url;
  return v.url;
}

// Human label for the source badge on the card.
function welcomeVideoSourceLabel(source: WelcomeVideo["video_source"]): string {
  if (source === "youtube") return "YouTube";
  if (source === "vimeo") return "Vimeo";
  return "Video";
}

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
  const { data: verse } = useScripture("Psalm 119:105");
  const { data: welcomeVideo, refetch: refetchWelcomeVideo } = useWelcomeVideo();
  const { data: featuredCell, refetch: refetchFeaturedCell } = useFeaturedCell();
  const [refreshing, setRefreshing] = useState(false);

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
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchMe, refetchAch, refetchNotifs, refetchAnnouncements, refetchWelcomeVideo, refetchFeaturedCell]);
  const [fromIso, toIso] = useMemo(() => {
    const now = new Date();
    return [now.toISOString(), new Date(now.getTime() + 7 * 86_400_000).toISOString()];
  }, []);
  const { data: occurrences } = useCalendar(fromIso, toIso);

  // Today's rhythm — local, device-day state (D-M5: habit check-ins are
  // last-write-wins convenience state, not server-gated progress).
  const [rhythm, setRhythm] = useState<Record<string, boolean>>({ prayer: false, word: false, reflection: false });
  const rhythmDone = RHYTHM.filter((r) => rhythm[r.key]).length;

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
  const habitsPct = Math.round((rhythmDone / 3) * 100);
  // Show the welcome-video card only when one is set AND it resolves to an
  // openable link (hosted videos with no key come back as url:null).
  const welcomeUrl = welcomeVideo ? welcomeVideoUrl(welcomeVideo) : null;

  const openAnnouncement = (id: string): void => {
    void NuruApi.openAnnouncement(id)
      .then(() => {
        invalidateQueries("myAnnouncements");
        void refetchAnnouncements();
      })
      .catch(() => undefined);
    nav.navigate("Tabs", { screen: "Community" });
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
        <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -70, top: -70 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <T variant="micro" tone="gold" style={st.kicker}>{todayKicker()}</T>
            <T serif tone="onNavy" style={st.greeting}>{`${greeting()}, ${firstName(me?.profile?.full_name)}.`}</T>
            <T variant="body" tone="onNavyDim" style={{ marginTop: 4 }}>Grace for today's step.</T>
          </View>
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
        {active ? (
          <View style={st.statusChip}>
            <T variant="caption" style={{ color: palette.goldGlow, fontWeight: "600" }}>
              {`Level ${active.level_number} · ${active.completed_modules} of ${active.total_modules} modules · ${streak}d streak`}
            </T>
          </View>
        ) : null}
      </View>

      <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
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
              <T variant="micro" tone="tertiary" style={{ letterSpacing: 1.2 }}>
                {welcomeVideoSourceLabel(welcomeVideo.video_source).toUpperCase()}
              </T>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play welcome video"
              onPress={() => void Linking.openURL(welcomeUrl).catch(() => undefined)}
              style={({ pressed }) => [st.thumb, pressed && { opacity: 0.92 }]}
            >
              <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={16} />
              <View style={st.playBtn}>
                <Play size={24} color={palette.navy} fill={palette.navy} />
              </View>
            </Pressable>
            <T variant="heading" style={{ marginTop: spacing.md, fontSize: 17 }}>Welcome to the Pathway</T>
            {welcomeVideo.caption ? (
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{welcomeVideo.caption}</T>
            ) : (
              <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>Start here — what the journey looks like</T>
            )}
          </View>
        ) : null}

        {/* ── This week at Nuru (real featured cell, PR #125; hidden when none) ── */}
        {featuredCell ? (
          <View style={st.card}>
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
          </View>
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
                  onPress={() => setRhythm((prev) => ({ ...prev, [key]: !prev[key] }))}
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

        {/* ── Your progress ──────────────────────────────────────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "baseline" }}>
            <T variant="heading" style={{ flex: 1, fontSize: 15 }}>Your progress</T>
            <Pressable onPress={() => nav.navigate("Tabs", { screen: "Pathway" })}>
              <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>View pathway ›</T>
            </Pressable>
          </View>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
            {(
              [
                { label: "Habits", value: `${habitsPct}%`, fill: palette.gold, pct: habitsPct },
                { label: "Curriculum", value: `${overallPct}%`, fill: palette.navy, pct: overallPct },
                { label: "Streak", value: `${streak}d`, fill: palette.success, pct: Math.min(100, streak * 10) },
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

        {/* ── Upcoming (real calendar) ───────────────────────────────── */}
        {(occurrences ?? []).length > 0 ? (
          <View style={st.card}>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <T variant="heading" style={{ flex: 1, fontSize: 15 }}>Upcoming</T>
              <Pressable onPress={() => nav.navigate("Calendar")}>
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>See all ›</T>
              </Pressable>
            </View>
            {(occurrences ?? []).slice(0, 3).map((e) => (
              <Pressable
                key={e.occurrence_id}
                onPress={() =>
                  nav.navigate("EventDetail", {
                    eventId: e.occurrence_id,
                    title: e.title,
                    startAt: e.start_at,
                    endAt: e.end_at,
                    location: e.location,
                  })
                }
                style={({ pressed }) => [st.eventRow, pressed && { opacity: 0.85 }]}
              >
                <View style={st.eventDate}>
                  <T variant="micro" style={{ color: palette.gold, fontWeight: "700" }}>
                    {new Date(e.start_at).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                  </T>
                  <T serif tone="onNavy" style={{ fontSize: 16 }}>{String(new Date(e.start_at).getDate())}</T>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>
                    {new Date(e.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </T>
                  <T variant="heading" style={{ fontSize: 14, marginTop: 1 }} numberOfLines={1}>{e.title}</T>
                  {e.location ? (
                    <T variant="micro" tone="tertiary" numberOfLines={1}>{e.location}</T>
                  ) : null}
                </View>
                <ChevronRight size={16} color={palette.ink300} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Verse for today (WEB default, D-M4) ────────────────────── */}
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

        {/* ── Announcements (real, B5) ───────────────────────────────── */}
        {(announcements ?? []).length > 0 ? (
          <View style={st.card}>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <T variant="heading" style={{ flex: 1, fontSize: 15 }}>Announcements</T>
              <Pressable onPress={() => nav.navigate("Tabs", { screen: "Community" })}>
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "600" }}>View all ›</T>
              </Pressable>
            </View>
            {(announcements ?? []).slice(0, 3).map((a) => (
              <Pressable
                key={a.announcement_id}
                onPress={() => openAnnouncement(a.announcement_id)}
                style={({ pressed }) => [st.annRow, pressed && { opacity: 0.85 }]}
              >
                <View style={st.annTile}>
                  <Megaphone size={16} color={palette.navy} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <T variant="heading" style={{ fontSize: 14 }} numberOfLines={1}>{a.title}</T>
                  <T variant="micro" tone="tertiary" numberOfLines={1}>
                    {a.sent_at ? new Date(a.sent_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : ""}
                  </T>
                </View>
                {!a.opened ? <View style={st.unreadDot} /> : null}
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Your cohort ────────────────────────────────────────────── */}
        <View style={st.card}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <T variant="heading" style={{ fontSize: 15 }}>Your cohort</T>
              <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>Walking the pathway together</T>
            </View>
            <View style={st.cohortAvatars}>
              <Users size={16} color={palette.navy} />
            </View>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("Tabs", { screen: "Community" })}
            style={({ pressed }) => [st.cohortBtn, pressed && { opacity: 0.85 }]}
          >
            <T variant="caption" style={{ fontWeight: "600", color: palette.navy }}>Open community ›</T>
          </Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  center: { alignItems: "center", justifyContent: "center" },
  header: {
    backgroundColor: palette.navy,
    paddingHorizontal: spacing.screen,
    paddingTop: 58,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },
  kicker: { letterSpacing: 2.4, fontWeight: "600" },
  greeting: { fontSize: 28, lineHeight: 34, marginTop: spacing.sm, fontWeight: "600" },
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
    marginTop: spacing.base,
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
  annTile: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.tintBlue, alignItems: "center", justifyContent: "center" },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  cohortAvatars: { width: 36, height: 36, borderRadius: 12, backgroundColor: palette.tintBlue, alignItems: "center", justifyContent: "center" },
  cohortBtn: {
    marginTop: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: 14,
    alignItems: "center",
    paddingVertical: 12,
  },
} as const;
