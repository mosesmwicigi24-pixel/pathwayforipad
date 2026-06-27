// A recurring growth call-to-action row: Spiritual gifts · Practice memory verse
// · Let's pray. Dropped onto growth-facing screens so these disciplines are always
// one tap away.
import { type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { HandHeart, Quote, Sparkles, type LucideIcon } from "lucide-react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing, shadow } from "../theme/tokens";
import { T } from "../theme/components";

type Cta = { key: string; label: string; sub: string; Icon: LucideIcon; tint: string; fg: string; go: (n: NativeStackNavigationProp<RootStackParamList>) => void };

const CTAS: Cta[] = [
  { key: "wall", label: "Prayer Wall", sub: "Pray with the family", Icon: HandHeart, tint: "#FEE2E2", fg: "#B91C1C", go: (n) => n.navigate("PrayerWall") },
  { key: "gifts", label: "Your Calling", sub: "Discover your gifts", Icon: Sparkles, tint: "#F3E8FF", fg: "#A855F7", go: (n) => n.navigate("Gifts") },
  { key: "verse", label: "Hide His Word", sub: "Memorize Scripture", Icon: Quote, tint: "#FEF3C7", fg: "#B45309", go: (n) => n.navigate("MemoryVerses") },
];

export function GrowthCtaRow(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      {CTAS.map((c) => (
        <Pressable
          key={c.key}
          accessibilityRole="button"
          accessibilityLabel={`${c.label} — ${c.sub}`}
          onPress={() => c.go(nav)}
          style={({ pressed }) => [s.card, pressed && { opacity: 0.9 }]}
        >
          <View style={[s.icon, { backgroundColor: c.tint }]}>
            <c.Icon size={18} color={c.fg} />
          </View>
          <T variant="caption" style={{ fontWeight: "700", color: palette.ink, marginTop: 8 }} numberOfLines={1}>{c.label}</T>
          <T variant="micro" tone="tertiary" numberOfLines={1}>{c.sub}</T>
        </Pressable>
      ))}
    </View>
  );
}

const s = {
  card: { flex: 1, minWidth: 0, backgroundColor: palette.white, borderRadius: 18, borderWidth: 1, borderColor: palette.border, padding: spacing.md, ...shadow.card },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
} as const;
