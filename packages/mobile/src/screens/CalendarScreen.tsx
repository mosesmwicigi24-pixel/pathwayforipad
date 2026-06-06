// Calendar (Figma "CalendarTab"). A month grid over the church + pathway schedule
// with an "upcoming" rail and the selected day's events below. Data is the real
// server projection (GET /v1/calendar over the visible month range, §3); the
// calendar module owns recurrence/visibility scoping server-side.
import { useMemo, useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useCalendar } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import type { CalendarOccurrence } from "../api/types";

const WEEK_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function timeLabel(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function CalendarScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const today = useMemo(() => new Date(), []);
  const [monthOffset, setMonthOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(today.getDate());

  const base = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const monthLabel = `${MONTHS[month]} ${year}`;

  const fromIso = `${year}-${pad(month + 1)}-01T00:00:00.000Z`;
  const toIso = `${year}-${pad(month + 1)}-${pad(daysInMonth)}T23:59:59.000Z`;
  const { data: events, isLoading, error, refetch } = useCalendar(fromIso, toIso);

  const list = events ?? [];
  const dayOf = (e: CalendarOccurrence): number => new Date(e.start_at).getDate();
  const selectedEvents = list.filter((e) => dayOf(e) === selectedDay);
  const upcoming = list
    .filter((e) => new Date(e.start_at).getTime() >= today.getTime())
    .slice(0, 3);

  const openEvent = (e: CalendarOccurrence): void =>
    nav.navigate("EventDetail", {
      eventId: e.occurrence_id,
      title: e.title,
      startAt: e.start_at,
      endAt: e.end_at,
      location: e.location,
    });

  return (
    <View style={st.screen}>
      {/* Navy header */}
      <View style={st.header}>
        <Glow size={240} color="rgba(201,162,39,0.10)" style={{ right: -64, top: -64 }} />
        <View style={st.headRow}>
          <View>
            <T variant="micro" tone="gold" style={st.kicker}>CALENDAR</T>
            <T tone="onNavy" style={st.monthTitle}>{monthLabel}</T>
          </View>
          <View style={st.navBtns}>
            <Pressable onPress={() => setMonthOffset((m) => m - 1)} style={st.navBtn} accessibilityLabel="Previous month">
              <ChevronLeft size={19} color="rgba(255,255,255,0.70)" />
            </Pressable>
            <Pressable onPress={() => setMonthOffset((m) => m + 1)} style={st.navBtn} accessibilityLabel="Next month">
              <ChevronRight size={19} color="rgba(255,255,255,0.70)" />
            </Pressable>
          </View>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}>
        {isLoading ? (
          <Loading label="Loading events…" />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <>
            {/* Upcoming rail */}
            {upcoming.length > 0 ? (
              <View style={st.urgentCard}>
                <View style={st.urgentHead}>
                  <Bell size={17} color={palette.urgentText} />
                  <T variant="label" style={{ color: palette.urgentText, textTransform: "uppercase", letterSpacing: 1 }}>Upcoming</T>
                </View>
                <View style={{ gap: spacing.sm }}>
                  {upcoming.map((e) => (
                    <Pressable
                      key={e.occurrence_id}
                      onPress={() => { setSelectedDay(dayOf(e)); openEvent(e); }}
                      style={({ pressed }) => [st.urgentRow, pressed && st.press]}
                    >
                      <CalendarDays size={18} color={palette.gold} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T variant="heading" style={{ fontSize: 14 }}>{e.title}</T>
                        <T variant="caption" tone="secondary">{`${MONTHS[new Date(e.start_at).getMonth()]?.slice(0, 3)} ${dayOf(e)} · ${timeLabel(e.start_at)}`}</T>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Grid */}
            <View style={st.grid}>
              <View style={st.weekRow}>
                {WEEK_DAYS.map((d, i) => (
                  <T key={`${d}-${i}`} variant="micro" tone="tertiary" style={st.weekCell}>{d}</T>
                ))}
              </View>
              <View style={st.daysWrap}>
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <View key={`blank-${i}`} style={st.dayCell} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const has = list.some((e) => dayOf(e) === day);
                  const selected = selectedDay === day;
                  return (
                    <Pressable key={day} onPress={() => setSelectedDay(day)} style={st.dayCell}>
                      <View style={[st.dayInner, selected && { backgroundColor: palette.navy }]}>
                        <T variant="caption" style={{ color: selected ? palette.gold : palette.ink, fontWeight: "600" }}>{day}</T>
                      </View>
                      {has ? <View style={[st.dayDot, { backgroundColor: palette.gold }]} /> : <View style={st.dayDotSpace} />}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Selected day events */}
            <View style={st.dayHead}>
              <T variant="title" style={{ fontSize: 18 }}>{`${MONTHS[month]} ${selectedDay}`}</T>
              <T variant="caption" tone="secondary">{`${selectedEvents.length || "No"} events`}</T>
            </View>
            <View style={{ gap: spacing.md }}>
              {selectedEvents.length ? (
                selectedEvents.map((e) => (
                  <Pressable key={e.occurrence_id} onPress={() => openEvent(e)} style={({ pressed }) => [st.eventCard, pressed && st.press]}>
                    <View style={st.eventIcon}>
                      <CalendarDays size={20} color={palette.navy} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="heading" style={{ fontSize: 15, flexShrink: 1 }}>{e.title}</T>
                      <View style={st.eventMeta}><Clock size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{timeLabel(e.start_at)}</T></View>
                      {e.location ? (
                        <View style={st.eventMeta}><MapPin size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{e.location}</T></View>
                      ) : null}
                    </View>
                  </Pressable>
                ))
              ) : (
                <View style={st.empty}>
                  <T variant="heading" style={{ fontSize: 15 }}>No events scheduled</T>
                  <T variant="caption" tone="secondary" style={{ marginTop: 2, textAlign: "center" }}>Select another day to view services, classes, and reminders.</T>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.lg, overflow: "hidden" },
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  monthTitle: { fontSize: 32, lineHeight: 38, fontWeight: "700", letterSpacing: -1.3, color: palette.onNavy, marginTop: 6 },
  navBtns: { flexDirection: "row", backgroundColor: "rgba(255,255,255,0.08)", borderRadius: radii.pill, padding: 4 },
  navBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  urgentCard: { backgroundColor: palette.urgentBg, borderRadius: 24, borderWidth: 1, borderColor: palette.urgentBorder, padding: spacing.base, marginBottom: spacing.base, ...shadow.card },
  urgentHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  urgentRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: "rgba(255,255,255,0.75)", borderRadius: 16, padding: spacing.md },
  grid: { backgroundColor: palette.white, borderRadius: 28, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  weekRow: { flexDirection: "row", marginBottom: spacing.md },
  weekCell: { flex: 1, textAlign: "center", fontWeight: "700" },
  daysWrap: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, height: 44, alignItems: "center", justifyContent: "center" },
  dayInner: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  dayDot: { width: 6, height: 6, borderRadius: 3, marginTop: 2 },
  dayDotSpace: { height: 8 },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: 4 },
  eventCard: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  eventIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: "rgba(10,37,64,0.06)", alignItems: "center", justifyContent: "center" },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm },
  empty: { backgroundColor: "rgba(255,255,255,0.70)", borderRadius: 24, borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(10,37,64,0.15)", padding: spacing.lg, alignItems: "center" },
  press: { transform: [{ scale: 0.99 }] },
} as const;
