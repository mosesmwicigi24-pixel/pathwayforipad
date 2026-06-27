// Events ("Gathered together" make). Event-centric tab: a navy header, a LIVE/next
// hero with check-in, a week strip, Today/Upcoming/My-RSVPs segments, search +
// category chips, photo-forward event cards (category badge, going count, RSVP
// state), "Series you follow" (real follow toggle), announcements, and the
// member's cell summary. Every section is bound to the database — calendar
// occurrences, RSVPs, series follows, announcements, cell summary. Decorative make
// elements with no data source (Moments gallery, "We missed you") are omitted.
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Image, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import {
  CalendarDays, Check, ChevronRight, Clock, MapPin, Megaphone, Play, QrCode, Search, Sparkles, Users,
} from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import type { CalendarOccurrence, EventSeries, MyAnnouncement } from "../api/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { useCalendar, useCellSummary, useEventSeries, useMyAnnouncements, useMyRsvps, queryKeys } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries, refreshQueries } from "../api/query";
import { Loading } from "../components/states";
import { NotificationBell } from "../components/NotificationBell";
import { Avatar } from "../components/Avatar";
import {
  sameDay, isLive, weekStrip, monthLabel, todayLabel, timeOf, timeRange,
  matchesCategory, matchesSearch, categoryColor, timeAgo, EVENT_CATEGORIES,
} from "./eventHelpers";

type Segment = "today" | "upcoming" | "rsvps";

