// Full-screen "Watch" player for a reading-plan video segment (Apple-Podcasts
// style): a poster pre-roll with a "Start Watching" button, then the native
// player. Closing or finishing marks the segment complete (best-effort) so the
// day can roll up and the Word score reflects the engagement.
import { useState, type ReactElement } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Video from "react-native-video";
import { Play, X } from "lucide-react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { NuruApi } from "../api/client";
import { refreshQueries } from "../api/query";
import { queryKeys } from "../api/hooks";
import { GradientBg, T } from "../theme/components";
import { palette, radii, spacing } from "../theme/tokens";
import { cdnImage } from "../util/cdnImage";

export function WatchScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { videoUrl, poster, title, subtitle, segmentId, planId } = useRoute<RouteProp<RootStackParamList, "Watch">>().params;
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);

  async function complete(): Promise<void> {
    if (done || !segmentId) return;
    setDone(true);
    try {
      await NuruApi.completePlanSegment(segmentId);
      if (planId) refreshQueries(queryKeys.plan(planId));
      refreshQueries(queryKeys.plans);
    } catch {
      /* best-effort — playback already happened */
    }
  }

  function close(): void {
    // Starting the video counts as engaging the Watch segment.
    if (started) void complete();
    nav.goBack();
  }

  return (
    <View style={st.screen}>
      {started ? (
        <Video
          source={{ uri: videoUrl }}
          style={StyleSheet.absoluteFill}
          controls
          paused={false}
          resizeMode="contain"
          onEnd={() => { void complete(); }}
          onError={() => setStarted(false)}
        />
      ) : (
        <>
          {poster ? (
            <Image source={{ uri: cdnImage(poster) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
          ) : (
            <GradientBg colors={[palette.navy, palette.navy700, palette.navyDeep]} />
          )}
          <View style={st.shade} />
          <View style={st.bottom}>
            <T variant="micro" tone="gold" style={{ letterSpacing: 2, fontWeight: "800" }}>WATCH</T>
            <T serif tone="onNavy" style={{ fontSize: 26, lineHeight: 31, marginTop: 6 }}>{title ?? "Today's reflection"}</T>
            {subtitle ? <T variant="body" tone="onNavyDim" style={{ marginTop: 4 }}>{subtitle}</T> : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Start watching" onPress={() => setStarted(true)} style={({ pressed }) => [st.startBtn, pressed && { opacity: 0.9 }]}>
              <Play size={18} color={palette.navyDeep} fill={palette.navyDeep} />
              <T variant="heading" style={{ color: palette.navyDeep }}>Start Watching</T>
            </Pressable>
          </View>
        </>
      )}

      <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={st.closeBtn}>
        <X size={20} color="#fff" />
      </Pressable>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: "#000" },
  shade: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(8,16,32,0.45)" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, padding: spacing.lg, paddingBottom: 48 },
  startBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginTop: spacing.lg, height: 54, borderRadius: radii.pill, backgroundColor: "#fff",
  },
  closeBtn: { position: "absolute", top: 54, left: spacing.lg, width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" },
} as const;
