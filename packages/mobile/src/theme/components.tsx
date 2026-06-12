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
export function T({
  variant = "body",
  tone = "ink",
  style,
  numberOfLines,
  children,
}: {
  variant?: keyof typeof typ;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  children: ReactNode;
}): ReactNode {
  return (
    <Text numberOfLines={numberOfLines} style={[typ[variant], { color: toneColor[tone] }, style]}>
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
      <Text style={[s.btnLabel, { fontSize: size === "lg" ? 16 : 15, color: disabled ? palette.disabledText : v.fg, fontWeight: v.weight }]}>
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
});
