// Content Studio — authoring for the mobile "growth" surfaces: daily Devotionals,
// Memory Verses, Reading Plans, the Resource library, and the Pathway trail
// Encouragements (level-scoped). Rebuilt to the "Final Pathway Portal" Figma make
// (dark hero, tabbed bar with counts, accent-bar cards, modal editor). Wires the
// existing GrowthAdminApi + EncouragementsAdminApi — no backend change; the
// devotional fields already map 1:1 to the make's spec.
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  ChevronRight, ChevronDown, Plus, Pencil, Trash2, X, Search, Check, MoreHorizontal,
  BookOpen, Quote, CalendarRange, CalendarDays, Library, Sparkles,
  FileText, Music, Video as VideoIcon, Link2, Clock, ArrowRightToLine, Hash, Quote as QuoteIcon, type LucideIcon,
} from "lucide-react";
import {
  GrowthAdminApi, EncouragementsAdminApi,
  type DevotionalRow, type VerseRow, type DailyVerseRow, type PlanRow, type PlanDayRow, type PlanSegmentRow, type ResourceAdminRow, type EncouragementRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";

type TabKey = "devotionals" | "verses" | "dailyverses" | "plans" | "resources" | "encouragements";
type Row = Record<string, unknown>;

// Per-section accent — ONLY the two main brand colors: dark navy and golden
// yellow (matches the iPad Content Studio, the design reference of record).
// Sections alternate navy/gold so each has its own identity while the whole page
// reads as one cohesive navy+gold palette — no green/blue/violet/teal decorative.
const NAVY = "var(--nuru-navy)";
const GOLD = "var(--nuru-gold)";
const TABS: Array<{ key: TabKey; label: string; singular: string; icon: LucideIcon; accent: string }> = [
  { key: "devotionals", label: "Devotionals", singular: "devotional", icon: BookOpen, accent: NAVY },
  { key: "verses", label: "Memory Verses", singular: "memory verse", icon: Quote, accent: GOLD },
  { key: "dailyverses", label: "Daily Verses", singular: "daily verse", icon: CalendarDays, accent: NAVY },
  { key: "plans", label: "Reading Plans", singular: "reading plan", icon: CalendarRange, accent: GOLD },
  { key: "resources", label: "Resources", singular: "resource", icon: Library, accent: NAVY },
  { key: "encouragements", label: "Encouragements", singular: "encouragement", icon: Sparkles, accent: GOLD },
];

const VERSIONS = ["WEB", "NIV", "ESV", "KJV", "NLT", "MSG"];
const PLAN_CATEGORIES = ["Foundations", "Growth", "Prayer", "Devotion", "Topical"];
const RESOURCE_KINDS = ["book", "audio", "video", "article"];
const ENCOURAGEMENT_KINDS = ["splash", "note", "celebration", "nudge", "verse"];
const LEVELS = [1, 2, 3, 4, 5, 6];

const RESOURCE_ICON: Record<string, LucideIcon> = { book: BookOpen, audio: Music, video: VideoIcon, article: FileText };
const ID_KEY: Record<TabKey, string> = {
  devotionals: "devotional_id", verses: "memory_verse_id", dailyverses: "day_index", plans: "plan_id", resources: "resource_id", encouragements: "encouragement_id",
};

/* ═════════════════════════ Page ═════════════════════════ */
export function GrowthContent(): ReactElement {
  const [tab, setTab] = useState<TabKey>("devotionals");
  const [level, setLevel] = useState(1);
  const [query, setQuery] = useState("");
  const [lists, setLists] = useState<Record<TabKey, Row[]>>({ devotionals: [], verses: [], dailyverses: [], plans: [], resources: [], encouragements: [] });
  const [editing, setEditing] = useState<{ row: Row | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchTab = useCallback(async (t: TabKey, lvl: number): Promise<Row[]> => {
    if (t === "devotionals") return (await GrowthAdminApi.devotionals()) as unknown as Row[];
    if (t === "verses") return (await GrowthAdminApi.verses()) as unknown as Row[];
    if (t === "dailyverses") return (await GrowthAdminApi.dailyVerses()) as unknown as Row[];
    if (t === "plans") return (await GrowthAdminApi.plans()) as unknown as Row[];
    if (t === "resources") return (await GrowthAdminApi.resources()) as unknown as Row[];
    return (await EncouragementsAdminApi.list(lvl)) as unknown as Row[];
  }, []);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [d, v, dv, p, r, e] = await Promise.all([
        fetchTab("devotionals", level), fetchTab("verses", level), fetchTab("dailyverses", level), fetchTab("plans", level),
        fetchTab("resources", level), fetchTab("encouragements", level),
      ]);
      setLists({ devotionals: d, verses: v, dailyverses: dv, plans: p, resources: r, encouragements: e });
    } catch (err) { setError(errorMessage(err, "Could not load content.")); }
  }, [fetchTab, level]);

  const reloadTab = useCallback(async (t: TabKey) => {
    try { const rows = await fetchTab(t, level); setLists((l) => ({ ...l, [t]: rows })); }
    catch (err) { setError(errorMessage(err, "Could not load content.")); }
  }, [fetchTab, level]);

  // Load every list for the count badges; re-runs when the level changes (so the
  // level-scoped encouragements list stays in sync).
  useEffect(() => { void loadAll(); }, [loadAll]);

  const counts = useMemo(() => ({
    devotionals: lists.devotionals.length, verses: lists.verses.length, dailyverses: lists.dailyverses.length, plans: lists.plans.length,
    resources: lists.resources.length, encouragements: lists.encouragements.length,
  }), [lists]);

  const meta = TABS.find((t) => t.key === tab)!;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const m = (s: string) => !q || s.toLowerCase().includes(q);
    const rows = lists[tab];
    if (tab === "devotionals") return (rows as unknown as DevotionalRow[]).filter((d) => m(`${d.title} ${d.series ?? ""} ${d.scripture_ref ?? ""}`));
    if (tab === "verses") return (rows as unknown as VerseRow[]).filter((v) => m(`${v.reference} ${v.verse_text}`));
    if (tab === "dailyverses") return (rows as unknown as DailyVerseRow[]).filter((d) => m(`${d.reference} ${d.theme} ${d.verse_text} ${d.day_date} day ${d.day_index}`));
    if (tab === "plans") return (rows as unknown as PlanRow[]).filter((p) => m(`${p.title} ${p.subtitle ?? ""} ${p.code} ${p.category ?? ""}`));
    if (tab === "resources") return (rows as unknown as ResourceAdminRow[]).filter((r) => m(`${r.title} ${r.author ?? ""} ${r.kind}`));
    return (rows as unknown as EncouragementRow[]).filter((e) => m(`${e.title ?? ""} ${e.body ?? ""} ${e.kind}`));
  }, [tab, query, lists]);

  async function remove(r: Row): Promise<void> {
    if (tab === "dailyverses") return; // the year plan is fixed — verses are edited, not deleted
    const id = String(r[ID_KEY[tab]]);
    if (!window.confirm("Delete this item? This cannot be undone.")) return;
    try {
      if (tab === "devotionals") await GrowthAdminApi.deleteDevotional(id);
      else if (tab === "verses") await GrowthAdminApi.deleteVerse(id);
      else if (tab === "plans") await GrowthAdminApi.deletePlan(id);
      else if (tab === "resources") await GrowthAdminApi.deleteResource(id);
      else await EncouragementsAdminApi.remove(id);
      setNotice("Deleted."); await reloadTab(tab);
    } catch (e) { setError(errorMessage(e, "Could not delete.")); }
  }

  return (
    <div style={{ background: "var(--background)", minHeight: "100%" }}>
      {/* ── Hero ── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 0" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Curriculum</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Content Studio</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {tab === "encouragements" && (
              <div className="flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 34, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <span style={{ fontSize: 11, color: "rgba(232,239,245,0.6)", fontWeight: 600 }}>Level</span>
                <select value={level} onChange={(e) => setLevel(Number(e.target.value))} className="bg-transparent outline-none" style={{ fontSize: 12.5, fontWeight: 700, color: "#fff" }}>
                  {LEVELS.map((l) => <option key={l} value={l} style={{ color: "#111" }}>{l}</option>)}
                </select>
              </div>
            )}
            {tab !== "dailyverses" && (
              <button onClick={() => setEditing({ row: null })} className="flex items-center gap-2 rounded-lg px-3.5" style={{ height: 34, background: "var(--nuru-gold)", color: "#fff", fontSize: 12.5, fontWeight: 700, border: "none", boxShadow: "0 6px 18px rgba(200,155,60,0.32)" }}>
                <Plus size={14} /> New {meta.singular}
              </button>
            )}
          </div>
        </div>

        <div className="mt-5" style={{ paddingBottom: 22 }}>
          <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Discipleship content</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.05 }}>Content Studio</h1>
          <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 580, lineHeight: 1.5 }}>
            Author the devotionals, verses, plans, resources and encouragements that members read in the mobile app.
          </p>
        </div>
      </div>

      {/* ── Section switcher — capsule segmented buttons (iPad Content Studio).
           Each segment is a styled capsule; the selected one fills with its
           section's brand accent (navy → white text, gold → navy text) and a
           matching count badge; the rest are quiet outlined white chips. ── */}
      <div className="flex items-center gap-2 overflow-x-auto" style={{ padding: "14px clamp(16px, 4vw, 48px)", scrollbarWidth: "none" }}>
        {TABS.map((t) => {
          const on = tab === t.key;
          const Icon = t.icon;
          // On a gold fill, dark navy ink reads better than white; on navy, white wins.
          const onText = t.accent === GOLD ? "var(--nuru-navy)" : "#fff";
          return (
            <button key={t.key} onClick={() => { setTab(t.key); setQuery(""); }} className="flex items-center gap-2 shrink-0 rounded-full"
              style={{ padding: "0 14px", height: 38, fontSize: 13, fontWeight: on ? 600 : 500, color: on ? onText : "var(--muted-foreground)", background: on ? t.accent : "#fff", border: on ? "1px solid transparent" : "1px solid var(--border)", whiteSpace: "nowrap", cursor: "pointer", boxShadow: on ? `0 6px 16px ${t.accent === GOLD ? "rgba(200,155,60,0.28)" : "rgba(11,31,51,0.22)"}` : "none", transition: "background .15s, box-shadow .15s" }}>
              <Icon size={13} /> {t.label}
              <span className="rounded-full" style={{ padding: "1.5px 6.5px", fontSize: 10.5, fontWeight: 600, background: on ? (t.accent === GOLD ? "rgba(11,31,51,0.18)" : "rgba(255,255,255,0.18)") : t.accent + "1F", color: on ? onText : t.accent }}>{counts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "4px clamp(16px, 4vw, 48px) 48px", maxWidth: 1080 }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12, fontSize: 13 }}>{error}</p> : null}
        {notice && !error ? <p style={{ color: "var(--color-success)", marginBottom: 12, fontSize: 13 }}>{notice}</p> : null}

        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-center gap-2 rounded-xl flex-1" style={{ height: 40, minWidth: 220, background: "#fff", border: "1px solid var(--border)", padding: "0 12px" }}>
            <Search size={14} style={{ color: "var(--muted-foreground)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Search ${meta.label.toLowerCase()}…`} className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
          </div>
          <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{filtered.length} {filtered.length === 1 ? "item" : "items"}</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState meta={meta} onNew={() => setEditing({ row: null })} />
        ) : (
          // One white card; every item is a full-width ROW with a hairline divider
          // between them (iPad Content Studio), each carrying a trailing ⋯ menu.
          <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)", boxShadow: "0 1px 3px rgba(11,31,51,0.05)" }}>
            {tab === "devotionals" && (filtered as unknown as DevotionalRow[]).map((d, i) => <DevotionalCard key={d.devotional_id} d={d} first={i === 0} onEdit={() => setEditing({ row: d as unknown as Row })} onDelete={() => void remove(d as unknown as Row)} onAdd={() => setEditing({ row: null })} />)}
            {tab === "verses" && (filtered as unknown as VerseRow[]).map((v, i) => <VerseCard key={v.memory_verse_id} v={v} first={i === 0} onEdit={() => setEditing({ row: v as unknown as Row })} onDelete={() => void remove(v as unknown as Row)} onAdd={() => setEditing({ row: null })} />)}
            {tab === "dailyverses" && (filtered as unknown as DailyVerseRow[]).map((d, i) => <DailyVerseCard key={d.day_index} d={d} first={i === 0} onEdit={() => setEditing({ row: d as unknown as Row })} />)}
            {tab === "plans" && (filtered as unknown as PlanRow[]).map((p, i) => <PlanCard key={p.plan_id} p={p} first={i === 0} onEdit={() => setEditing({ row: p as unknown as Row })} onDelete={() => void remove(p as unknown as Row)} onAdd={() => setEditing({ row: null })} />)}
            {tab === "resources" && (filtered as unknown as ResourceAdminRow[]).map((r, i) => <ResourceCard key={r.resource_id} r={r} first={i === 0} onEdit={() => setEditing({ row: r as unknown as Row })} onDelete={() => void remove(r as unknown as Row)} onAdd={() => setEditing({ row: null })} />)}
            {tab === "encouragements" && (filtered as unknown as EncouragementRow[]).map((e, i) => <EncouragementCard key={e.encouragement_id} e={e} first={i === 0} onEdit={() => setEditing({ row: e as unknown as Row })} onDelete={() => void remove(e as unknown as Row)} onAdd={() => setEditing({ row: null })} />)}
          </div>
        )}
      </div>

      {editing ? (
        <EditModal tab={tab} level={level} row={editing.row} meta={meta}
          onClose={() => setEditing(null)}
          onDone={async (msg) => { setEditing(null); setNotice(msg); setError(null); await reloadTab(tab); }}
          onError={setError}
        />
      ) : null}
    </div>
  );
}

