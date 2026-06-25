// Home "give" banner — a calm, illustrative call to support God's work. The
// artwork is a vector scene (dawn glow + a heart cradled in open hands, soft
// rays) drawn with react-native-svg so it stays crisp at any size and needs no
// raster asset. Motivational copy + a single gold CTA sit below the image, kept
// quiet and uncluttered (one accent colour, generous whitespace).
import { type ReactElement } from "react";
import { Pressable, View } from "react-native";
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Path, Line, G } from "react-native-svg";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { HandCoins, ChevronRight } from "lucide-react-native";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";

const GOLD = "#E6C36A"; // warm gold for the artwork (slightly lighter than the chrome gold)

/** The vector scene — dawn over a still navy field, a few soft rays, and a heart
 *  held up by open cupped hands. Deliberately minimal and low-contrast. */
function GiveArt(): ReactElement {
  return (
    <Svg width="100%" height={156} viewBox="0 0 320 156" preserveAspectRatio="xMidYMid slice">
      <Defs>
        <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#0A1B2E" />
          <Stop offset="0.55" stopColor="#102A45" />
          <Stop offset="1" stopColor="#1E3A52" />
        </LinearGradient>
        <RadialGradient id="dawn" cx="160" cy="150" r="120" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#E6C36A" stopOpacity="0.55" />
          <Stop offset="0.55" stopColor="#C89B3C" stopOpacity="0.14" />
          <Stop offset="1" stopColor="#C89B3C" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="heartFill" cx="160" cy="84" r="34" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#F1D998" stopOpacity="0.9" />
          <Stop offset="1" stopColor="#E6C36A" stopOpacity="0.25" />
        </RadialGradient>
      </Defs>

      {/* Night-to-dawn sky + warm glow rising from the horizon */}
      <Rect x="0" y="0" width="320" height="156" fill="url(#sky)" />
      <Rect x="0" y="0" width="320" height="156" fill="url(#dawn)" />

      {/* Soft rays fanning up from the dawn — very faint so it never shouts */}
      <G stroke={GOLD} strokeWidth="1" opacity="0.12">
        <Line x1="160" y1="150" x2="60" y2="6" />
        <Line x1="160" y1="150" x2="110" y2="0" />
        <Line x1="160" y1="150" x2="160" y2="-4" />
        <Line x1="160" y1="150" x2="210" y2="0" />
        <Line x1="160" y1="150" x2="260" y2="6" />
      </G>

      {/* Heart of light — the gift, lifted up */}
      <Path
        d="M160 104 C150 92 132 91 132 77 C132 68 142 64 150 70 C154 73 158 78 160 82 C162 78 166 73 170 70 C178 64 188 68 188 77 C188 91 170 92 160 104 Z"
        fill="url(#heartFill)"
        stroke={GOLD}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />

      {/* Open cupped hands cradling the heart */}
      <G stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" fill="none" opacity="0.8">
        <Path d="M96 112 C112 136 148 142 160 142 C172 142 208 136 224 112" />
        {/* thumbs */}
        <Path d="M96 112 C92 106 92 100 96 96" />
        <Path d="M224 112 C228 106 228 100 224 96" />
      </G>
    </Svg>
  );
}

/** Full banner: artwork on top, motivational copy + a single CTA below. */
export function GiveBanner(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={s.card}>
      <View style={s.art}>
        <GiveArt />
      </View>
      <View style={s.body}>
        <View style={s.kickerRow}>
          <View style={s.dot} />
          <T variant="micro" style={s.kicker}>SUPPORT GOD&apos;S WORK</T>
        </View>
        <T serif style={s.headline}>Sow into something eternal</T>
        <T variant="caption" tone="secondary" style={s.explain}>
          Every gift carries the gospel further — raising disciples, sustaining the mission, and
          lighting the way for the next person to find Christ. Give cheerfully, as the Lord leads.
        </T>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Give now"
          onPress={() => nav.navigate("Tabs", { screen: "Give" })}
          style={({ pressed }) => [s.cta, pressed && { opacity: 0.92 }]}
        >
          <HandCoins size={18} color={palette.navy} />
          <T variant="caption" style={s.ctaLabel}>Give now</T>
          <ChevronRight size={18} color={palette.navy} />
        </Pressable>
        <T variant="micro" tone="tertiary" style={s.hint}>Tithe &amp; offering · M-Pesa, card and more</T>
      </View>
    </View>
  );
}

const s = {
  card: {
    backgroundColor: palette.white,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: "hidden" as const,
    ...shadow.card,
  },
  art: { backgroundColor: "#0A1B2E" },
  body: { padding: spacing.base, paddingTop: spacing.md },
  kickerRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: palette.gold },
  kicker: { color: palette.goldChipText, fontWeight: "700" as const, letterSpacing: 1.6 },
  headline: { fontSize: 19, color: palette.navy, marginTop: 6 },
  explain: { marginTop: 6, lineHeight: 20 },
  cta: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 8,
    marginTop: spacing.base,
    height: 48,
    borderRadius: 14,
    backgroundColor: palette.gold,
  },
  ctaLabel: { color: palette.navy, fontWeight: "700" as const, fontSize: 15 },
  hint: { textAlign: "center" as const, marginTop: 10 },
} as const;
