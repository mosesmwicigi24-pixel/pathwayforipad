// Growth Content authoring (WP5) — the portal CMS for the mobile growth surfaces:
// devotionals, memory verses, reading plans (+ days) and the resource library.
// Drives the Admin+ /admin/growth/* endpoints (server-authoritative, audited).
// This is the web half that makes every mobile growth element editable here.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import {
  GrowthAdminApi,
  type DevotionalRow,
  type VerseRow,
  type PlanRow,
  type PlanDayRow,
  type ResourceAdminRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { PageHeader } from "../../ui/PageHeader";

const navy = "var(--nuru-navy)";
const TABS = ["Devotionals", "Memory Verses", "Reading Plans", "Resources"] as const;
type Tab = (typeof TABS)[number];

const th = { padding: "10px 12px", textAlign: "left" } as const;
const td = { padding: "11px 12px" } as const;
const field = { width: "100%", boxSizing: "border-box", height: 40, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", padding: "0 12px", fontSize: 13 } as const;
const area = { width: "100%", boxSizing: "border-box", minHeight: 90, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", padding: 10, fontSize: 13, fontFamily: "var(--font-sans)" } as const;
const navyBtn = { background: navy, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 } as const;

export function GrowthContent(): ReactElement {
  const [tab, setTab] = useState<Tab>("Devotionals");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="CURRICULUM" title="Growth Content" />
      <div className="nuru-tabs">
        {TABS.map((t) => (
          <button key={t} type="button" className="nuru-tab" data-active={t === tab} style={{ background: "transparent" }} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>
      {tab === "Devotionals" ? <Devotionals /> : null}
      {tab === "Memory Verses" ? <Verses /> : null}
      {tab === "Reading Plans" ? <Plans /> : null}
      {tab === "Resources" ? <Resources /> : null}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }): ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center", zIndex: 60 }} onClick={onClose}>
      <div className="nuru-card" style={{ width: 520, maxHeight: "85vh", overflow: "auto", padding: 20, background: "#fff" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="type-section" style={{ fontSize: 20, marginBottom: 12 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
function Labeled({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return <label style={{ display: "block", marginBottom: 10 }}><span style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 4 }}>{label}</span>{children}</label>;
}
function Card({ children }: { children: ReactNode }): ReactElement {
  return <section className="nuru-card" style={{ padding: 6 }}>{children}</section>;
}
function Toolbar({ onNew }: { onNew: () => void }): ReactElement {
  return <div className="flex" style={{ justifyContent: "flex-end", marginBottom: 8 }}><button type="button" style={navyBtn} className="flex items-center gap-2" onClick={onNew}><Plus size={15} /> New</button></div>;
}
function RowActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }): ReactElement {
  return (
    <span className="flex items-center" style={{ gap: 8, justifyContent: "flex-end" }}>
      <button type="button" title="Edit" onClick={onEdit} style={{ background: "transparent", border: "none", color: "var(--nuru-gold)" }}><Pencil size={15} /></button>
      <button type="button" title="Delete" onClick={onDelete} style={{ background: "transparent", border: "none", color: "#A8281F" }}><Trash2 size={15} /></button>
    </span>
  );
}

// ── Devotionals ──────────────────────────────────────────────────────
function Devotionals(): ReactElement {
  const [rows, setRows] = useState<DevotionalRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<DevotionalRow> | null>(null);
  const load = useCallback(() => { GrowthAdminApi.devotionals().then(setRows).catch((e) => setErr(errorMessage(e, "Load failed"))); }, []);
  useEffect(load, [load]);
  async function save(): Promise<void> {
    if (!edit) return;
    const body = { day_number: Number(edit.day_number) || 1, title: edit.title ?? "", body: edit.body ?? "", series: edit.series || undefined, scripture_ref: edit.scripture_ref || undefined, scripture_text: edit.scripture_text || undefined, reflection_prompt: edit.reflection_prompt || undefined, is_published: edit.is_published ?? true };
    try {
      if (edit.devotional_id) await GrowthAdminApi.updateDevotional(edit.devotional_id, body);
      else await GrowthAdminApi.createDevotional(body);
      setEdit(null); load();
    } catch (e) { setErr(errorMessage(e, "Save failed")); }
  }
  async function del(id: string): Promise<void> { if (!confirm("Delete this devotional?")) return; await GrowthAdminApi.deleteDevotional(id); load(); }
  return (
    <>
      {err ? <p style={{ color: "var(--color-danger)" }}>{err}</p> : null}
      <Toolbar onNew={() => setEdit({ is_published: true, day_number: (rows.at(-1)?.day_number ?? 0) + 1 })} />
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr className="type-table-header" style={{ color: "var(--muted-foreground)" }}><th style={th}>Day</th><th style={th}>Title</th><th style={th}>Scripture</th><th style={th}>Published</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.devotional_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={td}>{d.day_number}</td>
                <td style={{ ...td, fontWeight: 600, color: navy }}>{d.title}</td>
                <td style={{ ...td, color: "var(--muted-foreground)" }}>{d.scripture_ref ?? "—"}</td>
                <td style={td}>{d.is_published ? "Yes" : "Draft"}</td>
                <td style={{ ...td, textAlign: "right" }}><RowActions onEdit={() => setEdit(d)} onDelete={() => void del(d.devotional_id)} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 16, color: "var(--muted-foreground)" }}>No devotionals yet.</td></tr> : null}
          </tbody>
        </table>
      </Card>
      {edit ? (
        <Modal title={edit.devotional_id ? "Edit devotional" : "New devotional"} onClose={() => setEdit(null)}>
          <Labeled label="Day number"><input type="number" style={field} value={edit.day_number ?? 1} onChange={(e) => setEdit({ ...edit, day_number: Number(e.target.value) })} /></Labeled>
          <Labeled label="Title"><input style={field} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Labeled>
          <Labeled label="Series (optional)"><input style={field} value={edit.series ?? ""} onChange={(e) => setEdit({ ...edit, series: e.target.value })} /></Labeled>
          <Labeled label="Scripture reference"><input style={field} value={edit.scripture_ref ?? ""} onChange={(e) => setEdit({ ...edit, scripture_ref: e.target.value })} /></Labeled>
          <Labeled label="Scripture text"><textarea style={area} value={edit.scripture_text ?? ""} onChange={(e) => setEdit({ ...edit, scripture_text: e.target.value })} /></Labeled>
          <Labeled label="Body (Markdown)"><textarea style={{ ...area, minHeight: 140 }} value={edit.body ?? ""} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Labeled>
          <Labeled label="Reflection prompt"><textarea style={area} value={edit.reflection_prompt ?? ""} onChange={(e) => setEdit({ ...edit, reflection_prompt: e.target.value })} /></Labeled>
          <label className="flex items-center gap-2" style={{ fontSize: 13, marginBottom: 12 }}><input type="checkbox" checked={edit.is_published ?? true} onChange={(e) => setEdit({ ...edit, is_published: e.target.checked })} /> Published</label>
          <ModalActions onCancel={() => setEdit(null)} onSave={() => void save()} disabled={!edit.title || !edit.body} />
        </Modal>
      ) : null}
    </>
  );
}

// ── Memory verses ────────────────────────────────────────────────────
function Verses(): ReactElement {
  const [rows, setRows] = useState<VerseRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<VerseRow> | null>(null);
  const load = useCallback(() => { GrowthAdminApi.verses().then(setRows).catch((e) => setErr(errorMessage(e, "Load failed"))); }, []);
  useEffect(load, [load]);
  async function save(): Promise<void> {
    if (!edit) return;
    const body = { reference: edit.reference ?? "", verse_text: edit.verse_text ?? "", version: edit.version || undefined, week_number: edit.week_number ?? null, is_active: edit.is_active ?? true };
    try {
      if (edit.memory_verse_id) await GrowthAdminApi.updateVerse(edit.memory_verse_id, body);
      else await GrowthAdminApi.createVerse(body);
      setEdit(null); load();
    } catch (e) { setErr(errorMessage(e, "Save failed")); }
  }
  async function del(id: string): Promise<void> { if (!confirm("Delete this verse?")) return; await GrowthAdminApi.deleteVerse(id); load(); }
  return (
    <>
      {err ? <p style={{ color: "var(--color-danger)" }}>{err}</p> : null}
      <Toolbar onNew={() => setEdit({ version: "WEB", is_active: true })} />
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr className="type-table-header" style={{ color: "var(--muted-foreground)" }}><th style={th}>Reference</th><th style={th}>Verse</th><th style={th}>Week</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.memory_verse_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, color: navy }}>{v.reference}</td>
                <td style={{ ...td, color: "var(--muted-foreground)", maxWidth: 420 }}>{v.verse_text.slice(0, 90)}{v.verse_text.length > 90 ? "…" : ""}</td>
                <td style={td}>{v.week_number ?? "—"}</td>
                <td style={{ ...td, textAlign: "right" }}><RowActions onEdit={() => setEdit(v)} onDelete={() => void del(v.memory_verse_id)} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={4} style={{ padding: 16, color: "var(--muted-foreground)" }}>No verses yet.</td></tr> : null}
          </tbody>
        </table>
      </Card>
      {edit ? (
        <Modal title={edit.memory_verse_id ? "Edit verse" : "New verse"} onClose={() => setEdit(null)}>
          <Labeled label="Reference"><input style={field} value={edit.reference ?? ""} onChange={(e) => setEdit({ ...edit, reference: e.target.value })} placeholder="Romans 12:2" /></Labeled>
          <Labeled label="Verse text"><textarea style={{ ...area, minHeight: 120 }} value={edit.verse_text ?? ""} onChange={(e) => setEdit({ ...edit, verse_text: e.target.value })} /></Labeled>
          <Labeled label="Version"><input style={field} value={edit.version ?? "WEB"} onChange={(e) => setEdit({ ...edit, version: e.target.value })} /></Labeled>
          <Labeled label="Week number (blank = library)"><input type="number" style={field} value={edit.week_number ?? ""} onChange={(e) => setEdit({ ...edit, week_number: e.target.value ? Number(e.target.value) : null })} /></Labeled>
          <ModalActions onCancel={() => setEdit(null)} onSave={() => void save()} disabled={!edit.reference || !edit.verse_text} />
        </Modal>
      ) : null}
    </>
  );
}