/* ═════════════════════════ Row primitives (iPad Content Studio) ═════════════════════════ */

// A tinted, rounded icon chip leading each row (accent at low opacity).
function TintedIcon({ icon: Icon, accent }: { icon: LucideIcon; accent: string }): ReactElement {
  return (
    <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: accent + "1A", color: accent }}><Icon size={18} /></span>
  );
}

// Small inline meta chip (icon + value, tinted) used along the row.
function MetaChip({ icon: Icon, text, color = "var(--muted-foreground)" }: { icon?: LucideIcon; text: string; color?: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 rounded-full shrink-0" style={{ padding: "3px 9px", fontSize: 11.5, fontWeight: 500, background: color === "var(--muted-foreground)" ? "var(--secondary)" : color + "1A", color }}>
      {Icon ? <Icon size={10.5} /> : null}{text}
    </span>
  );
}

// The trailing ⋯ row menu: Edit, Add (new item in this section), Delete
// (destructive; omitted on the edit-only daily-verses section). A subtle navy
// control on a light rounded hit area, opening a small popover.
function RowMenu({ onEdit, onAdd, onDelete }: { onEdit: () => void; onAdd?: (() => void) | undefined; onDelete?: (() => void) | undefined }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} title="Actions" className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, border: "none", color: "var(--nuru-navy)", background: open ? "rgba(11,31,51,0.10)" : "rgba(11,31,51,0.06)", cursor: "pointer" }}><MoreHorizontal size={16} /></button>
      {open ? (
        <>
          <div className="fixed inset-0" style={{ zIndex: 30 }} onClick={() => setOpen(false)} />
          <div style={{ position: "absolute", right: 0, top: 38, width: 168, borderRadius: 12, overflow: "hidden", background: "#fff", boxShadow: "0 12px 36px rgba(11,31,51,0.16), 0 0 0 1px var(--border)", zIndex: 31 }}>
            <MenuRow icon={Pencil} label="Edit" onClick={() => { setOpen(false); onEdit(); }} />
            {onAdd ? <MenuRow icon={Plus} label="Add" onClick={() => { setOpen(false); onAdd(); }} /> : null}
            {onDelete ? <><div style={{ height: 1, background: "var(--border)" }} /><MenuRow icon={Trash2} label="Delete" danger onClick={() => { setOpen(false); onDelete(); }} /></> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
function MenuRow({ icon: Icon, label, danger, onClick }: { icon: LucideIcon; label: string; danger?: boolean; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2.5 text-left" style={{ padding: "9px 12px", background: "transparent", border: "none", cursor: "pointer", color: danger ? "#DC2626" : "var(--foreground)", fontSize: 12.5, fontWeight: 600 }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--secondary)"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
      <Icon size={13} /> {label}
    </button>
  );
}

// Full-width row shell: tinted icon chip → content column → trailing ⋯ menu, with
// a hairline divider above every row except the first (the parent card owns the
// outer chrome). One row per item, ~64pt tall.
function RowShell({ icon, accent, first, children, onEdit, onAdd, onDelete }: { icon: LucideIcon; accent: string; first?: boolean | undefined; children: ReactNode; onEdit: () => void; onAdd?: (() => void) | undefined; onDelete?: (() => void) | undefined }): ReactElement {
  return (
    <div className="flex items-center gap-3.5 transition-colors hover:bg-secondary/40" style={{ padding: "12px 16px", borderTop: first ? "none" : "1px solid var(--border)" }}>
      <TintedIcon icon={icon} accent={accent} />
      <div className="flex-1 min-w-0">{children}</div>
      <RowMenu onEdit={onEdit} onAdd={onAdd} onDelete={onDelete} />
    </div>
  );
}

// Pill (kept for the modal/legacy callers) + semantic status pill.
function Pill({ children, bg, color }: { children: ReactNode; bg: string; color: string }): ReactElement {
  return <span className="inline-flex items-center gap-1 rounded-full" style={{ padding: "2px 9px", fontSize: 10.5, fontWeight: 700, background: bg, color }}>{children}</span>;
}
function StatusPill({ on, onLabel = "Active", offLabel = "Inactive" }: { on: boolean; onLabel?: string; offLabel?: string }): ReactElement {
  return on
    ? <Pill bg="var(--color-success-bg)" color="var(--color-success)"><span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--color-success)" }} /> {onLabel}</Pill>
    : <Pill bg="var(--secondary)" color="var(--muted-foreground)">{offLabel}</Pill>;
}

// Shared two-line row body: a top line (title + meta chips + status pill) and an
// optional one-line preview. Title stays navy; meta chips carry the accent.
function RowBody({ title, chips, status, preview }: { title: string; chips: ReactNode; status?: ReactNode; preview?: string | null | undefined }): ReactElement {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="truncate" style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)" }}>{title}</span>
        {chips}
        {status ? <span className="ml-auto shrink-0">{status}</span> : null}
      </div>
      {preview ? <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 3, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{preview}</p> : null}
    </>
  );
}

