// A reusable shimmer sweep — a soft band of light that glides across whatever it
// overlays, on a gentle loop. Used to draw the eye to live/primary CTAs in the
// Community/Events make (the "Message cell" button, a not-yet-following Follow
// button, the live Check-in). Drop it as an absolutely-filling overlay inside a
// container that has `overflow: "hidden"`; it's purely decorative (pointer-events
// off) so it never blocks taps.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Svg, Defs, LinearGradient as SvgGradient, Stop, Rect } from "react-native-svg";

export function ShimmerSweep({
  active = true,
  color = "rgba(255,255,255,0.55)",
  durationMs = 2200,
  style,
}: {
  active?: boolean;
  /** Peak colour of the moving band (transparent at its edges). */
  color?: string;
  durationMs?: number;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  const [w, setW] = useState(0);
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || w === 0) return;
    const loop = Animated.loop(
      Animated.timing(t, { toValue: 1, duration: durationMs, easing: Easing.linear, useNativeDriver: true }),
    );
    t.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [active, w, durationMs, t]);

  // The band is ~45% of the container; it travels from fully off the left edge to
  // fully off the right edge.
  const bandW = Math.max(40, w * 0.45);
  const translateX = t.interpolate({ inputRange: [0, 1], outputRange: [-bandW, w] });

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {active && w > 0 ? (
        <Animated.View style={{ position: "absolute", top: 0, bottom: 0, width: bandW, transform: [{ translateX }, { skewX: "-18deg" }] }}>
          <Svg width="100%" height="100%">
            <Defs>
              <SvgGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={color} stopOpacity={0} />
                <Stop offset="0.5" stopColor={color} stopOpacity={1} />
                <Stop offset="1" stopColor={color} stopOpacity={0} />
              </SvgGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#shimmer)" />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}
