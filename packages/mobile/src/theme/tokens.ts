// Mobile design tokens — single source of truth, extracted from the Figma Make
// design ("Nuru Pathway app design"). Brand: deep blue · white · gold · black,
// governed by space + restraint. Mirrors the web token intent so both apps share
// one visual language. No raw hex in screens — compose from here.

export const palette = {
  // Surfaces
  paper: "#F6F4EE", // app background (warm off-white so cards float) — matches make/portal --background
  white: "#FFFFFF", // cards / surfaces
  // Deep blue (brand) — re-anchored to the current make + web portal (--nuru-navy #0B1F33)
  navy: "#0B1F33", // headers, tab bar, chrome
  navyDeep: "#00132F", // primary brand / button base / app frame (deepest navy)
  navy700: "#143559", // gradient top / hover
  // Gold (accent — used sparingly) — re-anchored to make/portal (--nuru-gold #C89B3C)
  gold: "#C89B3C", // accent: indicators, progress, badges, focus ring
  goldHi: "#E0B85E", // gradient top
  goldLo: "#A87F2E", // gradient bottom / gold text on light (≥14px semibold)
  goldGlow: "#E6CA68", // gold text on navy
  goldTint: "#FFF4C7", // subtle gold tint (completed icon bg)
  // Ink (black → greys)
  ink: "#0B0B0C", // primary text on light
  ink600: "#68758A", // secondary text
  ink400: "#8B95A5", // tertiary text
  ink300: "#B5BDC9", // chevrons / faint
  // New-design surfaces & tints (Figma Make redesign, docs/MOBILE_DESIGN_SPEC.md)
  surface: "#FBF8F1", // inset tiles inside white cards
  goldChipBg: "#FFF4DA", // streak/pending chip bg
  goldChipText: "#7A5A14", // chip text on goldChipBg
  verseBg: "#FFF8E6", // verse-for-today card bg
  priorityBg: "#FFFAEC", // priority strip bg
  navyCeremony: "#081C36", // full-dark ceremony screens (login, level complete)
  successBg: "#DCFCE7", // habit-done tile bg
  successText: "#166534", // habit-done tile text
  // Tints & lines
  tintBlue: "#E8EEF7", // selected/active tint
  mutedBg: "#EEF1F5", // neutral icon chip bg
  border: "rgba(10,37,64,0.10)", // card borders / dividers
  track: "rgba(10,37,64,0.10)", // progress track on light
  trackDark: "rgba(255,255,255,0.10)", // progress track on navy
  lockedFill: "#CBD5E1", // locked progress fill
  // Feedback / semantic
  success: "#1E7F4F",
  warning: "#B45309",
  error: "#D4183D",
  // Engagement bands
  thriving: "#1E7F4F",
  steady: "#1B5FAE",
  watch: "#B45309",
  atRisk: "#D4183D",
  // Disabled
  disabledBg: "rgba(10,37,64,0.08)",
  disabledText: "#B0B5BF",
  // On-navy text
  onNavy: "#FFFFFF",
  onNavyDim: "rgba(255,255,255,0.55)",
  onNavyFaint: "rgba(255,255,255,0.40)",
  // Extra surfaces used by Home/Levels/Calendar/Portal/Chat (Figma Make)
  coolPaper: "#F7F9FC", // calendar / portal background
  chatPaper: "#E8E1D3", // chat thread background
  navyMid: "#315F8C", // hero gradient mid tone
  // Soft status chips
  urgentBg: "#FFF8DD",
  urgentBorder: "rgba(217,185,74,0.30)",
  urgentText: "#8A6B10",
  activeBadgeBg: "#DDF4C6",
  activeBadgeText: "#22612A",
  online: "#25D366", // presence dot
  myBubble: "#DDF4C6", // chat outgoing bubble
} as const;

// Gradients (consumed by expo-linear-gradient / RN gradient libs, or flattened).
export const gradients = {
  primaryButton: ["#143559", "#0A2540", "#07203A"] as const,
  goldButton: ["#E5BC3A", "#C9A227", "#A8861C"] as const,
  goldBar: ["#B8911F", "#D8B84D"] as const,
} as const;

// 8pt grid (with 4 + 20 as the Figma screen padding).
export const spacing = { xs: 4, sm: 8, md: 12, base: 16, screen: 20, lg: 24, xl: 32, xxl: 48 } as const;

// Bottom-scroll clearance so the last card never hides behind the ~70px custom
// tab bar (plus a comfortable touch margin). Use on every tab screen's
// ScrollView contentContainerStyle.
export const tabBarSpace = 96;

export const radii = { control: 14, button: 14, card: 24, hero: 30, pill: 999 } as const;

// Type scale (system font: SF on iOS, Roboto on Android). size / lineHeight.
export const type = {
  display: { fontSize: 28, lineHeight: 32, fontWeight: "500" as const, letterSpacing: -1 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: "500" as const, letterSpacing: -0.75 },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: "500" as const, letterSpacing: -0.3 },
  body: { fontSize: 14, lineHeight: 22, fontWeight: "400" as const },
  bodyLg: { fontSize: 16, lineHeight: 26, fontWeight: "400" as const },
  label: { fontSize: 12, lineHeight: 16, fontWeight: "500" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  micro: { fontSize: 11, lineHeight: 14, fontWeight: "500" as const },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const, letterSpacing: 1.8 },
} as const;

// One soft card shadow (never stack heavy shadows). iOS reads the shadow* props
// (unchanged); Android reads `elevation` only — it was too low (2) so Android
// cards looked flat and stacked. Raising elevation makes Android cards float and
// clearly separate, to match the iOS look, without altering the iOS shadow.
export const shadow = {
  card: {
    shadowColor: "#0A2540",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
} as const;

export const buttonHeight = { lg: 56, md: 48 } as const;

/** Engagement band → color (harmonized with the palette). */
export function bandColor(band: string): string {
  switch (band) {
    case "thriving":
      return palette.thriving;
    case "steady":
      return palette.steady;
    case "watch":
      return palette.watch;
    case "at_risk":
      return palette.atRisk;
    default:
      return palette.ink600;
  }
}

export const theme = { palette, gradients, spacing, radii, type, shadow, buttonHeight } as const;
export type Theme = typeof theme;