function DailyVerseCard({ d, first, onEdit }: { d: DailyVerseRow; first?: boolean | undefined; onEdit: () => void }): ReactElement {
  const dateLabel = new Date(d.day_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return (
    // Daily verses are edit-only (fixed year plan) — no Add, no Delete.
    <RowShell icon={CalendarDays} accent={NAVY} first={first} onEdit={onEdit}>
      <RowBody
        title={d.reference || `Day ${d.day_index}`}
        chips={<>
          <MetaChip text={`Day ${d.day_index}`} color={NAVY} />
          {d.version ? <MetaChip icon={BookOpen} text={d.version} color={NAVY} /> : null}
          <MetaChip icon={CalendarDays} text={dateLabel} />
          {d.theme ? <MetaChip icon={Sparkles} text={d.theme} /> : null}
        </>}
        preview={d.verse_text ? `“${d.verse_text}”` : null}
      />
    </RowShell>
  );
}

function DevotionalCard({ d, first, onEdit, onDelete, onAdd }: { d: DevotionalRow; first?: boolean | undefined; onEdit: () => void; onDelete: () => void; onAdd: () => void }): ReactElement {
  return (
    <RowShell icon={BookOpen} accent={NAVY} first={first} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd}>
      <RowBody
        title={d.title || "Untitled devotional"}
        status={<StatusPill on={d.is_published} onLabel="Published" offLabel="Draft" />}
        chips={<>
          <MetaChip icon={CalendarDays} text={`Day ${d.day_number}`} color={NAVY} />
          {d.series ? <MetaChip text={d.series} /> : null}
          {d.scripture_ref ? <MetaChip icon={QuoteIcon} text={d.scripture_ref} color={GOLD} /> : null}
        </>}
        preview={d.body}
      />
    </RowShell>
  );
}

