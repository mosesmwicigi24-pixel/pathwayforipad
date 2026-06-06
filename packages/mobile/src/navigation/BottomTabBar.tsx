// Bottom tab bar (Figma "BottomTabBar"). Navy bar, gold active icon + label + dot,
// dim inactive. The three primary destinations map to real screens; deeper tabs
// (Levels/Calendar) land with @react-navigation in a follow-up.
import type { ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useNavigation, type Route } from "./RootNavigator";
import { palette, spacing } from "../theme/tokens";
import { T } from "../theme/components";

type TabId = "Home" | "Giving" | "Profile";
const TABS: Array<{ id: TabId; label: string; glyph: string }> = [
  { id: "Home", label: "Pathway", glyph: "◆" },
  { id: "Giving", label: "Give", glyph: "♥" },
  { id: "Profile", label: "Profile", glyph: "◐" },
];

export function BottomTabBar({ active }: { active: TabId }): ReactElement {
  const nav = useNavigation();
  return (
    <View style={st.bar}>
      {TABS.map((t) => {
        const on = t.id === active;
        return (
          <Pressable
            key={t.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={t.label}
            onPress={() => {
              if (!on) nav.navigate({ name: t.id } as Route);
            }}
            style={st.tab}
          >
            {on ? <View style={st.dot} /> : null}
            <T style={{ fontSize: 18, color: on ? palette.gold : palette.onNavyFaint }}>{t.glyph}</T>
            <T variant="micro" style={{ color: on ? palette.gold : palette.onNavyFaint }}>{t.label}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = {
  bar: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    backgroundColor: palette.navy,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  tab: { alignItems: "center", justifyContent: "center", gap: 2, paddingHorizontal: spacing.base, height: 48 },
  dot: { position: "absolute", top: -2, width: 28, height: 3, borderRadius: 2, backgroundColor: palette.gold },
} as const;