// ── Reading plans ────────────────────────────────────────────────────
function Plans(): ReactElement {
  const [rows, setRows] = useState<PlanRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<(Partial<PlanRow> & { daysText?: string }) | null>(null);
  const load = useCallback(() => { GrowthAdminApi.plans().then(setRows).catch((e) => setErr(errorMessage(e, "Load failed"))); }, []);
  useEffect(load, [load]);
  function parseDays(text: string): PlanDayRow[] {
    return text.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => {
      const [reference, title] = line.split("::").map((s) => s.trim());
      return { day_number: i + 1, reference: reference ?? line, title: title ?? null, content: null };
    });
  }
  async function openEdit(p: PlanRow): Promise<void> {
    const full = await GrowthAdminApi.plan(p.plan_id);
    setEdit({ ...full, daysText: full.days.map((d) => (d.title ? `${d.reference} :: ${d.title}` : d.reference)).join("\n") });
  }
  async function save(): Promise<void> {
    if (!edit) return;
    const days = parseDays(edit.daysText ?? "");
    if (days.length === 0) { setErr("A plan needs at least one day."); return; }
    const body = { code: edit.code ?? "", title: edit.title ?? "", description: edit.description || undefined, category: edit.category || undefined, is_active: edit.is_active ?? true, days };
    try {
      if (edit.plan_id) await GrowthAdminApi.updatePlan(edit.plan_id, body);
      else await GrowthAdminApi.createPlan(body);
      setEdit(null); load();
    } catch (e) { setErr(errorMessage(e, "Save failed")); }
  }
  async function del(id: string): Promise<void> { if (!confirm("Delete this plan?")) return; await GrowthAdminApi.deletePlan(id); load(); }
  return (
    <>
      {err ? <p style={{ color: "var(--color-danger)" }}>{err}</p> : null}
      <Toolbar onNew={() => setEdit({ is_active: true, daysText: "" })} />
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr className="type-table-header" style={{ color: "var(--muted-foreground)" }}><th style={th}>Code</th><th style={th}>Title</th><th style={th}>Category</th><th style={th}>Days</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.plan_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, fontFamily: "var(--font-mono)", fontSize: 12 }}>{p.code}</td>
                <td style={{ ...td, fontWeight: 600, color: navy }}>{p.title}</td>
                <td style={{ ...td, color: "var(--muted-foreground)" }}>{p.category ?? "—"}</td>
                <td style={td}>{p.day_total ?? p.day_count}</td>
                <td style={{ ...td, textAlign: "right" }}><RowActions onEdit={() => void openEdit(p)} onDelete={() => void del(p.plan_id)} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 16, color: "var(--muted-foreground)" }}>No reading plans yet.</td></tr> : null}
          </tbody>
        </table>
      </Card>
      {edit ? (
        <Modal title={edit.plan_id ? "Edit plan" : "New plan"} onClose={() => setEdit(null)}>
          <Labeled label="Code (unique)"><input style={field} value={edit.code ?? ""} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="gospel-of-john" /></Labeled>
          <Labeled label="Title"><input style={field} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Labeled>
          <Labeled label="Category"><input style={field} value={edit.category ?? ""} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></Labeled>
          <Labeled label="Description"><textarea style={area} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Labeled>
          <Labeled label="Days — one per line, “Reference :: Title” (day number = line order)"><textarea style={{ ...area, minHeight: 140, fontFamily: "var(--font-mono)" }} value={edit.daysText ?? ""} onChange={(e) => setEdit({ ...edit, daysText: e.target.value })} placeholder={"John 1 :: The Word\nJohn 2 :: The first sign"} /></Labeled>
          <ModalActions onCancel={() => setEdit(null)} onSave={() => void save()} disabled={!edit.code || !edit.title} />
        </Modal>
      ) : null}
    </>
  );
}

