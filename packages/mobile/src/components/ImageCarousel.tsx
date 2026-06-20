// A simple, dependency-free image carousel: a paging horizontal ScrollView of
// full-width image slides with dot indicators. Used by the event + announcement
// detail screens (cover image + gallery, up to 6 slides). Renders nothing when
// there are no images.
import { useState, type ReactElement } from "react";
import { Image, ScrollView, View, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { palette, radii, spacing } from "../theme/tokens";

export function ImageCarousel({ images, height = 220 }: { images: string[]; height?: number }): ReactElement | null {
  const list = images.filter(Boolean);
  const { width } = useWindowDimensions();
  const slideW = width - spacing.screen * 2;
  const [page, setPage] = useState(0);
  if (list.length === 0) return null;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / slideW);
    if (next !== page) setPage(next);
  }

  // Single image: no need for a scroll view / dots.
  if (list.length === 1) {
    return <Image source={{ uri: list[0] }} style={{ width: slideW, height, borderRadius: radii.card }} resizeMode="cover" />;
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        decelerationRate="fast"
        snapToInterval={slideW}
      >
        {list.map((uri, i) => (
          <Image
            key={`${uri}-${i}`}
            source={{ uri }}
            style={{ width: slideW, height, borderRadius: radii.card, marginRight: i < list.length - 1 ? 0 : 0 }}
            resizeMode="cover"
          />
        ))}
      </ScrollView>
      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: spacing.sm }}>
        {list.map((_, i) => (
          <View
            key={i}
            style={{
              width: i === page ? 18 : 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: i === page ? palette.gold : palette.border,
            }}
          />
        ))}
      </View>
    </View>
  );
}