function VerseCard({ v, first, onEdit, onDelete, onAdd }: { v: VerseRow; first?: boolean | undefined; onEdit: () => void; onDelete: () => void; onAdd: () => void }): ReactElement {
  return (
    <RowShell icon={Quote} accent={GOLD} first={first} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd}>
      <RowBody
        title={v.reference || "Untitled verse"}
        status={<StatusPill on={v.is_active} />}
        chips={<>
          {v.version ? <MetaChip icon={BookOpen} text={v.version} color={GOLD} /> : null}
          {v.week_number ? <MetaChip icon={CalendarDays} text={`Week ${v.week_number}`} /> : null}
          {v.release_date ? <MetaChip icon={CalendarRange} text={new Date(v.release_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} /> : null}
        </>}
        preview={v.verse_text ? `“${v.verse_text}”` : null}
      />
    </RowShell>
  );
}

function PlanCard({ p, first, onEdit, onDelete, onAdd }: { p: PlanRow; first?: boolean | undefined; onEdit: () => void; onDelete: () => void; onAdd: () => void }): ReactElement {
  return (
    <RowShell icon={CalendarRange} accent={GOLD} first={first} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd}>
      <RowBody
        title={p.title || "Untitled plan"}
        status={<StatusPill on={p.is_active} />}
        chips={<>
          <MetaChip icon={CalendarDays} text={`${p.day_count} day${p.day_count === 1 ? "" : "s"}`} color={GOLD} />
          {p.category ? <MetaChip icon={Library} text={p.category} color={NAVY} /> : null}
          {p.code ? <MetaChip icon={Hash} text={p.code} /> : null}
        </>}
        preview={p.subtitle ?? p.description}
      />
    </RowShell>
  );
}

function ResourceCard({ r, first, onEdit, onDelete, onAdd }: { r: ResourceAdminRow; first?: boolean | undefined; onEdit: () => void; onDelete: () => void; onAdd: () => void }): ReactElement {
  const Icon = RESOURCE_ICON[r.kind] ?? FileText;
  return (
    <RowShell icon={Icon} accent={NAVY} first={first} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd}>
      <RowBody
        title={r.title || "Untitled resource"}
        status={<StatusPill on={r.is_active} />}
        chips={<>
          <MetaChip icon={Icon} text={r.kind} color={NAVY} />
          {r.author ? <MetaChip text={r.author} /> : null}
          {r.duration_label ? <MetaChip icon={Clock} text={r.duration_label} /> : null}
          {r.url ? <MetaChip icon={Link2} text="Link" color={GOLD} /> : null}
        </>}
      />
    </RowShell>
  );
}

function EncouragementCard({ e, first, onEdit, onDelete, onAdd }: { e: EncouragementRow; first?: boolean | undefined; onEdit: () => void; onDelete: () => void; onAdd: () => void }): ReactElement {
  return (
    <RowShell icon={Sparkles} accent={GOLD} first={first} onEdit={onEdit} onDelete={onDelete} onAdd={onAdd}>
      <RowBody
        title={e.title || "Untitled encouragement"}
        status={<StatusPill on={e.is_active} />}
        chips={<>
          {e.emoji ? <MetaChip text={e.emoji.slice(0, 2)} color={GOLD} /> : null}
          <MetaChip icon={Sparkles} text={e.kind} color={GOLD} />
          <MetaChip icon={ArrowRightToLine} text={`after module ${e.after_module_sequence}`} color={NAVY} />
          {e.scripture_ref ? <MetaChip icon={QuoteIcon} text={e.scripture_ref} /> : null}
        </>}
        preview={e.body}
      />
    </RowShell>
  );
}

