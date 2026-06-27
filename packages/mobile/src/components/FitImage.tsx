// FitImage — shows an image in full (never cropped) with its container adapting
// to the image's natural aspect ratio. We measure the real pixel size with
// Image.getSize, set the box to that aspect, and use resizeMode="contain" so
// nothing is ever clipped. A portrait-friendly height cap (default 78% of the
// screen) keeps very tall images from dominating; when the cap engages the image
// simply letterboxes (centered, on a muted background) instead of cropping.
//
// Overlay content (gradients, titles, back buttons) can be passed as children —
// it renders above the image, so hero banners stay full-bleed but adapt in height.
import { useEffect, useState, type ReactNode } from "react";
import { Image, View, useWindowDimensions, type StyleProp, type ViewStyle } from "react-native";
import { palette } from "../theme/tokens";
import { cdnImage } from "../util/cdnImage";

export function FitImage({
  uri,
  radius = 0,
  style,
  children,
  fallbackAspect = 4 / 3,
  maxHeight,
  minAspect = 0.62,
  background = palette.mutedBg,
}: {
  uri?: string | null;
  /** Corner radius for the (clipped) container. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  /** Overlay rendered above the image (gradient, title, controls). */
  children?: ReactNode;
  /** width/height ratio used until the natural size loads. */
  fallbackAspect?: number;
  /** Max rendered height (px). Defaults to 78% of the screen — portrait-friendly. */
  maxHeight?: number;
  /** Floor on the aspect so ultra-tall images don't exceed the screen. */
  minAspect?: number;
  background?: string;
}): ReactNode {
  const { height: screenH, width: screenW } = useWindowDimensions();
  const cap = maxHeight ?? Math.round(screenH * 0.78);
  const [aspect, setAspect] = useState<number | null>(null);
  // Device-sized, auto-format copy off the CDN (no-op for non-Cloudinary URLs).
  const src = cdnImage(uri, { width: screenW });

  useEffect(() => {
    let alive = true;
    if (!src) {
      setAspect(null);
      return;
    }
    Image.getSize(
      src,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspect(w / h);
      },
      () => {
        /* keep fallback aspect on failure */
      },
    );
    return () => {
      alive = false;
    };
  }, [src]);

  const aspectRatio = Math.max(aspect ?? fallbackAspect, minAspect);

  return (
    <View
      style={[
        { width: "100%", aspectRatio, maxHeight: cap, borderRadius: radius, overflow: "hidden", backgroundColor: background },
        style,
      ]}
    >
      {src ? <Image source={{ uri: src }} style={{ width: "100%", height: "100%" }} resizeMode="contain" /> : null}
      {children}
    </View>
  );
}
