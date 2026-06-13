// Level Quiz Builder — rebuilt to the "Final Pathway Portal" make. Left: level
// selector. Right: the level's FINAL ASSESSMENT, which in our server-authoritative
// model (§1.9) is the level's exit-exam module question bank + the level pass mark.
// Fully wired to CurriculumApi (questions CRUD + updateExam). Question types are
// limited to what the server scores: MCQ (single correct), True/False, Fill-blank.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight, BookOpen, Layers, Check, Award, Clock, Lock, Plus,
  HelpCircle, ListChecks, ToggleRight, Type as TypeIcon, Trash2, Sparkles, AlertTriangle, Save,
} from "lucide-react";
import {
  CurriculumApi, type AdminLevel, type AdminModuleSummary, type AdminQuestion,
} from "../../api/client";
import { errorMessage } from "../../util/error";

const statusStyle: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  in_review: { bg: "#FDF5E5", color: "#8A6B1F" },
};
const statusLabel: Record<string, string> = { published: "Published", draft: "Draft", in_review: "In Review", archived: "Archived" };

type QType = "mcq" | "truefalse" | "fillblank";
type Difficulty = "Easy" | "Medium" | "Hard";
interface Opt { id: number; text: string; correct: boolean }
interface Q { key: string; questionId: string | null; type: QType; text: string; options: Opt[]; answer: string; explanation: string; difficulty: Difficulty; points: number; active: boolean }

const qMeta: Record<QType, { label: string; icon: typeof HelpCircle; tint: string; api: AdminQuestion["q_type"] }> = {
  mcq: { label: "Multiple Choice", icon: ListChecks, tint: "#7C3AED", api: "MultipleChoice" },
  truefalse: { label: "True / False", icon: ToggleRight, tint: "#0B84E8", api: "TrueFalse" },
  fillblank: { label: "Fill in the Blank", icon: TypeIcon, tint: "#16A34A", api: "FillInTheBlank" },
};
const Q_TYPES: QType[] = ["mcq", "truefalse", "fillblank"];
const DIFFS: Difficulty[] = ["Easy", "Medium", "Hard"];
const diffColor: Record<Difficulty, string> = { Easy: "#16A34A", Medium: "#D97706", Hard: "#DC2626" };
let SEQ = 1;
const typeFromApi = (t: AdminQuestion["q_type"]): QType => (t === "MultipleChoice" ? "mcq" : t === "TrueFalse" ? "truefalse" : "fillblank");
const diffFromRating = (r: number): Difficulty => (r <= 2 ? "Easy" : r <= 4 ? "Medium" : "Hard");
const ratingFromDiff = (d: Difficulty): number => (d === "Easy" ? 1 : d === "Medium" ? 3 : 5);

function fromApi(a: AdminQuestion): Q {
  const type = typeFromApi(a.q_type);
  let options: Opt[] = [];
  if (type === "truefalse") options = [{ id: 1, text: "True", correct: a.correct_answer === "True" }, { id: 2, text: "False", correct: a.correct_answer === "False" }];
  else if (type === "mcq") options = (a.answer_options ?? []).map((text, i) => ({ id: i + 1, text, correct: text === a.correct_answer }));
  return { key: a.question_id, questionId: a.question_id, type, text: a.question_text, options, answer: type === "fillblank" ? a.correct_answer : "", explanation: a.explanation ?? "", difficulty: diffFromRating(a.difficulty_rating), points: a.points, active: a.is_active };
}
function blank(type: QType): Q {
  const options: Opt[] = type === "truefalse" ? [{ id: 1, text: "True", correct: false }, { id: 2, text: "False", correct: false }] : type === "mcq" ? [{ id: 1, text: "Option A", correct: false }, { id: 2, text: "Option B", correct: false }] : [];
  return { key: `local-${SEQ++}`, questionId: null, type, text: "", options, answer: "", explanation: "", difficulty: "Medium", points: 1, active: true };
}
const isValid = (q: Q): boolean => {
  if (!q.text.trim()) return false;
  if (q.type === "fillblank") return !!q.answer.trim();
  if (q.type === "truefalse") return q.options.some((o) => o.correct);
  return q.options.filter((o) => o.text.trim()).length >= 2 && q.options.some((o) => o.correct);
};
function toPayload(q: Q): Record<string, unknown> {
  const base = { q_type: qMeta[q.type].api, question_text: q.text, difficulty_rating: ratingFromDiff(q.difficulty), explanation: q.explanation.trim() || null, points: q.points, is_active: q.active };
  if (q.type === "fillblank") return { ...base, correct_answer: q.answer.trim() };
  if (q.type === "truefalse") return { ...base, correct_answer: q.options.find((o) => o.correct)?.text ?? "True" };
  return { ...base, answer_options: q.options.map((o) => o.text), correct_answer: q.options.find((o) => o.correct)?.text ?? "" };
}

