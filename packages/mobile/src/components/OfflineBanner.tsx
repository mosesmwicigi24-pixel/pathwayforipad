// A thin app-wide bar that appears when the device drops offline (§1.7). Mounted
// once in the app shell so every screen reassures the member their work is safe —
// offline-originated writes queue and replay on reconnect. Renders nothing online.
import { type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { palette, spacing } from "../theme/tokens";
import { T } from "../theme/components";
import { useIsOffline } from "../net/useIsOffline";

export function OfflineBanner(): ReactNode {
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <View style={s.bar} accessibilityRole="alert" pointerEvents="none">
      <View style={s.dot} />
      <T variant="caption" style={{ color: palette.urgentText, fontWeight: "600" }}>
        You&apos;re offline — changes will sync when you reconnect.
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: palette.urgentBg,
    borderBottomWidth: 1,
    borderBottomColor: palette.urgentBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.warning },
});
