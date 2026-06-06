// Profile (Figma "ProfileTab"). Avatar with gold level ring, stat row,
// certificates + settings, sign out (clears the secure vault → Login).
import { type ReactElement } from "react";
import { Pressable, View } from "react-native";
import { useNavigation } from "../navigation/RootNavigator";
import { BottomTabBar } from "../navigation/BottomTabBar";
import { getVault } from "../auth/vault";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { PButton, T } from "../theme/components";

const STATS = [
  { label: "Modules", value: "3" },
  { label: "Streak", value: "7d" },
  { label: "Certificates", value: "1" },
];
const SETTINGS = ["Notifications", "Help & Support", "Privacy Policy"];

export function ProfileScreen(): ReactElement {
  const nav = useNavigation();

  async function signOut(): Promise<void> {
    await getVault().clear();
    nav.navigate({ name: "Login" });
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.paper }}>
      <View style={{ flex: 1 }}>
        {/* Navy header + avatar */}
        <View style={st.header}>
          <View style={st.avatarRing}>
            <View style={st.avatar}>
              <T style={{ color: palette.white, fontSize: 30, fontWeight: "700" }}>MM</T>
            </View>
            <View style={st.levelBadge}>
              <T style={{ color: palette.gold, fontSize: 8, fontWeight: "800" }}>L2</T>
            </View>
          </View>
          <T variant="title" tone="onNavy" style={{ marginTop: spacing.base }}>Moses Mwicigi</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: 2 }}>Member since January 2024</T>
          <View style={st.levelPill}>
            <T variant="caption" tone="gold">★</T>
            <T variant="body" tone="onNavy">Inner Transformation</T>
            <T variant="caption" tone="onNavyDim">· Lvl 2</T>
          </View>
        </View>

        {/* Stat row */}
        <View style={st.stats}>
          {STATS.map((s, i) => (
            <View key={s.label} style={[st.stat, i < 2 && st.statDivider]}>
              <T style={{ fontSize: 26, fontWeight: "800", letterSpacing: -0.8, color: palette.ink }}>{s.value}</T>
              <T variant="caption" tone="tertiary" style={{ marginTop: 2 }}>{s.label}</T>
            </View>
          ))}
        </View>

        <View style={{ padding: spacing.screen, gap: spacing.lg }}>
          {/* Certificates */}
          <View>
            <T variant="overline" tone="tertiary" style={{ marginBottom: spacing.md, paddingHorizontal: spacing.xs }}>CERTIFICATES</T>
            <View style={st.listCard}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="View Foundations of Faith certificate"
                onPress={() => nav.navigate({ name: "LevelComplete" })}
                style={st.certRow}
              >
                <View style={st.certIcon}><T style={{ color: palette.gold, fontSize: 18 }}>✦</T></View>
                <View style={{ flex: 1 }}>
                  <T variant="heading">Foundations of Faith</T>
                  <T variant="caption" tone="tertiary" style={{ marginTop: 2 }}>Level 1 · March 2024</T>
                </View>
                <T style={{ color: palette.gold }}>⤓</T>
              </Pressable>
            </View>
          </View>

          {/* Settings */}
          <View>
            <T variant="overline" tone="tertiary" style={{ marginBottom: spacing.md, paddingHorizontal: spacing.xs }}>SETTINGS</T>
            <View style={st.listCard}>
              {SETTINGS.map((label, i) => (
                <Pressable key={label} accessibilityRole="button" style={[st.settingRow, i > 0 && st.rowDivider]}>
                  <View style={st.settingIcon} />
                  <T variant="bodyLg" style={{ flex: 1 }}>{label}</T>
                  <T tone="tertiary">›</T>
                </Pressable>
              ))}
            </View>
          </View>

          <PButton variant="ghost" size="md" onPress={() => void signOut()}>Sign out</PButton>
        </View>
      </View>

      <BottomTabBar active="Profile" />
    </View>
  );
}

const st = {
  header: { backgroundColor: palette.navy, paddingTop: 54, paddingBottom: spacing.xl, alignItems: "center" },
  avatarRing: { width: 96, height: 96, borderRadius: 48, borderWidth: 2, borderColor: "rgba(201,162,39,0.4)", padding: 3, alignItems: "center", justifyContent: "center" },
  avatar: { width: "100%", height: "100%", borderRadius: 44, backgroundColor: "#0d2d52", alignItems: "center", justifyContent: "center" },
  levelBadge: { position: "absolute", bottom: -1, right: -1, width: 28, height: 28, borderRadius: 14, backgroundColor: palette.navy, borderWidth: 1.5, borderColor: palette.gold, alignItems: "center", justifyContent: "center" },
  levelPill: { marginTop: spacing.base, flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: radii.control, borderWidth: 1, borderColor: "rgba(201,162,39,0.22)", paddingHorizontal: spacing.base, paddingVertical: 9 },
  stats: { flexDirection: "row", backgroundColor: palette.white, borderBottomWidth: 1, borderBottomColor: palette.border },
  stat: { flex: 1, alignItems: "center", paddingVertical: spacing.lg },
  statDivider: { borderRightWidth: 1, borderRightColor: palette.border },
  listCard: { backgroundColor: palette.white, borderRadius: radii.card, overflow: "hidden", ...shadow.card },
  certRow: { flexDirection: "row", alignItems: "center", gap: spacing.base, padding: spacing.base },
  certIcon: { width: 46, height: 46, borderRadius: 12, backgroundColor: "rgba(201,162,39,0.12)", borderWidth: 1, borderColor: "rgba(201,162,39,0.28)", alignItems: "center", justifyContent: "center" },
  settingRow: { flexDirection: "row", alignItems: "center", gap: spacing.base, padding: spacing.base },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  settingIcon: { width: 32, height: 32, borderRadius: 8, backgroundColor: "rgba(10,37,64,0.06)" },
} as const;
