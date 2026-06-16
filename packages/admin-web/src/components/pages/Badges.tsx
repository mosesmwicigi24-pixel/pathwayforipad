// Badges — rebuilt to the "Final Pathway Portal" make, wired to the live badge
// catalog (ConfigApi.badges / createBadge / retireBadge). Medallion grid, summary,
// category/search/sort filters, a detail drawer, a real create modal (criteria
// builder matching the server's registered rules), and retire. Badges are for
// encouragement, not competition — no public leaderboards (pastoral note kept).
import { useCallback, useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Award, BookOpen, ChevronDown, ChevronRight, Users, Flame, HandHeart, Heart,
  Eye, Filter, Plus, Search, ShieldCheck, Sparkles, Star, X, AlertTriangle, type LucideIcon,
} from "lucide-react";
import { ConfigApi, type BadgeRow } from "../../api/client";
import { errorMessage } from "../../util/error";

type Category = BadgeRow["category"];
const CATS: Category[] = ["journey", "consistency", "community", "service"];
const catMeta: Record<Category, { label: string; color: string; bg: string; icon: LucideIcon }> = {
  journey: { label: "Journey", color: "#A87616", bg: "#FFF6E0", icon: BookOpen },
  consistency: { label: "Consistency", color: "#C2410C", bg: "#FDF0E6", icon: Flame },
  community: { label: "Community", color: "#4F46E5", bg: "#EEF0FF", icon: Users },
  service: { label: "Service", color: "#BE185D", bg: "#FCE7F3", icon: HandHeart },
};
function shade(hex: string, amt: number): string { const n = parseInt(hex.replace("#", ""), 16); const c = (v: number) => Math.max(0, Math.min(255, v)); const r = c(((n >> 16) & 255) + amt), g = c(((n >> 8) & 255) + amt), b = c((n & 255) + amt); return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`; }
function sealPath(points: number, cx: number, cy: number, rO: number, rI: number): string { const step = Math.PI / points; let d = ""; for (let i = 0; i < points * 2; i++) { const r = i % 2 === 0 ? rO : rI; const a = i * step - Math.PI / 2; d += (i === 0 ? "M" : "L") + (cx + r * Math.cos(a)).toFixed(2) + "," + (cy + r * Math.sin(a)).toFixed(2); } return d + "Z"; }

function Medallion({ icon: Icon, size = 56, color = "#C89B3C" }: { icon: LucideIcon; size?: number; color?: string }): ReactElement {
  const gid = useId().replace(/:/g, "");
  const light = shade(color, 55), dark = shade(color, -35);
  return (
    <div className="shrink-0" style={{ width: size, height: size, position: "relative" }}>
      <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", filter: "drop-shadow(0 3px 6px rgba(11,31,51,0.18))" }}>
        <defs><linearGradient id={`bg-${gid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={light} /><stop offset="100%" stopColor={dark} /></linearGradient></defs>
        <path d={sealPath(14, 50, 50, 49, 43)} fill={`url(#bg-${gid})`} />
        <circle cx="50" cy="50" r="37" fill={color} /><circle cx="50" cy="50" r="37" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5" /><ellipse cx="50" cy="34" rx="26" ry="13" fill="rgba(255,255,255,0.18)" />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center"><Icon size={Math.round(size * 0.4)} strokeWidth={2} style={{ color: "#fff" }} /></div>
    </div>
  );
}
function Pill({ children, bg, color }: { children: ReactNode; bg: string; color: string }): ReactElement {
  return <span className="inline-flex items-center rounded-full px-2.5 py-0.5" style={{ background: bg, color, fontSize: 11, fontWeight: 700, letterSpacing: 0.2 }}>{children}</span>;
}