function EmptyState({ meta, onNew }: { meta: typeof TABS[number]; onNew: () => void }): ReactElement {
  const Icon = meta.icon;
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-2xl" style={{ padding: "56px 24px", background: "#fff", border: "1px dashed var(--border)" }}>
      <div className="flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: meta.accent + "1A", color: meta.accent, marginBottom: 14 }}><Icon size={26} /></div>
      <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--nuru-navy)" }}>No {meta.label.toLowerCase()} yet</h3>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4, maxWidth: 340 }}>Create your first {meta.singular} to publish it to the mobile app.</p>
      <button onClick={onNew} className="flex items-center gap-2 rounded-lg px-4 mt-5" style={{ height: 38, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
        <Plus size={14} /> New {meta.singular}
      </button>
    </div>
  );
}

/* ═════════════════════════ Field primitives ═════════════════════════ */
const inputStyle = { width: "100%", height: 40, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", padding: "0 12px", fontSize: 13, color: "var(--foreground)", outline: "none" } as const;
const labelStyle = { display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 } as const;

function Field({ label, required, full, children }: { label: string; required?: boolean; full?: boolean; children: ReactNode }): ReactElement {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label style={labelStyle}>{label} {required && <span style={{ color: "#DC2626" }}>*</span>}</label>
      {children}
    </div>
  );
}
function TextInput({ value, onChange, placeholder, mono }: { value: string | number; onChange: (v: string) => void; placeholder?: string; mono?: boolean }): ReactElement {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono, monospace)" : undefined }} />;
}
function TextArea({ value, onChange, placeholder, rows = 3 }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number }): ReactElement {
  return <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows} style={{ ...inputStyle, height: "auto", padding: "10px 12px", lineHeight: 1.55, resize: "vertical" }} />;
}
function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }): ReactElement {
  return (
    <div className="relative">
      <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, appearance: "none", textTransform: "capitalize", fontWeight: 600 }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <ChevronDown size={14} style={{ position: "absolute", right: 12, top: 13, color: "var(--muted-foreground)", pointerEvents: "none" }} />
    </div>
  );
}
function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }): ReactElement {
  return (
    <button type="button" onClick={onToggle} className="flex items-center gap-2.5" style={{ background: "none", border: "none", cursor: "pointer" }}>
      <span className="rounded-full" style={{ width: 42, height: 24, background: on ? "var(--nuru-gold)" : "var(--switch-background)", padding: 3, display: "inline-block", transition: "background .15s" }}>
        <span className="block rounded-full" style={{ width: 18, height: 18, background: "#fff", transform: on ? "translateX(18px)" : "translateX(0)", transition: "transform .15s" }} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{label}</span>
    </button>
  );
}

/* ═════════════════════════ Edit modal ═════════════════════════ */
const num = (v: unknown): number | undefined => (v === "" || v == null ? undefined : Number(v));
const trimmed = (v: unknown): string | undefined => { const s = String(v ?? "").trim(); return s ? s : undefined; };

