// Shared quiz builder for the six Figma question types (multiple_choice, checkbox,
// dropdown, short_answer, paragraph, linear_scale). Server-authoritative (§1.9):
// questions live in question_bank, scoring/gating never originate on the client.
//
// Reused by both wiring contexts:
//   - the per-MODULE quiz (LevelDetail → module question endpoints + updateModule settings)
//   - the per-LEVEL final exam (QuizBuilder page → exit-exam module questions + updateExam settings)
// The parent supplies a `moduleId` (where questions are stored) and a `settings`
// save callback; everything else (load/encode/decode/save of questions) is here.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  Plus, Save, Trash2, Copy, ChevronUp, ChevronDown, Check, HelpCircle,
  ListChecks, CheckSquare, ChevronDownSquare, Type as TypeIcon, AlignLeft, SlidersHorizontal,
  Sparkles, Clock, Shuffle, Eye, BarChart3, AlertTriangle, Info,
} from "lucide-react";
import {
  CurriculumApi, type AdminQuestion, type QuestionChoice,
} from "../../api/client";
import { errorMessage } from "../../util/error";

// ---- Figma model -----------------------------------------------------------
export type QType =
  | "multiple_choice" | "checkbox" | "dropdown"
  | "short_answer" | "paragraph" | "linear_scale";

export interface QuizOption { id: string; text: string; isCorrect: boolean }
export interface QuizQuestion {
  key: string;            // stable local key for React
  questionId: string | null;
  type: QType;
  text: string;
  options: QuizOption[];
  points: number;
  required: boolean;
  explanation: string;
  active: boolean;
  minLabel: string;
  maxLabel: string;
  minVal: number;
  maxVal: number;
}

export interface QuizSettings {
  showAnswersAfterSubmit: boolean;
  showScoreAfterSubmit: boolean;
  shuffleQuestions: boolean;
  passMark: number;
  timeLimitMinutes: number | null;
}

const CHOICE_TYPES: QType[] = ["multiple_choice", "checkbox", "dropdown"];
const isChoice = (t: QType): boolean => CHOICE_TYPES.includes(t);
const isManual = (t: QType): boolean => t === "short_answer" || t === "paragraph";
const isMulti = (t: QType): boolean => t === "checkbox";

const typeMeta: Record<QType, { label: string; hint: string; icon: typeof HelpCircle; tint: string }> = {
  multiple_choice: { label: "Multiple choice", hint: "One correct answer (radio)", icon: ListChecks, tint: "#7C3AED" },
  checkbox:        { label: "Checkboxes",      hint: "One or more correct (multi)", icon: CheckSquare, tint: "#0B84E8" },
  dropdown:        { label: "Dropdown",        hint: "One correct answer (select)", icon: ChevronDownSquare, tint: "#0EA5A4" },
  short_answer:    { label: "Short answer",    hint: "Reviewer scores manually",    icon: TypeIcon, tint: "#16A34A" },
  paragraph:       { label: "Paragraph",       hint: "Reviewer scores manually",    icon: AlignLeft, tint: "#D97706" },
  linear_scale:    { label: "Linear scale",    hint: "Rating scale (collected)",    icon: SlidersHorizontal, tint: "#DB2777" },
};
const ALL_TYPES = Object.keys(typeMeta) as QType[];

let SEQ = 1;
const nextKey = (): string => `local-${SEQ++}`;
const optId = (): string => `opt-${Math.random().toString(36).slice(2, 8)}`;

// ---- decode: AdminQuestion (backend row) → QuizQuestion --------------------
/** Map a legacy q_type to the closest Figma type so old rows still render/edit. */
function decodeType(t: AdminQuestion["q_type"]): QType {
  switch (t) {
    case "multiple_choice": case "checkbox": case "dropdown":
    case "short_answer": case "paragraph": case "linear_scale":
      return t;
    case "MultipleChoice": return "multiple_choice";
    case "TrueFalse": return "multiple_choice";
    case "FillInTheBlank": return "short_answer";
    default: return "short_answer";
  }
}