export function Badges(): ReactElement {
  const navigate = useNavigate();
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"All" | Category>("All");
  const [sort, setSort] = useState<"Most earned" | "Least earned" | "Name">("Most earned");
  const [detail, setDetail] = useState<BadgeRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setBadges(await ConfigApi.badges()); } catch (e) { setError(errorMessage(e, "Could not load badges.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    let l = badges.filter((b) => (category === "All" || b.category === category) && (!query || `${b.name} ${b.description}`.toLowerCase().includes(query.toLowerCase())));
    if (sort === "Most earned") l = [...l].sort((a, b) => b.earned_count - a.earned_count);
    else if (sort === "Least earned") l = [...l].sort((a, b) => a.earned_count - b.earned_count);
    else l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    return l;
  }, [badges, category, query, sort]);
  const totalAwards = badges.reduce((s, b) => s + b.earned_count, 0);

  async function retire(b: BadgeRow): Promise<void> {
    if (!window.confirm(`Retire "${b.name}"? It stops being awarded (existing earners keep it).`)) return;
    try { await ConfigApi.retireBadge(b.code); setDetail(null); setNotice(`Retired ${b.name}.`); await load(); }
    catch (e) { setError(errorMessage(e, "Could not retire badge.")); }
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100%", padding: "28px clamp(16px,4vw,40px)" }}>
      <div className="rounded-2xl overflow-hidden mb-6" style={{ background: "var(--nuru-dark)" }}>
        <div style={{ padding: "22px 28px 24px" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Admin</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Badges Catalog</span></div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Award size={11} /> {badges.length} badges</span>
              <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> New badge</button>
            </div>
          </div>
        </div>
      </div>

      {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}

      <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-3">
        {[
          { label: "Badges in catalog", value: String(badges.length), color: "#16A34A", bg: "#E8F6EC", icon: Award },
          { label: "Total badge awards", value: totalAwards.toLocaleString(), color: "#A87616", bg: "#FFF6E0", icon: Star },
          { label: "Categories", value: String(new Set(badges.map((b) => b.category)).size), color: "#4F46E5", bg: "#EEF0FF", icon: Sparkles },
        ].map((s) => { const Icon = s.icon; return (
          <div key={s.label} className="rounded-2xl p-5 flex items-center gap-4" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 46, height: 46, background: s.bg, color: s.color }}><Icon size={20} /></div>
            <div className="min-w-0"><div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--foreground)", lineHeight: 1 }}>{s.value}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 5 }}>{s.label}</div></div>
          </div>
        ); })}
      </div>

      <div className="rounded-2xl p-3 mb-6 flex items-center gap-3 flex-wrap" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 flex-1" style={{ background: "var(--input-background)", border: "1px solid var(--border)", minWidth: 260 }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search badges by name or description" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
        <Select value={category === "All" ? "All categories" : catMeta[category].label} onChange={(v) => setCategory(v === "All categories" ? "All" : (CATS.find((c) => catMeta[c].label === v) ?? "All"))} options={["All categories", ...CATS.map((c) => catMeta[c].label)]} label="Category" />
        <Select value={sort} onChange={(v) => setSort(v as typeof sort)} options={["Most earned", "Least earned", "Name"]} label="Sort" leadingIcon={<Filter size={12} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 grid grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((b) => { const cc = catMeta[b.category]; return (
            <div key={b.code} onClick={() => setDetail(b)} className="group rounded-2xl p-4 flex flex-col items-center text-center cursor-pointer transition-all hover:-translate-y-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div className="w-full flex items-center justify-between mb-2"><Pill bg={cc.bg} color={cc.color}>{cc.label}</Pill></div>
              <Medallion icon={cc.icon} size={76} color={cc.color} />
              <div style={{ fontFamily: "var(--font-display)", fontSize: 16.5, color: "var(--foreground)", lineHeight: 1.2, marginTop: 12 }}>{b.name}</div>
              <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 4, lineHeight: 1.4, minHeight: 32 }}>{b.description.length > 64 ? `${b.description.slice(0, 64)}…` : b.description}</p>
              <div className="flex items-center gap-2 mt-3"><span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1" style={{ background: "var(--secondary)", fontSize: 11.5, fontWeight: 700, color: "var(--nuru-navy)" }}><Users size={12} style={{ color: "var(--nuru-gold)" }} /> {b.earned_count}</span></div>
              <div className="flex items-center justify-center gap-1.5 mt-4 pt-3 w-full" style={{ borderTop: "1px solid var(--border)" }}>
                <button onClick={(e) => { e.stopPropagation(); setDetail(b); }} title="View" className="rounded-lg p-2" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Eye size={15} /></button>
                <button onClick={(e) => { e.stopPropagation(); void retire(b); }} title="Retire" className="rounded-lg p-2" style={{ color: "#DC2626", background: "none", border: "none" }}><AlertTriangle size={15} /></button>
              </div>
            </div>
          ); })}
          {filtered.length === 0 && !error ? <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>No badges match.</p> : null}
        </div>

        <div className="flex flex-col gap-5">
          <div className="rounded-2xl p-5" style={{ background: "linear-gradient(180deg, #FFFBEB 0%, #FDF5DA 100%)", border: "1px solid #F5E0A8" }}>
            <div className="flex items-center gap-2 mb-2"><Heart size={16} style={{ color: "#A87616" }} /><span style={{ fontSize: 11, fontWeight: 700, color: "#7A5410", letterSpacing: 0.6, textTransform: "uppercase" }}>Pastoral note</span></div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#0B1F33", lineHeight: 1.25 }}>Badges are for encouragement, not competition.</div>
            <p style={{ fontSize: 13, color: "#7A5410", lineHeight: 1.6, marginTop: 10 }}>They recognise faithfulness, growth and milestones. The system never creates public leaderboards or ranks members against each other.</p>
            <p style={{ fontSize: 12, color: "#7A5410", lineHeight: 1.6, marginTop: 10, fontStyle: "italic" }}>"Let us not become weary in doing good." — Galatians 6:9</p>
          </div>
          <div className="rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-3"><ShieldCheck size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>How awarding works</span></div>
            {[
              { t: "Verified signals only", d: "Badges trigger from server-scored quizzes, verified check-ins and approved reflections." },
              { t: "Registered rules", d: "Criteria use the server's registered rule schema (modules, level, streak, attendance) — no arbitrary expressions." },
              { t: "Retirable", d: "A badge can be retired so it stops being awarded; existing earners keep it." },
            ].map((x) => <div key={x.t} className="py-2.5" style={{ borderTop: "1px solid var(--border)" }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{x.t}</div><div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.5 }}>{x.d}</div></div>)}
          </div>
        </div>
      </div>

      {detail ? (
        <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={() => setDetail(null)}>
          <div className="ml-auto flex flex-col" style={{ width: "min(520px,100vw)", background: "var(--card)", height: "100%", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
              <div className="flex items-start gap-4">
                <Medallion icon={catMeta[detail.category].icon} size={64} color={catMeta[detail.category].color} />
                <div className="flex-1"><div className="mb-1"><Pill bg={catMeta[detail.category].bg} color={catMeta[detail.category].color}>{catMeta[detail.category].label}</Pill></div><div style={{ fontFamily: "var(--font-display)", fontSize: 24, lineHeight: 1.15 }}>{detail.name}</div><div style={{ fontSize: 12, color: "rgba(232,239,245,0.7)", marginTop: 4 }}>{detail.earned_count} earners · code {detail.code}</div></div>
                <button onClick={() => setDetail(null)} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none" }}><X size={16} color="#fff" /></button>
              </div>
            </div>
            <div className="px-6 py-5 flex-1 overflow-y-auto">
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Description</div>
              <p style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6 }}>{detail.description}</p>
              <button onClick={() => navigate("/members")} className="mt-5 flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none" }}>See members <ChevronRight size={13} /></button>
            </div>
            <div className="px-6 py-4 flex items-center justify-end" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => void retire(detail)} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", fontSize: 12, fontWeight: 600 }}><AlertTriangle size={12} /> Retire badge</button>
            </div>
          </div>
        </div>
      ) : null}

      {createOpen ? <CreateModal onClose={() => setCreateOpen(false)} onDone={async (name) => { setCreateOpen(false); setNotice(`Created ${name}.`); await load(); }} onError={setError} /> : null}
    </div>
  );
}

