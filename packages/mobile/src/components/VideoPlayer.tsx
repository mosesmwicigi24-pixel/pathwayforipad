// Inline video player (react-native-video). Shows a poster (thumbnail or a navy
// gradient) with a play button; tapping swaps in the native <Video> with controls.
// Used by the Home welcome video and shared videos in chat threads.
import { useState, type ReactElement } from "react";
import { Image, Pressable, StyleSheet, View } from "react-native";
import Video from "react-native-video";
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
  height?: number;
  radius?: number;
}): ReactElement {
  const [playing, setPlaying] = useState(false);
  return (
    <View style={{ height, borderRadius: radius, overflow: "hidden", backgroundColor: "#000" }}>
      {playing ? (
        <Video
          source={{ uri }}
          style={FILL}
          controls
          paused={false}
          resizeMode="contain"
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
