// Announcement detail. The cover image leads — shown in full (never cropped) in
// the upper card — with the title overlaid; video takes priority when present;
// then a generously formatted Markdown body. Backed by GET /announcements/:id.
import { type ReactElement } from "react";
import { Image, Linking, Pressable, ScrollView, View } from "react-native";
import { ChevronLeft, Megaphone, Play } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";
import { Markdown } from "../components/Markdown";
import { ImageCarousel } from "../components/ImageCarousel";
import { useAnnouncement } from "../api/hooks";
import { errorMessage } from "../api/query";
import { Loading, ErrorState } from "../components/states";

function sentLabel(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

export function AnnouncementDetailScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { announcementId, title } = useRoute<RouteProp<RootStackParamList, "AnnouncementDetail">>().params;
  const { data, isLoading, error, refetch } = useAnnouncement(announcementId);

  const cover = data?.images?.[0] ?? null;
  const gallery = (data?.images ?? []).slice(1);
  const heading = data?.title ?? title ?? "Announcement";

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        {/* Cover image leads — shown in full (contain), title overlaid */}
        <View style={st.hero}>
          {cover ? (
            <Image source={{ uri: cover }} style={st.heroImg} resizeMode="contain" />
          ) : (
            <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} />
          )}
          <View style={st.heroShade} />
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={st.glassBtn}>
            <ChevronLeft size={20} color={palette.onNavy} />
          </Pressable>
          <View style={st.heroBottom}>
            <View style={st.kickerRow}>
              <Megaphone size={12} color={palette.goldGlow} />
              <T variant="micro" tone="gold" style={{ fontWeight: "800", letterSpacing: 1.6 }}>ANNOUNCEMENT</T>
            </View>
            <T serif tone="onNavy" style={st.title} numberOfLines={3}>{heading}</T>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, marginTop: -20 }}>
          {isLoading && !data ? <Loading label="Loading…" /> : null}
          {error && !data ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

          {data ? (
            <>
              {/* Video takes priority when present */}
              {data.video_url ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Watch announcement video"
                  onPress={() => { const u = data.video_url; if (u) void Linking.openURL(u).catch(() => undefined); }}
                  style={({ pressed }) => [st.videoCard, pressed && { opacity: 0.92 }]}
                >
                  <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={radii.card} />
                  <View style={st.playBtn}><Play size={26} color={palette.navy} fill={palette.navy} /></View>
                  <T variant="micro" tone="onNavy" style={{ position: "absolute", bottom: 10, left: 14, fontWeight: "700", letterSpacing: 1 }}>WATCH VIDEO</T>
                </Pressable>
              ) : null}

              {/* Body — formatted card with a date ribbon */}
              <View style={st.card}>
                {data.sent_at ? (
                  <View style={st.dateRow}>
                    <View style={st.dateDot} />
                    <T variant="micro" tone="tertiary" style={{ fontWeight: "700", letterSpacing: 0.4 }}>{sentLabel(data.sent_at).toUpperCase()}</T>
                  </View>
                ) : null}
                <Markdown content={data.body} />
              </View>

              {/* Extra gallery images (full, never cropped) */}
              {gallery.length > 0 ? (
                <View style={{ marginTop: spacing.base }}>
                  <ImageCarousel images={gallery} height={220} />
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  hero: { height: 300, overflow: "hidden", borderBottomLeftRadius: 28, borderBottomRightRadius: 28, justifyContent: "flex-end", backgroundColor: palette.navyDeep },
  heroImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  heroShade: { position: "absolute", left: 0, right: 0, bottom: 0, height: 160, backgroundColor: "rgba(0,19,47,0.55)" },
  glassBtn: { position: "absolute", top: 54, left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center" },
  heroBottom: { padding: spacing.screen, paddingBottom: spacing.xl },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  title: { fontSize: 25, lineHeight: 31, marginTop: spacing.sm, fontWeight: "600" },
  videoCard: { height: 200, borderRadius: radii.card, overflow: "hidden", alignItems: "center", justifyContent: "center", marginBottom: spacing.base },
  playBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: "rgba(255,255,255,0.92)", alignItems: "center", justifyContent: "center" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.lg, ...shadow.card },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.md, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: palette.border },
  dateDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.gold },
} as const;