// A real, license-free worship image for the Psalm 122:1 banner.
const GLAD_IMG = "https://images.unsplash.com/photo-1438232992991-995b7058bbb3?auto=format&fit=crop&w=1200&q=80";

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

  const [segment, setSegment] = useState<Segment>("today");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("All");
  const [refreshing, setRefreshing] = useState(false);
  const [followBusy, setFollowBusy] = useState<string | null>(null);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchRsvps(), refetchAnnouncements(), refetchSeries(), refetchCell()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchRsvps, refetchAnnouncements, refetchSeries, refetchCell]);

  const all = occurrences ?? [];
  const today = new Date(now);
  const rsvpByEvent = useMemo(() => new Map((rsvps ?? []).map((r) => [r.event_id, r.status])), [rsvps]);

  // The hero: a live event if one is happening, else the next upcoming one.
  const live = all.find((o) => isLive(o, now));
  const nextUp = all.filter((o) => new Date(o.start_at).getTime() >= now).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
  const hero = live ?? nextUp ?? null;

  const todayEvents = all.filter((o) => sameDay(new Date(o.start_at), today));
  const upcoming = all.filter((o) => new Date(o.start_at).getTime() > now && !sameDay(new Date(o.start_at), today));
  const rsvpEvents = all.filter((o) => { const s = rsvpByEvent.get(o.occurrence_id); return s === "going" || s === "maybe"; });

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
  const sectionTitle = segment === "today" ? "Today's gatherings" : segment === "upcoming" ? "Upcoming gatherings" : "Your RSVPs";

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

  const strip = weekStrip(all, now);
  const cell = cellSummary?.cell ?? null;

  return (
    <View style={st.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarSpace }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {/* Header */}
        <View style={st.header}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <CalendarDays size={13} color={palette.gold} />
                <T variant="micro" tone="gold" style={st.kicker}>EVENTS</T>
              </View>
              <T serif tone="onNavy" style={{ fontSize: 30, marginTop: 4 }}>Gathered together</T>
              <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>Today · {todayLabel(now)} · East Africa Time</T>
            </View>
            <NotificationBell />
          </View>

          {/* LIVE / next hero */}
          {hero ? (
            <View style={st.hero}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  {live ? (
                    <View style={st.liveBadge}><View style={st.liveDot} /><T variant="micro" style={{ color: "#fff", fontWeight: "800" }}>LIVE</T></View>
                  ) : (
                    <View style={st.nextBadge}><T variant="micro" style={{ color: palette.navy, fontWeight: "800" }}>UP NEXT</T></View>
                  )}
                  {hero.category ? <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 1 }}>{hero.category.toUpperCase()}</T> : null}
                </View>
                <View style={st.qrChip}><QrCode size={16} color={palette.gold} /></View>
              </View>
              <T serif tone="onNavy" style={{ fontSize: 22, marginTop: spacing.md }}>{hero.title}</T>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.sm }}>
                <View style={st.heroMeta}><Clock size={14} color={palette.gold} /><T variant="caption" tone="onNavyDim">{timeRange(hero.start_at, hero.end_at)}</T></View>
                {hero.location ? <View style={st.heroMeta}><MapPin size={14} color={palette.gold} /><T variant="caption" tone="onNavyDim" numberOfLines={1}>{hero.location}</T></View> : null}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={live ? "Check in" : "View details"} onPress={() => openEvent(hero)} style={({ pressed }) => [st.checkInBtn, pressed && { opacity: 0.9 }]}>
                <QrCode size={18} color={palette.navy} />
                <T variant="label" style={{ color: palette.navy, fontWeight: "800", letterSpacing: 0.5 }}>{live ? "CHECK IN" : "VIEW DETAILS"}</T>
                <ChevronRight size={16} color={palette.navy} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
          {/* Week strip */}
          <View style={st.weekCard}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm }}>
              <T variant="overline" tone="gold">{monthLabel(now)}</T>
              <T variant="micro" tone="secondary" style={{ fontWeight: "700" }}>TODAY</T>
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {strip.map((d) => (
                <View key={d.iso} style={st.dayCol}>
                  <T variant="micro" tone="tertiary">{d.dow}</T>
                  <View style={[st.dayPill, d.isToday && { backgroundColor: palette.navy }]}>
                    <T serif style={{ fontSize: 17, color: d.isToday ? palette.onNavy : palette.ink }}>{d.day}</T>
                  </View>
                  <View style={[st.dayDot, d.hasEvent ? { backgroundColor: palette.gold } : { backgroundColor: "transparent" }]} />
                </View>
              ))}
            </View>
          </View>

          {/* Segments */}
          <View style={st.segment}>
            {SEGMENTS.map((s) => {
              const on = segment === s.key;
              return (
                <Pressable key={s.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setSegment(s.key)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                  <T variant="caption" style={{ fontWeight: on ? "700" : "400", color: on ? palette.white : palette.ink600 }}>{s.label}</T>
                  <View style={[st.segBadge, { backgroundColor: on ? palette.gold : palette.surface }]}>
                    <T variant="micro" style={{ color: on ? palette.navy : palette.ink600, fontWeight: "800" }}>{counts[s.key]}</T>
                  </View>
                </Pressable>
              );
            })}
          </View>

          {/* Search */}
          <View style={st.search}>
            <Search size={18} color={palette.ink400} />
            <TextInput value={query} onChangeText={setQuery} placeholder="Search events by name or place" placeholderTextColor={palette.ink400} accessibilityLabel="Search events" style={st.searchInput} />
          </View>

          {/* Category chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
            {EVENT_CATEGORIES.map((c) => {
              const on = category === c;
              return (
                <Pressable key={c} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setCategory(c)} style={[st.chip, on ? { backgroundColor: palette.navy, borderColor: palette.navy } : null]}>
                  <T variant="caption" style={{ color: on ? palette.white : palette.ink600, fontWeight: on ? "700" : "500" }}>{c}</T>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Section header */}
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xs }}>
            <T serif style={{ fontSize: 20, color: palette.ink }}>{sectionTitle}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="All and calendar" onPress={() => nav.navigate("Calendar")} style={({ pressed }) => pressed && { opacity: 0.7 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>All &amp; calendar</T>
                <ChevronRight size={14} color={palette.navy} />
              </View>
            </Pressable>
          </View>

          {/* Scripture banner — Psalm 122:1 */}
          <View style={st.gladBanner}>
            <Image source={{ uri: GLAD_IMG }} style={st.gladImg} resizeMode="cover" />
            <View style={st.gladShade} />
            <View style={st.gladBody}>
              <T serif tone="onNavy" style={{ fontSize: 19, lineHeight: 26 }}>
                “I was glad when they said to me, ‘Let us go to the house of the LORD.’”
              </T>
              <T variant="micro" tone="gold" style={{ marginTop: 6, letterSpacing: 1.2, fontWeight: "700" }}>PSALM 122:1</T>
            </View>
          </View>

          {/* Event cards */}
          {isLoading ? (
            <Loading label="Loading gatherings…" />
          ) : error ? (
            <View style={st.card}><T variant="heading">Couldn't load events</T><T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{errorMessage(error)}</T></View>
          ) : list.length === 0 ? (
            <View style={[st.card, { alignItems: "center", paddingVertical: spacing.xl }]}>
              <View style={st.emptyTile}><CalendarDays size={22} color={palette.gold} /></View>
              <T variant="heading" style={{ marginTop: spacing.md }}>
                {segment === "today" ? "Nothing today" : segment === "upcoming" ? "Nothing coming up" : "No RSVPs yet"}
              </T>
              <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center", maxWidth: 260 }}>
                {segment === "rsvps" ? "Tap an event to say you'll be there." : "New gatherings appear here as they're scheduled."}
              </T>
            </View>
          ) : (
            list.map((o) => (
              <EventCard key={o.occurrence_id} occ={o} live={isLive(o, now)} status={rsvpByEvent.get(o.occurrence_id) ?? null} onPress={() => openEvent(o)} />
            ))
          )}

          {/* Series you follow */}
          {(series ?? []).length > 0 ? (
            <View style={st.card}>
              <View style={st.cardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Sparkles size={13} color={palette.goldLo} />
                  <T variant="overline" tone="gold">SERIES YOU FOLLOW</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("Calendar")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>See all</T></Pressable>
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
                  <View style={[st.seriesDot, { backgroundColor: `${categoryColor(s.category)}22`, borderColor: categoryColor(s.category) }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{s.title}</T>
                      {s.following && s.new_count > 0 ? <View style={st.newChip}><T variant="micro" style={{ color: palette.goldChipText, fontWeight: "800" }}>{s.new_count} new</T></View> : null}
                    </View>
                    <T variant="micro" tone="tertiary" style={{ marginTop: 1 }}>{s.cadence}</T>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={s.following ? `Unfollow ${s.title}` : `Follow ${s.title}`}
                    disabled={followBusy === s.series_id}
                    onPress={() => void toggleFollow(s)}
                    style={({ pressed }) => [s.following ? st.followingBtn : st.followBtn, pressed && { opacity: 0.85 }]}
                  >
                    {s.following ? <Check size={14} color={palette.onNavy} /> : <T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>+ </T>}
                    <T variant="caption" style={{ color: s.following ? palette.onNavy : palette.navy, fontWeight: "700" }}>{s.following ? "Following" : "Follow"}</T>
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
                  <T variant="overline" tone="gold">ANNOUNCEMENTS</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("Notifications")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>See all</T></Pressable>
              </View>
              {(announcements ?? []).slice(0, 3).map((a, i, arr) => (
                <Pressable key={a.announcement_id} accessibilityRole="button" onPress={() => openAnnouncement(a)} style={[st.annRow, i < arr.length - 1 && st.divider]}>
                  <View style={st.annThumbWrap}>
                    {a.primary_image_url ? (
                      <Image source={{ uri: a.primary_image_url }} style={st.annThumb} resizeMode="contain" />
                    ) : (
                      <View style={st.annIcon}><Sparkles size={16} color={palette.goldLo} /></View>
                    )}
                    {a.video_url ? (
                      <View style={st.annPlay}><Play size={11} color="#fff" fill="#fff" /></View>
                    ) : null}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }}>
                      <T variant="heading" style={{ flex: 1, fontSize: 14 }} numberOfLines={1}>{a.title}</T>
                      <T variant="micro" tone="tertiary">{timeAgo(a.sent_at, now)}</T>
                    </View>
                    <T variant="micro" tone="secondary" style={{ marginTop: 2 }} numberOfLines={2}>{a.body}</T>
                    {a.video_url ? (
                      <View style={st.annVideoChip}><Play size={9} color={palette.navy} fill={palette.navy} /><T variant="micro" style={{ color: palette.navy, fontWeight: "700" }}>Video</T></View>
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
                  <T variant="overline" tone="gold">YOUR CELL</T>
                </View>
                <Pressable accessibilityRole="button" onPress={() => nav.navigate("CohortDiscussions")}><T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>Open</T></Pressable>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm }}>
                <CellTile label="CELL" value={cell.name} sub={`${cell.members} ${cell.members === 1 ? "member" : "members"}`} />
                <CellTile label="ATTENDANCE" value={`${cell.attendance.attended} of ${cell.attendance.expected}`} sub="This month" />
                <CellTile
                  label="NEXT"
                  value={cell.next ? `${new Date(cell.next.start_at).toLocaleDateString("en-US", { weekday: "short" })} ${timeOf(cell.next.start_at)}` : "—"}
                  sub={cell.next?.location ?? "No meeting scheduled"}
                />
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Open cell space" onPress={() => nav.navigate("CohortDiscussions")} style={({ pressed }) => [st.openCellBtn, pressed && { opacity: 0.9 }]}>
                <T variant="label" style={{ color: palette.onNavy, fontWeight: "700" }}>Open cell space</T>
                <ChevronRight size={16} color={palette.onNavy} />
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

function EventCard({ occ, live, status, onPress }: { occ: CalendarOccurrence; live: boolean; status: string | null; onPress: () => void }): ReactElement {
  const d = new Date(occ.start_at);
  const accent = categoryColor(occ.category);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={occ.title} onPress={onPress} style={({ pressed }) => [st.eventCard, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={st.cover}>
        <GradientBg colors={[palette.navy700, palette.navy, accent]} radius={0} />
        <View style={st.coverDate}>
          <T variant="micro" style={{ color: palette.navy, fontWeight: "700" }}>{d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</T>
          <T serif style={{ fontSize: 20, color: palette.navy }}>{d.getDate()}</T>
        </View>
        <View style={st.coverBadges}>
          {live ? <View style={st.liveBadge}><View style={st.liveDot} /><T variant="micro" style={{ color: "#fff", fontWeight: "800" }}>LIVE</T></View> : null}
          {occ.category ? <View style={[st.catBadge, { backgroundColor: accent }]}><T variant="micro" style={{ color: "#fff", fontWeight: "800", letterSpacing: 0.5 }}>{occ.category.toUpperCase()}</T></View> : null}
        </View>
      </View>
      <View style={{ padding: spacing.base }}>
        <T serif style={{ fontSize: 18, color: palette.ink }} numberOfLines={1}>{occ.title}</T>
        {occ.description ? <T variant="caption" tone="secondary" style={{ marginTop: 4 }} numberOfLines={2}>{occ.description}</T> : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.base, marginTop: spacing.sm }}>
          <View style={st.metaRow}><Clock size={12} color={palette.ink600} /><T variant="micro" tone="secondary">{timeRange(occ.start_at, occ.end_at)}</T></View>
          {occ.location ? <View style={st.metaRow}><MapPin size={12} color={palette.ink600} /><T variant="micro" tone="secondary" numberOfLines={1}>{occ.location}</T></View> : null}
        </View>
        <View style={st.cardFooter}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            {occ.attendees && occ.attendees.length > 0 ? (
              <View style={{ flexDirection: "row" }}>
                {occ.attendees.slice(0, 4).map((a, i) => (
                  <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 13, borderWidth: 2, borderColor: palette.white }}>
                    <Avatar uri={a.avatar_url} name={a.full_name} size={22} />
                  </View>
                ))}
              </View>
            ) : (
              <Users size={13} color={palette.ink600} />
            )}
            <T variant="caption" tone="secondary">{occ.going > 0 ? `${occ.going} going` : "Be the first to RSVP"}</T>
          </View>
          <StatusPill status={status} />
        </View>
      </View>
    </Pressable>
  );
}

function StatusPill({ status }: { status: string | null }): ReactElement {
  if (status === "going") return <View style={[st.statusPill, { backgroundColor: palette.successBg }]}><Check size={13} color={palette.successText} /><T variant="caption" style={{ color: palette.successText, fontWeight: "800" }}>GOING</T></View>;
  if (status === "maybe") return <View style={[st.statusPill, { backgroundColor: palette.goldChipBg }]}><T variant="caption" style={{ color: palette.goldChipText, fontWeight: "800" }}>+ MAYBE</T></View>;
  return <View style={[st.statusPill, { backgroundColor: palette.navy }]}><T variant="caption" style={{ color: palette.onNavy, fontWeight: "800" }}>RSVP</T></View>;
}

function CellTile({ label, value, sub }: { label: string; value: string; sub: string }): ReactElement {
  return (
    <View style={st.cellTile}>
      <T variant="micro" tone="gold" style={{ fontWeight: "700", letterSpacing: 0.8 }}>{label}</T>
      <T serif style={{ fontSize: 16, color: palette.ink, marginTop: 2 }} numberOfLines={1}>{value}</T>
      <T variant="micro" tone="tertiary" style={{ marginTop: 1 }} numberOfLines={1}>{sub}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.paper },
  gladBanner: { height: 150, borderRadius: radii.card, overflow: "hidden", justifyContent: "flex-end", backgroundColor: palette.navy },
  gladImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  gladShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.55)" },
  gladBody: { padding: spacing.base },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 58, paddingBottom: spacing.lg, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden" },
  kicker: { letterSpacing: 2.4, fontWeight: "600" },
  hero: { backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 20, borderWidth: 1, borderColor: "rgba(201,162,39,0.25)", padding: spacing.base, marginTop: spacing.lg },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: palette.success, borderRadius: radii.pill, paddingHorizontal: 10, height: 24 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#fff" },
  nextBadge: { backgroundColor: palette.gold, borderRadius: radii.pill, paddingHorizontal: 10, height: 24, alignItems: "center", justifyContent: "center" },
  qrChip: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  heroMeta: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  checkInBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.gold, borderRadius: radii.pill, height: 52, marginTop: spacing.base },
  weekCard: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  dayCol: { alignItems: "center", gap: 6, width: 38 },
  dayPill: { width: 38, height: 48, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 5, height: 5, borderRadius: 3 },
  segment: { flexDirection: "row", gap: 4, backgroundColor: palette.white, borderRadius: radii.pill, padding: 5, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: radii.pill },
  segBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: palette.white, borderRadius: radii.pill, paddingHorizontal: spacing.base, height: 48, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  searchInput: { flex: 1, color: palette.ink, fontSize: 15, paddingVertical: 0 },
  chip: { paddingHorizontal: spacing.base, height: 38, borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.white, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  emptyTile: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
  eventCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  cover: { height: 150, overflow: "hidden" },
  coverDate: { position: "absolute", top: 14, left: 14, backgroundColor: palette.white, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6, alignItems: "center", ...shadow.card },
  coverBadges: { position: "absolute", top: 14, right: 14, flexDirection: "row", gap: 6 },
  catBadge: { borderRadius: radii.pill, paddingHorizontal: 10, height: 24, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  cardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.border },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 14, height: 34 },
  seriesRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  seriesDot: { width: 40, height: 40, borderRadius: 20, borderWidth: 2 },
  newChip: { backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 8, height: 18, alignItems: "center", justifyContent: "center" },
  followBtn: { flexDirection: "row", alignItems: "center", borderRadius: radii.pill, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, height: 36, backgroundColor: palette.white },
  followingBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: radii.pill, paddingHorizontal: 14, height: 36, backgroundColor: palette.navy },
  divider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  annRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  annIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  annThumbWrap: { width: 48, height: 48, borderRadius: 14, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  annThumb: { width: 48, height: 48, borderRadius: 14, backgroundColor: palette.mutedBg },
  annPlay: { position: "absolute", width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center" },
  annVideoChip: { flexDirection: "row", alignItems: "center", gap: 3, alignSelf: "flex-start", marginTop: 4, backgroundColor: palette.goldChipBg, borderRadius: radii.pill, paddingHorizontal: 7, paddingVertical: 2 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  cellTile: { flexGrow: 1, flexBasis: "46%", minWidth: 140, backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  openCellBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, backgroundColor: palette.navy, borderRadius: radii.pill, height: 50, marginTop: spacing.base },
} as const;
