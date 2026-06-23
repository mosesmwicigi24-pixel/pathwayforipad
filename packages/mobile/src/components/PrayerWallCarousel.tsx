// Home "Prayer Wall" carousel — the most-prayed public requests, auto-advancing
// every 6s (a comfortable reading beat). Tap a card to open the request; the
// header opens the full wall. Renders nothing when the wall is empty.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { palette, radii, spacing, type, shadow } from "../theme/tokens";
import { Avatar } from "./Avatar";
import type { PrayerWallPost } from "../api/types";

const ADVANCE_MS = 6000;

export function PrayerWallCarousel({
  posts,
  onOpen,
  onSeeAll,
}: {
  posts: PrayerWallPost[];
  onOpen: (postId: string) => void;
  onSeeAll: () => void;
}): ReactElement | null {
  const list = posts.filter((p) => p && p.post_id);
  const { width } = useWindowDimensions();
  const slideW = width - spacing.screen * 2;
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const pageRef = useRef(0);
  const pausedUntil = useRef(0);

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
    pausedUntil.current = Date.now() + ADVANCE_MS * 1.5;
  }

  return (
    <View style={st.wrap}>
      <View style={{ flexDirection: "row", alignItems: "baseline", marginBottom: spacing.md }}>
        <Text style={st.kicker}>PRAY FOR ONE ANOTHER</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onSeeAll} hitSlop={8}><Text style={st.seeAll}>Open wall ›</Text></Pressable>
      </View>
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
        {list.map((p) => (
          <Pressable key={p.post_id} onPress={() => onOpen(p.post_id)} style={[st.slide, { width: slideW }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Avatar uri={p.author_avatar} name={p.author_name} size={32} />
              <Text style={st.author} numberOfLines={1}>{p.author_name}</Text>
            </View>
            {p.title ? <Text style={st.title} numberOfLines={1}>{p.title}</Text> : null}
            <Text style={st.body} numberOfLines={2}>{p.body}</Text>
            <Text style={st.meta}>🙏 {p.pray_count} praying · {p.comment_count} {p.comment_count === 1 ? "reply" : "replies"}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {list.length > 1 ? (
        <View style={st.dots}>
          {list.map((p, i) => (
            <View key={p.post_id} style={[st.dot, { width: i === page ? 18 : 6, backgroundColor: i === page ? palette.gold : palette.border }]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: palette.white, borderRadius: radii.card, padding: spacing.base, borderWidth: 1, borderColor: palette.border, ...shadow.card },
  kicker: { ...type.overline, color: palette.goldLo },
  seeAll: { ...type.micro, color: palette.goldLo, fontWeight: "700" },
  slide: { paddingRight: spacing.xs },
  author: { ...type.caption, fontWeight: "700", color: palette.ink, flex: 1 },
  title: { ...type.heading, color: palette.ink, marginTop: spacing.sm },
  body: { ...type.body, color: palette.ink600, marginTop: 2 },
  meta: { ...type.micro, color: palette.goldLo, fontWeight: "700", marginTop: spacing.sm },
  dots: { flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.md },
  dot: { height: 6, borderRadius: 3 },
});
