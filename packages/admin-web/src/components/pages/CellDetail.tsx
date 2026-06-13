// Cell Detail — rebuilt to the make, wired to live data: the cell summary from
// AdminApi.engagementReport (by cell_group_id) + its roster from OpsApi.members
// filtered to the cell. Band breakdown is computed from the real roster; the
// member table shows the engagement metrics we actually track (score, band,
// last active, level). Mock sub-scores / next-session / activity are omitted.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronRight, ChevronDown, CircleAlert, Clock3, Send, Users, MessageSquareText } from "lucide-react";
import { AdminApi, OpsApi, type EngagementCellRow, type MemberRow } from "../../api/client";
import { errorMessage } from "../../util/error";

const BANDS = ["thriving", "steady", "watch", "at_risk"] as const;
type BandKey = (typeof BANDS)[number];
const bandMeta: Record<BandKey, { label: string; dot: string; bg: string; color: string }> = {
  thriving: { label: "Thriving", dot: "#16A34A", bg: "#F0FDF4", color: "#15803D" },
  steady: { label: "Steady", dot: "#0EA5E9", bg: "#E0F2FE", color: "#0369A1" },
  watch: { label: "Watch", dot: "#F59E0B", bg: "#FFFBEB", color: "#B45309" },
  at_risk: { label: "At-risk", dot: "#DC2626", bg: "#FEF2F2", color: "#B91C1C" },
};
const initials = (name: string): string => name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const pct = (v: number | null): number => Math.round((v ?? 0) * 100);
const daysAgo = (iso: string | null): number | null => { if (!iso) return null; const t = new Date(iso).getTime(); if (Number.isNaN(t)) return null; return Math.max(0, Math.floor((Date.now() - t) / 86400000)); };

