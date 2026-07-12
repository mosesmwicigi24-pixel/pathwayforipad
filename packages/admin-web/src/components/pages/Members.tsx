// Members — "Final Pathway Portal" make, wired to the live ops API (OpsApi.members
// + addMember + setGraduation, PR #123). Real roster rows: identity (name, level,
// email, country flag · city), cell + discipler, start point, programme + progress,
// last active, and a server-derived status pill (graduated|engagement band). Hero
// stat strip + a "By country" chip row that filters; toolbar search + band/status
// filter (incl. Graduated) + cell filter. Add-member modal captures the Figma
// fields (engagement band is server-computed and never collected). Export = a
// client-only print/PDF of the loaded roster. Graduate / un-graduate per member.
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Search, Plus, ChevronDown, ArrowRight, Mail, UserCheck, UserPlus, Users as UsersIcon,
  ChevronRight, CheckCircle2, Flag, Download, Printer, X, GraduationCap, MoreVertical, Pencil, Check,
  BarChart3, Award, Star, BookOpen, KeyRound, Copy, ShieldPlus,
} from "lucide-react";
import {
  OpsApi, AdminApi, SystemApi, CurriculumApi,
  type MemberRow, type MemberDetail, type MemberStatus, type EngagementCellRow, type Country, type Programme, type Gender,
  type AdminLevel, type AdminModuleSummary, type MemberResults, type MemberResultLevel,
} from "../../api/client";
import { errorMessage } from "../../util/error";

// Manual password reset: confirm → server mints a temporary password (revoking
// the member's sessions) → show it ONCE with copy. It is never retrievable again.
function ResetPasswordModal({ userId, name, onClose }: { userId: string; name: string; onClose: () => void }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true); setError(null);
    try {
      const r = await OpsApi.resetMemberPassword(userId);
      setTemp(r.temporary_password);
    } catch (e) { setError(errorMessage(e, "Could not reset the password.")); }
    finally { setBusy(false); }
  }
  async function copy(): Promise<void> {
    if (!temp) return;
    try { await navigator.clipboard.writeText(temp); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* leave manual selection */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={temp ? undefined : onClose}>
      <div className="rounded-2xl overflow-hidden w-full" style={{ background: "var(--card)", maxWidth: 460, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#0E7490" }}><KeyRound size={12} /> RESET PASSWORD</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{name}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5">
          {temp ? (
            <>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Hand this to {name.split(" ")[0]} — it works immediately and they can change it in their app under Profile. <strong>It will not be shown again.</strong></p>
              <div className="flex items-center justify-between rounded-xl mt-4 px-4 py-3" style={{ background: "var(--input-background)", border: "1px dashed var(--nuru-gold)" }}>
                <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-navy)" }}>{temp}</code>
                <button onClick={() => void copy()} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: copied ? "rgba(22,163,74,0.12)" : "var(--nuru-navy)", color: copied ? "#16A34A" : "#fff", border: "none", fontSize: 12, fontWeight: 700 }}>
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10 }}>Their previous password no longer works and every signed-in device has been logged out.</p>
              <button onClick={onClose} className="w-full rounded-xl mt-4 py-2.5" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 700 }}>Done</button>
            </>
          ) : (
            <>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55 }}>This creates a new temporary password for <strong>{name}</strong>, signs them out of every device, and invalidates their old password. Use it when a member is locked out and can't reset by themselves.</p>
              {error ? <p style={{ fontSize: 12.5, color: "#DC2626", marginTop: 10 }}>{error}</p> : null}
              <div className="flex gap-2 mt-5">
                <button onClick={onClose} className="flex-1 rounded-xl py-2.5" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 700 }}>Cancel</button>
                <button onClick={() => void run()} disabled={busy} className="flex-1 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, opacity: busy ? 0.6 : 1 }}>{busy ? "Resetting…" : "Reset & get password"}</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

