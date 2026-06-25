// Featured-video player with a YouTube-style "minimize on scroll-away" mini
// window. The inline slot lives inside the scroll content; once it starts
// playing and the user scrolls it out of view, the same video keeps playing in
// a small floating window pinned to the bottom-right of the screen, with a
// close (✕) button to stop and dismiss it. Scrolling back re-docks it inline.
//
// Because the app's Home screen is a single ScrollView, a screen-fixed overlay
// has to be rendered as a sibling of that ScrollView (an absolute child inside
// the scroll content would scroll away too). So this file ships three pieces
// that share one play-state via context:
//   <FeaturedVideoProvider>  — owns play/floating state, polls the slot position
//     <FeaturedVideoInline/> — the in-content slot (poster + play, docked video)
//     <FeaturedVideoOverlay/>— the screen-fixed floating mini-player
// Only ONE <Video> is mounted at a time (inline OR floating); on each hand-off
// it resumes from the last known position via seek, so playback is continuous.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Image, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Video, { type OnLoadData, type OnProgressData } from "react-native-video";
import { Play, X } from "lucide-react-native";
import { palette } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";

const FILL = { position: "absolute" as const, top: 0, left: 0, right: 0, bottom: 0 };

interface Ctx {
  uri: string;
  poster: string | null;
  title: string;
  radius: number;
  fallbackHeight: number;
  playing: boolean;
  floating: boolean;
  aspect: number | null;
  start: () => void;
  close: () => void;
  setSlotRef: (node: View | null) => void;
  bindVideo: (key: string, style: object, controls: boolean) => ReactElement;
}

const FeaturedVideoCtx = createContext<Ctx | null>(null);

export function FeaturedVideoProvider({
  uri,
  poster,
  title,
  radius = 16,
  fallbackHeight = 200,
  children,
}: {
  uri: string;
  poster?: string | null;
  title: string;
  radius?: number;
  fallbackHeight?: number;
  children: ReactNode;
}): ReactElement {
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const [playing, setPlaying] = useState(false);
  const [floating, setFloating] = useState(false);
  const [aspect, setAspect] = useState<number | null>(null);
  const slotRef = useRef<View | null>(null);
  const timeRef = useRef(0); // last known playback position, for seamless hand-off

  // Pre-play: size the inline frame to the poster's aspect (no letterbox bars).
  useEffect(() => {
    let alive = true;
    if (poster) Image.getSize(poster, (w, h) => { if (alive && w > 0 && h > 0) setAspect(w / h); }, () => {});
    return () => { alive = false; };
  }, [poster]);

  // While playing, watch where the inline slot sits on screen. When it leaves
  // the viewport (scrolled above the safe-area top, or pushed below the fold)
  // the video pops out to the floating window; when it returns, it re-docks.
  useEffect(() => {
    if (!playing) { setFloating(false); return; }
    let alive = true;
    const tick = (): void => {
      const node = slotRef.current;
      if (!node) return;
      node.measureInWindow((_x, y, _w, h) => {
        if (!alive || h <= 0) return;
        const top = insets.top + 4;
        const offscreen = y + h * 0.45 < top || y > screenH - 80;
        setFloating((prev) => (prev === offscreen ? prev : offscreen));
      });
    };
    tick();
    const id = setInterval(tick, 300);
    return () => { alive = false; clearInterval(id); };
  }, [playing, insets.top, screenH]);

  const start = useCallback(() => { setPlaying(true); }, []);
  const close = useCallback(() => { setPlaying(false); setFloating(false); timeRef.current = 0; }, []);

  // Build a <Video> bound to the shared handlers. Each mount seeks to the last
  // position so swapping between inline and floating resumes where we left off.
  const bindVideo = useCallback(
    (key: string, style: object, controls: boolean): ReactElement => {
      let ref: { seek: (t: number) => void } | null = null;
      return (
        <Video
          key={key}
          ref={(r) => { ref = r as unknown as { seek: (t: number) => void } | null; }}
          source={{ uri }}
          style={style}
          controls={controls}
          paused={false}
          resizeMode="contain"
          onLoad={(d: OnLoadData) => {
            const n = d?.naturalSize;
            if (n && n.width > 0 && n.height > 0) {
              let a = n.width / n.height;
              if (n.orientation === "portrait" && a > 1) a = 1 / a;
              setAspect(a);
            }
            if (timeRef.current > 0.5 && ref) ref.seek(timeRef.current);
          }}
          onProgress={(p: OnProgressData) => { timeRef.current = p.currentTime; }}
          onEnd={close}
          onError={close}
        />
      );
    },
    [uri, close],
  );

  const value: Ctx = {
    uri, poster: poster ?? null, title, radius, fallbackHeight,
    playing, floating, aspect, start, close,
    setSlotRef: (node) => { slotRef.current = node; },
    bindVideo,
  };
  return <FeaturedVideoCtx.Provider value={value}>{children}</FeaturedVideoCtx.Provider>;
}