export function CellDetail(): ReactElement {
  const navigate = useNavigate();
  const { cellId } = useParams<{ cellId: string }>();
  const [cell, setCell] = useState<EngagementCellRow | null>(null);
  const [roster, setRoster] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cellId) { setLoading(false); return; }
    let alive = true;
    void (async () => {
      try {
        const [report, mem] = await Promise.all([AdminApi.engagementReport(), OpsApi.members({})]);
        if (!alive) return;
        setCell(report.cells.find((c) => c.cell_group_id === cellId) ?? null);
        setRoster(mem.data.filter((m) => m.cell_group_id === cellId));
      } catch (e) { if (alive) setError(errorMessage(e, "Could not load the cell.")); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [cellId]);

  const sorted = useMemo(() => [...roster].sort((a, b) => sortAsc ? (a.e_score ?? 0) - (b.e_score ?? 0) : (b.e_score ?? 0) - (a.e_score ?? 0)), [roster, sortAsc]);
  const bandCounts = useMemo(() => {
    const c: Record<BandKey, number> = { thriving: 0, steady: 0, watch: 0, at_risk: 0 };
    for (const m of roster) { const b = (m.band ?? "") as BandKey; if (b in c) c[b] += 1; }
    return c;
  }, [roster]);

  if (loading) return <div style={{ minHeight: "100%", background: "var(--background)", display: "grid", placeItems: "center", color: "var(--muted-foreground)" }}>Loading cell…</div>;
  if (!cell) {
    return (
      <main className="flex min-h-full flex-col items-center justify-center gap-4 p-12 text-center" style={{ background: "var(--background)" }}>
        <h2 className="type-section">Cell not found</h2>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>{error ?? "We couldn't find that cell."}</p>
        <button onClick={() => navigate("/cell-engagement")} className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 14, fontWeight: 800, border: "none" }}><ArrowLeft size={15} /> Back to Cell Engagement</button>
      </main>
    );
  }

  const avg = pct(cell.avg_engagement);
  const watch = bandCounts.watch;

  return (
    <main className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 26px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <button onClick={() => navigate("/cell-engagement")} style={{ color: "rgba(232,239,245,0.55)", background: "none", border: "none" }}>Cell Engagement</button>
            <ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>{cell.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate("/cell-engagement")} className="inline-flex items-center gap-1.5 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><ArrowLeft size={13} /> All cells</button>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Send size={13} /> Message cell</button>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background: "rgba(245,199,126,0.18)", color: "#F5C77E", fontSize: 14, fontWeight: 800 }}>{initials(cell.name)}</span>
          <div>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(20px,3vw,28px)", lineHeight: 1.1 }}>{cell.name}</h1>
            <p style={{ fontSize: 11.5, color: "rgba(232,239,245,0.7)", marginTop: 4 }}>{cell.members} members · {cell.at_risk} at-risk</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Members", value: String(cell.members), hint: "in this cell" },
            { label: "Avg engagement", value: `${avg}%`, hint: "this cell" },
            { label: "At-risk", value: String(cell.at_risk), hint: "need pastoral call" },
            { label: "On watch", value: String(watch), hint: "send a nudge" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 9.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 5 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {/* Band breakdown + KPI tiles */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>Health mix</div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "#0B1F33", marginBottom: 16 }}>Engagement bands</h3>
            <div className="flex h-3 overflow-hidden rounded-full mb-4" style={{ background: "rgba(0,0,0,0.05)" }}>
              {BANDS.map((b) => roster.length && bandCounts[b] > 0 ? <div key={b} style={{ width: `${(bandCounts[b] / roster.length) * 100}%`, background: bandMeta[b].dot }} title={`${bandMeta[b].label}: ${bandCounts[b]}`} /> : null)}
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {BANDS.map((b) => (
                <div key={b} className="flex items-center justify-between rounded-xl px-3 py-2" style={{ border: "1px solid var(--border)" }}>
                  <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: "#0B1F33" }}><span className="h-2 w-2 rounded-full" style={{ background: bandMeta[b].dot }} /> {bandMeta[b].label}</span>
                  <span className="font-mono" style={{ fontSize: 12, fontWeight: 800, color: "#0B1F33" }}>{bandCounts[b]}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-2 grid grid-cols-2 gap-4 nuru-card-rotate">
            {[
              { label: "Members", value: cell.members, Icon: Users, tint: "tint-blue", sub: "in this cell" },
              { label: "At-risk", value: cell.at_risk, Icon: CircleAlert, tint: "tint-red", sub: "need pastoral call" },
              { label: "Watch list", value: watch, Icon: Clock3, tint: "tint-amber", sub: "send nudge" },
              { label: "Avg engagement", value: `${avg}%`, Icon: MessageSquareText, tint: "tint-green", sub: "this cell" },
            ].map(({ label, value, Icon, tint, sub }) => (
              <div key={label} className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px" }}>
                <div className="flex items-start justify-between mb-2"><div className={`flex items-center justify-center rounded-lg ${tint}`} style={{ width: 34, height: 34 }}><Icon size={15} /></div></div>
                <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
                <div style={{ fontFamily: "var(--font-display)", color: "var(--nuru-navy)", fontSize: 22, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>{sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Member table */}
        <div className="overflow-hidden rounded-[28px]" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-6 px-6 py-5" style={{ background: "#0B1F33", color: "#fff" }}>
            <div><p className="type-table-header" style={{ color: "rgba(255,255,255,0.55)" }}>{cell.name}</p><h2 style={{ fontFamily: "var(--font-display)", fontWeight: 400, fontSize: 18, lineHeight: 1.2, marginTop: 4 }}>Member engagement</h2></div>
            <button onClick={() => setSortAsc((v) => !v)} className="inline-flex items-center gap-1.5 rounded-2xl px-4 py-2.5" style={{ border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.1)", fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.8)" }}>{sortAsc ? "Lowest first" : "Highest first"} <ChevronDown size={14} /></button>
          </div>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ background: "var(--secondary)", textAlign: "left" }}>
              {["Member", "Level", "Engagement", "Band", "Last active", "Action"].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0B1F33" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {sorted.map((m) => { const score = pct(m.e_score); const band = (m.band ?? "steady") as BandKey; const bm = bandMeta[band] ?? bandMeta.steady; const da = daysAgo(m.last_activity); return (
                <tr key={m.user_id} onClick={() => navigate("/member-profile")} className="cursor-pointer transition hover:bg-secondary/60" style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "#0B1F33", fontSize: 12, fontWeight: 800, color: "#fff" }}>{initials(m.full_name)}</div><div><p style={{ fontSize: 14, fontWeight: 800, color: "var(--foreground)", whiteSpace: "nowrap" }}>{m.full_name}</p><p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{m.email ?? m.phone_number}</p></div></div></td>
                  <td className="px-5 py-4" style={{ fontSize: 13, fontWeight: 700, color: "#0B1F33" }}>L{m.current_level ?? "—"}</td>
                  <td className="px-5 py-4">
                    <div style={{ minWidth: 120 }}>
                      <div className="mb-1 font-mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--foreground)" }}>{score}%</div>
                      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.06)" }}><div className="h-full rounded-full" style={{ width: `${score}%`, background: bm.dot }} /></div>
                    </div>
                  </td>
                  <td className="px-5 py-4"><span className="inline-flex rounded-full px-3 py-1" style={{ fontSize: 12, fontWeight: 800, background: bm.bg, color: bm.color }}>{bm.label}</span></td>
                  <td className="px-5 py-4"><span className="font-mono" style={{ fontSize: 14, fontWeight: da != null && da >= 7 ? 800 : 600, color: da != null && da >= 7 ? "#B91C1C" : "var(--foreground)" }}>{da == null ? "—" : `${da}d`}</span></td>
                  <td className="px-5 py-4"><button onClick={(e) => { e.stopPropagation(); navigate("/member-profile"); }} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, fontWeight: 800, color: "#0B1F33" }}>View <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} /></button></td>
                </tr>
              ); })}
              {sorted.length === 0 ? <tr><td colSpan={6} className="px-5 py-8 text-center" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No members loaded for this cell.</td></tr> : null}
            </tbody>
          </table></div>
        </div>
      </section>
    </main>
  );
}