function EditModal({ tab, level, row, meta, onClose, onDone, onError }: {
  tab: TabKey; level: number; row: Row | null; meta: typeof TABS[number]; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void;
}): ReactElement {
  const editing = !!row;
  const id = row ? String(row[ID_KEY[tab]]) : "";
  const [draft, setDraft] = useState<Row>(() => row ? { ...row } : blankFor(tab, level));
  const [days, setDays] = useState<PlanDayRow[]>(() => (row ? [] : [{ day_number: 1, reference: "", title: "", content: "", segments: [] }]));
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown): void => setDraft((d) => ({ ...d, [k]: v }));

  useEffect(() => {
    if (tab !== "plans" || !editing) return;
    let live = true;
    void GrowthAdminApi.plan(id).then((p) => { if (live) setDays((p.days ?? []).map((d) => ({ ...d, segments: d.segments ?? [] }))); }).catch(() => undefined);
    return () => { live = false; };
  }, [tab, editing, id]);

  const canSave = (() => {
    switch (tab) {
      case "devotionals": return !!trimmed(draft.title) && !!trimmed(draft.body) && !!num(draft.day_number);
      case "verses": return !!trimmed(draft.reference) && !!trimmed(draft.verse_text);
      case "dailyverses": return !!trimmed(draft.reference) && !!trimmed(draft.verse_text) && !!trimmed(draft.version);
      case "plans": return !!trimmed(draft.code) && !!trimmed(draft.title);
      case "resources": return !!trimmed(draft.title);
      default: return true;
    }
  })();

  async function submit(): Promise<void> {
    if (!canSave) return;
    setBusy(true);
    try {
      if (tab === "devotionals") {
        const body: Row = {
          day_number: num(draft.day_number) ?? 1, title: trimmed(draft.title), body: trimmed(draft.body),
          is_published: !!draft.is_published,
        };
        for (const k of ["series", "scripture_ref", "scripture_text", "reflection_prompt", "audio_url", "video_url"]) { const t = trimmed(draft[k]); if (t) body[k] = t; }
        if (editing) await GrowthAdminApi.updateDevotional(id, body); else await GrowthAdminApi.createDevotional(body);
      } else if (tab === "verses") {
        const body: Row = { reference: trimmed(draft.reference), version: trimmed(draft.version) ?? "WEB", verse_text: trimmed(draft.verse_text), is_active: !!draft.is_active };
        if (num(draft.week_number) != null) body.week_number = num(draft.week_number);
        { const rd = trimmed(draft.release_date); if (rd) body.release_date = rd; }
        if (num(draft.sort) != null) body.sort = num(draft.sort);
        if (editing) await GrowthAdminApi.updateVerse(id, body); else await GrowthAdminApi.createVerse(body);
      } else if (tab === "dailyverses") {
        const body: Row = {};
        for (const k of ["theme", "reference", "version", "verse_text", "day_date"]) { const t = trimmed(draft[k]); if (t) body[k] = t; }
        await GrowthAdminApi.updateDailyVerse(Number(draft.day_index), body);
      } else if (tab === "resources") {
        const body: Row = { title: trimmed(draft.title), kind: trimmed(draft.kind) ?? "book", is_active: !!draft.is_active };
        for (const k of ["author", "duration_label", "url"]) { const t = trimmed(draft[k]); if (t) body[k] = t; }
        if (num(draft.sort) != null) body.sort = num(draft.sort);
        if (editing) await GrowthAdminApi.updateResource(id, body); else await GrowthAdminApi.createResource(body);
      } else if (tab === "encouragements") {
        const lvl = num(draft.level_number) ?? level;
        const body: Row = { kind: trimmed(draft.kind) ?? "splash", is_active: !!draft.is_active };
        if (num(draft.after_module_sequence) != null) body.after_module_sequence = num(draft.after_module_sequence);
        if (num(draft.sort_order) != null) body.sort_order = num(draft.sort_order);
        for (const k of ["title", "body", "scripture_ref", "emoji", "image_url"]) { const t = trimmed(draft[k]); if (t) body[k] = t; }
        if (editing) { body.level_number = lvl; await EncouragementsAdminApi.update(id, body); }
        else await EncouragementsAdminApi.create(lvl, body);
      } else {
        const body: Row = { code: trimmed(draft.code), title: trimmed(draft.title), is_active: !!draft.is_active };
        for (const k of ["category", "subtitle", "description", "image_url"]) { const t = trimmed(draft[k]); if (t) body[k] = t; }
        if (num(draft.sort) != null) body.sort = num(draft.sort);
        const planDays = days.filter((d) => d.reference.trim()).map((d, di) => ({
          day_number: d.day_number || di + 1, reference: d.reference.trim(),
          ...(d.title ? { title: d.title } : {}), ...(d.content ? { content: d.content } : {}),
          segments: (d.segments ?? []).filter((s) => s.title?.trim()).map((s, si) => ({
            sort: si, kind: s.kind, title: s.title.trim(),
            ...(s.reference ? { reference: s.reference } : {}), ...(s.content ? { content: s.content } : {}), ...(s.video_url ? { video_url: s.video_url } : {}),
          })),
        }));
        if (editing) await GrowthAdminApi.updatePlan(id, planDays.length ? { ...body, days: planDays } : body);
        else await GrowthAdminApi.createPlan({ ...body, days: planDays });
      }
      onDone(editing ? "Changes saved." : `${meta.singular.charAt(0).toUpperCase()}${meta.singular.slice(1)} created.`);
    } catch (e) { onError(errorMessage(e, "Could not save.")); }
    finally { setBusy(false); }
  }

  const titleText = tab === "encouragements" ? `encouragement · Level ${level}` : meta.singular;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "#fff", maxWidth: 640, maxHeight: "92vh", boxShadow: "0 24px 70px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between" style={{ padding: "18px 24px 14px", borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-1.5" style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: meta.accent }}>
              <meta.icon size={11} /> Content Studio
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", marginTop: 3, textTransform: "capitalize" }}>{editing ? "Edit" : "New"} {titleText}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>

        <div className="overflow-y-auto" style={{ padding: "20px 24px" }}>
          {tab === "devotionals" && <DevotionalForm d={draft} set={set} />}
          {tab === "verses" && <VerseForm v={draft} set={set} />}
          {tab === "dailyverses" && <DailyVerseForm d={draft} set={set} />}
          {tab === "plans" && <PlanForm p={draft} set={set} days={days} setDays={setDays} />}
          {tab === "resources" && <ResourceForm r={draft} set={set} />}
          {tab === "encouragements" && <EncouragementForm e={draft} set={set} />}
        </div>

        <div className="flex items-center justify-end gap-2" style={{ padding: "14px 24px", borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={!canSave || busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: canSave ? "var(--nuru-gold)" : "var(--muted)", color: canSave ? "#fff" : "var(--muted-foreground)", fontSize: 13, fontWeight: 700, border: "none", cursor: canSave && !busy ? "pointer" : "not-allowed", opacity: busy ? 0.7 : 1 }}>
            <Check size={14} /> Save
          </button>
        </div>
      </div>
    </div>
  );
}

function blankFor(tab: TabKey, level: number): Row {
  switch (tab) {
    case "devotionals": return { day_number: 1, title: "", series: "", scripture_ref: "", scripture_text: "", body: "", reflection_prompt: "", audio_url: "", video_url: "", is_published: false };
    case "verses": return { reference: "", version: "WEB", verse_text: "", week_number: "", release_date: "", sort: "", is_active: true };
    case "plans": return { code: "", category: "Foundations", title: "", subtitle: "", description: "", image_url: "", sort: "", is_active: true };
    case "resources": return { title: "", author: "", kind: "book", duration_label: "", url: "", sort: "", is_active: true };
    default: return { after_module_sequence: 1, kind: "splash", title: "", body: "", scripture_ref: "", emoji: "", image_url: "", sort_order: 1, is_active: true, level_number: level };
  }
}

/* ── Forms ── */
function DevotionalForm({ d, set }: { d: Row; set: (k: string, v: unknown) => void }): ReactElement {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Day number" required><TextInput value={String(d.day_number ?? "")} onChange={(v) => set("day_number", v)} placeholder="1" /></Field>
      <Field label="Series"><TextInput value={String(d.series ?? "")} onChange={(v) => set("series", v)} placeholder="Foundations of Faith" /></Field>
      <Field label="Title" required full><TextInput value={String(d.title ?? "")} onChange={(v) => set("title", v)} placeholder="A New Creation" /></Field>
      <Field label="Scripture reference"><TextInput value={String(d.scripture_ref ?? "")} onChange={(v) => set("scripture_ref", v)} placeholder="2 Corinthians 5:17" /></Field>
      <Field label="Reflection prompt"><TextInput value={String(d.reflection_prompt ?? "")} onChange={(v) => set("reflection_prompt", v)} placeholder="Where have you seen…" /></Field>
      <Field label="Scripture text" full><TextArea value={String(d.scripture_text ?? "")} onChange={(v) => set("scripture_text", v)} rows={2} placeholder="Therefore, if anyone is in Christ…" /></Field>
      <Field label="Body" required full><TextArea value={String(d.body ?? "")} onChange={(v) => set("body", v)} rows={5} placeholder="Write the devotional…" /></Field>
      <Field label="Audio URL"><TextInput value={String(d.audio_url ?? "")} onChange={(v) => set("audio_url", v)} mono placeholder="https://" /></Field>
      <Field label="Video URL"><TextInput value={String(d.video_url ?? "")} onChange={(v) => set("video_url", v)} mono placeholder="https://" /></Field>
      <div style={{ gridColumn: "1 / -1", marginTop: 2 }}><Toggle on={!!d.is_published} onToggle={() => set("is_published", !d.is_published)} label="Published to members" /></div>
    </div>
  );
}