export function QuizBuilder(): ReactElement {
  const navigate = useNavigate();
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [selNo, setSelNo] = useState<number | null>(null);
  const [examModuleId, setExamModuleId] = useState<string | null>(null);
  const [examMissing, setExamMissing] = useState(false);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [passMark, setPassMark] = useState(80);
  const [deleted, setDeleted] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void CurriculumApi.levels().then((ls) => { setLevels(ls); setSelNo((c) => c ?? ls[0]?.level_number ?? null); }).catch((e) => setError(errorMessage(e, "Load failed"))); }, []);

  const loadExam = useCallback(async (levelNo: number) => {
    setError(null); setNotice(null); setDeleted([]); setExpanded(null);
    const lvl = levels.find((l) => l.level_number === levelNo);
    if (lvl) setPassMark(Math.round(Number(lvl.required_exam_pass_mark) || 80));
    try {
      const mods = await CurriculumApi.modules(levelNo);
      const exam = mods.find((m: AdminModuleSummary) => m.evaluation_kind === "exit_exam");
      if (!exam) { setExamModuleId(null); setExamMissing(true); setQuestions([]); return; }
      setExamMissing(false); setExamModuleId(exam.module_id);
      const qs = await CurriculumApi.questions(exam.module_id);
      setQuestions(qs.map(fromApi));
    } catch (e) { setError(errorMessage(e, "Could not load the level exam.")); }
  }, [levels]);

  useEffect(() => { if (selNo != null && levels.length) void loadExam(selNo); }, [selNo, levels, loadExam]);

  const selLevel = levels.find((l) => l.level_number === selNo) ?? null;
  const active = questions.filter((q) => q.active);
  const totalPoints = active.reduce((s, q) => s + q.points, 0);

  async function createExam(): Promise<void> {
    if (selNo == null) return;
    try {
      const created = await CurriculumApi.createModule({ level_number: selNo, title: `Level ${selNo} — Final Assessment`, lesson_content: "Level exit exam.", evaluation_kind: "exit_exam" });
      setExamMissing(false); setExamModuleId((created as { module_id: string }).module_id);
      await loadExam(selNo);
    } catch (e) { setError(errorMessage(e, "Could not create the level exam.")); }
  }
  function patch(key: string, fn: (q: Q) => Q): void { setQuestions((prev) => prev.map((q) => (q.key === key ? fn(q) : q))); }
  function addQuestion(type: QType): void { const q = blank(type); setQuestions((prev) => [...prev, q]); setExpanded(q.key); setAddOpen(false); }
  function remove(q: Q): void { if (q.questionId) setDeleted((d) => [...d, q.questionId as string]); setQuestions((prev) => prev.filter((x) => x.key !== q.key)); }

  async function save(): Promise<void> {
    if (!examModuleId || selNo == null) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      if (selLevel) await CurriculumApi.updateExam(selNo, { required_exam_pass_mark: passMark, exam_question_count: active.length });
      for (const id of deleted) await CurriculumApi.deleteQuestion(id);
      const valid = questions.filter(isValid);
      const fresh = valid.filter((q) => !q.questionId);
      const edits = valid.filter((q) => q.questionId);
      if (fresh.length) await CurriculumApi.addQuestions(examModuleId, fresh.map(toPayload));
      for (const q of edits) await CurriculumApi.updateQuestion(q.questionId as string, toPayload(q));
      const skipped = questions.length - valid.length;
      await loadExam(selNo);
      setNotice(skipped > 0 ? `Saved. ${skipped} question(s) still need an answer.` : "Saved.");
    } catch (e) { setError(errorMessage(e, "Save failed.")); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--background)" }}>
      {/* Header */}
      <div style={{ background: "var(--nuru-dark)", padding: "18px clamp(16px,3vw,40px)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginBottom: 6 }}>
              <button onClick={() => navigate("/cms")} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(232,239,245,0.45)", fontSize: 10.5 }}>Curriculum</button>
              <ChevronRight size={10} /><span style={{ color: "rgba(232,239,245,0.75)" }}>Level Quiz Builder</span>
            </div>
            <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1, letterSpacing: "-0.01em" }}>Level Quiz Builder</h1>
            <p style={{ fontSize: 12, color: "rgba(232,239,245,0.5)", marginTop: 4 }}>Build the final assessment disciples take after completing a level. Graded automatically.</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {[{ label: "Levels", val: levels.length }, { label: "Published", val: levels.filter((l) => l.status === "published").length }].map((s) => (
              <div key={s.label} style={{ textAlign: "center", padding: "6px 18px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{s.val}</div>
                <div style={{ fontSize: 9.5, color: "rgba(232,239,245,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT — level selector */}
        <div style={{ width: 288, flexShrink: 0, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Select a level</p>
            <p style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>The quiz gates level completion.</p>
          </div>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {levels.map((l) => {
                const sel = selNo === l.level_number; const ss = statusStyle[l.status] ?? statusStyle.draft!;
                return (
                  <button key={l.level_number} onClick={() => setSelNo(l.level_number)} disabled={l.locked} style={{ width: "100%", padding: "14px 16px", borderRadius: 14, border: sel ? `2px solid ${l.color}` : "1.5px solid var(--border)", background: sel ? `${l.color}08` : "#fff", cursor: l.locked ? "not-allowed" : "pointer", opacity: l.locked ? 0.55 : 1, textAlign: "left", boxShadow: sel ? `0 0 0 4px ${l.color}18` : "0 1px 3px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: l.locked ? "var(--muted)" : l.color, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "var(--font-display)", fontSize: 15 }}>{l.locked ? <Lock size={14} /> : l.level_number}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: l.color, letterSpacing: "0.08em", textTransform: "uppercase" }}>Level {l.level_number}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "1px 7px", borderRadius: 999, background: ss.bg, color: ss.color }}>{statusLabel[l.status]}</span>
                        </div>
                        <p style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", lineHeight: 1.2 }}>{l.title}</p>
                        <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 2 }}>{l.theme ?? ""}</p>
                      </div>
                      {sel ? <div style={{ width: 20, height: 20, borderRadius: 999, background: l.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Check size={11} color="#fff" strokeWidth={3} /></div> : null}
                    </div>
                    <div style={{ display: "flex", gap: 12, paddingLeft: 46 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--muted-foreground)" }}><BookOpen size={10} /> {Number(l.published_count) + Number(l.draft_count)} modules</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, color: "var(--muted-foreground)" }}><Clock size={10} /> {l.duration ?? "—"}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT — exam builder */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {!selLevel ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--muted-foreground)", gap: 10 }}><Layers size={36} style={{ opacity: 0.25 }} /><p style={{ fontSize: 14, fontWeight: 600 }}>Select a level to build its quiz</p></div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
              {/* Level banner */}
              <div style={{ padding: "10px 24px", background: `${selLevel.color}10`, borderBottom: `2px solid ${selLevel.color}30`, display: "flex", alignItems: "center", gap: 12, flexShrink: 0, flexWrap: "wrap" }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, flexShrink: 0, background: selLevel.color, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-display)", fontSize: 15, color: "#fff" }}>{selLevel.level_number}</div>
                <div><span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Level {selLevel.level_number} — {selLevel.title}</span><span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: 8 }}>{selLevel.theme ?? ""}</span></div>
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Award size={13} style={{ color: selLevel.color }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: selLevel.color }}>Pass mark</span>
                  <input type="number" min={0} max={100} value={passMark} onChange={(e) => setPassMark(Math.min(100, Math.max(0, Number(e.target.value))))} style={{ width: 64, height: 30, borderRadius: 8, border: "1.5px solid var(--border)", background: "#fff", fontSize: 13, fontWeight: 700, textAlign: "center", color: "var(--nuru-navy)", outline: "none" }} />
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>%</span>
                </div>
              </div>

              {notice ? <div style={{ padding: "8px 24px", color: "#0F6B33", fontSize: 12.5, background: "#F3FAF5", borderBottom: "1px solid var(--border)" }}>{notice}</div> : null}
              {error ? <div style={{ padding: "8px 24px", color: "#A8281F", fontSize: 12.5, background: "#FDF4F4", borderBottom: "1px solid var(--border)" }}>{error}</div> : null}

              {examMissing ? (
                <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div className="nuru-card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
                    <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", display: "grid", placeItems: "center" }}><Award size={22} /></div>
                    <h3 className="type-section" style={{ fontSize: 18 }}>No exam for this level yet</h3>
                    <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6 }}>Create the level's final assessment to start adding questions.</p>
                    <button onClick={() => void createExam()} className="flex items-center gap-2" style={{ margin: "16px auto 0", height: 40, padding: "0 18px", borderRadius: 10, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}><Plus size={14} /> Create level exam</button>
                  </div>
                </div>
              ) : (
                <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                  <div style={{ maxWidth: 820, margin: "0 auto" }}>
                    <div className="flex items-center justify-between" style={{ marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                      <div>
                        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)" }}>Exam questions</h2>
                        <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{active.length} active · {totalPoints} pts · pass at {Math.ceil(totalPoints * (passMark / 100))} pts</p>
                      </div>
                      <div className="flex items-center" style={{ gap: 8 }}>
                        <div style={{ position: "relative" }}>
                          <button onClick={() => setAddOpen((v) => !v)} className="flex items-center" style={{ gap: 6, height: 36, padding: "0 14px", borderRadius: 10, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><Plus size={14} /> New question</button>
                          {addOpen ? (
                            <>
                              <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setAddOpen(false)} />
                              <div style={{ position: "absolute", right: 0, marginTop: 4, width: 240, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 12px 36px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 31 }}>
                                {Q_TYPES.map((t) => { const m = qMeta[t]; const Icon = m.icon; return (
                                  <button key={t} onClick={() => addQuestion(t)} className="w-full flex items-center" style={{ gap: 10, padding: "10px 12px", background: "transparent", border: "none", textAlign: "left" }}>
                                    <span className="flex items-center justify-center" style={{ width: 28, height: 28, borderRadius: 6, background: `${m.tint}1A`, color: m.tint, flexShrink: 0 }}><Icon size={14} /></span>
                                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{m.label}</span>
                                  </button>
                                ); })}
                              </div>
                            </>
                          ) : null}
                        </div>
                        <button onClick={() => void save()} disabled={saving} className="flex items-center" style={{ gap: 6, height: 36, padding: "0 16px", borderRadius: 10, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: saving ? 0.6 : 1 }}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
                      </div>
                    </div>

                    <div className="flex flex-col" style={{ gap: 12 }}>
                      {questions.map((q, i) => (
                        <QCard key={q.key} q={q} index={i} expanded={expanded === q.key} onToggle={() => setExpanded((e) => (e === q.key ? null : q.key))} onPatch={(fn) => patch(q.key, fn)} onRemove={() => remove(q)} />
                      ))}
                      {questions.length === 0 ? (
                        <div className="text-center" style={{ borderRadius: 16, padding: "44px 24px", background: "var(--card)", border: "1.5px dashed var(--border)" }}>
                          <div className="flex items-center justify-center" style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.10)", color: "var(--nuru-gold)" }}><HelpCircle size={22} /></div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>No questions yet</div>
                          <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>Add the first exam question.</p>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QCard({ q, index, expanded, onToggle, onPatch, onRemove }: { q: Q; index: number; expanded: boolean; onToggle: () => void; onPatch: (fn: (q: Q) => Q) => void; onRemove: () => void }): ReactElement {
  const meta = qMeta[q.type]; const Icon = meta.icon;
  const answered = q.type === "fillblank" ? !!q.answer.trim() : q.options.some((o) => o.correct);
  function selectCorrect(id: number): void { onPatch((x) => ({ ...x, options: x.options.map((o) => ({ ...o, correct: o.id === id })) })); }
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)", boxShadow: expanded ? "0 4px 16px rgba(11,31,51,0.06)" : "none", position: "relative" }}>
      {expanded ? <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 5, background: "var(--nuru-gold)" }} /> : null}
      {!expanded ? (
        <div onClick={onToggle} style={{ padding: "14px 18px", cursor: "pointer" }} className="flex items-start" >
          <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--muted-foreground)", minWidth: 24 }}>{index + 1}.</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 14.5, color: "var(--nuru-navy)", fontWeight: 500, lineHeight: 1.45 }}>{q.text || "Untitled question"}</p>
            <div className="flex items-center" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11.5, color: "var(--muted-foreground)" }}><Icon size={11} style={{ color: meta.tint }} /> {meta.label}</span>
              <span style={{ fontSize: 11.5, color: diffColor[q.difficulty], fontWeight: 600 }}>· {q.difficulty}</span>
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· {q.points} pt{q.points === 1 ? "" : "s"}</span>
              {!answered ? <span className="inline-flex items-center" style={{ gap: 4, fontSize: 11, color: "#DC2626", fontWeight: 600 }}><AlertTriangle size={10} /> No answer set</span> : null}
              {!q.active ? <span style={{ fontSize: 10, fontWeight: 700, color: "#6B7280", background: "#F3F4F6", borderRadius: 4, padding: "0 6px" }}>DRAFT</span> : null}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ padding: "18px 22px 18px 26px" }}>
          <div className="flex items-start" style={{ gap: 12, marginBottom: 16 }}>
            <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--muted-foreground)", minWidth: 26, marginTop: 6 }}>{index + 1}.</span>
            <textarea value={q.text} onChange={(e) => onPatch((x) => ({ ...x, text: e.target.value }))} rows={2} placeholder="Question" className="flex-1 outline-none" style={{ fontSize: 15.5, color: "var(--nuru-navy)", fontWeight: 500, lineHeight: 1.5, padding: "6px 10px", background: "var(--input-background)", borderRadius: 8, border: "1px solid transparent", resize: "vertical" }} />
            <select value={q.type} onChange={(e) => { const type = e.target.value as QType; onPatch((x) => ({ ...x, type, options: type === "truefalse" ? [{ id: 1, text: "True", correct: false }, { id: 2, text: "False", correct: false }] : type === "mcq" ? (x.options.length ? x.options : [{ id: 1, text: "Option A", correct: false }, { id: 2, text: "Option B", correct: false }]) : [] })); }} className="rounded-lg px-3 outline-none" style={{ height: 38, fontSize: 12.5, color: "var(--foreground)", background: "var(--background)", border: "1px solid var(--border)", minWidth: 150 }}>
              {Q_TYPES.map((t) => <option key={t} value={t}>{qMeta[t].label}</option>)}
            </select>
          </div>
          {q.type !== "fillblank" ? (
            <div className="flex flex-col" style={{ paddingLeft: 38, gap: 2 }}>
              {q.options.map((opt) => (
                <div key={opt.id} className="group flex items-center rounded-md" style={{ gap: 12, padding: "6px 8px" }}>
                  <button onClick={() => selectCorrect(opt.id)} className="flex items-center justify-center" style={{ width: 20, height: 20, flexShrink: 0, borderRadius: q.type === "truefalse" ? "50%" : 4, background: opt.correct ? "#16A34A" : "transparent", border: opt.correct ? "none" : "2px solid #C9CFD6", color: "#fff" }}>{opt.correct ? <Check size={12} strokeWidth={3} /> : null}</button>
                  <input value={opt.text} disabled={q.type === "truefalse"} onChange={(e) => onPatch((x) => ({ ...x, options: x.options.map((o) => (o.id === opt.id ? { ...o, text: e.target.value } : o)) }))} className="bg-transparent outline-none flex-1" style={{ fontSize: 13.5, color: "var(--foreground)", border: "none", borderBottom: "1px solid transparent", padding: "4px 0" }} />
                  {q.type === "mcq" && q.options.length > 2 ? <button onClick={() => onPatch((x) => ({ ...x, options: x.options.filter((o) => o.id !== opt.id) }))} className="opacity-0 group-hover:opacity-100" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Trash2 size={13} /></button> : null}
                </div>
              ))}
              {q.type === "mcq" ? <button onClick={() => onPatch((x) => ({ ...x, options: [...x.options, { id: x.options.reduce((m, o) => Math.max(m, o.id), 0) + 1, text: `Option ${String.fromCharCode(65 + x.options.length)}`, correct: false }] }))} className="text-left" style={{ fontSize: 13, color: "var(--muted-foreground)", background: "none", border: "none", padding: "4px 0 4px 32px" }}>Add option</button> : null}
            </div>
          ) : (
            <div style={{ paddingLeft: 38 }}>
              <input value={q.answer} onChange={(e) => onPatch((x) => ({ ...x, answer: e.target.value }))} placeholder="Correct answer" className="w-full bg-transparent outline-none" style={{ fontSize: 13.5, color: "var(--foreground)", fontFamily: "var(--font-mono)", border: "none", borderBottom: "1.5px solid var(--border)", padding: "6px 0" }} />
            </div>
          )}
          <div style={{ marginTop: 16, paddingLeft: 38 }}>
            <textarea value={q.explanation} onChange={(e) => onPatch((x) => ({ ...x, explanation: e.target.value }))} rows={2} placeholder="Explanation (shown after answering)" className="w-full bg-transparent outline-none" style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, border: "none", borderBottom: "1px dashed var(--border)", padding: "6px 0", resize: "vertical" }} />
          </div>
          <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 12, marginTop: 16, paddingTop: 14, paddingLeft: 38, borderTop: "1px solid var(--border)" }}>
            <div className="flex items-center" style={{ gap: 14, flexWrap: "wrap" }}>
              <div className="flex items-center" style={{ gap: 6 }}>
                {DIFFS.map((d) => { const on = q.difficulty === d; return <button key={d} onClick={() => onPatch((x) => ({ ...x, difficulty: d }))} className="rounded-full" style={{ height: 26, padding: "0 10px", fontSize: 11, fontWeight: 700, background: on ? diffColor[d] : "transparent", color: on ? "#fff" : diffColor[d], border: on ? "none" : `1px solid ${diffColor[d]}55` }}>{d}</button>; })}
              </div>
              <div className="flex items-center" style={{ gap: 6 }}>
                <Sparkles size={12} style={{ color: "var(--nuru-gold)" }} />
                <input type="number" min={1} value={q.points} onChange={(e) => onPatch((x) => ({ ...x, points: Math.max(1, Number(e.target.value)) }))} className="bg-transparent outline-none" style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 600, width: 38, textAlign: "center", border: "none", borderBottom: "1px solid var(--border)" }} />
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>pts</span>
              </div>
              <button onClick={() => onPatch((x) => ({ ...x, active: !x.active }))} style={{ fontSize: 12, color: q.active ? "var(--nuru-navy)" : "var(--muted-foreground)", fontWeight: 600, background: "none", border: "none" }}>{q.active ? "Active" : "Draft"}</button>
            </div>
            <div className="flex items-center" style={{ gap: 8 }}>
              <button onClick={onRemove} style={{ fontSize: 12, color: "#DC2626", fontWeight: 600, background: "none", border: "none", display: "flex", alignItems: "center", gap: 4 }}><Trash2 size={13} /> Delete</button>
              <button onClick={onToggle} className="rounded-lg" style={{ height: 30, padding: "0 12px", fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", background: "none", border: "none" }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
