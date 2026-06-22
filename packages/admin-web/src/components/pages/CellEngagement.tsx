// Cell Engagement — rebuilt to the "Final Pathway Portal" make, wired to the live
// engagement report (AdminApi.engagementReport → cells by cell_group_id). Cell
// roster cards, a leaderboard ranked by average engagement, and an at-risk watch
// list. Mock-only fields (discipler/room/meeting time) the make showed aren't in
// our model, so real per-cell metrics (members, avg engagement, at-risk) are shown.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, CircleAlert, Sparkles, TrendingUp, Users, ArrowUpRight, Plus, X, Home, UserCheck, Target, CalendarClock, MapPin, CalendarPlus, GraduationCap, Star, Pencil, ImagePlus, Loader2 } from "lucide-react";
import { AdminApi, OpsApi, uploadToCloudinary, type EngagementCellRow, type CreateCellBody } from "../../api/client";
import { errorMessage } from "../../util/error";

const TONE_HEX: Record<string, string> = { amber: "#C89B3C", blue: "#1F3A6B", green: "#16A34A", violet: "#7C3AED", rose: "#DB2777", red: "#DC2626" };
const TONES = ["#16A34A", "#0B84E8", "#7C3AED", "#C89B3C", "#DC2626", "#0D9488"];
const toneOf = (cell: EngagementCellRow): string => {
  if (cell.tone && TONE_HEX[cell.tone]) return TONE_HEX[cell.tone] as string;
  const id = cell.cell_group_id; let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % TONES.length; return TONES[h] as string;
};
const initials = (name: string): string => name.replace(/^(pastor|rev|dr|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "C";
const pct = (v: number): number => Math.round((v ?? 0) * 100);

export function CellEngagement(): ReactElement {
  const navigate = useNavigate();
  const [cells, setCells] = useState<EngagementCellRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editCell, setEditCell] = useState<EngagementCellRow | null>(null);
  const [featuringId, setFeaturingId] = useState<string | null>(null);

  const load = useCallback(
    () => AdminApi.engagementReport().then((r) => setCells(r.cells)).catch((e) => setError(errorMessage(e, "Could not load cell engagement."))),
    [],
  );
  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (created: EngagementCellRow, featureOnHomepage: boolean): Promise<void> => {
    setAddOpen(false);
    if (featureOnHomepage) {
      // Set the new cell as featured, then refetch so the single-featured
      // invariant (any prior featured cell cleared server-side) shows correctly.
      try { await AdminApi.setFeaturedCell(created.cell_group_id); await load(); return; }
      catch (e) { setError(errorMessage(e, "Cell created, but could not feature it on the homepage.")); }
    }
    setCells((prev) => [created, ...prev]);
  };

  const handleUpdate = (updated: EngagementCellRow): void => {
    setEditCell(null);
    // Preserve the derived metrics already loaded (the PATCH echoes zeros for
    // avg_engagement/at_risk); only the edited metadata changes here.
    setCells((prev) => prev.map((c) => (c.cell_group_id === updated.cell_group_id
      ? { ...c, ...updated, avg_engagement: c.avg_engagement, at_risk: c.at_risk, members: c.members }
      : c)));
  };

  // Toggle the homepage-featured cell ("This week at Nuru"). The server keeps the
  // single-featured invariant, so we refetch the whole report after each toggle.
  const toggleFeatured = async (cell: EngagementCellRow): Promise<void> => {
    setFeaturingId(cell.cell_group_id);
    setError(null);
    try {
      if (cell.is_featured) await AdminApi.clearFeaturedCell(cell.cell_group_id);
      else await AdminApi.setFeaturedCell(cell.cell_group_id);
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not update the homepage-featured cell."));
    } finally {
      setFeaturingId(null);
    }
  };

  const totalMembers = cells.reduce((s, c) => s + c.members, 0);
  const totalAtRisk = cells.reduce((s, c) => s + c.at_risk, 0);
  const overallAvg = totalMembers ? Math.round((cells.reduce((s, c) => s + c.avg_engagement * c.members, 0) / totalMembers) * 100) : 0;
  const ranked = useMemo(() => [...cells].sort((a, b) => b.avg_engagement - a.avg_engagement), [cells]);

  return (
    <main className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 26px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Cell Engagement</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> Pastoral overview</span>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#E8EFF5", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.12)" }}><ArrowUpRight size={13} /> Action queue</button>
            <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none" }}><Plus size={14} /> New Cell</button>
          </div>
        </div>
        <div className="mt-5">
          <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Cells &amp; disciplers</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(26px,4vw,38px)", lineHeight: 1.05, letterSpacing: "-0.01em" }}>Cell Engagement</h1>
          <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 600, lineHeight: 1.5 }}>A high-level read on how every cell is doing. Open a cell to see its members, progress and activity in detail.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Active cells", value: String(cells.length), hint: "with members" },
            { label: "Disciples", value: String(totalMembers), hint: "across all cells" },
            { label: "At-risk", value: String(totalAtRisk), hint: "need pastoral call" },
            { label: "Avg engagement", value: `${overallAvg}%`, hint: "all cells" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <section style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="mb-3 flex items-end justify-between gap-3 flex-wrap">
          <div><div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>Cell roster</div><h2 className="type-section">Cells &amp; their disciplers</h2></div>
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 34, background: "var(--nuru-gold)", color: "#fff", fontSize: 12.5, fontWeight: 700, border: "none" }}><Plus size={14} /> New cell</button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
          {cells.map((cell) => {
            const tone = toneOf(cell); const avg = pct(cell.avg_engagement);
            return (
              <button key={cell.cell_group_id} onClick={() => navigate(`/cell-engagement/${cell.cell_group_id}`)} className="group text-left rounded-3xl p-5 transition hover:-translate-y-0.5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-extrabold" style={{ background: `${tone}18`, color: tone }}>{initials(cell.name)}</span>
                    <div><h3 style={{ fontSize: 16, fontWeight: 800, color: "#0B1F33", lineHeight: 1.15 }}>{cell.name}</h3><p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)", marginTop: 2 }}>{cell.members} members</p></div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      role="button"
                      tabIndex={0}
                      title="Edit this cell"
                      aria-label={`Edit ${cell.name}`}
                      onClick={(e) => { e.stopPropagation(); setEditCell(cell); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setEditCell(cell); } }}
                      className="inline-flex items-center gap-0.5 rounded-full px-2 py-1"
                      style={{ fontSize: 11, fontWeight: 800, color: "#0B1F33", background: "rgba(255,255,255,0.7)", border: "1px solid var(--border)", cursor: "pointer" }}
                    >
                      <Pencil size={11} /> Edit
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full px-2 py-1" style={{ fontSize: 11, fontWeight: 800, color: "#0B1F33", background: "rgba(255,255,255,0.7)", border: "1px solid var(--border)" }}>View <ChevronRight size={12} /></span>
                  </div>
                </div>
                <div className="mt-3">
                  <span
                    role="button"
                    tabIndex={0}
                    aria-pressed={cell.is_featured ?? false}
                    title={cell.is_featured ? "Featured on the homepage — click to remove" : "Feature this cell on the homepage"}
                    onClick={(e) => { e.stopPropagation(); if (featuringId !== cell.cell_group_id) void toggleFeatured(cell); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); if (featuringId !== cell.cell_group_id) void toggleFeatured(cell); } }}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition"
                    style={{
                      fontSize: 11,
                      fontWeight: 800,
                      cursor: featuringId === cell.cell_group_id ? "wait" : "pointer",
                      opacity: featuringId === cell.cell_group_id ? 0.6 : 1,
                      color: cell.is_featured ? "#fff" : "var(--muted-foreground)",
                      background: cell.is_featured ? "var(--nuru-gold)" : "rgba(0,0,0,0.03)",
                      border: cell.is_featured ? "1px solid var(--nuru-gold)" : "1px solid var(--border)",
                    }}
                  >
                    <Star size={11} fill={cell.is_featured ? "#fff" : "none"} />
                    {cell.is_featured ? "Homepage · This week" : "Feature on homepage"}
                  </span>
                </div>
                <div className="mt-4 flex items-end justify-between">
                  <div><div className="nuru-eyebrow" style={{ marginBottom: 2 }}>Avg engagement</div><span style={{ fontFamily: "var(--font-display)", fontSize: 32, color: "#0B1F33", lineHeight: 1 }}>{avg}%</span></div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1" style={{ fontSize: 12, fontWeight: 700, color: "#0B1F33" }}><Users size={13} style={{ color: tone }} /> {cell.members} members</div>
                    {cell.at_risk > 0 ? <div className="mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ fontSize: 11, fontWeight: 800, color: "#B91C1C", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}><CircleAlert size={11} /> {cell.at_risk} at-risk</div> : <div className="mt-1" style={{ fontSize: 11, fontWeight: 600, color: "#15803D" }}>All on track</div>}
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.05)" }}><div className="h-full rounded-full" style={{ width: `${avg}%`, background: tone }} /></div>
              </button>
            );
          })}
          {cells.length === 0 && !error ? <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>No cells with engagement data yet.</p> : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="mb-5 flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg tint-green"><TrendingUp size={15} /></span><div><div className="nuru-eyebrow nuru-eyebrow-gold">Performance</div><h3 className="type-card" style={{ color: "#0B1F33" }}>Cell engagement leaderboard</h3></div></div>
            <div className="flex flex-col gap-4">
              {ranked.map((cell, idx) => { const tone = toneOf(cell); const avg = pct(cell.avg_engagement); return (
                <div key={cell.cell_group_id} onClick={() => navigate(`/cell-engagement/${cell.cell_group_id}`)} className="cursor-pointer rounded-2xl px-1 py-1 transition hover:bg-secondary/50">
                  <div className="mb-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full" style={{ background: "#0B1F33", fontSize: 11, fontWeight: 800, color: "#fff" }}>{idx + 1}</span><span style={{ fontSize: 13.5, fontWeight: 800, color: "#0B1F33" }}>{cell.name}</span></div>
                    <span className="font-mono" style={{ fontSize: 14, fontWeight: 800, color: "#0B1F33" }}>{avg}%</span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full" style={{ background: "rgba(0,0,0,0.05)" }}><div className="h-full rounded-full" style={{ width: `${avg}%`, background: tone }} /></div>
                </div>
              ); })}
            </div>
            <p className="nuru-footnote">Ranked by average engagement. Click a cell to drill in.</p>
          </div>

          <div className="lg:col-span-2 rounded-3xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="mb-5 flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-lg tint-red"><CircleAlert size={15} /></span><div><div className="nuru-eyebrow nuru-eyebrow-gold">Needs attention</div><h3 className="type-card" style={{ color: "#0B1F33" }}>At-risk by cell</h3></div></div>
            <div className="flex flex-col gap-3">
              {[...cells].sort((a, b) => b.at_risk - a.at_risk).map((cell) => { const tone = toneOf(cell); return (
                <div key={cell.cell_group_id} onClick={() => navigate(`/cell-engagement/${cell.cell_group_id}`)} className="flex cursor-pointer items-center justify-between rounded-2xl px-4 py-3 transition" style={{ border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ fontSize: 11, fontWeight: 800, background: `${tone}18`, color: tone }}>{initials(cell.name)}</span><div><p style={{ fontSize: 13, fontWeight: 800, color: "#0B1F33" }}>{cell.name}</p><p style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{cell.members} members</p></div></div>
                  {cell.at_risk > 0 ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1" style={{ fontSize: 11, fontWeight: 800, color: "#B91C1C", background: "#FEF2F2", border: "1px solid rgba(220,38,38,0.2)" }}>{cell.at_risk} at-risk</span> : <span className="rounded-full px-2.5 py-1" style={{ fontSize: 11, fontWeight: 800, color: "#15803D", background: "#F0FDF4", border: "1px solid rgba(22,163,74,0.2)" }}>Healthy</span>}
                </div>
              ); })}
            </div>
            <p className="nuru-footnote">Prioritise pastoral calls where the at-risk count is highest.</p>
          </div>
        </div>
      </section>

      {addOpen && <CellModal onClose={() => setAddOpen(false)} onCreate={(c, f) => { void handleCreate(c, f); }} />}
      {editCell && <CellModal cell={editCell} onClose={() => setEditCell(null)} onUpdate={handleUpdate} />}
    </main>
  );
}

