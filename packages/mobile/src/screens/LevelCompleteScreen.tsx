// Level complete / certificate celebration (Figma "LevelComplete"). Navy screen
// with a concentric gold certificate motif, the level name, a gold rule, and the
// next-level card. Reached when a level is awarded (server-confirmed) or by
// viewing an earned certificate.
import { type ReactElement } from "react";
import { View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing } from "../theme/tokens";
import { PButton, T } from "../theme/components";
import { usePathway, useMe } from "../api/hooks";

export function LevelCompleteScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: pathway } = usePathway();
  const { data: me } = useMe();

  const levels = pathway?.levels ?? [];
  // The most-recently completed level (highest with all modules done).
  const completed = [...levels].reverse().find((l) => l.total_modules > 0 && l.completed_modules >= l.total_modules);
  const nextLevel = completed ? levels.find((l) => l.level_number === completed.level_number + 1) : levels[0];
  const name = me?.profile?.full_name ?? "you";
  const monthYear = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <View style={st.root}>
      <View style={st.center}>
        {/* Concentric ring certificate motif */}
        <View style={st.rings}>
          <View style={[st.ring, st.ring0, { borderColor: "rgba(201,162,39,0.12)" }]} />
          <View style={[st.ring, st.ring1, { borderColor: "rgba(201,162,39,0.25)" }]} />
          <View style={st.ringCore}>
            <T style={{ fontSize: 40 }}>✦</T>
            <T variant="micro" tone="gold" style={{ letterSpacing: 1.8, marginTop: 2 }}>COMPLETED</T>
          </View>
          {/* Gold dots around the outer ring */}
          {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
            <View key={deg} style={[st.ringDot, { transform: [{ rotate: `${deg}deg` }, { translateY: -(RING / 2) + 2 }] }]} />
          ))}
        </View>

        <T variant="overline" tone="gold" style={{ letterSpacing: 2.2, marginTop: spacing.xl }}>
          CERTIFICATE OF COMPLETION
        </T>
        <T serif style={st.levelName}>{completed?.title ?? "Your Level"}</T>
        <T variant="bodyLg" tone="onNavyDim" style={{ marginTop: spacing.md, textAlign: "center" }}>
          {`Awarded to ${name}\nfor completing Level ${completed?.level_number ?? ""}`.trim()}
        </T>

        <View style={st.rule}>
          <View style={st.ruleLine} />
          <View style={st.ruleDot} />
          <View style={st.ruleLine} />
        </View>
        <T variant="caption" tone="onNavyFaint">{`${monthYear} · Nuru Place Pathway`}</T>
      </View>

      {/* Next level card */}
      {nextLevel ? (
        <View style={st.nextCard}>
          <T variant="overline" tone="onNavyDim">NEXT LEVEL</T>
          <T variant="heading" tone="onNavy" style={{ marginTop: spacing.xs }}>{nextLevel.title}</T>
          <T variant="caption" tone="onNavyFaint" style={{ marginTop: 2 }}>
            {`${nextLevel.total_modules} modules · approx. ${Math.round(nextLevel.minutes / 60) || 1} hr${nextLevel.minutes >= 120 ? "s" : ""}`}
          </T>
        </View>
      ) : null}

      <PButton variant="gold" onPress={() => nav.navigate("Tabs", { screen: "Home" })}>
        {nextLevel ? `Begin Level ${nextLevel.level_number}` : "Continue"}
      </PButton>
    </View>
  );
}

const RING = 210;
const st = {
  root: { flex: 1, backgroundColor: "#081C36", paddingHorizontal: spacing.lg, paddingTop: 60, paddingBottom: spacing.xxl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  rings: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderRadius: RING / 2, borderWidth: 1 },
  ring0: { top: 0, left: 0, right: 0, bottom: 0 },
  ring1: { top: 14, left: 14, right: 14, bottom: 14 },
  ringDot: { position: "absolute", width: 5, height: 5, borderRadius: 2.5, backgroundColor: palette.gold, opacity: 0.45 },
  ringCore: {
    position: "absolute",
    top: 28,
    left: 28,
    right: 28,
    bottom: 28,
    borderRadius: (RING - 56) / 2,
    borderWidth: 2,
    borderColor: palette.gold,
    backgroundColor: "rgba(201,162,39,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  levelName: { color: palette.white, fontSize: 32, fontWeight: "800", letterSpacing: -1, textAlign: "center", lineHeight: 40, marginTop: spacing.md },
  rule: { flexDirection: "row", alignItems: "center", gap: spacing.md, width: 200, marginVertical: spacing.lg },
  ruleLine: { flex: 1, height: 1, backgroundColor: "rgba(201,162,39,0.3)" },
  ruleDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.gold },
  nextCard: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.2)",
    padding: spacing.base,
    marginBottom: spacing.base,
  },
} as const;
