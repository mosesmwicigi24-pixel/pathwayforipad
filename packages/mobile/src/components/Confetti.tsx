// A lightweight, dependency-free confetti burst. Pure RN Animated — no native
// modules — so it ships everywhere the app does. Mount it as an absolute overlay
// and toggle `show`; each piece falls with a little horizontal drift + spin and
// fades out. Used to celebrate module completion (reflection submitted) and level
// completion (the certificate screen).
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { Animated, Dimensions, Easing, StyleSheet, View } from "react-native";
import { palette } from "../theme/tokens";

const COLORS = [palette.gold, "#6366F1", "#16A34A", "#F43F5E", "#0EA5E9", "#FBBF24", palette.navy];

type Piece = {
  left: number;
  size: number;
  color: string;
  delay: number;
  drift: number;
  spin: number;
  duration: number;
  rounded: boolean;
};

function buildPieces(count: number, width: number): Piece[] {
  // Deterministic-ish spread (index-seeded) so we don't pull in Math.random gates;
  // a touch of pseudo-noise keeps it from looking like a grid.
  return Array.from({ length: count }, (_, i) => {
    const n = (i * 9301 + 49297) % 233280;
    const r = n / 233280;
    const r2 = ((i * 4621 + 1033) % 99991) / 99991;
    return {
      left: r * width,
      size: 6 + r2 * 8,
      color: COLORS[i % COLORS.length] as string,
      delay: r2 * 280,
      drift: (r - 0.5) * 120,
      spin: (r2 - 0.5) * 6,
      duration: 1500 + r * 900,
      rounded: i % 3 === 0,
    };
  });
}

export function Confetti({
  show,
  count = 80,
  onDone,
}: {
  show: boolean;
  count?: number;
  onDone?: () => void;
}): ReactElement | null {
  const { width, height } = Dimensions.get("window");
  const pieces = useMemo(() => buildPieces(count, width), [count, width]);
  const progress = useRef(pieces.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    if (!show) return;
    const animations = pieces.map((p, i) =>
      Animated.timing(progress[i] as Animated.Value, {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    );
    progress.forEach((v) => v.setValue(0));
    const group = Animated.parallel(animations);
    group.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => group.stop();
  }, [show]);

  if (!show) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => {
        const v = progress[i] as Animated.Value;
        const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [-40, height + 40] });
        const translateX = v.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] });
        const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${p.spin * 360}deg`] });
        const opacity = v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] });
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              top: 0,
              left: p.left,
              width: p.size,
              height: p.size * (p.rounded ? 1 : 1.6),
              borderRadius: p.rounded ? p.size : 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