// ── Resources ────────────────────────────────────────────────────────
function Resources(): ReactElement {
  const [rows, setRows] = useState<ResourceAdminRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [edit, setEdit] = useState<Partial<ResourceAdminRow> | null>(null);
  const load = useCallback(() => { GrowthAdminApi.resources().then(setRows).catch((e) => setErr(errorMessage(e, "Load failed"))); }, []);
  useEffect(load, [load]);
  async function save(): Promise<void> {
    if (!edit) return;
    const body = { title: edit.title ?? "", kind: edit.kind ?? "book", author: edit.author || undefined, duration_label: edit.duration_label || undefined, url: edit.url || undefined, is_active: edit.is_active ?? true };
    try {
      if (edit.resource_id) await GrowthAdminApi.updateResource(edit.resource_id, body);
      else await GrowthAdminApi.createResource(body);
      setEdit(null); load();
    } catch (e) { setErr(errorMessage(e, "Save failed")); }
  }
  async function del(id: string): Promise<void> { if (!confirm("Delete this resource?")) return; await GrowthAdminApi.deleteResource(id); load(); }
  return (
    <>
      {err ? <p style={{ color: "var(--color-danger)" }}>{err}</p> : null}
      <Toolbar onNew={() => setEdit({ kind: "book", is_active: true })} />
      <Card>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead><tr className="type-table-header" style={{ color: "var(--muted-foreground)" }}><th style={th}>Title</th><th style={th}>Author</th><th style={th}>Kind</th><th style={th}>Length</th><th style={th} /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.resource_id} style={{ borderTop: "1px solid var(--border)" }}>
                <td style={{ ...td, fontWeight: 600, color: navy }}>{r.title}</td>
                <td style={{ ...td, color: "var(--muted-foreground)" }}>{r.author ?? "—"}</td>
                <td style={{ ...td, textTransform: "capitalize" }}>{r.kind}</td>
                <td style={{ ...td, color: "var(--muted-foreground)" }}>{r.duration_label ?? "—"}</td>
                <td style={{ ...td, textAlign: "right" }}><RowActions onEdit={() => setEdit(r)} onDelete={() => void del(r.resource_id)} /></td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={5} style={{ padding: 16, color: "var(--muted-foreground)" }}>No resources yet.</td></tr> : null}
          </tbody>
        </table>
      </Card>
      {edit ? (
        <Modal title={edit.resource_id ? "Edit resource" : "New resource"} onClose={() => setEdit(null)}>
          <Labeled label="Title"><input style={field} value={edit.title ?? ""} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Labeled>
          <Labeled label="Author"><input style={field} value={edit.author ?? ""} onChange={(e) => setEdit({ ...edit, author: e.target.value })} /></Labeled>
          <Labeled label="Kind"><select style={field} value={edit.kind ?? "book"} onChange={(e) => setEdit({ ...edit, kind: e.target.value as ResourceAdminRow["kind"] })}>{["book", "audio", "video", "article"].map((k) => <option key={k} value={k}>{k}</option>)}</select></Labeled>
          <Labeled label="Length label (e.g. “184 pages” / “42 min”)"><input style={field} value={edit.duration_label ?? ""} onChange={(e) => setEdit({ ...edit, duration_label: e.target.value })} /></Labeled>
          <Labeled label="URL"><input style={field} value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Labeled>
          <ModalActions onCancel={() => setEdit(null)} onSave={() => void save()} disabled={!edit.title} />
        </Modal>
      ) : null}
    </>
  );
}

function ModalActions({ onCancel, onSave, disabled }: { onCancel: () => void; onSave: () => void; disabled?: boolean }): ReactElement {
  return (
    <div className="flex" style={{ gap: 8, marginTop: 8 }}>
      <button type="button" style={navyBtn} disabled={disabled} onClick={onSave}>Save</button>
      <button type="button" onClick={onCancel} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 14px", fontSize: 13 }}>Cancel</button>
    </div>
  );
}