function decodeChoices(a: AdminQuestion): QuizOption[] {
  const ao = a.answer_options;
  // Figma shape: { choices: [...] }
  if (ao && !Array.isArray(ao) && "choices" in ao && Array.isArray(ao.choices)) {
    return ao.choices.map((c: QuestionChoice) => ({
      id: c.id ?? optId(), text: c.text, isCorrect: !!c.is_correct,
    }));
  }
  // Legacy string[] options + scalar/array correct_answer.
  if (Array.isArray(ao)) {
    let correctSet = new Set<string>();
    try {
      const parsed = JSON.parse(a.correct_answer);
      if (Array.isArray(parsed)) correctSet = new Set(parsed.map(String));
      else correctSet = new Set([a.correct_answer]);
    } catch {
      correctSet = new Set([a.correct_answer]);
    }
    return ao.map((text) => ({ id: optId(), text, isCorrect: correctSet.has(text) }));
  }
  return [];
}

function decodeScale(a: AdminQuestion): { minVal: number; maxVal: number; minLabel: string; maxLabel: string } {
  const ao = a.answer_options;
  if (ao && !Array.isArray(ao) && "scale" in ao && ao.scale) {
    return {
      minVal: ao.scale.min, maxVal: ao.scale.max,
      minLabel: ao.scale.min_label ?? "", maxLabel: ao.scale.max_label ?? "",
    };
  }
  return { minVal: 1, maxVal: 5, minLabel: "", maxLabel: "" };
}

export function fromApi(a: AdminQuestion): QuizQuestion {
  const type = decodeType(a.q_type);
  const scale = decodeScale(a);
  return {
    key: a.question_id,
    questionId: a.question_id,
    type,
    text: a.question_text,
    options: isChoice(type) ? decodeChoices(a) : [],
    points: a.points,
    required: a.required ?? true,
    explanation: a.explanation ?? "",
    active: a.is_active,
    minLabel: scale.minLabel,
    maxLabel: scale.maxLabel,
    minVal: scale.minVal,
    maxVal: scale.maxVal,
  };
}

// ---- encode: QuizQuestion → backend create/update payload ------------------
export function toPayload(q: QuizQuestion): Record<string, unknown> {
  const base: Record<string, unknown> = {
    q_type: q.type,
    question_text: q.text.trim(),
    points: q.points,
    required: q.required,
    explanation: q.explanation.trim() || null,
    is_active: q.active,
  };
  if (isChoice(q.type)) {
    base.options = q.options
      .filter((o) => o.text.trim().length > 0)
      .map((o) => ({ id: o.id, text: o.text.trim(), is_correct: o.isCorrect }));
  } else if (q.type === "linear_scale") {
    base.scale_min = q.minVal;
    base.scale_max = q.maxVal;
    base.scale_min_label = q.minLabel.trim() || null;
    base.scale_max_label = q.maxLabel.trim() || null;
  } else if (q.type === "short_answer") {
    base.correct_answer = ""; // reviewer-scored; no key from this UI
  }
  return base;
}

function blank(type: QType): QuizQuestion {
  return {
    key: nextKey(), questionId: null, type, text: "",
    options: isChoice(type)
      ? [
          { id: optId(), text: "Option 1", isCorrect: type !== "checkbox" },
          { id: optId(), text: "Option 2", isCorrect: false },
        ]
      : [],
    points: 1, required: true, explanation: "", active: true,
    minLabel: "", maxLabel: "", minVal: 1, maxVal: 5,
  };
}

