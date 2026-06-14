// Reflection Queue — rebuilt to the new "Final Pathway Portal" make: navy hero
// with live stats, a filter bar, and a split queue-list + review-workspace. Wired
// to the live pastoral-review API (OpsApi.reflections / decideReflection /
// reflectionHistory) plus the member-detail aggregate for the growth panel.
// Module-reflection submissions only — personal devotional reflections/prayers
// stay private (§5.4). The reflection text shown here is the submission under
// review, which is the pastoral-review path's purpose.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight, Clock, MessageSquare, Quote, Search, Sparkles,
  CheckCircle2, History, X, Filter, BookOpen, Calendar, ArrowUpRight, Award, ShieldAlert,
} from "lucide-react";
import { OpsApi, type ReflectionRow, type ReflectionState, type ReflectionHistoryRow, type MemberDetail } from "../../api/client";
import { errorMessage } from "../../util/error";

const STATE_TABS: { key: ReflectionState; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "returned", label: "Returned" },
  { key: "deferred", label: "Deferred" },
  { key: "approved", label: "Approved" },
];
const STATUS_FILTERS = ["All", "Oldest", "New", "Needs attention"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const PALETTE = { gold: "#C89B3C", navy: "#0B1F33", green: "#16A34A" };
const bandStyle: Record<string, { bg: string; fg: string }> = {
  thriving: { bg: "#E8F6EE", fg: "#0F6B33" }, steady: { bg: "#FDF5E5", fg: "#8A6B1F" },
  watch: { bg: "#FDF0E6", fg: "#C2410C" }, at_risk: { bg: "#FDECEC", fg: "#A8281F" },
};
const stateChip: Record<string, { bg: string; color: string }> = {
  pending: { bg: "#FFFBEB", color: "#A87616" }, returned: { bg: "#EEF1F8", color: "#1F3A6B" },
  deferred: { bg: "#F3E8FF", color: "#7E22CE" }, approved: { bg: "#E8F6EC", color: "#0F6B33" }, rejected: { bg: "#FDECEC", color: "#A8281F" },
};
const initials = (n: string): string => n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const ageDays = (iso: string): number => { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86400000); };
const priorityOf = (r: ReflectionRow): StatusFilter => (r.overdue ? "Needs attention" : ageDays(r.submitted_at) >= 4 ? "Oldest" : "New");
const priChip: Record<StatusFilter, { bg: string; fg: string; dot: string }> = {
  All: { bg: "#fff", fg: "#000", dot: "#000" },
  Oldest: { bg: "#FDF5E5", fg: "#8A6B1F", dot: "#C89B3C" },
  New: { bg: "#EEF1F8", fg: "#1F3A6B", dot: "#1F3A6B" },
  "Needs attention": { bg: "#FDECEC", fg: "#A8281F", dot: "#DC2626" },
};

function InlineMetric({ label, value, pct, color }: { label: string; value: string; pct: number; color: string }): ReactElement {
  return (
    <div style={{ minWidth: 92 }}>
      <div className="flex items-baseline justify-between" style={{ gap: 6 }}>
        <span style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "#EEF0F3", borderRadius: 999, overflow: "hidden", marginTop: 4 }}><div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: color }} /></div>
    </div>
  );
}

