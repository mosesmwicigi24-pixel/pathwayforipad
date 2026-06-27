// Event detail (new design, spec §14). Hero with the event title over a navy
// gradient, a 2×2 meta card (date / time / where / going), an about card, and
// a live RSVP control — Going / Maybe / Can't — backed by the real
// POST /events/:id/rsvp and GET /events/:id (rsvp_counts + my_rsvp). Header
// time/title/location come from the calendar occurrence the caller passed in
// (projected occurrences are virtual, so the route carries them).
import { useEffect, useState, type ReactElement } from "react";
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { launchCamera, launchImageLibrary } from "react-native-image-picker";
import { Camera, Check, ChevronLeft, Clock, MapPin, Play, Plus, Send, Smile, Timer, Users, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { ImageCarousel } from "../components/ImageCarousel";
import { FitImage } from "../components/FitImage";
import { Avatar } from "../components/Avatar";
import { useKeyboardInset } from "../components/useKeyboardInset";
import { countdown, timeAgo } from "./eventHelpers";
import { useEvent, useEventPosts } from "../api/hooks";
import { NuruApi } from "../api/client";
import { uuidv4 } from "../util/uuid";
import { writeThrough } from "../sync/offlineWrite";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";
import { invalidateQueries, errorMessage } from "../api/query";

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

const RSVP_OPTIONS: Array<{ key: RsvpStatus; label: string; color: string }> = [
  { key: "going", label: "Going", color: "#16A34A" },
  { key: "maybe", label: "Maybe", color: "#D97706" },
  { key: "declined", label: "Can't", color: "#9CA3AF" },
];

export function EventDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { eventId, title, startAt, endAt, location } = useRoute<RouteProp<RootStackParamList, "EventDetail">>().params;
  const { data: event, refetch } = useEvent(eventId);
  const { data: posts } = useEventPosts(eventId);

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

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* Full-bleed hero — the cover image shows in FULL (container adapts to its
            aspect, never cropped), with the back button + title overlaid; gradient
            fallback when no image. */}
        {(() => {
          const heroOverlay = (
            <View style={st.heroFill}>
              <View style={st.heroShade} />
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
              <View style={st.heroBottom}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <View style={st.eventBadge}>
                    <T variant="micro" tone="onNavy" style={{ fontWeight: "800", letterSpacing: 1.5 }}>
                      {(event?.category ?? "EVENT").toUpperCase()}
                    </T>
                  </View>
                  {ticker ? (
                    <View style={st.countdownChip}>
                      <Timer size={11} color={palette.navyDeep} />
                      <T variant="micro" style={{ color: palette.navyDeep, fontWeight: "800" }}>{`${ticker}!`}</T>
                    </View>
                  ) : null}
                </View>
                <T serif tone="onNavy" style={st.title}>{title}</T>
              </View>
            </View>
          );
          return heroUri ? (
            <FitImage uri={heroUri} background={palette.navy} style={st.heroFit}>{heroOverlay}</FitImage>
          ) : (
            <View style={st.hero}>
              <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} />
              {heroOverlay}
            </View>
          );
        })()}

        <View style={{ paddingHorizontal: spacing.screen, marginTop: -28 }}>
          {/* Extra gallery images (the cover already shows in the hero) */}
          {gallery.length > 0 ? (
            <View style={{ marginBottom: spacing.base }}>
              <ImageCarousel images={gallery} height={180} />
            </View>
          ) : null}

          {/* Watch video — opens the attached video (from the Video Library) */}
          {event?.video_url ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Watch event video"
              onPress={() => { const u = event.video_url; if (u) void Linking.openURL(u).catch(() => undefined); }}
              style={({ pressed }) => [{ height: 180, borderRadius: 16, overflow: "hidden", marginBottom: spacing.base, alignItems: "center", justifyContent: "center" }, pressed && { opacity: 0.92 }]}
            >
              <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={16} />
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" }}>
                <Play size={22} color={palette.navy} fill={palette.navy} />
              </View>
              <T variant="micro" tone="onNavy" style={{ position: "absolute", bottom: 10, left: 12, fontWeight: "600", letterSpacing: 1 }}>WATCH VIDEO</T>
            </Pressable>
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

          {/* Event wall — attendee posts (photo + caption). Compose from the bar below. */}
          <View style={{ marginTop: spacing.lg }}>
            <T variant="micro" style={st.cardKicker}>{`WHO'S COMING${posts && posts.length > 0 ? ` · ${posts.length}` : ""}`}</T>

            {posts && posts.length > 0 ? (
              <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
                {posts.map((p) => (
                  <View key={p.post_id} style={st.postCard}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Avatar uri={p.author_avatar} name={p.author_name} size={34} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T variant="caption" style={{ fontWeight: "700", color: palette.ink }} numberOfLines={1}>{p.author_name}</T>
                        <T variant="micro" tone="tertiary">{timeAgo(p.created_at)}</T>
                      </View>
                      {p.rsvp_status === "going" ? (
                        <View style={st.goingTag}><T variant="micro" style={{ color: palette.successText, fontWeight: "700" }}>Going</T></View>
                      ) : null}
                    </View>
                    {p.image_url ? (
                      // Caption rides over the photo on a soft navy band so it stands out.
                      <View style={st.postImageWrap}>
                        <FitImage uri={p.image_url} radius={14} />
                        {p.body ? (
                          <View style={st.postCaptionBand}>
                            <T serif style={st.postCaptionText} numberOfLines={3}>{p.body}</T>
                          </View>
                        ) : null}
                      </View>
                    ) : p.body ? (
                      <T variant="body" style={{ color: palette.ink, marginTop: spacing.sm }}>{p.body}</T>
                    ) : null}
                  </View>
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
        </View>
      </ScrollView>

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
              <Send size={17} color="#fff" />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
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
  hero: { height: 260, overflow: "hidden", borderBottomLeftRadius: 28, borderBottomRightRadius: 28, justifyContent: "space-between", backgroundColor: palette.navy },
  heroFit: { borderBottomLeftRadius: 28, borderBottomRightRadius: 28, minHeight: 240 },
  heroFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "space-between" },
  heroShade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,28,54,0.5)" },
  heroTop: { flexDirection: "row", paddingHorizontal: spacing.screen, paddingTop: 54 },
  heroBottom: { padding: spacing.screen, paddingBottom: spacing.xl },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.35)", alignItems: "center", justifyContent: "center" },
  eventBadge: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.22)", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  countdownChip: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", backgroundColor: palette.gold, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  title: { fontSize: 26, lineHeight: 32, marginTop: spacing.sm, fontWeight: "600" },
  metaCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  metaRow: { flexDirection: "row", gap: spacing.sm },
  metaTile: { flex: 1, flexDirection: "row", gap: spacing.sm, alignItems: "center", backgroundColor: palette.surface, borderRadius: 14, padding: spacing.md },
  metaIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: palette.goldTint, alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  cardKicker: { color: palette.goldLo, fontWeight: "700", letterSpacing: 1.4 },
  rsvpRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  rsvpBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, height: 44, borderRadius: radii.control, borderWidth: 1.5 },
  postCard: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
  postImageWrap: { marginTop: spacing.md, borderRadius: 14, overflow: "hidden", position: "relative" },
  postCaptionBand: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.md, backgroundColor: "rgba(8,28,54,0.55)" },
  postCaptionText: { color: "#fff", fontSize: 16, lineHeight: 22 },
  goingTag: { backgroundColor: palette.successBg, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 3 },
  emptyWall: { alignItems: "center", justifyContent: "center", padding: spacing.lg, marginTop: spacing.md, borderRadius: radii.card, borderWidth: 1.5, borderColor: palette.border, borderStyle: "dashed", backgroundColor: palette.white },
  composer: { backgroundColor: palette.white, borderTopWidth: 1, borderTopColor: palette.border, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.md },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  composerIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  composerInput: { flex: 1, minHeight: 40, maxHeight: 110, paddingHorizontal: spacing.md, paddingVertical: 9, marginHorizontal: 2, fontSize: 15, color: palette.ink, backgroundColor: palette.surface, borderRadius: 20, textAlignVertical: "center" },
  composerSend: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: palette.navyDeep },
  composerPhotoWrap: { alignSelf: "flex-start", marginBottom: spacing.sm, borderRadius: 12, overflow: "hidden", position: "relative" },
  composerPhoto: { width: 72, height: 72, backgroundColor: palette.mutedBg },
  composerPhotoX: { position: "absolute", top: 3, right: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center" },
  emojiStrip: { gap: 2, paddingBottom: spacing.sm, paddingHorizontal: 2 },
  emojiKey: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
} as const;