const ROLE_OPTIONS = ["Lead discipler", "Discipler", "Assistant discipler"];
const LEVEL_OPTIONS = ["Level 1 · New Life", "Level 2 · Foundations", "Level 3 · Walking in Faith", "Level 4 · Serving Others", "Level 5 · Multiplier Track"];
const TONE_OPTIONS: { key: string; hex: string }[] = [
  { key: "amber", hex: "#C89B3C" }, { key: "blue", hex: "#1F3A6B" }, { key: "green", hex: "#16A34A" },
  { key: "violet", hex: "#7C3AED" }, { key: "rose", hex: "#DB2777" }, { key: "red", hex: "#DC2626" },
];

const fieldStyle = { height: 40, padding: "0 12px", width: "100%", background: "var(--input-background)", border: "1.5px solid var(--border)", borderRadius: 10, fontSize: 13.5, color: "var(--foreground)", outline: "none" } as const;
const fieldLabel = { display: "block", fontSize: 10.5, fontWeight: 700, color: "var(--foreground)", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" } as const;

function Field({ label, icon, children }: { label: string; icon?: ReactElement; children: ReactElement }): ReactElement {
  return (
    <div>
      <label style={fieldLabel}>{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--muted-foreground)" }}>{icon}</span>}
        {children}
      </div>
    </div>
  );
}

function CellModal({ cell, onClose, onCreate, onUpdate }: { cell?: EngagementCellRow; onClose: () => void; onCreate?: (c: EngagementCellRow, featureOnHomepage: boolean) => void; onUpdate?: (c: EngagementCellRow) => void }): ReactElement {
  const editing = Boolean(cell);
  const [name, setName] = useState(cell?.name ?? "");
  const [discipler, setDiscipler] = useState(cell?.discipler_name ?? "");
  const [disciplerRole, setDisciplerRole] = useState(cell?.discipler_role ?? (ROLE_OPTIONS[0] as string));
  const [level, setLevel] = useState(cell?.level_label ?? (LEVEL_OPTIONS[1] as string));
  const [focus, setFocus] = useState(cell?.focus ?? "");
  const [meets, setMeets] = useState(cell?.meets ?? "");
  const [room, setRoom] = useState(cell?.room ?? "");
  const [nextSession, setNextSession] = useState(cell?.next_session ?? "");
  const [tone, setTone] = useState(cell?.tone ?? "amber");
  const [imageUrl, setImageUrl] = useState(cell?.image_url ?? "");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [featureOnHomepage, setFeatureOnHomepage] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickImage = (): void => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { setErr("Image is larger than 10 MB."); return; }
      setUploadingImg(true); setErr(null);
      try {
        const sign = await OpsApi.signAdminImage("events");
        const { secure_url } = await uploadToCloudinary(sign, f);
        setImageUrl(secure_url);
      } catch (e) { setErr(errorMessage(e, "Image upload failed.")); }
      finally { setUploadingImg(false); }
    };
    input.click();
  };

  const submit = async (): Promise<void> => {
    if (!name.trim()) { setErr("Cell name is required."); return; }
    if (!discipler.trim()) { setErr("A discipler is required."); return; }
    setErr(null); setSaving(true);
    const body: CreateCellBody = {
      name: name.trim(), discipler_name: discipler.trim(), discipler_role: disciplerRole,
      level_label: level, tone,
      ...(focus.trim() ? { focus: focus.trim() } : {}),
      ...(meets.trim() ? { meets: meets.trim() } : {}),
      ...(room.trim() ? { room: room.trim() } : {}),
      ...(nextSession.trim() ? { next_session: nextSession.trim() } : {}),
      ...(imageUrl ? { image_url: imageUrl } : editing ? { image_url: null } : {}),
    };
    try {
      if (editing && cell) onUpdate?.(await AdminApi.updateCell(cell.cell_group_id, body));
      else onCreate?.(await AdminApi.createCell(body), featureOnHomepage);
    } catch (e) {
      setErr(errorMessage(e, editing ? "Could not update the cell." : "Could not register the cell."));
      setSaving(false);
    }
  };

  const withIcon = { ...fieldStyle, paddingLeft: 34 } as const;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="w-full rounded-2xl" style={{ maxWidth: 620, background: "#fff", maxHeight: "90vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3" style={{ padding: "20px 24px 0" }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)" }}><Users size={18} /></span>
            <div>
              <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{editing ? "Edit cell" : "Register a new cell"}</h3>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{editing ? "Update the discipler and how this cell meets." : "Assign a discipler and set how the cell meets."}</p>
            </div>
          </div>
          <button onClick={onClose} style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" style={{ padding: "20px 24px" }}>
          <Field label="Cell name *" icon={<Home size={14} />}><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lakeview Cell" style={withIcon} /></Field>
          <Field label="Discipler *" icon={<UserCheck size={14} />}><input value={discipler} onChange={(e) => setDiscipler(e.target.value)} placeholder="e.g. Mary Wanjiru" style={withIcon} /></Field>
          <Field label="Discipler role"><select value={disciplerRole} onChange={(e) => setDisciplerRole(e.target.value)} style={fieldStyle}>{ROLE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Curriculum level" icon={<GraduationCap size={14} />}><select value={level} onChange={(e) => setLevel(e.target.value)} style={withIcon}>{LEVEL_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></Field>
          <Field label="Focus" icon={<Target size={14} />}><input value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. New believers" style={withIcon} /></Field>
          <Field label="Meets" icon={<CalendarClock size={14} />}><input value={meets} onChange={(e) => setMeets(e.target.value)} placeholder="e.g. Tue · 6:30 PM" style={withIcon} /></Field>
          <Field label="Room / venue" icon={<MapPin size={14} />}><input value={room} onChange={(e) => setRoom(e.target.value)} placeholder="e.g. Hall B" style={withIcon} /></Field>
          <Field label="Next session" icon={<CalendarPlus size={14} />}><input value={nextSession} onChange={(e) => setNextSession(e.target.value)} placeholder="e.g. Tue, Jun 24 · 6:30 PM" style={withIcon} /></Field>
          <div className="sm:col-span-2">
            <label style={fieldLabel}>Cover image <span style={{ fontWeight: 400, color: "var(--muted-foreground)" }}>(shown on “This week at Nuru”)</span></label>
            <div className="flex items-center gap-3">
              <div className="rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ width: 96, height: 56, background: "var(--input-background)", border: "1px solid var(--border)" }}>
                {imageUrl ? <img src={imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <ImagePlus size={18} style={{ color: "var(--muted-foreground)" }} />}
              </div>
              <button type="button" onClick={pickImage} disabled={uploadingImg} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 38, background: "var(--input-background)", border: "1.5px solid var(--border)", fontSize: 12.5, fontWeight: 600, color: "var(--foreground)", opacity: uploadingImg ? 0.6 : 1 }}>{uploadingImg ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />} {imageUrl ? "Replace image" : "Upload image"}</button>
              {imageUrl ? <button type="button" onClick={() => setImageUrl("")} className="rounded-lg px-3" style={{ height: 38, background: "transparent", border: "1.5px solid var(--border)", fontSize: 12.5, fontWeight: 600, color: "#DC2626" }}>Remove</button> : null}
            </div>
          </div>
          <div className="sm:col-span-2">
            <label style={fieldLabel}>Card colour</label>
            <div className="flex items-center gap-2">
              {TONE_OPTIONS.map((t) => (
                <button key={t.key} type="button" onClick={() => setTone(t.key)} aria-label={t.key} className="rounded-lg" style={{ width: 34, height: 34, background: t.hex, border: tone === t.key ? "3px solid var(--nuru-navy)" : "3px solid transparent", outline: tone === t.key ? "1px solid var(--border)" : "none" }} />
              ))}
            </div>
          </div>
          {!editing && <div className="sm:col-span-2">
            <button
              type="button"
              role="switch"
              aria-checked={featureOnHomepage}
              onClick={() => setFeatureOnHomepage((v) => !v)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left"
              style={{ background: "var(--input-background)", border: "1.5px solid var(--border)" }}
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: featureOnHomepage ? "var(--nuru-gold)" : "rgba(0,0,0,0.05)", color: featureOnHomepage ? "#fff" : "var(--muted-foreground)" }}>
                <Star size={16} fill={featureOnHomepage ? "#fff" : "none"} />
              </span>
              <span className="flex-1">
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>Feature on homepage</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>Show this cell in “This week at Nuru” on members’ home screens.</span>
              </span>
              <span className="rounded-full" style={{ width: 40, height: 22, padding: 2, background: featureOnHomepage ? "var(--nuru-gold)" : "rgba(0,0,0,0.15)", transition: "background 0.15s" }}>
                <span style={{ display: "block", width: 18, height: 18, borderRadius: 9, background: "#fff", transform: featureOnHomepage ? "translateX(18px)" : "translateX(0)", transition: "transform 0.15s" }} />
              </span>
            </button>
          </div>}
        </div>

        {err && <div className="mx-6 rounded-md" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12, padding: "8px 10px", border: "1px solid #F5C6C2", marginBottom: 8 }}>{err}</div>}

        <div className="flex items-center justify-end gap-2" style={{ padding: "0 24px 22px" }}>
          <button onClick={onClose} className="rounded-lg px-4" style={{ height: 40, background: "var(--input-background)", border: "1.5px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Cancel</button>
          <button onClick={() => void submit()} disabled={saving} className="flex items-center gap-2 rounded-lg px-4" style={{ height: 40, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: saving ? 0.6 : 1 }}>{editing ? <Pencil size={14} /> : <Plus size={14} />} {saving ? (editing ? "Saving…" : "Registering…") : (editing ? "Save changes" : "Register cell")}</button>
        </div>
      </div>
    </div>
  );
}