type StatusKey = MemberStatus;
const statusMeta: Record<StatusKey, { label: string; bg: string; fg: string; ring: string }> = {
  thriving: { label: "Thriving", bg: "rgba(22,163,74,0.10)", fg: "#16A34A", ring: "rgba(22,163,74,0.2)" },
  steady: { label: "Steady", bg: "rgba(11,31,51,0.08)", fg: "#0B1F33", ring: "rgba(11,31,51,0.15)" },
  watch: { label: "Watch", bg: "rgba(200,155,60,0.12)", fg: "#8B6914", ring: "rgba(200,155,60,0.25)" },
  at_risk: { label: "At-risk", bg: "rgba(220,38,38,0.10)", fg: "#DC2626", ring: "rgba(220,38,38,0.2)" },
  graduated: { label: "Graduated", bg: "rgba(124,58,237,0.10)", fg: "#7C3AED", ring: "rgba(124,58,237,0.25)" },
};
const PROGRAMME_LABELS: Record<Programme, string> = {
  new_believer: "New Believer",
  foundations: "Foundations",
  serving_track: "Serving Track",
  leadership_prep: "Leadership Prep",
};
const AVATARS = ["linear-gradient(135deg,#0B1F33,#1E4068)", "linear-gradient(135deg,#C89B3C,#8B6914)", "linear-gradient(135deg,#16A34A,#065F46)", "linear-gradient(135deg,#7C3AED,#4C1D95)", "linear-gradient(135deg,#DC2626,#7F1D1D)", "linear-gradient(135deg,#0EA5E9,#075985)"];
const initials = (n: string): string => n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const pct = (v: number | null): number => Math.round((v ?? 0) * 100);
const relTime = (iso: string | null): string => { if (!iso) return "—"; const t = new Date(iso).getTime(); if (Number.isNaN(t)) return "—"; const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d}d ago`; };
// Status filter pill cycle (the server derives status; graduated overrides band).
const STATUS_ORDER: ("All" | StatusKey)[] = ["All", "thriving", "steady", "watch", "at_risk", "graduated"];

export function Members(): ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [cells, setCells] = useState<EngagementCellRow[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"All" | StatusKey>("All");
  const [cellFilter, setCellFilter] = useState<string>("All");
  const [countryFilter, setCountryFilter] = useState<string>("All"); // ISO-2 code or "All"
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [resultsId, setResultsId] = useState<string | null>(null);
  const [pwResetFor, setPwResetFor] = useState<{ userId: string; name: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Band filter goes to the server; "graduated" is derived (server-side filter
      // doesn't accept it), so it filters client-side on the loaded rows.
      const q: { search?: string; band?: string; country_code?: string } = {};
      if (query.trim()) q.search = query.trim();
      if (status !== "All" && status !== "graduated") q.band = status;
      if (countryFilter !== "All") q.country_code = countryFilter;
      const r = await OpsApi.members(q);
      setRows(r.data);
    } catch (e) { setError(errorMessage(e, "Could not load members.")); }
  }, [query, status, countryFilter]);

  useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
  useEffect(() => { void AdminApi.engagementReport().then((r) => setCells(r.cells)).catch(() => {}); }, []);
  useEffect(() => { void SystemApi.countries().then(setCountries).catch(() => {}); }, []);

  const countryByCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);
  const cellNames = useMemo(() => ["All", ...Array.from(new Set(rows.map((m) => m.cell_name).filter(Boolean) as string[]))], [rows]);

  const filtered = useMemo(
    () => rows.filter((m) =>
      (cellFilter === "All" || m.cell_name === cellFilter) &&
      (status !== "graduated" || m.status === "graduated")),
    [rows, cellFilter, status],
  );

  // "By country" chips: counts over the loaded roster (post search/band/country filter).
  const countryChips = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of rows) if (m.country_code) counts.set(m.country_code, (counts.get(m.country_code) ?? 0) + 1);
    return Array.from(counts.entries())
      .map(([code, count]) => ({ code, count, country: countryByCode.get(code) ?? null }))
      .sort((a, b) => b.count - a.count);
  }, [rows, countryByCode]);

  const counts = {
    total: rows.length,
    thriving: rows.filter((m) => m.status === "thriving").length,
    watch: rows.filter((m) => m.status === "watch").length,
    atRisk: rows.filter((m) => m.status === "at_risk").length,
  };

  async function graduate(userId: string, next: boolean): Promise<void> {
    setMenuFor(null);
    try { await OpsApi.setGraduation(userId, next); await load(); }
    catch (e) { setError(errorMessage(e, "Could not update graduation.")); }
  }

  // Elevate a member into a privileged portal user (no separate registration).
  // They keep their Student membership + member-app access, but gain admin-console
  // sign-in and appear on System ▸ Users, where roles/permissions are assigned.
  async function elevate(userId: string, name: string): Promise<void> {
    setMenuFor(null);
    if (!window.confirm(`Make ${name} a portal user? They'll be able to sign in to the admin portal and will appear on System ▸ Users, where you can assign their roles and permissions. Their member access is unchanged.`)) return;
    try {
      await OpsApi.elevateMember(userId);
      await load();
      window.alert(`${name} is now a portal user. Assign their roles and permissions on System ▸ Users.`);
    } catch (e) { setError(errorMessage(e, "Could not elevate this member.")); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }} onClick={() => setMenuFor(null)}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Nuru Pathway</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Members</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><UsersIcon size={11} /> {counts.total} on pathway</span>
            <button onClick={() => setExportOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)" }}><Download size={13} /> Export</button>
            <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Add member</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          {[
            { label: "Total members", value: String(counts.total), fg: "var(--tint-navy-fg)", bg: "var(--tint-navy-bg)", border: "rgba(29,78,134,0.18)", dot: false },
            { label: "Thriving", value: String(counts.thriving), fg: "var(--tint-green-fg)", bg: "var(--tint-green-bg)", border: "rgba(22,101,52,0.18)", dot: true },
            { label: "Watch", value: String(counts.watch), fg: "var(--tint-gold-fg)", bg: "var(--tint-gold-bg)", border: "rgba(138,107,31,0.18)", dot: true },
            { label: "At-risk", value: String(counts.atRisk), fg: "var(--tint-rose-fg)", bg: "var(--tint-rose-bg)", border: "rgba(168,40,31,0.18)", dot: true },
          ].map((item) => (
            <div key={item.label} className="rounded-2xl" style={{ padding: "14px 16px", background: item.bg, border: `1px solid ${item.border}` }}>
              <div style={{ fontSize: 10.5, color: item.fg, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 8 }}>{item.label}</div>
              <div className="flex items-center gap-1.5">
                {item.dot ? <span style={{ width: 8, height: 8, borderRadius: 99, background: item.fg, display: "inline-block" }} /> : null}
                <span style={{ fontFamily: "var(--font-display)", fontSize: 26, color: item.fg, lineHeight: 1 }}>{item.value}</span>
              </div>
            </div>
          ))}
        </div>

        {countryChips.length > 0 ? (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <span style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>By country</span>
            <button onClick={() => setCountryFilter("All")} className="inline-flex items-center gap-1.5 rounded-full px-2.5" style={{ height: 26, fontSize: 11.5, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)", background: countryFilter === "All" ? "var(--nuru-gold)" : "rgba(255,255,255,0.06)", color: "#fff" }}>All</button>
            {countryChips.map((c) => (
              <button key={c.code} onClick={() => setCountryFilter(countryFilter === c.code ? "All" : c.code)} className="inline-flex items-center gap-1.5 rounded-full px-2.5" style={{ height: 26, fontSize: 11.5, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)", background: countryFilter === c.code ? "var(--nuru-gold)" : "rgba(255,255,255,0.06)", color: "#fff" }}>
                <span style={{ fontSize: 13 }}>{c.country?.flag ?? "🏳️"}</span>{c.country?.name ?? c.code}<span style={{ opacity: 0.7 }}>· {c.count}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "12px 14px" }}>
          <div className="flex items-center gap-2 rounded-lg flex-1" style={{ height: 38, background: "var(--input-background)", padding: "0 12px" }}>
            <Search size={14} style={{ color: "var(--muted-foreground)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or programme…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setStatus(STATUS_ORDER[(STATUS_ORDER.indexOf(status) + 1) % STATUS_ORDER.length] as "All" | StatusKey)} className="flex items-center gap-1.5 rounded-lg" style={{ height: 38, padding: "0 12px", background: "var(--input-background)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", border: "1px solid var(--border)" }}>Band: {status === "All" ? "All" : statusMeta[status].label} <ChevronDown size={12} /></button>
            <button onClick={() => setCellFilter(cellNames[(cellNames.indexOf(cellFilter) + 1) % cellNames.length] ?? "All")} className="flex items-center gap-1.5 rounded-lg" style={{ height: 38, padding: "0 12px", background: "var(--input-background)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", border: "1px solid var(--border)" }}>Cell: {cellFilter} <ChevronDown size={12} /></button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl text-center py-12" style={{ background: "#fff", border: "1px dashed var(--border)" }}><p style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No members match those filters.</p></div>
        ) : (
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "0 1px 2px rgba(11,31,51,0.03)" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <thead>
                <tr style={{ background: "var(--input-background)", borderBottom: "1px solid var(--border)" }}>
                  {[
                    // Proportional widths (tableLayout: fixed) so the Member column
                    // doesn't absorb all leftover space on wide screens and starve
                    // the right-hand columns into congestion.
                    { h: "Member", w: "25%", align: "left" as const },
                    { h: "Cell", w: "14%", align: "left" as const },
                    { h: "Start", w: "10%", align: "left" as const },
                    { h: "Progress", w: "19%", align: "left" as const },
                    { h: "Last active", w: "11%", align: "left" as const },
                    { h: "Status", w: "9%", align: "center" as const },
                    { h: "", w: "12%", align: "right" as const },
                  ].map((c, idx) => (
                    <th key={idx} style={{ width: c.w, padding: "11px 14px", textAlign: c.align, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{c.h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((m, i) => {
                  const sk = (m.status ?? "steady") as StatusKey;
                  const sm = statusMeta[sk] ?? statusMeta.steady;
                  const isThriving = m.status === "thriving";
                  const isGraduated = m.status === "graduated";
                  const progress = pct(m.e_score);
                  const country = m.country_code ? countryByCode.get(m.country_code) ?? null : null;
                  return (
                    <tr key={m.user_id} onClick={() => navigate(`/member-profile?id=${m.user_id}`)} className="group cursor-pointer transition-colors hover:bg-[var(--input-background)]" style={{ background: i % 2 === 1 ? "rgba(11,31,51,0.015)" : "#fff", borderTop: i > 0 ? "1px solid var(--border)" : "none" }}>
                      {/* Member */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="relative shrink-0">
                            <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: AVATARS[i % AVATARS.length], color: "#fff", fontSize: 13.5, fontWeight: 700 }}>{initials(m.full_name)}</div>
                            {isThriving ? <span className="absolute rounded-full" style={{ width: 11, height: 11, right: -2, bottom: -2, background: "var(--lum-green)", border: "2px solid #fff" }} /> : null}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.full_name}</span>
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--nuru-gold)", background: "rgba(200,155,60,0.12)", padding: "2px 6px", borderRadius: 4 }}>L{m.current_level ?? "—"}</span>
                              {m.is_minor ? <span style={{ fontSize: 9, fontWeight: 700, color: "#A87616", background: "rgba(245,158,11,0.18)", padding: "2px 6px", borderRadius: 4 }}>MINOR</span> : null}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}><Mail size={10} /><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.email ?? m.phone_number}</span></div>
                            {country || m.city ? <div className="flex items-center gap-1 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{country ? <span style={{ fontSize: 12 }}>{country.flag ?? "🏳️"}</span> : null}<span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{[country?.name ?? m.country_code, m.city].filter(Boolean).join(" · ")}</span></div> : null}
                          </div>
                        </div>
                      </td>
                      {/* Cell */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <button onClick={(e) => { e.stopPropagation(); if (m.cell_group_id) navigate(`/cell-engagement/${m.cell_group_id}`); }} className="flex flex-col text-left min-w-0" style={{ background: "none", border: "none", maxWidth: "100%" }}>
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.cell_name ?? "—"}</span>
                          <span className="flex items-center gap-1 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}><UserCheck size={10} style={{ color: "var(--nuru-gold)" }} /> cell</span>
                        </button>
                      </td>
                      {/* Start */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <span className="inline-flex items-center gap-1" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}><Flag size={11} style={{ color: "var(--lum-navy)" }} /> L{m.start_level ?? 1}·M{m.start_module_sequence ?? 1}</span>
                        <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>start point</div>
                      </td>
                      {/* Progress */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div className="flex items-center justify-between mb-1 min-w-0"><span style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.programme ? PROGRAMME_LABELS[m.programme] : "Engagement"}</span><span style={{ fontSize: 12, color: "var(--nuru-navy)", fontWeight: 700, marginLeft: 6 }}>{progress}%</span></div>
                        <div style={{ height: 6, background: "var(--input-background)", borderRadius: 99, overflow: "hidden" }}><div style={{ height: "100%", width: `${progress}%`, background: sm.fg, borderRadius: 99 }} /></div>
                      </td>
                      {/* Last active */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <span style={{ fontSize: 12.5, color: "var(--nuru-navy)", fontWeight: 600, whiteSpace: "nowrap" }}>{relTime(m.last_activity)}</span>
                      </td>
                      {/* Status */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle", textAlign: "center" }}>
                        <span className="inline-block rounded-full text-center" style={{ minWidth: 76, padding: "5px 10px", background: sm.bg, color: sm.fg, fontSize: 11, fontWeight: 700, border: `1px solid ${sm.ring}`, whiteSpace: "nowrap" }}>{sm.label}</span>
                      </td>
                      {/* Actions — right-aligned */}
                      <td style={{ padding: "12px 14px", verticalAlign: "middle" }}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={(e) => { e.stopPropagation(); setResultsId(m.user_id); }} title="View results" className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 34, height: 34, background: "var(--input-background)", color: "var(--nuru-gold)", border: "1px solid var(--border)" }}><BarChart3 size={15} /></button>
                          <button onClick={(e) => { e.stopPropagation(); navigate(`/member-profile?id=${m.user_id}`); }} title="See profile" className="flex items-center justify-center rounded-lg shrink-0 transition-all group-hover:bg-[var(--nuru-navy)] group-hover:text-white" style={{ width: 34, height: 34, background: "var(--input-background)", color: "var(--nuru-navy)", border: "1px solid var(--border)" }}><ArrowRight size={15} /></button>
                          <div className="relative shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === m.user_id ? null : m.user_id); }} className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: "var(--input-background)", color: "var(--muted-foreground)", border: "1px solid var(--border)" }}><MoreVertical size={15} /></button>
                            {menuFor === m.user_id ? (
                              <div onClick={(e) => e.stopPropagation()} className="absolute right-0 mt-1 rounded-xl z-20" style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "0 12px 32px rgba(11,31,51,0.18)", minWidth: 168, overflow: "hidden" }}>
                                <button onClick={() => { setMenuFor(null); setEditId(m.user_id); }} className="flex items-center gap-2 w-full text-left px-3 py-2.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", background: "none", border: "none" }}><Pencil size={14} style={{ color: "var(--nuru-gold)" }} /> Edit member</button>
                                <button onClick={() => { setMenuFor(null); setPwResetFor({ userId: m.user_id, name: m.full_name }); }} className="flex items-center gap-2 w-full text-left px-3 py-2.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", background: "none", border: "none", borderTop: "1px solid var(--border)" }}><KeyRound size={14} style={{ color: "#0E7490" }} /> Reset password</button>
                                <button onClick={() => void elevate(m.user_id, m.full_name)} className="flex items-center gap-2 w-full text-left px-3 py-2.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", background: "none", border: "none", borderTop: "1px solid var(--border)" }}><ShieldPlus size={14} style={{ color: "var(--nuru-gold)" }} /> Make portal user</button>
                                <button onClick={() => void graduate(m.user_id, !isGraduated)} className="flex items-center gap-2 w-full text-left px-3 py-2.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)", background: "none", border: "none", borderTop: "1px solid var(--border)" }}><GraduationCap size={14} style={{ color: "#7C3AED" }} /> {isGraduated ? "Un-graduate" : "Mark graduated"}</button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between mt-6">
          <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Showing {filtered.length} of {rows.length} loaded</span>
          <div className="flex items-center gap-1.5"><CheckCircle2 size={12} style={{ color: "#16A34A" }} /><span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Live from the directory</span></div>
        </div>
      </div>

      {addOpen ? <AddMemberModal cells={cells} countries={countries} onClose={() => setAddOpen(false)} onCreated={async () => { setAddOpen(false); await load(); }} /> : null}
      {editId ? <EditMemberModal userId={editId} row={rows.find((r) => r.user_id === editId)} cells={cells} countries={countries} onClose={() => setEditId(null)} onSaved={async () => { setEditId(null); await load(); }} /> : null}
      {resultsId ? <MemberResultsDrawer userId={resultsId} onClose={() => setResultsId(null)} /> : null}
      {pwResetFor ? <ResetPasswordModal userId={pwResetFor.userId} name={pwResetFor.name} onClose={() => setPwResetFor(null)} /> : null}
      {exportOpen ? <ExportModal members={filtered} countryByCode={countryByCode} onClose={() => setExportOpen(false)} /> : null}
    </div>
  );
}

function AddMemberModal({ cells, countries, onClose, onCreated }: { cells: EngagementCellRow[]; countries: Country[]; onClose: () => void; onCreated: () => void }): ReactElement {
  // Personal details
  const [full_name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone_number, setPhone] = useState("");
  const [gender, setGender] = useState<"" | Gender>("");
  const [date_of_birth, setDob] = useState("");
  const [country_code, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("");
  // Pathway placement
  const [cell_group_id, setCell] = useState(cells[0]?.cell_group_id ?? "");
  const [start_level, setStartLevel] = useState("1");
  const [start_module_sequence, setStartModule] = useState("1");
  const [programme, setProgramme] = useState<"" | Programme>("");
  // Discipleship
  const [is_baptized, setBaptized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { if (!cell_group_id && cells[0]) setCell(cells[0].cell_group_id); }, [cells, cell_group_id]);

  const selectedCell = useMemo(() => cells.find((c) => c.cell_group_id === cell_group_id) ?? null, [cells, cell_group_id]);

  async function submit(): Promise<void> {
    if (!full_name.trim()) { setError("Please enter the member's name."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (!cell_group_id) { setError("Select a cell."); return; }
    setSaving(true); setError("");
    try {
      // Build body without assigning `undefined` (exactOptionalPropertyTypes).
      await OpsApi.addMember({
        full_name: full_name.trim(),
        phone_number: phone_number.trim() || "n/a",
        email: email.trim(),
        ...(date_of_birth ? { date_of_birth } : {}),
        cell_group_id,
        ...(gender ? { gender } : {}),
        ...(city.trim() ? { city: city.trim() } : {}),
        ...(programme ? { programme } : {}),
        ...(country_code ? { country_code } : {}),
        ...(language.trim() ? { language: language.trim() } : {}),
        is_baptized,
        start_level: Number(start_level) || 1,
        start_module_sequence: Number(start_module_sequence) || 1,
      });
      onCreated();
    } catch (e) { setError(errorMessage(e, "Could not add member.")); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 620, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><UserPlus size={12} /> NEW MEMBER</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Add a disciple</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>Capture their details and place them in a cell with a starting point.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          <Section title="Personal details">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full name" required><input value={full_name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Grace Wanjiru" style={inputS} /></Field>
              <Field label="Email" required><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" style={inputS} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone"><input value={phone_number} onChange={(e) => setPhone(e.target.value)} placeholder="+254 …" style={inputS} /></Field>
              <Field label="Gender"><select value={gender} onChange={(e) => setGender(e.target.value as "" | Gender)} style={inputS}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date of birth"><input type="date" value={date_of_birth} onChange={(e) => setDob(e.target.value)} style={inputS} /></Field>
              <Field label="Country"><select value={country_code} onChange={(e) => setCountry(e.target.value)} style={inputS}><option value="">—</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></Field>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Nairobi" style={inputS} /></Field>
              <Field label="Language"><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en" maxLength={12} style={inputS} /></Field>
            </div>
          </Section>

          <Section title="Pathway placement">
            <Field label="Cell assignment" required>
              <select value={cell_group_id} onChange={(e) => setCell(e.target.value)} style={inputS}>{cells.map((c) => <option key={c.cell_group_id} value={c.cell_group_id}>{c.name}</option>)}</select>
            </Field>
            <Field label="Discipler">
              <input value={selectedCell?.discipler_name ?? "—"} readOnly style={{ ...inputS, background: "var(--secondary)", color: "var(--muted-foreground)" }} />
            </Field>
            <PlacementFields level={start_level} module={start_module_sequence} onLevel={setStartLevel} onModule={setStartModule} />
            <Field label="Programme">
              <select value={programme} onChange={(e) => setProgramme(e.target.value as "" | Programme)} style={inputS}><option value="">—</option>{(Object.keys(PROGRAMME_LABELS) as Programme[]).map((p) => <option key={p} value={p}>{PROGRAMME_LABELS[p]}</option>)}</select>
            </Field>
          </Section>

          <Section title="Discipleship">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Date joined"><input value={new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} readOnly style={{ ...inputS, background: "var(--secondary)", color: "var(--muted-foreground)" }} /></Field>
              <Field label="Baptized">
                <button type="button" onClick={() => setBaptized((b) => !b)} className="flex items-center justify-between w-full rounded-lg px-3" style={{ height: 42, border: "1.5px solid var(--border)", background: "var(--input-background)" }}>
                  <span style={{ fontSize: 13, color: "var(--foreground)" }}>{is_baptized ? "Yes" : "No"}</span>
                  <span className="rounded-full" style={{ width: 38, height: 22, background: is_baptized ? "#16A34A" : "var(--border)", position: "relative", transition: "background .15s" }}><span className="rounded-full" style={{ width: 18, height: 18, background: "#fff", position: "absolute", top: 2, left: is_baptized ? 18 : 2, transition: "left .15s" }} /></span>
                </button>
              </Field>
            </div>
          </Section>

          {error ? <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{error}</div> : null}
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: saving ? 0.6 : 1 }}><Plus size={14} /> Add member</button>
        </div>
      </div>
    </div>
  );
}

function EditMemberModal({ userId, row, cells, countries, onClose, onSaved }: { userId: string; row: MemberRow | undefined; cells: EngagementCellRow[]; countries: Country[]; onClose: () => void; onSaved: () => void }): ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [start_level, setStartLevel] = useState(String(row?.start_level ?? row?.current_level ?? 1));
  const [start_module_sequence, setStartModule] = useState(String(row?.start_module_sequence ?? 1));
  const [full_name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone_number, setPhone] = useState("");
  const [gender, setGender] = useState<"" | Gender>("");
  const [date_of_birth, setDob] = useState("");
  const [country_code, setCountry] = useState("");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("");
  const [cell_group_id, setCell] = useState("");
  const [programme, setProgramme] = useState<"" | Programme>("");
  const [is_baptized, setBaptized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    void OpsApi.memberDetail(userId)
      .then((d: MemberDetail) => {
        if (!live) return;
        setName(d.full_name ?? "");
        setEmail(d.email ?? "");
        setPhone(d.phone_number ?? "");
        setGender(d.gender ?? "");
        setDob((d.date_of_birth ?? "").slice(0, 10));
        setCountry(d.country_code ?? "");
        setCity(d.city ?? "");
        setLanguage(d.language ?? "");
        setCell(d.cell_group_id ?? "");
        setProgramme(d.programme ?? "");
        setBaptized(!!d.is_baptized);
        setLoaded(true);
      })
      .catch((e) => { if (live) setError(errorMessage(e, "Could not load this member.")); });
    return () => { live = false; };
  }, [userId]);

  const selectedCell = useMemo(() => cells.find((c) => c.cell_group_id === cell_group_id) ?? null, [cells, cell_group_id]);
  // If the member has no cell yet (cell_group_id empty), default to the first cell
  // so the dropdown's visible selection matches state — otherwise it shows the first
  // option while state stays "" and "Select a cell." fires on save.
  useEffect(() => { if (loaded && !cell_group_id && cells[0]) setCell(cells[0].cell_group_id); }, [loaded, cell_group_id, cells]);

  async function submit(): Promise<void> {
    if (!full_name.trim()) { setError("Please enter the member's name."); return; }
    if (!cell_group_id) { setError("Select a cell."); return; }
    setSaving(true); setError("");
    try {
      await OpsApi.updateMember(userId, {
        full_name: full_name.trim(),
        phone_number: phone_number.trim() || "n/a",
        email: email.trim() || null,
        date_of_birth: date_of_birth || null,
        gender: gender || null,
        city: city.trim() || null,
        programme: programme || null,
        country_code: country_code || null,
        language: language.trim() || null,
        is_baptized,
        cell_group_id,
      });
      // Pathway placement (entry point) — drives what unlocks in the member's app.
      const lvl = Number(start_level) || 1;
      const mod = Number(start_module_sequence) || 1;
      await OpsApi.setMemberStart(userId, { start_level: lvl, start_module_sequence: mod });
      onSaved();
    } catch (e) { setError(errorMessage(e, "Could not save changes.")); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 620, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Pencil size={12} /> EDIT MEMBER</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Edit member details</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>Update their details, move them to another cell, or set the level &amp; module they've reached. Graduation is managed separately.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          {!loaded && !error ? <div style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "12px 0" }}>Loading member…</div> : null}
          {loaded ? (
            <>
              <Section title="Personal details">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Full name" required><input value={full_name} onChange={(e) => setName(e.target.value)} style={inputS} /></Field>
                  <Field label="Email"><input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" style={inputS} /></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Phone"><input value={phone_number} onChange={(e) => setPhone(e.target.value)} placeholder="+254 …" style={inputS} /></Field>
                  <Field label="Gender"><select value={gender} onChange={(e) => setGender(e.target.value as "" | Gender)} style={inputS}><option value="">—</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Date of birth"><input type="date" value={date_of_birth} onChange={(e) => setDob(e.target.value)} style={inputS} /></Field>
                  <Field label="Country"><select value={country_code} onChange={(e) => setCountry(e.target.value)} style={inputS}><option value="">—</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="City"><input value={city} onChange={(e) => setCity(e.target.value)} placeholder="e.g. Nairobi" style={inputS} /></Field>
                  <Field label="Language"><input value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="e.g. en" maxLength={12} style={inputS} /></Field>
                </div>
              </Section>

              <Section title="Pathway placement">
                <Field label="Cell assignment" required>
                  <select value={cell_group_id} onChange={(e) => setCell(e.target.value)} style={inputS}>{cells.map((c) => <option key={c.cell_group_id} value={c.cell_group_id}>{c.name}</option>)}</select>
                </Field>
                <Field label="Discipler"><input value={selectedCell?.discipler_name ?? "—"} readOnly style={{ ...inputS, background: "var(--secondary)", color: "var(--muted-foreground)" }} /></Field>
                <PlacementFields level={start_level} module={start_module_sequence} onLevel={setStartLevel} onModule={setStartModule} />
                <Field label="Programme">
                  <select value={programme} onChange={(e) => setProgramme(e.target.value as "" | Programme)} style={inputS}><option value="">—</option>{(Object.keys(PROGRAMME_LABELS) as Programme[]).map((p) => <option key={p} value={p}>{PROGRAMME_LABELS[p]}</option>)}</select>
                </Field>
              </Section>

              <Section title="Discipleship">
                <Field label="Baptized">
                  <button type="button" onClick={() => setBaptized((b) => !b)} className="flex items-center justify-between w-full rounded-lg px-3" style={{ height: 42, border: "1.5px solid var(--border)", background: "var(--input-background)" }}>
                    <span style={{ fontSize: 13, color: "var(--foreground)" }}>{is_baptized ? "Yes" : "No"}</span>
                    <span className="rounded-full" style={{ width: 38, height: 22, background: is_baptized ? "#16A34A" : "var(--border)", position: "relative", transition: "background .15s" }}><span className="rounded-full" style={{ width: 18, height: 18, background: "#fff", position: "absolute", top: 2, left: is_baptized ? 18 : 2, transition: "left .15s" }} /></span>
                  </button>
                </Field>
              </Section>
            </>
          ) : null}
          {error ? <div style={{ fontSize: 12.5, color: "#DC2626", fontWeight: 600 }}>{error}</div> : null}
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving || !loaded} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: saving || !loaded ? 0.6 : 1 }}><Check size={14} /> Save changes</button>
        </div>
      </div>
    </div>
  );
}

