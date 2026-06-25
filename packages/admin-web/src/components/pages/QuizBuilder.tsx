// Level Quiz Builder — the dedicated page (/quiz-builder). Left: a level picker.
// Right: the selected level's FINAL ASSESSMENT, which in our server-authoritative
// model (§1.9) is the level's exit-exam module's question bank plus the level's
// exam settings (pass mark + reveal/shuffle flags). The six-type question editor
// is the shared <ModuleQuizBuilder>; this wrapper only resolves the exit-exam
// module and wires settings to updateExam (level-exam endpoint, PR #117).
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, BookOpen, Layers, Check, Award, Clock, Lock, Plus } from "lucide-react";
import {
  CurriculumApi, type AdminLevel, type AdminModuleSummary,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { ModuleQuizBuilder, type QuizSettings } from "../curriculum/ModuleQuizBuilder";

const statusStyle: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  in_review: { bg: "#FDF5E5", color: "#8A6B1F" },
};
const statusLabel: Record<string, string> = { published: "Published", draft: "Draft", in_review: "In Review", archived: "Archived" };

function examSettings(lvl: AdminLevel): QuizSettings {
  return {
    passMark: Math.round(Number(lvl.required_exam_pass_mark) || 80),
    shuffleQuestions: lvl.exam_shuffle ?? false,
    showAnswersAfterSubmit: lvl.exam_show_answers ?? false,
    showScoreAfterSubmit: lvl.exam_show_score ?? true,
    timeLimitMinutes: null, // level exams have no client-set time limit in the schema
  };
}

export function QuizBuilder(): ReactElement {
  const navigate = useNavigate();
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [selNo, setSelNo] = useState<number | null>(null);
  const [examModuleId, setExamModuleId] = useState<string | null>(null);
  const [examMissing, setExamMissing] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void CurriculumApi.levels()
      .then((ls) => { setLevels(ls); setSelNo((c) => c ?? ls[0]?.level_number ?? null); })
      .catch((e) => setError(errorMessage(e, "Load failed")));
  }, []);

  const resolveExam = useCallback(async (levelNo: number) => {
    setError(null); setResolving(true); setExamModuleId(null); setExamMissing(false);
    try {
      const mods = await CurriculumApi.modules(levelNo);
      const exam = mods.find((m: AdminModuleSummary) => m.evaluation_kind === "exit_exam");
      if (!exam) { setExamMissing(true); return; }
      setExamModuleId(exam.module_id);
    } catch (e) {
      setError(errorMessage(e, "Could not load the level exam."));
    } finally {
      setResolving(false);
    }
  }, []);

  useEffect(() => { if (selNo != null && levels.length) void resolveExam(selNo); }, [selNo, levels, resolveExam]);

  const selLevel = levels.find((l) => l.level_number === selNo) ?? null;

  async function createExam(): Promise<void> {
    if (selNo == null) return;
    try {
      await CurriculumApi.createModule({
        level_number: selNo,
        title: `Level ${selNo} — Final Assessment`,
        lesson_content: "Level exit exam.",
        evaluation_kind: "exit_exam",
      });
      await resolveExam(selNo);
    } catch (e) { setError(errorMessage(e, "Could not create the level exam.")); }
  }

  const saveSettings = useCallback(async (s: QuizSettings, activeCount: number): Promise<void> => {
    if (selNo == null) return;
    await CurriculumApi.updateExam(selNo, {
      required_exam_pass_mark: s.passMark,
      exam_question_count: activeCount,
      exam_shuffle: s.shuffleQuestions,
      exam_show_answers: s.showAnswersAfterSubmit,
      exam_show_score: s.showScoreAfterSubmit,
    });
    // Reflect the saved pass mark locally so re-selecting the level shows it.
    setLevels((prev) => prev.map((l) =>
      l.level_number === selNo
        ? { ...l, required_exam_pass_mark: String(s.passMark), exam_shuffle: s.shuffleQuestions, exam_show_answers: s.showAnswersAfterSubmit, exam_show_score: s.showScoreAfterSubmit }
        : l));
  }, [selNo]);

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
            <p style={{ fontSize: 12, color: "rgba(232,239,245,0.5)", marginTop: 4 }}>Build the final assessment disciples take after completing a level.</p>
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

      <div className="r-split" style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT — level selector */}
        <div className="r-split-rail" style={{ width: 288, flexShrink: 0, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            <p style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>Select a level</p>
            <p style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>The exam gates level completion.</p>
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
                <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                  <Award size={13} style={{ color: selLevel.color }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: selLevel.color }}>Final assessment</span>
                </div>
              </div>

              {error ? <div style={{ padding: "8px 24px", color: "#A8281F", fontSize: 12.5, background: "#FDF4F4", borderBottom: "1px solid var(--border)" }}>{error}</div> : null}

              <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                {resolving ? (
                  <div style={{ padding: 40, textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading exam…</div>
                ) : examMissing ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 40 }}>
                    <div className="nuru-card" style={{ padding: 32, maxWidth: 440, textAlign: "center" }}>
                      <div style={{ width: 52, height: 52, borderRadius: 16, margin: "0 auto 12px", background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)", display: "grid", placeItems: "center" }}><Award size={22} /></div>
                      <h3 className="type-section" style={{ fontSize: 18 }}>No exam for this level yet</h3>
                      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6 }}>Create the level's final assessment to start adding questions.</p>
                      <button onClick={() => void createExam()} className="flex items-center gap-2" style={{ margin: "16px auto 0", height: 40, padding: "0 18px", borderRadius: 10, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}><Plus size={14} /> Create level exam</button>
                    </div>
                  </div>
                ) : examModuleId ? (
                  <ModuleQuizBuilder
                    key={examModuleId}
                    moduleId={examModuleId}
                    accent={selLevel.color}
                    settings={examSettings(selLevel)}
                    onSaveSettings={saveSettings}
                    settingsLabel="Exam settings"
                  />
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
