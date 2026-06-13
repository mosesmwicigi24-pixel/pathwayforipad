// Reflection Queue — rebuilt to the "Final Pathway Portal" make, wired to the live
// pastoral-review API (OpsApi.reflections + decideReflection). Module-reflection
// submissions only (personal devotional reflections/prayers stay private, §5.4).
// Queue list by state + overdue, a detail panel with the submission, and
// approve / return / defer with feedback + pastoral notes.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, Clock, MessageSquare, Quote, Search, Sparkles, UserCircle2, Check, RefreshCw, AlertCircle, CheckCircle2 } from "lucide-react";
import { OpsApi, type ReflectionRow, type ReflectionState } from "../../api/client";
import { errorMessage } from "../../util/error";

const STATE_TABS: { key: ReflectionState; label: string }[] = [
  { key: "pending", label: "Pending" },
  { key: "returned", label: "Returned" },
  { key: "deferred", label: "Deferred" },
  { key: "approved", label: "Approved" },
];
const stateChip: Record<string, { bg: string; color: string }> = {
  pending: { bg: "#FDF5E5", color: "#8A6B1F" },
  returned: { bg: "#EEF1F8", color: "#1F3A6B" },
  deferred: { bg: "#F3E8FF", color: "#7E22CE" },
  approved: { bg: "#E8F6EC", color: "#0F6B33" },
  rejected: { bg: "#FDECEC", color: "#A8281F" },
};
const initials = (n: string): string => n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const ageDays = (iso: string): number => { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86400000); };

