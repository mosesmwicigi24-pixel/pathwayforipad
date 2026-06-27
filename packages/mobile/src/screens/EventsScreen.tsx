// Events ("Gathered together" make). Event-centric tab redesigned to the Figma
// CommunityTab: a navy header with a warm gold radial glow + a live-pulse summary
// row (live now · this week · you're going), an immersive image-backed LIVE NOW
// hero with a glowing gold check-in, a prominent navy/gold "All events & calendar"
// card, photo-forward event cards (save heart, 🔥 Popular, countdown chip, series
// tag, deeper gradient), and the existing real-data sections (week strip, segments,
// search + category chips, series you follow, announcements, your cell) restyled to
// the make. Every section stays bound to the database — calendar occurrences,
// RSVPs, series follows, announcements, cell summary. Fonts nudged ~1px down across
// the tab for a cleaner feel. Decorative make elements with no data source (Moments
// gallery, "We missed you") are omitted.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Animated, Easing, Image, Modal, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import {
  CalendarDays, Check, ChevronRight, Clock, Heart, MapPin, Megaphone, Play, Plus, QrCode, Search, Sparkles, Users, X,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { CalendarOccurrence, EventSeries, Moment, MyAnnouncement } from "../api/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { cdnImage } from "../util/cdnImage";
import { GradientBg, T } from "../theme/components";
import { useCalendar, useCellSummary, useEventSeries, useFeaturedEvent, useMoments, useMyAnnouncements, useMyRsvps, queryKeys } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries, refreshQueries } from "../api/query";
import { Loading } from "../components/states";
import { NotificationBell } from "../components/NotificationBell";
import { Avatar } from "../components/Avatar";
import { ShimmerSweep } from "../components/ShimmerSweep";
import { FitImage } from "../components/FitImage";
import {
  sameDay, isLive, weekStrip, monthLabel, todayLabel, timeRange, countdown,
  matchesCategory, matchesSearch, categoryColor, timeAgo, EVENT_CATEGORIES,
} from "./eventHelpers";

type Segment = "today" | "upcoming" | "rsvps";

