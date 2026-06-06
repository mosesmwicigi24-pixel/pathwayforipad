// Sign-in (spec §5.3, §5.7; Figma "LoginScreen"). Navy splash with the Nuru Place
// wordmark + gold keyline. Federated providers are the production path (stubbed
// here); the working dev path calls POST /v1/auth/dev-login with a seeded student
// and stores rotated tokens in the secure TokenVault.
import { useState, type ReactElement } from "react";
import { View } from "react-native";
import { NuruApi } from "../api/client";
import { getVault } from "../auth/vault";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, spacing } from "../theme/tokens";
import { PButton, T } from "../theme/components";

const DEV_STUDENT = "student1@dev.local";

export function LoginScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function devSignIn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const tokens = await NuruApi.devLogin(DEV_STUDENT);
      await getVault().setTokens(tokens.access_token, tokens.refresh_token);
      nav.reset({ index: 0, routes: [{ name: "Tabs" }] });
    } catch {
      setError("Sign-in failed — is the backend running and seeded (pnpm db:seed:dev)?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={st.root}>
      <View style={st.center}>
        <View style={st.logo}>
          <View style={st.crossV} />
          <View style={st.crossH} />
        </View>
        <T variant="overline" tone="onNavyDim" style={{ marginTop: spacing.lg, letterSpacing: 2.4 }}>
          NURU PLACE
        </T>
        <T style={st.wordmark}>Pathway</T>
        <View style={st.keyline}>
          <View style={st.keyDash} />
          <View style={st.keyDot} />
          <View style={st.keyDash} />
        </View>
        <T variant="bodyLg" tone="onNavyDim" style={{ marginTop: spacing.lg, textAlign: "center", maxWidth: 240 }}>
          Your discipleship journey, guided step by step.
        </T>
      </View>

      <View style={st.actions}>
        <PButton variant="gold" onPress={() => void devSignIn()} disabled={busy}>
          {busy ? "Signing in…" : "Continue with KingsChat"}
        </PButton>
        <T variant="caption" tone="onNavyDim" style={{ textAlign: "center" }}>
          Dev session · {DEV_STUDENT}
        </T>

        <View style={st.divider}>
          <View style={st.line} />
          <T variant="caption" tone="onNavyDim">or continue with</T>
          <View style={st.line} />
        </View>

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <PButton variant="ghostDark" size="md" disabled>Google</PButton>
          </View>
          <View style={{ flex: 1 }}>
            <PButton variant="ghostDark" size="md" disabled>Apple</PButton>
          </View>
        </View>

        {error ? (
          <T variant="caption" style={{ color: palette.error, textAlign: "center" }}>{error}</T>
        ) : (
          <T variant="micro" tone="onNavyDim" style={{ textAlign: "center", marginTop: spacing.xs }}>
            By continuing you agree to our Terms of Service & Privacy Policy
          </T>
        )}
      </View>
    </View>
  );
}

const st = {
  root: { flex: 1, backgroundColor: "#081C36" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: "rgba(201,162,39,0.10)",
    borderWidth: 1,
    borderColor: "rgba(201,162,39,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  crossV: { position: "absolute", width: 4, height: 26, borderRadius: 2, backgroundColor: palette.gold },
  crossH: { position: "absolute", width: 22, height: 4, borderRadius: 2, backgroundColor: palette.gold },
  wordmark: { fontSize: 42, lineHeight: 44, fontWeight: "700", letterSpacing: -1.2, color: palette.white, marginTop: spacing.md },
  keyline: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.base },
  keyDash: { width: 32, height: 1, backgroundColor: "rgba(201,162,39,0.6)" },
  keyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.gold },
  actions: { paddingHorizontal: spacing.lg, paddingBottom: 52, gap: spacing.md },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.xs },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
} as const;
