// Level complete / certificate celebration (Figma "LevelComplete"). Navy screen
// with a concentric gold certificate motif, the level name, a gold rule, and the
// next-level card. Reached when a level is awarded (server-confirmed) or by
// viewing an earned certificate.
import { type ReactElement } from "react";
import { View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { palette, radii, spacing } from "../theme/tokens";
import { PButton, T } from "../theme/components";

export function LevelCompleteScreen(): ReactElement {
  const nav = useNavigation();
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
        </View>

        <T variant="overline" tone="gold" style={{ letterSpacing: 2.2, marginTop: spacing.xl }}>
          CERTIFICATE OF COMPLETION
        </T>
        <T style={st.levelName}>Foundations of Faith</T>
        <T variant="bodyLg" tone="onNavyDim" style={{ marginTop: spacing.md, textAlign: "center" }}>
          Awarded to Moses Mwicigi{"\n"}for completing Level 1
        </T>

        <View style={st.rule}>
          <View style={st.ruleLine} />
          <View style={st.ruleDot} />
          <View style={st.ruleLine} />
        </View>
        <T variant="caption" tone="onNavyFaint">March 2024 · Nuru Place Pathway</T>
      </View>

      {/* Next level card */}
      <View style={st.nextCard}>
        <T variant="overline" tone="onNavyDim">NEXT LEVEL</T>
        <T variant="heading" tone="onNavy" style={{ marginTop: spacing.xs }}>Inner Transformation</T>
        <T variant="caption" tone="onNavyFaint" style={{ marginTop: 2 }}>9 modules · approx. 2 hrs</T>
      </View>

      <PButton variant="gold" onPress={() => nav.navigate({ name: "Home" })}>Begin Level 2</PButton>
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