function VerseForm({ v, set }: { v: Row; set: (k: string, x: unknown) => void }): ReactElement {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Reference" required><TextInput value={String(v.reference ?? "")} onChange={(x) => set("reference", x)} placeholder="John 15:5" /></Field>
      <Field label="Version"><SelectInput value={String(v.version ?? "WEB")} onChange={(x) => set("version", x)} options={VERSIONS} /></Field>
      <Field label="Verse text" required full><TextArea value={String(v.verse_text ?? "")} onChange={(x) => set("verse_text", x)} rows={3} placeholder="I am the vine…" /></Field>
      <Field label="Week number"><TextInput value={String(v.week_number ?? "")} onChange={(x) => set("week_number", x)} placeholder="1" /></Field>
      <Field label="Date">
        <div className="relative">
          <input type="date" value={String(v.release_date ?? "")} onChange={(e) => set("release_date", e.target.value)} style={{ ...inputStyle, paddingRight: 36 }} />
          <CalendarRange size={14} style={{ position: "absolute", right: 12, top: 13, color: "var(--muted-foreground)", pointerEvents: "none" }} />
        </div>
      </Field>
      <Field label="Sort"><TextInput value={String(v.sort ?? "")} onChange={(x) => set("sort", x)} placeholder="1" /></Field>
      <div className="flex items-end pb-1"><Toggle on={!!v.is_active} onToggle={() => set("is_active", !v.is_active)} label="Active" /></div>
    </div>
  );
}

function DailyVerseForm({ d, set }: { d: Row; set: (k: string, x: unknown) => void }): ReactElement {
  const dayLabel = d.day_date ? new Date(String(d.day_date)).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) : "";
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Day" full>
        <div className="flex items-center gap-2 rounded-lg" style={{ padding: "9px 12px", background: "var(--secondary)", border: "1px solid var(--border)" }}>
          <span className="inline-flex items-center justify-center rounded-md" style={{ width: 26, height: 26, background: "rgba(14,165,160,0.12)", color: "#0E7C77", fontWeight: 800, fontSize: 12 }}>{String(d.day_index ?? "")}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>Day {String(d.day_index ?? "")}{dayLabel ? ` · ${dayLabel}` : ""}</span>
        </div>
      </Field>
      <Field label="Theme"><TextInput value={String(d.theme ?? "")} onChange={(x) => set("theme", x)} placeholder="JOY & HAPPINESS" /></Field>
      <Field label="Version" required><SelectInput value={String(d.version ?? "WEB")} onChange={(x) => set("version", x)} options={VERSIONS} /></Field>
      <Field label="Reference" required full><TextInput value={String(d.reference ?? "")} onChange={(x) => set("reference", x)} placeholder="Nehemiah 8:10" /></Field>
      <Field label="Verse text" required full><TextArea value={String(d.verse_text ?? "")} onChange={(x) => set("verse_text", x)} rows={4} placeholder="Do not grieve, for the joy of the LORD is your strength." /></Field>
    </div>
  );
}

function ResourceForm({ r, set }: { r: Row; set: (k: string, v: unknown) => void }): ReactElement {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Title" required full><TextInput value={String(r.title ?? "")} onChange={(v) => set("title", v)} placeholder="Mere Christianity" /></Field>
      <Field label="Author"><TextInput value={String(r.author ?? "")} onChange={(v) => set("author", v)} placeholder="C. S. Lewis" /></Field>
      <Field label="Kind" required><SelectInput value={String(r.kind ?? "book")} onChange={(v) => set("kind", v)} options={RESOURCE_KINDS} /></Field>
      <Field label="Duration label"><TextInput value={String(r.duration_label ?? "")} onChange={(v) => set("duration_label", v)} placeholder="12 min" /></Field>
      <Field label="Sort"><TextInput value={String(r.sort ?? "")} onChange={(v) => set("sort", v)} /></Field>
      <Field label="URL" full><TextInput value={String(r.url ?? "")} onChange={(v) => set("url", v)} mono placeholder="https://" /></Field>
      <div style={{ gridColumn: "1 / -1", marginTop: 2 }}><Toggle on={!!r.is_active} onToggle={() => set("is_active", !r.is_active)} label="Active" /></div>
    </div>
  );
}

function EncouragementForm({ e, set }: { e: Row; set: (k: string, v: unknown) => void }): ReactElement {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Level"><SelectInput value={String(e.level_number ?? 1)} onChange={(v) => set("level_number", v)} options={LEVELS.map(String)} /></Field>
      <Field label="After module #"><TextInput value={String(e.after_module_sequence ?? "")} onChange={(v) => set("after_module_sequence", v)} placeholder="1" /></Field>
      <Field label="Kind" required><SelectInput value={String(e.kind ?? "splash")} onChange={(v) => set("kind", v)} options={ENCOURAGEMENT_KINDS} /></Field>
      <Field label="Emoji(s)"><TextInput value={String(e.emoji ?? "")} onChange={(v) => set("emoji", v)} placeholder="🎉🙌" /></Field>
      <Field label="Title" full><TextInput value={String(e.title ?? "")} onChange={(v) => set("title", v)} placeholder="You've begun the journey!" /></Field>
      <Field label="Body" full><TextArea value={String(e.body ?? "")} onChange={(v) => set("body", v)} rows={4} /></Field>
      <Field label="Scripture ref (for note)"><TextInput value={String(e.scripture_ref ?? "")} onChange={(v) => set("scripture_ref", v)} placeholder="Philippians 1:6" /></Field>
      <Field label="Sort order"><TextInput value={String(e.sort_order ?? "")} onChange={(v) => set("sort_order", v)} /></Field>
      <Field label="Image URL (splash)" full><TextInput value={String(e.image_url ?? "")} onChange={(v) => set("image_url", v)} mono placeholder="https://" /></Field>
      <div style={{ gridColumn: "1 / -1", marginTop: 2 }}><Toggle on={!!e.is_active} onToggle={() => set("is_active", !e.is_active)} label="Active" /></div>
    </div>
  );
}

