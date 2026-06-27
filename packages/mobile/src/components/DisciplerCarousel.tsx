// "Meet your discipler" — an auto-advancing carousel of the disciplers/mentors in
// the member's congregation (GET /home/disciplers). Each slide shows a thumbnail
// (photo, or initials fallback), name + role, and their personal message. Advances
// every 5s (pauses briefly after a manual swipe), with dot indicators. Renders
// nothing when there are no disciplers.
import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { palette, radii, spacing, type, shadow } from "../theme/tokens";
import { cdnImage } from "../util/cdnImage";
import type { Discipler } from "../api/types";

const ADVANCE_MS = 5000;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? "" : "";
  return (first + last).toUpperCase();
}

export function DisciplerCarousel({ disciplers }: { disciplers: Discipler[] }): ReactElement | null {
  const list = disciplers.filter((d) => d && d.full_name);
  const { width } = useWindowDimensions();
  const slideW = width - spacing.screen * 2;
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const pausedUntil = useRef(0);

  // Auto-advance every 5s, wrapping back to the first slide. A manual swipe
  // pauses the timer briefly so it doesn't fight the user.
  useEffect(() => {
    if (list.length <= 1) return;
    const id = setInterval(() => {
      if (Date.now() < pausedUntil.current) return;
      const next = (pageRef.current + 1) % list.length;
      scroller.current?.scrollTo({ x: next * slideW, animated: true });
      pageRef.current = next;
      setPage(next);
    }, ADVANCE_MS);
    return () => clearInterval(id);
  }, [list.length, slideW]);

  if (list.length === 0) return null;

  function onMomentumEnd(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const next = Math.round(e.nativeEvent.contentOffset.x / slideW);
    if (next !== pageRef.current) {
      pageRef.current = next;
      setPage(next);
    }
    pausedUntil.current = Date.now() + ADVANCE_MS * 1.5; // give the user a beat after swiping
  }

  return (
    <View style={st.wrap}>
      <Text style={st.kicker}>MEET YOUR DISCIPLER</Text>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={slideW}
      >
        {list.map((d) => (
          <View key={d.user_id} style={[st.slide, { width: slideW }]}>
            {d.avatar_url ? (
              <Image source={{ uri: cdnImage(d.avatar_url, { width: 72, height: 72 }) }} style={st.avatar} resizeMode="cover" />
            ) : (
              <View style={[st.avatar, st.avatarFallback]}>
                <Text style={st.avatarInitials}>{initialsOf(d.full_name)}</Text>
              </View>
            )}
            <View style={st.body}>
              <Text style={st.name} numberOfLines={1}>
                {d.full_name}
              </Text>
              <Text style={st.role} numberOfLines={1}>
                {d.role_label}
                {d.cell_name ? ` · ${d.cell_name}` : ""}
              </Text>
              {!!d.message && (
                <Text style={st.message} numberOfLines={4}>
                  “{d.message}”
                </Text>
              )}
            </View>
          </View>
        ))}
      </ScrollView>
      {list.length > 1 && (
        <View style={st.dots}>
          {list.map((d, i) => (
            <View key={d.user_id} style={[st.dot, { width: i === page ? 18 : 6, backgroundColor: i === page ? palette.gold : palette.border }]} />
          ))}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    padding: spacing.base,
    borderWidth: 1,
    borderColor: palette.border,
    ...shadow.card,
  },
  kicker: { ...type.overline, color: palette.goldLo, marginBottom: spacing.md },
  slide: { flexDirection: "row", alignItems: "center", gap: spacing.base, paddingRight: spacing.xs },
  avatar: { width: 72, height: 72, borderRadius: radii.pill, backgroundColor: palette.tintBlue },
  avatarFallback: { alignItems: "center", justifyContent: "center", backgroundColor: palette.navy },
  avatarInitials: { ...type.title, color: palette.onNavy },
  body: { flex: 1 },
  name: { ...type.heading, color: palette.ink },
  role: { ...type.caption, color: palette.gold, marginTop: 1, marginBottom: spacing.xs },
  message: { ...type.body, color: palette.ink600, fontStyle: "italic" },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.md },
  dot: { height: 6, borderRadius: 3 },
});
