// Level Detail — right-panel module editor, built to match the Figma make exactly
// (uppercase eyebrow labels, level pill + serif "Module {seq}" header, colour-tinted
// evaluation select, bordered Preview/History, Save/Publish/Archive footer). Wired
// to the real CurriculumApi (load/save/publish/unpublish/archive, optimistic
// row_version) and the Video Library for the lesson-video select.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Eye, History, AlertTriangle, X } from "lucide-react";
import {
  CurriculumApi,
  MediaApi,
  type AdminLevel,
  type AdminModule,
  type EvaluationKind,
  type MediaAssetRow,
  type ModuleVersion,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { MarkdownPreview } from "../MarkdownPreview";

const evalStyle: Record<string, { bg: string; color: string }> = {
  quiz: { bg: "rgba(124,58,237,0.10)", color: "#7C3AED" },
  reflection: { bg: "rgba(11,132,232,0.10)", color: "#0B84E8" },
};
const statusPill: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  archived: { bg: "#F3F4F6", color: "#94A3B8" },
};
const eyebrow = { fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 } as const;
const inputBase = { width: "100%", boxSizing: "border-box", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 14, padding: "0 14px", color: "var(--foreground)", outline: "none" } as const;
const TOOLBAR = [
  { label: "H", insert: "\n## Heading\n", s: { fontFamily: "var(--font-display)", fontSize: 14 } },
  { label: "B", insert: "**bold**", s: { fontWeight: 800, fontSize: 13 } },
  { label: "I", insert: "_italic_", s: { fontStyle: "italic", fontSize: 13 } },
  { label: "``", insert: "\n```\ncode\n```\n", s: { fontFamily: "monospace", fontSize: 11, fontWeight: 700 } },
  { label: "—", insert: "\n---\n", s: { fontSize: 14 } },
] as const;

