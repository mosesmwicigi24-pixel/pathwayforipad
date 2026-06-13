// Community (new design, spec §10 — event-centric). Navy header, segment pills
// (Today / Upcoming / My RSVPs), photo-forward event cards, an entry to the
// cohort discussions board, and real announcements. Every section is bound to
// the database: useCalendar (occurrences), useMyRsvps, useMyAnnouncements,
// useNotifications (bell badge). Tapping an event opens EventDetail (real RSVP).
import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { Bell, CalendarDays, ChevronRight, Clock, MapPin, MessageSquareText, Users } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
import { GradientBg, Glow, T } from "../theme/components";
import { useCalendar, useMyAnnouncements, useMyRsvps, useNotifications } from "../api/hooks";
import { NuruApi } from "../api/client";
import { errorMessage, invalidateQueries } from "../api/query";
import { Loading } from "../components/states";
import type { CalendarOccurrence } from "../api/types";

type Segment = "today" | "upcoming" | "rsvps";

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function CommunityScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [fromIso, toIso] = useMemo(() => {
    const now = new Date();
    return [now.toISOString(), new Date(now.getTime() + 30 * 86_400_000).toISOString()];
  }, []);
  const { data: occurrences, isLoading, error, refetch } = useCalendar(fromIso, toIso);
  const { data: rsvps, refetch: refetchRsvps } = useMyRsvps();
  const { data: announcements, refetch: refetchAnnouncements } = useMyAnnouncements();
  const { data: notifications } = useNotifications();
  const [segment, setSegment] = useState<Segment>("today");
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refetch(), refetchRsvps(), refetchAnnouncements()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchRsvps, refetchAnnouncements]);

  const all = occurrences ?? [];
  const today = new Date();
  const todayEvents = all.filter((e) => sameDay(new Date(e.start_at), today));
  const upcoming = all.filter((e) => new Date(e.start_at).getTime() > today.getTime());
  const rsvpList = (rsvps ?? []).filter((r) => r.status !== "declined");
  const unread = notifications?.unread ?? 0;

  const counts = { today: todayEvents.length, upcoming: upcoming.length, rsvps: rsvpList.length };
  const SEGMENTS: Array<{ key: Segment; label: string }> = [
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "rsvps", label: "My RSVPs" },
  ];

  const openOccurrence = (e: CalendarOccurrence): void =>
    nav.navigate("EventDetail", { eventId: e.occurrence_id, title: e.title, startAt: e.start_at, endAt: e.end_at, location: e.location });

  function openAnnouncement(id: string): void {
    void NuruApi.openAnnouncement(id)
      .then(() => {
        invalidateQueries("myAnnouncements");
        void refetchAnnouncements();
      })
      .catch(() => undefined);
  }

  const list = segment === "today" ? todayEvents : segment === "upcoming" ? upcoming : null;

  return (
    <View style={st.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: tabBarSpace }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={palette.gold} />}
      >
        {/* Navy header */}
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -70, top: -70 }} />
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="micro" tone="gold" style={st.kicker}>COMMUNITY</T>
              <T serif tone="onNavy" style={st.h1}>Gathered together</T>
              <T variant="caption" tone="onNavyDim" style={{ marginTop: 4 }}>
                {today.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} · EAT
              </T>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => nav.navigate("Notifications")} style={st.bellBtn}>
              <Bell size={20} color={palette.onNavy} strokeWidth={1.8} />
              {unread > 0 ? <View style={st.bellDot} /> : null}
            </Pressable>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.base, gap: spacing.base }}>
          {/* Segment pills */}
          <View style={st.segment}>
            {SEGMENTS.map((s) => {
              const on = segment === s.key;
              return (
                <Pressable key={s.key} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setSegment(s.key)} style={[st.segItem, on && { backgroundColor: palette.navy }]}>
                  <T variant="caption" style={{ fontWeight: on ? "600" : "400", color: on ? palette.white : palette.ink600 }}>{s.label}</T>
                  {counts[s.key] > 0 ? (
                    <View style={[st.segBadge, { backgroundColor: on ? "rgba(201,162,39,0.25)" : palette.surface }]}>
                      <T variant="micro" style={{ color: on ? palette.goldGlow : palette.ink600, fontWeight: "700" }}>{counts[s.key]}</T>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>

          {/* Event list */}
          {isLoading ? (
            <Loading label="Loading gatherings…" />
          ) : error ? (
            <View style={st.card}>
              <T variant="heading">Couldn't load events</T>
              <T variant="caption" tone="secondary" style={{ marginTop: 4 }}>{errorMessage(error)}</T>
            </View>
          ) : segment === "rsvps" ? (
            rsvpList.length > 0 ? (
              rsvpList.map((r) => (
                <Pressable
                  key={r.rsvp_id}
                  onPress={() => nav.navigate("EventDetail", { eventId: r.event_id, title: r.title, startAt: r.occurs_at })}
                  style={({ pressed }) => [st.eventCard, pressed && { transform: [{ scale: 0.99 }] }]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
                    <View style={st.dateChip}>
                      <T variant="micro" style={{ color: palette.gold, fontWeight: "700" }}>{new Date(r.occurs_at).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</T>
                      <T serif tone="onNavy" style={{ fontSize: 18 }}>{String(new Date(r.occurs_at).getDate())}</T>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="heading" style={{ fontSize: 15 }} numberOfLines={1}>{r.title}</T>
                      <T variant="micro" tone="tertiary" style={{ marginTop: 2 }}>{`${timeLabel(r.occurs_at)} · You're ${r.status}`}</T>
                    </View>
                    <ChevronRight size={16} color={palette.ink300} />
                  </View>
                </Pressable>
              ))
            ) : (
              <EmptyState icon={<CalendarDays size={22} color={palette.gold} />} title="No RSVPs yet" sub="Tap an event under Today or Upcoming to say you'll be there." />
            )
          ) : (list ?? []).length > 0 ? (
            (list ?? []).map((e) => <EventCard key={e.occurrence_id} occ={e} onPress={() => openOccurrence(e)} />)
          ) : (
            <EmptyState
              icon={<CalendarDays size={22} color={palette.gold} />}
              title={segment === "today" ? "Nothing today" : "Nothing coming up"}
              sub={segment === "today" ? "Check Upcoming for what's ahead this month." : "New gatherings will appear here as they're scheduled."}
            />
          )}

          {/* Cohort discussions entry */}
          <Pressable
            accessibilityRole="button"
            onPress={() => nav.navigate("CohortDiscussions")}
            style={({ pressed }) => [st.discussCard, pressed && { transform: [{ scale: 0.99 }] }]}
          >
            <View style={st.discussTile}>
              <MessageSquareText size={20} color={palette.gold} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading" tone="onNavy" style={{ fontSize: 15 }}>Cohort discussions</T>
              <T variant="micro" tone="onNavyDim" style={{ marginTop: 2 }}>Talk with your cell between gatherings</T>
            </View>
            <ChevronRight size={18} color={palette.gold} />
          </Pressable>

          {/* Announcements (real) */}
          {(announcements ?? []).length > 0 ? (
            <View style={st.card}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm }}>
                <Users size={13} color={palette.goldLo} />
                <T variant="micro" style={{ color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4 }}>ANNOUNCEMENTS</T>
              </View>
              {(announcements ?? []).slice(0, 4).map((a, i, arr) => (
                <Pressable
                  key={a.announcement_id}
                  onPress={() => openAnnouncement(a.announcement_id)}
                  style={({ pressed }) => [st.annRow, i < arr.length - 1 && st.annDivider, pressed && { opacity: 0.85 }]}
                >
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
        </View>
      </ScrollView>
    </View>
  );
}

function EventCard({ occ, onPress }: { occ: CalendarOccurrence; onPress: () => void }): ReactElement {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [st.eventCardPhoto, pressed && { transform: [{ scale: 0.99 }] }]}>
      <View style={st.eventCover}>
        <GradientBg colors={[palette.navy700, palette.navy, palette.goldLo]} radius={0} />
        <View style={st.coverDate}>
          <T variant="micro" style={{ color: palette.navy, fontWeight: "700" }}>{new Date(occ.start_at).toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}</T>
          <T serif style={{ fontSize: 20, color: palette.navy }}>{String(new Date(occ.start_at).getDate())}</T>
        </View>
      </View>
      <View style={{ padding: spacing.base }}>
        <T serif style={{ fontSize: 17, color: palette.ink }} numberOfLines={1}>{occ.title}</T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.sm }}>
          <View style={st.metaRow}>
            <Clock size={12} color={palette.ink600} />
            <T variant="micro" tone="secondary">{timeLabel(occ.start_at)}</T>
          </View>
          {occ.location ? (
            <View style={st.metaRow}>
              <MapPin size={12} color={palette.ink600} />
              <T variant="micro" tone="secondary" numberOfLines={1}>{occ.location}</T>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function EmptyState({ icon, title, sub }: { icon: ReactElement; title: string; sub: string }): ReactElement {
  return (
    <View style={[st.card, { alignItems: "center", paddingVertical: spacing.xl }]}>
      <View style={st.emptyTile}>{icon}</View>
      <T variant="heading" style={{ marginTop: spacing.md }}>{title}</T>
      <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center", maxWidth: 260 }}>{sub}</T>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#F6F4EE" },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 58, paddingBottom: spacing.lg, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: "hidden" },
  kicker: { letterSpacing: 2.4, fontWeight: "600" },
  h1: { fontSize: 26, lineHeight: 32, marginTop: spacing.sm, fontWeight: "600" },
  bellBtn: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", top: 10, right: 10, width: 9, height: 9, borderRadius: 5, backgroundColor: palette.gold },
  segment: { flexDirection: "row", gap: 4, backgroundColor: palette.white, borderRadius: radii.control, padding: 5, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  segItem: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: 10 },
  segBadge: { minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 5, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  eventCard: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  eventCardPhoto: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  eventCover: { height: 96, overflow: "hidden" },
  coverDate: { position: "absolute", top: 12, left: 12, backgroundColor: palette.white, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, alignItems: "center" },
  dateChip: { width: 46, height: 46, borderRadius: 14, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  discussCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: palette.navyDeep, borderRadius: 20, borderWidth: 1, borderColor: "rgba(201,162,39,0.33)", padding: spacing.base, ...shadow.card },
  discussTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(201,162,39,0.15)", alignItems: "center", justifyContent: "center" },
  annRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  annDivider: { borderBottomWidth: 1, borderBottomColor: palette.border },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.gold },
  emptyTile: { width: 56, height: 56, borderRadius: 18, backgroundColor: palette.surface, alignItems: "center", justifyContent: "center" },
} as const;