export function ReflectionQueue(): ReactElement {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ReflectionState>("pending");
  const [rows, setRows] = useState<ReflectionRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("All levels");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sort, setSort] = useState<"oldest" | "newest">("oldest");
  const [feedback, setFeedback] = useState("");
  const [pastoral, setPastoral] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ReflectionHistoryRow[]>([]);

  const load = useCallback(async () => {
    try { const data = await OpsApi.reflections({ state: tab }); setRows(data); setSelId((cur) => (data.some((r) => r.reflection_id === cur) ? cur : data[0]?.reflection_id ?? null)); }
    catch (e) { setError(errorMessage(e, "Could not load the reflection queue.")); }
  }, [tab]);
  useEffect(() => { void load(); }, [load]);

  const levelOptions = useMemo(() => ["All levels", ...Array.from(new Set(rows.map((r) => `L${r.level_number - 1} → L${r.level_number}`)))], [rows]);

  const filtered = useMemo(() => {
    let list = rows.slice();
    if (search.trim()) list = list.filter((r) => r.full_name.toLowerCase().includes(search.toLowerCase()));
    if (levelFilter !== "All levels") list = list.filter((r) => `L${r.level_number - 1} → L${r.level_number}` === levelFilter);
    if (statusFilter !== "All") list = list.filter((r) => priorityOf(r) === statusFilter);
    list.sort((a, b) => (sort === "oldest" ? ageDays(b.submitted_at) - ageDays(a.submitted_at) : ageDays(a.submitted_at) - ageDays(b.submitted_at)));
    return list;
  }, [rows, search, levelFilter, statusFilter, sort]);

  const current = useMemo(() => filtered.find((r) => r.reflection_id === selId) ?? filtered[0] ?? null, [filtered, selId]);

  useEffect(() => {
    setMember(null);
    if (!current) return;
    let live = true;
    OpsApi.memberDetail(current.user_id).then((m) => { if (live) setMember(m); }).catch(() => { /* non-fatal */ });
    return () => { live = false; };
  }, [current?.user_id]);

  useEffect(() => { setFeedback(""); setPastoral(""); setError(null); }, [selId]);

  const pending = rows.filter((r) => r.state === "pending");
  const oldest = pending.reduce((m, r) => Math.max(m, ageDays(r.submitted_at)), 0);
  const overdueCount = rows.filter((r) => r.overdue).length;
  const avgAge = pending.length ? (pending.reduce((s, r) => s + ageDays(r.submitted_at), 0) / pending.length).toFixed(1) : "0";

  async function decide(decision: "approve" | "return" | "defer"): Promise<void> {
    if (!current) return;
    if (decision === "return" && feedback.trim().length < 10) { setError("Feedback is required to return a reflection (at least 10 characters)."); return; }
    setBusy(true); setError(null);
    try {
      await OpsApi.decideReflection(current.reflection_id, {
        decision,
        ...(feedback.trim() ? { feedback_notes: feedback.trim() } : {}),
        ...(pastoral.trim() ? { pastoral_note: pastoral.trim() } : {}),
      });
      setNotice(decision === "approve" ? `${current.full_name} approved & advanced.` : decision === "return" ? `Returned to ${current.full_name} with feedback.` : `Deferred ${current.full_name}'s review.`);
      await load();
    } catch (e) { setError(errorMessage(e, "Decision failed.")); } finally { setBusy(false); }
  }

  async function openHistory(): Promise<void> {
    if (!current) return;
    setHistoryOpen(true);
    try { setHistory(await OpsApi.reflectionHistory(current.reflection_id)); } catch { setHistory([]); }
  }

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(115deg, #0B2545 0%, #123057 55%, #173A63 100%)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ padding: "24px clamp(16px,4vw,48px) 24px" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(226,234,246,0.6)" }}><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Reflection Queue</span></div>
          <div className="flex items-end justify-between gap-4 flex-wrap" style={{ marginTop: 12 }}>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>Reflection Queue</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3" style={{ height: 26, background: "rgba(245,199,126,0.16)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.3)" }}><Sparkles size={11} /> {pending.length} pending</span>
              </div>
              <p style={{ fontSize: 13, color: "rgba(226,234,246,0.66)", marginTop: 6, maxWidth: 520, lineHeight: 1.5 }}>Review member reflections, encourage growth, and advance disciples through the pathway.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setSort((s) => (s === "oldest" ? "newest" : "oldest"))} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 36, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)", fontSize: 12.5, fontWeight: 600 }}><Filter size={14} /> {sort === "oldest" ? "Oldest first" : "Newest first"}</button>
              <button onClick={() => void openHistory()} disabled={!current} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 36, background: "#fff", color: "#0B1F33", fontSize: 12.5, fontWeight: 600, border: "none", opacity: current ? 1 : 0.5 }}><History size={14} /> Review history</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px clamp(16px,4vw,48px) 40px" }}>
        {notice && <div className="rounded-xl mb-4" style={{ padding: "10px 14px", background: "#E8F6EE", color: "#0F6B33", fontSize: 13, fontWeight: 600 }}>{notice}</div>}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Pending review", value: String(pending.length), Icon: MessageSquare, tint: "#FDECEC", tone: "#A8281F" },
            { label: "Oldest waiting", value: `${oldest}d`, sub: `avg ${avgAge}d`, Icon: Clock, tint: "#FDF5E5", tone: "#8A6B1F" },
            { label: "Needs attention", value: String(overdueCount), Icon: ShieldAlert, tint: "#FDF0E6", tone: "#C2410C" },
            { label: "In view", value: String(rows.length), Icon: CheckCircle2, tint: "#E8F6EE", tone: "#0F6B33" },
          ].map((k) => {
            const Icon = k.Icon;
            return (
              <div key={k.label} className="rounded-2xl flex items-center gap-3" style={{ background: "#fff", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 42, background: k.tint, color: k.tone }}><Icon size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{k.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1, marginTop: 2 }}>{k.value}{k.sub && <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 500, marginLeft: 6 }}>{k.sub}</span>}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* State tabs */}
        <div className="flex items-center gap-1 mb-5 rounded-xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: 4, width: "fit-content" }}>
          {STATE_TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)} className="rounded-lg px-3.5 py-1.5" style={{ fontSize: 12.5, fontWeight: 600, background: tab === t.key ? "var(--nuru-navy)" : "transparent", color: tab === t.key ? "#fff" : "var(--muted-foreground)", border: "none" }}>{t.label}</button>
          ))}
        </div>

        {error && <div className="rounded-xl mb-4" style={{ padding: "10px 14px", background: "#FDECEC", color: "#A8281F", fontSize: 13, fontWeight: 600 }}>{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Queue list */}
          <aside className="lg:col-span-5 xl:col-span-4 rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)", alignSelf: "start" }}>
            <div className="px-4 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center justify-between mb-1">
                <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--nuru-navy)", textTransform: "capitalize" }}>{tab} reflections</span>
                <span className="rounded-full px-2 py-0.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{filtered.length}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 12 }}>{sort === "oldest" ? "Oldest submissions appear first" : "Newest submissions appear first"}</div>
              <div className="relative mb-2">
                <Search size={13} className="absolute" style={{ left: 10, top: 9, color: "var(--muted-foreground)" }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search member" className="w-full rounded-xl pl-8 pr-3 py-2 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 12 }} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className="rounded-xl px-2 py-2 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 11 }}>{levelOptions.map((l) => <option key={l}>{l}</option>)}</select>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} className="rounded-xl px-2 py-2 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 11 }}>{STATUS_FILTERS.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            <div style={{ maxHeight: 720, overflowY: "auto" }}>
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center text-center" style={{ padding: 32 }}>
                  <div className="rounded-2xl flex items-center justify-center mb-4" style={{ width: 56, height: 56, background: "#F5E7C5", color: "#92651B" }}><BookOpen size={24} /></div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--nuru-navy)", marginBottom: 6 }}>Queue is clear — well shepherded</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.6 }}>No {tab} reflections match these filters.</div>
                </div>
              ) : filtered.map((r) => {
                const sel = current?.reflection_id === r.reflection_id;
                const pri = priorityOf(r);
                const ps = priChip[pri];
                const days = ageDays(r.submitted_at);
                return (
                  <button key={r.reflection_id} onClick={() => setSelId(r.reflection_id)} className="w-full text-left" style={{ background: sel ? "#FFFBEB" : "transparent", borderBottom: "1px solid var(--border)", borderLeft: sel ? "3px solid var(--nuru-gold)" : "3px solid transparent", padding: "14px 16px" }}>
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700 }}>{initials(r.full_name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center justify-between gap-2">
                          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{r.full_name}</span>
                          {tab === "pending" && <span className="rounded-full px-2 py-0.5 flex items-center gap-1" style={{ background: ps.bg, color: ps.fg, fontSize: 10, fontWeight: 700 }}><span className="rounded-full" style={{ width: 5, height: 5, background: ps.dot }} />{pri}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>L{r.level_number - 1} → <span style={{ color: "var(--nuru-gold)", fontWeight: 700 }}>L{r.level_number}</span> · {r.module_title}</div>
                        <div style={{ fontSize: 12, color: "var(--foreground)", marginTop: 6, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.body.split("\n")[0]}</div>
                        <div className="flex items-center gap-1.5 mt-2">
                          <Clock size={10} style={{ color: days >= 4 ? "#DC2626" : "var(--muted-foreground)" }} />
                          <span style={{ fontSize: 10, color: days >= 4 ? "#DC2626" : "var(--muted-foreground)" }}>{days === 0 ? "Today" : `${days}d ago`}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Workspace */}
          <main className="lg:col-span-7 xl:col-span-8" style={{ minWidth: 0 }}>
            {current ? (
              <>
                <div className="rounded-2xl p-4 mb-4 flex items-center gap-3 flex-wrap" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                  <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 44, height: 44, background: "linear-gradient(135deg,#0B1F33,#16324F)", color: "#fff", fontFamily: "var(--font-display)", fontSize: 17 }}>{initials(current.full_name)}</div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span onClick={() => navigate(`/member-profile?id=${current.user_id}`)} style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--nuru-navy)", lineHeight: 1.1, cursor: "pointer" }}>{current.full_name}</span>
                      {member?.is_minor && <span className="rounded-full px-2 py-0.5" style={{ background: "rgba(245,158,11,0.18)", color: "#A87616", fontSize: 10, fontWeight: 700 }}>MINOR</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{current.module_title} · {fmtDate(current.submitted_at)}{member?.cell_name ? ` · ${member.cell_name}` : ""}</div>
                  </div>
                  <div className="ml-auto flex items-center gap-2 flex-wrap">
                    <span className="rounded-full px-2.5 py-0.5" style={{ background: "#F5E7C5", color: "#92651B", fontSize: 10.5, fontWeight: 700 }}>L{current.level_number - 1} → L{current.level_number}</span>
                    <span className="rounded-full px-2.5 py-0.5" style={{ background: stateChip[current.state]?.bg ?? "#eee", color: stateChip[current.state]?.color ?? "#555", fontSize: 10.5, fontWeight: 700, textTransform: "capitalize" }}>{current.state}</span>
                    <button onClick={() => void openHistory()} style={{ fontSize: 11, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none" }}>History →</button>
                  </div>
                </div>

                {/* Member growth (real, from member-detail) */}
                <div className="rounded-xl p-3 mb-5 flex items-center gap-4 flex-wrap" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                  {member ? (
                    <>
                      {member.engagement.band && <span className="rounded-full px-2.5 py-0.5" style={{ background: bandStyle[member.engagement.band]?.bg ?? "#eee", color: bandStyle[member.engagement.band]?.fg ?? "#555", fontSize: 10.5, fontWeight: 700, textTransform: "capitalize" }}>{member.engagement.band.replace("_", " ")}</span>}
                      <InlineMetric label="Curriculum" value={`${member.metrics.curriculum_pct}%`} pct={member.metrics.curriculum_pct} color={PALETTE.gold} />
                      <InlineMetric label="Attendance" value={`${member.metrics.attendance_pct}%`} pct={member.metrics.attendance_pct} color={PALETTE.navy} />
                      <InlineMetric label="Habits" value={`${member.metrics.habits_pct}%`} pct={member.metrics.habits_pct} color={PALETTE.green} />
                      <button onClick={() => navigate(`/member-profile?id=${current.user_id}`)} className="ml-auto flex items-center gap-1" style={{ fontSize: 11, color: PALETTE.gold, fontWeight: 700, background: "none", border: "none" }}>Full profile <ArrowUpRight size={11} /></button>
                    </>
                  ) : <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Loading member growth…</span>}
                </div>

                {/* Reflection content */}
                <div className="rounded-2xl mb-5 overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                  <div className="px-6 py-3.5 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2">
                      <div className="rounded-md flex items-center justify-center" style={{ width: 24, height: 24, background: "var(--nuru-navy)", color: "#fff" }}><Quote size={12} /></div>
                      <div><div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--nuru-navy)", lineHeight: 1 }}>Member reflection</div><div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>Submitted response for review</div></div>
                    </div>
                    <span style={{ fontSize: 10, color: "var(--muted-foreground)" }}>{current.body.trim().split(/\s+/).length} words</span>
                  </div>
                  <div style={{ padding: "28px clamp(16px,4vw,40px) 32px" }}>
                    <div style={{ maxWidth: 640, margin: "0 auto" }}>
                      {current.body.split("\n").filter(Boolean).map((para, i) => (
                        <p key={i} style={{ fontFamily: "var(--font-display)", fontSize: 15.5, color: "var(--foreground)", lineHeight: 1.85, marginBottom: 14, textIndent: i === 0 ? 0 : 18 }}>{para}</p>
                      ))}
                      <div className="flex items-center gap-3 mt-2">
                        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                        <span style={{ fontSize: 9.5, color: "var(--muted-foreground)" }}>— {current.full_name}</span>
                        <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
                      </div>
                    </div>
                  </div>
                </div>

                {current.state === "pending" ? (
                  <div className="rounded-2xl p-6" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                    <div className="mb-4"><div style={{ fontFamily: "var(--font-display)", fontSize: 17, color: "var(--nuru-navy)" }}>Decision</div><div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>Choose whether this reflection shows readiness to advance.</div></div>
                    <div className="mb-4">
                      <label style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>Feedback to member</label>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>Required when returning a reflection. Optional when approving.</div>
                      <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} placeholder="Write clear, kind feedback. Mention what was strong and what needs more reflection." className="w-full rounded-xl px-4 py-3 outline-none resize-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 14, lineHeight: 1.6 }} />
                    </div>
                    <div className="mb-5">
                      <label style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>Reviewer note</label>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 8 }}>Private to authorized leaders — never sent to the member (§5.4).</div>
                      <textarea value={pastoral} onChange={(e) => setPastoral(e.target.value)} rows={2} placeholder="Add a private note for the review record…" className="w-full rounded-xl px-4 py-3 outline-none resize-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 14, lineHeight: 1.6 }} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                      <button onClick={() => void decide("approve")} disabled={busy} className="rounded-2xl p-5 text-left" style={{ background: "#E8F6EC", border: "1px solid #BBE5C5", opacity: busy ? 0.6 : 1 }}>
                        <div className="flex items-center gap-2 mb-2"><div className="rounded-lg flex items-center justify-center" style={{ width: 32, height: 32, background: "#16A34A", color: "#fff" }}><CheckCircle2 size={16} /></div><span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "#15803D" }}>Approve & Advance</span></div>
                        <div style={{ fontSize: 12, color: "#15803D", lineHeight: 1.55 }}>Advance the member to the next level and notify them.</div>
                      </button>
                      <button onClick={() => void decide("return")} disabled={busy} className="rounded-2xl p-5 text-left" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8", opacity: busy ? 0.6 : 1 }}>
                        <div className="flex items-center gap-2 mb-2"><div className="rounded-lg flex items-center justify-center" style={{ width: 32, height: 32, background: "#C89B3C", color: "#fff" }}><MessageSquare size={16} /></div><span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "#92651B" }}>Return for Revision</span></div>
                        <div style={{ fontSize: 12, color: "#92651B", lineHeight: 1.55 }}>Send kind feedback and allow the member to revise and resubmit.</div>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                      <button onClick={() => void decide("defer")} disabled={busy} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "1px solid var(--border)" }}><Calendar size={14} /> Defer review</button>
                      <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontStyle: "italic" }}>“Shepherd the flock of God that is among you…” — 1 Peter 5:2</span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl p-5" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                    <div className="flex items-center gap-2"><Award size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", textTransform: "capitalize" }}>{current.state}</span>{current.reviewed_at && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>· {fmtDate(current.reviewed_at)}</span>}</div>
                    <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 6 }}>This reflection has been reviewed. Switch to the Pending tab to action new submissions.</p>
                  </div>
                )}
              </>
            ) : (
              <div className="rounded-2xl flex flex-col items-center justify-center text-center" style={{ padding: 64, background: "#fff", border: "1px solid var(--border)" }}>
                <div className="rounded-2xl flex items-center justify-center mb-5" style={{ width: 72, height: 72, background: "#F5E7C5", color: "#92651B" }}><BookOpen size={32} /></div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", marginBottom: 8 }}>Queue is clear — well shepherded</h2>
                <p style={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 420, lineHeight: 1.6 }}>No {tab} reflections to review right now.</p>
              </div>
            )}
          </main>
        </div>
      </div>

      {/* History drawer */}
      {historyOpen && (
        <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={() => setHistoryOpen(false)}>
          <div className="ml-auto flex flex-col" style={{ width: "min(460px, 100vw)", height: "100%", background: "var(--card)", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
              <div className="flex items-center gap-2"><History size={15} style={{ color: "var(--nuru-gold)" }} /><h2 style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Review history</h2></div>
              <button onClick={() => setHistoryOpen(false)} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none" }}><X size={16} color="#fff" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {history.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: 16 }}>No recorded decisions yet.</p> : history.map((h) => (
                <div key={h.audit_id} className="flex items-start gap-3 py-3" style={{ borderBottom: "1px dashed var(--border)" }}>
                  <span className="rounded-full shrink-0" style={{ width: 8, height: 8, marginTop: 5, background: h.action.includes("approve") ? PALETTE.green : h.action.includes("return") ? PALETTE.gold : PALETTE.navy }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", textTransform: "capitalize" }}>{h.action.replace("reflection.", "Reflection ").replace(/[._]/g, " ")}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>{h.actor_name ?? "System"} · {fmtDate(h.occurred_at)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
