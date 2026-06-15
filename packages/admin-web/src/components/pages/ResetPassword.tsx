// Public password-reset landing page — the target of the emailed reset link
// (https://pathway.nuruplace.org/reset-password?token=…). Reads the token from
// the URL, lets the user set a new password (POST /v1/auth/password/reset), and
// routes back to sign-in. No auth required.
import { useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2, ShieldCheck, CheckCircle2 } from "lucide-react";
import { PortalApi } from "../../api/client";
import { errorMessage } from "../../util/error";

const labelStyle = { display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--foreground)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" } as const;
const inputStyle = { height: 40, padding: "0 38px 0 12px", background: "var(--input-background)", border: "1.5px solid var(--border)", fontSize: 13.5, color: "var(--foreground)" } as const;

export function ResetPassword(): ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [showPw, setShowPw] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const canSubmit = token.length > 0 && password.length >= 8 && password === confirm;

  const submit = async (): Promise<void> => {
    setError("");
    if (!token) { setError("This reset link is missing its token. Request a new one from the sign-in page."); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don’t match."); return; }
    setBusy(true);
    try {
      await PortalApi.resetPassword(token, password);
      setDone(true);
    } catch (e) {
      setError(errorMessage(e, "This reset link is invalid or has expired. Request a new one."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full" style={{ fontFamily: "var(--font-sans)", background: "var(--background)" }}>
      <div className="flex flex-col" style={{ background: "var(--card)", minHeight: "100vh" }}>
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full" style={{ maxWidth: 380, background: "#FFFFFF", borderRadius: 18, padding: "28px", boxShadow: "0 24px 60px -28px rgba(11,31,51,0.18), 0 0 0 1px rgba(11,31,51,0.05)" }}>
            {done ? (
              <div className="flex flex-col items-center text-center">
                <CheckCircle2 size={40} style={{ color: "var(--nuru-gold)", marginBottom: 12 }} />
                <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", marginBottom: 6 }}>Password updated</h1>
                <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 18 }}>You can now sign in with your new password.</p>
                <button onClick={() => navigate("/login")} className="w-full rounded-lg" style={{ height: 42, background: "var(--nuru-gold)", color: "#fff", fontSize: 13.5, fontWeight: 700, border: "none" }}>Go to sign in</button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2" style={{ marginBottom: 16 }}>
                  <ShieldCheck size={18} style={{ color: "var(--nuru-gold)" }} />
                  <h1 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Set a new password</h1>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={labelStyle}>New password</label>
                  <div className="relative">
                    <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className="w-full rounded-lg outline-none" style={inputStyle} />
                    <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}>
                      {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div style={{ marginBottom: 14 }}>
                  <label style={labelStyle}>Confirm new password</label>
                  <input type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} placeholder="Repeat password" className="w-full rounded-lg outline-none" style={{ ...inputStyle, padding: "0 12px" }} />
                  {confirm.length > 0 && confirm !== password && <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>Passwords don’t match.</div>}
                </div>

                {error && <div className="rounded-md mb-3" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12, padding: "8px 10px", border: "1px solid #F5C6C2" }}>{error}</div>}

                <button onClick={() => void submit()} disabled={!canSubmit || busy} className="w-full flex items-center justify-center gap-2 rounded-lg transition-all hover:brightness-105" style={{ height: 42, background: canSubmit && !busy ? "var(--nuru-gold)" : "rgba(200,155,60,0.45)", color: "#fff", fontSize: 13.5, fontWeight: 700, border: "none", cursor: busy ? "not-allowed" : "pointer" }}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  {busy ? "Updating…" : "Update password"}
                </button>

                <p style={{ fontSize: 12, color: "var(--muted-foreground)", textAlign: "center", marginTop: 12 }}>
                  <button type="button" onClick={() => navigate("/login")} style={{ color: "var(--nuru-gold)", fontWeight: 700, background: "none", border: "none" }}>Back to sign in</button>
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
