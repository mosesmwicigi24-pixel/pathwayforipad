// Shared sub-page header for the Community/Events family of screens (Figma Make
// "CommunityPage" wrapper). A navy gradient block with a soft gold radial glow,
// a glassy translucent back button, an uppercase eyebrow pill, a large display
// title, an optional subtitle, and a thin gold underline accent. Kept generic so
// it can also front Cohort / Moments / Announcements / Series later — it only
// renders the chrome; each screen scrolls its own content beneath it.
import { type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { ChevronLeft } from "lucide-react-native";
import Svg, { Defs, RadialGradient as SvgRadial, Rect, Stop } from "react-native-svg";
import { palette, radii, spacing } from "../theme/tokens";
import { GradientBg, T } from "../theme/components";

// A soft gold orb, approximated with an SVG radial gradient (RN has no cheap
// blur). Positioned by the caller via `style`.
function GoldGlow({ size, tint }: { size: number; tint: string }): ReactElement {
  return (
    <Svg width={size} height={size}>
      <Defs>
        <SvgRadial id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={tint} stopOpacity={1} />
          <Stop offset="1" stopColor={tint} stopOpacity={0} />
        </SvgRadial>
      </Defs>
      <Rect x="0" y="0" width={size} height={size} fill="url(#glow)" />
    </Svg>
  );
}

export function CommunityPageHeader({
  eyebrow,
  title,
  subtitle,
  onBack,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  onBack: () => void;
}): ReactElement {
  return (
    <View style={st.header}>
      <GradientBg colors={[palette.navy700, palette.navy, palette.navyDeep]} radius={radii.hero} />
      {/* Ambient gold + cool radial glows */}
      <View pointerEvents="none" style={st.glowGold}>
        <GoldGlow size={224} tint="rgba(201,162,39,0.33)" />
      </View>
      <View pointerEvents="none" style={st.glowCool}>
        <GoldGlow size={176} tint="rgba(74,123,176,0.33)" />
      </View>

      <View style={st.topRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => [st.backBtn, pressed && st.backPressed]}
        >
          <ChevronLeft size={20} color={palette.onNavy} />
        </Pressable>
        <View style={st.eyebrow}>
          <T variant="micro" style={st.eyebrowText}>{eyebrow.toUpperCase()}</T>
        </View>
      </View>

      <T serif tone="onNavy" style={st.title}>{title}</T>
      {subtitle ? <T variant="caption" tone="onNavyDim" style={st.subtitle}>{subtitle}</T> : null}
      <View style={st.underline}>
        <GradientBg colors={[palette.gold, "rgba(201,162,39,0)"]} />
      </View>
    </View>
  );
}

const st = {
  header: {
    paddingHorizontal: spacing.screen,
    paddingTop: 54,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radii.hero,
    borderBottomRightRadius: radii.hero,
    overflow: "hidden",
  },
  glowGold: { position: "absolute", top: -80, right: -64 },
  glowCool: { position: "absolute", bottom: -96, left: -40 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: radii.control,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  backPressed: { transform: [{ scale: 0.95 }], opacity: 0.85 },
  eyebrow: {
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  eyebrowText: { color: palette.goldLight, letterSpacing: 1.6, fontWeight: "700" },
  title: { marginTop: spacing.base, fontSize: 27, lineHeight: 32, letterSpacing: -0.5, fontWeight: "600" },
  subtitle: { marginTop: 6 },
  underline: { marginTop: 14, height: 3, width: 48, borderRadius: 2, overflow: "hidden" },
} as const;