function ExportModal({ members, countryByCode, onClose }: { members: MemberRow[]; countryByCode: Map<string, Country>; onClose: () => void }): ReactElement {
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set(members.map((m) => m.user_id)));
  const toggle = (id: string): void => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const chosen = members.filter((m) => selected.has(m.user_id));
  const allOn = selected.size === members.length && members.length > 0;
  return (
    <>
      <style>{`@media print { body * { visibility: hidden !important; } #members-print, #members-print * { visibility: visible !important; } #members-print { position: fixed !important; inset: 0 !important; padding: 28px !important; background: #fff !important; } @page { size: A4 landscape; margin: 12mm; } }`}</style>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
        <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 480, maxHeight: "88vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Download size={12} /> EXPORT</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Export members to PDF</h2><p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>Choose who to include, then print to PDF.</p></div>
            <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
          </div>
          <div className="px-6 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
            <label className="flex items-center gap-2" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)" }}><input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(members.map((m) => m.user_id)))} /> Select all</label>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{selected.size} of {members.length} selected</span>
          </div>
          <div className="px-3 py-2 overflow-y-auto flex flex-col" style={{ flex: 1 }}>
            {members.map((m) => (
              <label key={m.user_id} className="flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer" style={{ fontSize: 13 }}>
                <input type="checkbox" checked={selected.has(m.user_id)} onChange={() => toggle(m.user_id)} />
                <span style={{ fontWeight: 600, color: "var(--nuru-navy)" }}>{m.full_name}</span>
                <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{m.cell_name ?? "—"}</span>
              </label>
            ))}
          </div>
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
            <button onClick={() => window.print()} disabled={chosen.length === 0} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: chosen.length === 0 ? "var(--muted)" : "var(--nuru-gold)", color: chosen.length === 0 ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><Printer size={14} /> Export {chosen.length} to PDF</button>
          </div>
        </div>
      </div>
      <div id="members-print" style={{ position: "absolute", left: -99999, top: 0, width: 1100, background: "#fff", color: "#0B1F33", fontFamily: "var(--font-sans)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", borderBottom: "2px solid #0B1F33", paddingBottom: 12, marginBottom: 16 }}>
          <div><div style={{ fontFamily: "var(--font-display)", fontSize: 24 }}>Nuru Pathway — Members</div><div style={{ fontSize: 12, color: "#6B7280" }}>Discipleship register</div></div>
          <div style={{ textAlign: "right", fontSize: 12, color: "#6B7280" }}><div>{chosen.length} members</div><div>Generated {today}</div></div>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead><tr style={{ background: "#F3F4F6", textAlign: "left" }}>{["#", "Name", "Email", "Country", "City", "Cell", "Level", "Programme", "Status", "Last active"].map((h) => <th key={h} style={{ padding: "6px 7px", fontSize: 8.5, textTransform: "uppercase", color: "#374151", borderBottom: "1px solid #D1D5DB", whiteSpace: "nowrap" }}>{h}</th>)}</tr></thead>
          <tbody>
            {chosen.map((m, i) => (
              <tr key={m.user_id} style={{ borderBottom: "1px solid #E5E7EB" }}>
                <td style={{ padding: "5px 7px", color: "#9CA3AF" }}>{i + 1}</td>
                <td style={{ padding: "5px 7px", fontWeight: 700, whiteSpace: "nowrap" }}>{m.full_name}</td>
                <td style={{ padding: "5px 7px" }}>{m.email ?? "—"}</td>
                <td style={{ padding: "5px 7px", whiteSpace: "nowrap" }}>{m.country_code ? (countryByCode.get(m.country_code)?.name ?? m.country_code) : "—"}</td>
                <td style={{ padding: "5px 7px", whiteSpace: "nowrap" }}>{m.city ?? "—"}</td>
                <td style={{ padding: "5px 7px", whiteSpace: "nowrap" }}>{m.cell_name ?? "—"}</td>
                <td style={{ padding: "5px 7px" }}>L{m.current_level ?? "—"}</td>
                <td style={{ padding: "5px 7px", whiteSpace: "nowrap" }}>{m.programme ? PROGRAMME_LABELS[m.programme] : "—"}</td>
                <td style={{ padding: "5px 7px" }}>{m.status ? statusMeta[m.status as StatusKey]?.label ?? m.status : "—"}</td>
                <td style={{ padding: "5px 7px", whiteSpace: "nowrap" }}>{relTime(m.last_activity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16, fontSize: 10, color: "#9CA3AF", textAlign: "center" }}>Confidential · Nuru Pathway discipleship records</div>
      </div>
    </>
  );
}

// ---- Member results dossier (levels/modules scores, exams, badges, certificates) ----
function pctLabel(n: number | null): string { return n == null ? "—" : `${Math.round(n)}%`; }
function scoreColor(n: number | null): string { return n == null ? "var(--muted-foreground)" : n >= 70 ? "#16A34A" : n > 0 ? "#A87616" : "#DC2626"; }

function LevelResultCard({ lv }: { lv: MemberResultLevel }): ReactElement {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="px-4 py-3 flex items-center justify-between gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <BookOpen size={15} style={{ color: "var(--nuru-gold)" }} />
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Level {lv.level_number} — {lv.title}</span>
            {lv.completed ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 shrink-0" style={{ background: "#E8F6EC", color: "#16A34A", fontSize: 10, fontWeight: 700 }}>Complete</span> : null}
          </div>
          <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 3, marginLeft: 23 }}>
            Modules avg {pctLabel(lv.module_average)}{lv.exam ? ` · Exam ${pctLabel(lv.exam.score)}` : " · Exam —"}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div style={{ fontSize: 17, fontWeight: 800, color: scoreColor(lv.level_score) }}>{pctLabel(lv.level_score)}</div>
          <div style={{ fontSize: 9, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.4 }}>Level overall</div>
        </div>
      </div>
      <div className="px-4 py-1.5 flex flex-col">
        {lv.modules.length === 0 ? <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>No published modules.</p> : lv.modules.map((m) => (
          <div key={m.module_id} className="flex items-center gap-3 py-2" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="shrink-0" title={m.completed ? "Completed" : m.attempts > 0 ? "Attempted" : "Not started"} style={{ width: 8, height: 8, borderRadius: 99, background: m.completed ? "#16A34A" : m.attempts > 0 ? "#A87616" : "#D1D5DB" }} />
            <span className="shrink-0" style={{ fontSize: 11, color: "var(--muted-foreground)", width: 26 }}>M{m.sequence}</span>
            <span className="flex-1 min-w-0" style={{ fontSize: 12.5, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
            <span className="shrink-0" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{m.attempts > 0 ? `${m.attempts} try${m.attempts > 1 ? "s" : ""}` : ""}</span>
            <span className="shrink-0" style={{ fontSize: 13, fontWeight: 700, color: scoreColor(m.best_score), width: 46, textAlign: "right" }}>{pctLabel(m.best_score)}</span>
          </div>
        ))}
        {lv.exam ? (
          <div className="flex items-center gap-3 py-2" style={{ borderTop: "2px solid var(--border)" }}>
            <Award size={14} style={{ color: "#7C3AED" }} />
            <span className="flex-1" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Level exam{lv.exam.passed ? " · passed" : ""}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: scoreColor(lv.exam.score) }}>{pctLabel(lv.exam.score)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberResultsDrawer({ userId, onClose }: { userId: string; onClose: () => void }): ReactElement {
  const [data, setData] = useState<MemberResults | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void OpsApi.memberResults(userId).then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(errorMessage(e, "Could not load results.")); });
    return () => { live = false; };
  }, [userId]);

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div className="ml-auto flex flex-col" style={{ width: "min(640px,100vw)", background: "var(--background)", height: "100%", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#F5C77E" }}><BarChart3 size={12} /> RESULTS</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, marginTop: 2 }}>{data?.user.full_name ?? "Member results"}</h2>
            </div>
            <button onClick={onClose} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none" }}><X size={16} color="#fff" /></button>
          </div>
          {data ? (
            <div className="grid grid-cols-4 gap-2 mt-4">
              {[
                { label: "Overall", value: pctLabel(data.summary.overall_score) },
                { label: "Modules", value: `${data.summary.modules_completed}/${data.summary.modules_total}` },
                { label: "Levels", value: String(data.summary.levels_completed) },
                { label: "Badges·Certs", value: `${data.summary.badges}·${data.summary.certificates}` },
              ].map((s) => (
                <div key={s.label} className="rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{s.value}</div>
                  <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.4, color: "rgba(255,255,255,0.6)", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">
          {error ? <p style={{ color: "#DC2626", fontSize: 13 }}>{error}</p> : null}
          {!data && !error ? <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Loading results…</p> : null}
          {data ? (
            <>
              {data.levels.map((lv) => <LevelResultCard key={lv.level_number} lv={lv} />)}
              <Section title="Badges attained">
                {data.badges.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No badges yet.</p> : (
                  <div className="flex flex-wrap gap-2">{data.badges.map((b) => <span key={b.code} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: "#FFF6E0", color: "#A87616", fontSize: 12, fontWeight: 700, border: "1px solid #F5E0A8" }}><Star size={12} /> {b.name}</span>)}</div>
                )}
              </Section>
              <Section title="Certificates earned">
                {data.certificates.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No certificates yet.</p> : (
                  <div className="flex flex-col gap-2">{data.certificates.map((c) => (
                    <div key={c.verification_code} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <Award size={18} style={{ color: "#7C3AED" }} />
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Level {c.level_number}{c.level_title ? ` — ${c.level_title}` : ""}</div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Issued {new Date(c.issued_at).toLocaleDateString()} · {c.verification_code}</div>
                      </div>
                    </div>
                  ))}</div>
                )}
              </Section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Pathway placement — pick the level the member is on + the module they've reached.
// Setting Level X · Module Y unlocks every earlier level in full, plus Level X up to
// and including module Y (server gating honours start_level + start_module_sequence).
function PlacementFields({ level, module, onLevel, onModule }: { level: string; module: string; onLevel: (v: string) => void; onModule: (v: string) => void }): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  useEffect(() => { void CurriculumApi.levels().then(setLevels).catch(() => setLevels([])); }, []);
  useEffect(() => {
    const n = Number(level);
    if (!n) { setModules([]); return; }
    let live = true;
    void CurriculumApi.modules(n).then((m) => { if (live) setModules(m); }).catch(() => { if (live) setModules([]); });
    return () => { live = false; };
  }, [level]);
  // Keep the module selection valid for the chosen level.
  useEffect(() => {
    if (modules.length && !modules.some((m) => String(m.module_sequence_number) === module)) {
      onModule(String(modules[0]?.module_sequence_number ?? 1));
    }
  }, [modules, module, onModule]);
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Current level">
          <select value={level} onChange={(e) => onLevel(e.target.value)} style={inputS}>
            {levels.length === 0 ? <option value={level}>Level {level}</option> : levels.map((l) => <option key={l.level_number} value={String(l.level_number)}>Level {l.level_number} — {l.title}</option>)}
          </select>
        </Field>
        <Field label="Module reached">
          <select value={module} onChange={(e) => onModule(e.target.value)} style={inputS}>
            {modules.length === 0 ? <option value={module}>Module {module}</option> : modules.map((m) => <option key={m.module_sequence_number} value={String(m.module_sequence_number)}>Module {m.module_sequence_number} — {m.title}</option>)}
          </select>
        </Field>
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: -8 }}>Unlocks every earlier level in full, plus this level up to the selected module, in the member's app.</p>
    </>
  );
}

const inputS = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 12px", color: "var(--foreground)", outline: "none" } as const;
function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }): ReactElement {
  return <div><label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 }}>{label}{required ? <span style={{ color: "#DC2626", marginLeft: 3 }}>*</span> : null}</label>{children}</div>;
}
function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2"><span style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-navy)", textTransform: "uppercase", letterSpacing: 0.8 }}>{title}</span><div style={{ flex: 1, height: 1, background: "var(--border)" }} /></div>
      {children}
    </div>
  );
}
