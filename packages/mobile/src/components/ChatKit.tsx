// Shared visual primitives for the redesigned Chat screens ("Aurora" presentation
// from the Figma make). These are presentation-only: they hold no API wiring, so
// ChatScreen (inbox) and ChatThreadScreen (thread) stay readable while sharing the
// premium look — gold story-rings, per-sender color coding, read ticks, voice
// waveform, and date dividers. All colors come from the
// design tokens (palette/spacing/radii); the few chat-only accents (warm canvas,
// soft bubble fills) are defined once here so they read consistently.
import { type ReactElement, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Check, CheckCheck } from "lucide-react-native";
import { palette, spacing } from "../theme/tokens";
import { T } from "../theme/components";

// "Aurora" chat-canvas accents. The warm canvas (#E8E1D3) already lives in tokens
// as palette.chatPaper; the soft bubble fills are chat-only and centralized here.
export const CHAT = {
  canvas: palette.chatPaper, // warm canvas so the light bubbles read
  incoming: "#F3F4F3", // incoming (other) bubble
  outgoing: "#F3F4F3", // outgoing (you) bubble — navy-text on light, per the make
  bubbleText: "#17283D", // body text on light bubbles
  meta: palette.ink400, // timestamps
  bubbleBorder: "rgba(11,31,51,0.07)",
  quoteBg: "rgba(11,31,51,0.05)",
  goldRing: palette.gold,
} as const;

// Per-sender color coding for group/space chats (Telegram/Slack pattern). Each
// participant gets a stable, harmonious accent (saturated, readable on light) plus
// a soft tint for any chip backgrounds. Hashed from the author id so a person keeps
// their color across renders.
const SENDER_PALETTE: { name: string; tint: string }[] = [
  { name: "#4F46E5", tint: "#EEF0FE" }, // indigo
  { name: "#0284C7", tint: "#E6F4FC" }, // sky
  { name: "#0D9488", tint: "#E3F5F2" }, // teal
  { name: "#059669", tint: "#E7F6EF" }, // emerald
  { name: "#DB2777", tint: "#FCECF4" }, // pink
  { name: "#C2410C", tint: "#FCEEE5" }, // burnt orange
  { name: "#7C3AED", tint: "#F1ECFE" }, // violet
  { name: "#B45309", tint: "#FBF1E2" }, // amber
];

export function senderColor(id: string): { name: string; tint: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SENDER_PALETTE[h % SENDER_PALETTE.length] as { name: string; tint: string };
}

// WhatsApp-style read ticks: ✓ sent · ✓✓ grey delivered · ✓✓ blue read.
export function ReadTicks({ state }: { state: "sent" | "delivered" | "read" }): ReactElement {
  if (state === "read") return <CheckCheck size={14} color="#53BDEB" />;
  if (state === "delivered") return <CheckCheck size={14} color="rgba(255,255,255,0.6)" />;
  return <Check size={14} color="rgba(255,255,255,0.6)" />;
}

// A static decorative voice waveform (we don't persist real amplitude data). The
// `progress` (0..1) fills bars left-to-right while a voice note plays.
const WAVE = [0.3, 0.6, 0.9, 0.5, 0.8, 1, 0.7, 0.4, 0.6, 0.85, 0.5, 0.7, 0.95, 0.6, 0.35, 0.7, 0.5, 0.8, 0.4, 0.6, 0.9, 0.5];
export function Waveform({ color, dimColor, progress = 0, height = 22 }: { color: string; dimColor: string; progress?: number; height?: number }): ReactElement {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height }}>
      {WAVE.map((h, i) => {
        const filled = i / WAVE.length <= progress;
        return <View key={i} style={{ width: 2.5, borderRadius: 2, height: Math.max(0.2, h) * height, backgroundColor: filled ? color : dimColor }} />;
      })}
    </View>
  );
}

// A soft horizontal date divider ("Today", "Yesterday", "Mar 3").
export function DateDivider({ label }: { label: string }): ReactElement {
  return (
    <View style={ck.dividerRow}>
      <View style={ck.dividerLine} />
      <T variant="overline" tone="gold" style={{ letterSpacing: 2 }}>{label}</T>
      <View style={ck.dividerLine} />
    </View>
  );
}

// A small uppercase gold section label (with an optional leading glyph + trailing).
export function SectionLabel({ glyph, text, trailing }: { glyph?: ReactNode; text: string; trailing?: ReactNode }): ReactElement {
  return (
    <View style={ck.sectionRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {glyph ? <View>{glyph}</View> : null}
        <T variant="overline" tone="gold">{text}</T>
      </View>
      {trailing ?? null}
    </View>
  );
}

const ck = StyleSheet.create({
  dividerRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.base },
  dividerLine: { flex: 1, height: 1, backgroundColor: "rgba(11,31,51,0.12)" },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, marginBottom: spacing.sm, paddingHorizontal: 2 },
});
