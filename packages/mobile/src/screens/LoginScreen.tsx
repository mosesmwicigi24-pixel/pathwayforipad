// Sign-in (spec §5.3, §5.7; Figma "LoginScreen" / "Create account" / "Reset
// password"). Navy splash with the serif "Nuru Place" wordmark + gold keyline.
// Email + password is the working path: POST /v1/auth/login, /auth/register, and
// /auth/password/{forgot,reset}. Rotated tokens are stored in the secure
// TokenVault. Federated providers (Google/Apple) are stubbed for production.
import { useState, type ReactElement } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { ArrowLeft, Eye, EyeOff, Lock, Mail, User } from "lucide-react-native";
import { NuruApi } from "../api/client";
import { getVault } from "../auth/vault";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { palette, radii, spacing } from "../theme/tokens";
import { Glow, PButton, T } from "../theme/components";

// Dev convenience: the seed (`pnpm db:seed:dev`) gives every @dev.local account
// this password, so the simulator can sign in immediately.
const DEV_EMAIL = "student1@dev.local";
const DEV_PASSWORD = "pathway123";

type Mode = "login" | "register" | "forgot" | "reset";
const INPUT_PLACEHOLDER = "rgba(255,255,255,0.40)";

export function LoginScreen(): ReactElement {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(__DEV__ ? DEV_EMAIL : "");
  const [password, setPassword] = useState(__DEV__ ? DEV_PASSWORD : "");
  const [confirm, setConfirm] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPw, setShowPw] = useState(false);

  function go(next: Mode): void {
    setError(null);
    setNotice(null);
    setMode(next);
  }

  async function enter(tokens: { access_token: string; refresh_token: string }): Promise<void> {
    await getVault().setTokens(tokens.access_token, tokens.refresh_token);
    nav.reset({ index: 0, routes: [{ name: "Tabs" }] });
  }

  async function submitLogin(): Promise<void> {
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true); setError(null);
    try {
      await enter(await NuruApi.login(email.trim(), password));
    } catch {
      setError("Invalid email or password.");
    } finally { setBusy(false); }
  }

  async function submitRegister(): Promise<void> {
    if (!fullName.trim()) { setError("Enter your full name."); return; }
    if (!email.trim()) { setError("Enter your email."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true); setError(null);
    try {
      await enter(await NuruApi.register(fullName.trim(), email.trim(), password));
    } catch (e) {
      const status = (e as { response?: { status?: number } }).response?.status;
      setError(status === 409 ? "An account with this email already exists." : "Couldn't create your account. Try again.");
    } finally { setBusy(false); }
  }

  async function submitForgot(): Promise<void> {
    if (!email.trim()) { setError("Enter your account email."); return; }
    setBusy(true); setError(null);
    try {
      const res = await NuruApi.forgotPassword(email.trim());
      if (res.dev_token) {
        // Dev: no email provider — carry the token straight into the reset step.
        setToken(res.dev_token);
        setNotice("Reset link generated (dev). Set your new password below.");
        setMode("reset");
      } else {
        setNotice("If an account exists for that email, a reset link is on its way.");
      }
    } catch {
      setError("Couldn't request a reset. Try again.");
    } finally { setBusy(false); }
  }

  async function submitReset(): Promise<void> {
    if (!token.trim()) { setError("Paste the reset token from your email."); return; }
    if (newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    setBusy(true); setError(null);
    try {
      await NuruApi.resetPassword(token.trim(), newPassword);
      setPassword("");
      setNotice("Password reset. Sign in with your new password.");
      setMode("login");
    } catch {
      setError("That reset link is invalid or has expired.");
    } finally { setBusy(false); }
  }

  const heading = mode === "register" ? "Create account" : mode === "forgot" ? "Reset password" : mode === "reset" ? "Set a new password" : null;
  const subhead = mode === "register" ? "Begin your discipleship journey on Pathway."
    : mode === "forgot" ? "Enter your account email and we'll send you a reset link."
    : mode === "reset" ? "Choose a new password for your account."
    : null;

  return (
    <KeyboardAvoidingView style={st.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <Glow size={340} color="rgba(201,162,39,0.12)" style={{ alignSelf: "center", top: -40 }} />
      <ScrollView contentContainerStyle={st.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={st.brand}>
          <View style={st.logo}>
            <View style={st.crossV} />
            <View style={st.crossH} />
          </View>
          <T serif style={st.wordmark}>Nuru Place</T>
          <View style={st.keyline}>
            <View style={st.keyDash} />
            <View style={st.keyDot} />
            <View style={st.keyDash} />
          </View>
          <T variant="overline" tone="onNavyDim" style={{ marginTop: spacing.md, letterSpacing: 2.2 }}>
            A MISSIONARY SENDING CHURCH
          </T>
        </View>

        {/* Secondary-mode header (Back + serif title + subtitle) */}
        {mode !== "login" ? (
          <View style={{ marginTop: spacing.xl }}>
            <Pressable accessibilityRole="button" onPress={() => go("login")} style={st.backRow} hitSlop={8}>
              <ArrowLeft size={16} color={palette.onNavy} />
              <T variant="caption" tone="onNavy">Back</T>
            </Pressable>
            <T serif style={st.modeTitle}>{heading}</T>
            <T variant="caption" tone="onNavyDim" style={{ textAlign: "center", marginTop: 6 }}>{subhead}</T>
          </View>
        ) : null}

        {/* Fields */}
        <View style={{ marginTop: spacing.xl, gap: spacing.base }}>
          {mode === "register" ? (
            <Field label="FULL NAME" icon={<User size={18} color={INPUT_PLACEHOLDER} />}>
              <TextInput value={fullName} onChangeText={setFullName} placeholder="Your name" placeholderTextColor={INPUT_PLACEHOLDER} autoCapitalize="words" style={st.input} />
            </Field>
          ) : null}

          {mode === "reset" ? (
            <Field label="RESET TOKEN" icon={<Lock size={18} color={INPUT_PLACEHOLDER} />}>
              <TextInput value={token} onChangeText={setToken} placeholder="Paste the token from your email" placeholderTextColor={INPUT_PLACEHOLDER} autoCapitalize="none" autoCorrect={false} style={st.input} />
            </Field>
          ) : (
            <Field label="EMAIL ADDRESS" icon={<Mail size={18} color={INPUT_PLACEHOLDER} />}>
              <TextInput value={email} onChangeText={setEmail} placeholder="name@email.com" placeholderTextColor={INPUT_PLACEHOLDER} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={st.input} />
            </Field>
          )}

          {mode === "login" || mode === "register" ? (
            <Field
              label="PASSWORD"
              icon={<Lock size={18} color={INPUT_PLACEHOLDER} />}
              trailing={
                <Pressable accessibilityRole="button" accessibilityLabel={showPw ? "Hide password" : "Show password"} onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                  {showPw ? <EyeOff size={18} color={INPUT_PLACEHOLDER} /> : <Eye size={18} color={INPUT_PLACEHOLDER} />}
                </Pressable>
              }
            >
              <TextInput value={password} onChangeText={setPassword} placeholder={mode === "register" ? "At least 6 characters" : "••••••••"} placeholderTextColor={INPUT_PLACEHOLDER} secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} style={st.input} />
            </Field>
          ) : null}

          {mode === "register" ? (
            <Field label="CONFIRM PASSWORD" icon={<Lock size={18} color={INPUT_PLACEHOLDER} />}>
              <TextInput value={confirm} onChangeText={setConfirm} placeholder="Re-enter password" placeholderTextColor={INPUT_PLACEHOLDER} secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} style={st.input} />
            </Field>
          ) : null}

          {mode === "reset" ? (
            <Field
              label="NEW PASSWORD"
              icon={<Lock size={18} color={INPUT_PLACEHOLDER} />}
              trailing={
                <Pressable accessibilityRole="button" onPress={() => setShowPw((v) => !v)} hitSlop={8}>
                  {showPw ? <EyeOff size={18} color={INPUT_PLACEHOLDER} /> : <Eye size={18} color={INPUT_PLACEHOLDER} />}
                </Pressable>
              }
            >
              <TextInput value={newPassword} onChangeText={setNewPassword} placeholder="At least 6 characters" placeholderTextColor={INPUT_PLACEHOLDER} secureTextEntry={!showPw} autoCapitalize="none" autoCorrect={false} style={st.input} />
            </Field>
          ) : null}

          {mode === "login" ? (
            <Pressable accessibilityRole="button" onPress={() => go("forgot")} style={{ alignSelf: "flex-end" }} hitSlop={6}>
              <T variant="caption" tone="gold" style={{ fontWeight: "600" }}>Forgot your password?</T>
            </Pressable>
          ) : null}

          {error ? <T variant="caption" style={{ color: palette.error, textAlign: "center" }}>{error}</T> : null}
          {notice && !error ? <T variant="caption" tone="gold" style={{ textAlign: "center" }}>{notice}</T> : null}

          {/* Primary action */}
          {mode === "login" ? (
            <PButton variant="gold" onPress={() => void submitLogin()} disabled={busy}>{busy ? "Signing in…" : "Log in"}</PButton>
          ) : mode === "register" ? (
            <PButton variant="gold" onPress={() => void submitRegister()} disabled={busy}>{busy ? "Creating…" : "Create account"}</PButton>
          ) : mode === "forgot" ? (
            <PButton variant="gold" onPress={() => void submitForgot()} disabled={busy}>{busy ? "Sending…" : "Send reset link"}</PButton>
          ) : (
            <PButton variant="gold" onPress={() => void submitReset()} disabled={busy}>{busy ? "Saving…" : "Reset password"}</PButton>
          )}
        </View>

        {/* Federated + footer */}
        {mode === "login" || mode === "register" ? (
          <>
            <View style={st.divider}>
              <View style={st.line} />
              <T variant="caption" tone="onNavyDim">or continue with</T>
              <View style={st.line} />
            </View>
            <View style={{ flexDirection: "row", gap: spacing.md }}>
              <View style={{ flex: 1 }}><PButton variant="ghostDark" size="md" disabled>Google</PButton></View>
              <View style={{ flex: 1 }}><PButton variant="ghostDark" size="md" disabled>Apple</PButton></View>
            </View>
          </>
        ) : null}

        <View style={st.footer}>
          {mode === "login" ? (
            <Pressable accessibilityRole="button" onPress={() => go("register")} hitSlop={6} style={st.footerRow}>
              <T variant="caption" tone="onNavyDim">Don't have an account? </T>
              <T variant="caption" tone="gold" style={{ fontWeight: "700" }}>Sign up</T>
            </Pressable>
          ) : (
            <Pressable accessibilityRole="button" onPress={() => go("login")} hitSlop={6} style={st.footerRow}>
              <T variant="caption" tone="onNavyDim">Remembered it? </T>
              <T variant="caption" tone="gold" style={{ fontWeight: "700" }}>Log in</T>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, icon, trailing, children }: { label: string; icon: ReactElement; trailing?: ReactElement; children: ReactElement }): ReactElement {
  return (
    <View>
      <T variant="overline" tone="onNavyDim" style={{ marginBottom: 8, letterSpacing: 1.6 }}>{label}</T>
      <View style={st.inputRow}>
        {icon}
        <View style={{ flex: 1 }}>{children}</View>
        {trailing ?? null}
      </View>
    </View>
  );
}

const st = {
  root: { flex: 1, backgroundColor: "#081C36", overflow: "hidden" },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingTop: 72, paddingBottom: 44 },
  brand: { alignItems: "center" },
  logo: {
    width: 72, height: 72, borderRadius: 22,
    backgroundColor: "rgba(201,162,39,0.10)", borderWidth: 1, borderColor: "rgba(201,162,39,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  crossV: { position: "absolute", width: 4, height: 26, borderRadius: 2, backgroundColor: palette.gold },
  crossH: { position: "absolute", width: 22, height: 4, borderRadius: 2, backgroundColor: palette.gold },
  wordmark: { fontSize: 34, lineHeight: 40, fontWeight: "700", color: palette.white, marginTop: spacing.base },
  keyline: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm },
  keyDash: { width: 28, height: 1, backgroundColor: "rgba(201,162,39,0.6)" },
  keyDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: palette.gold },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", marginBottom: spacing.md },
  modeTitle: { fontSize: 26, fontWeight: "700", color: palette.white, textAlign: "center" },
  inputRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radii.control, paddingHorizontal: spacing.base,
  },
  input: { paddingVertical: 14, fontSize: 16, color: palette.white },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.08)" },
  footer: { marginTop: spacing.xl, alignItems: "center" },
  footerRow: { flexDirection: "row", alignItems: "center" },
} as const;
