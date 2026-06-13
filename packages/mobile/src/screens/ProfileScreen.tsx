// Profile (new design, Contract Matrix M1 — replaces the old Portal tab).
// Identity card, personal details (incl. the B6 extensions: gender, city,
// socials, baptism), pathway administration, and giving — grouped into quiet
// list sections. Sign out clears the session and returns to Login.
import { type ReactElement } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing, shadow, tabBarSpace } from "../theme/tokens";
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

function genderLabel(g?: string | null): string | null {
  if (g === "male") return "Male";
  if (g === "female") return "Female";
  if (g === "prefer_not_to_say") return "Prefer not to say";
  return null;
}

export function ProfileScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: me } = useMe();
  const profile = me?.profile;
  const fullName = profile?.full_name ?? "Member";
  const level = me?.enrollment?.current_level ?? null;
  const subtitle = [level ? `Level ${level} learner` : null, profile?.email].filter(Boolean).join(" · ");
  const socials = Object.entries(profile?.socials ?? {});
  // Real enrollment state (not a hardcoded "Active"): active / paused / completed / withdrawn.
  const enrollmentState = me?.enrollment?.state ?? null;
  const stateLabel = enrollmentState ? enrollmentState.charAt(0).toUpperCase() + enrollmentState.slice(1) : null;

  const details: Array<{ label: string; value: string }> = [
    ...(profile?.phone_number ? [{ label: "Phone", value: profile.phone_number }] : []),
    ...(genderLabel(profile?.gender) ? [{ label: "Gender", value: genderLabel(profile?.gender) ?? "" }] : []),
    ...(profile?.city ? [{ label: "City", value: profile.city }] : []),
    ...(profile?.year_of_salvation ? [{ label: "Saved in", value: String(profile.year_of_salvation) }] : []),
    { label: "Baptized", value: profile?.is_baptized ? "Yes" : "Not yet" },
    ...socials.map(([k, v]) => ({ label: k[0]?.toUpperCase() + k.slice(1), value: v })),
  ];

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
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: tabBarSpace }}>
        <View style={st.header}>
          <Glow size={220} color="rgba(201,162,39,0.10)" style={{ right: -60, top: -60 }} />
          <T variant="micro" tone="gold" style={st.kicker}>YOUR JOURNEY</T>
          <T variant="display" tone="onNavy" style={{ marginTop: spacing.sm, fontSize: 34 }}>Profile</T>
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
            {stateLabel ? (
              <View style={[st.badge, { backgroundColor: palette.activeBadgeBg }]}>
                <T variant="micro" style={{ color: palette.activeBadgeText }}>{stateLabel}</T>
              </View>
            ) : null}
          </View>

          {/* Personal details (B6 profile extensions render when present) */}
          <View style={{ marginTop: spacing.lg }}>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>PERSONAL DETAILS</T>
            <View style={st.group}>
              {details.map((d, i) => (
                <View key={d.label} style={[st.row, i < details.length - 1 && st.rowDivider]}>
                  <T variant="heading" style={{ fontSize: 15, fontWeight: "500" }}>{d.label}</T>
                  <T variant="body" tone="secondary">{d.value}</T>
                </View>
              ))}
            </View>
          </View>

          {/* Growth (M3): gifts, prayer, verses */}
          <View style={{ marginTop: spacing.lg }}>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>GROWTH</T>
            <View style={st.group}>
              {[
                { label: "Spiritual gifts", onPress: () => nav.navigate("Gifts") },
                { label: "Prayer journal", onPress: () => nav.navigate("PrayerJournal") },
                { label: "Verse library", onPress: () => nav.navigate("VerseLibrary") },
              ].map((item, i, arr) => (
                <Pressable
                  key={item.label}
                  onPress={item.onPress}
                  style={({ pressed }) => [st.row, i < arr.length - 1 && st.rowDivider, pressed && { backgroundColor: "rgba(10,37,64,0.03)" }]}
                >
                  <T variant="heading" style={{ fontSize: 15, fontWeight: "500" }}>{item.label}</T>
                  <T variant="heading" tone="tertiary" style={{ fontSize: 15 }}>›</T>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Pathway + church services */}
          <View style={{ marginTop: spacing.lg }}>
            <T variant="overline" tone="secondary" style={{ marginBottom: spacing.sm }}>PATHWAY</T>
            <View style={st.group}>
              {[
                { label: "Enrollment status" },
                { label: "Certificates & transcripts" },
                { label: "Giving history", onPress: () => nav.navigate("Giving") },
              ].map((item, i, arr) => (
                <Pressable
                  key={item.label}
                  onPress={item.onPress}
                  style={({ pressed }) => [st.row, i < arr.length - 1 && st.rowDivider, pressed && item.onPress && { backgroundColor: "rgba(10,37,64,0.03)" }]}
                >
                  <T variant="heading" style={{ fontSize: 15, fontWeight: "500" }}>{item.label}</T>
                  <T variant="heading" tone="tertiary" style={{ fontSize: 15 }}>›</T>
                </Pressable>
              ))}
            </View>
          </View>

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
