// Level create/edit modal — rebuilt to the "Final Pathway Portal" make. Emits a
// LevelFormData; the CMS page maps it to the backend (createLevel/updateLevel).
// Level status is published / draft / in_review (the backend's enum) — no archived.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { X, Check, Layers, Lock, Unlock, ChevronDown, Clock, AlertCircle } from "lucide-react";

export type LevelStatus = "Published" | "Draft" | "In Review";

export interface LevelFormData {
  title: string;
  theme: string;
  passMark: number;
  duration: string;
  status: LevelStatus;
  locked: boolean;
  color: string;
}

const PALETTE = [
  { label: "Green", value: "#16A34A" },
  { label: "Blue", value: "#0B84E8" },
  { label: "Violet", value: "#7C3AED" },
  { label: "Gold", value: "#C89B3C" },
  { label: "Red", value: "#DC2626" },
  { label: "Navy", value: "#0B1F33" },
  { label: "Teal", value: "#0D9488" },
  { label: "Rose", value: "#E11D48" },
];
const STATUS_OPTIONS: LevelStatus[] = ["Draft", "In Review", "Published"];
const statusMeta: Record<LevelStatus, { bg: string; color: string; dot: string }> = {
  Published: { bg: "#E8F6EE", color: "#0F6B33", dot: "#16A34A" },
  Draft: { bg: "#EEF1F8", color: "#1F3A6B", dot: "#94A3B8" },
  "In Review": { bg: "#FDF5E5", color: "#8A6B1F", dot: "#C89B3C" },
};
const defaultForm: LevelFormData = { title: "", theme: "", passMark: 80, duration: "8 weeks", status: "Draft", locked: false, color: "#0B84E8" };
const labelStyle = { fontSize: 11, fontWeight: 700, color: "var(--nuru-navy)", letterSpacing: "0.07em", textTransform: "uppercase", display: "block", marginBottom: 6 } as const;

