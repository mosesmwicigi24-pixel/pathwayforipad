// Multiplier/admin portal shell (spec §1.3). Gated on a dev session; then two
// screens: the cohort engagement table (the defining view) and the review queue.
import { useState, type ReactElement } from "react";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { logout } from "./store/authSlice";
import { DevLogin } from "./components/DevLogin";
import { CohortTable } from "./components/CohortTable";
import { ReviewQueue } from "./components/ReviewQueue";

type Tab = "cohort" | "reviews";

export function App(): ReactElement {
  const dispatch = useAppDispatch();
  const { accessToken, email } = useAppSelector((s) => s.auth);
  const [tab, setTab] = useState<Tab>("cohort");

  if (!accessToken) return <DevLogin />;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Nuru Place · Multiplier Portal</h1>
        <span style={{ color: "#6b7280", fontSize: 13 }}>
          {email}{" "}
          <button type="button" onClick={() => dispatch(logout())} style={{ marginLeft: 8 }}>
            Sign out
          </button>
        </span>
      </div>
      <nav style={{ display: "flex", gap: 8, margin: "16px 0" }}>
        <button type="button" onClick={() => setTab("cohort")} disabled={tab === "cohort"}>
          Cohort
        </button>
        <button type="button" onClick={() => setTab("reviews")} disabled={tab === "reviews"}>
          Reviews
        </button>
      </nav>
      {tab === "cohort" ? <CohortTable /> : <ReviewQueue />}
    </main>
  );
}
