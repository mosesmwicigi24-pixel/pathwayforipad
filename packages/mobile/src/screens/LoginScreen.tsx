// Sign-in (spec §5.3, §5.7). Federated providers are the production path (stubbed
// here); the dev path calls POST /v1/auth/dev-login with a seeded student and stores
// the rotated tokens in the secure TokenVault. Render from local state first (§1.3).
import { useState, type ReactElement } from "react";
import { Pressable, Text, View } from "react-native";
import { NuruApi } from "../api/client";
import { getVault } from "../auth/vault";
import { useNavigation } from "../navigation/RootNavigator";

const PROVIDERS = ["kingschat", "google", "apple"] as const;
const DEV_STUDENT = "student1@dev.local";

export function LoginScreen(): ReactElement {
  const nav = useNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function devSignIn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const tokens = await NuruApi.devLogin(DEV_STUDENT);
      await getVault().setTokens(tokens.access_token, tokens.refresh_token);
      nav.navigate({ name: "Home" });
    } catch {
      setError("Dev login failed — is the backend running and seeded (pnpm db:seed:dev)?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24, gap: 12 }}>
      <Text style={{ fontSize: 24, fontWeight: "600", marginBottom: 16 }}>Nuru Place · Pathway</Text>

      {PROVIDERS.map((p) => (
        <Pressable
          key={p}
          accessibilityRole="button"
          disabled // production OAuth not wired in this build
          style={{ padding: 14, borderRadius: 8, backgroundColor: "#9ca3af" }}
        >
          <Text style={{ color: "white", textAlign: "center" }}>Continue with {p} (soon)</Text>
        </Pressable>
      ))}

      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => void devSignIn()}
        style={{ padding: 14, borderRadius: 8, backgroundColor: "#1f2937", marginTop: 8 }}
      >
        <Text style={{ color: "white", textAlign: "center" }}>
          {busy ? "Signing in…" : `Dev sign in (${DEV_STUDENT})`}
        </Text>
      </Pressable>
      {error ? <Text style={{ color: "#b91c1c" }}>{error}</Text> : null}
    </View>
  );
}
