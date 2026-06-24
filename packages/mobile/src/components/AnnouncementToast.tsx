// In-app heads-up banner for a freshly-arrived announcement. Slides down from the
// top with the brand navy/gold treatment, auto-dismisses, and on tap opens the
// announcement. Fired by the alert engine (announcementAlerts.ts) alongside the
// chime + vibration. Lives at the app root, above the navigator.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Animated, Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell } from "lucide-react-native";
import { palette, radii, spacing, type, shadow } from "../theme/tokens";
import { onAnnouncementAlert } from "../notifications/announcementAlerts";
import { navigate } from "../navigation/navigationRef";
import type { MyAnnouncement } from "../api/types";

const VISIBLE_MS = 6000;

export function AnnouncementToast(): ReactElement | null {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<MyAnnouncement | null>(null);
  const queue = useRef<MyAnnouncement[]>([]);
  const slide = useRef(new Animated.Value(-160)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe once: push arrivals into a queue and show them one at a time.
  useEffect(() => {
    const off = onAnnouncementAlert((a) => {
      queue.current.push(a);
      setCurrent((cur) => cur ?? queue.current.shift() ?? null);
    });
    return off;
  }, []);

  // Animate in/out as `current` changes.
  useEffect(() => {
    if (!current) return;
    Animated.spring(slide, { toValue: 0, useNativeDriver: true, bounciness: 6, speed: 12 }).start();
    hideTimer.current = setTimeout(dismiss, VISIBLE_MS);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [current]);

  function dismiss(): void {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(slide, { toValue: -160, duration: 220, useNativeDriver: true }).start(() => {
      const next = queue.current.shift() ?? null;
      setCurrent(next);
    });
  }

  function open(): void {
    const a = current;
    dismiss();
    if (a) navigate("AnnouncementDetail", { announcementId: a.announcement_id, title: a.title });
  }

  if (!current) return null;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { paddingTop: insets.top + 6, transform: [{ translateY: slide }] }]}
    >
      <Pressable onPress={open} style={({ pressed }) => [styles.card, pressed && { opacity: 0.92 }]}>
        {current.primary_image_url ? (
          <Image source={{ uri: current.primary_image_url }} style={styles.thumb} resizeMode="contain" />
        ) : (
          <View style={styles.iconChip}>
            <Bell size={18} color={palette.navyDeep} />
          </View>
        )}
        <View style={styles.textCol}>
          <Text style={styles.kicker}>NEW ANNOUNCEMENT</Text>
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          {!!current.body && (
            <Text style={styles.body} numberOfLines={2}>
              {current.body}
            </Text>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingHorizontal: spacing.base,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.navyDeep,
    borderRadius: radii.card,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderColor: "rgba(200,155,60,0.35)",
    ...shadow.card,
    shadowOpacity: 0.25,
  },
  iconChip: {
    width: 38,
    height: 38,
    borderRadius: radii.pill,
    backgroundColor: palette.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  thumb: { width: 44, height: 44, borderRadius: radii.control, backgroundColor: "rgba(255,255,255,0.08)" },
  textCol: { flex: 1 },
  kicker: { ...type.overline, color: palette.goldGlow, marginBottom: 2 },
  title: { ...type.heading, color: palette.onNavy },
  body: { ...type.caption, color: palette.onNavyDim, marginTop: 1 },
});
