// Level Detail — rebuilt to the "Final Pathway Portal" make: a two-panel CMS with
// a levels/modules tree (left) and a full module editor (right). Wired to the live
// CMS API — module load/save (optimistic row_version), publish/unpublish, archive,
// inline add-module, and level create/edit via LevelModal. The Quiz tab deep-links
// to the dedicated Quiz Builder (our question model is server-authoritative, §1.9).
import { useCallback, useEffect, useRef, useState, type ReactElement, type CSSProperties } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ChevronRight, ChevronDown, Plus, Eye, Pencil, BookOpen, X, Lock, FileText,
  ClipboardList, AlertTriangle, Target, Tag, Hash, Video,
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Code2, Link as LinkIcon, Image as ImageIcon, Table as TableIcon, Minus,
} from "lucide-react";
import {
  CurriculumApi, type AdminLevel, type AdminModuleSummary, type AdminModule, type EvaluationKind,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { MarkdownPreview } from "../MarkdownPreview";
import { LevelModal, type LevelFormData, type LevelStatus } from "../curriculum/LevelModal";
import { ModuleQuizBuilder, type QuizSettings } from "../curriculum/ModuleQuizBuilder";

const statusPill: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  archived: { bg: "#F3F4F6", color: "#94A3B8" },
};
const beToLabel: Record<string, LevelStatus> = { published: "Published", draft: "Draft", in_review: "In Review" };
const labelToBe: Record<LevelStatus, string> = { Published: "published", Draft: "draft", "In Review": "in_review" };
const EVAL_OPTS: { v: EvaluationKind; l: string }[] = [
  { v: "none", l: "— none —" }, { v: "quiz", l: "Quiz" }, { v: "reflection", l: "Reflection" }, { v: "exit_exam", l: "Exit exam" },
];
const fieldLabel: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 };
const fieldInput: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" };
const areaInput: CSSProperties = { width: "100%", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 14px", color: "var(--foreground)", outline: "none", resize: "vertical", lineHeight: 1.6, fontFamily: "var(--font-sans)" };

export function LevelDetail(): ReactElement {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const routeLevel = id ? parseInt(id, 10) : null;

  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [modsByLevel, setModsByLevel] = useState<Record<number, AdminModuleSummary[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mod, setMod] = useState<AdminModule | null>(null);
  const [draft, setDraft] = useState<AdminModule | null>(null);
  const [dirty, setDirty] = useState(false);
  const [rightTab, setRightTab] = useState<"content" | "quiz">("content");
  const [mdView, setMdView] = useState<"write" | "preview">("write");
  const [levelModal, setLevelModal] = useState<{ mode: "add" | "edit"; level?: AdminLevel } | null>(null);
  const [savingLevel, setSavingLevel] = useState(false);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [newModTitle, setNewModTitle] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const loadLevels = useCallback(async () => {
    try { setLevels(await CurriculumApi.levels()); } catch (e) { setError(errorMessage(e, "Could not load levels.")); }
  }, []);
  const loadMods = useCallback(async (levelNo: number) => {
    try { const ms = await CurriculumApi.modules(levelNo); setModsByLevel((p) => ({ ...p, [levelNo]: ms })); return ms; }
    catch { return []; }
  }, []);

  useEffect(() => { void loadLevels(); }, [loadLevels]);
  useEffect(() => {
    if (routeLevel == null) return;
    setExpanded((p) => new Set([...p, routeLevel]));
    void loadMods(routeLevel).then((ms) => {
      if (searchParams.get("newModule") === "true") setAddingTo(routeLevel);
      else if (ms[0]) setSelectedId((cur) => cur ?? ms[0]!.module_id);
    });
  }, [routeLevel, loadMods, searchParams]);

  // Load full module when selection changes.
  useEffect(() => {
    if (!selectedId) { setMod(null); setDraft(null); return; }
    void CurriculumApi.module(selectedId).then((m) => { setMod(m); setDraft(m); setDirty(false); setMdView("write"); }).catch((e) => setError(errorMessage(e, "Could not load module.")));
  }, [selectedId]);

  function setField<K extends keyof AdminModule>(key: K, val: AdminModule[K]): void {
    setDraft((d) => (d ? { ...d, [key]: val } : d));
    setDirty(true);
  }
  function toggleExpand(n: number): void {
    setExpanded((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else { s.add(n); if (!modsByLevel[n]) void loadMods(n); } return s; });
  }

  // ── Markdown helpers ──
  function wrap(before: string, after = before, ph = "text"): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = draft.lesson_content, sel = v.slice(s, e) || ph;
    setField("lesson_content", v.slice(0, s) + before + sel + after + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }
  function prefix(p: string): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, e = ta.selectionEnd, v = draft.lesson_content, ls = v.lastIndexOf("\n", s - 1) + 1;
    const block = v.slice(ls, e) || "list item";
    const replaced = block.split("\n").map((l) => p + l).join("\n");
    setField("lesson_content", v.slice(0, ls) + replaced + v.slice(e));
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(ls, ls + replaced.length); });
  }
  function insert(text: string): void {
    const ta = contentRef.current; if (!ta || !draft) return;
    const s = ta.selectionStart, v = draft.lesson_content;
    setField("lesson_content", v.slice(0, s) + text + v.slice(s));
    requestAnimationFrame(() => { ta.focus(); const pos = s + text.length; ta.setSelectionRange(pos, pos); });
  }

  async function saveModule(): Promise<void> {
    if (!draft || !mod) return;
    setError(null); setNotice(null);
    const verses = (draft.key_verses ?? []);
    try {
      const updated = await CurriculumApi.updateModule(mod.module_id, {
        title: draft.title, summary: draft.summary, lesson_content: draft.lesson_content,
        evaluation_kind: draft.evaluation_kind, quiz_pass_mark: Number(draft.quiz_pass_mark),
        estimated_minutes: draft.estimated_minutes, video_url: draft.video_url || null,
        key_verses: verses.length ? verses : null, max_attempts: draft.max_attempts,
        difficulty: draft.difficulty, objectives: draft.objectives || null, tags: draft.tags || null,
        visibility: draft.visibility, required: draft.required,
        expected_row_version: mod.row_version,
      });
      setMod(updated as AdminModule); setDraft(updated as AdminModule); setDirty(false); setNotice("Saved.");
      if (routeLevel != null) void loadMods((updated as AdminModule).level_number);
      else void loadMods((updated as AdminModule).level_number);
    } catch (e) { setError(errorMessage(e, "Save failed — the module may have changed elsewhere (reload).")); }
  }
  // ── Per-module quiz settings (Quiz tab) ──
  // Decode the module row → Figma QuizSettings; persist via updateModule (PR #117 fields).
  function moduleQuizSettings(m: AdminModule): QuizSettings {
    return {
      passMark: Math.round(Number(m.quiz_pass_mark) || 70),
      shuffleQuestions: m.quiz_shuffle ?? false,
      showAnswersAfterSubmit: m.quiz_show_answers ?? false,
      showScoreAfterSubmit: m.quiz_show_score ?? true,
      timeLimitMinutes: m.time_limit_sec != null ? Math.round(m.time_limit_sec / 60) : null,
    };
  }
  async function saveModuleQuizSettings(m: AdminModule, s: QuizSettings): Promise<void> {
    const updated = await CurriculumApi.updateModule(m.module_id, {
      quiz_pass_mark: s.passMark,
      quiz_shuffle: s.shuffleQuestions,
      quiz_show_answers: s.showAnswersAfterSubmit,
      quiz_show_score: s.showScoreAfterSubmit,
      time_limit_sec: s.timeLimitMinutes != null ? s.timeLimitMinutes * 60 : null,
      expected_row_version: m.row_version,
    });
    setMod(updated as AdminModule); setDraft(updated as AdminModule);
    void loadMods((updated as AdminModule).level_number);
  }

  async function togglePublish(): Promise<void> {
    if (!mod) return;
    try {
      const updated = mod.status === "published" ? await CurriculumApi.unpublish(mod.module_id) : await CurriculumApi.publish(mod.module_id);
      setMod(updated); setDraft(updated); setNotice(updated.status === "published" ? "Published." : "Unpublished.");
      void loadMods(updated.level_number);
    } catch (e) { setError(errorMessage(e, "Publish rejected by validation (quiz needs questions / contiguous sequence).")); }
  }
  async function archiveModule(): Promise<void> {
    if (!mod) return;
    try { await CurriculumApi.archive(mod.module_id); setNotice("Module archived."); void loadMods(mod.level_number); setSelectedId(null); }
    catch (e) { setError(errorMessage(e, "Archive failed.")); }
  }
  async function addModule(levelNo: number): Promise<void> {
    if (!newModTitle.trim()) return;
    try {
      const created = await CurriculumApi.createModule({ level_number: levelNo, title: newModTitle.trim(), lesson_content: "Draft content — edit here.", evaluation_kind: "none" });
      setNewModTitle(""); setAddingTo(null);
      await loadMods(levelNo);
      setSelectedId((created as AdminModule).module_id);
    } catch (e) { setError(errorMessage(e, "Could not add module.")); }
  }
  async function handleSaveLevel(data: LevelFormData): Promise<void> {
    setSavingLevel(true); setError(null);
    const body = { title: data.title, theme: data.theme, required_exam_pass_mark: data.passMark, duration: data.duration, status: labelToBe[data.status], locked: data.locked, color: data.color };
    try {
      if (levelModal?.mode === "add") await CurriculumApi.createLevel(body);
      else if (levelModal?.level) await CurriculumApi.updateLevel(levelModal.level.level_number, body);
      setLevelModal(null); await loadLevels();
    } catch (e) { setError(errorMessage(e, "Save failed.")); }
    finally { setSavingLevel(false); }
  }

  const selectedLevel = mod ? levels.find((l) => l.level_number === mod.level_number) : null;
  const allModulesCount = Object.values(modsByLevel).reduce((s, m) => s + m.length, 0);
  const publishedCount = Object.values(modsByLevel).flat().filter((m) => m.status === "published").length;
  const verses = draft ? (draft.key_verses ?? []) : [];

  const tools: { Icon: typeof Bold; title: string; act: () => void; group?: boolean }[] = [
    { Icon: Heading1, title: "H1", act: () => prefix("# ") },
    { Icon: Heading2, title: "H2", act: () => prefix("## ") },
    { Icon: Heading3, title: "H3", act: () => prefix("### ") },
    { Icon: Bold, title: "Bold", act: () => wrap("**", "**", "bold"), group: true },
    { Icon: Italic, title: "Italic", act: () => wrap("_", "_", "italic") },
    { Icon: Strikethrough, title: "Strikethrough", act: () => wrap("~~", "~~", "strike") },
    { Icon: Code2, title: "Code", act: () => wrap("`", "`", "code") },
    { Icon: Quote, title: "Quote", act: () => prefix("> "), group: true },
    { Icon: List, title: "Bullets", act: () => prefix("- ") },
    { Icon: ListOrdered, title: "Numbered", act: () => prefix("1. ") },
    { Icon: LinkIcon, title: "Link", act: () => wrap("[", "](https://)", "link"), group: true },
    { Icon: ImageIcon, title: "Image", act: () => insert("![alt](https://)") },
    { Icon: TableIcon, title: "Table", act: () => insert("\n| A | B |\n| --- | --- |\n| 1 | 2 |\n") },
    { Icon: Minus, title: "Divider", act: () => insert("\n---\n") },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      {/* Header band */}
      <div style={{ background: "var(--nuru-dark)", padding: "16px clamp(16px,3vw,36px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexShrink: 0, flexWrap: "wrap" }}>
        <div>
          <div className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginBottom: 5 }}>
            <button onClick={() => navigate("/cms")} style={{ color: "rgba(232,239,245,0.45)", background: "none", border: "none" }}>Curriculum</button>
            <ChevronRight size={10} /><span style={{ color: "rgba(232,239,245,0.7)" }}>Level Detail</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.01em" }}>Levels &amp; Modules</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {[{ label: "Levels", val: levels.length }, { label: "Modules", val: allModulesCount }, { label: "Published", val: publishedCount }].map((s) => (
            <div key={s.label} style={{ textAlign: "center", padding: "4px 16px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "rgba(232,239,245,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
          <button onClick={() => setLevelModal({ mode: "add" })} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, boxShadow: "0 6px 18px rgba(200,155,60,0.30)", border: "none", flexShrink: 0 }}><Plus size={14} /> New level</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT — tree */}
        <div style={{ width: 272, flexShrink: 0, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>{levels.length} levels · {allModulesCount} loaded</p>
          </div>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
            {levels.map((level) => {
              const mods = modsByLevel[level.level_number] ?? [];
              const pub = mods.filter((m) => m.status === "published").length;
              const isOpen = expanded.has(level.level_number);
              return (
                <div key={level.level_number}>
                  <div onClick={() => toggleExpand(level.level_number)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: `linear-gradient(90deg, ${level.color}18 0%, transparent 80%)`, borderLeft: `4px solid ${level.color}`, borderBottom: "1px solid var(--border)", cursor: "pointer", userSelect: "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: level.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0, boxShadow: `0 2px 6px ${level.color}44` }}>L{level.level_number}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)", lineHeight: 1.25, display: "flex", alignItems: "center", gap: 5 }}>{level.title}{level.locked ? <Lock size={9} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} /> : null}</div>
                      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{pub} published · {mods.length - pub} draft</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); setLevelModal({ mode: "edit", level }); }} title="Edit level" style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}><Pencil size={10} /></button>
                    {isOpen ? <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={12} style={{ color: "var(--muted-foreground)" }} />}
                  </div>
                  {isOpen ? (
                    <div>
                      {mods.map((m) => {
                        const sel = m.module_id === selectedId;
                        const sp = statusPill[m.status] ?? statusPill.draft!;
                        return (
                          <div key={m.module_id} onClick={() => { setSelectedId(m.module_id); setRightTab("content"); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 18px", background: sel ? `${level.color}10` : "transparent", borderLeft: sel ? `4px solid ${level.color}` : "4px solid transparent", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                            <span style={{ fontSize: 9.5, fontWeight: 800, minWidth: 22, textAlign: "center", padding: "2px 5px", borderRadius: 5, background: sel ? level.color : "var(--secondary)", color: sel ? "#fff" : "var(--muted-foreground)", flexShrink: 0 }}>{m.module_sequence_number}</span>
                            <span style={{ flex: 1, fontSize: 12.5, fontWeight: sel ? 700 : 500, color: sel ? "var(--nuru-navy)" : "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, ...sp, flexShrink: 0, letterSpacing: "0.04em" }}>{m.status.toUpperCase()}</span>
                            <button onClick={(e) => { e.stopPropagation(); setSelectedId(m.module_id); setRightTab("quiz"); }} title="Quiz" style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${sel && rightTab === "quiz" ? level.color : "var(--border)"}`, background: sel && rightTab === "quiz" ? level.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, color: sel && rightTab === "quiz" ? "#fff" : "var(--muted-foreground)" }}><ClipboardList size={10} /></button>
                          </div>
                        );
                      })}
                      {addingTo === level.level_number ? (
                        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
                          <input autoFocus value={newModTitle} onChange={(e) => setNewModTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addModule(level.level_number); if (e.key === "Escape") { setAddingTo(null); setNewModTitle(""); } }} placeholder="Module title…" style={{ width: "100%", height: 32, borderRadius: 8, border: `1.5px solid ${level.color}55`, background: "var(--card)", fontSize: 12.5, padding: "0 10px", color: "var(--foreground)", outline: "none" }} />
                          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                            <button onClick={() => void addModule(level.level_number)} disabled={!newModTitle.trim()} style={{ flex: 1, height: 28, borderRadius: 7, border: "none", background: newModTitle.trim() ? level.color : "var(--muted)", color: newModTitle.trim() ? "#fff" : "var(--muted-foreground)", fontSize: 11.5, fontWeight: 700, cursor: newModTitle.trim() ? "pointer" : "not-allowed" }}>Create</button>
                            <button onClick={() => { setAddingTo(null); setNewModTitle(""); }} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={11} /></button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => setAddingTo(level.level_number)} style={{ width: "100%", padding: "7px 18px", textAlign: "left", display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 600, color: level.color, background: "transparent", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}><Plus size={11} /> New module</button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div style={{ height: 24 }} />
          </div>
        </div>

        {/* RIGHT — editor */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--background)" }}>
          {!draft ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-foreground)", gap: 8 }}>
              <BookOpen size={36} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>Select a module to begin editing</p>
              <p style={{ fontSize: 12 }}>Choose from the panel on the left</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
              {/* Sticky header */}
              <div style={{ flexShrink: 0, background: "var(--card)", borderBottom: "1px solid var(--border)", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  {selectedLevel ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${selectedLevel.color}18`, color: selectedLevel.color, border: `1px solid ${selectedLevel.color}30` }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: selectedLevel.color }} /> L{selectedLevel.level_number} · {selectedLevel.title}</span> : null}
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 21, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Module {draft.module_sequence_number}</h2>
                  <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 999, ...(statusPill[draft.status] ?? statusPill.draft!), letterSpacing: "0.04em" }}>{draft.status.toUpperCase()}</span>
                  {dirty ? <span style={{ fontSize: 11, color: "var(--nuru-gold)", fontWeight: 700, display: "flex", alignItems: "center", gap: 4 }}><AlertTriangle size={11} /> unsaved</span> : null}
                </div>
                <div style={{ display: "flex", gap: 2, background: "var(--secondary)", borderRadius: 10, padding: 3, flexShrink: 0 }}>
                  {(["content", "quiz"] as const).map((tab) => (
                    <button key={tab} onClick={() => setRightTab(tab)} style={{ height: 30, padding: "0 14px", borderRadius: 8, border: "none", background: rightTab === tab ? "#fff" : "transparent", color: rightTab === tab ? "var(--nuru-navy)" : "var(--muted-foreground)", fontSize: 12, fontWeight: rightTab === tab ? 700 : 500, cursor: "pointer", boxShadow: rightTab === tab ? "0 1px 4px rgba(0,0,0,0.08)" : "none", display: "flex", alignItems: "center", gap: 6 }}>{tab === "content" ? <><FileText size={12} /> Content</> : <><ClipboardList size={12} /> Quiz</>}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button onClick={() => setMdView((v) => (v === "preview" ? "write" : "preview"))} style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><Eye size={12} /> Preview</button>
                </div>
              </div>

              {notice ? <div style={{ padding: "8px 28px", color: "#0F6B33", fontSize: 12.5, background: "#F3FAF5", borderBottom: "1px solid var(--border)" }}>{notice}</div> : null}
              {error ? <div style={{ padding: "8px 28px", color: "#A8281F", fontSize: 12.5, background: "#FDF4F4", borderBottom: "1px solid var(--border)" }}>{error}</div> : null}

              {/* Quiz tab — six-type builder wired to this module's question bank (§1.9). */}
              {rightTab === "quiz" ? (
                <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
                  <div style={{ padding: "20px 28px", maxWidth: 1040 }}>
                    {mod && draft && draft.evaluation_kind !== "quiz" ? (
                      <div className="flex items-start" style={{ gap: 10, marginBottom: 16, padding: "12px 14px", borderRadius: 10, background: "rgba(217,119,6,0.06)", border: "1px solid rgba(217,119,6,0.2)", color: "#8A6B1F", fontSize: 12.5 }}>
                        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                        <span>This module's evaluation kind is <strong>{draft.evaluation_kind}</strong>. Set it to <strong>Quiz</strong> in the Content tab for these questions to be served and graded.</span>
                      </div>
                    ) : null}
                    {mod ? (
                      <ModuleQuizBuilder
                        key={mod.module_id}
                        moduleId={mod.module_id}
                        accent={selectedLevel?.color ?? "var(--nuru-gold)"}
                        settings={moduleQuizSettings(mod)}
                        onSaveSettings={(s) => saveModuleQuizSettings(mod, s)}
                        settingsLabel="Quiz settings"
                      />
                    ) : (
                      <div style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Select a module to build its quiz.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
                  <div style={{ padding: "24px 28px", maxWidth: 820 }}>
                    {/* Basics */}
                    <SectionHead icon={<BookOpen size={14} />} label="Module basics" />
                    <div style={{ marginBottom: 18 }}>
                      <label style={fieldLabel}>Title</label>
                      <input value={draft.title} onChange={(e) => setField("title", e.target.value)} placeholder="e.g. Understanding Salvation" style={{ ...fieldInput, fontSize: 14, fontWeight: 500 }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 18 }}>
                      <div>
                        <label style={fieldLabel}>Difficulty</label>
                        <select value={draft.difficulty} onChange={(e) => setField("difficulty", e.target.value as AdminModule["difficulty"])} style={{ ...fieldInput, fontWeight: 600 }}>
                          <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
                        </select>
                      </div>
                      <div>
                        <label style={fieldLabel}>Estimated minutes</label>
                        <input type="number" min={1} value={draft.estimated_minutes ?? 0} onChange={(e) => setField("estimated_minutes", Number(e.target.value))} style={fieldInput} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 18 }}>
                      <label style={fieldLabel}>Summary</label>
                      <textarea value={draft.summary ?? ""} onChange={(e) => setField("summary", e.target.value)} rows={2} placeholder="One or two lines describing this module…" style={areaInput} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 18 }}>
                      <div>
                        <label style={fieldLabel}><Target size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Learning objectives <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(one per line)</span></label>
                        <textarea value={draft.objectives ?? ""} onChange={(e) => setField("objectives", e.target.value)} rows={3} placeholder={"Define new birth\nExplain repentance"} style={areaInput} />
                      </div>
                      <div>
                        <label style={fieldLabel}><BookOpen size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Key scripture <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(one per line)</span></label>
                        <textarea value={verses.join("\n")} onChange={(e) => setField("key_verses", e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))} rows={3} placeholder={"John 3:3\nEphesians 2:8-9"} style={areaInput} />
                      </div>
                    </div>
                    <div style={{ marginBottom: 22 }}>
                      <label style={fieldLabel}><Tag size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Tags <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(comma-separated)</span></label>
                      <input value={draft.tags ?? ""} onChange={(e) => setField("tags", e.target.value)} placeholder="salvation, grace, faith" style={fieldInput} />
                      {(draft.tags ?? "").trim() ? (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                          {(draft.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean).map((t) => (
                            <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 600, color: "var(--nuru-navy)", background: "var(--secondary)", borderRadius: 999, padding: "3px 10px" }}><Hash size={10} style={{ color: "var(--nuru-gold)" }} /> {t}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div style={{ height: 1, background: "var(--border)", marginBottom: 22 }} />
                    <SectionHead icon={<ClipboardList size={14} />} label="Evaluation & gating" />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 18 }}>
                      <div>
                        <label style={fieldLabel}>Evaluation kind <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(drives gating)</span></label>
                        <select value={draft.evaluation_kind} onChange={(e) => setField("evaluation_kind", e.target.value as EvaluationKind)} style={{ ...fieldInput, fontWeight: 600 }}>
                          {EVAL_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={fieldLabel}>Quiz pass mark (%)</label>
                        <input type="number" min={0} max={100} value={Number(draft.quiz_pass_mark)} disabled={draft.evaluation_kind !== "quiz"} onChange={(e) => setField("quiz_pass_mark", String(Number(e.target.value)) as unknown as AdminModule["quiz_pass_mark"])} style={{ ...fieldInput, background: draft.evaluation_kind !== "quiz" ? "var(--secondary)" : "var(--input-background)", color: draft.evaluation_kind !== "quiz" ? "var(--muted-foreground)" : "var(--foreground)" }} />
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 18 }}>
                      <div>
                        <label style={fieldLabel}>Quiz attempts allowed</label>
                        <input type="number" min={1} max={50} value={draft.max_attempts ?? 3} disabled={draft.evaluation_kind !== "quiz"} onChange={(e) => setField("max_attempts", Number(e.target.value))} style={{ ...fieldInput, background: draft.evaluation_kind !== "quiz" ? "var(--secondary)" : "var(--input-background)", color: draft.evaluation_kind !== "quiz" ? "var(--muted-foreground)" : "var(--foreground)" }} />
                      </div>
                      <div>
                        <label style={fieldLabel}>Visibility</label>
                        <select value={draft.visibility} onChange={(e) => setField("visibility", e.target.value as AdminModule["visibility"])} style={{ ...fieldInput, fontWeight: 600 }}>
                          <option value="members">Members</option><option value="leaders">Leaders only</option><option value="public">Public</option>
                        </select>
                      </div>
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22, cursor: "pointer" }}>
                      <span onClick={() => setField("required", !draft.required)} style={{ width: 36, height: 20, borderRadius: 999, background: draft.required ? "var(--nuru-teal)" : "var(--switch-background)", position: "relative", flexShrink: 0, transition: "background 0.15s" }}>
                        <span style={{ position: "absolute", top: 2, left: draft.required ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
                      </span>
                      <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>Required to advance to the next module</span>
                    </label>

                    <div style={{ height: 1, background: "var(--border)", marginBottom: 22 }} />
                    <SectionHead icon={<Video size={14} />} label="Lesson media" />
                    <div style={{ marginBottom: 22 }}>
                      <label style={fieldLabel}>Lesson video URL <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(or manage in the <button onClick={() => navigate("/video-library")} style={{ color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 600, padding: 0 }}>Video Library</button>)</span></label>
                      <input value={draft.video_url ?? ""} onChange={(e) => setField("video_url", e.target.value || null)} placeholder="https://…" style={fieldInput} />
                    </div>

                    <div style={{ height: 1, background: "var(--border)", marginBottom: 22 }} />
                    <SectionHead icon={<FileText size={14} />} label="Lesson content · Markdown" />
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", padding: "6px 10px", borderRadius: "10px 10px 0 0", border: "1.5px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--secondary)", opacity: mdView === "preview" ? 0.5 : 1, pointerEvents: mdView === "preview" ? "none" : "auto" }}>
                      {tools.map(({ Icon, title, act, group }) => (
                        <span key={title} style={{ display: "inline-flex", alignItems: "center" }}>
                          {group ? <span style={{ width: 1, height: 18, background: "var(--border)", margin: "0 4px" }} /> : null}
                          <button title={title} onClick={act} style={{ width: 28, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={14} /></button>
                        </span>
                      ))}
                      <div style={{ flex: 1, minWidth: 8 }} />
                      <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{draft.lesson_content.length} chars</span>
                    </div>
                    {mdView === "write" ? (
                      <textarea ref={contentRef} value={draft.lesson_content} onChange={(e) => setField("lesson_content", e.target.value)} rows={16} placeholder={"## Section heading\n\nWrite the lesson here…"} style={{ width: "100%", borderRadius: "0 0 10px 10px", border: "1.5px solid var(--border)", borderTop: "none", background: "var(--input-background)", fontSize: 13, padding: "12px 14px", color: "var(--foreground)", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "var(--font-mono), monospace" }} />
                    ) : (
                      <div style={{ minHeight: 320, borderRadius: "0 0 10px 10px", border: "1.5px solid var(--border)", borderTop: "none", background: "var(--card)", padding: "16px 18px" }}>
                        {draft.lesson_content.trim() ? <MarkdownPreview content={draft.lesson_content} /> : <p style={{ color: "var(--muted-foreground)" }}>Nothing to preview yet.</p>}
                      </div>
                    )}

                    {/* Footer */}
                    <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 22, paddingBottom: 40, flexWrap: "wrap" }}>
                      <button onClick={() => void saveModule()} disabled={!dirty} style={{ height: 40, padding: "0 22px", borderRadius: 10, border: "none", background: dirty ? "var(--nuru-navy)" : "var(--muted)", color: dirty ? "#fff" : "var(--muted-foreground)", fontSize: 13, fontWeight: 700, cursor: dirty ? "pointer" : "default", boxShadow: dirty ? "0 4px 12px rgba(11,31,51,0.18)" : "none" }}>Save draft</button>
                      <button onClick={() => void togglePublish()} style={{ height: 40, padding: "0 22px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", cursor: "pointer" }}>{draft.status === "published" ? "Unpublish" : "Publish"}</button>
                      {dirty ? <span style={{ fontSize: 11.5, color: "var(--nuru-gold)", fontWeight: 700, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={12} /> You have unsaved changes</span> : null}
                      <div style={{ marginLeft: "auto" }}>
                        <button onClick={() => void archiveModule()} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #FECACA", background: "#FFF5F5", fontSize: 12, fontWeight: 600, color: "#DC2626", cursor: "pointer" }}>Archive module</button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {levelModal ? (
        <LevelModal
          mode={levelModal.mode}
          levelNumber={levelModal.level?.level_number ?? levels.length + 1}
          saving={savingLevel}
          {...(levelModal.level ? { initialData: { title: levelModal.level.title, theme: levelModal.level.theme ?? "", passMark: Math.round(Number(levelModal.level.required_exam_pass_mark) || 0), duration: levelModal.level.duration ?? "8 weeks", status: beToLabel[levelModal.level.status] ?? "Draft", locked: levelModal.level.locked, color: levelModal.level.color } } : {})}
          onSave={(d) => void handleSaveLevel(d)}
          onClose={() => setLevelModal(null)}
        />
      ) : null}
    </div>
  );
}

function SectionHead({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--secondary)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--nuru-navy)" }}>{icon}</span>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{label}</div>
    </div>
  );
}
