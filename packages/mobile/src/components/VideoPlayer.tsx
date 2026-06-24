// Inline video player (react-native-video). Shows a poster (thumbnail or a navy
// gradient) with a play button; tapping swaps in the native <Video> with controls.
// The frame sizes itself to the video's real aspect ratio (measured from the
// poster first, then refined from the video's natural size on load) so there are
// no black letterbox bars — the card grows/shrinks to fit the content. A
// portrait-friendly height cap keeps very tall videos from dominating.
import { useEffect, useState, type ReactElement } from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import Video, { type OnLoadData } from "react-native-video";
import { Play } from "lucide-react-native";
import { palette } from "../theme/tokens";
import { GradientBg } from "../theme/components";

const FILL = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

export function VideoPlayer({
  uri,
  poster,
  height = 200,
  radius = 16,
}: {
  uri: string;
  poster?: string | null;
  /** Fallback height until the real aspect ratio is known. */
  height?: number;
  radius?: number;
}): ReactElement {
  const [playing, setPlaying] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const { height: screenH } = useWindowDimensions();
  const cap = Math.round(screenH * 0.7);

  // Pre-play: size the frame to the poster's aspect so the still has no bars.
  useEffect(() => {
    let alive = true;
    if (poster) Image.getSize(poster, (w, h) => { if (alive && w > 0 && h > 0) setAspect(w / h); }, () => {});
    return () => { alive = false; };
  }, [poster]);

  function onLoad(d: OnLoadData): void {
    const n = d?.naturalSize;
    if (n && n.width > 0 && n.height > 0) {
      let a = n.width / n.height;
      if (n.orientation === "portrait" && a > 1) a = 1 / a; // guard raw-dimension reports
      setAspect(a);
    }
  }

  const frame = aspect
    ? ({ width: "100%", aspectRatio: aspect, maxHeight: cap, borderRadius: radius, overflow: "hidden", backgroundColor: "#000" } as const)
    : ({ height, borderRadius: radius, overflow: "hidden", backgroundColor: "#000" } as const);

  return (
    <View style={frame}>
      {playing ? (
        <Video
          source={{ uri }}
          style={FILL}
          controls
          paused={false}
          resizeMode="contain"
          onLoad={onLoad}
          onEnd={() => setPlaying(false)}
          onError={() => setPlaying(false)}
        />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={() => setPlaying(true)} style={FILL}>
          {poster ? (
            <Image source={{ uri: poster }} style={FILL} resizeMode="cover" />
          ) : (
            <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={radius} />
          )}
          <View style={styles.center}>
            <View style={styles.playBtn}>
              <Play size={26} color={palette.navy} fill={palette.navy} />
            </View>
          </View>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...FILL, alignItems: "center", justifyContent: "center" },
  playBtn: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
});