/** A question is "valid" (savable) when it has text and a coherent answer config. */
export function isValid(q: QuizQuestion): boolean {
  if (!q.text.trim()) return false;
  if (isChoice(q.type)) {
    const filled = q.options.filter((o) => o.text.trim().length > 0);
    if (filled.length < 1) return false;
    const correct = filled.filter((o) => o.isCorrect);
    return isMulti(q.type) ? correct.length >= 1 : correct.length === 1;
  }
  if (q.type === "linear_scale") return q.minVal < q.maxVal;
  return true; // short_answer / paragraph need only text
}

// ===========================================================================

export interface ModuleQuizBuilderProps {
  /** Module that owns the question bank (a regular module OR the level exit-exam module). */
  moduleId: string;
  /** Accent color for the active-card rail (level color). */
  accent?: string;
  /** Initial settings (decoded by the parent from the module/level row). */
  settings: QuizSettings;
  /** Persist settings (updateModule for a module quiz, updateExam for a level exam). */
  onSaveSettings: (s: QuizSettings, activeCount: number) => Promise<void>;
  /** Optional label for the settings panel header ("Quiz settings" / "Exam settings"). */
  settingsLabel?: string;
}

export function ModuleQuizBuilder({
  moduleId, accent = "var(--nuru-gold)", settings: initialSettings, onSaveSettings, settingsLabel = "Quiz settings",
}: ModuleQuizBuilderProps): ReactElement {
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [settings, setSettings] = useState<QuizSettings>(initialSettings);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-sync settings if the parent swaps the target (level/module change).
  useEffect(() => { setSettings(initialSettings); }, [initialSettings]);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotice(null); setDeleted([]); setExpanded(null);
    try {
      const rows = await CurriculumApi.questions(moduleId);
      const mapped = rows.map(fromApi);
      setQuestions(mapped);
      setExpanded(mapped[0]?.key ?? null);
    } catch (e) {
      setError(errorMessage(e, "Could not load questions."));
    } finally {
      setLoading(false);
    }
  }, [moduleId]);

  useEffect(() => { void load(); }, [load]);

  const active = useMemo(() => questions.filter((q) => q.active), [questions]);
  const totalPoints = useMemo(() => active.reduce((s, q) => s + q.points, 0), [active]);
  const passingPoints = Math.ceil(totalPoints * (settings.passMark / 100));

  function patch(key: string, fn: (q: QuizQuestion) => QuizQuestion): void {
    setQuestions((prev) => prev.map((q) => (q.key === key ? fn(q) : q)));
  }
  function add(type: QType): void {
    const q = blank(type);
    setQuestions((prev) => [...prev, q]);
    setExpanded(q.key); setAddOpen(false);
  }
  function duplicate(key: string): void {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.key === key);
      if (idx < 0) return prev;
      const copy: QuizQuestion = {
        ...prev[idx]!,
        key: nextKey(), questionId: null,
        options: prev[idx]!.options.map((o) => ({ ...o, id: optId() })),
        text: prev[idx]!.text ? `${prev[idx]!.text} (copy)` : "",
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
  }
  function move(key: string, dir: -1 | 1): void {
    setQuestions((prev) => {
      const idx = prev.findIndex((q) => q.key === key);
      const swap = idx + dir;
      if (idx < 0 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap]!, next[idx]!];
      return next;
    });
  }
  function remove(q: QuizQuestion): void {
    if (q.questionId) setDeleted((d) => [...d, q.questionId as string]);
    setQuestions((prev) => prev.filter((x) => x.key !== q.key));
  }

  async function save(): Promise<void> {
    setSaving(true); setError(null); setNotice(null);
    try {
      await onSaveSettings(settings, active.length);
      for (const id of deleted) await CurriculumApi.deleteQuestion(id);
      const valid = questions.filter(isValid);
      const fresh = valid.filter((q) => !q.questionId);
      const edits = valid.filter((q) => q.questionId);
      if (fresh.length) await CurriculumApi.addQuestions(moduleId, fresh.map(toPayload));
      for (const q of edits) await CurriculumApi.updateQuestion(q.questionId as string, toPayload(q));
      const skipped = questions.length - valid.length;
      await load();
      setNotice(skipped > 0 ? `Saved. ${skipped} question(s) still need a valid answer and were skipped.` : "Saved.");
    } catch (e) {
      setError(errorMessage(e, "Save failed."));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading questions…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {notice ? <Banner tone="ok" text={notice} /> : null}
      {error ? <Banner tone="err" text={error} /> : null}

      {/* Summary card */}
      <div className="nuru-card" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
        <Stat label="Questions" value={String(active.length)} hint={`${questions.length - active.length} draft`} />
        <Stat label="Total points" value={String(totalPoints)} hint={`Pass at ${passingPoints} pts`} />
        <Stat label="Pass mark" value={`${settings.passMark}%`} hint={settings.timeLimitMinutes ? `${settings.timeLimitMinutes} min` : "No time limit"} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
          {settings.shuffleQuestions ? <Chip icon={<Shuffle size={11} />} label="Shuffled" /> : null}
          {settings.showAnswersAfterSubmit ? <Chip icon={<Eye size={11} />} label="Answers shown" /> : null}
          {settings.showScoreAfterSubmit ? <Chip icon={<BarChart3 size={11} />} label="Score shown" /> : null}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 18, alignItems: "start" }} className="quiz-builder-grid">
        {/* Questions column */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {/* Add toolbar */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "space-between" }}>
            <div style={{ position: "relative" }}>
              <button onClick={() => setAddOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>
                <Plus size={14} /> Add question <ChevronDown size={12} />
              </button>
              {addOpen ? (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setAddOpen(false)} />
                  <div style={{ position: "absolute", left: 0, marginTop: 4, width: 272, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 12px 36px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 31 }}>
                    {ALL_TYPES.map((t) => {
                      const m = typeMeta[t]; const Icon = m.icon;
                      return (
                        <button key={t} onClick={() => add(t)} className="w-full flex items-center" style={{ gap: 10, padding: "10px 12px", background: "transparent", border: "none", textAlign: "left", cursor: "pointer" }}>
                          <span className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 6, background: `${m.tint}1A`, color: m.tint, flexShrink: 0 }}><Icon size={14} /></span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{m.label}</span>
                            <span style={{ display: "block", fontSize: 11, color: "var(--muted-foreground)" }}>{m.hint}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}
            </div>
            <button onClick={() => void save()} disabled={saving} className="flex items-center" style={{ gap: 6, height: 36, padding: "0 16px", borderRadius: 10, background: accent, color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: saving ? 0.6 : 1, cursor: saving ? "default" : "pointer" }}>
              <Save size={14} /> {saving ? "Saving…" : "Save"}
            </button>
          </div>

          {questions.map((q, i) => (
            <QCard
              key={q.key} q={q} index={i} total={questions.length} accent={accent}
              expanded={expanded === q.key}
              onToggle={() => setExpanded((e) => (e === q.key ? null : q.key))}
              onPatch={(fn) => patch(q.key, fn)}
              onRemove={() => remove(q)}
              onDuplicate={() => duplicate(q.key)}
              onMove={(d) => move(q.key, d)}
            />
          ))}

          {questions.length === 0 ? (
            <div className="text-center" style={{ borderRadius: 16, padding: "44px 24px", background: "var(--card)", border: "1.5px dashed var(--border)" }}>
              <div className="flex items-center justify-center" style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.10)", color: "var(--nuru-gold)" }}><HelpCircle size={22} /></div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>No questions yet</div>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>Use “Add question” to build this quiz.</p>
            </div>
          ) : null}
        </div>

        {/* Settings panel */}
        <SettingsPanel label={settingsLabel} settings={settings} onChange={setSettings} totalPoints={totalPoints} passingPoints={passingPoints} />
      </div>
    </div>
  );
}

