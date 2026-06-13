// Quiz Builder — full-page, Google-Forms-style quiz authoring rebuilt to the Figma
// make: navy hero with a level→module picker + READY/INCOMPLETE status + stat strip;
// an inline expand/collapse question list (MCQ / True-False / Fill-in-the-blank) with
// per-question difficulty, points, explanation and active/draft toggle; a settings
// panel (pass-mark slider, time limit, attempts, shuffle); and a composition panel.
// All data from the CMS (CurriculumApi). Scoring stays server-authoritative (§1.9):
// MCQ is single-correct to match our correct_answer model; deletes archive (soft).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode, type CSSProperties } from "react";
import {
  ArrowLeft, Plus, ChevronRight, ChevronDown, ChevronUp,
  Save, Send, HelpCircle, CheckCircle2, Circle, AlertTriangle,
  Trash2, Copy, ListChecks, ToggleRight, Type as TypeIcon,
  Sparkles, Hash, Clock, Shuffle, X, Check,
} from "lucide-react";
import {
  CurriculumApi, type AdminLevel, type AdminModuleSummary, type AdminModule, type AdminQuestion,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import type { ScreenId } from "../shell/nav";

const navyDark = "var(--nuru-dark, #071629)";

type QType = "mcq" | "truefalse" | "fillblank";
type Difficulty = "Easy" | "Medium" | "Hard";
interface Option { id: number; text: string; correct: boolean }
interface Q {
  key: string;
  questionId: string | null;
  type: QType;
  text: string;
  options: Option[];
  answer: string;
  explanation: string;
  difficulty: Difficulty;
  points: number;
  active: boolean;
}

const qTypeMeta: Record<QType, { label: string; hint: string; icon: typeof HelpCircle; tint: string; bg: string; api: AdminQuestion["q_type"] }> = {
  mcq: { label: "Multiple Choice", hint: "Pick the one correct option", icon: ListChecks, tint: "#7C3AED", bg: "rgba(124,58,237,0.10)", api: "MultipleChoice" },
  truefalse: { label: "True / False", hint: "Single yes / no choice", icon: ToggleRight, tint: "#0B84E8", bg: "rgba(11,132,232,0.10)", api: "TrueFalse" },
  fillblank: { label: "Fill in the Blank", hint: "Type the missing word", icon: TypeIcon, tint: "#16A34A", bg: "rgba(22,163,74,0.10)", api: "FillInTheBlank" },
};
const difficultyMeta: Record<Difficulty, { color: string }> = {
  Easy: { color: "#16A34A" },
  Medium: { color: "#D97706" },
  Hard: { color: "#DC2626" },
};
const Q_TYPES: QType[] = ["mcq", "truefalse", "fillblank"];
const DIFFS: Difficulty[] = ["Easy", "Medium", "Hard"];

const typeFromApi = (t: AdminQuestion["q_type"]): QType => (t === "MultipleChoice" ? "mcq" : t === "TrueFalse" ? "truefalse" : "fillblank");
const diffFromRating = (r: number): Difficulty => (r <= 2 ? "Easy" : r <= 4 ? "Medium" : "Hard");
const ratingFromDiff = (d: Difficulty): number => (d === "Easy" ? 1 : d === "Medium" ? 3 : 5);

let LOCAL_SEQ = 1;
const nextKey = (): string => `local-${LOCAL_SEQ++}`;

function fromApi(a: AdminQuestion): Q {
  const type = typeFromApi(a.q_type);
  let options: Option[] = [];
  if (type === "truefalse") {
    options = [
      { id: 1, text: "True", correct: a.correct_answer === "True" },
      { id: 2, text: "False", correct: a.correct_answer === "False" },
    ];
  } else if (type === "mcq") {
    options = (a.answer_options ?? []).map((text, i) => ({ id: i + 1, text, correct: text === a.correct_answer }));
  }
  return {
    key: a.question_id,
    questionId: a.question_id,
    type,
    text: a.question_text,
    options,
    answer: type === "fillblank" ? a.correct_answer : "",
    explanation: a.explanation ?? "",
    difficulty: diffFromRating(a.difficulty_rating),
    points: a.points,
    active: a.is_active,
  };
}

function blank(type: QType): Q {
  const options: Option[] =
    type === "truefalse"
      ? [{ id: 1, text: "True", correct: false }, { id: 2, text: "False", correct: false }]
      : type === "mcq"
        ? [{ id: 1, text: "Option A", correct: false }, { id: 2, text: "Option B", correct: false }]
        : [];
  return { key: nextKey(), questionId: null, type, text: "", options, answer: "", explanation: "", difficulty: "Medium", points: 1, active: false };
}

const hasCorrect = (q: Q): boolean => (q.type === "fillblank" ? !!q.answer.trim() : q.options.some((o) => o.correct));
function isValid(q: Q): boolean {
  if (!q.text.trim()) return false;
  if (q.type === "fillblank") return !!q.answer.trim();
  if (q.type === "truefalse") return q.options.some((o) => o.correct);
  const opts = q.options.filter((o) => o.text.trim());
  return opts.length >= 2 && opts.some((o) => o.correct);
}
function toPayload(q: Q): Record<string, unknown> {
  const base = {
    q_type: qTypeMeta[q.type].api,
    question_text: q.text,
    difficulty_rating: ratingFromDiff(q.difficulty),
    explanation: q.explanation.trim() ? q.explanation.trim() : null,
    points: q.points,
    is_active: q.active,
  };
  if (q.type === "fillblank") return { ...base, correct_answer: q.answer.trim() };
  if (q.type === "truefalse") return { ...base, correct_answer: q.options.find((o) => o.correct)?.text ?? "True" };
  return { ...base, answer_options: q.options.map((o) => o.text), correct_answer: q.options.find((o) => o.correct)?.text ?? "" };
}

export function QuizBuilder({ onNavigate }: { onNavigate: (id: ScreenId) => void }): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [levelNo, setLevelNo] = useState<number | null>(null);
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [mod, setMod] = useState<AdminModule | null>(null);

  const [questions, setQuestions] = useState<Q[]>([]);
  const [passMark, setPassMark] = useState(80);
  const [timeLimit, setTimeLimit] = useState(15);
  const [attempts, setAttempts] = useState(3);
  const [shuffle, setShuffle] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const dirty = useRef<Set<string>>(new Set());
  const deleted = useRef<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Pickers ──
  useEffect(() => { CurriculumApi.levels().then((ls) => { setLevels(ls); if (ls[0] && levelNo === null) setLevelNo(ls[0].level_number); }).catch((e) => setError(errorMessage(e, "Load failed"))); }, [levelNo]);
  useEffect(() => {
    if (levelNo === null) return;
    CurriculumApi.modules(levelNo).then((ms) => { setModules(ms); setModuleId((cur) => (ms.some((m) => m.module_id === cur) ? cur : ms[0]?.module_id ?? null)); }).catch(() => setModules([]));
  }, [levelNo]);

  const loadQuestions = useCallback(async (id: string) => {
    const list = await CurriculumApi.questions(id);
    setQuestions(list.map(fromApi));
    dirty.current = new Set();
    deleted.current = [];
  }, []);

  const load = useCallback(async (id: string) => {
    setError(null); setNotice(null);
    try {
      const m = await CurriculumApi.module(id);
      setMod(m);
      setPassMark(Math.round(Number(m.quiz_pass_mark)) || 80);
      setTimeLimit(m.time_limit_sec ? Math.round(m.time_limit_sec / 60) : 15);
      setAttempts(m.max_attempts ?? 3);
      setShuffle(m.quiz_shuffle);
      await loadQuestions(id);
      setExpandedKey(null);
    } catch (e) { setError(errorMessage(e, "Could not load the module.")); }
  }, [loadQuestions]);
  useEffect(() => { if (moduleId) void load(moduleId); }, [moduleId, load]);

  // ── Derived ──
  const active = useMemo(() => questions.filter((q) => q.active), [questions]);
  const totalPoints = useMemo(() => active.reduce((s, q) => s + q.points, 0), [active]);
  const passingPoints = Math.ceil(totalPoints * (passMark / 100));
  const canPublish = active.length > 0;
  const draftCount = questions.length - active.length;
  const difficultyCounts: Record<Difficulty, number> = {
    Easy: active.filter((q) => q.difficulty === "Easy").length,
    Medium: active.filter((q) => q.difficulty === "Medium").length,
    Hard: active.filter((q) => q.difficulty === "Hard").length,
  };

  // ── Local edits ──
  function touch(key: string): void { dirty.current.add(key); }
  function patch(key: string, fn: (q: Q) => Q): void {
    touch(key);
    setQuestions((prev) => prev.map((q) => (q.key === key ? fn(q) : q)));
  }
  function addQuestion(type: QType): void {
    const q = blank(type);
    setQuestions((prev) => [...prev, q]);
    touch(q.key);
    setExpandedKey(q.key);
    setAddOpen(false);
  }
  function duplicate(q: Q): void {
    const copy: Q = { ...q, key: nextKey(), questionId: null, text: `${q.text} (copy)`, active: false, options: q.options.map((o) => ({ ...o })) };
    setQuestions((prev) => { const i = prev.findIndex((x) => x.key === q.key); const next = [...prev]; next.splice(i + 1, 0, copy); return next; });
    touch(copy.key);
  }
  function remove(q: Q): void {
    if (q.questionId) deleted.current.push(q.questionId);
    setQuestions((prev) => prev.filter((x) => x.key !== q.key));
    if (expandedKey === q.key) setExpandedKey(null);
  }
  function move(key: string, dir: -1 | 1): void {
    setQuestions((prev) => {
      const i = prev.findIndex((q) => q.key === key); const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev]; const a = next[i]; const b = next[j];
      if (!a || !b) return prev;
      next[i] = b; next[j] = a; return next;
    });
  }

  // ── Persist ──
  async function save(): Promise<AdminModule | null> {
    if (!mod) return null;
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await CurriculumApi.updateModule(mod.module_id, {
        quiz_pass_mark: passMark,
        time_limit_sec: timeLimit > 0 ? timeLimit * 60 : null,
        max_attempts: attempts > 0 ? attempts : null,
        quiz_shuffle: shuffle,
        expected_row_version: mod.row_version,
      });
      setMod(updated);
      for (const id of deleted.current) await CurriculumApi.deleteQuestion(id);
      const valid = questions.filter(isValid);
      const fresh = valid.filter((q) => !q.questionId);
      const edits = valid.filter((q) => q.questionId && dirty.current.has(q.key));
      if (fresh.length) await CurriculumApi.addQuestions(mod.module_id, fresh.map(toPayload));
      for (const q of edits) await CurriculumApi.updateQuestion(q.questionId as string, toPayload(q));
      const skipped = questions.length - valid.length;
      await loadQuestions(mod.module_id);
      setNotice(skipped > 0 ? `Saved. ${skipped} question${skipped === 1 ? "" : "s"} still need an answer before it counts.` : "Saved.");
      return updated;
    } catch (e) { setError(errorMessage(e, "Save failed — the module may have changed elsewhere (reload).")); return null; }
    finally { setSaving(false); }
  }
  async function publish(): Promise<void> {
    if (!mod) return;
    const saved = await save();
    if (!saved) return;
    try {
      const updated = saved.status === "published" ? await CurriculumApi.unpublish(saved.module_id) : await CurriculumApi.publish(saved.module_id);
      setMod(updated); setNotice(updated.status === "published" ? "Published." : "Unpublished.");
      if (levelNo !== null) CurriculumApi.modules(levelNo).then(setModules).catch(() => {});
    } catch (e) { setError(errorMessage(e, "Publish rejected by validation (needs an active question / contiguous sequence).")); }
  }

  const levelTitle = levels.find((l) => l.level_number === levelNo)?.title ?? "";
  const moduleTitle = mod?.title || "Untitled module";

  return (
    <div style={{ margin: -28 }}>
      {/* ───── Hero ───── */}
      <div style={{ background: navyDark, padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between" style={{ gap: 16, flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: 6, fontSize: 11, color: "rgba(232,239,245,0.55)" }}>
            <button onClick={() => onNavigate("module-editor")} className="flex items-center" style={{ gap: 4, color: "rgba(232,239,245,0.55)", background: "none", border: "none" }}><ArrowLeft size={10} /> Module</button>
            <ChevronRight size={10} />
            <select value={levelNo ?? ""} onChange={(e) => setLevelNo(Number(e.target.value))} style={{ background: "transparent", color: "rgba(232,239,245,0.85)", border: "none", fontSize: 11, outline: "none" }}>
              {levels.map((l) => <option key={l.level_number} value={l.level_number} style={{ color: "#000" }}>L{l.level_number} · {l.title}</option>)}
            </select>
            <ChevronRight size={10} />
            <select value={moduleId ?? ""} onChange={(e) => setModuleId(e.target.value)} style={{ background: "transparent", color: "#fff", fontWeight: 600, border: "none", fontSize: 11, outline: "none" }}>
              {modules.map((m) => <option key={m.module_id} value={m.module_id} style={{ color: "#000" }}>Module {m.module_sequence_number}</option>)}
            </select>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Quiz</span>
          </div>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="inline-flex items-center" style={{ gap: 6, height: 32, padding: "0 10px", borderRadius: 8, background: canPublish ? "rgba(22,163,74,0.18)" : "rgba(220,38,38,0.18)", color: canPublish ? "#7FE0A0" : "#FCA5A5", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: `1px solid ${canPublish ? "rgba(22,163,74,0.35)" : "rgba(220,38,38,0.35)"}` }}>● {canPublish ? "Ready" : "Incomplete"}</span>
            <button onClick={() => void save()} disabled={saving} className="flex items-center" style={{ gap: 8, ...hbtn, opacity: saving ? 0.5 : 1 }}><Save size={13} /> {saving ? "Saving…" : "Save draft"}</button>
            <button onClick={() => void publish()} disabled={saving || !canPublish} className="flex items-center" style={{ gap: 8, height: 32, padding: "0 12px", borderRadius: 8, background: canPublish ? "var(--nuru-gold)" : "rgba(255,255,255,0.08)", color: canPublish ? "#fff" : "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 600, border: "none", cursor: canPublish ? "pointer" : "not-allowed", boxShadow: canPublish ? "0 6px 18px rgba(200,155,60,0.32)" : undefined }}><Send size={13} /> {mod?.status === "published" ? "Unpublish" : "Publish"}</button>
          </div>
        </div>

        <div className="flex items-baseline" style={{ gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1.1, letterSpacing: "-0.015em" }}>{moduleTitle} — Quiz</h1>
          <span style={{ fontSize: 12, color: "rgba(232,239,245,0.55)" }}>Build the quiz learners take after reading {levelTitle ? `Level ${levelNo} · ${levelTitle}` : "this module"}.</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4" style={{ marginTop: 16, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Active questions", value: String(active.length), hint: `${draftCount} draft` },
            { label: "Total points", value: String(totalPoints), hint: `Pass at ${passingPoints} pts` },
            { label: "Pass mark", value: `${passMark}%`, hint: `${attempts} attempts` },
            { label: "Time limit", value: `${timeLimit} min`, hint: shuffle ? "Shuffled" : "Fixed order" },
          ].map((it, i) => (
            <div key={it.label} style={{ padding: "14px 20px", borderRight: i < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{it.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{it.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{it.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ───── Body ───── */}
      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "var(--color-danger, #DC2626)", marginBottom: 12 }}>{error}</p> : null}
        {notice ? <p style={{ color: "#16A34A", marginBottom: 12 }}>{notice}</p> : null}
        {!mod ? <p style={{ color: "var(--muted-foreground)" }}>Select a module above to build its quiz.</p> : (
          <div className="grid grid-cols-1" style={{ gridTemplateColumns: "minmax(0,1fr) 340px", gap: 20, alignItems: "start" }}>
            {/* ── Questions ── */}
            <div className="flex flex-col" style={{ gap: 16, minWidth: 0 }}>
              {!canPublish ? (
                <div className="flex items-start" style={{ gap: 12, borderRadius: 16, padding: 16, background: "rgba(220,38,38,0.05)", border: "1.5px solid rgba(220,38,38,0.25)" }}>
                  <div className="flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: 12, background: "rgba(220,38,38,0.12)", color: "#DC2626", flexShrink: 0 }}><AlertTriangle size={18} /></div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#DC2626" }}>Quiz cannot be published yet</div>
                    <p style={{ fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.5, marginTop: 2 }}>Activate at least one question or create a new one to continue.</p>
                  </div>
                  <button onClick={() => addQuestion("mcq")} className="flex items-center" style={{ gap: 6, height: 34, padding: "0 12px", borderRadius: 12, background: "#DC2626", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", flexShrink: 0 }}><Plus size={12} /> Add question</button>
                </div>
              ) : null}

              <div className="flex items-center justify-between">
                <div>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Questions</h2>
                  <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>{active.length} active · {draftCount} draft · {totalPoints} pts</p>
                </div>
                <div style={{ position: "relative" }}>
                  <button onClick={() => setAddOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 38, padding: "0 16px", borderRadius: 12, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><Plus size={14} /> New question <ChevronDown size={12} /></button>
                  {addOpen ? (
                    <>
                      <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setAddOpen(false)} />
                      <div style={{ position: "absolute", right: 0, marginTop: 4, width: 260, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 12px 36px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 31 }}>
                        {Q_TYPES.map((t) => {
                          const m = qTypeMeta[t]; const Icon = m.icon;
                          return (
                            <button key={t} onClick={() => addQuestion(t)} className="w-full flex items-center" style={{ gap: 10, padding: "10px 12px", background: "transparent", border: "none", textAlign: "left" }}>
                              <span className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 6, background: m.bg, color: m.tint, flexShrink: 0 }}><Icon size={14} /></span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{m.label}</div>
                                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.hint}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col" style={{ gap: 12 }}>
                {questions.map((q, i) => (
                  <QuestionCard
                    key={q.key} q={q} index={i} total={questions.length}
                    expanded={expandedKey === q.key}
                    onExpand={() => setExpandedKey(q.key)} onCollapse={() => setExpandedKey(null)}
                    onPatch={(fn) => patch(q.key, fn)}
                    onMove={(d) => move(q.key, d)} onDuplicate={() => duplicate(q)} onRemove={() => remove(q)}
                  />
                ))}
                {questions.length === 0 ? (
                  <div className="text-center" style={{ borderRadius: 16, padding: "48px 24px", background: "var(--card)", border: "1.5px dashed var(--border)" }}>
                    <div className="flex items-center justify-center" style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.10)", color: "var(--nuru-gold)" }}><HelpCircle size={22} /></div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>No questions yet</div>
                    <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>Add your first question to begin building this quiz.</p>
                  </div>
                ) : null}
              </div>
            </div>

            {/* ── Settings ── */}
            <div className="flex flex-col" style={{ gap: 20 }}>
              <div className="nuru-card" style={{ padding: 20 }}>
                <SectionLabel label="Pass mark" />
                <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--nuru-navy)", lineHeight: 1 }}>{passMark}%</span>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{passingPoints} of {totalPoints} pts</span>
                </div>
                <input type="range" min={50} max={100} step={5} value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--nuru-gold)" }} />
                <div className="flex items-center justify-between" style={{ marginTop: 2, marginBottom: 18, fontSize: 10.5, color: "var(--muted-foreground)" }}><span>50%</span><span>100%</span></div>

                <div className="grid grid-cols-2" style={{ gap: 12, marginBottom: 12 }}>
                  <Field label="Time limit">
                    <div className="flex items-center" style={{ gap: 6, ...inputBox, padding: "0 12px" }}>
                      <Clock size={12} style={{ color: "var(--muted-foreground)" }} />
                      <input type="number" min={0} value={timeLimit} onChange={(e) => setTimeLimit(Number(e.target.value))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", border: "none", width: "100%", minWidth: 0 }} />
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>min</span>
                    </div>
                  </Field>
                  <Field label="Attempts">
                    <div className="flex items-center" style={{ gap: 6, ...inputBox, padding: "0 12px" }}>
                      <Hash size={12} style={{ color: "var(--muted-foreground)" }} />
                      <input type="number" min={1} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", border: "none", width: "100%", minWidth: 0 }} />
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>tries</span>
                    </div>
                  </Field>
                </div>

                <button onClick={() => setShuffle((v) => !v)} className="w-full flex items-center justify-between" style={{ height: 44, padding: "0 12px", borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--background)" }}>
                  <div className="flex items-center" style={{ gap: 8 }}>
                    <Shuffle size={13} style={{ color: shuffle ? "var(--nuru-gold)" : "var(--muted-foreground)" }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Shuffle questions</span>
                  </div>
                  <span style={{ width: 32, height: 18, padding: 2, borderRadius: 999, background: shuffle ? "var(--nuru-gold)" : "#D1D5DB", position: "relative", transition: "background 200ms" }}>
                    <span style={{ display: "block", width: 14, height: 14, borderRadius: 999, background: "#fff", transform: shuffle ? "translateX(14px)" : "translateX(0)", transition: "transform 200ms" }} />
                  </span>
                </button>
              </div>

              <div style={{ borderRadius: 16, padding: 20, background: "linear-gradient(135deg, var(--nuru-navy) 0%, #142a45 100%)", color: "#fff" }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "rgba(232,239,245,0.55)", textTransform: "uppercase", marginBottom: 12 }}>Composition</div>
                <div className="flex flex-col" style={{ gap: 8 }}>
                  {Q_TYPES.map((t) => {
                    const count = active.filter((q) => q.type === t).length;
                    const pct = active.length ? (count / active.length) * 100 : 0;
                    const m = qTypeMeta[t];
                    return (
                      <div key={t}>
                        <div className="flex items-center justify-between" style={{ fontSize: 11.5 }}>
                          <span style={{ color: "rgba(232,239,245,0.75)" }}>{m.label}</span>
                          <span style={{ fontWeight: 700, color: "#fff" }}>{count}</span>
                        </div>
                        <div style={{ height: 4, borderRadius: 999, overflow: "hidden", marginTop: 4, background: "rgba(255,255,255,0.08)" }}>
                          <div style={{ height: "100%", borderRadius: 999, width: `${pct}%`, background: m.tint }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "rgba(232,239,245,0.55)", textTransform: "uppercase", marginBottom: 8 }}>Difficulty mix</div>
                  <div className="flex items-center" style={{ gap: 6 }}>
                    {DIFFS.map((d) => (
                      <div key={d} className="text-center" style={{ flex: 1, borderRadius: 12, padding: "8px 6px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: difficultyMeta[d].color, lineHeight: 1 }}>{difficultyCounts[d]}</div>
                        <div style={{ fontSize: 9.5, fontWeight: 700, color: "rgba(232,239,245,0.65)", letterSpacing: "0.05em", textTransform: "uppercase", marginTop: 4 }}>{d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function QuestionCard({
  q, index, total, expanded, onExpand, onCollapse, onPatch, onMove, onDuplicate, onRemove,
}: {
  q: Q; index: number; total: number; expanded: boolean;
  onExpand: () => void; onCollapse: () => void;
  onPatch: (fn: (q: Q) => Q) => void;
  onMove: (dir: -1 | 1) => void; onDuplicate: () => void; onRemove: () => void;
}): ReactElement {
  const meta = qTypeMeta[q.type];
  const Icon = meta.icon;
  const diff = difficultyMeta[q.difficulty];
  const answered = hasCorrect(q);

  function setType(type: QType): void {
    onPatch((x) => ({
      ...x, type,
      options: type === "truefalse"
        ? [{ id: 1, text: "True", correct: false }, { id: 2, text: "False", correct: false }]
        : type === "mcq"
          ? (x.options.length ? x.options : [{ id: 1, text: "Option A", correct: false }, { id: 2, text: "Option B", correct: false }])
          : [],
      answer: type === "fillblank" ? x.answer : "",
    }));
  }
  function selectCorrect(id: number): void {
    onPatch((x) => ({ ...x, options: x.options.map((o) => ({ ...o, correct: o.id === id })) }));
  }

  return (
    <div style={{ position: "relative" }}>
      {expanded ? (
        <div className="hidden md:flex flex-col items-center" style={{ gap: 4, position: "absolute", left: "100%", top: 12, marginLeft: 8, padding: "8px 0", width: 40, borderRadius: 16, background: "var(--card)", border: "1px solid var(--border)", boxShadow: "0 4px 12px rgba(0,0,0,0.04)" }} onClick={(e) => e.stopPropagation()}>
          <IconBtn title="Move up" onClick={() => onMove(-1)} disabled={index === 0}><ChevronUp size={15} /></IconBtn>
          <IconBtn title="Move down" onClick={() => onMove(1)} disabled={index === total - 1}><ChevronDown size={15} /></IconBtn>
          <div style={{ height: 1, width: 22, background: "var(--border)", margin: "2px 0" }} />
          <IconBtn title="Duplicate" onClick={onDuplicate}><Copy size={14} /></IconBtn>
          <IconBtn title="Delete" onClick={onRemove} tone="danger"><Trash2 size={14} /></IconBtn>
        </div>
      ) : null}

      <div onClick={() => !expanded && onExpand()} className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: expanded ? "0 4px 16px rgba(11,31,51,0.06)" : "none", position: "relative", cursor: expanded ? "default" : "pointer", opacity: q.active ? 1 : 0.85 }}>
        {expanded ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: "var(--nuru-gold)" }} /> : null}

        {!expanded ? (
          <div style={{ padding: "16px 20px" }}>
            <div className="flex items-start" style={{ gap: 12 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--muted-foreground)", lineHeight: 1.3, minWidth: 24 }}>{index + 1}.</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14.5, color: "var(--nuru-navy)", lineHeight: 1.45, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{q.text || "Untitled question"}</p>
                <div className="flex items-center" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11.5, color: "var(--muted-foreground)" }}><Icon size={11} style={{ color: meta.tint }} /> {meta.label}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>·</span>
                  <span style={{ fontSize: 11.5, color: diff.color, fontWeight: 600 }}>{q.difficulty}</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>·</span>
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{q.points} {q.points === 1 ? "pt" : "pts"}</span>
                  {!answered ? <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, color: "#DC2626", fontWeight: 600, marginLeft: 4 }}><AlertTriangle size={10} /> No answer set</span> : null}
                  {!q.active ? <span className="inline-flex items-center" style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", letterSpacing: "0.05em", borderRadius: 4, padding: "0 6px", marginLeft: 4 }}>DRAFT</span> : null}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ padding: "20px 24px 20px 28px" }}>
            <div className="flex items-start" style={{ gap: 12, marginBottom: 20 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted-foreground)", lineHeight: 1.4, minWidth: 28, marginTop: 6 }}>{index + 1}.</span>
              <textarea value={q.text} onChange={(e) => onPatch((x) => ({ ...x, text: e.target.value }))} rows={2} placeholder="Question" className="flex-1 bg-transparent outline-none resize-none" style={{ fontSize: 15.5, color: "var(--nuru-navy)", fontWeight: 500, lineHeight: 1.5, padding: "6px 10px", background: "var(--input-background, #F7F8FA)", borderRadius: 8, border: "1px solid transparent" }} />
              <select value={q.type} onChange={(e) => setType(e.target.value as QType)} className="rounded-lg px-3 outline-none" style={{ height: 38, fontSize: 12.5, color: "var(--foreground)", background: "var(--background)", border: "1px solid var(--border)", minWidth: 160 }}>
                {Q_TYPES.map((t) => <option key={t} value={t}>{qTypeMeta[t].label}</option>)}
              </select>
            </div>

            {q.type !== "fillblank" ? (
              <div className="flex flex-col" style={{ paddingLeft: 38 }}>
                {q.options.map((opt) => (
                  <div key={opt.id} className="group flex items-center rounded-md" style={{ gap: 12, padding: "6px 8px", margin: "0 -8px" }}>
                    <button onClick={() => selectCorrect(opt.id)} className="flex items-center justify-center" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: q.type === "truefalse" ? "50%" : 4, background: opt.correct ? "#16A34A" : "transparent", border: opt.correct ? "none" : "2px solid #C9CFD6", color: "#fff" }} title={opt.correct ? "Correct answer" : "Mark as correct"}>{opt.correct ? <Check size={12} strokeWidth={3} /> : null}</button>
                    <input value={opt.text} onChange={(e) => onPatch((x) => ({ ...x, options: x.options.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)) }))} disabled={q.type === "truefalse"} className="bg-transparent outline-none flex-1" style={{ fontSize: 13.5, color: "var(--foreground)", border: "none", borderBottom: "1px solid transparent", padding: "4px 0" }} />
                    {q.type === "mcq" && q.options.length > 2 ? (
                      <button onClick={() => onPatch((x) => ({ ...x, options: x.options.filter((o) => o.id !== opt.id) }))} className="opacity-0 group-hover:opacity-100" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><X size={15} /></button>
                    ) : null}
                  </div>
                ))}
                {q.type === "mcq" ? (
                  <div className="flex items-center" style={{ gap: 12, padding: "6px 8px", margin: "0 -8px" }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, border: "2px solid #E5E7EB", flexShrink: 0 }} />
                    <button onClick={() => onPatch((x) => ({ ...x, options: [...x.options, { id: (x.options.reduce((m, o) => Math.max(m, o.id), 0) + 1), text: `Option ${String.fromCharCode(65 + x.options.length)}`, correct: false }] }))} className="text-left flex-1" style={{ fontSize: 13.5, color: "var(--muted-foreground)", background: "none", border: "none", padding: "4px 0" }}>Add option</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ paddingLeft: 38 }}>
                <input value={q.answer} onChange={(e) => onPatch((x) => ({ ...x, answer: e.target.value }))} placeholder="Correct answer" className="w-full bg-transparent outline-none" style={{ fontSize: 13.5, color: "var(--foreground)", fontFamily: "var(--font-mono)", border: "none", borderBottom: "1.5px solid var(--border)", padding: "6px 0" }} />
              </div>
            )}

            <div style={{ marginTop: 20, paddingLeft: 38 }}>
              <textarea value={q.explanation} onChange={(e) => onPatch((x) => ({ ...x, explanation: e.target.value }))} rows={2} placeholder="Explanation (shown after answering)" className="w-full bg-transparent outline-none resize-none" style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, border: "none", borderBottom: "1px dashed var(--border)", padding: "6px 0" }} />
            </div>

            <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12, marginTop: 20, paddingTop: 16, paddingLeft: 38, borderTop: "1px solid var(--border)" }}>
              <div className="flex items-center" style={{ gap: 16, flexWrap: "wrap" }}>
                <div className="flex items-center" style={{ gap: 6 }}>
                  {DIFFS.map((d) => {
                    const on = q.difficulty === d; const dm = difficultyMeta[d];
                    return <button key={d} onClick={() => onPatch((x) => ({ ...x, difficulty: d }))} className="rounded-full" style={{ height: 26, padding: "0 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", background: on ? dm.color : "transparent", color: on ? "#fff" : dm.color, border: on ? "none" : `1px solid ${dm.color}55` }}>{d}</button>;
                  })}
                </div>
                <div className="flex items-center" style={{ gap: 6 }}>
                  <Sparkles size={12} style={{ color: "var(--nuru-gold)" }} />
                  <input type="number" min={1} value={q.points} onChange={(e) => onPatch((x) => ({ ...x, points: Math.max(1, Number(e.target.value)) }))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 600, width: 38, textAlign: "center", border: "none", borderBottom: "1px solid var(--border)" }} />
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>pts</span>
                </div>
                <button onClick={() => onPatch((x) => ({ ...x, active: !x.active }))} className="flex items-center" style={{ gap: 6, background: "none", border: "none", fontSize: 12, color: "var(--muted-foreground)" }}>
                  {q.active ? <CheckCircle2 size={14} style={{ color: "var(--nuru-gold)" }} /> : <Circle size={14} />}
                  <span style={{ fontWeight: 600, color: q.active ? "var(--nuru-navy)" : "var(--muted-foreground)" }}>{q.active ? "Active" : "Draft"}</span>
                </button>
              </div>
              <div className="flex items-center" style={{ gap: 4 }}>
                <button onClick={onDuplicate} className="md:hidden flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: "none", border: "none", color: "var(--muted-foreground)" }} title="Duplicate"><Copy size={14} /></button>
                <button onClick={onRemove} className="md:hidden flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 8, background: "none", border: "none", color: "#DC2626" }} title="Delete"><Trash2 size={14} /></button>
                <button onClick={onCollapse} className="rounded-lg" style={{ height: 30, padding: "0 12px", fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", background: "none", border: "none" }}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ───
const inputBox: CSSProperties = { height: 40, borderRadius: 12, border: "1.5px solid var(--border)", background: "var(--background)" };
const hbtn: CSSProperties = { height: 32, padding: "0 12px", borderRadius: 8, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)" };

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="block" style={{ marginBottom: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", color: "var(--muted-foreground)", textTransform: "uppercase" }}>{label}</label>
      {children}
    </div>
  );
}
function SectionLabel({ label }: { label: string }): ReactElement {
  return <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", color: "var(--nuru-navy)", textTransform: "uppercase", marginBottom: 10 }}>{label}</div>;
}
function IconBtn({ children, onClick, title, disabled, tone = "navy" }: { children: ReactNode; onClick?: () => void; title?: string; disabled?: boolean; tone?: "navy" | "danger" }): ReactElement {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="flex items-center justify-center rounded-lg disabled:opacity-30 disabled:cursor-not-allowed" style={{ width: 28, height: 28, background: "none", border: "none", color: tone === "danger" ? "#DC2626" : "var(--nuru-navy)" }}>{children}</button>
  );
}
