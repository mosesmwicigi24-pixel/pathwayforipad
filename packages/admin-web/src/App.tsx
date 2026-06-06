// Multiplier/admin portal shell (spec §1.3). Gated on a dev session; then the
// cohort engagement table, the review queue, and — for Admin/SuperAdmin — the
// Curriculum CMS for authoring the whole pathway (Prompt 5).
import { useState, type ReactElement } from "react";
import { useAppDispatch, useAppSelector } from "./store/hooks";
import { logout } from "./store/authSlice";
import { isAdminRole } from "./util/jwt";
import { DevLogin } from "./components/DevLogin";
import { CohortTable } from "./components/CohortTable";
import { ReviewQueue } from "./components/ReviewQueue";
import { CurriculumAdmin } from "./components/curriculum/CurriculumAdmin";

type Tab = "cohort" | "reviews" | "curriculum";

export function App(): ReactElement {
  const dispatch = useAppDispatch();
  const { accessToken, email, role } = useAppSelector((s) => s.auth);
  const [tab, setTab] = useState<Tab>("cohort");
  const canAuthor = isAdminRole(role);

  if (!accessToken) return <DevLogin />;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: 24 }}>
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
        {canAuthor ? (
          <button type="button" onClick={() => setTab("curriculum")} disabled={tab === "curriculum"}>
            Curriculum
          </button>
        ) : null}
      </nav>
      {tab === "cohort" ? <CohortTable /> : null}
      {tab === "reviews" ? <ReviewQueue /> : null}
      {tab === "curriculum" && canAuthor ? <CurriculumAdmin /> : null}
    </main>
  );
}
