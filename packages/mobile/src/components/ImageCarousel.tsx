// A simple, dependency-free image carousel: a paging horizontal ScrollView of
// full-width image slides with dot indicators. Used by the event + announcement
// detail screens (cover image + gallery, up to 6 slides). Renders nothing when
// there are no images. Images are never cropped — a single image uses FitImage
// (container adapts to the image), and the multi-image carousel sizes its slides
// to the first image's aspect ratio (portrait-friendly cap) and uses "contain".
import { useEffect, useState, type ReactElement } from "react";
import { Image, ScrollView, View, useWindowDimensions, type NativeSyntheticEvent, type NativeScrollEvent } from "react-native";
import { palette, radii, spacing } from "../theme/tokens";
import { FitImage } from "./FitImage";
import { cdnImage } from "../util/cdnImage";

export function ImageCarousel({ images, height = 220 }: { images: string[]; height?: number }): ReactElement | null {
  const list = images.filter(Boolean);
  const { width, height: screenH } = useWindowDimensions();
  const slideW = width - spacing.screen * 2;
  const [page, setPage] = useState(0);
  const [aspect, setAspect] = useState<number | null>(null);

  const first = list[0];
  useEffect(() => {
    let alive = true;
    const m = cdnImage(first, { width: slideW });
    if (m) Image.getSize(m, (w, h) => { if (alive && w > 0 && h > 0) setAspect(w / h); }, () => {});
    return () => { alive = false; };
  }, [first]);

  if (list.length === 0) return null;

  // Single image: FitImage adapts the container to the image (never cropped).
  if (list.length === 1 && first) {
    return <FitImage uri={first} radius={radii.card} />;
  }

  // Multi-image: uniform slide height derived from the first image's aspect so the
  // carousel fits the content, clamped to a portrait-friendly range.
  const slideH = Math.min(Math.max(slideW / (aspect ?? slideW / height), 140), Math.round(screenH * 0.7));

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>): void {
    const x = e.nativeEvent.contentOffset.x;
    const next = Math.round(x / slideW);
    if (next !== page) setPage(next);
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
          <View key={`${uri}-${i}`} style={{ width: slideW, height: slideH, borderRadius: radii.card, overflow: "hidden", backgroundColor: palette.mutedBg }}>
            <Image source={{ uri: cdnImage(uri, { width: slideW }) }} style={{ width: slideW, height: slideH }} resizeMode="contain" />
          </View>
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
