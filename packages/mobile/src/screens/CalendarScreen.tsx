// Calendar (Figma "EventsCalendarPage"). A redesigned month grid over the church
// + pathway schedule: a "Today" pill, a gold ring on today's cell, a navy
// gradient tile for the selected day (with a tap-scale animation), event dots
// under days color-coded by series with a matching legend, a list header that
// counts the selected day's events, and a warm empty state. Data is the real
// server projection (GET /v1/calendar over the visible month range, §3); the
// calendar module owns recurrence/visibility scoping server-side.
import { useMemo, useRef, useState, type ReactElement } from "react";
import { Animated, Pressable, ScrollView, View } from "react-native";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Users } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { useCalendar } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";
import { Avatar } from "../components/Avatar";
import { CommunityPageHeader } from "../components/CommunityPageHeader";
import type { CalendarOccurrence } from "../api/types";

const WEEK_DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// A small palette of accent colors for series dots/legend. A series's color is
// derived from a stable hash of its id (falling back to its title), so the same
// series always lands on the same swatch — and the legend reuses the exact map.
const SERIES_PALETTE = [
  palette.gold,
  "#6366f1",
  "#0ea5e9",
  "#16a34a",
  "#a855f7",
  "#dc2626",
  "#0d9488",
  "#d97706",
] as const;

