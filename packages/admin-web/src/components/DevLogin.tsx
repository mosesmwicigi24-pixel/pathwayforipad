// Sign-in — rebuilt to the Figma make (navy splash, gold mark). The working dev
// path calls POST /v1/auth/dev-login and keeps the token in Redux memory (not
// localStorage). In production the gateway issues the session and this screen and
// endpoint do not exist.
import { useState, type ReactElement } from "react";
import { ArrowRight } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { devLogin } from "../store/authSlice";

const navy = "var(--nuru-navy)";
const gold = "var(--nuru-gold)";

export function DevLogin(): ReactElement {
  const dispatch = useAppDispatch();
  const { status, error } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("admin@dev.local");
  const submit = (): void => {
    if (email.trim()) void dispatch(devLogin(email.trim()));
  };

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: navy, padding: 24, position: "relative", overflow: "hidden" }}>
      {/* ambient glows */}
      <div style={{ position: "absolute", width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,155,60,0.16), transparent 70%)", top: -160, left: "50%", transform: "translateX(-50%)" }} />
      <div style={{ position: "absolute", width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(11,31,51,0.6), transparent 70%)", bottom: -160, left: "20%" }} />

      <div style={{ position: "relative", width: "100%", maxWidth: 380, background: "#0F2741", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 24, padding: 32, boxShadow: "0 40px 80px -30px rgba(0,0,0,0.6)" }}>
        <div className="flex items-center gap-3" style={{ marginBottom: 24 }}>
          <div className="flex items-center justify-center rounded-2xl" style={{ width: 48, height: 48, background: gold, boxShadow: "0 0 0 8px rgba(200,155,60,0.15)" }}>
            <span style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1 }}>N</span>
          </div>
          <div>
            <div style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 22, lineHeight: 1.1 }}>Nuru Pathway</div>
            <div style={{ fontSize: 11, color: "rgba(232,239,245,0.5)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Admin Portal</div>
          </div>
        </div>

        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "rgba(232,239,245,0.7)", marginBottom: 6 }}>Work email</label>
        <input
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="you@nuru.place"
          style={{ width: "100%", boxSizing: "border-box", height: 46, borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.05)", color: "#fff", padding: "0 14px", fontSize: 14, outline: "none" }}
        />

        <button
          type="button"
          onClick={submit}
          disabled={status === "loading" || !email.trim()}
          className="flex items-center justify-center gap-2"
          style={{ marginTop: 16, width: "100%", height: 46, borderRadius: 12, background: gold, color: "#fff", fontSize: 14, fontWeight: 700, border: "none", opacity: status === "loading" || !email.trim() ? 0.6 : 1 }}
        >
          {status === "loading" ? "Signing in…" : "Sign in"}
          {status !== "loading" && <ArrowRight size={16} />}
        </button>

        {error ? <p style={{ color: "#FCA5A5", fontSize: 12.5, marginTop: 12, textAlign: "center" }}>{error}</p> : null}

        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px dashed rgba(255,255,255,0.1)", fontSize: 11.5, color: "rgba(232,239,245,0.45)", lineHeight: 1.6 }}>
          Dev login (local only). Seeded: <span style={{ color: gold }}>admin@dev.local</span> · leader@dev.local · student1@dev.local
        </div>
      </div>
    </div>
  );
}