export function ReflectionQueue(): ReactElement {
  const [tab, setTab] = useState<ReflectionState>("pending");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [rows, setRows] = useState<ReflectionRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");
  const [pastoral, setPastoral] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q: { state?: ReflectionState; overdue?: boolean } = { state: tab };
      if (overdueOnly) q.overdue = true;
      const data = await OpsApi.reflections(q);
      setRows(data);
      setSelId((cur) => (data.some((r) => r.reflection_id === cur) ? cur : data[0]?.reflection_id ?? null));
    } catch (e) { setError(errorMessage(e, "Could not load the reflection queue.")); }
  }, [tab, overdueOnly]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setFeedback(""); setPastoral(""); }, [selId]);

  const filtered = useMemo(() => rows.filter((r) => !query.trim() || `${r.full_name} ${r.module_title}`.toLowerCase().includes(query.toLowerCase())), [rows, query]);
  const sel = rows.find((r) => r.reflection_id === selId) ?? null;
  const overdueCount = rows.filter((r) => r.overdue).length;

  async function decide(decision: "approve" | "return" | "defer"): Promise<void> {
    if (!sel) return;
    setBusy(true); setNotice(null); setError(null);
    try {
      const body: { decision: "approve" | "return" | "defer"; feedback_notes?: string; pastoral_note?: string } = { decision };
      if (feedback.trim()) body.feedback_notes = feedback.trim();
      if (pastoral.trim()) body.pastoral_note = pastoral.trim();
      await OpsApi.decideReflection(sel.reflection_id, body);
      setNotice(decision === "approve" ? "Reflection approved." : decision === "return" ? "Returned to the member." : "Deferred.");
      await load();
    } catch (e) { setError(errorMessage(e, "Could not record the decision.")); }
    finally { setBusy(false); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Nuru Pathway</span><ChevronRight size={10} /><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Reflection Queue</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> Pastoral review</span>
            <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>Reflection Queue</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: STATE_TABS.find((t) => t.key === tab)?.label ?? "Pending", value: String(rows.length), hint: "in this view" },
            { label: "Overdue", value: String(overdueCount), hint: ">3 days waiting" },
            { label: "Filter", value: overdueOnly ? "Overdue" : "All", hint: "toggle below" },
            { label: "Selected", value: sel ? "1" : "0", hint: "open in panel" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "20px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="nuru-tabs">{STATE_TABS.map((t) => <button key={t.key} className="nuru-tab" data-active={tab === t.key} onClick={() => setTab(t.key)}>{t.label}</button>)}</div>
          <div className="flex items-center gap-2">
            <button onClick={() => setOverdueOnly((v) => !v)} className="flex items-center gap-1.5 rounded-lg" style={{ height: 36, padding: "0 12px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", background: overdueOnly ? "var(--nuru-navy)" : "var(--card)", color: overdueOnly ? "#fff" : "var(--muted-foreground)" }}><Clock size={13} /> Overdue only</button>
            <div className="flex items-center gap-2 rounded-lg" style={{ height: 36, background: "var(--input-background)", border: "1px solid var(--border)", padding: "0 12px", width: 220 }}><Search size={13} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member or module" className="bg-transparent outline-none flex-1" style={{ fontSize: 12.5 }} /></div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_1.3fr] gap-5">
          {/* Queue list */}
          <div className="flex flex-col gap-2">
            {filtered.map((r) => {
              const sc = stateChip[r.state] ?? stateChip.pending!; const active = r.reflection_id === selId;
              return (
                <button key={r.reflection_id} onClick={() => setSelId(r.reflection_id)} className="text-left rounded-2xl transition-all" style={{ background: "var(--card)", border: active ? "2px solid var(--nuru-gold)" : "1px solid var(--border)", padding: "14px 16px", boxShadow: active ? "0 4px 16px rgba(200,155,60,0.12)" : "none" }}>
                  <div className="flex items-start gap-3">
                    <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 38, height: 38, background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700 }}>{initials(r.full_name)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.full_name}</span>
                        <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color }}>{r.state}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>L{r.level_number} · {r.module_title}</div>
                      <div className="flex items-center gap-2 mt-2" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        <Clock size={10} /> {fmtDate(r.submitted_at)}
                        {r.overdue ? <span className="inline-flex items-center gap-1" style={{ color: "#DC2626", fontWeight: 700 }}><AlertCircle size={10} /> {ageDays(r.submitted_at)}d overdue</span> : null}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 ? <div className="rounded-2xl text-center py-12" style={{ background: "var(--card)", border: "1px dashed var(--border)" }}><MessageSquare size={26} style={{ color: "var(--muted-foreground)", margin: "0 auto 8px", opacity: 0.5 }} /><p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No {tab} reflections{overdueOnly ? " overdue" : ""}.</p></div> : null}
          </div>

          {/* Detail panel */}
          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", alignSelf: "start", position: "sticky", top: 16 }}>
            {!sel ? (
              <div className="flex flex-col items-center justify-center text-center" style={{ padding: "56px 24px", color: "var(--muted-foreground)" }}><UserCircle2 size={32} style={{ opacity: 0.3, marginBottom: 10 }} /><p style={{ fontSize: 14, fontWeight: 600 }}>Select a reflection to review</p></div>
            ) : (
              <div>
                <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 46, height: 46, background: "var(--nuru-navy)", color: "#fff", fontSize: 15, fontWeight: 700 }}>{initials(sel.full_name)}</div>
                    <div>
                      <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.15 }}>{sel.full_name}</h2>
                      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Level {sel.level_number} · {sel.module_title}</p>
                    </div>
                    <span className="rounded-full px-2.5 py-1 ml-auto" style={{ fontSize: 11, fontWeight: 700, ...(stateChip[sel.state] ?? stateChip.pending!) }}>{sel.state}</span>
                  </div>
                  <div className="flex items-center gap-4 mt-3" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                    <span className="inline-flex items-center gap-1"><Clock size={11} /> Submitted {fmtDate(sel.submitted_at)}</span>
                    {sel.overdue ? <span className="inline-flex items-center gap-1" style={{ color: "#DC2626", fontWeight: 700 }}><AlertCircle size={11} /> {ageDays(sel.submitted_at)} days waiting</span> : null}
                  </div>
                </div>
                <div style={{ padding: "20px 22px" }}>
                  <div className="flex items-center gap-2 mb-3"><Quote size={14} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--nuru-navy)", textTransform: "uppercase", letterSpacing: "0.06em" }}>The reflection</span></div>
                  <div style={{ background: "var(--secondary)", borderRadius: 12, padding: "16px 18px", fontSize: 14.5, color: "var(--foreground)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{sel.body || <span style={{ color: "var(--muted-foreground)", fontStyle: "italic" }}>No text submitted.</span>}</div>

                  <div className="mt-5">
                    <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Feedback to the member <span style={{ fontWeight: 400, textTransform: "none" }}>(shown if returned)</span></label>
                    <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} placeholder="Encouragement or what to revisit…" className="w-full outline-none" style={{ borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 12px", color: "var(--foreground)", resize: "vertical", lineHeight: 1.5 }} />
                  </div>
                  <div className="mt-3">
                    <label style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 6 }}>Pastoral note <span style={{ fontWeight: 400, textTransform: "none" }}>(private)</span></label>
                    <textarea value={pastoral} onChange={(e) => setPastoral(e.target.value)} rows={2} placeholder="Internal note for the pastoral team…" className="w-full outline-none" style={{ borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 12px", color: "var(--foreground)", resize: "vertical", lineHeight: 1.5 }} />
                  </div>

                  <div className="flex items-center gap-2 mt-5 flex-wrap">
                    <button onClick={() => void decide("approve")} disabled={busy} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "#0F6B33", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: busy ? 0.6 : 1 }}><CheckCircle2 size={14} /> Approve</button>
                    <button onClick={() => void decide("return")} disabled={busy} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "var(--card)", color: "var(--nuru-navy)", fontSize: 13, fontWeight: 700, border: "1.5px solid var(--border)", opacity: busy ? 0.6 : 1 }}><RefreshCw size={14} /> Return</button>
                    <button onClick={() => void decide("defer")} disabled={busy} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "var(--card)", color: "#7E22CE", fontSize: 13, fontWeight: 700, border: "1.5px solid var(--border)", opacity: busy ? 0.6 : 1 }}><Check size={14} /> Defer</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
