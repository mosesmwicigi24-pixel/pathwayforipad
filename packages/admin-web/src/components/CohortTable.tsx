// Cohort table (spec §1.3) — the portal's defining screen: a cell's members,
// lowest engagement first, read from the engagement_scores snapshot. Bands are
// colour-coded from the server value (no client compute). State lives in Redux.
import { type ReactElement } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchCohort, setBand, setCellId } from "../store/cohortSlice";
import { bandColor, bandLabel, formatPct } from "../util/engagement";

const BAND_OPTIONS = ["", "thriving", "steady", "watch", "at_risk"] as const;

export function CohortTable(): ReactElement {
  const dispatch = useAppDispatch();
  const { cellId, band, members, status, error } = useAppSelector((s) => s.cohort);

  const load = (): void => {
    if (cellId.trim()) void dispatch(fetchCohort({ cellId: cellId.trim(), ...(band ? { band } : {}) }));
  };

  return (
    <section>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          aria-label="Cell group id"
          placeholder="cell_group_id (from seed:dev output)"
          value={cellId}
          onChange={(e) => dispatch(setCellId(e.target.value))}
          style={{ flex: 1, padding: 8 }}
        />
        <select aria-label="Band filter" value={band} onChange={(e) => dispatch(setBand(e.target.value))}>
          {BAND_OPTIONS.map((b) => (
            <option key={b || "all"} value={b}>
              {b ? bandLabel(b) : "all bands"}
            </option>
          ))}
        </select>
        <button type="button" onClick={load} disabled={status === "loading" || !cellId.trim()}>
          {status === "loading" ? "Loading…" : "Load cohort"}
        </button>
      </div>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #e5e7eb" }}>
            <th>Member</th>
            <th>Habits</th>
            <th>Curriculum</th>
            <th>Attendance</th>
            <th>Engagement</th>
            <th>Band</th>
            <th>Last active</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.user_id} style={{ borderBottom: "1px solid #f3f4f6" }}>
              <td>{m.full_name ?? m.user_id}</td>
              <td>{formatPct(m.h_score)}</td>
              <td>{formatPct(m.c_score)}</td>
              <td>{formatPct(m.a_score)}</td>
              <td style={{ fontWeight: 600 }}>{formatPct(m.e_score)}</td>
              <td>
                <span style={{ color: bandColor(m.band), fontWeight: 600 }}>{bandLabel(m.band)}</span>
              </td>
              <td>{m.last_active_days_ago == null ? "—" : `${m.last_active_days_ago}d ago`}</td>
            </tr>
          ))}
          {members.length === 0 && status !== "loading" ? (
            <tr>
              <td colSpan={7} style={{ color: "#6b7280", paddingTop: 12 }}>
                No members loaded — enter a cell id and load.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}
