// Event detail (Figma "make" redesign). A parallax cover hero (the image drifts
// slower than the page as you scroll), a 2×2 meta grid, an Add-to-calendar / Share
// bar, an About card, a real RSVP control, a "Who's going" avatar rail, and a
// "Who's coming" buzz feed of real attendee posts with a composer — all backed by
// GET /events/:id (rsvp_counts + my_rsvp), POST /events/:id/rsvp, and the event
// wall (GET/POST /events/:id/posts). Header time/title/location come from the
// calendar occurrence the caller passed in (projected occurrences are virtual, so
// the route carries them). A live event gets a shimmering gold Check-in CTA.
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import { Calendar, Camera, Check, ChevronLeft, Clock, Heart, MapPin, Play, Plus, QrCode, Send, Share2, Smile, Timer, Users, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { ImageCarousel } from "../components/ImageCarousel";
import { FitImage } from "../components/FitImage";
import { Avatar } from "../components/Avatar";
import { ShimmerSweep } from "../components/ShimmerSweep";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { countdown, isLive, timeAgo } from "./eventHelpers";
import { useEvent, useEventPosts } from "../api/hooks";
import { NuruApi } from "../api/client";
import { cdnImage } from "../util/cdnImage";
import { uuidv4 } from "../util/uuid";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { invalidateQueries, errorMessage } from "../api/query";
import type { EventPost } from "../api/types";

// Emojis + sticker-style faces for the wall composer (no native sticker lib; this
// generous set covers the intent — tap to drop one into the caption).
const WALL_EMOJIS = ["🙏", "❤️", "🔥", "🎉", "🙌", "😊", "🥹", "💛", "✝️", "🕊️", "👏", "🤝", "🌟", "🥳", "😇", "💪", "🙏🏾", "🤗"];
type Picked = { uri: string; type: string; name: string };

type RsvpStatus = "going" | "maybe" | "declined";

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

const RSVP_OPTIONS: Array<{ key: RsvpStatus; label: string; color: string }> = [
  { key: "going", label: "Going", color: "#16A34A" },
  { key: "maybe", label: "Maybe", color: "#D97706" },
  { key: "declined", label: "Can't", color: "#9CA3AF" },
];

// --- ICS (.ics) helpers — escape text per RFC 5545 and format a UTC-free local
// stamp. RN has no Blob/anchor, so we open the calendar via a data: URL below.
function icsEscape(s: string): string {
  return (s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}
function icsStamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

export function EventDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { eventId, title, startAt, endAt, location } = useRoute<RouteProp<RootStackParamList, "EventDetail">>().params;
  const { data: event, refetch } = useEvent(eventId);
  const { data: posts } = useEventPosts(eventId);

  const live = isLive({ start_at: startAt, end_at: endAt ?? startAt });

  // Local RSVP mirrors the server (my_rsvp) once loaded; optimistic on tap.
  const [rsvp, setRsvp] = useState<RsvpStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (event?.my_rsvp) setRsvp(event.my_rsvp);
  }, [event?.my_rsvp]);

  const goingCount = event?.rsvp_counts?.going ?? 0;
  const timeRange = endAt ? `${timeLabel(startAt)} – ${timeLabel(endAt)}` : timeLabel(startAt);
  const heroUri = event?.primary_image_url ?? event?.images?.[0] ?? null;
  const ticker = countdown(startAt);
  const gallery = (event?.images ?? []).slice(heroUri && event?.images?.[0] === heroUri ? 1 : 0);
  const category = (event?.category ?? "EVENT").toUpperCase();

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

  // Share the event via the native share sheet (also wired to the hero share icon).
  async function shareEvent(): Promise<void> {
    const lines = [title, `${dateLabel(startAt)} · ${timeRange}`];
    if (location) lines.push(location);
    try {
      await Share.share({ title, message: lines.join("\n") });
    } catch {
      /* cancelled */
    }
  }

  // Add to calendar: build a valid VCALENDAR/VEVENT and open it. RN has no Blob or
  // <a download>, so we hand the .ics to the OS as a data: URL — on iOS this opens
  // Calendar's "Add Event" sheet. If the platform can't open data URLs we fall back
  // to the share sheet so the user can still save/forward the invite.
  async function addToCalendar(): Promise<void> {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Nuru Place//Events//EN",
      "BEGIN:VEVENT",
      `UID:${eventId}@nuruplace`,
      `DTSTAMP:${icsStamp(new Date().toISOString())}`,
      `DTSTART:${icsStamp(startAt)}`,
      `DTEND:${icsStamp(endAt ?? new Date(new Date(startAt).getTime() + 90 * 60_000).toISOString())}`,
      `SUMMARY:${icsEscape(title)}`,
      `LOCATION:${icsEscape(location ?? "")}`,
      `DESCRIPTION:${icsEscape(event?.description ?? "")}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const url = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    try {
      await Linking.openURL(url);
    } catch {
      try {
        await Share.share({ title, message: ics });
      } catch {
        /* cancelled */
      }
    }
  }

  // ---- Inline wall composer (caption + photo/camera + emoji), at the bottom ----
  const kb = useKeyboardInset();
  const [composerText, setComposerText] = useState("");
  const [composerPhoto, setComposerPhoto] = useState<Picked | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState<string | null>(null);

  async function pickPhoto(fromCamera: boolean): Promise<void> {
    setPostErr(null);
    try {
      const res = fromCamera
        ? await launchCamera({ mediaType: "photo", quality: 0.8, saveToPhotos: false })
        : await launchImageLibrary({ mediaType: "photo", quality: 0.8, selectionLimit: 1 });
      const a = res.assets?.[0];
      if (!a?.uri) return; // cancelled
      setComposerPhoto({ uri: a.uri, type: a.type ?? "image/jpeg", name: a.fileName ?? `photo-${Date.now()}.jpg` });
      setEmojiOpen(false);
    } catch {
      setPostErr("Couldn't open your camera roll.");
    }
  }

  async function submitPost(): Promise<void> {
    const body = composerText.trim();
    if ((!body && !composerPhoto) || posting) return;
    if (!(await getConnectivity().isOnline())) {
      setPostErr("You're offline — posting needs a connection.");
      return;
    }
    setPosting(true);
    setPostErr(null);
    try {
      let imageUrl: string | null = null;
      if (composerPhoto) {
        const sign = await NuruApi.signChatAttachment({ content_type: composerPhoto.type, kind: "image" });
        const up = await NuruApi.uploadChatAttachment(sign, composerPhoto);
        imageUrl = up.secure_url;
      }
      await NuruApi.createEventPost(eventId, { post_id: uuidv4(), body: body || null, image_url: imageUrl, client_mutation_id: uuidv4() });
      invalidateQueries(`eventPosts:${eventId}`);
      setComposerText("");
      setComposerPhoto(null);
      setEmojiOpen(false);
    } catch (e) {
      setPostErr(errorMessage(e));
    } finally {
      setPosting(false);
    }
  }

  const canPost = !posting && (composerText.trim().length > 0 || composerPhoto !== null);

  // "Who's going" rail — real faces drawn from the wall: authors who are marked
  // "going", de-duplicated by user (most-recent post wins, since posts are newest-
  // first). We never invent names — only render the people we actually have, and
  // use the event's going COUNT for the trailing "+N more" tile.
  const goingFaces = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ id: string; name: string; avatar: string | null }> = [];
    for (const p of posts ?? []) {
      if (p.rsvp_status !== "going" || seen.has(p.author_user_id)) continue;
      seen.add(p.author_user_id);
      out.push({ id: p.author_user_id, name: p.author_name, avatar: p.author_avatar });
    }
    return out;
  }, [posts]);
  const moreGoing = Math.max(0, goingCount - goingFaces.length);

  // Parallax: map vertical scroll to an Animated.Value so the hero drifts at ~0.3×.
  const scrollY = useRef(new Animated.Value(0)).current;
  const coverTranslate = scrollY.interpolate({ inputRange: [-200, 0, 600], outputRange: [-60, 0, 180], extrapolate: "clamp" });

  return (
    <View style={st.screen}>
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        scrollEventThrottle={16}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
      >
        {/* HERO — parallax cover with the title + category/live pills overlaid at
            the bottom and glassy back/share controls at the top. */}
        <View style={st.hero}>
          {heroUri ? (
            <Animated.Image
              source={{ uri: cdnImage(heroUri, { width: 1200 }) }}
              style={[st.heroImage, { transform: [{ translateY: coverTranslate }, { scale: 1.12 }] }]}
              resizeMode="cover"
            />
          ) : (
            <Animated.View style={[st.heroImage, { transform: [{ translateY: coverTranslate }, { scale: 1.12 }] }]}>
              <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} />
            </Animated.View>
          )}
          {/* Top→bottom navy wash so the white title + pills always read. */}
          <View style={st.heroWash} />
          <View style={st.heroTop}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              onPress={() => nav.goBack()}
              style={({ pressed }) => [st.glassBtn, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <ChevronLeft size={20} color={palette.onNavy} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Share"
              onPress={() => void shareEvent()}
              style={({ pressed }) => [st.glassBtn, pressed && { transform: [{ scale: 0.94 }] }]}
            >
              <Share2 size={17} color={palette.onNavy} />
            </Pressable>
          </View>
          <View style={st.heroBottom}>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <View style={st.eventBadge}>
                <T variant="micro" tone="onNavy" style={{ fontWeight: "800", letterSpacing: 1.5 }}>{category}</T>
              </View>
              {live ? (
                <View style={st.liveChip}>
                  <View style={st.liveDot} />
                  <T variant="micro" tone="onNavy" style={{ fontWeight: "800", letterSpacing: 1.4 }}>LIVE</T>
                </View>
              ) : ticker ? (
                <View style={st.countdownChip}>
                  <Timer size={11} color={palette.navyDeep} />
                  <T variant="micro" style={{ color: palette.navyDeep, fontWeight: "800" }}>{`${ticker}!`}</T>
                </View>
              ) : null}
            </View>
            <T serif tone="onNavy" style={st.title}>{title}</T>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, marginTop: -18 }}>
          {/* Meta card (2×2) */}
          <View style={st.metaCard}>
            <View style={st.metaRow}>
              <MetaTile icon={<Calendar size={16} color={palette.goldLo} />} label="Date" value={dateLabel(startAt)} />
              <MetaTile icon={<Clock size={16} color={palette.goldLo} />} label="Time" value={timeRange} />
            </View>
            <View style={[st.metaRow, { marginTop: spacing.md }]}>
              <MetaTile icon={<MapPin size={16} color={palette.goldLo} />} label="Where" value={location ?? "To be announced"} />
              <MetaTile icon={<Users size={16} color={palette.goldLo} />} label="Going" value={`${goingCount} ${goingCount === 1 ? "person" : "people"}`} />
            </View>

            {/* Add to calendar · Share */}
            <View style={[st.metaRow, { marginTop: spacing.base }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add to calendar"
                onPress={() => void addToCalendar()}
                style={({ pressed }) => [st.actionBtn, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <Calendar size={14} color={palette.gold} />
                <T variant="caption" style={st.actionLabel}>Add to calendar</T>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Share event"
                onPress={() => void shareEvent()}
                style={({ pressed }) => [st.actionBtn, pressed && { transform: [{ scale: 0.97 }] }]}
              >
                <Share2 size={14} color={palette.gold} />
                <T variant="caption" style={st.actionLabel}>Share</T>
              </Pressable>
            </View>
          </View>

          {/* Extra gallery images (the cover already shows in the hero) */}
          {gallery.length > 0 ? (
            <View style={{ marginTop: spacing.base }}>
              <ImageCarousel images={gallery} height={180} />
            </View>
          ) : null}

          {/* Watch video — opens the attached video (from the Video Library) */}
          {event?.video_url ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Watch event video"
              onPress={() => { const u = event.video_url; if (u) void Linking.openURL(u).catch(() => undefined); }}
              style={({ pressed }) => [{ height: 180, borderRadius: 16, overflow: "hidden", marginTop: spacing.base, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.92 }]}
            >
              <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={16} />
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" }}>
                <Play size={22} color={palette.navy} fill={palette.navy} />
              </View>
              <T variant="micro" tone="onNavy" style={{ position: "absolute", bottom: 10, left: 12, fontWeight: "600", letterSpacing: 1 }}>WATCH VIDEO</T>
            </Pressable>
          ) : null}

          {/* About */}
          <View style={[st.card, { marginTop: spacing.base }]}>
            <T variant="micro" style={st.cardKicker}>ABOUT THIS GATHERING</T>
            <T variant="body" tone="secondary" style={{ marginTop: spacing.sm, lineHeight: 22 }}>
              {event?.description?.trim()
                ? event.description
                : "Part of your church and pathway schedule. Add it to your plans and arrive a few minutes early."}
            </T>
          </View>

          {/* Who's going — a warm avatar rail of real faces (from the wall) + count. */}
          {goingFaces.length > 0 || goingCount > 0 ? (
            <View style={[st.card, { marginTop: spacing.base }]}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <T variant="micro" style={st.cardKicker}>WHO'S GOING</T>
                <T variant="micro" style={{ color: palette.navy, fontWeight: "700" }}>{`${goingCount} going`}</T>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.faceRail}>
                {goingFaces.map((f) => (
                  <View key={f.id} style={st.faceTile}>
                    <Avatar uri={f.avatar} name={f.name} size={46} />
                    <T variant="micro" tone="secondary" numberOfLines={1} style={{ fontWeight: "600", textAlign: "center", width: "100%" }}>{firstName(f.name)}</T>
                  </View>
                ))}
                {moreGoing > 0 ? (
                  <View style={st.faceTile}>
                    <View style={st.moreTile}><T variant="caption" style={{ color: palette.navy, fontWeight: "700" }}>{`+${moreGoing}`}</T></View>
                    <T variant="micro" tone="tertiary" style={{ fontWeight: "600" }}>more</T>
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}

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
            {rsvp ? (
              <T variant="micro" style={{ color: palette.successText, marginTop: spacing.sm }}>
                {rsvp === "going"
                  ? "✓ Saved · we'll remind you the day before."
                  : rsvp === "maybe"
                    ? "✓ Saved · marked as maybe."
                    : "✓ Saved · marked as can't make it."}
              </T>
            ) : null}
            {error ? <T variant="micro" style={{ color: palette.error, marginTop: spacing.sm }}>{error}</T> : null}
          </View>

          {/* Who's coming — the buzz feed (real attendee posts). Compose below. */}
          <View style={{ marginTop: spacing.lg }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <T variant="micro" style={st.cardKicker}>{`WHO'S COMING${posts && posts.length > 0 ? ` · ${posts.length}` : ""}`}</T>
              {posts && posts.length > 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <View style={st.buzzDot} />
                  <T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Buzzing</T>
                </View>
              ) : null}
            </View>

            {posts && posts.length > 0 ? (
              <View style={{ gap: spacing.md, marginTop: spacing.md }}>
                {posts.map((p) => (
                  <BuzzCard key={p.post_id} post={p} />
                ))}
              </View>
            ) : (
              <View style={st.emptyWall}>
                <T variant="caption" tone="secondary" style={{ textAlign: "center" }}>
                  Be the first to share a photo or a word about this gathering — use the bar below.
                </T>
              </View>
            )}
          </View>

          {/* Check-in CTA — shimmers with a gold glow while the event is live; the
              live action sets your RSVP to "going" (the real attendance signal this
              screen owns). Disabled + labeled when it isn't live yet. */}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !live }}
            accessibilityLabel={live ? "Check in" : "Check-in opens when event is live"}
            disabled={!live || saving}
            onPress={() => void choose("going")}
            style={({ pressed }) => [st.checkIn, live ? st.checkInLive : st.checkInIdle, pressed && live && { transform: [{ scale: 0.99 }] }]}
          >
            {live ? <ShimmerSweep active color="rgba(230,192,104,0.35)" /> : null}
            <QrCode size={17} color={live ? palette.goldLight : palette.onNavyFaint} />
            <T variant="caption" style={{ fontWeight: "800", color: live ? palette.goldLight : palette.onNavyFaint }}>
              {live ? "Check in" : "Check-in opens when event is live"}
            </T>
          </Pressable>
        </View>
      </Animated.ScrollView>

      {/* ── Inline composer at the bottom: caption · + photo · camera · emoji ── */}
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[st.composer, { marginBottom: kb }]}>
          {composerPhoto ? (
            <View style={st.composerPhotoWrap}>
              <Image source={{ uri: composerPhoto.uri }} style={st.composerPhoto} resizeMode="cover" />
              <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" onPress={() => setComposerPhoto(null)} style={st.composerPhotoX}>
                <X size={13} color="#fff" />
              </Pressable>
            </View>
          ) : null}
          {emojiOpen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.emojiStrip} keyboardShouldPersistTaps="handled">
              {WALL_EMOJIS.map((e, i) => (
                <Pressable key={`${e}-${i}`} accessibilityRole="button" onPress={() => setComposerText((t) => t + e)} style={st.emojiKey}>
                  <T style={{ fontSize: 22 }}>{e}</T>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          {postErr ? <T variant="micro" style={{ color: palette.error, marginBottom: 6 }}>{postErr}</T> : null}
          <View style={st.composerRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add photo" onPress={() => void pickPhoto(false)} style={st.composerIcon}>
              <Plus size={20} color={palette.ink600} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Take photo" onPress={() => void pickPhoto(true)} style={st.composerIcon}>
              <Camera size={19} color={palette.ink600} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Emojis & stickers" onPress={() => setEmojiOpen((v) => !v)} style={st.composerIcon}>
              <Smile size={19} color={emojiOpen ? palette.gold : palette.ink600} />
            </Pressable>
            <TextInput
              value={composerText}
              onChangeText={setComposerText}
              placeholder="Share a word or a photo…"
              placeholderTextColor={palette.ink400}
              multiline
              style={st.composerInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Post to the wall"
              onPress={() => void submitPost()}
              disabled={!canPost}
              style={[st.composerSend, !canPost && { opacity: 0.4 }]}
            >
              <Send size={17} color={palette.navyDeep} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// A premium buzz card for one real attendee post. PHOTO posts → caption as a gold
// serif pull-quote over a strong bottom gradient; TEXT posts → a gold-left-accent
// serif-italic quote card. The 🙌 cheer / ❤️ love reactions and the double-tap
// heart-burst are LOCAL celebration state only — there's no reactions backend for
// event posts, so these never persist and are intentionally client-side.
function BuzzCard({ post }: { post: EventPost }): ReactElement {
  const [cheered, setCheered] = useState(false);
  const [loved, setLoved] = useState(false);
  const burst = useRef(new Animated.Value(0)).current;

  function love(): void {
    setLoved((v) => !v);
    if (!loved) {
      burst.setValue(0);
      Animated.sequence([
        Animated.spring(burst, { toValue: 1, useNativeDriver: true, friction: 5 }),
        Animated.timing(burst, { toValue: 0, duration: 240, delay: 360, useNativeDriver: true }),
      ]).start();
    }
  }

  return (
    <View style={[st.buzzCard, post.mine && st.buzzCardMine]}>
      {/* Author row */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.base, paddingBottom: post.image_url || post.body ? spacing.sm : spacing.base }}>
        <Avatar uri={post.author_avatar} name={post.author_name} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{post.author_name}</T>
          <T variant="micro" tone="tertiary">{post.mine ? "You" : timeAgo(post.created_at)}</T>
        </View>
        {post.rsvp_status === "going" ? (
          <View style={st.goingTag}>
            <Check size={10} color={palette.successText} />
            <T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Going</T>
          </View>
        ) : null}
      </View>

      {post.image_url ? (
        <Pressable onPress={love} accessibilityRole="imagebutton" accessibilityLabel="Double-tap to love" style={st.buzzImageWrap}>
          <FitImage uri={post.image_url} radius={16} />
          {post.body ? (
            <>
              <View style={st.buzzImageShade} />
              <View style={st.buzzCaption}>
                <T style={{ color: palette.goldLight, fontSize: 20, lineHeight: 18 }}>“</T>
                <T serif style={st.buzzCaptionText} numberOfLines={3}>{post.body}</T>
              </View>
            </>
          ) : null}
          {/* double-tap heart-burst (local) */}
          <Animated.Text
            pointerEvents="none"
            style={[st.heartBurst, { opacity: burst, transform: [{ scale: burst.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.5] }) }] }]}
          >
            ❤️
          </Animated.Text>
        </Pressable>
      ) : post.body ? (
        <View style={st.buzzQuote}>
          <T serif style={st.buzzQuoteText}>{`“${post.body}”`}</T>
        </View>
      ) : null}

      {/* Reactions — the buzz (local-only) */}
      <View style={st.buzzReactions}>
        <Pressable accessibilityRole="button" accessibilityLabel="Cheer" onPress={() => setCheered((v) => !v)} style={[st.reactBtn, cheered && st.reactBtnCheer]}>
          <T style={{ fontSize: 13 }}>🙌</T>
          <T variant="micro" style={{ fontWeight: "700", color: cheered ? palette.goldLo : palette.ink600 }}>{cheered ? "Cheered" : "Cheer"}</T>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Love" onPress={love} style={[st.reactBtn, loved && st.reactBtnLove]}>
          <Heart size={13} color={loved ? palette.error : palette.ink600} fill={loved ? palette.error : "transparent"} />
          <T variant="micro" style={{ fontWeight: "700", color: loved ? palette.error : palette.ink600 }}>{loved ? "Loved" : "Love"}</T>
        </Pressable>
        <T variant="micro" style={{ marginLeft: "auto", color: palette.successText, fontWeight: "700" }}>is coming</T>
      </View>
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

const HERO_HEIGHT = 280;

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  hero: { height: HERO_HEIGHT, overflow: "hidden", justifyContent: "space-between" },
  heroImage: { position: "absolute", top: 0, left: 0, right: 0, height: HERO_HEIGHT, backgroundColor: palette.navy },
  heroWash: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(11,31,51,0.42)" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.screen, paddingTop: 54 },
  heroBottom: { padding: spacing.screen, paddingBottom: spacing.lg },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.32)", alignItems: "center", justifyContent: "center" },
  eventBadge: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.22)", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  liveChip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", backgroundColor: palette.success, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.onNavy },
  countdownChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: palette.gold, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  title: { fontSize: 26, lineHeight: 32, marginTop: spacing.sm, fontWeight: "600" },
  metaCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaTile: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  metaIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 44, borderRadius: radii.control, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  actionLabel: { fontWeight: "700", color: palette.navy },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardKicker: { color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4 },
  faceRail: { gap: 14, marginTop: spacing.md, paddingRight: spacing.sm },
  faceTile: { width: 56, alignItems: "center", gap: 6 },
  moreTile: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: "center", justifyContent: "center" },
  rsvpRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rsvpBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 44, borderRadius: radii.control, borderWidth: 1.5 },
  buzzDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.success },
  buzzCard: { backgroundColor: palette.white, borderRadius: 20, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  buzzCardMine: { backgroundColor: "#FFFDF7", borderColor: "rgba(200,155,60,0.35)" },
  buzzImageWrap: { marginHorizontal: spacing.base, marginBottom: spacing.md, borderRadius: 16, overflow: "hidden", position: "relative" },
  buzzImageShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: "70%", backgroundColor: "rgba(8,20,36,0.55)" },
  buzzCaption: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.base, paddingBottom: spacing.md },
  buzzCaptionText: { color: "#fff", fontSize: 16, lineHeight: 21, fontWeight: "600", marginTop: -4 },
  buzzQuote: { marginHorizontal: spacing.base, marginBottom: spacing.md, borderRadius: 14, paddingHorizontal: spacing.base, paddingVertical: spacing.md, backgroundColor: palette.surface, borderLeftWidth: 3, borderLeftColor: palette.gold },
  buzzQuoteText: { color: palette.navy, fontSize: 15, lineHeight: 22, fontStyle: "italic" },
  heartBurst: { position: "absolute", alignSelf: "center", top: "38%", fontSize: 64 },
  buzzReactions: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  reactBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 5 },
  reactBtnCheer: { backgroundColor: "rgba(200,155,60,0.16)" },
  reactBtnLove: { backgroundColor: "rgba(212,24,61,0.10)" },
  goingTag: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 8, paddingVertical: 3 },
  emptyWall: { alignItems: "center", justifyContent: "center", padding: spacing.lg, marginTop: spacing.md, borderRadius: radii.card, borderWidth: 1.5, borderColor: palette.border, borderStyle: "dashed", backgroundColor: palette.white },
  checkIn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 54, borderRadius: 16, marginTop: spacing.lg, overflow: "hidden", backgroundColor: palette.navyDeep },
  checkInLive: { shadowColor: palette.goldLight, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 8 },
  checkInIdle: { opacity: 0.55 },
  composer: { backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  composerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, minHeight: 40, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 9, marginHorizontal: 2, fontSize: 15, color: palette.ink, backgroundColor: palette.surface, borderRadius: 20, textAlignVertical: "center" },
  composerSend: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.gold },
  composerPhotoWrap: { alignSelf: "flex-start", marginBottom: spacing.sm, borderRadius: 12, overflow: "hidden", position: "relative" },
  composerPhoto: { width: 72, height: 72, backgroundColor: palette.mutedBg },
  composerPhotoX: { position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  emojiStrip: { gap: 2, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  emojiKey: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
} as const;
