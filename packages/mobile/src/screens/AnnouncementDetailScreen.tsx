// Announcement detail. Title over a navy hero, an optional image carousel
// (cover + gallery), the sent date, and the Markdown body — backed by the real
// GET /announcements/:id (members only see announcements delivered to them).
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { GradientBg, Glow, T } from "../theme/components";
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

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={st.hero}>
          <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} />
          <Glow size={200} color="rgba(201,162,39,0.12)" style={{ right: -50, top: -40 }} />
          <View style={st.heroTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => nav.goBack()} style={({ pressed }) => [st.glassBtn, pressed && { transform: [{ scale: 0.95 }] }]}>
              <ChevronLeft size={20} color={palette.onNavy} />
            </Pressable>
          </View>
          <View>
            <T variant="micro" tone="gold" style={st.kicker}>ANNOUNCEMENT</T>
            <T serif tone="onNavy" style={st.title}>{data?.title ?? title ?? "Announcement"}</T>
          </View>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, marginTop: -spacing.lg }}>
          {isLoading && !data ? <Loading label="Loading…" /> : null}
          {error && !data ? <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} /> : null}

          {data ? (
            <>
              {data.images && data.images.length > 0 ? (
                <View style={{ marginBottom: spacing.base }}>
                  <ImageCarousel images={data.images} height={210} />
                </View>
              ) : null}

              <View style={st.card}>
                {data.sent_at ? <T variant="micro" tone="tertiary" style={{ marginBottom: spacing.sm }}>{sentLabel(data.sent_at)}</T> : null}
                <Markdown content={data.body} />
              </View>
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  hero: { height: 200, paddingHorizontal: spacing.screen, paddingTop: 54, paddingBottom: spacing.xl, overflow: "hidden", justifyContent: "space-between" },
  heroTop: { flexDirection: "row" },
  glassBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.12)", alignItems: "center", justifyContent: "center" },
  kicker: { letterSpacing: 2, fontWeight: "700" },
  title: { fontSize: 24, lineHeight: 30, marginTop: spacing.sm, fontWeight: "600" },
  card: { backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, ...shadow.card },
} as const;
