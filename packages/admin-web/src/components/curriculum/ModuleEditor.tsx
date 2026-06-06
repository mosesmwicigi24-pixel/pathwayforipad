// Blog-like module editor (Prompt 5 Phase E). Split-pane Markdown editor with a
// live sanitized preview, evaluation-kind + quiz authoring, draft/publish with
// validation, and version history. Optimistic-concurrency: edits carry the
// row_version we loaded; the server rejects (409) a stale overwrite.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  CurriculumApi,
  type AdminModule,
  type AdminQuestion,
  type EvaluationKind,
  type ModuleVersion,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { publishBlockReason, questionDraftErrors, type QuestionDraft } from "../../util/curriculumLogic";
import { MarkdownPreview } from "../MarkdownPreview";

const KINDS: EvaluationKind[] = ["none", "reflection", "quiz", "exit_exam"];

export function ModuleEditor({
  moduleId,
  onChanged,
}: {
  moduleId: string;
  onChanged: () => void;
}): ReactElement {
  const [mod, setMod] = useState<AdminModule | null>(null);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [versions, setVersions] = useState<ModuleVersion[]>([]);
  const [showVersions, setShowVersions] = useState(false);
  const [showStudent, setShowStudent] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Editable fields
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [kind, setKind] = useState<EvaluationKind>("none");
  const [passMark, setPassMark] = useState("70");
  const [minutes, setMinutes] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = await CurriculumApi.module(moduleId);
      setMod(m);
      setTitle(m.title);
      setSummary(m.summary ?? "");
      setKind(m.evaluation_kind);
      setPassMark(String(m.quiz_pass_mark));
      setMinutes(m.estimated_minutes === null ? "" : String(m.estimated_minutes));
      setContent(m.lesson_content);
      setQuestions(await CurriculumApi.questions(moduleId));
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e, "Could not load the module."));
    }
  }, [moduleId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Unsaved-changes guard on navigation/refresh.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const touch = <T,>(setter: (v: T) => void) => (v: T): void => {
    setter(v);
    setDirty(true);
  };

  async function save(): Promise<void> {
    if (!mod) return;
    setError(null);
    try {
      const updated = await CurriculumApi.updateModule(moduleId, {
        title,
        summary: summary || null,
        evaluation_kind: kind,
        quiz_pass_mark: Number(passMark),
        estimated_minutes: minutes === "" ? null : Number(minutes),
        lesson_content: content,
        expected_row_version: mod.row_version,
      });
      setMod(updated);
      setDirty(false);
      setNotice("Saved draft.");
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Save failed — the module may have changed in another tab (reload)."));
    }
  }

  async function doPublish(): Promise<void> {
    setError(null);
    try {
      setMod(await CurriculumApi.publish(moduleId));
      setNotice("Published.");
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Publish rejected by validation."));
    }
  }
  async function doUnpublish(): Promise<void> {
    setMod(await CurriculumApi.unpublish(moduleId));
    setNotice("Unpublished (back to draft).");
    onChanged();
  }
  async function openVersions(): Promise<void> {
    setVersions(await CurriculumApi.versions(moduleId));
    setShowVersions(true);
  }
  async function revert(versionNumber: number): Promise<void> {
    await CurriculumApi.revert(moduleId, versionNumber);
    setShowVersions(false);
    await load();
    setNotice(`Reverted to v${versionNumber} (as a new version).`);
  }

  if (!mod) return <p style={{ padding: 16 }}>{error ?? "Loading…"}</p>;

  const block = publishBlockReason({ evaluation_kind: kind, activeQuestionCount: questions.length, dirty });

  return (
    <section style={{ padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>
          Module {mod.module_sequence_number} · <StatusChip status={mod.status} />
        </h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => setShowStudent(true)}>
            Preview as student
          </button>
          <button type="button" onClick={() => void openVersions()}>
            History
          </button>
        </div>
      </header>

      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}
      {notice ? <p style={{ color: "#15803d" }}>{notice}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <label>
          Title
          <input value={title} onChange={(e) => touch(setTitle)(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Evaluation kind (drives gating)
          <select value={kind} onChange={(e) => touch(setKind)(e.target.value as EvaluationKind)} style={inputStyle}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Quiz pass mark (%)
          <input value={passMark} onChange={(e) => touch(setPassMark)(e.target.value)} style={inputStyle} />
        </label>
        <label>
          Estimated minutes
          <input value={minutes} onChange={(e) => touch(setMinutes)(e.target.value)} style={inputStyle} />
        </label>
        <label style={{ gridColumn: "1 / span 2" }}>
          Summary
          <input value={summary} onChange={(e) => touch(setSummary)(e.target.value)} style={inputStyle} />
        </label>
      </div>

      <h3 style={{ marginTop: 16 }}>Lesson (Markdown)</h3>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <textarea
          aria-label="Lesson markdown"
          value={content}
          onChange={(e) => touch(setContent)(e.target.value)}
          style={{ ...inputStyle, minHeight: 280, fontFamily: "ui-monospace, monospace" }}
        />
        <div style={{ border: "1px solid #e5e7eb", borderRadius: 6, padding: 12, overflow: "auto", maxHeight: 320 }}>
          <MarkdownPreview content={content} />
        </div>
      </div>

      {kind === "quiz" ? <QuizPanel moduleId={moduleId} questions={questions} onChange={setQuestions} /> : null}

      <footer style={{ display: "flex", gap: 8, marginTop: 16, alignItems: "center" }}>
        <button type="button" onClick={() => void save()} disabled={!dirty}>
          Save draft
        </button>
        {mod.status === "published" ? (
          <button type="button" onClick={() => void doUnpublish()}>
            Unpublish
          </button>
        ) : (
          <button type="button" onClick={() => void doPublish()} disabled={block !== null} title={block ?? "Publish"}>
            Publish
          </button>
        )}
        {block ? <span style={{ color: "#92400e", fontSize: 13 }}>{block}</span> : null}
      </footer>

      {showStudent ? (
        <Modal onClose={() => setShowStudent(false)} title="Preview as student">
          <h3>{title}</h3>
          {summary ? <p style={{ color: "#6b7280" }}>{summary}</p> : null}
          <MarkdownPreview content={content} />
        </Modal>
      ) : null}

      {showVersions ? (
        <Modal onClose={() => setShowVersions(false)} title="Version history">
          <ul>
            {versions.map((v) => (
              <li key={v.version_id} style={{ marginBottom: 6 }}>
                v{v.version_number} — {v.edited_by_name ?? "unknown"} · {new Date(v.created_at).toLocaleString()}{" "}
                <button type="button" onClick={() => void revert(v.version_number)}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}
    </section>
  );
}

function QuizPanel({
  moduleId,
  questions,
  onChange,
}: {
  moduleId: string;
  questions: AdminQuestion[];
  onChange: (qs: AdminQuestion[]) => void;
}): ReactElement {
  const [draft, setDraft] = useState<QuestionDraft>({
    q_type: "MultipleChoice",
    question_text: "",
    answer_options: ["", ""],
    correct_answer: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const errors = questionDraftErrors(draft);

  async function add(): Promise<void> {
    if (errors.length > 0) return;
    setErr(null);
    try {
      await CurriculumApi.addQuestions(moduleId, [
        {
          q_type: draft.q_type,
          question_text: draft.question_text,
          ...(draft.q_type === "MultipleChoice"
            ? { answer_options: (draft.answer_options ?? []).filter((o) => o.trim()) }
            : {}),
          correct_answer: draft.correct_answer,
        },
      ]);
      onChange(await CurriculumApi.questions(moduleId));
      setDraft({ q_type: "MultipleChoice", question_text: "", answer_options: ["", ""], correct_answer: "" });
    } catch (e) {
      setErr(errorMessage(e, "Could not add the question."));
    }
  }
  async function remove(qid: string): Promise<void> {
    await CurriculumApi.deleteQuestion(qid);
    onChange(await CurriculumApi.questions(moduleId));
  }

  return (
    <div style={{ marginTop: 16, border: "1px solid #e5e7eb", borderRadius: 6, padding: 12 }}>
      <h3 style={{ marginTop: 0 }}>Quiz questions ({questions.length})</h3>
      <ul>
        {questions.map((q) => (
          <li key={q.question_id}>
            [{q.q_type}] {q.question_text} → <strong>{q.correct_answer}</strong>{" "}
            <button type="button" onClick={() => void remove(q.question_id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>

      <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
        <select
          value={draft.q_type}
          onChange={(e) => setDraft({ ...draft, q_type: e.target.value as QuestionDraft["q_type"] })}
          aria-label="Question type"
        >
          <option value="MultipleChoice">MultipleChoice</option>
          <option value="TrueFalse">TrueFalse</option>
          <option value="FillInTheBlank">FillInTheBlank</option>
        </select>
        <input
          placeholder="Question text"
          aria-label="Question text"
          value={draft.question_text}
          onChange={(e) => setDraft({ ...draft, question_text: e.target.value })}
        />
        {draft.q_type === "MultipleChoice" ? (
          <input
            placeholder="Options (comma-separated)"
            aria-label="Options"
            value={(draft.answer_options ?? []).join(",")}
            onChange={(e) => setDraft({ ...draft, answer_options: e.target.value.split(",") })}
          />
        ) : null}
        <input
          placeholder="Correct answer"
          aria-label="Correct answer"
          value={draft.correct_answer}
          onChange={(e) => setDraft({ ...draft, correct_answer: e.target.value })}
        />
        {errors.length > 0 ? (
          <ul style={{ color: "#b91c1c", margin: 0 }}>
            {errors.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : null}
        {err ? <p style={{ color: "#b91c1c" }}>{err}</p> : null}
        <button type="button" onClick={() => void add()} disabled={errors.length > 0}>
          Add question
        </button>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }): ReactElement {
  const color = status === "published" ? "#15803d" : status === "archived" ? "#6b7280" : "#b45309";
  return <span style={{ color, fontSize: 13, textTransform: "uppercase" }}>{status}</span>;
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", padding: 20, borderRadius: 8, maxWidth: 640, maxHeight: "80vh", overflow: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <h2 style={{ marginTop: 0 }}>{title}</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 6,
  marginTop: 4,
  border: "1px solid #d1d5db",
  borderRadius: 4,
};
