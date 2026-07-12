// CMS — Curriculum: rebuilt to the "Final Pathway Portal" make, wired to the live
// CMS API. Level pipeline + status report, the pathway track of level cards, a
// recent-activity feed (audit), and a right-hand drawer to inspect a level's
// modules and add new ones. Create/edit levels via LevelModal; status transitions
// (review / publish / lock) and module creation persist through CurriculumApi.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Search, BookOpen, CheckCircle2, ChevronRight, MoreHorizontal,
  ExternalLink, Lock, Unlock, FileText, Video, HelpCircle, Sparkles,
  Users, TrendingUp, Activity, Zap, PenLine,
  Eye, Send, Award, BarChart3, RotateCcw, Pencil, X, Check,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { CurriculumApi, AdminApi, ConfigApi, type AdminLevel, type AdminModuleSummary, type AuditRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { LevelModal, type LevelFormData, type LevelStatus } from "../curriculum/LevelModal";

type Status = "Published" | "Draft" | "In Review" | "Archived";
const statusStyle: Record<Status, { bg: string; color: string }> = {
  Published: { bg: "#E8F6EE", color: "#0F6B33" },
  Draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  "In Review": { bg: "#FDF5E5", color: "#8A6B1F" },
  Archived: { bg: "#FDECEC", color: "#A8281F" },
};
const beToLabel: Record<string, Status> = { published: "Published", draft: "Draft", in_review: "In Review", archived: "Archived" };
const labelToBe: Record<LevelStatus, string> = { Published: "published", Draft: "draft", "In Review": "in_review" };

interface UiLevel {
  number: number; title: string; theme: string; passMark: number; modules: number;
  completedModules: number; learners: number; duration: string; status: Status; locked: boolean; color: string;
}

function TypeIcon({ kind }: { kind: string }): ReactElement {
  if (kind === "quiz" || kind === "exit_exam") return <HelpCircle size={13} style={{ color: "#5B2BB8" }} />;
  if (kind === "reflection") return <Video size={13} style={{ color: "#8A6B1F" }} />;
  return <FileText size={13} style={{ color: "var(--nuru-navy)" }} />;
}
const relTime = (iso: string): string => {
  const t = new Date(iso).getTime(); if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000); if (m < 60) return `${Math.max(1, m)} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); return d === 1 ? "Yesterday" : `${d} days ago`;
};
const humanize = (a: string): string => { const s = a.replace(/[._]/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function CmsCurriculum(): ReactElement {
  const navigate = useNavigate();
  const [levels, setLevels] = useState<UiLevel[]>([]);
  const [search, setSearch] = useState("");
  const [selectedNo, setSelectedNo] = useState<number | null>(null);
  const [filterStatus, setFilterStatus] = useState<"All" | Status>("All");
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [modalMode, setModalMode] = useState<{ type: "add" } | { type: "edit"; level: UiLevel } | null>(null);
  const [saving, setSaving] = useState(false);
  const [addingModule, setAddingModule] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<"text" | "video" | "quiz">("text");
  const [error, setError] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    try {
      const [ls, report] = await Promise.all([CurriculumApi.levels(), AdminApi.levelsReport().catch(() => ({ levels: [], trend: [] }))]);
      const learnersByLevel = new Map<number, number>(report.levels.map((r) => [r.level_number, r.learners]));
      const ui: UiLevel[] = ls.map((l: AdminLevel) => ({
        number: l.level_number,
        title: l.title,
        theme: l.theme ?? "",
        passMark: Math.round(Number(l.required_exam_pass_mark) || 0),
        modules: Number(l.published_count) + Number(l.draft_count) + Number(l.archived_count),
        completedModules: Number(l.published_count),
        learners: learnersByLevel.get(l.level_number) ?? 0,
        duration: l.duration ?? "—",
        status: beToLabel[l.status] ?? "Draft",
        locked: l.locked,
        color: l.color,
      }));
      setLevels(ui);
      setSelectedNo((cur) => (cur != null && ui.some((l) => l.number === cur) ? cur : ui[0]?.number ?? null));
    } catch (e) { setError(errorMessage(e, "Could not load levels.")); }
  }, []);

  useEffect(() => { void loadLevels(); }, [loadLevels]);
  useEffect(() => { void ConfigApi.audit({}).then((r) => setActivity(r.data.slice(0, 5))).catch(() => {}); }, []);
  useEffect(() => {
    if (selectedNo == null) { setModules([]); return; }
    void CurriculumApi.modules(selectedNo).then(setModules).catch(() => setModules([]));
  }, [selectedNo]);

  const selected = levels.find((l) => l.number === selectedNo) ?? null;

  async function handleSaveLevel(data: LevelFormData): Promise<void> {
    setSaving(true); setError(null);
    const body = { title: data.title, theme: data.theme, required_exam_pass_mark: data.passMark, duration: data.duration, status: labelToBe[data.status], locked: data.locked, color: data.color };
    try {
      if (modalMode?.type === "add") await CurriculumApi.createLevel(body);
      else if (modalMode?.type === "edit") await CurriculumApi.updateLevel(modalMode.level.number, body);
      setModalMode(null);
      await loadLevels();
    } catch (e) { setError(errorMessage(e, "Save failed.")); }
    finally { setSaving(false); }
  }
  async function setLevelStatus(n: number, status: LevelStatus): Promise<void> {
    try { await CurriculumApi.updateLevel(n, { status: labelToBe[status] }); await loadLevels(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }
  async function toggleLock(l: UiLevel): Promise<void> {
    try { await CurriculumApi.updateLevel(l.number, { locked: !l.locked }); await loadLevels(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }
  async function handleAddModule(): Promise<void> {
    if (!selected || !newTitle.trim()) return;
    try {
      await CurriculumApi.createModule({
        level_number: selected.number, title: newTitle.trim(),
        lesson_content: "Draft content — edit in the module editor.",
        evaluation_kind: newType === "quiz" ? "quiz" : "none",
      });
      setNewTitle(""); setNewType("text"); setAddingModule(false);
      await CurriculumApi.modules(selected.number).then(setModules);
      await loadLevels();
    } catch (e) { setError(errorMessage(e, "Could not add module.")); }
  }

  const published = levels.filter((l) => l.status === "Published").length;
  const inReview = levels.filter((l) => l.status === "In Review").length;
  const drafts = levels.filter((l) => l.status === "Draft").length;
  const totalLearners = levels.reduce((s, l) => s + l.learners, 0);
  const totalModules = levels.reduce((s, l) => s + l.modules, 0);

  const filtered = levels.filter((l) => {
    const q = search.toLowerCase();
    const matchSearch = l.title.toLowerCase().includes(q) || l.theme.toLowerCase().includes(q);
    return matchSearch && (filterStatus === "All" || l.status === filterStatus);
  });

  const heroStats = [
    { label: "Published", value: String(published), hint: `of ${levels.length} levels` },
    { label: "In review", value: String(inReview), hint: "awaiting approval" },
    { label: "Drafts", value: String(drafts), hint: "in progress" },
    { label: "Active learners", value: totalLearners.toLocaleString(), hint: "across pathway" },
  ];
  // Brand triad, no decorative blue: bright green · gold · neutral ink for drafts (matches iPad).
  const donutData = [
    { name: "Published", value: published, color: "#22c55e" },
    { name: "In Review", value: inReview, color: "#c89b3c" },
    { name: "Drafts", value: drafts, color: "#94a3b8" },
  ];
  const totalLevels = donutData.reduce((s, d) => s + d.value, 0);
  const moduleData = useMemo(() => levels.map((l) => ({ name: `L${l.number}`, modules: l.modules, done: l.completedModules })), [levels]);
  const pipelineStages = [
    { label: "Drafts", value: drafts, hint: "in authoring", tint: "tint-amber", Icon: PenLine },
    { label: "In review", value: inReview, hint: "awaiting approval", tint: "tint-blue", Icon: Eye },
    { label: "Locked", value: levels.filter((l) => l.locked).length, hint: "not yet open", tint: "tint-violet", Icon: Send },
    { label: "Live", value: published, hint: "across pathway", tint: "tint-green", Icon: Award },
  ];

  return (
    <div className="flex h-full flex-col md:flex-row" style={{ background: "var(--background)" }}>
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {/* Hero */}
        <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
              <span>Nuru Pathway</span><ChevronRight size={10} /><span>CMS</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Curriculum</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
                <Sparkles size={11} /> {levels.length}-level pathway
              </span>
              <button onClick={() => navigate("/curriculum-levels")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><BookOpen size={13} /> Pathway overview</button>
              <button onClick={() => setModalMode({ type: "add" })} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> New Level</button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
            {heroStats.map((item, idx) => (
              <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
                <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
          {error ? <p style={{ color: "var(--color-danger, #DC2626)", marginBottom: 12 }}>{error}</p> : null}

          {/* Filters */}
          <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px" }}>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 rounded-xl px-3 flex-1" style={{ maxWidth: 360, minWidth: 220, height: 40, background: "var(--input-background)", border: "1px solid var(--border)" }}>
                <Search size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search levels or themes…" className="bg-transparent outline-none flex-1" style={{ fontSize: 13, color: "var(--foreground)" }} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {(["All", "Published", "In Review", "Draft"] as const).map((s) => {
                  const active = filterStatus === s;
                  return <button key={s} onClick={() => setFilterStatus(s)} className="rounded-lg px-3" style={{ height: 36, fontSize: 12, fontWeight: 600, background: active ? "var(--nuru-navy)" : "var(--card)", color: active ? "#fff" : "var(--muted-foreground)", border: active ? "none" : "1px solid var(--border)" }}>{s}</button>;
                })}
              </div>
              <div className="ml-auto flex items-center gap-2"><span className="nuru-date-pill"><Sparkles size={12} /> {filtered.length} of {levels.length} levels</span></div>
            </div>
          </div>

          {/* Pipeline strip */}
          <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2"><span className="nuru-section-title">Curriculum pipeline</span><span className="nuru-eyebrow nuru-eyebrow-gold">live</span></div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {pipelineStages.map(({ label, value, hint, tint, Icon }) => (
                <div key={label} className="rounded-xl flex items-center gap-3" style={{ border: "1px solid var(--border)", padding: "12px 14px", background: "var(--secondary)" }}>
                  <div className={`flex items-center justify-center rounded-lg ${tint}`} style={{ width: 36, height: 36 }}><Icon size={16} /></div>
                  <div className="min-w-0">
                    <div className="nuru-eyebrow" style={{ marginBottom: 2 }}>{label}</div>
                    <div className="flex items-baseline gap-2"><span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1 }}>{value}</span><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</span></div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick actions — one compact row, moved up ahead of the report (matches iPad) */}
          <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
            <div className="flex items-center gap-2 mb-3"><Zap size={14} style={{ color: "var(--nuru-gold)" }} /><span className="nuru-section-title">Quick actions</span></div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: "New Level", Icon: Plus, tint: "tint-green", fn: () => setModalMode({ type: "add" }) },
                { label: "Editor", Icon: BookOpen, tint: "tint-blue", fn: () => navigate("/level-detail") },
                { label: "Quiz", Icon: HelpCircle, tint: "tint-violet", fn: () => navigate("/quiz-builder") },
                { label: "Video", Icon: Video, tint: "tint-amber", fn: () => navigate("/video-library") },
                { label: "Reflect", Icon: FileText, tint: "tint-green", fn: () => navigate("/reflection-queue") },
                { label: "Refresh", Icon: RotateCcw, tint: "tint-blue", fn: () => void loadLevels() },
              ].map(({ label, Icon, tint, fn }) => (
                <button key={label} onClick={fn} className="flex flex-col items-center gap-1.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--secondary)]" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                  <div className={`flex items-center justify-center rounded-lg ${tint}`} style={{ width: 30, height: 30 }}><Icon size={14} /></div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--nuru-navy)" }}>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Pathway report — Status mix · Breakdown · Modules per level · Engagement,
              all shown together as small cards (no tab switcher), matching the iPad. */}
          <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <div className="mb-4">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.15 }}>Pathway report</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Status mix, breakdown, modules and engagement — all in one view.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {/* Status mix */}
              <div className="rounded-xl" style={{ border: "1px solid var(--border)", padding: "14px 16px", background: "var(--secondary)" }}>
                <div className="nuru-eyebrow mb-2">Status mix</div>
                <div className="relative" style={{ height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donutData} dataKey="value" innerRadius={44} outerRadius={66} paddingAngle={2} stroke="none">
                        {donutData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", lineHeight: 1 }}>{totalLevels}</span>
                    <span style={{ fontSize: 10, color: "var(--muted-foreground)", letterSpacing: "0.08em", textTransform: "uppercase", fontWeight: 700, marginTop: 2 }}>Levels</span>
                  </div>
                </div>
              </div>
              {/* Breakdown */}
              <div className="rounded-xl" style={{ border: "1px solid var(--border)", padding: "14px 16px", background: "var(--secondary)" }}>
                <div className="nuru-eyebrow mb-3">Breakdown</div>
                <div className="flex flex-col gap-3">
                  {donutData.map((d) => {
                    const pct = totalLevels > 0 ? Math.round((d.value / totalLevels) * 100) : 0;
                    return (
                      <div key={d.name}>
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2"><span className="rounded-full" style={{ width: 8, height: 8, background: d.color, display: "inline-block" }} /><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)" }}>{d.name}</span></div>
                          <span style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--nuru-navy)", lineHeight: 1 }}>{d.value} <span style={{ fontFamily: "var(--font-sans)", fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>· {pct}%</span></span>
                        </div>
                        <div className="rounded-full overflow-hidden" style={{ height: 5, background: "var(--input-background)" }}><div style={{ width: `${pct}%`, height: "100%", background: d.color }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* Modules per level */}
              <div className="rounded-xl" style={{ border: "1px solid var(--border)", padding: "14px 16px", background: "var(--secondary)" }}>
                <div className="flex items-center justify-between mb-2"><div className="nuru-eyebrow">Modules per level</div><BarChart3 size={12} style={{ color: "var(--muted-foreground)" }} /></div>
                <div style={{ height: 150 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={moduleData} barCategoryGap={8}>
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10.5, fill: "var(--muted-foreground)" }} />
                      <YAxis hide />
                      <Tooltip cursor={{ fill: "rgba(11,31,51,0.04)" }} />
                      <Bar dataKey="modules" fill="#F4E4BD" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="done" fill="#22c55e" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Engagement — two summary stats + per-level learners list */}
              <div className="rounded-xl" style={{ border: "1px solid var(--border)", padding: "14px 16px", background: "var(--secondary)" }}>
                <div className="nuru-eyebrow mb-2">Engagement</div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div className="rounded-lg flex items-center gap-2" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "8px 10px" }}>
                    <div className="flex items-center justify-center rounded-md shrink-0" style={{ width: 26, height: 26, background: "rgba(34,197,94,0.14)", color: "#16a34a" }}><Users size={13} /></div>
                    <div className="min-w-0"><div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--nuru-navy)", lineHeight: 1 }}>{totalLearners.toLocaleString()}</div><div className="nuru-eyebrow" style={{ fontSize: 9 }}>Learners</div></div>
                  </div>
                  <div className="rounded-lg flex items-center gap-2" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "8px 10px" }}>
                    <div className="flex items-center justify-center rounded-md shrink-0" style={{ width: 26, height: 26, background: "rgba(200,155,60,0.16)", color: "#c89b3c" }}><Award size={13} /></div>
                    <div className="min-w-0"><div style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--nuru-navy)", lineHeight: 1 }}>{levels.reduce((s, l) => s + l.completedModules, 0)}</div><div className="nuru-eyebrow" style={{ fontSize: 9 }}>Live</div></div>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  {levels.map((l) => (
                    <div key={l.number} className="flex items-center gap-2">
                      <span className="rounded-md text-center shrink-0" style={{ width: 24, fontSize: 9.5, fontWeight: 800, color: "#fff", background: l.color, padding: "2px 0" }}>L{l.number}</span>
                      <span style={{ flex: 1, fontSize: 11.5, fontWeight: 500, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</span>
                      <span className="flex items-center gap-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted-foreground)" }}><Users size={10} /> {l.learners.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="nuru-footnote">Source: Curriculum CMS · {totalLevels} levels covering {totalModules} modules and {totalLearners.toLocaleString()} active learners.</div>
          </div>

          {/* Section heading */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.15 }}>The pathway</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Click any level to inspect its modules.</p>
            </div>
            <button onClick={() => navigate("/curriculum-levels")} className="flex items-center gap-1" style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View all <ChevronRight size={12} /></button>
          </div>

          {/* Pathway — level list as compact cards in a 3-up grid (was a vertical timeline). */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {filtered.map((level) => {
              const ss = statusStyle[level.status];
              const progress = level.modules > 0 ? Math.round((level.completedModules / level.modules) * 100) : 0;
              return (
                <div key={level.number} className="rounded-2xl cursor-pointer transition-all hover:-translate-y-0.5" style={{ background: "var(--card)", border: selectedNo === level.number ? `2px solid ${level.color}` : "1px solid var(--border)", boxShadow: selectedNo === level.number ? `0 8px 22px ${level.color}22` : "0 1px 2px rgba(11,31,51,0.03)", padding: 14 }} onClick={() => { setSelectedNo(level.number); setAddingModule(false); }}>
                  {/* Header: monogram + eyebrow + status pill */}
                  <div className="flex items-start gap-2.5">
                    <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 36, height: 36, background: level.locked ? "var(--muted)" : level.color, color: "#fff", fontFamily: "var(--font-display)", fontSize: 16, boxShadow: level.locked ? "none" : `0 2px 8px ${level.color}44`, border: level.locked ? "2px dashed var(--border)" : "none" }}>
                      {level.locked ? <Lock size={13} style={{ color: "var(--muted-foreground)" }} /> : level.number}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5"><span style={{ fontSize: 9.5, fontWeight: 700, color: level.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>Level {level.number}</span>{level.locked ? <Lock size={8} style={{ color: "var(--muted-foreground)" }} /> : null}</div>
                      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 15, color: "var(--nuru-navy)", lineHeight: 1.2, letterSpacing: "-0.01em" }}>{level.title}</h3>
                    </div>
                    <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 9, fontWeight: 700, background: ss.bg, color: ss.color, letterSpacing: "0.04em" }}>{level.status}</span>
                  </div>

                  {level.theme ? <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8, lineHeight: 1.4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{level.theme}</p> : null}

                  {/* Compact stat row */}
                  <div className="flex items-center gap-3 mt-2.5">
                    <div className="flex items-center gap-1" style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}><BookOpen size={11} /> {level.completedModules}/{level.modules}</div>
                    <div className="flex items-center gap-1" style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}><Users size={11} /> {level.learners.toLocaleString()}</div>
                  </div>

                  {/* Progress */}
                  <div className="flex items-center gap-2 mt-2.5">
                    <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "var(--input-background)" }}><div className="h-full rounded-full" style={{ width: `${progress}%`, background: level.locked ? "var(--border)" : level.color }} /></div>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", fontFamily: "var(--font-display)" }}>{progress}%</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    <button onClick={(e) => { e.stopPropagation(); if (!level.locked) navigate(`/cms/level/${level.number}`); }} className="flex items-center gap-1 rounded-lg px-2.5" style={{ height: 28, background: level.locked ? "var(--muted)" : "var(--nuru-navy)", color: level.locked ? "var(--muted-foreground)" : "#fff", fontSize: 11, fontWeight: 600, border: "none", cursor: level.locked ? "not-allowed" : "pointer" }}><ExternalLink size={10} /> Open</button>
                    {level.locked ? <button onClick={(e) => { e.stopPropagation(); void toggleLock(level); }} className="flex items-center gap-1 rounded-lg px-2.5" style={{ height: 28, border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--muted-foreground)", background: "none" }}><Unlock size={10} /> Unlock</button> : null}
                    {level.status === "Draft" && !level.locked ? <button onClick={(e) => { e.stopPropagation(); void setLevelStatus(level.number, "In Review"); }} className="flex items-center gap-1 rounded-lg px-2.5" style={{ height: 28, background: "var(--nuru-gold)", fontSize: 11, fontWeight: 600, color: "#fff", border: "none" }}><TrendingUp size={10} /> Review</button> : null}
                    {level.status === "In Review" ? <button onClick={(e) => { e.stopPropagation(); void setLevelStatus(level.number, "Published"); }} className="flex items-center gap-1 rounded-lg px-2.5" style={{ height: 28, background: "#0F6B33", fontSize: 11, fontWeight: 600, color: "#fff", border: "none" }}><CheckCircle2 size={10} /> Publish</button> : null}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent CMS activity */}
          <div className="rounded-2xl mt-6" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Activity size={14} style={{ color: "var(--nuru-navy)" }} /><span className="nuru-section-title">Recent CMS activity</span></div></div>
            {activity.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No recent activity.</p> : (
              <div className="flex flex-col">
                {activity.map((row, i, arr) => (
                  <div key={row.audit_id} className="flex items-start gap-3 py-3" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: "rgba(200,155,60,0.12)", color: "#c89b3c" }}><PenLine size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <p style={{ fontSize: 13, color: "var(--nuru-navy)", lineHeight: 1.4 }}>{row.actor_name ? <span style={{ fontWeight: 700 }}>{row.actor_name}</span> : null} <span style={{ color: "var(--muted-foreground)" }}>{humanize(row.action)}</span>{row.entity ? <> <span style={{ fontWeight: 600 }}>{row.entity}</span></> : null}</p>
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{relTime(row.created_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selected ? (
        <div className="flex flex-col overflow-hidden w-full md:w-[380px]" style={{ background: "var(--card)", borderLeft: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ borderBottom: "1px solid var(--border)", padding: "20px 24px" }}>
            <div className="flex items-center justify-between mb-3"><span className="nuru-eyebrow" style={{ color: selected.color }}>Level {selected.number} · {selected.status}</span><MoreHorizontal size={14} style={{ color: "var(--muted-foreground)" }} /></div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", lineHeight: 1.15, letterSpacing: "-0.01em" }}>{selected.title}</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>{selected.theme || "—"}</p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              {[{ label: "Pass Mark", val: `${selected.passMark}%` }, { label: "Modules", val: selected.modules }, { label: "Learners", val: selected.learners.toLocaleString() }].map(({ label, val }) => (
                <div key={label}><div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{val}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{label}</div></div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <span className="nuru-section-title">Modules</span>
            <button onClick={() => setAddingModule((v) => !v)} className="flex items-center gap-1 rounded-lg px-2.5" style={{ height: 30, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 600, border: "none" }}><Plus size={11} /> Add</button>
          </div>
          {addingModule ? (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 8, letterSpacing: "0.04em", textTransform: "uppercase" }}>New Module</p>
              <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void handleAddModule(); if (e.key === "Escape") setAddingModule(false); }} placeholder="Module title…" className="w-full rounded-lg px-3 outline-none" style={{ height: 36, fontSize: 13, background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", marginBottom: 8 }} />
              <div className="flex items-center gap-2">
                <select value={newType} onChange={(e) => setNewType(e.target.value as "text" | "video" | "quiz")} className="rounded-lg px-2 outline-none flex-1" style={{ height: 34, fontSize: 12, background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)" }}>
                  <option value="text">Text</option><option value="video">Video</option><option value="quiz">Quiz</option>
                </select>
                <button onClick={() => void handleAddModule()} disabled={!newTitle.trim()} className="flex items-center gap-1 rounded-lg px-3" style={{ height: 34, fontSize: 12, fontWeight: 600, background: newTitle.trim() ? "var(--nuru-gold)" : "var(--muted)", color: newTitle.trim() ? "#fff" : "var(--muted-foreground)", cursor: newTitle.trim() ? "pointer" : "not-allowed", border: "none" }}><Check size={12} /> Create</button>
                <button onClick={() => setAddingModule(false)} className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, border: "1px solid var(--border)", color: "var(--muted-foreground)", background: "none" }}><X size={12} /></button>
              </div>
            </div>
          ) : null}
          <div className="flex-1 overflow-y-auto no-scrollbar">
            {modules.length === 0 && !addingModule ? (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center" style={{ color: "var(--muted-foreground)" }}>
                <BookOpen size={28} style={{ marginBottom: 8, opacity: 0.4 }} />
                <p style={{ fontSize: 13, fontWeight: 600 }}>No modules yet</p>
                <p style={{ fontSize: 12, marginTop: 4 }}>Click "+ Add" to create the first module.</p>
              </div>
            ) : null}
            {modules.map((mod, i, arr) => (
              <div key={mod.module_id} className="flex items-center gap-3 px-5 py-3 group transition-colors hover:bg-[var(--secondary)]" style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--secondary)", border: "1px solid var(--border)" }}><TypeIcon kind={mod.evaluation_kind} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mod.module_sequence_number}. {mod.title}</p>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{mod.evaluation_kind === "none" ? "lesson" : mod.evaluation_kind}{mod.active_question_count ? ` · ${mod.active_question_count} Q` : ""}</span>
                </div>
                <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: mod.status === "published" ? "#E8F6EE" : "#EEF1F8", color: mod.status === "published" ? "#0F6B33" : "#1F3A6B" }}>{mod.status}</span>
                <button onClick={() => navigate(`/cms/level/${selected.number}`)} className="flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 transition-opacity" style={{ width: 26, height: 26, border: "1px solid var(--border)", color: "var(--nuru-navy)", flexShrink: 0, background: "none" }} title="Edit module"><Pencil size={11} /></button>
              </div>
            ))}
          </div>
          <div className="flex gap-2 p-4" style={{ borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setModalMode({ type: "edit", level: selected })} className="flex-1 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}>Edit Level</button>
            <button onClick={() => navigate(`/cms/level/${selected.number}`)} className="flex-1 rounded-xl py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>Open →</button>
          </div>
        </div>
      ) : null}

      {/* Level modal */}
      {modalMode ? (
        <LevelModal
          mode={modalMode.type}
          levelNumber={modalMode.type === "add" ? levels.length + 1 : modalMode.level.number}
          saving={saving}
          {...(modalMode.type === "edit" ? { initialData: { title: modalMode.level.title, theme: modalMode.level.theme, passMark: modalMode.level.passMark, duration: modalMode.level.duration, status: modalMode.level.status as LevelStatus, locked: modalMode.level.locked, color: modalMode.level.color } } : {})}
          onSave={(d) => void handleSaveLevel(d)}
          onClose={() => setModalMode(null)}
        />
      ) : null}
    </div>
  );
}
