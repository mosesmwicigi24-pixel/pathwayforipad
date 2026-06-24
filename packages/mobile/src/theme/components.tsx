// Shared UI primitives for the mobile app, composed entirely from design tokens
// (Figma "Nuru Pathway app design"). Screens compose these — no ad-hoc inline
// hex. Icons are passed in as nodes so the set stays swappable.
import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import Svg, { Defs, LinearGradient as SvgGradient, Rect, Stop } from "react-native-svg";
import { palette, radii, shadow, spacing, type as typ, buttonHeight } from "./tokens.js";
import { rf } from "./responsive.js";
import { useFontScale } from "./fontScale.js";

// --- GradientBg: an absolutely-filling linear gradient (uses react-native-svg).
// Diagonal top-left → bottom-right by default, matching the Figma hero blocks.
export function GradientBg({
  colors,
  radius = 0,
  style,
}: {
  colors: readonly [string, string, ...string[]];
  radius?: number;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <SvgGradient id="g" x1="0" y1="0" x2="1" y2="1">
            {colors.map((c, i) => (
              <Stop key={`${c}-${i}`} offset={i / (colors.length - 1)} stopColor={c} stopOpacity={1} />
            ))}
          </SvgGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
      </Svg>
    </View>
  );
}

// --- Glow: a soft blurred-looking accent orb for navy headers (approximated with
// a low-opacity rounded circle since RN has no cheap blur primitive).
export function Glow({
  size = 220,
  color = "rgba(201,162,39,0.10)",
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  return (
    <View
      pointerEvents="none"
      style={[{ position: "absolute", width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]}
    />
  );
}

// --- Screen: paper background + safe padding, scrollable by default ---
export function Screen({
  children,
  scroll = true,
  padded = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  const inner = padded ? { padding: spacing.screen } : undefined;
  if (scroll) {
    return (
      <ScrollView
        style={[s.screen, style]}
        contentContainerStyle={[inner, { paddingBottom: spacing.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[s.screen, inner, style]}>{children}</View>;
}

// --- Card: white rounded surface with one soft shadow ---
export function Card({
  children,
  style,
  accent = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accent?: boolean;
}): ReactNode {
  return <View style={[s.card, accent && s.cardAccent, style]}>{children}</View>;
}

// --- Text helpers (typographic scale) ---
type TextTone = "ink" | "secondary" | "tertiary" | "onNavy" | "onNavyDim" | "onNavyFaint" | "gold";
const toneColor: Record<TextTone, string> = {
  ink: palette.ink,
  secondary: palette.ink600,
  tertiary: palette.ink400,
  onNavy: palette.onNavy,
  onNavyDim: palette.onNavyDim,
  onNavyFaint: palette.onNavyFaint,
  gold: palette.goldLo,
};
// Bundled OFL faces (src/assets/fonts, linked via react-native.config.js). We
// reference each weight by its exact face name — identical to its PostScript name
// — so it resolves the same way on Android (asset filename) and iOS (PostScript
// name), with no system-font fallback. Fraunces = display serif (the design's
// web face); Inter = body sans. Named faces are required on Android because the
// platform picks the face by name, not by `fontWeight`; we therefore resolve the
// face from the *effective* weight (variant default merged with any style
// override) in T(), so a call-site `fontWeight` still lands on the right face.
const INTER: Record<number, string> = {
  400: "Inter-Regular",
  500: "Inter-Medium",
  600: "Inter-SemiBold",
  700: "Inter-Bold",
};
const FRAUNCES: Record<number, string> = {
  400: "Fraunces-Regular",
  500: "Fraunces-Medium",
  600: "Fraunces-SemiBold",
  700: "Fraunces-Bold",
};

/** Snap any CSS weight (100–900, "bold", "normal") to one of our 4 bundled faces. */
function snapWeight(w: TextStyle["fontWeight"] | undefined, fallback: number): 400 | 500 | 600 | 700 {
  const n = w === "bold" ? 700 : w === "normal" ? 400 : typeof w === "string" ? parseInt(w, 10) : typeof w === "number" ? w : NaN;
  const v = Number.isFinite(n) ? n : fallback;
  if (v >= 700) return 700;
  if (v >= 600) return 600;
  if (v >= 500) return 500;
  return 400;
}

/** Resolve the bundled font face for a text element from its effective weight. */
export function fontFace(serif: boolean, weight: TextStyle["fontWeight"] | undefined, fallback = 400): string {
  const map = serif ? FRAUNCES : INTER;
  return map[snapWeight(weight, fallback)] as string;
}

// Back-compat: some screens import SERIF directly for ad-hoc <Text>. Point it at
// the SemiBold display face (the most common serif use).
export const SERIF = FRAUNCES[600];

export function T({
  variant = "body",
  tone = "ink",
  serif = false,
  style,
  numberOfLines,
  children,
}: {
  variant?: keyof typeof typ;
  tone?: TextTone;
  /** Display serif for titles/scripture/big numerals (Fraunces). */
  serif?: boolean;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
}): ReactNode {
  // Subscribe to the user font-size preference so a change re-renders all text
  // (rf() reads the same multiplier under the hood).
  useFontScale();
  // Effective weight = variant default overridden by anything in `style`.
  const v = typ[variant] as TextStyle;
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const face = fontFace(serif, flat.fontWeight ?? v.fontWeight, serif ? 600 : 400);
  // Responsive type: scale the EFFECTIVE size (inline override or the variant
  // default) to this device, so every T text flexes with the screen.
  const baseFs = (flat.fontSize ?? v.fontSize ?? 14) as number;
  const baseLh = (flat.lineHeight ?? v.lineHeight) as number | undefined;
  const scaled: TextStyle = { fontSize: rf(baseFs) };
  if (baseLh != null) scaled.lineHeight = rf(baseLh);
  // Fraunces (serif) has taller ascenders/longer descenders than the system font,
  // so guarantee enough line height to never clip glyphs.
  const fs = scaled.fontSize as number;
  const lh = scaled.lineHeight;
  const serifLine = serif ? { lineHeight: Math.max(lh ?? 0, Math.ceil(fs * 1.28)) } : null;
  return (
    <Text
      numberOfLines={numberOfLines}
      // scaled + serifLine + fontFamily LAST so they win over anything in `style`.
      style={[typ[variant], { color: toneColor[tone] }, style, scaled, serifLine, { fontFamily: face }]}
    >
      {children}
    </Text>
  );
}

// --- Button: primary (navy) · gold · ghost · ghostDark, lg/md ---
type ButtonVariant = "primary" | "gold" | "ghost" | "ghostDark";
export function PButton({
  children,
  onPress,
  variant = "primary",
  size = "lg",
  disabled = false,
  leadingIcon,
  trailingIcon,
  fullWidth = true,
  accessibilityLabel,
}: {
  children: ReactNode;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: "lg" | "md";
  disabled?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
  accessibilityLabel?: string;
}): ReactNode {
  const v = BTN[variant];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        s.btn,
        { height: buttonHeight[size], backgroundColor: v.bg, borderColor: v.border ?? "transparent", borderWidth: v.border ? 1 : 0 },
        fullWidth && { alignSelf: "stretch" },
        disabled && { backgroundColor: palette.disabledBg, borderWidth: 0 },
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {leadingIcon ? <View style={s.btnIcon}>{leadingIcon}</View> : null}
      <Text style={[s.btnLabel, { fontSize: rf(size === "lg" ? 16 : 15), color: disabled ? palette.disabledText : v.fg, fontWeight: v.weight, fontFamily: fontFace(false, v.weight, 600) }]}>
        {children}
      </Text>
      {trailingIcon ? <View style={[s.btnIcon, { marginLeft: "auto" }]}>{trailingIcon}</View> : null}
    </Pressable>
  );
}

const BTN: Record<ButtonVariant, { bg: string; fg: string; border?: string; weight: TextStyle["fontWeight"] }> = {
  primary: { bg: palette.navyDeep, fg: palette.white, weight: "600" },
  gold: { bg: palette.gold, fg: palette.navyDeep, weight: "700" },
  ghost: { bg: palette.white, fg: palette.navy, border: palette.border, weight: "500" },
  ghostDark: { bg: "rgba(255,255,255,0.06)", fg: palette.onNavy, border: "rgba(255,255,255,0.12)", weight: "500" },
};

// --- Pill: compact status/label chip ---
export function Pill({
  children,
  color = palette.ink600,
  bg = palette.white,
  style,
}: {
  children: ReactNode;
  color?: string;
  bg?: string;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  return (
    <View style={[s.pill, { backgroundColor: bg }, style]}>
      <Text style={[typ.micro, { color }]}>{children}</Text>
    </View>
  );
}

// --- ProgressBar: gold (or given) fill on a track ---
export function ProgressBar({
  pct,
  fill = palette.gold,
  track = palette.track,
  height = 8,
}: {
  pct: number;
  fill?: string;
  track?: string;
  height?: number;
}): ReactNode {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <View style={[s.track, { backgroundColor: track, height, borderRadius: height }]}>
      <View style={{ width: `${clamped}%`, height: "100%", backgroundColor: fill, borderRadius: height }} />
    </View>
  );
}

// --- SectionHeader: overline + title ---
export function SectionHeader({ overline, title }: { overline: string; title: string }): ReactNode {
  return (
    <View style={{ marginBottom: spacing.base }}>
      <Text style={[typ.overline, { color: palette.ink600, textTransform: "uppercase" }]}>{overline}</Text>
      <Text style={[typ.title, { color: palette.ink, marginTop: spacing.xs }]}>{title}</Text>
    </View>
  );
}

// --- EmptyState: centered icon chip + title + muted message + optional action.
// For lists/screens that have nothing to show yet. Icons are passed in as nodes
// (lucide-react-native) so the set stays swappable, matching the file's pattern.
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: { label: string; onPress: () => void };
}): ReactNode {
  return (
    <View style={s.stateWrap}>
      {icon ? (
        <View style={[s.stateChip, { backgroundColor: palette.mutedBg }]}>{icon}</View>
      ) : null}
      <Text style={[typ.heading, { color: palette.ink, textAlign: "center" }]}>{title}</Text>
      {message ? <Text style={[typ.body, s.stateMsg, { color: palette.ink600 }]}>{message}</Text> : null}
      {action ? (
        <View style={{ marginTop: spacing.base }}>
          <PButton variant="ghost" size="md" fullWidth={false} onPress={action.onPress}>
            {action.label}
          </PButton>
        </View>
      ) : null}
    </View>
  );
}

// --- ErrorState: centered error glyph + message + optional retry (palette.error
// tones). The glyph is a token-tinted "!" disc so we add no icon dependency here.
export function ErrorState({
  message = "Something went wrong",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}): ReactNode {
  return (
    <View style={s.stateWrap}>
      <View style={[s.stateChip, { backgroundColor: "rgba(212,24,61,0.10)" }]}>
        <Text style={{ color: palette.error, fontSize: 22, fontWeight: "700", lineHeight: 26 }}>!</Text>
      </View>
      <Text style={[typ.heading, { color: palette.ink, textAlign: "center" }]}>{message}</Text>
      {onRetry ? (
        <View style={{ marginTop: spacing.base }}>
          <PButton variant="ghost" size="md" fullWidth={false} onPress={onRetry}>
            Try again
          </PButton>
        </View>
      ) : null}
    </View>
  );
}

// --- Skeleton: a static neutral placeholder block (no animation dependency).
// Compose into list/card shapes while data loads.
export function Skeleton({
  height = 16,
  width = "100%",
  radius = radii.control,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
}): ReactNode {
  return <View style={{ height, width, borderRadius: radius, backgroundColor: palette.mutedBg }} />;
}

// --- SkeletonList: a stack of skeleton rows on inset surfaces — a quick standin
// for a list of cards while the real rows load.
export function SkeletonList({ rows = 3 }: { rows?: number }): ReactNode {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={s.skeletonRow}>
          <Skeleton height={40} width={40} radius={radii.control} />
          <View style={{ flex: 1, gap: spacing.sm }}>
            <Skeleton height={14} width="70%" />
            <Skeleton height={10} width="40%" />
          </View>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.paper },
  card: {
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: palette.border,
    padding: spacing.base,
    ...shadow.card,
  },
  cardAccent: { borderColor: "rgba(201,162,39,0.5)" },
  btn: {
    borderRadius: radii.button,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 10,
  },
  btnLabel: { letterSpacing: -0.15 },
  btnIcon: { alignItems: "center", justifyContent: "center" },
  pill: { borderRadius: radii.pill, paddingHorizontal: 12, paddingVertical: 6, alignSelf: "flex-start" },
  track: { width: "100%", overflow: "hidden" },
  stateWrap: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.base },
  stateChip: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: spacing.base },
  stateMsg: { textAlign: "center", marginTop: spacing.xs, maxWidth: 320 },
  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.surface,
    borderRadius: radii.card,
    padding: spacing.base,
  },
});
