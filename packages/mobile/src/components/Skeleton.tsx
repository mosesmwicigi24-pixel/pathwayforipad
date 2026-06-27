// Skeleton placeholders — content-shaped "loading" blocks that read as "this card
// is coming" instead of a bare spinner. Perceived speed: the screen looks like it's
// already laying out the real thing. Pure JS (Animated opacity pulse, native driver),
// no dependency. Shown only on a genuine first load (no cached data yet); with the
// disk-cache hydration, most opens skip loading entirely.
import { useEffect, useRef, type ReactElement } from "react";
import { Animated, View, type DimensionValue, type StyleProp, type ViewStyle } from "react-native";
import { palette, radii, spacing, shadow } from "../theme/tokens";

export function Skeleton({
  width = "100%",
  height = 14,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}): ReactElement {
  const o = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(o, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [o]);
  return <Animated.View style={[{ width, height, borderRadius: radius, backgroundColor: palette.mutedBg, opacity: o }, style]} />;
}

/** A card-shaped placeholder (title + two lines + a button) for feed/list loads. */
export function SkeletonCard(): ReactElement {
  return (
    <View style={{ backgroundColor: palette.white, borderRadius: radii.card, borderWidth: 1, borderColor: palette.border, padding: spacing.base, marginBottom: spacing.sm, ...shadow.card }}>
      <Skeleton width={120} height={14} />
      <Skeleton width="100%" height={12} style={{ marginTop: spacing.md }} />
      <Skeleton width="88%" height={12} style={{ marginTop: 6 }} />
      <Skeleton width={110} height={34} radius={12} style={{ marginTop: spacing.md }} />
    </View>
  );
}

/** A short stack of skeleton cards — drop in where a feed is loading for the first time. */
export function SkeletonList({ count = 4 }: { count?: number }): ReactElement {
  return (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </View>
  );
}
