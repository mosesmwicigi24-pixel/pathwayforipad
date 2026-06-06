// Portal (Figma "PortalTab"). The administrative hub: profile + enrollment,
// certificates, ministry records, and support — grouped into quiet list sections.
// Giving history routes into the live Give flow (money is never queued offline,
// §5.6). Sign out clears the session and returns to Login.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow } from "../theme/tokens";
import { Glow, T } from "../theme/components";
import { useMe } from "../api/hooks";
import { clearQueryCache } from "../api/query";
import { getVault } from "../auth/vault";

function initials(full?: string | null): string {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NP";
  const a = parts[0]?.[0] ?? "";
  const b = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (a + b).toUpperCase() || "NP";
}

interface Row {
  label: string;
  route?: keyof RootStackParamList;
}

const SECTIONS: { title: string; items: Row[] }[] = [
  { title: "Profile & account", items: [{ label: "Personal information" }, { label: "Language & region" }, { label: "Notification preferences" }] },
  { title: "Pathway administration", items: [{ label: "Enrollment status" }, { label: "Certificates & transcripts" }, { label: "Mentor assignment" }] },
  { title: "Church services", items: [{ label: "Attendance record" }, { label: "Giving history", route: "Giving" }, { label: "Support requests" }] },
];

export function PortalScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: me } = useMe();
  const fullName = me?.profile?.full_name ?? "Member";
  const level = me?.enrollment?.current_level ?? null;
  const subtitle = [level ? `Level ${level} learner` : null, me?.profile?.email].filter(Boolean).join(" · ");

  const signOut = async (): Promise<void> => {
    try {
      await getVault().clear();
    } catch {
      // ignore vault errors on sign-out
    }
    clearQueryCache();
    nav.reset({ index: 0, routes: [{ name: "Login" }] });
  };

  return (
    <View style={st.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xxl }}>
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -60, top: -60 }} />
          <T variant="micro" tone="gold" style={st.kicker}>ADMINISTRATIVE HUB</T>
          <T variant="display" tone="onNavy" style={{ marginTop: spacing.sm, fontSize: 34 }}>Portal</T>
          <T variant="body" tone="onNavyDim" style={{ marginTop: spacing.md, maxWidth: 330 }}>
            Manage your profile, enrollment, certificates, ministry records, and support needs in one quiet place.
          </T>
        </View>

        <View style={{ paddingHorizontal: spacing.screen, paddingTop: spacing.lg }}>
          {/* Identity card */}
          <View style={st.idCard}>
            <View style={st.avatar}>
              <T variant="label" style={{ color: palette.gold }}>{initials(fullName)}</T>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T variant="heading">{fullName}</T>
              {subtitle ? <T variant="caption" tone="secondary" style={{ marginTop: 2 }}>{subtitle}</T> : null}
            </View>
            <View style={[st.badge, { backgroundColor: palette.activeBadgeBg }]}>
              <T variant="micro" style={{ color: palette.activeBadgeText }}>Active</T>
            </View>
          </View>

          {SECTIONS.map((section) => (
            <View key={section.title} style={{ marginTop: spacing.lg }}>
              <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>{section.title.toUpperCase()}</T>
              <View style={st.group}>
                {section.items.map((item, i) => (
                  <Pressable
                    key={item.label}
                    onPress={item.route ? () => nav.navigate(item.route as never) : undefined}
                    style={({ pressed }) => [st.row, i < section.items.length - 1 && st.rowDivider, pressed && item.route && { backgroundColor: "rgba(10,37,64,0.03)" }]}
                  >
                    <T variant="heading" style={{ fontSize: 15, fontWeight: "500" }}>{item.label}</T>
                    <T variant="heading" tone="tertiary" style={{ fontSize: 15 }}>›</T>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}

          <Pressable onPress={() => void signOut()} style={({ pressed }) => [st.signOut, pressed && { transform: [{ scale: 0.99 }] }]}>
            <T variant="heading" style={{ fontSize: 15, color: palette.error }}>Sign out</T>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const st = {
  screen: { flex: 1, backgroundColor: palette.coolPaper },
  header: { backgroundColor: palette.navy, paddingHorizontal: spacing.lg, paddingTop: 54, paddingBottom: spacing.xl, overflow: "hidden" },
  kicker: { letterSpacing: 1.8, textTransform: "uppercase" },
  idCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: palette.white,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.25)",
    padding: spacing.base,
    ...shadow.card,
  },
  avatar: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.navy, alignItems: "center", justifyContent: "center" },
  badge: { borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 4 },
  group: { backgroundColor: palette.white, borderRadius: 16, borderWidth: 1, borderColor: palette.border, overflow: "hidden", ...shadow.card },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.base, paddingVertical: 14 },
  rowDivider: { borderBottomWidth: 1, borderBottomColor: "rgba(10,37,64,0.06)" },
  signOut: {
    marginTop: spacing.lg,
    alignItems: "center",
    backgroundColor: palette.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(212,24,61,0.15)",
    paddingVertical: 14,
    ...shadow.card,
  },
} as const;