const startOfDay = (ts: number): number => {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// A soft pulsing ring (a ring that scales out + fades) for the live-now dots — the
// make's motion.span pulse, in RN Animated.
function PulseRing({ size = 7, color = palette.success }: { size?: number; color?: string }): ReactElement {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Animated.View style={{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color, transform: [{ scale }], opacity }} />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}

export function EventsScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Snapshot "now" ONCE per mount. (Date.now() in render would change every
  // render → new calendar from/to ISO → new query key → infinite refetch storm
  // that drains the rate limiter and 429s every screen.)
  const now = useMemo(() => Date.now(), []);
  const [fromIso, toIso] = useMemo(() => {
    const n = new Date(now);
    return [new Date(n.getTime() - 7 * 86_400_000).toISOString(), new Date(n.getTime() + 45 * 86_400_000).toISOString()];
  }, [now]);
  const { data: occurrences, isLoading, error, refetch } = useCalendar(fromIso, toIso);
  const { data: rsvps, refetch: refetchRsvps } = useMyRsvps();
  const { data: announcements, refetch: refetchAnnouncements } = useMyAnnouncements();
  const { data: series, refetch: refetchSeries } = useEventSeries();
  const { data: cellSummary, refetch: refetchCell } = useCellSummary();
  // The admin-featured event (set from the web portal). It anchors the top hero —
  // shown whether or not it's live; a live featured event still gets the LIVE badge.
  const { data: featured, refetch: refetchFeatured } = useFeaturedEvent();
  // Community "Moments" — a curated photo gallery the pastoral team posts from the
  // web portal (the Figma Moments carousel).
  const { data: moments, refetch: refetchMoments } = useMoments();

  const [segment, setSegment] = useState<Segment>("today");
  const [selectedDay, setSelectedDay] = useState<number>(() => startOfDay(now));
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  // Save ♥ is local-only UI state: there is no save/bookmark-event API on NuruApi
  // (only saveVerse). Kept optimistic in-memory so the heart toggles per session.
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [viewMoment, setViewMoment] = useState<Moment | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchRsvps(), refetchAnnouncements(), refetchSeries(), refetchCell(), refetchFeatured(), refetchMoments()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchRsvps, refetchAnnouncements, refetchSeries, refetchCell, refetchFeatured, refetchMoments]);

  const all = occurrences ?? [];
  const today = new Date(now);
  const rsvpByEvent = useMemo(() => new Map((rsvps ?? []).map((r) => [r.event_id, r.status])), [rsvps]);

  // Top hero — the admin-featured event (set from the web portal), resolved to its
  // live or nearest-upcoming occurrence so the card is a real, tappable event with
  // cover, going count, and faces. Falls back to any live gathering when nothing is
  // featured. A live featured event still gets the LIVE badge; otherwise FEATURED.
  const live = all.find((o) => isLive(o, now)) ?? null;
  const featuredOcc = (() => {
    if (!featured) return null;
    const mine = all.filter((o) => o.series_id === featured.series_id);
    return (
      mine.find((o) => isLive(o, now)) ??
      mine.filter((o) => new Date(o.start_at).getTime() >= now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0] ??
      null
    );
  })();
  const heroOcc = featuredOcc ?? live;
  const heroLive = heroOcc ? isLive(heroOcc, now) : false;

  // The horizontal date picker drives the "Today" segment list.
  const selDate = new Date(selectedDay);
  const todayEvents = all.filter((o) => sameDay(new Date(o.start_at), selDate));
  const upcoming = all.filter((o) => new Date(o.start_at).getTime() > now && !sameDay(new Date(o.start_at), today));
  const rsvpEvents = all.filter((o) => { const s = rsvpByEvent.get(o.occurrence_id); return s === "going" || s === "maybe"; });

  // Pulse-row metrics, all derived from real data.
  const liveCount = all.filter((o) => isLive(o, now)).length;
  const weekAhead = weekStrip(all, now);
  const weekEnd = new Date(weekAhead[weekAhead.length - 1]?.iso ?? now).getTime();
  const thisWeekCount = all.filter((o) => { const t = new Date(o.start_at).getTime(); return t >= now && t <= weekEnd; }).length;
  const goingCount = (rsvps ?? []).filter((r) => r.status === "going").length;
  const upcomingCount = all.filter((o) => new Date(o.start_at).getTime() >= now).length;

  // 14-day strip (today-2 … today+11), each day flagged if it has gatherings.
  const strip = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(startOfDay(now) + (i - 2) * 86_400_000);
    return { ts: d.getTime(), date: d, isToday: sameDay(d, today), isSelected: sameDay(d, selDate), hasEvent: all.some((o) => sameDay(new Date(o.start_at), d)) };
  });

  const counts = { today: todayEvents.length, upcoming: upcoming.length, rsvps: rsvpEvents.length };
  const SEGMENTS: Array<{ key: Segment; label: string }> = [
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "rsvps", label: "My RSVPs" },
  ];

  const baseList = segment === "today" ? todayEvents : segment === "upcoming" ? upcoming : rsvpEvents;
  // Nearest gatherings first, out to the far end — explicit chronological order.
  const list = baseList
    .filter((o) => matchesCategory(o, category) && matchesSearch(o, query))
    .sort((a, b) => a.start_at.localeCompare(b.start_at));
  const sectionTitle =
    segment === "today"
      ? sameDay(selDate, today)
        ? "Today's gatherings"
        : `Events on ${selDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : segment === "upcoming"
        ? "Coming up"
        : "Your RSVPs";

  const openEvent = (o: CalendarOccurrence): void =>
    nav.navigate("EventDetail", { eventId: o.occurrence_id, title: o.title, startAt: o.start_at, endAt: o.end_at, location: o.location });
  // Tapping a followed series opens its next occurrence as the event itself.
  const openSeries = (s: EventSeries): void => {
    if (!s.next_occurrence_id || !s.next_at) return;
    nav.navigate("EventDetail", {
      eventId: s.next_occurrence_id,
      title: s.title,
      startAt: s.next_at,
      ...(s.next_end_at ? { endAt: s.next_end_at } : {}),
      location: s.location,
    });
  };

  async function toggleFollow(s: EventSeries): Promise<void> {
    setFollowBusy(s.series_id);
    try {
      await NuruApi.followSeries(s.series_id);
      refreshQueries(queryKeys.eventSeries);
      await refetchSeries();
    } catch {
      /* best-effort */
    } finally {
      setFollowBusy(null);
    }
  }

  function openAnnouncement(a: MyAnnouncement): void {
    if (!a.opened) {
      void NuruApi.openAnnouncement(a.announcement_id).then(() => { invalidateQueries("myAnnouncements"); void refetchAnnouncements(); }).catch(() => undefined);
    }
    nav.navigate("AnnouncementDetail", { announcementId: a.announcement_id, title: a.title });
  }

  const cell = cellSummary?.cell ?? null;

  return (
    <View style={st.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarSpace }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {/* Header — navy gradient + warm gold radial glow */}
        <View style={st.header}>
          <GradientBg colors={[palette.navy700, palette.navy, "#0A1D33"]} radius={0} />
          <View style={st.headerGlow} />
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CalendarDays size={12} color={palette.gold} />
                <T variant="micro" tone="gold" style={st.kicker}>EVENTS</T>
              </View>
              <T serif tone="onNavy" style={{ fontSize: 29, marginTop: 4 }}>Gathered together</T>
              <T variant="caption" tone="onNavyDim" style={{ marginTop: 4, fontSize: 11 }}>Today · {todayLabel(now)} · East Africa Time</T>
            </View>
            <NotificationBell />
          </View>

          {/* Live-pulse summary row */}
          <View style={st.pulseRow}>
            {liveCount > 0 ? (
              <View style={st.pulseLive}>
                <PulseRing size={6} color="#22c55e" />
                <T variant="micro" style={{ color: "#7fe0a0", fontWeight: "800", fontSize: 10 }}>{liveCount} live now</T>
              </View>
            ) : null}
            <View style={st.pulseChip}>
              <CalendarDays size={11} color={palette.gold} />
              <T variant="micro" style={{ color: palette.onNavyDim, fontWeight: "700", fontSize: 10 }}>{thisWeekCount} this week</T>
            </View>
            <View style={st.pulseChip}>
              <Check size={11} color={palette.gold} />
              <T variant="micro" style={{ color: palette.onNavyDim, fontWeight: "700", fontSize: 10 }}>{goingCount} you're going</T>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
          {/* Featured / Live — immersive, image-backed hero (admin-featured first) */}
          {heroOcc ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${heroLive ? "Live now" : "Featured"}: ${heroOcc.title}`}
              onPress={() => openEvent(heroOcc)}
              style={({ pressed }) => [st.liveHero, pressed && { transform: [{ scale: 0.99 }] }]}
            >
              {heroOcc.primary_image_url ? (
                <Image source={{ uri: cdnImage(heroOcc.primary_image_url, { width: 1000 }) }} style={st.heroImg} resizeMode="cover" />
              ) : (
                <GradientBg colors={[palette.navy700, palette.navy, categoryColor(heroOcc.category)]} radius={0} />
              )}
              <View style={st.heroVeil} />
              <View style={st.heroGlow} />
              <View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    {heroLive ? (
                      <View style={st.liveBadge}>
                        <PulseRing size={6} color="#fff" />
                        <T variant="micro" style={{ color: "#fff", fontWeight: "800", letterSpacing: 1, fontSize: 9 }}>LIVE NOW</T>
                      </View>
                    ) : (
                      <View style={st.featBadge}>
                        <Sparkles size={10} color={palette.navy} />
                        <T variant="micro" style={{ color: palette.navy, fontWeight: "800", letterSpacing: 1, fontSize: 9 }}>FEATURED</T>
                      </View>
                    )}
                    {heroOcc.category ? <T variant="micro" style={{ color: palette.goldLight, fontWeight: "700", letterSpacing: 1, fontSize: 9 }}>{heroOcc.category.toUpperCase()}</T> : null}
                  </View>
                  <View style={st.qrChip}><QrCode size={17} color="#fff" /></View>
                </View>
                <T serif tone="onNavy" style={{ fontSize: 21, marginTop: spacing.xl }}>{heroOcc.title}</T>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.sm, flexWrap: "wrap" }}>
                  <View style={st.heroMeta}><Clock size={13} color={palette.goldLight} /><T variant="caption" tone="onNavyDim" style={{ fontSize: 10 }}>{timeRange(heroOcc.start_at, heroOcc.end_at)}</T></View>
                  {heroOcc.location ? <View style={st.heroMeta}><MapPin size={13} color={palette.goldLight} /><T variant="caption" tone="onNavyDim" numberOfLines={1} style={{ fontSize: 10 }}>{heroOcc.location}</T></View> : null}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.base }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    {heroOcc.attendees && heroOcc.attendees.length > 0 ? (
                      <View style={{ flexDirection: "row" }}>
                        {heroOcc.attendees.slice(0, 4).map((a, i) => (
                          <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 13, borderWidth: 2, borderColor: "#081C36" }}>
                            <Avatar uri={a.avatar_url} name={a.full_name} size={22} />
                          </View>
                        ))}
                      </View>
                    ) : null}
                    <T variant="micro" style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700", fontSize: 10 }}>{heroOcc.going > 0 ? `${heroOcc.going} ${heroLive ? "worshipping" : "going"}` : "Join the gathering"}</T>
                  </View>
                  <View style={st.checkInBtn}>
                    <ShimmerSweep active color="rgba(255,255,255,0.55)" durationMs={2400} />
                    <QrCode size={15} color={palette.navy} />
                    <T variant="micro" style={{ color: palette.navy, fontWeight: "800", letterSpacing: 1, fontSize: 10 }}>{heroLive ? "CHECK IN" : "DETAILS"}</T>
                  </View>
                </View>
              </View>
            </Pressable>
          ) : null}

          {/* Date picker — a selectable, scrollable 14-day strip that drives the list */}
          <View style={st.weekCard}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm, paddingHorizontal: 2 }}>
              <T variant="overline" tone="gold" style={{ fontSize: 10 }}>{monthLabel(now)}</T>
              <Pressable accessibilityRole="button" accessibilityLabel="Jump to today" onPress={() => { setSelectedDay(startOfDay(now)); setSegment("today"); }}>
                <T variant="micro" style={{ color: palette.navy, fontWeight: "700", fontSize: 10, letterSpacing: 1 }}>TODAY</T>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 2 }}>
              {strip.map((d) => (
                <Pressable
                  key={d.ts}
                  accessibilityRole="button"
                  accessibilityState={{ selected: d.isSelected }}
                  accessibilityLabel={d.date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
                  onPress={() => { setSelectedDay(d.ts); setSegment("today"); }}
                  style={[st.dayTile, d.isSelected ? { backgroundColor: palette.navy } : d.isToday ? { backgroundColor: palette.goldTint } : null]}
                >
                  <T variant="micro" style={{ fontSize: 8, letterSpacing: 0.5, fontWeight: "700", color: d.isSelected ? "rgba(255,255,255,0.65)" : palette.ink400 }}>
                    {d.date.toLocaleDateString("en-US", { weekday: "narrow" })}
                  </T>
                  <T serif style={{ fontSize: 16, marginTop: 1, color: d.isSelected ? palette.onNavy : palette.navy }}>{d.date.getDate()}</T>
                  <View style={[st.dayDot, { backgroundColor: d.hasEvent ? palette.gold : "transparent" }]} />
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Prominent — open the full calendar */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="All events and calendar"
            onPress={() => nav.navigate("Calendar")}
            style={({ pressed }) => [st.calCard, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <GradientBg colors={[palette.navy, "#0A1D33"]} radius={0} />
            <View style={st.calGlow} />
            <View style={st.calIcon}>
              <GradientBg colors={[palette.goldHi, "#B6862F"]} radius={16} />
              <CalendarDays size={22} color={palette.navy} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="micro" style={{ color: palette.goldLight, fontWeight: "700", letterSpacing: 1, fontSize: 9 }}>CALENDAR</T>
              <T serif tone="onNavy" style={{ fontSize: 15, marginTop: 1 }}>All events &amp; calendar</T>
              <T variant="micro" tone="onNavyDim" style={{ marginTop: 1, fontSize: 10 }}>See the whole month · {upcomingCount} upcoming</T>
            </View>
            <View style={st.calChevron}><ChevronRight size={18} color="#fff" /></View>
          </Pressable>

          {/* Segments */}
          <View style={st.segment}>
            {SEGMENTS.map((s) => {
              const on = segment === s.key;
              return (
                <Pressable key={s.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setSegment(s.key)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                  <T variant="caption" style={{ fontWeight: on ? "700" : "400", color: on ? palette.white : palette.ink600, fontSize: 11 }}>{s.label}</T>
                  <View style={[st.segBadge, { backgroundColor: on ? palette.gold : palette.surface }]}>
                    <T variant="micro" style={{ color: on ? palette.navy : palette.ink600, fontWeight: "800", fontSize: 10 }}>{counts[s.key]}</T>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Search */}
          <View style={st.search}>
            <Search size={17} color={palette.ink400} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search events by name or place" placeholderTextColor={palette.ink400} accessibilityLabel="Search events" style={st.searchInput} />
          </View>

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
            {EVENT_CATEGORIES.map((c) => {
              const on = category === c;
              const color = c === "All" ? palette.navy : categoryColor(c);
              return (
                <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCategory(c)} style={[st.chip, on ? { backgroundColor: color, borderColor: color } : null]}>
                  <T variant="caption" style={{ color: on ? palette.white : palette.ink600, fontWeight: on ? "700" : "500", fontSize: 11 }}>{c}</T>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Section header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
            <T serif style={{ fontSize: 19, color: palette.ink }}>{sectionTitle}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="All and calendar" onPress={() => nav.navigate("Calendar")} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <T variant="caption" style={{ color: palette.navy, fontWeight: "700", fontSize: 11 }}>All &amp; calendar</T>
                <ChevronRight size={13} color={palette.navy} />
              </View>
            </Pressable>
          </View>

          {/* Event cards */}
          {isLoading ? (
            <Loading label="Loading gatherings…" />
          ) : error ? (
            <View style={st.card}><T variant="heading">Couldn't load events</T><T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{errorMessage(error)}</T></View>
          ) : list.length === 0 ? (
            <View style={[st.card, { alignItems: "center", paddingVertical: spacing.xl }]}>
              <View style={st.emptyTile}><CalendarDays size={21} color={palette.gold} /></View>
              <T variant="heading" style={{ marginTop: spacing.md, fontSize: 15 }}>
                {segment === "today" ? "Nothing today" : segment === "upcoming" ? "Nothing coming up" : "No RSVPs yet"}
              </T>
              <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center", maxWidth: 260, fontSize: 11 }}>
                {segment === "rsvps" ? "Tap an event to say you'll be there." : "New gatherings appear here as they're scheduled."}
              </T>
            </View>
          ) : (
            list.map((o) => (
              <EventCard
                key={o.occurrence_id}
                occ={o}
                live={isLive(o, now)}
                status={rsvpByEvent.get(o.occurrence_id) ?? null}
                saved={!!saved[o.occurrence_id]}
                onToggleSave={() => setSaved((prev) => ({ ...prev, [o.occurrence_id]: !prev[o.occurrence_id] }))}
                now={now}
                onPress={() => openEvent(o)}
              />
            ))
          )}

          {/* Series you follow */}
          {(series ?? []).length > 0 ? (
            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Sparkles size={13} color={palette.goldLo} />
                  <T variant="overline" tone="gold" style={{ fontSize: 10 }}>SERIES YOU FOLLOW</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("Calendar")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700", fontSize: 11 }}>See all</T></Pressable>
              </View>
              {(series ?? []).slice(0, 4).map((s, i, arr) => (
                <Pressable
                  key={s.series_id}
                  accessibilityRole="button"
                  accessibilityLabel={s.next_occurrence_id ? `Open ${s.title}` : s.title}
                  disabled={!s.next_occurrence_id}
                  onPress={() => openSeries(s)}
                  style={({ pressed }) => [st.seriesRow, i < arr.length - 1 && st.divider, pressed && s.next_occurrence_id ? { opacity: 0.7 } : null]}
                >
                  <View style={[st.seriesDot, { backgroundColor: `${categoryColor(s.category)}1F`, borderColor: `${categoryColor(s.category)}33` }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <T variant="heading" style={{ fontSize: 14 }} numberOfLines={1}>{s.title}</T>
                      {s.following && s.new_count > 0 ? <View style={st.newChip}><T variant="micro" style={{ color: palette.goldChipText, fontWeight: "800", fontSize: 9 }}>{s.new_count} new</T></View> : null}
                    </View>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1, fontSize: 10 }}>{s.cadence}</T>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={s.following ? `Unfollow ${s.title}` : `Follow ${s.title}`}
                    disabled={followBusy === s.series_id}
                    onPress={() => void toggleFollow(s)}
                    style={({ pressed }) => [s.following ? st.followingBtn : st.followBtn, pressed && { opacity: 0.85 }]}
                  >
                    {s.following ? <Check size={13} color={palette.onNavy} /> : <Plus size={13} color={palette.navy} />}
                    <T variant="caption" style={{ color: s.following ? palette.onNavy : palette.navy, fontWeight: "700", fontSize: 11 }}>{s.following ? "Following" : "Follow"}</T>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Announcements */}
          {(announcements ?? []).length > 0 ? (
            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Megaphone size={13} color={palette.goldLo} />
                  <T variant="overline" tone="gold" style={{ fontSize: 10 }}>ANNOUNCEMENTS</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("Notifications")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700", fontSize: 11 }}>See all</T></Pressable>
              </View>
              {(announcements ?? []).slice(0, 3).map((a, i, arr) => (
                <Pressable key={a.announcement_id} accessibilityRole="button" onPress={() => openAnnouncement(a)} style={[st.annRow, i < arr.length - 1 && st.divider]}>
                  <View style={st.annThumbWrap}>
                    {a.primary_image_url ? (
                      <Image source={{ uri: cdnImage(a.primary_image_url, { width: 96 }) }} style={st.annThumb} resizeMode="contain" />
                    ) : (
                      <View style={st.annIcon}><Sparkles size={16} color={palette.goldLo} /></View>
                    )}
                    {a.video_url ? (
                      <View style={st.annPlay}><Play size={11} color="#fff" fill="#fff" /></View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                      <T variant="heading" style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{a.title}</T>
                      <T variant="micro" tone="tertiary" style={{ fontSize: 10 }}>{timeAgo(a.sent_at, now)}</T>
                    </View>
                    <T variant="micro" tone="secondary" style={{ marginTop: 2, fontSize: 10 }} numberOfLines={2}>{a.body}</T>
                    {a.video_url ? (
                      <View style={st.annVideoChip}><Play size={9} color={palette.navy} fill={palette.navy} /><T variant="micro" style={{ color: palette.navy, fontWeight: "700", fontSize: 10 }}>Video</T></View>
                    ) : null}
                  </View>
                  {!a.opened ? <View style={st.unreadDot} /> : <ChevronRight size={16} color={palette.ink300} />}
                </Pressable>
              ))}
            </View>
          ) : null}

          {/* Your cell */}
          {cell ? (
            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Users size={13} color={palette.goldLo} />
                  <T variant="overline" tone="gold" style={{ fontSize: 10 }}>YOUR CELL</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("CohortDiscussions")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700", fontSize: 11 }}>Open</T></Pressable>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                <CellTile label="CELL" value={cell.name} sub={`${cell.members} ${cell.members === 1 ? "member" : "members"}`} />
                <CellTile label="ATTENDANCE" value={`${cell.attendance.attended} of ${cell.attendance.expected}`} sub="This month" />
                <CellTile
                  label="NEXT"
                  value={cell.next ? `${new Date(cell.next.start_at).toLocaleDateString("en-US", { weekday: "short" })} ${new Date(cell.next.start_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}` : "—"}
                  sub={cell.next?.location ?? "No meeting scheduled"}
                />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open cell space" onPress={() => nav.navigate("CohortDiscussions")} style={({ pressed }) => [st.openCellBtn, pressed && { opacity: 0.9 }]}>
                <T variant="label" style={{ color: palette.onNavy, fontWeight: "700", fontSize: 11 }}>Open cell space</T>
                <ChevronRight size={15} color={palette.onNavy} />
              </Pressable>
            </View>
          ) : null}

          {/* Moments — a curated photo gallery posted from the web portal */}
          {(moments ?? []).length > 0 ? (
            <View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 2, marginBottom: spacing.sm }}>
                <Sparkles size={13} color={palette.goldLo} />
                <T variant="overline" tone="gold" style={{ fontSize: 10 }}>MOMENTS</T>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: 2 }}>
                {(moments ?? []).map((m) => (
                  <Pressable
                    key={m.moment_id}
                    accessibilityRole="imagebutton"
                    accessibilityLabel={m.caption ?? "Moment"}
                    onPress={() => setViewMoment(m)}
                    style={({ pressed }) => [st.momentCard, pressed && { transform: [{ scale: 0.98 }] }]}
                  >
                    <Image source={{ uri: cdnImage(m.image_url, { width: 400 }) }} style={st.momentImg} resizeMode="cover" />
                    <View style={st.momentShade}><GradientBg vertical colors={["rgba(11,31,51,0)", "rgba(11,31,51,0.82)"]} /></View>
                    <View style={st.momentCaption}>
                      {m.tag ? <T variant="micro" style={{ color: "rgba(255,255,255,0.85)", fontWeight: "700", letterSpacing: 1, fontSize: 8 }} numberOfLines={1}>{m.tag.toUpperCase()}</T> : null}
                      {m.caption ? <T variant="caption" style={{ color: "#fff", fontWeight: "600", fontSize: 11, marginTop: 1 }} numberOfLines={2}>{m.caption}</T> : null}
                    </View>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      </ScrollView>

      {/* Moment viewer — full image (grows to fit, never cropped) + caption */}
      <Modal visible={!!viewMoment} transparent animationType="fade" onRequestClose={() => setViewMoment(null)}>
        <Pressable style={st.viewerBackdrop} onPress={() => setViewMoment(null)}>
          {viewMoment ? (
            <View style={st.viewerBody}>
              <FitImage uri={viewMoment.image_url} radius={20} maxHeight={520} minAspect={0.4} background="transparent" />
              {viewMoment.tag || viewMoment.caption ? (
                <View style={{ marginTop: spacing.md, alignItems: "center" }}>
                  {viewMoment.tag ? <T variant="overline" tone="gold" style={{ fontSize: 10 }}>{viewMoment.tag.toUpperCase()}</T> : null}
                  {viewMoment.caption ? <T serif tone="onNavy" style={{ fontSize: 16, textAlign: "center", marginTop: 4 }}>{viewMoment.caption}</T> : null}
                </View>
              ) : null}
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setViewMoment(null)} style={st.viewerClose}>
                <X size={18} color="#fff" />
              </Pressable>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

function EventCard({
  occ, live, status, saved, onToggleSave, now, onPress,
}: {
  occ: CalendarOccurrence;
  live: boolean;
  status: string | null;
  saved: boolean;
  onToggleSave: () => void;
  now: number;
  onPress: () => void;
}): ReactElement {
  const d = new Date(occ.start_at);
  const accent = categoryColor(occ.category);
  const popular = occ.going >= 120;
  const cd = live ? null : countdown(occ.start_at, now);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={occ.title} onPress={onPress} style={({ pressed }) => [st.eventCard, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={st.cover}>
        {occ.primary_image_url ? (
          <Image source={{ uri: cdnImage(occ.primary_image_url, { width: 900 }) }} style={st.coverImg} resizeMode="cover" />
        ) : (
          <GradientBg colors={[palette.navy700, palette.navy, accent]} radius={0} />
        )}
        <View style={st.coverShade} />
        {/* Date chip · top-left */}
        <View style={st.coverDate}>
          <T variant="micro" style={{ color: accent, fontWeight: "800", fontSize: 9 }}>{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</T>
          <T serif style={{ fontSize: 18, color: palette.navy }}>{d.getDate()}</T>
        </View>
        {/* Status pills · top-right */}
        <View style={st.coverBadges}>
          {live ? (
            <View style={st.liveBadgeSm}><PulseRing size={5} color="#fff" /><T variant="micro" style={{ color: "#fff", fontWeight: "800", letterSpacing: 0.5, fontSize: 9 }}>LIVE</T></View>
          ) : popular ? (
            <View style={st.popularBadge}><T variant="micro" style={{ color: "#fff", fontWeight: "800", fontSize: 9 }}>🔥 Popular</T></View>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? "Unsave event" : "Save event"}
            hitSlop={8}
            onPress={(e) => { e.stopPropagation(); onToggleSave(); }}
            style={({ pressed }) => [st.saveBtn, pressed && { transform: [{ scale: 0.9 }] }]}
          >
            <Heart size={13} color={saved ? palette.gold : "#fff"} fill={saved ? palette.gold : "transparent"} />
          </Pressable>
        </View>
        {/* Countdown · bottom-left over image */}
        {cd ? (
          <View style={st.countdownChip}><Clock size={10} color={palette.goldLight} /><T variant="micro" style={{ color: "#fff", fontWeight: "700", fontSize: 9 }}>{cdLabel(cd)}</T></View>
        ) : null}
        {/* Series tag · bottom-right over image */}
        {occ.category ? (
          <View style={[st.seriesTag, { backgroundColor: `${accent}E6` }]}><T variant="micro" style={{ color: "#fff", fontWeight: "800", letterSpacing: 0.5, fontSize: 9 }}>{occ.category.toUpperCase()}</T></View>
        ) : null}
      </View>
      <View style={{ padding: spacing.base }}>
        <T serif style={{ fontSize: 17, color: palette.ink }} numberOfLines={1}>{occ.title}</T>
        {occ.description ? <T variant="caption" tone="secondary" style={{ marginTop: 4, fontSize: 11 }} numberOfLines={2}>{occ.description}</T> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.sm, flexWrap: "wrap" }}>
          <View style={st.metaRow}><Clock size={12} color={palette.ink600} /><T variant="micro" tone="secondary" style={{ fontSize: 10 }}>{timeRange(occ.start_at, occ.end_at)}</T></View>
          {occ.location ? <View style={st.metaRow}><MapPin size={12} color={palette.ink600} /><T variant="micro" tone="secondary" numberOfLines={1} style={{ fontSize: 10 }}>{occ.location}</T></View> : null}
        </View>
        <View style={st.cardFooter}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {occ.attendees && occ.attendees.length > 0 ? (
              <View style={{ flexDirection: "row" }}>
                {occ.attendees.slice(0, 3).map((a, i) => (
                  <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 13, borderWidth: 2, borderColor: palette.white }}>
                    <Avatar uri={a.avatar_url} name={a.full_name} size={22} />
                  </View>
                ))}
              </View>
            ) : (
              <Users size={13} color={palette.ink600} />
            )}
            <T variant="caption" tone="secondary" style={{ fontSize: 11 }}>{occ.going > 0 ? `${occ.going} going` : "Be the first to RSVP"}</T>
          </View>
          <StatusPill status={status} />
        </View>
      </View>
    </Pressable>
  );
}

// Tighten the helper's "N min/hours/days to go" to the make's compact chip labels.
function cdLabel(cd: string): string {
  if (cd === "Happening now") return "Today";
  const days = /^(\d+) days? to go$/.exec(cd);
  if (days) return days[1] === "1" ? "Tomorrow" : `In ${days[1]} days`;
  return cd; // "45 min to go" / "8 hours to go" → keep as-is (same-day)
}

function StatusPill({ status }: { status: string | null }): ReactElement {
  if (status === "going") return <View style={[st.statusPill, { backgroundColor: palette.successBg }]}><Check size={12} color={palette.successText} /><T variant="caption" style={{ color: palette.successText, fontWeight: "800", fontSize: 10 }}>GOING</T></View>;
  if (status === "maybe") return <View style={[st.statusPill, { backgroundColor: palette.goldChipBg }]}><Plus size={12} color={palette.goldChipText} /><T variant="caption" style={{ color: palette.goldChipText, fontWeight: "800", fontSize: 10 }}>MAYBE</T></View>;
  return <View style={[st.statusPill, { backgroundColor: palette.navy }]}><Plus size={12} color={palette.onNavy} /><T variant="caption" style={{ color: palette.onNavy, fontWeight: "800", fontSize: 10 }}>RSVP</T></View>;
}

function CellTile({ label, value, sub }: { label: string; value: string; sub: string }): ReactElement {
  return (
    <View style={st.cellTile}>
      <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 0.8, fontSize: 10 }}>{label}</T>
      <T serif style={{ fontSize: 15, color: palette.ink, marginTop: 2 }} numberOfLines={1}>{value}</T>
      <T variant="micro" tone="tertiary" style={{ marginTop: 1, fontSize: 10 }} numberOfLines={1}>{sub}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  header: { paddingHorizontal: spacing.screen, paddingTop: 58, paddingBottom: spacing.lg, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: "hidden" },
  headerGlow: { position: "absolute", top: -80, right: -64, width: 224, height: 224, borderRadius: 112, backgroundColor: "rgba(201,162,39,0.20)" },
  kicker: { letterSpacing: 2.4, fontWeight: "600", fontSize: 10 },
  pulseRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: spacing.md },
  pulseLive: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(22,163,74,0.18)", borderRadius: radii.pill, paddingHorizontal: 10, height: 24 },
  pulseChip: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, paddingHorizontal: 10, height: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.10)" },
  // Live hero
  liveHero: { borderRadius: 24, overflow: "hidden", padding: spacing.base, backgroundColor: palette.navy, ...shadow.card },
  heroImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  heroVeil: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,20,36,0.66)" },
  heroGlow: { position: "absolute", top: -48, right: -40, width: 160, height: 160, borderRadius: 80, backgroundColor: "rgba(230,192,104,0.22)" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: palette.success, borderRadius: radii.pill, paddingHorizontal: 10, height: 24 },
  featBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.goldLight, borderRadius: radii.pill, paddingHorizontal: 10, height: 24 },
  qrChip: { width: 36, height: 36, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.16)", alignItems: "center", justifyContent: "center" },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  checkInBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginLeft: "auto", backgroundColor: palette.gold, borderRadius: 16, height: 40, paddingHorizontal: 16, overflow: "hidden" },
  // Date picker strip
  weekCard: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.md, ...shadow.card },
  dayTile: { width: 44, paddingVertical: 8, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  // Moments
  momentCard: { width: 168, aspectRatio: 4 / 5, borderRadius: 18, overflow: "hidden", backgroundColor: palette.navy, borderWidth: 1, borderColor: palette.border },
  momentImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  momentShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "55%", backgroundColor: "rgba(11,31,51,0.55)" },
  momentCaption: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 10 },
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(8,20,36,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  viewerBody: { width: "100%", maxWidth: 480, alignItems: "center" },
  viewerClose: { marginTop: spacing.lg, width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.14)", alignItems: "center", justifyContent: "center" },
  // Calendar card
  calCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: 22, overflow: "hidden", padding: spacing.base, backgroundColor: palette.navy, ...shadow.card },
  calGlow: { position: "absolute", top: -48, right: -40, width: 144, height: 144, borderRadius: 72, backgroundColor: "rgba(201,162,39,0.20)" },
  calIcon: { width: 48, height: 48, borderRadius: 16, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  calChevron: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  // Segments
  segment: { flexDirection: "row", gap: 4, backgroundColor: palette.white, borderRadius: radii.pill, padding: 5, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: radii.pill },
  segBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  // Search
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.white, borderRadius: radii.pill, paddingHorizontal: spacing.base, height: 48, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  searchInput: { flex: 1, color: palette.ink, fontSize: 14, paddingVertical: 0 },
  chip: { paddingHorizontal: spacing.base, height: 36, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  // Generic card
  card: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  emptyTile: { width: 52, height: 52, borderRadius: 16, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  // Event card
  eventCard: { backgroundColor: palette.white, borderRadius: 22, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  cover: { height: 158, overflow: "hidden" },
  coverImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  coverShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "60%", backgroundColor: "rgba(11,31,51,0.42)" },
  coverDate: { position: "absolute", top: 12, left: 12, backgroundColor: palette.white, borderRadius: 14, width: 48, height: 48, alignItems: "center", justifyContent: "center", ...shadow.card },
  coverBadges: { position: "absolute", top: 12, right: 12, flexDirection: "row", alignItems: "center", gap: 6 },
  liveBadgeSm: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.success, borderRadius: radii.pill, paddingHorizontal: 8, height: 22 },
  popularBadge: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(11,31,51,0.55)", borderRadius: radii.pill, paddingHorizontal: 8, height: 22, justifyContent: "center" },
  saveBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(11,31,51,0.45)", alignItems: "center", justifyContent: "center" },
  countdownChip: { position: "absolute", bottom: 10, left: 12, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(11,31,51,0.5)", borderRadius: radii.pill, paddingHorizontal: 8, height: 20 },
  seriesTag: { position: "absolute", bottom: 10, right: 12, borderRadius: radii.pill, paddingHorizontal: 8, height: 20, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.border },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 12, height: 32 },
  // Series rows
  seriesRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  seriesDot: { width: 38, height: 38, borderRadius: 12, borderWidth: 1 },
  newChip: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 8, height: 18, alignItems: "center", justifyContent: "center" },
  followBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, height: 34, backgroundColor: palette.white },
  followingBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 14, height: 34, backgroundColor: palette.navy },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  // Announcements
  annRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  annIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  annThumbWrap: { width: 48, height: 48, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  annThumb: { width: 48, height: 48, borderRadius: 14, backgroundColor: palette.mutedBg },
  annPlay: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  annVideoChip: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", marginTop: 4, backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  // Cell
  cellTile: { flexGrow: 1, flexBasis: "46%", minWidth: 140, backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  openCellBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.navy, borderRadius: radii.pill, height: 48, marginTop: spacing.base },
} as const;
