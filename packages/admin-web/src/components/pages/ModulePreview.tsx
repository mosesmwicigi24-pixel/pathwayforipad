// Module Preview — full-screen learner view of a module, rebuilt to the make and
// wired to the live API (CurriculumApi.module + questions + level for accent).
// Renders content via MarkdownPreview and a non-interactive learner question view
// for the server-scored types (MCQ / True-False / Fill-blank). Reached in-session
// from the editor; a cold/new-tab load with no session shows a friendly empty state.
import { useEffect, useState, type ReactElement } from "react";
import { useParams } from "react-router-dom";
import { BookOpen, Clock, Target, GraduationCap, PlayCircle, X, Eye, HelpCircle, Award, Hash } from "lucide-react";
import { CurriculumApi, type AdminModule, type AdminQuestion, type AdminLevel } from "../../api/client";
import { MarkdownPreview } from "../MarkdownPreview";

const diffStyle: Record<string, { bg: string; color: string }> = {
  beginner: { bg: "#E8F6EE", color: "#0F6B33" },
  intermediate: { bg: "#FDF5E5", color: "#8A6B1F" },
  advanced: { bg: "#FDECEC", color: "#A8281F" },
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Learner-side option labels for any choice question (legacy string[] or Figma choices). */
function previewOptions(q: AdminQuestion): string[] {
  if (q.q_type === "TrueFalse") return ["True", "False"];
  const ao = q.answer_options;
  if (Array.isArray(ao)) return ao;
  if (ao && "choices" in ao) return ao.choices.map((c) => c.text);
  return [];
}
function previewScale(q: AdminQuestion): { min: number; max: number; minLabel: string | null; maxLabel: string | null } | null {
  const ao = q.answer_options;
  if (ao && !Array.isArray(ao) && "scale" in ao && ao.scale) {
    return { min: ao.scale.min, max: ao.scale.max, minLabel: ao.scale.min_label, maxLabel: ao.scale.max_label };
  }
  return null;
}

function QuestionView({ q, idx, accent }: { q: AdminQuestion; idx: number; accent: string }): ReactElement {
  const inputBase = { width: "100%", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 14, padding: "10px 14px", color: "var(--muted-foreground)", outline: "none" } as const;
  const isChoice = q.q_type === "MultipleChoice" || q.q_type === "TrueFalse" || q.q_type === "multiple_choice" || q.q_type === "dropdown" || q.q_type === "checkbox";
  const multi = q.q_type === "checkbox";
  const opts = isChoice ? previewOptions(q) : [];
  const scale = q.q_type === "linear_scale" ? previewScale(q) : null;
  const steps = scale ? Array.from({ length: Math.max(0, scale.max - scale.min + 1) }, (_, i) => scale.min + i) : [];
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: "20px 22px" }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: accent, color: "#fff", fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.45 }}>{q.question_text || <span style={{ color: "var(--muted-foreground)", fontStyle: "italic" }}>Untitled question</span>}</div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 3 }}>{q.points} {q.points === 1 ? "point" : "points"}{q.required === false ? " · optional" : ""}</div>
        </div>
      </div>
      <div style={{ paddingLeft: 34, display: "flex", flexDirection: "column", gap: 10 }}>
        {isChoice ? opts.map((o, i) => (
          <label key={`${o}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "var(--foreground)", cursor: "default" }}>
            <span style={{ width: 18, height: 18, flexShrink: 0, border: "2px solid var(--border)", borderRadius: multi ? 4 : 999, background: "var(--card)" }} /> {o}
          </label>
        )) : null}
        {q.q_type === "short_answer" ? <input disabled placeholder="Your answer" style={{ ...inputBase, height: 44 }} /> : null}
        {q.q_type === "FillInTheBlank" ? <input disabled placeholder="Your answer" style={{ ...inputBase, height: 44 }} /> : null}
        {q.q_type === "paragraph" ? <textarea disabled placeholder="Your answer" rows={3} style={{ ...inputBase, resize: "none" }} /> : null}
        {scale ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)", minWidth: 60 }}>{scale.minLabel || scale.min}</span>
            <div style={{ display: "flex", gap: 14, flex: 1, justifyContent: "center", flexWrap: "wrap" }}>
              {steps.map((n) => (
                <span key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 18, height: 18, borderRadius: "50%", border: "2px solid var(--border)" }} />
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{n}</span>
                </span>
              ))}
            </div>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)", minWidth: 60, textAlign: "right" }}>{scale.maxLabel || scale.max}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ModulePreview(): ReactElement {
  const { moduleId } = useParams<{ moduleId: string }>();
  const [mod, setMod] = useState<AdminModule | null>(null);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [level, setLevel] = useState<AdminLevel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!moduleId) { setLoading(false); return; }
    let alive = true;
    void (async () => {
      try {
        const m = await CurriculumApi.module(moduleId);
        if (!alive) return;
        setMod(m);
        const [qs, levels] = await Promise.all([
          CurriculumApi.questions(moduleId).catch(() => [] as AdminQuestion[]),
          CurriculumApi.levels().catch(() => [] as AdminLevel[]),
        ]);
        if (!alive) return;
        setQuestions(qs.filter((q) => q.is_active));
        setLevel(levels.find((l) => l.level_number === m.level_number) ?? null);
      } catch { /* unauth / not found → empty state */ }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [moduleId]);

  const accent = level?.color ?? "#0B84E8";

  if (loading) return <div style={{ minHeight: "100vh", background: "var(--background)", display: "grid", placeItems: "center", color: "var(--muted-foreground)" }}>Loading preview…</div>;

  if (!mod) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--background)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
        <Eye size={28} style={{ color: "var(--muted-foreground)" }} />
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)" }}>Nothing to preview</h2>
        <p style={{ fontSize: 14, color: "var(--muted-foreground)", textAlign: "center", maxWidth: 360 }}>Open this preview from the module editor so we can load the latest content in your session.</p>
        <button onClick={() => window.close()} style={{ height: 40, padding: "0 20px", borderRadius: 10, border: "none", background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>Close preview</button>
      </div>
    );
  }

  const words = (mod.lesson_content ?? "").trim().split(/\s+/).filter(Boolean).length;
  const readMins = Math.max(1, Math.ceil(words / 200));
  const objectives = (mod.objectives ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
  const scriptures = mod.key_verses ?? [];
  const tags = (mod.tags ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const ds = diffStyle[mod.difficulty] ?? diffStyle.beginner!;
  const totalPoints = questions.reduce((s, q) => s + q.points, 0);

  return (
    <div style={{ minHeight: "100vh", background: "var(--background)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--nuru-dark)", color: "#fff", padding: "10px clamp(16px,4vw,40px)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600 }}><Eye size={14} style={{ color: "var(--nuru-gold)" }} /> Learner preview <span style={{ color: "rgba(232,239,245,0.5)", fontWeight: 400 }}>· how disciples see this module</span></div>
        <button onClick={() => window.close()} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 8, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.18)", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer" }}><X size={13} /> Close</button>
      </div>

      <div style={{ background: `linear-gradient(180deg, ${accent}14 0%, transparent 100%)`, borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px clamp(16px,4vw,24px) 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600, marginBottom: 10 }}>
            <GraduationCap size={13} style={{ color: accent }} /> {level ? `Level ${level.level_number} · ${level.title}` : `Level ${mod.level_number}`} <span>· Module {mod.module_sequence_number}</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(28px,5vw,38px)", color: "var(--nuru-navy)", lineHeight: 1.1, letterSpacing: "-0.01em" }}>{mod.title || "Untitled module"}</h1>
          {mod.summary ? <p style={{ fontSize: 15.5, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.6, maxWidth: 620 }}>{mod.summary}</p> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 700, borderRadius: 999, padding: "5px 12px", background: ds.bg, color: ds.color }}>{cap(mod.difficulty)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "5px 12px", background: "var(--secondary)", color: "var(--nuru-navy)" }}><Clock size={12} /> {mod.estimated_minutes ?? readMins} min</span>
            {questions.length > 0 ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "5px 12px", background: "var(--secondary)", color: "var(--nuru-navy)" }}><HelpCircle size={12} /> {questions.length} question{questions.length === 1 ? "" : "s"}</span> : null}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px clamp(16px,4vw,24px) 64px" }}>
        {objectives.length > 0 ? (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Target size={16} style={{ color: accent }} /><span style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>What you'll learn</span></div>
            <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
              {objectives.map((o) => <li key={o} style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 14, color: "var(--foreground)", lineHeight: 1.5 }}><span style={{ marginTop: 7, width: 6, height: 6, borderRadius: 999, background: accent, flexShrink: 0 }} /> {o}</li>)}
            </ul>
          </div>
        ) : null}

        {mod.video_url ? (
          <div style={{ borderRadius: 16, overflow: "hidden", marginBottom: 24, border: "1px solid var(--border)" }}>
            <div style={{ aspectRatio: "16 / 9", background: "linear-gradient(135deg, #0B1F33, #1E4068)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: "#fff" }}><PlayCircle size={48} style={{ opacity: 0.9 }} /><span style={{ fontSize: 14, fontWeight: 600 }}>Lesson video</span></div>
          </div>
        ) : null}

        {(mod.lesson_content ?? "").trim() ? <MarkdownPreview content={mod.lesson_content} /> : <p style={{ fontSize: 14, color: "var(--muted-foreground)", fontStyle: "italic" }}>No lesson content yet.</p>}

        {scriptures.length > 0 ? (
          <div style={{ background: "linear-gradient(180deg, #FFFBEB 0%, #FDF5DA 100%)", border: "1px solid #F5E0A8", borderRadius: 16, padding: "18px 20px", marginTop: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><BookOpen size={16} style={{ color: "#A87616" }} /><span style={{ fontSize: 13, fontWeight: 700, color: "#7A5410" }}>Key scripture</span></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{scriptures.map((s) => <span key={s} style={{ fontSize: 13, fontWeight: 600, color: "#0B1F33", background: "rgba(255,255,255,0.7)", borderRadius: 8, padding: "5px 12px" }}>{s}</span>)}</div>
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 20 }}>{tags.map((t) => <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)", background: "var(--secondary)", borderRadius: 999, padding: "4px 10px" }}><Hash size={10} style={{ color: accent }} /> {t}</span>)}</div>
        ) : null}

        {questions.length > 0 ? (
          <div style={{ marginTop: 40 }}>
            <div style={{ height: 1, background: "var(--border)", marginBottom: 28 }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{mod.evaluation_kind === "reflection" ? "Reflection" : "Module quiz"}</h2>
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12.5, color: "var(--muted-foreground)", fontWeight: 600 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><HelpCircle size={14} /> {questions.length} questions</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Award size={14} /> {totalPoints} points</span>
                {mod.evaluation_kind === "quiz" ? <span>Pass: {Math.round(Number(mod.quiz_pass_mark))}%</span> : null}
              </div>
            </div>
            <p style={{ fontSize: 13.5, color: "var(--muted-foreground)", marginBottom: 22 }}>Answer the questions below to complete this module.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>{questions.map((q, i) => <QuestionView key={q.question_id} q={q} idx={i} accent={accent} />)}</div>
            <button disabled style={{ marginTop: 24, height: 46, padding: "0 28px", borderRadius: 12, border: "none", background: accent, color: "#fff", fontSize: 14, fontWeight: 700, opacity: 0.85, cursor: "default" }}>Submit answers</button>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 8 }}>Preview only — submission is disabled.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
