// DEV-ONLY sign-in. Calls POST /v1/auth/dev-login and keeps the token in Redux
// memory (not localStorage). In production the gateway issues the session and this
// screen/endpoint do not exist.
import { useState, type ReactElement } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { devLogin } from "../store/authSlice";

export function DevLogin(): ReactElement {
  const dispatch = useAppDispatch();
  const { status, error } = useAppSelector((s) => s.auth);
  const [email, setEmail] = useState("leader@dev.local");

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 420, margin: "80px auto", padding: 24 }}>
      <h1>Nuru Place · Portal</h1>
      <p style={{ background: "#fef3c7", color: "#92400e", padding: 8, borderRadius: 6 }}>
        Dev login — local only. Production uses gateway SSO.
      </p>
      <input
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="email"
        style={{ width: "100%", padding: 10, boxSizing: "border-box" }}
      />
      <button
        type="button"
        onClick={() => void dispatch(devLogin(email.trim()))}
        disabled={status === "loading" || !email.trim()}
        style={{ marginTop: 8, padding: 10, width: "100%" }}
      >
        {status === "loading" ? "Signing in…" : "Dev sign in"}
      </button>
      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      <p style={{ color: "#6b7280", fontSize: 13, marginTop: 16 }}>
        Seeded users: <code>dev+admin@nuru.test</code> (all cells), <code>dev+instructor@nuru.test</code> (Cell A).
      </p>
    </main>
  );
}
