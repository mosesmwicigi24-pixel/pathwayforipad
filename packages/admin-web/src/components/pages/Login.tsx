// Sign-in — rebuilt to the "Final Pathway Portal" Figma make (light panel, white
// card, sign-in / register tabs). Wired to the real dev-login: "Sign in" dispatches
// POST /v1/auth/dev-login with the email and, on success, routes into the portal.
// In production the gateway issues the session and this screen does not exist.
import { useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff, Sparkles, Loader2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { devLogin, login } from "../../store/authSlice";
import { PortalApi } from "../../api/client";

type Mode = "signin" | "register";

const labelStyle = { display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--foreground)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" } as const;

export function Login(): ReactElement {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { accessToken, status, error } = useAppSelector((s) => s.auth);

  const [mode, setMode] = useState<Mode>("signin");
  const [showPw, setShowPw] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("admin@dev.local");
  const [password, setPassword] = useState("devpassword");
  const [confirmPw, setConfirmPw] = useState("");
  const [remember, setRemember] = useState(true);
  const [agree, setAgree] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [localError, setLocalError] = useState("");
  const [forgotMsg, setForgotMsg] = useState("");

  useEffect(() => { if (accessToken) navigate("/", { replace: true }); }, [accessToken, navigate]);

  const handleForgot = (): void => {
    setLocalError(""); setForgotMsg("");
    if (!isValidEmail) { setLocalError("Enter your email above, then tap Forgot password."); return; }
    void PortalApi.forgotPassword(email.trim()).catch(() => undefined);
    setForgotMsg("If an account exists for that email, a reset link is on its way.");
  };

  const submitting = status === "loading";
  const isValidEmail = email.includes("@") && email.includes(".");
  const canSignIn = isValidEmail && password.length >= 4;
  const canRegister = fullName.trim().length >= 2 && isValidEmail && password.length >= 6 && password === confirmPw && agree;

  const handleSubmit = (): void => {
    setLocalError("");
    if (mode === "signin" && !canSignIn) { setLocalError("Enter a valid email and password to continue."); return; }
    if (mode === "register" && !canRegister) { setLocalError("Please complete every field and accept the terms."); return; }
    // Register has no self-serve backend yet; fall back to the dev email session.
    if (mode === "register") { void dispatch(devLogin(email.trim())); return; }
    void dispatch(login({ email: email.trim(), password }));
  };

  const shownError = localError || error || "";

  return (
    <div className="min-h-full" style={{ fontFamily: "var(--font-sans)", background: "var(--background)" }}>
      <div className="flex flex-col" style={{ background: "var(--card)", minHeight: "100vh", position: "relative" }}>
        <div className="flex items-center justify-end" style={{ padding: "24px 28px 0" }}>
          <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 28, background: "rgba(200,155,60,0.10)", color: "#8B6914", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", border: "1px solid rgba(200,155,60,0.22)" }}>
            <Sparkles size={10} /> Admin dashboard
          </span>
        </div>

        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full" style={{ maxWidth: 380, background: "#FFFFFF", borderRadius: 18, padding: "28px 28px 26px", boxShadow: "0 1px 0 rgba(11,31,51,0.04), 0 24px 60px -28px rgba(11,31,51,0.18), 0 0 0 1px rgba(11,31,51,0.05)" }}>
            <div style={{ marginBottom: 18 }}>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", letterSpacing: "-0.01em", lineHeight: 1.1, marginBottom: 4 }}>
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h1>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
                {mode === "signin" ? "Sign in to the admin dashboard" : "Request access to the Nuru Pathway portal"}
              </p>
            </div>

            <div className="grid grid-cols-2 rounded-lg p-1 mb-4" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
              {(["signin", "register"] as Mode[]).map((m) => (
                <button key={m} type="button" onClick={() => { setMode(m); setLocalError(""); }} className="rounded-md transition-all" style={{ height: 32, fontSize: 12, fontWeight: 700, letterSpacing: "0.02em", background: mode === m ? "#fff" : "transparent", color: mode === m ? "var(--nuru-navy)" : "var(--muted-foreground)", boxShadow: mode === m ? "0 1px 3px rgba(11,31,51,0.08)" : "none", border: "none" }}>
                  {m === "signin" ? "Sign in" : "Register"}
                </button>
              ))}
            </div>

            {mode === "register" && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Full name</label>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Amara Osei" className="w-full rounded-lg outline-none" style={{ height: 40, padding: "0 12px", background: "var(--input-background)", border: "1.5px solid var(--border)", fontSize: 13.5, color: "var(--foreground)" }} />
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Email address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={() => setEmailFocused(true)} onBlur={() => setEmailFocused(false)} onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} className="w-full rounded-lg outline-none" style={{ height: 40, padding: "0 12px", background: emailFocused ? "#fff" : "var(--input-background)", border: emailFocused ? "1.5px solid var(--nuru-gold)" : "1.5px solid var(--border)", boxShadow: emailFocused ? "0 0 0 3px rgba(200,155,60,0.14)" : "none", fontSize: 13.5, color: "var(--foreground)" }} />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} onFocus={() => setPwFocused(true)} onBlur={() => setPwFocused(false)} onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} className="w-full rounded-lg outline-none" style={{ height: 40, padding: "0 38px 0 12px", background: pwFocused ? "#fff" : "var(--input-background)", border: pwFocused ? "1.5px solid var(--nuru-gold)" : "1.5px solid var(--border)", boxShadow: pwFocused ? "0 0 0 3px rgba(200,155,60,0.14)" : "none", fontSize: 13.5, color: "var(--foreground)" }} />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {mode === "register" && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Confirm password</label>
                <input type={showPw ? "text" : "password"} value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repeat password" className="w-full rounded-lg outline-none" style={{ height: 40, padding: "0 12px", background: "var(--input-background)", border: "1.5px solid var(--border)", fontSize: 13.5, color: "var(--foreground)" }} />
                {confirmPw.length > 0 && confirmPw !== password && <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>Passwords don’t match.</div>}
              </div>
            )}

            {mode === "signin" ? (
              <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "var(--nuru-gold)" }} />
                  <span style={{ fontSize: 12, color: "var(--foreground)" }}>Remember me</span>
                </label>
                <button type="button" onClick={handleForgot} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>Forgot password?</button>
              </div>
            ) : (
              <label className="flex items-start gap-2 cursor-pointer" style={{ marginBottom: 14 }}>
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ accentColor: "var(--nuru-gold)", marginTop: 3 }} />
                <span style={{ fontSize: 11.5, color: "var(--foreground)", lineHeight: 1.5 }}>
                  I agree to the <a href="#" style={{ color: "var(--nuru-gold)", fontWeight: 600 }}>Terms</a> and <a href="#" style={{ color: "var(--nuru-gold)", fontWeight: 600 }}>Privacy Policy</a>.
                </span>
              </label>
            )}

            {shownError && <div className="rounded-md mb-3" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12, padding: "8px 10px", border: "1px solid #F5C6C2" }}>{shownError}</div>}
            {forgotMsg && !shownError && <div className="rounded-md mb-3" style={{ background: "rgba(200,155,60,0.10)", color: "#8B6914", fontSize: 12, padding: "8px 10px", border: "1px solid rgba(200,155,60,0.30)" }}>{forgotMsg}</div>}

            <button onClick={handleSubmit} disabled={submitting || (mode === "signin" ? !canSignIn : !canRegister)} className="w-full flex items-center justify-center gap-2 rounded-lg transition-all hover:brightness-105" style={{ height: 42, background: (mode === "signin" ? canSignIn : canRegister) && !submitting ? "var(--nuru-gold)" : "rgba(200,155,60,0.45)", color: "#fff", fontSize: 13.5, fontWeight: 700, letterSpacing: "0.01em", boxShadow: "0 8px 22px rgba(200,155,60,0.32)", cursor: submitting ? "not-allowed" : "pointer", border: "none" }}>
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? (mode === "signin" ? "Signing in…" : "Creating account…") : mode === "signin" ? "Sign in" : "Create account"}
            </button>

            <p style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "center", marginTop: 12 }}>
              {mode === "signin" ? "New to Nuru Pathway?" : "Already have an account?"}{" "}
              <button type="button" onClick={() => { setMode(mode === "signin" ? "register" : "signin"); setLocalError(""); }} style={{ color: "var(--nuru-gold)", fontWeight: 700, background: "none", border: "none" }}>
                {mode === "signin" ? "Create an account" : "Sign in"}
              </button>
            </p>

            <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", marginTop: 16, lineHeight: 1.5 }}>
              Dev login (local). Seeded: <span style={{ color: "var(--nuru-gold)", fontWeight: 600 }}>admin@dev.local</span> · leader@dev.local · student1@dev.local
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap" style={{ padding: "0 28px 28px" }}>
          {["Student", "Multiplier", "Admin", "SuperAdmin"].map((r) => (
            <span key={r} className="rounded-full" style={{ padding: "4px 10px", fontSize: 10.5, fontWeight: 600, background: "rgba(11,31,51,0.05)", color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>{r}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