export function LevelModulePane({
  moduleId,
  level,
  onChanged,
  onArchived,
}: {
  moduleId: string;
  level: AdminLevel | null;
  onChanged: () => void;
  onArchived: () => void;
}): ReactElement {
  const [mod, setMod] = useState<AdminModule | null>(null);
  const [assets, setAssets] = useState<MediaAssetRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [versions, setVersions] = useState<ModuleVersion[] | null>(null);

  // Editable fields
  const [title, setTitle] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationKind>("none");
  const [passMark, setPassMark] = useState("0");
  const [minutes, setMinutes] = useState("");
  const [summary, setSummary] = useState("");
  const [videoId, setVideoId] = useState("");
  const [content, setContent] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const m = await CurriculumApi.module(moduleId);
      setMod(m);
      setTitle(m.title);
      setEvaluation(m.evaluation_kind);
      setPassMark(String(m.quiz_pass_mark));
      setMinutes(m.estimated_minutes === null ? "" : String(m.estimated_minutes));
      setSummary(m.summary ?? "");
      setVideoId(m.media_asset_id ?? "");
      setContent(m.lesson_content);
      setDirty(false);
    } catch (e) {
      setError(errorMessage(e, "Could not load the module."));
    }
  }, [moduleId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void MediaApi.list().then((r) => setAssets(r.data)).catch(() => setAssets([])); }, []);

  const touch = <T,>(set: (v: T) => void) => (v: T): void => { set(v); setDirty(true); };

  async function save(): Promise<void> {
    if (!mod) return;
    setError(null);
    try {
      const updated = await CurriculumApi.updateModule(moduleId, {
        title,
        summary: summary || null,
        evaluation_kind: evaluation,
        quiz_pass_mark: Number(passMark),
        estimated_minutes: minutes === "" ? null : Number(minutes),
        lesson_content: content,
        media_asset_id: videoId === "" ? null : videoId,
        expected_row_version: mod.row_version,
      });
      setMod(updated);
      setDirty(false);
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Save failed — the module may have changed elsewhere (reload)."));
    }
  }
  async function togglePublish(): Promise<void> {
    if (!mod) return;
    try {
      setMod(mod.status === "published" ? await CurriculumApi.unpublish(moduleId) : await CurriculumApi.publish(moduleId));
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Publish rejected by validation."));
    }
  }
  async function archive(): Promise<void> {
    if (!confirm("Archive this module?")) return;
    await CurriculumApi.archive(moduleId);
    onArchived();
  }
  async function openHistory(): Promise<void> {
    setVersions(await CurriculumApi.versions(moduleId));
  }
  async function revert(n: number): Promise<void> {
    await CurriculumApi.revert(moduleId, n);
    setVersions(null);
    await load();
    onChanged();
  }

  if (!mod) return <div style={{ padding: 28, color: "var(--muted-foreground)" }}>{error ?? "Loading…"}</div>;
  const es = evalStyle[evaluation];

  return (
    <>
      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--card)", borderBottom: "1px solid var(--border)", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div className="flex items-center" style={{ gap: 10, flexWrap: "wrap" }}>
          {level ? (
            <span className="inline-flex items-center" style={{ gap: 5, fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: `${level.color}18`, color: level.color, border: `1px solid ${level.color}30` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: level.color }} />
              L{level.level_number} · {level.title}
            </span>
          ) : null}
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 21, color: "var(--nuru-navy)", lineHeight: 1.1 }}>Module {mod.module_sequence_number}</h2>
          <span style={{ fontSize: 10, fontWeight: 800, padding: "3px 10px", borderRadius: 999, letterSpacing: "0.04em", ...(statusPill[mod.status] ?? statusPill.draft) }}>{mod.status.toUpperCase()}</span>
          {dirty ? <span className="flex items-center" style={{ gap: 4, fontSize: 11, color: "var(--nuru-gold)", fontWeight: 700 }}><AlertTriangle size={11} /> unsaved</span> : null}
        </div>
        <div className="flex" style={{ gap: 8, flexShrink: 0 }}>
          <button type="button" onClick={() => setPreview(true)} className="flex items-center" style={{ gap: 6, height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)" }}><Eye size={12} /> Preview as student</button>
          <button type="button" onClick={() => void openHistory()} className="flex items-center" style={{ gap: 6, height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}><History size={12} /> History</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "24px 28px", maxWidth: 860 }}>
        {error ? <p style={{ color: "var(--color-danger)", marginBottom: 12 }}>{error}</p> : null}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div>
            <label style={eyebrow}>Title</label>
            <input value={title} onChange={(e) => touch(setTitle)(e.target.value)} style={{ ...inputBase, fontWeight: 500 }} />
          </div>
          <div>
            <label style={eyebrow}>Evaluation kind <span style={{ fontWeight: 400, textTransform: "none", fontSize: 10 }}>(drives gating)</span></label>
            <select value={evaluation} onChange={(e) => touch(setEvaluation)(e.target.value as EvaluationKind)} style={{ ...inputBase, fontWeight: 600, ...(es ? { background: es.bg, color: es.color } : {}) }}>
              <option value="none">— none —</option>
              <option value="quiz">Quiz</option>
              <option value="reflection">Reflection</option>
              <option value="exit_exam">Exit exam</option>
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 20 }}>
          <div>
            <label style={eyebrow}>Quiz pass mark (%)</label>
            <input type="number" min={0} max={100} value={passMark} disabled={evaluation !== "quiz"} placeholder={evaluation !== "quiz" ? "N/A" : "e.g. 80"} onChange={(e) => touch(setPassMark)(e.target.value)} style={{ ...inputBase, ...(evaluation !== "quiz" ? { background: "var(--secondary)", color: "var(--muted-foreground)" } : {}) }} />
          </div>
          <div>
            <label style={eyebrow}>Estimated minutes</label>
            <input type="number" min={1} value={minutes} onChange={(e) => touch(setMinutes)(e.target.value)} style={inputBase} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={eyebrow}>Summary</label>
          <textarea value={summary} onChange={(e) => touch(setSummary)(e.target.value)} rows={2} placeholder="One or two lines describing what learners will encounter in this module…" style={{ ...inputBase, height: "auto", padding: "10px 14px", resize: "vertical", lineHeight: 1.5, fontFamily: "var(--font-sans)" }} />
        </div>

        <div style={{ marginBottom: 22 }}>
          <label style={eyebrow}>Lesson video <span style={{ fontWeight: 400, textTransform: "none" }}>(from the Video Library)</span></label>
          <select value={videoId} onChange={(e) => touch(setVideoId)(e.target.value)} style={inputBase}>
            <option value="">— none —</option>
            {assets.filter((a) => a.status === "ready" || a.media_asset_id === videoId).map((a) => (
              <option key={a.media_asset_id} value={a.media_asset_id}>
                {a.media_asset_id.slice(0, 8)} · {a.status}{a.duration_sec ? ` · ${Math.round(a.duration_sec / 60)}min` : ""}{a.attached_module_title ? ` · in: ${a.attached_module_title}` : ""}
              </option>
            ))}
          </select>
        </div>

        <div style={{ height: 1, background: "var(--border)", marginBottom: 20 }} />

        <div style={{ marginBottom: 28 }}>
          <label style={eyebrow}>Lesson (Markdown)</label>
          <div className="flex items-center" style={{ gap: 4, padding: "6px 10px", borderRadius: "10px 10px 0 0", border: "1.5px solid var(--border)", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
            {TOOLBAR.map((b) => (
              <button key={b.label} type="button" title={b.label} onClick={() => touch(setContent)(content + b.insert)} style={{ minWidth: 28, height: 26, borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)", padding: "0 6px", ...b.s }}>{b.label}</button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{content.length} chars</span>
          </div>
          <textarea value={content} onChange={(e) => touch(setContent)(e.target.value)} rows={14} style={{ width: "100%", boxSizing: "border-box", borderRadius: "0 0 10px 10px", border: "1.5px solid var(--border)", borderTop: "none", background: "var(--input-background)", fontSize: 13, padding: "12px 14px", color: "var(--foreground)", outline: "none", resize: "vertical", lineHeight: 1.7, fontFamily: "'JetBrains Mono','Fira Code',monospace" }} />
          <div style={{ marginTop: 5, display: "flex", justifyContent: "flex-end" }}>
            <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>{content.trim().split(/\s+/).filter(Boolean).length} words</span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center" style={{ gap: 10, paddingBottom: 40, flexWrap: "wrap" }}>
          <button type="button" onClick={() => void save()} disabled={!dirty} style={{ height: 40, padding: "0 22px", borderRadius: 10, border: "none", background: dirty ? "var(--nuru-navy)" : "var(--muted)", color: dirty ? "#fff" : "var(--muted-foreground)", fontSize: 13, fontWeight: 700, boxShadow: dirty ? "0 4px 12px rgba(11,31,51,0.18)" : "none" }}>Save draft</button>
          <button type="button" onClick={() => void togglePublish()} style={{ height: 40, padding: "0 22px", borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--card)", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{mod.status === "published" ? "Unpublish" : "Publish"}</button>
          {dirty ? <span className="flex items-center" style={{ gap: 5, fontSize: 11.5, color: "var(--nuru-gold)", fontWeight: 700 }}><AlertTriangle size={12} /> You have unsaved changes</span> : null}
          <div style={{ marginLeft: "auto" }}>
            <button type="button" onClick={() => void archive()} style={{ height: 38, padding: "0 14px", borderRadius: 10, border: "1px solid #FECACA", background: "#FFF5F5", fontSize: 12, fontWeight: 600, color: "#DC2626" }}>Archive module</button>
          </div>
        </div>
      </div>

      {preview ? (
        <PaneModal title="Preview as student" onClose={() => setPreview(false)}>
          <h3 style={{ marginBottom: 6 }}>{title}</h3>
          {summary ? <p style={{ color: "var(--muted-foreground)", marginBottom: 10 }}>{summary}</p> : null}
          <MarkdownPreview content={content} />
        </PaneModal>
      ) : null}
      {versions ? (
        <PaneModal title="Version history" onClose={() => setVersions(null)}>
          {versions.length === 0 ? <p style={{ color: "var(--muted-foreground)" }}>No prior versions.</p> : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {versions.map((v) => (
                <li key={v.version_id} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 13 }}>
                  <span>v{v.version_number} · {v.edited_by_name ?? "unknown"} · {new Date(v.created_at).toLocaleString()}</span>
                  <button type="button" onClick={() => void revert(v.version_number)} style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "transparent", border: "none" }}>Restore</button>
                </li>
              ))}
            </ul>
          )}
        </PaneModal>
      ) : null}
    </>
  );
}

function PaneModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center", zIndex: 60 }} onClick={onClose}>
      <div className="nuru-card" style={{ width: 640, maxHeight: "85vh", overflow: "auto", padding: 20, background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
          <h2 className="type-section" style={{ fontSize: 20 }}>{title}</h2>
          <button type="button" onClick={onClose} style={{ background: "transparent", border: "none", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
