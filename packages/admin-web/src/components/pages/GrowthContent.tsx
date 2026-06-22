// Content Studio — authoring for the mobile "growth" surfaces that previously had
// a backend but no CMS: daily Devotionals, Memory Verses, Reading Plans, the
// Resource library, and the Pathway trail Encouragements (level-scoped). Wires the
// already-existing GrowthAdminApi + the new EncouragementsAdminApi. Tabbed list +
// create/edit modal per entity; Reading Plans include a simple day editor.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { BookOpen, ChevronRight, Plus, Quote, Sparkles, Pencil, Trash2, Library, Flame, X } from "lucide-react";
import {
  GrowthAdminApi, EncouragementsAdminApi,
  type DevotionalRow, type VerseRow, type PlanRow, type PlanDayRow, type PlanSegmentRow, type ResourceAdminRow, type EncouragementRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";

type TabKey = "devotionals" | "verses" | "plans" | "resources" | "encouragements";
type Row = Record<string, unknown>;
type FieldType = "text" | "textarea" | "number" | "select" | "checkbox";
interface FieldDef { key: string; label: string; type: FieldType; options?: string[]; required?: boolean; full?: boolean; placeholder?: string }

const TABS: Array<{ key: TabKey; label: string; icon: typeof BookOpen }> = [
  { key: "devotionals", label: "Devotionals", icon: BookOpen },
  { key: "verses", label: "Memory Verses", icon: Quote },
  { key: "plans", label: "Reading Plans", icon: Library },
  { key: "resources", label: "Resources", icon: Library },
  { key: "encouragements", label: "Encouragements", icon: Flame },
];

const FIELDS: Record<TabKey, FieldDef[]> = {
  devotionals: [
    { key: "day_number", label: "Day number", type: "number", required: true },
    { key: "title", label: "Title", type: "text", required: true, full: true },
    { key: "series", label: "Series", type: "text" },
    { key: "scripture_ref", label: "Scripture reference", type: "text" },
    { key: "scripture_text", label: "Scripture text", type: "textarea", full: true },
    { key: "body", label: "Body", type: "textarea", required: true, full: true },
    { key: "reflection_prompt", label: "Reflection prompt", type: "textarea", full: true },
    { key: "audio_url", label: "Audio URL", type: "text" },
    { key: "video_url", label: "Video URL", type: "text" },
    { key: "is_published", label: "Published", type: "checkbox" },
  ],
  verses: [
    { key: "reference", label: "Reference", type: "text", required: true },
    { key: "version", label: "Version", type: "text", placeholder: "WEB" },
    { key: "verse_text", label: "Verse text", type: "textarea", required: true, full: true },
    { key: "week_number", label: "Week number", type: "number" },
    { key: "sort", label: "Sort", type: "number" },
    { key: "is_active", label: "Active", type: "checkbox" },
  ],
  plans: [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "category", label: "Category", type: "text" },
    { key: "title", label: "Title", type: "text", required: true, full: true },
    { key: "subtitle", label: "Subtitle / tagline", type: "text", full: true },
    { key: "description", label: "Description", type: "textarea", full: true },
    { key: "image_url", label: "Cover image URL", type: "text", full: true, placeholder: "https://pathway.nuruplace.org/media/…" },
    { key: "sort", label: "Sort", type: "number" },
    { key: "is_active", label: "Active", type: "checkbox" },
  ],
  resources: [
    { key: "title", label: "Title", type: "text", required: true, full: true },
    { key: "author", label: "Author", type: "text" },
    { key: "kind", label: "Kind", type: "select", options: ["book", "audio", "video", "article"], required: true },
    { key: "duration_label", label: "Duration label", type: "text", placeholder: "12 min" },
    { key: "url", label: "URL", type: "text", full: true },
    { key: "sort", label: "Sort", type: "number" },
    { key: "is_active", label: "Active", type: "checkbox" },
  ],
  encouragements: [
    { key: "after_module_sequence", label: "After module #", type: "number" },
    { key: "kind", label: "Kind", type: "select", options: ["splash", "cheer", "sticker", "note"], required: true },
    { key: "title", label: "Title", type: "text", full: true },
    { key: "body", label: "Body", type: "textarea", full: true },
    { key: "scripture_ref", label: "Scripture ref (for note)", type: "text" },
    { key: "emoji", label: "Emoji(s)", type: "text", placeholder: "✨  or  🎉 🙌 📖" },
    { key: "image_url", label: "Image URL (splash)", type: "text", full: true },
    { key: "sort_order", label: "Sort order", type: "number" },
    { key: "is_active", label: "Active", type: "checkbox" },
  ],
};

const ID_KEY: Record<TabKey, string> = {
  devotionals: "devotional_id", verses: "memory_verse_id", plans: "plan_id", resources: "resource_id", encouragements: "encouragement_id",
};