// ---- Question card ---------------------------------------------------------
function QCard({
  q, index, total, accent, expanded, onToggle, onPatch, onRemove, onDuplicate, onMove,
}: {
  q: QuizQuestion; index: number; total: number; accent: string; expanded: boolean;
  onToggle: () => void; onPatch: (fn: (q: QuizQuestion) => QuizQuestion) => void;
  onRemove: () => void; onDuplicate: () => void; onMove: (dir: -1 | 1) => void;
}): ReactElement {
  const meta = typeMeta[q.type]; const Icon = meta.icon;
  const valid = isValid(q);

  function setType(type: QType): void {
    onPatch((x) => ({
      ...x, type,
      options: isChoice(type)
        ? (x.options.length ? x.options : [
            { id: optId(), text: "Option 1", isCorrect: type !== "checkbox" },
            { id: optId(), text: "Option 2", isCorrect: false },
          ])
        : [],
    }));
  }
  function toggleCorrect(id: string): void {
    onPatch((x) => ({
      ...x,
      options: x.options.map((o) =>
        isMulti(x.type)
          ? (o.id === id ? { ...o, isCorrect: !o.isCorrect } : o)
          : { ...o, isCorrect: o.id === id }),
    }));
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: expanded ? "0 4px 16px rgba(11,31,51,0.06)" : "none", position: "relative" }}>
      {expanded ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: accent }} /> : null}
      {!expanded ? (
        <div onClick={onToggle} style={{ padding: "14px 18px", cursor: "pointer", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--muted-foreground)", minWidth: 24 }}>{index + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14.5, color: "var(--nuru-navy)", fontWeight: 500, lineHeight: 1.45 }}>{q.text || "Untitled question"}</p>
            <div className="flex items-center" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11.5, color: "var(--muted-foreground)" }}><Icon size={11} style={{ color: meta.tint }} /> {meta.label}</span>
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· {q.points} pt{q.points === 1 ? "" : "s"}</span>
              {q.required ? <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· Required</span> : null}
              {!valid ? <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, color: "#DC2626", fontWeight: 600 }}><AlertTriangle size={10} /> Needs setup</span> : null}
              {!q.active ? <span style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "0 6px" }}>DRAFT</span> : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "18px 20px 18px 24px" }}>
          {/* header: number + text + type select */}
          <div className="flex items-start" style={{ gap: 12, marginBottom: 14 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted-foreground)", minWidth: 26, marginTop: 6 }}>{index + 1}.</span>
            <textarea value={q.text} onChange={(e) => onPatch((x) => ({ ...x, text: e.target.value }))} rows={2} placeholder="Question text" className="flex-1 outline-none" style={{ fontSize: 15, color: "var(--nuru-navy)", fontWeight: 500, lineHeight: 1.5, padding: "6px 10px", background: "var(--input-background)", borderRadius: 8, border: "1px solid transparent", resize: "vertical" }} />
            <select value={q.type} onChange={(e) => setType(e.target.value as QType)} className="rounded-lg px-3 outline-none" style={{ height: 38, fontSize: 12.5, color: "var(--foreground)", background: "var(--background)", border: "1px solid var(--border)", minWidth: 158 }}>
              {ALL_TYPES.map((t) => <option key={t} value={t}>{typeMeta[t].label}</option>)}
            </select>
          </div>

          {/* body by type */}
          {isChoice(q.type) ? (
            <div className="flex flex-col" style={{ paddingLeft: 38, gap: 2 }}>
              {q.options.map((opt) => (
                <div key={opt.id} className="group flex items-center rounded-md" style={{ gap: 12, padding: "6px 8px" }}>
                  <button onClick={() => toggleCorrect(opt.id)} title={isMulti(q.type) ? "Toggle correct" : "Mark correct"} className="flex items-center justify-center" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: isMulti(q.type) ? 4 : "50%", background: opt.isCorrect ? "#16A34A" : "transparent", border: opt.isCorrect ? "none" : "2px solid #C9CFD6", color: "#fff", cursor: "pointer" }}>{opt.isCorrect ? <Check size={12} strokeWidth={3} /> : null}</button>
                  <input value={opt.text} onChange={(e) => onPatch((x) => ({ ...x, options: x.options.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)) }))} placeholder="Option text" className="bg-transparent outline-none flex-1" style={{ fontSize: 13.5, color: "var(--foreground)", border: "none", borderBottom: "1px solid transparent", padding: "4px 0" }} />
                  {q.options.length > 1 ? <button onClick={() => onPatch((x) => ({ ...x, options: x.options.filter((o) => o.id !== opt.id) }))} className="opacity-0 group-hover:opacity-100" style={{ color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}><Trash2 size={13} /></button> : null}
                </div>
              ))}
              <button onClick={() => onPatch((x) => ({ ...x, options: [...x.options, { id: optId(), text: `Option ${x.options.length + 1}`, isCorrect: false }] }))} className="text-left" style={{ fontSize: 13, color: "var(--muted-foreground)", background: "none", border: "none", padding: "4px 0 4px 32px", cursor: "pointer" }}>Add option</button>
            </div>
          ) : isManual(q.type) ? (
            <div style={{ paddingLeft: 38 }}>
              <div className="flex items-center" style={{ gap: 8, padding: "10px 12px", borderRadius: 10, background: "rgba(22,163,74,0.06)", border: "1px solid rgba(22,163,74,0.18)", color: "#0F6B33", fontSize: 12.5 }}>
                <Info size={13} style={{ flexShrink: 0 }} /> Reviewer scores this manually — no auto-grading.
              </div>
            </div>
          ) : (
            <ScaleEditor q={q} onPatch={onPatch} />
          )}

          {/* explanation */}
          <div style={{ marginTop: 16, paddingLeft: 38 }}>
            <textarea value={q.explanation} onChange={(e) => onPatch((x) => ({ ...x, explanation: e.target.value }))} rows={2} placeholder="Explanation (shown after submit)" className="w-full bg-transparent outline-none" style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, border: "none", borderBottom: "1px dashed var(--border)", padding: "6px 0", resize: "vertical" }} />
          </div>

          {/* footer controls */}
          <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12, marginTop: 16, paddingTop: 14, paddingLeft: 38, borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center" style={{ gap: 14, flexWrap: "wrap" }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                <Sparkles size={12} style={{ color: "var(--nuru-gold)" }} />
                <input type="number" min={1} max={100} value={q.points} onChange={(e) => onPatch((x) => ({ ...x, points: Math.min(100, Math.max(1, Number(e.target.value) || 1)) }))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 600, width: 42, textAlign: "center", border: "none", borderBottom: "1px solid var(--border)" }} />
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>pts</span>
              </div>
              <Toggle label="Required" on={q.required} onClick={() => onPatch((x) => ({ ...x, required: !x.required }))} />
              <Toggle label={q.active ? "Active" : "Draft"} on={q.active} onClick={() => onPatch((x) => ({ ...x, active: !x.active }))} />
            </div>
            <div className="flex items-center" style={{ gap: 4 }}>
              <IconBtn title="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ChevronUp size={15} /></IconBtn>
              <IconBtn title="Move down" disabled={index === total - 1} onClick={() => onMove(1)}><ChevronDown size={15} /></IconBtn>
              <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={14} /></IconBtn>
              <IconBtn title="Delete" tone="danger" onClick={onRemove}><Trash2 size={14} /></IconBtn>
              <button onClick={onToggle} className="rounded-lg" style={{ height: 30, padding: "0 12px", fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- linear_scale editor + live preview ------------------------------------
function ScaleEditor({ q, onPatch }: { q: QuizQuestion; onPatch: (fn: (q: QuizQuestion) => QuizQuestion) => void }): ReactElement {
  const valid = q.minVal < q.maxVal;
  const steps = valid ? Array.from({ length: q.maxVal - q.minVal + 1 }, (_, i) => q.minVal + i) : [];
  return (
    <div style={{ paddingLeft: 38, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <ScaleNum label="From" value={q.minVal} onChange={(v) => onPatch((x) => ({ ...x, minVal: v }))} />
        <ScaleNum label="To" value={q.maxVal} onChange={(v) => onPatch((x) => ({ ...x, maxVal: v }))} />
        <ScaleText label="Low label" value={q.minLabel} onChange={(v) => onPatch((x) => ({ ...x, minLabel: v }))} placeholder="e.g. Strongly disagree" />
        <ScaleText label="High label" value={q.maxLabel} onChange={(v) => onPatch((x) => ({ ...x, maxLabel: v }))} placeholder="e.g. Strongly agree" />
      </div>
      {valid ? (
        <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--input-background)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)", minWidth: 60 }}>{q.minLabel || q.minVal}</span>
            <div style={{ display: "flex", gap: 14, flex: 1, justifyContent: "center", flexWrap: "wrap" }}>
              {steps.map((n) => (
                <span key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid #C9CFD6" }} />
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{n}</span>
                </span>
              ))}
            </div>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)", minWidth: 60, textAlign: "right" }}>{q.maxLabel || q.maxVal}</span>
          </div>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: "#DC2626" }}>“From” must be less than “To”.</span>
      )}
    </div>
  );
}

