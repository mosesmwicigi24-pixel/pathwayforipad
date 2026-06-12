// ERP Dashboard (Pulse design, Contract Matrix W1). KPI grid from
// /admin/reports/overview, the weekly attendance trend, recent events, and
// guardian consents needing renewal (§5.9). Read-only; everything is served
// by the B1 report endpoints.
import { useEffect, useState, type ReactElement } from "react";
import {
  AdminApi,
  type OverviewKpis,
  type AttendanceTrendPoint,
  type RecentEventRow,
  type ConsentRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { kpiCards, trendBars, shortWeekLabel } from "../../util/dashboardLogic";
import { colors, card, font } from "../../theme";

interface DashboardData {
  overview: OverviewKpis;
  trend: AttendanceTrendPoint[];
  recentEvents: RecentEventRow[];
  consents: ConsentRow[];
}

export function Dashboard(): ReactElement {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overview, attendance, consents] = await Promise.all([
          AdminApi.overview(),
          AdminApi.attendanceReport(8),
          AdminApi.consentsReport(),
        ]);
        if (!cancelled) {
          setData({ overview, trend: attendance.trend, recentEvents: attendance.recent_events, consents });
        }
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not load the dashboard"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ color: colors.danger }}>{error}</p>;
  if (!data) return <p style={{ color: colors.textMuted }}>Loading dashboard…</p>;

  const cards = kpiCards(data.overview);
  const bars = trendBars(data.trend);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI grid */}
      <section
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}
        aria-label="Key metrics"
      >
        {cards.map((kpi) => {
          const alert = kpi.tone === "alert" && kpi.value !== "0";
          return (
            <div key={kpi.key} style={{ ...card, padding: 14 }}>
              <div style={{ color: colors.textMuted, fontSize: font.size.sm }}>{kpi.label}</div>
              <div
                style={{
                  fontSize: font.size.kpi,
                  fontWeight: 700,
                  marginTop: 4,
                  color: alert ? colors.danger : colors.text,
                }}
              >
                {kpi.value}
              </div>
            </div>
          );
        })}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Attendance trend */}
        <section style={card} aria-label="Attendance trend">
          <h2 style={{ margin: "0 0 12px", fontSize: font.size.lg }}>Attendance · last 8 weeks</h2>
          {bars.length === 0 ? (
            <p style={{ color: colors.textMuted, fontSize: font.size.md }}>No check-ins recorded yet.</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140 }}>
              {bars.map((b) => (
                <div key={b.week_start} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: font.size.xs, color: colors.textMuted }}>{b.check_ins}</div>
                  <div
                    title={`${b.check_ins} check-ins · ${b.unique_members} members`}
                    style={{
                      height: Math.max(4, Math.round(b.height * 100)),
                      background: colors.primary,
                      borderRadius: 4,
                      opacity: 0.4 + b.height * 0.6,
                    }}
                  />
                  <div style={{ fontSize: font.size.xs, color: colors.textFaint, marginTop: 4 }}>
                    {shortWeekLabel(b.week_start)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <h3 style={{ margin: "18px 0 8px", fontSize: font.size.base }}>Recent events</h3>
          {data.recentEvents.length === 0 ? (
            <p style={{ color: colors.textMuted, fontSize: font.size.md }}>No events in the last 30 days.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
              <thead>
                <tr style={{ textAlign: "left", color: colors.textMuted }}>
                  <th style={{ padding: "6px 4px" }}>Event</th>
                  <th style={{ padding: "6px 4px" }}>When</th>
                  <th style={{ padding: "6px 4px", textAlign: "right" }}>Checked in</th>
                  <th style={{ padding: "6px 4px", textAlign: "right" }}>RSVP going</th>
                </tr>
              </thead>
              <tbody>
                {data.recentEvents.slice(0, 8).map((e) => (
                  <tr key={e.event_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "6px 4px" }}>{e.title}</td>
                    <td style={{ padding: "6px 4px", color: colors.textMuted }}>
                      {new Date(e.occurs_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>{e.checked_in}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>{e.rsvp_going}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Consents needing renewal */}
        <section style={card} aria-label="Guardian consents">
          <h2 style={{ margin: "0 0 12px", fontSize: font.size.lg }}>Guardian consents · renew soon</h2>
          {data.consents.length === 0 ? (
            <p style={{ color: colors.textMuted, fontSize: font.size.md }}>Nothing expiring. 🎉</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, fontSize: font.size.md }}>
              {data.consents.slice(0, 10).map((c) => (
                <li
                  key={c.consent_id}
                  style={{
                    padding: "8px 10px",
                    marginBottom: 6,
                    background: colors.warningBg,
                    color: colors.warningText,
                    borderRadius: 6,
                  }}
                >
                  <strong>{c.full_name}</strong> — {c.guardian_name} ({c.relationship})
                  <div style={{ fontSize: font.size.sm }}>renew by {c.renew_by}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
