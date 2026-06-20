// Event detail (new design, spec §14). Hero with the event title over a navy
// gradient, a 2×2 meta card (date / time / where / going), an about card, and
// a live RSVP control — Going / Maybe / Can't — backed by the real
// POST /events/:id/rsvp and GET /events/:id (rsvp_counts + my_rsvp). Header
// time/title/location come from the calendar occurrence the caller passed in
// (projected occurrences are virtual, so the route carries them).
import { useEffect, useState, type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Check, ChevronLeft, Clock, MapPin, Users } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, Glow, T } from "../theme/components";
import { ImageCarousel } from "../components/ImageCarousel";
import { useEvent } from "../api/hooks";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { invalidateQueries } from "../api/query";

type RsvpStatus = "going" | "maybe" | "declined";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const RSVP_OPTIONS: Array<{ key: RsvpStatus; label: string; color: string }> = [
  { key: "going", label: "Going", color: "#16A34A" },
  { key: "maybe", label: "Maybe", color: "#D97706" },
  { key: "declined", label: "Can't", color: "#9CA3AF" },
];

export function EventDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { eventId, title, startAt, endAt, location } = useRoute<RouteProp<RootStackParamList, "EventDetail">>().params;
  const { data: event, refetch } = useEvent(eventId);

  // Local RSVP mirrors the server (my_rsvp) once loaded; optimistic on tap.
  const [rsvp, setRsvp] = useState<RsvpStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (event?.my_rsvp) setRsvp(event.my_rsvp);
  }, [event?.my_rsvp]);

  const goingCount = event?.rsvp_counts?.going ?? 0;
  const timeRange = endAt ? `${timeLabel(startAt)} – ${timeLabel(endAt)}` : timeLabel(startAt);

  async function choose(status: RsvpStatus): Promise<void> {
    setRsvp(status); // optimistic
    setSaving(true);
    setError(null);
    const payload = { event_id: eventId, status, client_mutation_id: uuidv4() };
    try {
      const { queued } = await writeThrough({
        engine: getSyncEngine(),
        connectivity: getConnectivity(),
        online: () => NuruApi.rsvp(eventId, status),
        queued: { domain: "event_rsvps", op: "set", payload },
      });
      if (!queued) {
        invalidateQueries(`event:${eventId}`);
        invalidateQueries("myRsvps");
        void refetch();
      }
      // Offline: the optimistic rsvp stays; the queued mutation replays on reconnect.
    } catch {
      setError("Couldn't save your RSVP — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* Hero */}
        <View style={st.hero}>
          <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} />
          <Glow size={200} color="rgba(201,162,39,0.12)" style={{ right: -50, top: -40 }} />
          <View style={st.heroTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => nav.goBack()}
              style={({ pressed }) => [st.glassBtn, pressed && { transform: [{ scale: 0.95 }] }]}
            >
              <ChevronLeft size={20} color={palette.onNavy} />
            </Pressable>
          </View>
          <View>
            <T variant="micro" tone="gold" style={st.kicker}>EVENT</T>
            <T serif tone="onNavy" style={st.title}>{title}</T>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, marginTop: -spacing.lg }}>
          {/* Image carousel (cover + gallery) — only when the event has images */}
          {event?.images && event.images.length > 0 ? (
            <View style={{ marginBottom: spacing.base }}>
              <ImageCarousel images={event.images} height={210} />
            </View>
          ) : null}

          {/* Meta card (2×2) */}
          <View style={st.metaCard}>
            <View style={st.metaRow}>
              <MetaTile icon={<Clock size={16} color={palette.goldLo} />} label="Date" value={dateLabel(startAt)} />
              <MetaTile icon={<Clock size={16} color={palette.goldLo} />} label="Time" value={timeRange} />
            </View>
            <View style={[st.metaRow, { marginTop: spacing.md }]}>
              <MetaTile icon={<MapPin size={16} color={palette.goldLo} />} label="Where" value={location ?? "To be announced"} />
              <MetaTile icon={<Users size={16} color={palette.goldLo} />} label="Going" value={`${goingCount} ${goingCount === 1 ? "person" : "people"}`} />
            </View>
          </View>

          {/* About */}
          <View style={[st.card, { marginTop: spacing.base }]}>
            <T variant="micro" style={st.cardKicker}>ABOUT THIS GATHERING</T>
            <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, lineHeight: 22 }}>
              {event?.description?.trim()
                ? event.description
                : "Part of your church and pathway schedule. Add it to your plans and arrive a few minutes early."}
            </T>
          </View>

          {/* RSVP — real */}
          <View style={[st.card, { marginTop: spacing.base }]}>
            <T variant="micro" style={st.cardKicker}>WILL YOU BE THERE?</T>
            <View style={st.rsvpRow}>
              {RSVP_OPTIONS.map((opt) => {
                const on = rsvp === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    disabled={saving}
                    onPress={() => void choose(opt.key)}
                    style={[st.rsvpBtn, on ? { backgroundColor: opt.color, borderColor: opt.color } : { borderColor: palette.border }]}
                  >
                    {on ? <Check size={14} color={palette.white} /> : null}
                    <T variant="caption" style={{ fontWeight: "600", color: on ? palette.white : palette.ink600 }}>{opt.label}</T>
                  </Pressable>
                );
              })}
            </View>
            {rsvp === "going" ? (
              <T variant="micro" style={{ color: palette.successText, marginTop: spacing.sm }}>
                ✓ Saved · we'll remind you the day before.
              </T>
            ) : null}
            {error ? <T variant="micro" style={{ color: palette.error, marginTop: spacing.sm }}>{error}</T> : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function MetaTile({ icon, label, value }: { icon: ReactElement; label: string; value: string }): ReactElement {
  return (
    <View style={st.metaTile}>
      <View style={st.metaIcon}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <T variant="micro" tone="tertiary">{label}</T>
        <T variant="caption" style={{ fontWeight: "600", marginTop: 1 }} numberOfLines={2}>{value}</T>
      </View>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  hero: { height: 220, paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.xl, overflow: "hidden", justifyContent: "space-between" },
  heroTop: { flexDirection: "row" },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  kicker: { letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 26, lineHeight: 32, marginTop: spacing.sm, fontWeight: "600" },
  metaCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaTile: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  metaIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardKicker: { color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4 },
  rsvpRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rsvpBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 44, borderRadius: radii.control, borderWidth: 1.5 },
} as const;