function PlanForm({ p, set, days, setDays }: { p: Row; set: (k: string, v: unknown) => void; days: PlanDayRow[]; setDays: (fn: (d: PlanDayRow[]) => PlanDayRow[]) => void }): ReactElement {
  const addDay = (): void => setDays((d) => [...d, { day_number: d.length + 1, reference: "", title: "", content: "", segments: [] }]);
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
      <Field label="Code" required><TextInput value={String(p.code ?? "")} onChange={(v) => set("code", v)} mono placeholder="NEW-BELIEVER-21" /></Field>
      <Field label="Category"><SelectInput value={String(p.category ?? "Foundations")} onChange={(v) => set("category", v)} options={PLAN_CATEGORIES} /></Field>
      <Field label="Title" required full><TextInput value={String(p.title ?? "")} onChange={(v) => set("title", v)} placeholder="First 21 Days" /></Field>
      <Field label="Subtitle / tagline" full><TextInput value={String(p.subtitle ?? "")} onChange={(v) => set("subtitle", v)} placeholder="A gentle on-ramp for new believers" /></Field>
      <Field label="Description" full><TextArea value={String(p.description ?? "")} onChange={(v) => set("description", v)} rows={3} /></Field>
      <Field label="Cover image URL" full><TextInput value={String(p.image_url ?? "")} onChange={(v) => set("image_url", v)} mono placeholder="https://" /></Field>
      <Field label="Sort"><TextInput value={String(p.sort ?? "")} onChange={(v) => set("sort", v)} /></Field>
      <div className="flex items-end"><Toggle on={!!p.is_active} onToggle={() => set("is_active", !p.is_active)} label="Active" /></div>

      <div style={{ gridColumn: "1 / -1" }}>
        <div className="flex items-center justify-between mb-2">
          <label style={labelStyle}>Plan days &amp; segments</label>
          <button onClick={addDay} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5" style={{ background: "var(--secondary)", color: "var(--nuru-navy)", fontSize: 11.5, fontWeight: 700, border: "none" }}><Plus size={12} /> Day</button>
        </div>
        {days.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "10px 12px", border: "1px dashed var(--border)", borderRadius: 10 }}>No days yet — add the plan's daily readings.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {days.map((d, i) => {
              const upd = (patch: Partial<PlanDayRow>): void => setDays((arr) => arr.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              const updSeg = (si: number, patch: Partial<PlanSegmentRow>): void => setDays((arr) => arr.map((x, j) => (j === i ? { ...x, segments: (x.segments ?? []).map((s, k) => (k === si ? { ...s, ...patch } : s)) } : x)));
              const segs = d.segments ?? [];
              return (
                <div key={i} className="rounded-xl" style={{ border: "1px solid var(--border)", background: "var(--secondary)", padding: 12 }}>
                  <div className="flex items-center gap-2 mb-2">
                    <input value={d.day_number} onChange={(e) => upd({ day_number: Number(e.target.value) || 1 })} type="number" style={{ ...inputStyle, width: 60, height: 36 }} title="Day #" />
                    <input value={d.reference} onChange={(e) => upd({ reference: e.target.value })} placeholder="Reference (e.g. John 3:1-16)" style={{ ...inputStyle, height: 36 }} />
                    <input value={d.title ?? ""} onChange={(e) => upd({ title: e.target.value })} placeholder="Day title" style={{ ...inputStyle, height: 36 }} />
                    <button onClick={() => setDays((arr) => arr.filter((_, j) => j !== i))} className="rounded-lg p-2 shrink-0" style={{ color: "#DC2626", background: "none", border: "none" }} title="Remove day"><Trash2 size={14} /></button>
                  </div>
                  <div className="flex flex-col gap-2" style={{ paddingLeft: 8, borderLeft: "2px solid var(--border)" }}>
                    {segs.map((s, si) => (
                      <div key={si} className="rounded-lg" style={{ background: "#fff", border: "1px solid var(--border)", padding: 8 }}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <select value={s.kind} onChange={(e) => updSeg(si, { kind: e.target.value as PlanSegmentRow["kind"] })} style={{ ...inputStyle, width: 130, height: 34, padding: "0 8px" }}>
                            {["devotional", "scripture", "video", "talk", "reading"].map((k) => <option key={k} value={k}>{k}</option>)}
                          </select>
                          <input value={s.title} onChange={(e) => updSeg(si, { title: e.target.value })} placeholder="Segment title" style={{ ...inputStyle, height: 34, padding: "0 8px" }} />
                          <button onClick={() => upd({ segments: segs.filter((_, k) => k !== si) })} className="rounded-lg p-1.5 shrink-0" style={{ color: "#DC2626", background: "none", border: "none" }} title="Remove segment"><Trash2 size={13} /></button>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <input value={s.reference ?? ""} onChange={(e) => updSeg(si, { reference: e.target.value })} placeholder="Reference (optional)" style={{ ...inputStyle, height: 34, padding: "0 8px" }} />
                          <input value={s.video_url ?? ""} onChange={(e) => updSeg(si, { video_url: e.target.value })} placeholder="Video URL (optional)" style={{ ...inputStyle, height: 34, padding: "0 8px" }} />
                        </div>
                        <textarea value={s.content ?? ""} onChange={(e) => updSeg(si, { content: e.target.value })} rows={2} placeholder="Content (markdown)" style={{ ...inputStyle, height: "auto", padding: "8px", resize: "vertical", lineHeight: 1.5 }} />
                      </div>
                    ))}
                    <button onClick={() => upd({ segments: [...segs, { kind: "devotional", title: "", reference: "", content: "", video_url: "" }] })} className="flex items-center gap-1 rounded-lg px-2 py-1 self-start" style={{ background: "#fff", border: "1px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--foreground)" }}><Plus size={11} /> Segment</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