function CreateModal({ onClose, onDone, onError }: { onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [name, setName] = useState(""); const [code, setCode] = useState(""); const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("journey");
  const [kind, setKind] = useState<"module_count" | "level_reached" | "streak_days" | "attendance_count">("module_count");
  const [threshold, setThreshold] = useState("5");
  const [busy, setBusy] = useState(false);
  const codeAuto = code || name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

  function criteria(): Record<string, unknown> {
    const n = Math.max(1, Number(threshold) || 1);
    if (kind === "module_count") return { kind, count: n };
    if (kind === "level_reached") return { kind, level: n };
    if (kind === "streak_days") return { kind, days: n };
    return { kind, count: n }; // attendance_count
  }
  async function submit(): Promise<void> {
    if (!name.trim() || !codeAuto || !description.trim()) { onError("Name, code and description are required."); return; }
    setBusy(true);
    try { await ConfigApi.createBadge({ code: codeAuto, name: name.trim(), description: description.trim(), category, criteria: criteria() }); onDone(name.trim()); }
    catch (e) { onError(errorMessage(e, "Could not create badge.")); }
    finally { setBusy(false); }
  }
  const inp = { width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 12px", color: "var(--foreground)", outline: "none" } as const;
  const thresholdLabel = kind === "level_reached" ? "Reach level" : kind === "streak_days" ? "Streak days" : "Count";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 560, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Sparkles size={12} /> BADGE EDITOR</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Create new badge</h2></div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Badge name" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Faithful Learner" style={inp} /></Field>
            <Field label="Code" required><input value={codeAuto} onChange={(e) => setCode(e.target.value)} placeholder="faithful_learner" style={{ ...inp, fontFamily: "var(--font-mono)" }} /></Field>
          </div>
          <Field label="Category" required>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)} style={inp}>{CATS.map((c) => <option key={c} value={c}>{catMeta[c].label}</option>)}</select>
          </Field>
          <Field label="Description" required><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this badge recognises…" style={{ ...inp, resize: "none", lineHeight: 1.5 }} /></Field>
          <Field label="Award when (registered rule)" required>
            <div className="grid grid-cols-2 gap-3">
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={inp}>
                <option value="module_count">Modules completed</option><option value="level_reached">Level reached</option><option value="streak_days">Habit streak (days)</option><option value="attendance_count">Events attended</option>
              </select>
              <div><div style={{ fontSize: 10, color: "var(--muted-foreground)", marginBottom: 4 }}>{thresholdLabel}</div><input type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={inp} /></div>
            </div>
          </Field>
          <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: "var(--secondary)" }}><Medallion icon={catMeta[category].icon} size={48} color={catMeta[category].color} /><div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{name || "Badge name"}</div><div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{catMeta[category].label} · auto-awarded</div></div></div>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}><Award size={14} /> Create badge</button>
        </div>
      </div>
    </div>
  );
}

function Select({ value, onChange, options, label, leadingIcon }: { value: string; onChange: (v: string) => void; options: readonly string[]; label: string; leadingIcon?: ReactNode }): ReactElement {
  return (
    <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
      {leadingIcon}<span style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{options.map((o) => <option key={o}>{o}</option>)}</select>
      <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} />
    </label>
  );
}
function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }): ReactElement {
  return <div><div className="flex items-center gap-1 mb-1.5"><span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>{required ? <span style={{ color: "#DC2626", fontSize: 11 }}>*</span> : null}</div>{children}</div>;
}