function primary(tab: TabKey, r: Row): { title: string; sub: string; active: boolean } {
  switch (tab) {
    case "devotionals": { const d = r as unknown as DevotionalRow; return { title: d.title, sub: `Day ${d.day_number}${d.series ? ` · ${d.series}` : ""}`, active: d.is_published }; }
    case "verses": { const v = r as unknown as VerseRow; return { title: v.reference || "(untitled verse)", sub: (v.verse_text ?? "").slice(0, 60), active: v.is_active }; }
    case "plans": { const p = r as unknown as PlanRow; return { title: p.title, sub: `${p.code} · ${p.day_count} days`, active: p.is_active }; }
    case "resources": { const x = r as unknown as ResourceAdminRow; return { title: x.title, sub: `${x.kind}${x.author ? ` · ${x.author}` : ""}`, active: x.is_active }; }
    case "encouragements": { const e = r as unknown as EncouragementRow; return { title: e.title || e.kind, sub: `${e.kind} · after module ${e.after_module_sequence}`, active: e.is_active }; }
  }
}

export function GrowthContent(): ReactElement {
  const [tab, setTab] = useState<TabKey>("devotionals");
  const [level, setLevel] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const asRows = (a: unknown[]): Row[] => a as Row[];
      if (tab === "devotionals") setRows(asRows(await GrowthAdminApi.devotionals()));
      else if (tab === "verses") setRows(asRows(await GrowthAdminApi.verses()));
      else if (tab === "plans") setRows(asRows(await GrowthAdminApi.plans()));
      else if (tab === "resources") setRows(asRows(await GrowthAdminApi.resources()));
      else setRows(asRows(await EncouragementsAdminApi.list(level)));
    } catch (e) { setError(errorMessage(e, "Could not load content.")); }
  }, [tab, level]);
  useEffect(() => { void load(); }, [load]);

  async function remove(r: Row): Promise<void> {
    const id = String(r[ID_KEY[tab]]);
    const p = primary(tab, r);
    if (!window.confirm(`Delete "${p.title}"? This cannot be undone.`)) return;
    try {
      if (tab === "devotionals") await GrowthAdminApi.deleteDevotional(id);
      else if (tab === "verses") await GrowthAdminApi.deleteVerse(id);
      else if (tab === "plans") await GrowthAdminApi.deletePlan(id);
      else if (tab === "resources") await GrowthAdminApi.deleteResource(id);
      else await EncouragementsAdminApi.remove(id);
      setNotice(`Deleted ${p.title}.`); await load();
    } catch (e) { setError(errorMessage(e, "Could not delete.")); }
  }

  const activeTab = TABS.find((t) => t.key === tab)!;

  return (
    <div style={{ background: "var(--background)", minHeight: "100%", padding: "28px clamp(16px,4vw,40px)" }}>
      <div className="rounded-2xl overflow-hidden mb-6" style={{ background: "var(--nuru-dark)" }}>
        <div style={{ padding: "22px 28px 24px" }}>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)" }}><span>Curriculum</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Content Studio</span></div>
            <div className="flex items-center gap-2 flex-wrap">
              {tab === "encouragements" ? (
                <label className="inline-flex items-center gap-2 rounded-lg px-2.5" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12 }}>
                  Level
                  <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="bg-transparent outline-none" style={{ color: "#fff", fontWeight: 700 }}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n} style={{ color: "#000" }}>{n}</option>)}
                  </select>
                </label>
              ) : null}
              <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> New {activeTab.label.replace(/s$/, "").toLowerCase()}</button>
            </div>
          </div>
          <div className="flex items-center gap-1 mt-4 flex-wrap">
            {TABS.map((t) => { const Icon = t.icon; const on = t.key === tab; return (
              <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ background: on ? "rgba(245,199,126,0.16)" : "transparent", color: on ? "#F5C77E" : "rgba(232,239,245,0.7)", fontSize: 12.5, fontWeight: 600, border: on ? "1px solid rgba(245,199,126,0.3)" : "1px solid transparent" }}>
                <Icon size={13} /> {t.label}
              </button>
            ); })}
          </div>
        </div>
      </div>

      {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
      {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center" style={{ padding: "56px 24px", color: "var(--muted-foreground)" }}>
            <Sparkles size={28} style={{ color: "var(--nuru-gold)", marginBottom: 10 }} />
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>No {activeTab.label.toLowerCase()} yet</p>
            <p style={{ fontSize: 12.5, marginTop: 4 }}>Create the first one — it appears in the mobile app immediately.</p>
          </div>
        ) : rows.map((r, i) => { const p = primary(tab, r); return (
          <div key={String(r[ID_KEY[tab]]) || i} className="flex items-center gap-4 px-5 py-3.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
            <span className="shrink-0" style={{ width: 9, height: 9, borderRadius: 999, background: p.active ? "#16A34A" : "#9CA3AF" }} title={p.active ? "Active" : "Inactive"} />
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }} className="truncate">{p.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }} className="truncate">{p.sub}</div>
            </div>
            <button onClick={() => setEditing(r)} title="Edit" className="rounded-lg p-2" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Pencil size={15} /></button>
            <button onClick={() => void remove(r)} title="Delete" className="rounded-lg p-2" style={{ color: "#DC2626", background: "none", border: "none" }}><Trash2 size={15} /></button>
          </div>
        ); })}
      </div>

      {(creating || editing) ? (
        <RecordEditor
          tab={tab}
          level={level}
          row={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onDone={async (msg) => { setCreating(false); setEditing(null); setNotice(msg); await load(); }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

function RecordEditor({ tab, level, row, onClose, onDone, onError }: {
  tab: TabKey; level: number; row: Row | null; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void;
}): ReactElement {
  const fields = FIELDS[tab];
  const [form, setForm] = useState<Row>(() => {
    const init: Row = {};
    for (const f of fields) init[f.key] = row ? row[f.key] : f.type === "checkbox" ? true : f.type === "number" ? 0 : "";
    return init;
  });
  const [days, setDays] = useState<PlanDayRow[]>(() => (row ? [] : [{ day_number: 1, reference: "", title: "", content: "", segments: [] }]));
  const [busy, setBusy] = useState(false);
  const isPlan = tab === "plans";
  const editing = !!row;
  const id = row ? String(row[ID_KEY[tab]]) : "";

  // Load the full plan (days + segments) when editing a plan.
  useEffect(() => {
    if (!isPlan || !editing) return;
    let live = true;
    void GrowthAdminApi.plan(id).then((p) => {
      if (!live) return;
      setDays((p.days ?? []).map((d) => ({ ...d, segments: d.segments ?? [] })));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [isPlan, editing, id]);

  const set = (k: string, v: unknown): void => setForm((f) => ({ ...f, [k]: v }));

  function payload(): Row {
    const out: Row = {};
    for (const f of fields) {
      const v = form[f.key];
      if (f.type === "number") out[f.key] = v === "" || v == null ? undefined : Number(v);
      else if (f.type === "checkbox") out[f.key] = !!v;
      else out[f.key] = v === "" ? undefined : v;
    }
    return out;
  }

  async function submit(): Promise<void> {
    for (const f of fields) if (f.required && (form[f.key] === "" || form[f.key] == null)) { onError(`${f.label} is required.`); return; }
    setBusy(true);
    const body = payload();
    try {
      if (tab === "devotionals") { if (editing) await GrowthAdminApi.updateDevotional(id, body); else await GrowthAdminApi.createDevotional(body); }
      else if (tab === "verses") { if (editing) await GrowthAdminApi.updateVerse(id, body); else await GrowthAdminApi.createVerse(body); }
      else if (tab === "resources") { if (editing) await GrowthAdminApi.updateResource(id, body); else await GrowthAdminApi.createResource(body); }
      else if (tab === "encouragements") { if (editing) await EncouragementsAdminApi.update(id, body); else await EncouragementsAdminApi.create(level, body); }
      else { // plans
        const planDays = days
          .filter((d) => d.reference.trim())
          .map((d, di) => ({
            day_number: d.day_number || di + 1,
            reference: d.reference.trim(),
            ...(d.title ? { title: d.title } : {}),
            ...(d.content ? { content: d.content } : {}),
            segments: (d.segments ?? [])
              .filter((s) => s.title?.trim())
              .map((s, si) => ({
                sort: si,
                kind: s.kind,
                title: s.title.trim(),
                ...(s.reference ? { reference: s.reference } : {}),
                ...(s.content ? { content: s.content } : {}),
                ...(s.video_url ? { video_url: s.video_url } : {}),
              })),
          }));
        if (editing) await GrowthAdminApi.updatePlan(id, planDays.length ? { ...body, days: planDays } : body);
        else await GrowthAdminApi.createPlan({ ...body, days: planDays });
      }
      onDone(editing ? "Saved changes." : "Created.");
    } catch (e) { onError(errorMessage(e, "Could not save.")); }
    finally { setBusy(false); }
  }

  const inp = { width: "100%", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "10px 12px", color: "var(--foreground)", outline: "none" } as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 620, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Sparkles size={12} /> CONTENT STUDIO</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{editing ? "Edit" : "New"} {tab === "encouragements" ? `encouragement · Level ${level}` : tab.replace(/s$/, "")}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 grid grid-cols-2 gap-4 overflow-y-auto">
          {fields.map((f) => (
            <Field key={f.key} label={f.label} required={!!f.required} full={!!f.full || f.type === "textarea"}>
              {f.type === "textarea" ? (
                <textarea value={String(form[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} rows={3} placeholder={f.placeholder} style={{ ...inp, resize: "vertical", lineHeight: 1.5 }} />
              ) : f.type === "select" ? (
                <select value={String(form[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} style={inp}>{(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}</select>
              ) : f.type === "checkbox" ? (
                <label className="flex items-center gap-2" style={{ fontSize: 13, color: "var(--foreground)" }}><input type="checkbox" checked={!!form[f.key]} onChange={(e) => set(f.key, e.target.checked)} /> {f.label}</label>
              ) : (
                <input type={f.type === "number" ? "number" : "text"} value={String(form[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} style={inp} />
              )}
            </Field>
          ))}

          {isPlan ? (
            <div className="col-span-2">
              <div className="flex items-center justify-between mb-2">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Plan days &amp; segments</span>
                <button onClick={() => setDays((d) => [...d, { day_number: d.length + 1, reference: "", title: "", content: "", segments: [] }])} className="flex items-center gap-1 rounded-lg px-2 py-1" style={{ background: "var(--secondary)", fontSize: 11, fontWeight: 600, color: "var(--foreground)", border: "none" }}><Plus size={11} /> Day</button>
              </div>
              <div className="flex flex-col gap-3">
                {days.map((d, i) => {
                  const upd = (patch: Partial<PlanDayRow>): void => setDays((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  const updSeg = (si: number, patch: Partial<PlanSegmentRow>): void =>
                    setDays((arr) => arr.map((x, j) => (j === i ? { ...x, segments: (x.segments ?? []).map((s, k) => (k === si ? { ...s, ...patch } : s)) } : x)));
                  const segs = d.segments ?? [];
                  return (
                    <div key={i} className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--secondary)", padding: 12 }}>
                      <div className="flex items-center gap-2 mb-2">
                        <input value={d.day_number} onChange={(e) => upd({ day_number: Number(e.target.value) || 1 })} type="number" style={{ ...inp, width: 60 }} title="Day #" />
                        <input value={d.reference} onChange={(e) => upd({ reference: e.target.value })} placeholder="Reference (e.g. John 3:1-16)" style={inp} />
                        <input value={d.title ?? ""} onChange={(e) => upd({ title: e.target.value })} placeholder="Day title" style={inp} />
                        <button onClick={() => setDays((arr) => arr.filter((_, j) => j !== i))} className="rounded-lg p-2 shrink-0" style={{ color: "#DC2626", background: "none", border: "none" }} title="Remove day"><Trash2 size={14} /></button>
                      </div>
                      <div className="flex flex-col gap-2" style={{ paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                        {segs.map((s, si) => (
                          <div key={si} className="rounded-lg" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: 8 }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <select value={s.kind} onChange={(e) => updSeg(si, { kind: e.target.value as PlanSegmentRow["kind"] })} style={{ ...inp, width: 130, padding: "7px 8px" }}>
                                {["devotional", "scripture", "video", "talk", "reading"].map((k) => <option key={k} value={k}>{k}</option>)}
                              </select>
                              <input value={s.title} onChange={(e) => updSeg(si, { title: e.target.value })} placeholder="Segment title" style={{ ...inp, padding: "7px 8px" }} />
                              <button onClick={() => upd({ segments: segs.filter((_, k) => k !== si) })} className="rounded-lg p-1.5 shrink-0" style={{ color: "#DC2626", background: "none", border: "none" }} title="Remove segment"><Trash2 size={13} /></button>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <input value={s.reference ?? ""} onChange={(e) => updSeg(si, { reference: e.target.value })} placeholder="Reference (optional)" style={{ ...inp, padding: "7px 8px" }} />
                              <input value={s.video_url ?? ""} onChange={(e) => updSeg(si, { video_url: e.target.value })} placeholder="Video URL (optional)" style={{ ...inp, padding: "7px 8px" }} />
                            </div>
                            <textarea value={s.content ?? ""} onChange={(e) => updSeg(si, { content: e.target.value })} rows={2} placeholder="Content (markdown)" style={{ ...inp, padding: "7px 8px", resize: "vertical", lineHeight: 1.5 }} />
                          </div>
                        ))}
                        <button onClick={() => upd({ segments: [...segs, { kind: "devotional", title: "", reference: "", content: "", video_url: "" }] })} className="flex items-center gap-1 rounded-lg px-2 py-1 self-start" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}><Plus size={11} /> Segment</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{editing ? "Save" : "Create"}</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required, full }: { label: string; children: ReactNode; required?: boolean; full?: boolean }): ReactElement {
  return <div className={full ? "col-span-2" : ""}><div className="flex items-center gap-1 mb-1.5"><span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>{required ? <span style={{ color: "#DC2626", fontSize: 11 }}>*</span> : null}</div>{children}</div>;
}