function useFeaturedVideo(): Ctx {
  const ctx = useContext(FeaturedVideoCtx);
  if (!ctx) throw new Error("FeaturedVideo components must be inside <FeaturedVideoProvider>");
  return ctx;
}

/** In-content slot: poster + play button, or the docked <Video> when playing. */
export function FeaturedVideoInline(): ReactElement {
  const v = useFeaturedVideo();
  const { height: screenH } = useWindowDimensions();
  const cap = Math.round(screenH * 0.7);
  // Always size the frame to the media's aspect ratio (defaulting to 16:9 until
  // the poster/video is measured) so the card hugs the image/video — never a
  // fixed-height box that letterboxes or crops.
  const a = v.aspect && v.aspect > 0.2 ? v.aspect : 16 / 9;
  const frame = { width: "100%", aspectRatio: a, maxHeight: cap, borderRadius: v.radius, overflow: "hidden", backgroundColor: "#000" } as const;

  // When the video is floating, the inline slot holds its place with the poster
  // still (so the page layout doesn't jump) and the real <Video> lives overlay.
  const showDocked = v.playing && !v.floating;
  return (
    <View ref={v.setSlotRef} collapsable={false} style={frame}>
      {showDocked ? (
        v.bindVideo("inline", FILL, true)
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="Play video" onPress={v.start} style={FILL}>
          {v.poster ? (
            <Image source={{ uri: v.poster }} style={FILL} resizeMode="cover" />
          ) : (
            <GradientBg colors={[palette.navy, palette.navy700, palette.gold]} radius={v.radius} />
          )}
          {!v.playing ? (
            <View style={styles.center}>
              <View style={styles.playBtn}>
                <Play size={26} color={palette.navy} fill={palette.navy} />
              </View>
            </View>
          ) : (
            // Playing in the floating window — hint where it went.
            <View style={[styles.center, { backgroundColor: "rgba(0,0,0,0.35)" }]}>
              <T variant="caption" style={{ color: "#fff", fontWeight: "600" }}>Playing in mini-player ↘</T>
            </View>
          )}
        </Pressable>
      )}
    </View>
  );
}

/**
 * Screen-fixed floating mini-player. Render this once, as a sibling of the
 * screen's ScrollView (NOT inside it), so it stays pinned while the user
 * scrolls. It only appears while the video is both playing and scrolled away.
 */
export function FeaturedVideoOverlay(): ReactElement | null {
  const v = useFeaturedVideo();
  const insets = useSafeAreaInsets();
  if (!(v.playing && v.floating)) return null;
  const a = v.aspect && v.aspect > 0.4 ? v.aspect : 16 / 9;
  const w = 184;
  const h = Math.round(w / a);
  return (
    <View pointerEvents="box-none" style={FILL}>
      <View style={[styles.floatWrap, { right: 12, bottom: insets.bottom + 90, width: w }]}>
        <View style={styles.floatHeader}>
          <T variant="micro" numberOfLines={1} style={styles.floatTitle}>{v.title}</T>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close mini-player"
            hitSlop={8}
            onPress={v.close}
            style={styles.closeBtn}
          >
            <X size={14} color="#fff" />
          </Pressable>
        </View>
        <View style={{ width: w, height: h, backgroundColor: "#000" }}>
          {v.bindVideo("float", { width: w, height: h }, false)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...FILL, alignItems: "center", justifyContent: "center" },
  playBtn: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.92)",
    alignItems: "center", justifyContent: "center",
  },
  floatWrap: {
    position: "absolute",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#0B1220",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  floatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
  },
  floatTitle: { flex: 1, color: "#fff", fontWeight: "700" },
  closeBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center", justifyContent: "center",
  },
});
