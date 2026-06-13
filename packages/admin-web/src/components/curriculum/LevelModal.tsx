// Level add/edit modal (Figma make "Level Detail"). Edits the editorial metadata
// on a level — title, theme, duration, exam pass mark, lifecycle status, locked
// flag and accent colour — via CurriculumApi. The §1.9 gating engine is unaffected.
import { useState, type ReactElement } from "react";
import { X } from "lucide-react";
import { CurriculumApi, type AdminLevel, type LevelStatus } from "../../api/client";
import { errorMessage } from "../../util/error";

const COLORS = ["#16A34A", "#0B84E8", "#7C3AED", "#C89B3C", "#DC2626", "#0F766E"];
const STATUSES: { value: LevelStatus; label: string }[] = [
  { value: "published", label: "Published" },
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In Review" },
];
const field = { width: "100%", boxSizing: "border-box", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", padding: "0 14px", fontSize: 14 } as const;
const lbl = { fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", display: "block", marginBottom: 6 } as const;

export function LevelModal(props: {
  mode: "add" | "edit";
  level?: AdminLevel;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const lv = props.level;
  const [title, setTitle] = useState(lv?.title ?? "");
  const [theme, setTheme] = useState(lv?.theme ?? "");
  const [duration, setDuration] = useState(lv?.duration ?? "");
  const [passMark, setPassMark] = useState(lv ? Number(lv.required_exam_pass_mark) : 80);
  const [status, setStatus] = useState<LevelStatus>(lv?.status ?? "draft");
  const [locked, setLocked] = useState(lv?.locked ?? false);
  const [color, setColor] = useState(lv?.color ?? COLORS[1]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(): Promise<void> {
    setBusy(true);
    setErr(null);
    const body = { title, theme: theme || null, duration: duration || null, required_exam_pass_mark: passMark, status, locked, color };
    try {
      if (props.mode === "edit" && lv) await CurriculumApi.updateLevel(lv.level_number, body);
      else await CurriculumApi.createLevel(body);
      props.onSaved();
    } catch (e) {
      setErr(errorMessage(e, "Could not save the level."));
      setBusy(false);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "grid", placeItems: "center", zIndex: 60 }} onClick={props.onClose}>
      <div className="nuru-card" style={{ width: 460, background: "#fff", padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between" style={{ marginBottom: 16 }}>
          <h2 className="type-section" style={{ fontSize: 21 }}>{props.mode === "add" ? "New level" : `Edit Level ${lv?.level_number}`}</h2>
          <button type="button" onClick={props.onClose} style={{ background: "transparent", border: "none", color: "var(--muted-foreground)" }}><X size={18} /></button>
        </div>

        <label style={{ display: "block", marginBottom: 14 }}><span style={lbl}>Title</span><input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Foundations" /></label>
        <label style={{ display: "block", marginBottom: 14 }}><span style={lbl}>Theme</span><input style={field} value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="New Life in Christ" /></label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <label><span style={lbl}>Duration</span><input style={field} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="6 weeks" /></label>
          <label><span style={lbl}>Exam pass mark (%)</span><input type="number" min={0} max={100} style={field} value={passMark} onChange={(e) => setPassMark(Number(e.target.value))} /></label>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
          <label><span style={lbl}>Status</span>
            <select style={field} value={status} onChange={(e) => setStatus(e.target.value as LevelStatus)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2" style={{ alignSelf: "end", height: 42, fontSize: 13 }}>
            <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> Locked
          </label>
        </div>

        <div style={{ marginBottom: 18 }}>
          <span style={lbl}>Accent colour</span>
          <div className="flex" style={{ gap: 10 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setColor(c)} aria-label={c}
                style={{ width: 30, height: 30, borderRadius: 8, background: c, border: color === c ? "3px solid var(--nuru-navy)" : "2px solid #fff", boxShadow: "0 0 0 1px var(--border)", cursor: "pointer" }} />
            ))}
          </div>
        </div>

        {err ? <p style={{ color: "var(--color-danger)", fontSize: 13, marginBottom: 10 }}>{err}</p> : null}
        <div className="flex" style={{ gap: 8 }}>
          <button type="button" onClick={() => void save()} disabled={busy || !title.trim()} style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10, height: 40, padding: "0 20px", fontSize: 13, fontWeight: 700 }}>
            {busy ? "Saving…" : props.mode === "add" ? "Create level" : "Save changes"}
          </button>
          <button type="button" onClick={props.onClose} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, height: 40, padding: "0 16px", fontSize: 13 }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
