// Module Editor — full-page editor rebuilt to the Figma make: navy hero with an
// editable title + Words/Reading/Evaluation/Readiness stat strip, a rich markdown
// toolbar + body, and a sidebar (publish-readiness checklist, module details,
// scripture key-verse chips). Live-view modal + version-history drawer. A built-in
// level→module picker gives the standalone nav item a real module to edit. All data
// from the CMS (CurriculumApi); optimistic save (row_version).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type CSSProperties } from "react";
import {
  ArrowLeft, Save, Send, Clock, BookMarked, ChevronDown, ChevronRight, History,
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, Link2, Quote, Code,
  Minus as MinusIcon, Eye, RotateCcw, Check, X, FileText, HelpCircle, MessageSquare,
  Minus, CheckCircle2,
} from "lucide-react";
import {
  CurriculumApi, type AdminLevel, type AdminModuleSummary, type AdminModule,
  type EvaluationKind, type ModuleVersion,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { MarkdownPreview } from "../MarkdownPreview";
import type { ScreenId } from "../shell/nav";

const navyDark = "var(--nuru-dark, #071629)";
const EVAL_OPTS: { value: EvaluationKind; label: string; icon: typeof HelpCircle; description: string; tint: string }[] = [
  { value: "quiz", label: "Quiz", icon: HelpCircle, description: "Auto-graded questions.", tint: "#7C3AED" },
  { value: "reflection", label: "Reflection", icon: MessageSquare, description: "Written response reviewed by a facilitator.", tint: "#0B84E8" },
  { value: "exit_exam", label: "Exit exam", icon: FileText, description: "Counts toward the level exam.", tint: "#C89B3C" },
  { value: "none", label: "None", icon: Minus, description: "No assessment for this module.", tint: "#94A3B8" },
];
const statusStyle: Record<string, { bg: string; color: string }> = {
  draft: { bg: "#FFF6E0", color: "#A87616" },
  published: { bg: "#E8F6EC", color: "#16A34A" },
  archived: { bg: "#F3F4F6", color: "#94A3B8" },
};

export function ModuleEditorPage({ onNavigate }: { onNavigate: (id: ScreenId) => void }): ReactElement {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [levelNo, setLevelNo] = useState<number | null>(null);
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  const [moduleId, setModuleId] = useState<string | null>(null);

  const [mod, setMod] = useState<AdminModule | null>(null);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [minutes, setMinutes] = useState(0);
  const [verses, setVerses] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationKind>("none");
  const [passMark, setPassMark] = useState(0);
  const [markdown, setMarkdown] = useState("");
  const [dirty, setDirty] = useState(false);
  const [evalOpen, setEvalOpen] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<ModuleVersion[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Pickers ──
  useEffect(() => { CurriculumApi.levels().then((ls) => { setLevels(ls); if (ls[0] && levelNo === null) setLevelNo(ls[0].level_number); }).catch((e) => setError(errorMessage(e, "Load failed"))); }, [levelNo]);
  useEffect(() => {
    if (levelNo === null) return;
    CurriculumApi.modules(levelNo).then((ms) => { setModules(ms); setModuleId((cur) => (ms.some((m) => m.module_id === cur) ? cur : ms[0]?.module_id ?? null)); }).catch(() => setModules([]));
  }, [levelNo]);

  const load = useCallback(async (id: string) => {
    setError(null);
    try {
      const m = await CurriculumApi.module(id);
      setMod(m); setTitle(m.title); setSummary(m.summary ?? ""); setMinutes(m.estimated_minutes ?? 0);
      setVerses((m.key_verses ?? []).join(", ")); setEvaluation(m.evaluation_kind); setPassMark(Number(m.quiz_pass_mark));
      setMarkdown(m.lesson_content); setDirty(false);
    } catch (e) { setError(errorMessage(e, "Could not load the module.")); }
  }, []);
  useEffect(() => { if (moduleId) void load(moduleId); }, [moduleId, load]);

  const wordCount = useMemo(() => markdown.trim().split(/\s+/).filter(Boolean).length, [markdown]);
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));
  const versesList = verses.split(",").map((v) => v.trim()).filter(Boolean);
  const checklist = [
    { label: "Title set", done: title.trim().length > 0 },
    { label: "Summary written", done: summary.trim().length >= 20 },
    { label: "Estimated time", done: minutes > 0 },
    { label: "Key verses added", done: versesList.length > 0 },
    { label: "Body ≥ 100 words", done: wordCount >= 100 },
  ];
  const completion = Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);
  const selEval = EVAL_OPTS.find((o) => o.value === evaluation) ?? { value: "none" as EvaluationKind, label: "None", icon: Minus, description: "", tint: "#94A3B8" };
  const ss = statusStyle[mod?.status ?? "draft"] ?? { bg: "#FFF6E0", color: "#A87616" };

  function set<T>(setter: (v: T) => void) { return (v: T): void => { setter(v); setDirty(true); }; }
  function wrap(before: string, after = before): void {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd, sel = markdown.slice(s, e) || "text";
    const next = markdown.slice(0, s) + before + sel + after + markdown.slice(e);
    set(setMarkdown)(next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }
  function prefix(p: string): void {
    const ta = taRef.current; if (!ta) return;
    const s = ta.selectionStart, ls = markdown.lastIndexOf("\n", s - 1) + 1;
    set(setMarkdown)(markdown.slice(0, ls) + p + markdown.slice(ls));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + p.length, s + p.length); });
  }

  async function save(): Promise<void> {
    if (!mod) return;
    setError(null); setNotice(null);
    try {
      const updated = await CurriculumApi.updateModule(mod.module_id, {
        title, summary: summary || null, evaluation_kind: evaluation, quiz_pass_mark: passMark,
        estimated_minutes: minutes || null, lesson_content: markdown, key_verses: versesList.length ? versesList : null,
        expected_row_version: mod.row_version,
      });
      setMod(updated as AdminModule); setDirty(false); setNotice("Saved draft.");
      if (levelNo !== null) CurriculumApi.modules(levelNo).then(setModules).catch(() => {});
    } catch (e) { setError(errorMessage(e, "Save failed — the module may have changed elsewhere (reload).")); }
  }
  async function togglePublish(): Promise<void> {
    if (!mod) return;
    try {
      const updated = mod.status === "published" ? await CurriculumApi.unpublish(mod.module_id) : await CurriculumApi.publish(mod.module_id);
      setMod(updated); setNotice(updated.status === "published" ? "Published." : "Unpublished.");
      if (levelNo !== null) CurriculumApi.modules(levelNo).then(setModules).catch(() => {});
    } catch (e) { setError(errorMessage(e, "Publish rejected by validation (needs questions / contiguous sequence).")); }
  }
  async function openHistory(): Promise<void> { if (mod) { setVersions(await CurriculumApi.versions(mod.module_id)); setHistoryOpen(true); } }
  async function restore(n: number): Promise<void> { if (!mod) return; await CurriculumApi.revert(mod.module_id, n); setHistoryOpen(false); await load(mod.module_id); }

  const TOOLBAR: { Icon: typeof Bold; label: string; fn: () => void }[][] = [
    [{ Icon: Heading1, label: "H1", fn: () => prefix("# ") }, { Icon: Heading2, label: "H2", fn: () => prefix("## ") }, { Icon: Heading3, label: "H3", fn: () => prefix("### ") }],
    [{ Icon: Bold, label: "Bold", fn: () => wrap("**") }, { Icon: Italic, label: "Italic", fn: () => wrap("*") }, { Icon: Code, label: "Code", fn: () => wrap("`") }],
    [{ Icon: Quote, label: "Quote", fn: () => prefix("> ") }, { Icon: List, label: "Bullets", fn: () => prefix("- ") }, { Icon: ListOrdered, label: "Numbered", fn: () => prefix("1. ") }, { Icon: Link2, label: "Link", fn: () => wrap("[", "](https://)") }, { Icon: MinusIcon, label: "Divider", fn: () => set(setMarkdown)(markdown + "\n\n---\n\n") }],
  ];
  const hbtn: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)" };

  return (
    <div style={{ margin: -28 }}>
      {/* Hero */}
      <div style={{ background: navyDark, padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: 6, fontSize: 11, color: "rgba(232,239,245,0.55)" }}>
            <button onClick={() => onNavigate("level-detail")} className="flex items-center" style={{ gap: 4, color: "rgba(232,239,245,0.55)", background: "none", border: "none" }}><ArrowLeft size={10} /> CMS</button>
            <ChevronRight size={10} />
            <select value={levelNo ?? ""} onChange={(e) => setLevelNo(Number(e.target.value))} style={{ background: "transparent", color: "rgba(232,239,245,0.85)", border: "none", fontSize: 11, outline: "none" }}>
              {levels.map((l) => <option key={l.level_number} value={l.level_number} style={{ color: "#000" }}>L{l.level_number} · {l.title}</option>)}
            </select>
            <ChevronRight size={10} />
            <select value={moduleId ?? ""} onChange={(e) => setModuleId(e.target.value)} style={{ background: "transparent", color: "#fff", fontWeight: 600, border: "none", fontSize: 11, outline: "none" }}>
              {modules.map((m) => <option key={m.module_id} value={m.module_id} style={{ color: "#000" }}>Module {m.module_sequence_number}</option>)}
            </select>
          </div>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="inline-flex items-center" style={{ gap: 6, height: 32, padding: "0 10px", borderRadius: 8, background: ss.bg, color: ss.color, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${ss.color}33` }}>● {mod?.status ?? "—"}</span>
            <button onClick={() => setLiveOpen(true)} className="flex items-center" style={{ gap: 8, ...hbtn }}><Eye size={13} /> Live view</button>
            <button onClick={() => void openHistory()} className="flex items-center" style={{ gap: 8, ...hbtn }}><History size={13} /> History</button>
            <button onClick={() => void save()} disabled={!dirty} className="flex items-center" style={{ gap: 8, ...hbtn, opacity: dirty ? 1 : 0.5 }}><Save size={13} /> Save draft</button>
            <button onClick={() => void togglePublish()} className="flex items-center" style={{ gap: 8, height: 32, padding: "0 12px", borderRadius: 8, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", boxShadow: "0 6px 18px rgba(200,155,60,0.32)" }}><Send size={13} /> {mod?.status === "published" ? "Unpublish" : "Publish"}</button>
          </div>
        </div>

        <div className="flex items-baseline" style={{ gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <input value={title} onChange={(e) => set(setTitle)(e.target.value)} placeholder="Untitled module" className="bg-transparent outline-none" style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1.1, letterSpacing: "-0.015em", border: "none", width: `${Math.max(title.length, 10)}ch`, maxWidth: "100%" }} />
          <span style={{ fontSize: 12, color: "rgba(232,239,245,0.55)" }}>{summary || "Add a summary so leaders know what this module is about."}</span>
        </div>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", marginTop: 16, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[{ label: "Words", value: String(wordCount) }, { label: "Reading", value: `${readingMinutes} min` }, { label: "Evaluation", value: selEval.label }, { label: "Readiness", value: `${completion}%` }].map((it, i) => (
            <div key={it.label} style={{ padding: "14px 20px", borderRight: "1px solid rgba(255,255,255,0.07)", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{it.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{it.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "var(--color-danger)", marginBottom: 12 }}>{error}</p> : null}
        {notice ? <p style={{ color: "#16A34A", marginBottom: 12 }}>{notice}</p> : null}
        {!mod ? <p style={{ color: "var(--muted-foreground)" }}>Select a module above to edit.</p> : (
          <div className="grid" style={{ gridTemplateColumns: "minmax(0,1fr) 340px", gap: 20, alignItems: "start" }}>
            {/* Editor */}
            <div className="nuru-card" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div className="flex items-center" style={{ gap: 2, padding: "0 12px", minHeight: 46, borderBottom: "1px solid var(--border)", background: "var(--background)", flexWrap: "wrap" }}>
                {TOOLBAR.map((group, gi) => (
                  <div key={gi} className="flex items-center">
                    {group.map((b) => (
                      <button key={b.label} onClick={b.fn} title={b.label} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 8, border: "none", background: "transparent", color: "var(--nuru-navy)" }}><b.Icon size={14} /></button>
                    ))}
                    {gi < TOOLBAR.length - 1 ? <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 6px" }} /> : null}
                  </div>
                ))}
                <div className="flex items-center" style={{ marginLeft: "auto", gap: 8, fontSize: 11, color: "var(--muted-foreground)" }}>
                  <span><strong style={{ color: "var(--nuru-navy)" }}>{wordCount}</strong> words</span><span>·</span><span>~{readingMinutes} min</span>
                </div>
              </div>
              <textarea ref={taRef} value={markdown} onChange={(e) => set(setMarkdown)(e.target.value)} spellCheck={false} className="outline-none" style={{ resize: "vertical", padding: "26px 30px", border: "none", fontFamily: "var(--font-mono),Menlo,monospace", fontSize: 13, lineHeight: 1.75, color: "var(--foreground)", background: "var(--card)", minHeight: 520 }} />
            </div>

            {/* Sidebar */}
            <div className="flex flex-col" style={{ gap: 20 }}>
              <div style={{ borderRadius: 16, padding: 20, background: "linear-gradient(135deg, var(--nuru-navy) 0%, #142a45 100%)", color: "#fff" }}>
                <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "rgba(232,239,245,0.55)", textTransform: "uppercase" }}>Publish readiness</span>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-gold)", lineHeight: 1 }}>{completion}%</span>
                </div>
                <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.08)", overflow: "hidden", marginBottom: 16 }}>
                  <div style={{ width: `${completion}%`, height: "100%", background: "var(--nuru-gold)" }} />
                </div>
                <div className="flex flex-col" style={{ gap: 6 }}>
                  {checklist.map((c) => (
                    <div key={c.label} className="flex items-center" style={{ gap: 8 }}>
                      {c.done ? <CheckCircle2 size={12} style={{ color: "var(--nuru-gold)" }} /> : <span style={{ width: 11, height: 11, borderRadius: 999, border: "1.5px solid rgba(255,255,255,0.25)" }} />}
                      <span style={{ fontSize: 12, color: c.done ? "#fff" : "rgba(232,239,245,0.55)" }}>{c.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="nuru-card" style={{ padding: 20 }}>
                <SectionLabel icon={<FileText size={12} />} label="Module details" />
                <Field label="Summary" hint={`${summary.length}/200`}>
                  <textarea value={summary} maxLength={200} rows={3} onChange={(e) => set(setSummary)(e.target.value)} style={{ ...inputStyle, height: "auto", padding: 10, lineHeight: 1.5, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
                </Field>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Field label="Est. minutes">
                    <div className="flex items-center" style={{ gap: 6, ...inputBox, padding: "0 12px" }}>
                      <Clock size={12} style={{ color: "var(--muted-foreground)" }} />
                      <input type="number" value={minutes} onChange={(e) => set(setMinutes)(Number(e.target.value))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", border: "none", width: "100%", minWidth: 0 }} />
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>min</span>
                    </div>
                  </Field>
                  <Field label="Quiz pass %">
                    <input type="number" min={0} max={100} value={passMark} disabled={evaluation !== "quiz"} onChange={(e) => set(setPassMark)(Number(e.target.value))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box", ...(evaluation !== "quiz" ? { background: "var(--secondary)", color: "var(--muted-foreground)" } : {}) }} />
                  </Field>
                </div>
                <Field label="Evaluation">
                  <div style={{ position: "relative" }}>
                    <button onClick={() => setEvalOpen((v) => !v)} className="flex items-center justify-between" style={{ ...inputBox, padding: "0 12px", width: "100%" }}>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <span className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 6, background: `${selEval.tint}18`, color: selEval.tint }}><selEval.icon size={12} /></span>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{selEval.label}</span>
                      </div>
                      <ChevronDown size={13} style={{ color: "var(--muted-foreground)", transform: evalOpen ? "rotate(180deg)" : "none" }} />
                    </button>
                    {evalOpen ? (
                      <>
                        <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setEvalOpen(false)} />
                        <div style={{ position: "absolute", left: 0, right: 0, marginTop: 4, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 12px 36px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 31 }}>
                          {EVAL_OPTS.map((o) => (
                            <button key={o.value} onClick={() => { set(setEvaluation)(o.value); setEvalOpen(false); }} className="flex items-start" style={{ gap: 10, width: "100%", padding: "10px 12px", background: "transparent", border: "none", textAlign: "left" }}>
                              <span className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: 6, background: `${o.tint}18`, color: o.tint, marginTop: 2, flexShrink: 0 }}><o.icon size={12} /></span>
                              <div style={{ flex: 1 }}>
                                <div className="flex items-center justify-between"><span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{o.label}</span>{o.value === evaluation ? <Check size={12} style={{ color: "var(--nuru-gold)" }} /> : null}</div>
                                <p style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.4 }}>{o.description}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </div>
                </Field>
              </div>

              <div className="nuru-card" style={{ padding: 20 }}>
                <SectionLabel icon={<BookMarked size={12} />} label="Scripture" />
                <Field label="Key verses" hint={`${versesList.length} refs`}>
                  <textarea value={verses} rows={2} placeholder="e.g. John 3:3-7, Romans 10:9" onChange={(e) => set(setVerses)(e.target.value)} style={{ ...inputStyle, height: "auto", padding: 10, lineHeight: 1.5, width: "100%", boxSizing: "border-box", resize: "vertical" }} />
                </Field>
                {versesList.length ? (
                  <div className="flex" style={{ flexWrap: "wrap", gap: 6 }}>
                    {versesList.map((v) => (
                      <span key={v} className="inline-flex items-center" style={{ gap: 4, borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 600, background: "rgba(200,155,60,0.10)", color: "#B5852F", border: "1px solid rgba(200,155,60,0.22)" }}><BookMarked size={9} /> {v}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Live view */}
      {liveOpen ? (
        <div className="fixed inset-0 flex items-center justify-center" style={{ background: "rgba(11,31,51,0.55)", zIndex: 50, padding: 16 }} onClick={() => setLiveOpen(false)}>
          <div className="flex flex-col" style={{ width: "100%", maxWidth: 880, maxHeight: "88vh", borderRadius: 16, overflow: "hidden", background: "#fff" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ height: 60, padding: "0 24px", background: "var(--nuru-navy)", color: "#fff" }}>
              <div className="flex items-center" style={{ gap: 10 }}><Eye size={14} style={{ color: "var(--nuru-gold)" }} /><div><div style={{ fontSize: 14, fontWeight: 700 }}>Live view</div><div style={{ fontSize: 11, color: "rgba(232,239,245,0.55)" }}>As learners will see it · {wordCount} words · ~{readingMinutes} min</div></div></div>
              <button onClick={() => setLiveOpen(false)} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", border: "none", color: "#fff" }}><X size={14} /></button>
            </div>
            <div className="overflow-y-auto" style={{ padding: "32px 40px", flex: 1 }}>
              <div style={{ maxWidth: 680, margin: "0 auto" }}>
                <h1 className="type-display" style={{ fontSize: 28, marginBottom: 12 }}>{title}</h1>
                <MarkdownPreview content={markdown} />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* History drawer */}
      {historyOpen ? (
        <>
          <div className="fixed inset-0" style={{ background: "rgba(11,31,51,0.4)", zIndex: 50 }} onClick={() => setHistoryOpen(false)} />
          <div className="fixed top-0 right-0 flex flex-col" style={{ width: 440, height: "100%", background: "#fff", zIndex: 60, boxShadow: "-12px 0 48px rgba(0,0,0,0.18)" }}>
            <div className="flex items-center justify-between" style={{ height: 64, padding: "0 20px", background: "var(--nuru-navy)", color: "#fff" }}>
              <div className="flex items-center" style={{ gap: 10 }}><History size={15} style={{ color: "var(--nuru-gold)" }} /><div><div style={{ fontSize: 14, fontWeight: 700 }}>Version history</div><div style={{ fontSize: 11, color: "rgba(232,239,245,0.55)" }}>{versions.length} saved revisions</div></div></div>
              <button onClick={() => setHistoryOpen(false)} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 8, background: "transparent", border: "none", color: "#fff" }}><X size={14} /></button>
            </div>
            <div className="overflow-y-auto no-scrollbar" style={{ flex: 1 }}>
              {versions.length === 0 ? <p style={{ padding: 20, color: "var(--muted-foreground)", fontSize: 13 }}>No prior versions.</p> : versions.map((v) => (
                <div key={v.version_id} style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>v{v.version_number}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: "auto" }}>{v.edited_by_name ?? "unknown"} · {new Date(v.created_at).toLocaleString()}</span>
                  </div>
                  <button onClick={() => void restore(v.version_number)} className="flex items-center" style={{ gap: 6, marginTop: 10, height: 28, padding: "0 10px", borderRadius: 8, background: "var(--nuru-gold)", color: "#fff", fontSize: 11, fontWeight: 600, border: "none" }}><RotateCcw size={11} /> Restore</button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const inputStyle: CSSProperties = { height: 40, padding: "0 12px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--background)", fontSize: 13, color: "var(--foreground)" };
const inputBox: CSSProperties = { height: 40, borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--background)" };

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
        <label style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "var(--muted-foreground)", textTransform: "uppercase" }}>{label}</label>
        {hint ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}
function SectionLabel({ icon, label }: { icon: ReactNode; label: string }): ReactElement {
  return <div className="flex items-center" style={{ gap: 6, marginBottom: 12 }}><span style={{ color: "var(--nuru-gold)" }}>{icon}</span><span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "var(--nuru-navy)", textTransform: "uppercase" }}>{label}</span></div>;
}
