// Bottom tab bar (new design, Contract Matrix M1) as a custom @react-navigation
// tabBar. Navy bar, gold active icon + label + indicator dot, dim inactive.
// Five primary destinations: Home · Pathway · Give · Community · Profile.
import type { ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { BookOpen, CalendarDays, HandHeart, House, MessageCircle, User, type LucideIcon } from "lucide-react-native";
import { palette, spacing } from "../theme/tokens";
import { T } from "../theme/components";
import { TAB_LABELS } from "./tabs";

const ICONS: Record<string, LucideIcon> = {
  Home: House,
  Pathway: BookOpen,
  Give: HandHeart,
  Events: CalendarDays,
  Chat: MessageCircle,
  Profile: User,
};

const META: Record<string, { label: string; Icon: LucideIcon }> = Object.fromEntries(
  Object.entries(TAB_LABELS).map(([name, label]) => [name, { label, Icon: ICONS[name] ?? House }]),
);

export function BottomTabBar({ state, navigation }: BottomTabBarProps): ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.bar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const meta = META[route.name] ?? { label: route.name, Icon: House };
        const color = focused ? palette.gold : palette.onNavyFaint;
        const onPress = (): void => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: focused }}
            accessibilityLabel={meta.label}
            onPress={onPress}
            style={st.tab}
          >
            {focused ? <View style={st.dot} /> : null}
            <meta.Icon size={21} color={color} strokeWidth={focused ? 2.2 : 1.7} />
            <T variant="micro" style={{ color }}>{meta.label}</T>
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
  },
  tab: { alignItems: "center", justifyContent: "center", gap: 3, paddingHorizontal: spacing.sm, height: 48, flex: 1 },
  dot: { position: "absolute", top: -2, width: 28, height: 3, borderRadius: 2, backgroundColor: palette.gold },
} as const;
