// Cohort Engagement — admin analytics (Figma make). Engagement-band distribution
// across the congregation + a per-cell table sorted by weakest average engagement
// (so the cells needing attention surface first). Real data from
// /admin/reports/engagement (§1.8 engagement scores). Read-only.
import { useEffect, useState, type ReactElement } from "react";
import { TrendingUp, AlertTriangle } from "lucide-react";
import { AdminApi, type EngagementReport } from "../../api/client";
import { errorMessage } from "../../util/error";
import { bandColor, bandLabel } from "../../util/engagement";

const navy = "var(--nuru-navy)";
const BANDS = ["thriving", "steady", "watch", "at_risk"] as const;

export function CohortEngagement(): ReactElement {
  const [data, setData] = useState<EngagementReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    AdminApi.engagementReport().then(setData).catch((e) => setError(errorMessage(e, "Could not load engagement.")));
  }, []);

  if (error) return <p style={{ color: "var(--color-danger)" }}>{error}</p>;
  if (!data) return <p style={{ color: "var(--muted-foreground)" }}>Loading engagement…</p>;

  const total = BANDS.reduce((a, b) => a + (data.bands[b] ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="nuru-eyebrow nuru-eyebrow-gold">OPERATIONS</div>
        <h1 className="nuru-display" style={{ fontSize: 28 }}>Cohort Engagement</h1>
      </div>

      {/* Band distribution */}
      <section className="nuru-card" style={{ padding: 20 }}>
        <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
          <div>
            <div className="nuru-eyebrow">DISTRIBUTION</div>
            <h2 className="type-section" style={{ fontSize: 20 }}>Engagement bands</h2>
          </div>
          <TrendingUp size={18} style={{ color: "var(--nuru-gold)" }} />
        </div>
        {/* stacked bar */}
        <div style={{ display: "flex", height: 16, borderRadius: 999, overflow: "hidden", background: "var(--input-background)" }}>
          {BANDS.map((b) => {
            const n = data.bands[b] ?? 0;
            const w = total > 0 ? (n / total) * 100 : 0;
            return w > 0 ? <div key={b} title={`${bandLabel(b)}: ${n}`} style={{ width: `${w}%`, background: bandColor(b) }} /> : null;
          })}
        </div>
        <div className="flex" style={{ gap: 20, marginTop: 16, flexWrap: "wrap" }}>
          {BANDS.map((b) => (
            <div key={b} className="flex items-center" style={{ gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: bandColor(b) }} />
              <div>
                <div className="nuru-numeric" style={{ fontSize: 20 }}>{data.bands[b] ?? 0}</div>
                <div className="nuru-eyebrow" style={{ textTransform: "capitalize" }}>{bandLabel(b)}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Per-cell table */}
      <section className="nuru-card" style={{ padding: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr className="type-table-header" style={{ textAlign: "left", color: "var(--muted-foreground)" }}>
              <th style={th}>Cell group</th>
              <th style={{ ...th, textAlign: "right" }}>Members</th>
              <th style={{ ...th, textAlign: "right" }}>Avg engagement</th>
              <th style={{ ...th, textAlign: "right" }}>At risk</th>
            </tr>
          </thead>
          <tbody>
            {data.cells.map((c) => (
              <tr key={c.cell_group_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, color: navy }}>{c.name}</td>
                <td style={{ ...td, textAlign: "right" }}>{c.members}</td>
                <td style={{ ...td, textAlign: "right" }}>{`${Math.round(c.avg_engagement * 100)}%`}</td>
                <td style={{ ...td, textAlign: "right" }}>
                  {c.at_risk > 0 ? (
                    <span className="flex items-center" style={{ gap: 4, justifyContent: "flex-end", color: "#A8281F", fontWeight: 600 }}>
                      <AlertTriangle size={13} /> {c.at_risk}
                    </span>
                  ) : (
                    <span style={{ color: "var(--muted-foreground)" }}>0</span>
                  )}
                </td>
              </tr>
            ))}
            {data.cells.length === 0 ? (
              <tr><td colSpan={4} style={{ padding: 16, color: "var(--muted-foreground)" }}>No cells yet.</td></tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const th = { padding: "10px 12px" } as const;
const td = { padding: "11px 12px" } as const;