function hashColor(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return SERIES_PALETTE[Math.abs(h) % SERIES_PALETTE.length] as string;
}
function seriesColor(e: CalendarOccurrence): string {
  return hashColor(e.series_id || e.title);
}
function seriesLabel(e: CalendarOccurrence): string {
  return e.category?.trim() || e.title;
}

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

  // The viewed month contains "today" only at offset 0 — gold ring + Today pill.
  const isCurrentMonth = monthOffset === 0;
  const todayDate = today.getDate();

  const fromIso = `${year}-${pad(month + 1)}-01T00:00:00.000Z`;
  const toIso = `${year}-${pad(month + 1)}-${pad(daysInMonth)}T23:59:59.000Z`;
  const { data: events, isLoading, error, refetch } = useCalendar(fromIso, toIso);

  const list = events ?? [];
  const dayOf = (e: CalendarOccurrence): number => new Date(e.start_at).getDate();
  const selectedEvents = list
    .filter((e) => dayOf(e) === selectedDay)
    .sort((a, b) => a.start_at.localeCompare(b.start_at)); // earliest first → later in the day
  const upcomingCount = list.filter((e) => new Date(e.start_at).getTime() >= today.getTime()).length;

  // Distinct series present this month → the dot/legend mapping (stable color per
  // series, shared by the grid dots and the legend below it).
  const legend = useMemo(() => {
    const seen = new Map<string, { label: string; color: string }>();
    for (const e of list) {
      const key = e.series_id || e.title;
      if (!seen.has(key)) seen.set(key, { label: seriesLabel(e), color: seriesColor(e) });
    }
    return Array.from(seen.values()).slice(0, 6);
  }, [list]);

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
      <CommunityPageHeader
        eyebrow="Events"
        title={monthLabel}
        subtitle={`${upcomingCount} upcoming · ${monthLabel}`}
        onBack={() => nav.goBack()}
      />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: spacing.screen, paddingBottom: spacing.xxl }}>
        {isLoading ? (
          <Loading label="Loading events…" />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <>
            {/* Month card */}
            <View style={st.grid}>
              <View style={st.monthHead}>
                <T variant="title" serif style={{ fontSize: 17 }}>
                  {MONTHS[month]} <T variant="title" serif tone="tertiary" style={{ fontSize: 17 }}>{year}</T>
                </T>
                <View style={st.monthControls}>
                  {isCurrentMonth ? (
                    <Pressable
                      onPress={() => setSelectedDay(todayDate)}
                      style={({ pressed }) => [st.todayPill, pressed && st.press]}
                      accessibilityRole="button"
                      accessibilityLabel="Jump to today"
                    >
                      <T variant="micro" style={st.todayPillText}>TODAY</T>
                    </Pressable>
                  ) : null}
                  <View style={st.stepper}>
                    <Pressable onPress={() => setMonthOffset((m) => m - 1)} style={({ pressed }) => [st.stepBtn, pressed && st.press]} accessibilityRole="button" accessibilityLabel="Previous month">
                      <ChevronLeft size={18} color={palette.ink600} />
                    </Pressable>
                    <Pressable onPress={() => setMonthOffset((m) => m + 1)} style={({ pressed }) => [st.stepBtn, pressed && st.press]} accessibilityRole="button" accessibilityLabel="Next month">
                      <ChevronRight size={18} color={palette.ink600} />
                    </Pressable>
                  </View>
                </View>
              </View>

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
                  const evs = list.filter((e) => dayOf(e) === day);
                  const dots = Array.from(new Set(evs.map(seriesColor))).slice(0, 3);
                  const selected = selectedDay === day;
                  const isToday = isCurrentMonth && day === todayDate;
                  return (
                    <DayCell
                      key={day}
                      day={day}
                      selected={selected}
                      isToday={isToday}
                      dots={dots}
                      onPress={() => setSelectedDay(day)}
                    />
                  );
                })}
              </View>

              {/* Legend — dot color → series, the same mapping the grid dots use */}
              {legend.length > 0 ? (
                <View style={st.legend}>
                  {legend.map((s) => (
                    <View key={s.label} style={st.legendItem}>
                      <View style={[st.legendDot, { backgroundColor: s.color }]} />
                      <T variant="micro" tone="secondary" numberOfLines={1} style={st.legendText}>{s.label}</T>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>

            {/* Selected day list header with the event count */}
            <View style={st.dayHead}>
              <T variant="title" style={{ fontSize: 18 }}>{`${MONTHS[month]} ${selectedDay}`}</T>
              <View style={st.countPill}>
                <T variant="micro" style={st.countText}>
                  {`${selectedEvents.length} event${selectedEvents.length === 1 ? "" : "s"}`}
                </T>
              </View>
            </View>

            <View style={{ gap: spacing.md }}>
              {selectedEvents.length ? (
                selectedEvents.map((e) => (
                  <Pressable key={e.occurrence_id} onPress={() => openEvent(e)} style={({ pressed }) => [st.eventCard, pressed && st.press]}>
                    <View style={[st.eventStripe, { backgroundColor: seriesColor(e) }]} />
                    <View style={[st.eventIcon, { backgroundColor: `${seriesColor(e)}1A` }]}>
                      <CalendarDays size={20} color={seriesColor(e)} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <T variant="heading" style={{ fontSize: 15, flexShrink: 1 }}>{e.title}</T>
                      <View style={st.eventMeta}><Clock size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{timeLabel(e.start_at)}</T></View>
                      {e.location ? (
                        <View style={st.eventMeta}><MapPin size={14} color={palette.ink600} /><T variant="caption" tone="secondary">{e.location}</T></View>
                      ) : null}
                      {/* Who's coming — a few faces of those attending */}
                      <View style={[st.eventMeta, { alignItems: "center" }]}>
                        {e.attendees && e.attendees.length > 0 ? (
                          <View style={{ flexDirection: "row", marginRight: 2 }}>
                            {e.attendees.slice(0, 4).map((a, i) => (
                              <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -8, borderRadius: 12, borderWidth: 2, borderColor: palette.white }}>
                                <Avatar uri={a.avatar_url} name={a.full_name} size={20} />
                              </View>
                            ))}
                          </View>
                        ) : (
                          <Users size={14} color={palette.ink600} />
                        )}
                        <T variant="caption" tone="secondary">{e.going > 0 ? `${e.going} going` : "Be the first to RSVP"}</T>
                      </View>
                    </View>
                  </Pressable>
                ))
              ) : (
                <View style={st.empty}>
                  <View style={st.emptyIcon}>
                    <CalendarDays size={22} color={palette.gold} />
                  </View>
                  <T variant="heading" style={{ fontSize: 15, marginTop: spacing.md }}>A quiet day</T>
                  <T variant="caption" tone="secondary" style={{ marginTop: 4, textAlign: "center" }}>Nothing scheduled here yet. Pick another day to find services, classes, and gatherings.</T>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

// A single day in the grid. Selected = navy gradient tile (with an Animated
// scale-down on press); today = a gold ring; otherwise plain. Event dots sit
// under the number, color-coded by series (white on the selected navy tile).
function DayCell({
  day,
  selected,
  isToday,
  dots,
  onPress,
}: {
  day: number;
  selected: boolean;
  isToday: boolean;
  dots: string[];
  onPress: () => void;
}): ReactElement {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number): void => {
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 50, bounciness: 6 }).start();
  };
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => press(0.9)}
      onPressOut={() => press(1)}
      style={st.dayCell}
      accessibilityRole="button"
      accessibilityLabel={`Day ${day}`}
    >
      <Animated.View
        style={[
          st.dayInner,
          isToday && !selected && st.dayToday,
          { transform: [{ scale }] },
        ]}
      >
        {selected ? <GradientBg colors={[palette.navy700, palette.navyDeep]} radius={radii.control} /> : null}
        <T variant="caption" style={{ color: selected ? palette.onNavy : isToday ? palette.goldLo : palette.ink, fontWeight: selected || isToday ? "700" : "600" }}>{day}</T>
      </Animated.View>
      <View style={st.dotRow}>
        {dots.map((c, i) => (
          <View key={i} style={[st.dayDot, { backgroundColor: selected ? "rgba(255,255,255,0.9)" : c }]} />
        ))}
      </View>
    </Pressable>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  grid: { backgroundColor: palette.white, borderRadius: 28, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  monthHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.md },
  monthControls: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  todayPill: { borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: "rgba(201,162,39,0.12)" },
  todayPillText: { color: palette.goldLo, letterSpacing: 1.2, fontWeight: "700" },
  weekRow: { flexDirection: "row", marginBottom: spacing.sm },
  weekCell: { flex: 1, textAlign: "center", fontWeight: "700" },
  daysWrap: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, height: 48, alignItems: "center", justifyContent: "center" },
  dayInner: { width: 38, height: 38, borderRadius: radii.control, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  dayToday: { borderWidth: 1.5, borderColor: palette.gold },
  dotRow: { flexDirection: "row", gap: 3, height: 5, marginTop: 3, alignItems: "center" },
  dayDot: { width: 4, height: 4, borderRadius: 2 },
  legend: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md, marginTop: spacing.base, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: palette.border },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "46%" },
  legendDot: { width: 7, height: 7, borderRadius: 4 },
  legendText: { fontWeight: "600", flexShrink: 1 },
  dayHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md, paddingHorizontal: 4 },
  countPill: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: palette.navy },
  countText: { color: palette.onNavy, fontWeight: "700", letterSpacing: 0.3 },
  eventCard: { flexDirection: "row", gap: spacing.md, backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.base, overflow: "hidden", ...shadow.card },
  eventStripe: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  eventIcon: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  eventMeta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.sm },
  empty: { backgroundColor: palette.white, borderRadius: 24, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, alignItems: "center", ...shadow.card },
  emptyIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(201,162,39,0.10)", alignItems: "center", justifyContent: "center" },
  stepper: { flexDirection: "row", gap: spacing.xs },
  stepBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border },
  press: { transform: [{ scale: 0.96 }], opacity: 0.9 },
} as const;