function ScaleNum({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }): ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={fieldLabel}>{label}</span>
      <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 72, height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--background)", fontSize: 13, textAlign: "center", color: "var(--foreground)", outline: "none" }} />
    </label>
  );
}
function ScaleText({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }): ReactElement {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 160px", minWidth: 140 }}>
      <span style={fieldLabel}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ height: 34, borderRadius: 8, border: "1px solid var(--border)", background: "var(--background)", fontSize: 13, padding: "0 10px", color: "var(--foreground)", outline: "none" }} />
    </label>
  );
}

// ---- Settings panel --------------------------------------------------------
function SettingsPanel({
  label, settings, onChange, totalPoints, passingPoints,
}: {
  label: string; settings: QuizSettings; onChange: (s: QuizSettings) => void; totalPoints: number; passingPoints: number;
}): ReactElement {
  const set = <K extends keyof QuizSettings>(k: K, v: QuizSettings[K]): void => onChange({ ...settings, [k]: v });
  return (
    <div className="nuru-card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16, position: "sticky", top: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "var(--nuru-navy)", textTransform: "uppercase" }}>{label}</div>

      {/* pass mark */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
          <span style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", lineHeight: 1 }}>{settings.passMark}%</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{passingPoints} of {totalPoints} pts</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={settings.passMark} onChange={(e) => set("passMark", Number(e.target.value))} style={{ width: "100%", accentColor: "var(--nuru-gold)" }} />
        <div className="flex items-center justify-between" style={{ marginTop: 2, fontSize: 10.5, color: "var(--muted-foreground)" }}><span>0%</span><span>Pass mark</span><span>100%</span></div>
      </div>

      {/* time limit */}
      <div>
        <span style={fieldLabel}>Time limit</span>
        <div className="flex items-center" style={{ gap: 8, marginTop: 6 }}>
          <button onClick={() => set("timeLimitMinutes", settings.timeLimitMinutes == null ? 15 : null)} className="flex items-center" style={{ gap: 6, height: 34, padding: "0 10px", borderRadius: 8, border: "1.5px solid var(--border)", background: settings.timeLimitMinutes != null ? "var(--nuru-gold)" : "var(--background)", color: settings.timeLimitMinutes != null ? "#fff" : "var(--muted-foreground)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            <Clock size={13} /> {settings.timeLimitMinutes != null ? "On" : "Off"}
          </button>
          {settings.timeLimitMinutes != null ? (
            <>
              <input type="number" min={1} max={120} value={settings.timeLimitMinutes} onChange={(e) => set("timeLimitMinutes", Math.max(1, Number(e.target.value) || 1))} style={{ width: 64, height: 34, borderRadius: 8, border: "1.5px solid var(--border)", background: "var(--background)", fontSize: 13, textAlign: "center", color: "var(--foreground)", outline: "none" }} />
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>min</span>
            </>
          ) : <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>No limit</span>}
        </div>
      </div>

      {/* toggles */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <SwitchRow icon={<Shuffle size={13} />} label="Shuffle questions" on={settings.shuffleQuestions} onClick={() => set("shuffleQuestions", !settings.shuffleQuestions)} />
        <SwitchRow icon={<Eye size={13} />} label="Show answers after submit" on={settings.showAnswersAfterSubmit} onClick={() => set("showAnswersAfterSubmit", !settings.showAnswersAfterSubmit)} />
        <SwitchRow icon={<BarChart3 size={13} />} label="Show score after submit" on={settings.showScoreAfterSubmit} onClick={() => set("showScoreAfterSubmit", !settings.showScoreAfterSubmit)} />
      </div>
    </div>
  );
}

// ---- small UI bits ---------------------------------------------------------
const fieldLabel: React.CSSProperties = { fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "var(--muted-foreground)", textTransform: "uppercase" };

function Stat({ label, value, hint }: { label: string; value: string; hint: string }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{hint}</div>
    </div>
  );
}
function Chip({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return <span className="inline-flex items-center" style={{ gap: 4, height: 24, padding: "0 9px", borderRadius: 999, background: "var(--secondary)", color: "var(--nuru-navy)", fontSize: 11, fontWeight: 600 }}>{icon} {label}</span>;
}
function Banner({ tone, text }: { tone: "ok" | "err"; text: string }): ReactElement {
  const ok = tone === "ok";
  return <div style={{ padding: "8px 12px", borderRadius: 8, fontSize: 12.5, color: ok ? "#0F6B33" : "#A8281F", background: ok ? "#F3FAF5" : "#FDF4F4", border: `1px solid ${ok ? "#CDEBD8" : "#F2D5D2"}` }}>{text}</div>;
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }): ReactElement {
  return <button onClick={onClick} style={{ fontSize: 12, fontWeight: 600, color: on ? "var(--nuru-navy)" : "var(--muted-foreground)", background: "none", border: "none", cursor: "pointer" }}>{label}</button>;
}
function SwitchRow({ icon, label, on, onClick }: { icon: ReactElement; label: string; on: boolean; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="w-full flex items-center justify-between rounded-xl px-3" style={{ height: 42, border: "1.5px solid var(--border)", background: "var(--background)", cursor: "pointer" }}>
      <span className="flex items-center" style={{ gap: 8 }}>
        <span style={{ color: on ? "var(--nuru-gold)" : "var(--muted-foreground)" }}>{icon}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground)" }}>{label}</span>
      </span>
      <span className="rounded-full" style={{ width: 32, height: 18, padding: 2, background: on ? "var(--nuru-gold)" : "#D1D5DB", position: "relative", transition: "background 200ms", flexShrink: 0 }}>
        <span className="rounded-full block" style={{ width: 14, height: 14, background: "#fff", transform: on ? "translateX(14px)" : "translateX(0)", transition: "transform 200ms" }} />
      </span>
    </button>
  );
}
function IconBtn({ children, onClick, title, disabled, tone = "navy" }: { children: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean; tone?: "navy" | "danger" }): ReactElement {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="flex items-center justify-center rounded-lg disabled:opacity-30" style={{ width: 28, height: 28, color: tone === "danger" ? "#DC2626" : "var(--nuru-navy)", background: "none", border: "none", cursor: disabled ? "not-allowed" : "pointer" }}>
      {children}
    </button>
  );
}