export function LevelModal({ mode, initialData, levelNumber, saving, onSave, onClose }: {
  mode: "add" | "edit";
  initialData?: Partial<LevelFormData>;
  levelNumber?: number;
  saving?: boolean;
  onSave: (data: LevelFormData) => void;
  onClose: () => void;
}): ReactElement {
  const [form, setForm] = useState<LevelFormData>({ ...defaultForm, ...initialData });
  const [errors, setErrors] = useState<{ title?: string; theme?: string }>({});
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function set<K extends keyof LevelFormData>(key: K, val: LevelFormData[K]): void {
    setForm((f) => ({ ...f, [key]: val }));
    if (key === "title" || key === "theme") setErrors((e) => ({ ...e, [key]: undefined }));
  }
  function handleSave(): void {
    const e: { title?: string; theme?: string } = {};
    if (!form.title.trim()) e.title = "Level title is required.";
    if (!form.theme.trim()) e.theme = "Theme / subtitle is required.";
    setErrors(e);
    if (Object.keys(e).length === 0) onSave(form);
  }

  const accent = form.color;
  const isEdit = mode === "edit";

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.62)", backdropFilter: "blur(6px)" }} onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-full flex flex-col overflow-hidden" style={{ maxWidth: 580, maxHeight: "92vh", background: "var(--card)", borderRadius: 20, boxShadow: "0 32px 80px rgba(11,31,51,0.32), 0 0 0 1px rgba(11,31,51,0.08)" }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-4 shrink-0" style={{ padding: "22px 24px 18px", borderBottom: "1px solid var(--border)", background: `linear-gradient(135deg, ${accent}10 0%, transparent 60%)` }}>
          <div className="flex items-start gap-3">
            <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 46, height: 46, background: `${accent}1A`, border: `2px solid ${accent}40` }}>
              {levelNumber != null ? <span style={{ fontFamily: "var(--font-display)", fontSize: 20, color: accent, lineHeight: 1 }}>{levelNumber}</span> : <Layers size={18} style={{ color: accent }} />}
            </div>
            <div>
              <p style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted-foreground)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>{isEdit ? "Edit Level" : "New Level"}</p>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.15 }}>{isEdit ? form.title || "Untitled Level" : "Create a level"}</h2>
              <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{isEdit ? "Update the level's metadata and settings." : "Add a new formation level to the pathway."}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex items-center justify-center rounded-xl transition-colors hover:bg-[var(--secondary)]" style={{ width: 34, height: 34, color: "var(--muted-foreground)", flexShrink: 0, background: "none", border: "none" }}><X size={16} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 no-scrollbar" style={{ padding: "20px 24px" }}>
          <div className="mb-4">
            <label style={labelStyle}>Level Title <span style={{ color: "#DC2626" }}>*</span></label>
            <input ref={firstInputRef} value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Foundations, Growth, Leadership…" className="w-full rounded-xl px-4 outline-none" style={{ height: 44, fontSize: 14, fontWeight: 500, background: "var(--input-background)", border: `1.5px solid ${errors.title ? "#DC2626" : "var(--border)"}`, color: "var(--foreground)" }} />
            {errors.title ? <p className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11.5, color: "#DC2626" }}><AlertCircle size={11} /> {errors.title}</p> : null}
          </div>
          <div className="mb-4">
            <label style={labelStyle}>Theme / Subtitle <span style={{ color: "#DC2626" }}>*</span></label>
            <input value={form.theme} onChange={(e) => set("theme", e.target.value)} placeholder="e.g. New Life in Christ, Walking in the Spirit…" className="w-full rounded-xl px-4 outline-none" style={{ height: 44, fontSize: 14, fontWeight: 500, background: "var(--input-background)", border: `1.5px solid ${errors.theme ? "#DC2626" : "var(--border)"}`, color: "var(--foreground)" }} />
            {errors.theme ? <p className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11.5, color: "#DC2626" }}><AlertCircle size={11} /> {errors.theme}</p> : null}
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label style={labelStyle}>Pass Mark (%)</label>
              <div className="relative">
                <input type="number" min={50} max={100} value={form.passMark} onChange={(e) => set("passMark", Math.min(100, Math.max(0, Number(e.target.value))))} className="w-full rounded-xl px-4 outline-none" style={{ height: 44, fontSize: 14, background: "var(--input-background)", border: "1.5px solid var(--border)", color: "var(--foreground)" }} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2" style={{ fontSize: 13, color: "var(--muted-foreground)", fontWeight: 600 }}>%</span>
              </div>
            </div>
            <div>
              <label style={labelStyle}>Duration</label>
              <div className="relative">
                <Clock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }} />
                <input value={form.duration} onChange={(e) => set("duration", e.target.value)} placeholder="e.g. 8 weeks" className="w-full rounded-xl pl-9 pr-4 outline-none" style={{ height: 44, fontSize: 14, background: "var(--input-background)", border: "1.5px solid var(--border)", color: "var(--foreground)" }} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div>
              <label style={labelStyle}>Status</label>
              <div className="relative">
                <select value={form.status} onChange={(e) => set("status", e.target.value as LevelStatus)} className="w-full rounded-xl outline-none appearance-none cursor-pointer" style={{ height: 44, paddingLeft: 22, paddingRight: 16, fontSize: 13, fontWeight: 600, background: "var(--input-background)", border: "1.5px solid var(--border)", color: "var(--foreground)" }}>
                  {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <ChevronDown size={13} className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--muted-foreground)" }} />
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 rounded-full pointer-events-none" style={{ width: 7, height: 7, background: statusMeta[form.status].dot }} />
              </div>
            </div>
            <div>
              <label style={labelStyle}>Access</label>
              <button onClick={() => set("locked", !form.locked)} className="flex items-center gap-2.5 rounded-xl px-4 w-full" style={{ height: 44, fontSize: 13, fontWeight: 600, textAlign: "left", background: form.locked ? "rgba(148,163,184,0.10)" : "rgba(15,107,51,0.07)", border: `1.5px solid ${form.locked ? "var(--border)" : "rgba(15,107,51,0.25)"}`, color: form.locked ? "var(--muted-foreground)" : "#0F6B33" }}>
                {form.locked ? <><Lock size={14} /> Locked</> : <><Unlock size={14} /> Unlocked</>}
                <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>toggle</span>
              </button>
            </div>
          </div>
          <div className="mb-2">
            <label style={labelStyle}>Level Colour</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PALETTE.map((p) => (
                <button key={p.value} onClick={() => set("color", p.value)} title={p.label} className="rounded-full transition-transform hover:scale-110" style={{ width: 30, height: 30, background: p.value, outline: form.color === p.value ? `3px solid ${p.value}` : "none", outlineOffset: 3, boxShadow: form.color === p.value ? `0 0 0 5px ${p.value}22` : "none", border: "none" }} />
              ))}
              <div className="flex items-center gap-1.5 rounded-xl px-3" style={{ height: 30, border: "1.5px solid var(--border)", background: "var(--input-background)" }}>
                <span className="rounded-full shrink-0" style={{ width: 14, height: 14, background: form.color }} />
                <input value={form.color} onChange={(e) => set("color", e.target.value)} placeholder="#hex" className="bg-transparent outline-none" style={{ width: 72, fontSize: 12, fontWeight: 600, color: "var(--foreground)", letterSpacing: "0.04em" }} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl mt-5" style={{ padding: "12px 14px", background: `${form.color}10`, border: `1px solid ${form.color}30` }}>
            <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: form.color, color: "#fff", fontFamily: "var(--font-display)", fontSize: 18 }}>{levelNumber ?? "N"}</div>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{form.title || "Level title"}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{form.theme || "Theme subtitle"}</div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 10.5, fontWeight: 700, background: statusMeta[form.status].bg, color: statusMeta[form.status].color }}>{form.status}</span>
              <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}><Clock size={11} /> {form.duration || "—"}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 shrink-0" style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
          <p style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{isEdit ? "Changes apply immediately." : "Level will be added as a draft."}</p>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="flex items-center gap-2 rounded-xl px-4 transition-colors hover:bg-[var(--card)]" style={{ height: 40, fontSize: 13, fontWeight: 600, border: "1.5px solid var(--border)", color: "var(--muted-foreground)", background: "none" }}>Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl px-5 transition-opacity hover:opacity-90" style={{ height: 40, fontSize: 13, fontWeight: 700, background: saving ? "var(--muted)" : "var(--nuru-gold)", color: saving ? "var(--muted-foreground)" : "#fff", boxShadow: saving ? "none" : "0 6px 18px rgba(200,155,60,0.30)", cursor: saving ? "not-allowed" : "pointer", border: "none" }}>
              <Check size={14} /> {isEdit ? "Save Changes" : "Create Level"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
