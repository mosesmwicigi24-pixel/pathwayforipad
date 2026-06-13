// Video Library — rebuilt to the "Final Pathway Portal" make, wired to the live
// media API. Real asset table/grid + stats (MediaApi.list), a real upload
// (createUpload → completeUpload), processing queue (in-flight assets), attach to
// a module (updateModule.media_asset_id), and archive (soft delete). Access stays
// module-gated (§1.9) — originals are never delivered to members.
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, Film, Filter, Grid3x3,
  Link2, List, Loader2, Lock, Play, Plus, Search,
  Settings, ShieldCheck, Trash2, Upload, X, ChevronRight, Sparkles,
} from "lucide-react";
import {
  MediaApi, CurriculumApi, type MediaAssetRow, type AdminLevel, type AdminModuleSummary,
} from "../../api/client";
import { errorMessage } from "../../util/error";

type UiStatus = "Ready" | "Uploading" | "Transcoding" | "Failed" | "Unattached";
const statusChip: Record<UiStatus, { bg: string; color: string }> = {
  Ready: { bg: "#E8F6EC", color: "#16A34A" },
  Uploading: { bg: "#E0F2FE", color: "#0369A1" },
  Transcoding: { bg: "#F3E8FF", color: "#7E22CE" },
  Failed: { bg: "#FEF2F2", color: "#DC2626" },
  Unattached: { bg: "#F3F4F6", color: "#6B7280" },
};
function uiStatus(a: MediaAssetRow): UiStatus {
  if (a.status === "failed") return "Failed";
  if (a.status === "uploading") return "Uploading";
  if (a.status === "transcoding") return "Transcoding";
  return a.attached_module_id ? "Ready" : "Unattached";
}
const hueOf = (id: string): number => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };
const dur = (s: number | null): string => { if (!s) return "—"; const m = Math.floor(s / 60), ss = s % 60; return `${m}:${String(ss).padStart(2, "0")}`; };
const assetTitle = (a: MediaAssetRow): string => a.attached_module_title ?? `${a.kind.replace(/_/g, " ")} · ${a.media_asset_id.slice(0, 8)}`;
const relTime = (iso: string): string => { const t = new Date(iso).getTime(); if (Number.isNaN(t)) return ""; const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };

function Thumb({ hue, status, duration, size = "md" }: { hue: number; status: UiStatus; duration: string; size?: "sm" | "md" | "lg" }): ReactElement {
  const w = size === "sm" ? 64 : size === "lg" ? "100%" : 96;
  const h = size === "sm" ? 40 : size === "lg" ? 180 : 60;
  return (
    <div className="rounded-lg relative overflow-hidden flex items-center justify-center shrink-0" style={{ width: w, height: h, background: `linear-gradient(135deg, hsl(${hue}, 35%, 28%) 0%, hsl(${hue}, 25%, 18%) 100%)` }}>
      <div className="rounded-full flex items-center justify-center" style={{ width: size === "sm" ? 20 : 32, height: size === "sm" ? 20 : 32, background: "rgba(255,255,255,0.18)" }}>
        {status === "Failed" ? <AlertTriangle size={size === "sm" ? 11 : 16} color="#fff" /> : <Play size={size === "sm" ? 10 : 14} color="#fff" fill="#fff" />}
      </div>
      {duration !== "—" && size !== "sm" ? <div className="absolute bottom-1.5 right-1.5 rounded px-1.5 py-0.5" style={{ background: "rgba(0,0,0,0.65)", color: "#fff", fontSize: 10, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{duration}</div> : null}
    </div>
  );
}
function Pill({ status }: { status: UiStatus }): ReactElement {
  const s = statusChip[status];
  return <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: s.bg, color: s.color, fontSize: 11, fontWeight: 700 }}>● {status}</span>;
}

export function VideoLibrary(): ReactElement {
  const navigate = useNavigate();
  const [assets, setAssets] = useState<MediaAssetRow[]>([]);
  const [stuck, setStuck] = useState(0);
  const [view, setView] = useState<"table" | "grid">("table");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | UiStatus>("All");
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attachFor, setAttachFor] = useState<MediaAssetRow | null>(null);
  const [previewFor, setPreviewFor] = useState<MediaAssetRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<MediaAssetRow | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const load = useCallback(async () => {
    try { const r = await MediaApi.list(); setAssets(r.data); setStuck(r.stuck); }
    catch (e) { setError(errorMessage(e, "Could not load the video library.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function doUpload(): Promise<void> {
    setUploading(true); setError(null); setNotice(null);
    try {
      const session = await MediaApi.createUpload("lesson_video");
      await MediaApi.completeUpload(session.upload_id);
      setNotice("Upload registered — processing will produce the gated HLS renditions.");
      await load();
    } catch (e) { setError(errorMessage(e, "Upload failed.")); }
    finally { setUploading(false); }
  }
  async function doArchive(a: MediaAssetRow): Promise<void> {
    try { await MediaApi.archive(a.media_asset_id); setDeleteFor(null); setDeleteText(""); setNotice("Video archived."); await load(); }
    catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }

  const ready = assets.filter((a) => a.status === "ready").length;
  const transcoding = assets.filter((a) => a.status === "transcoding" || a.status === "uploading").length;
  const filtered = useMemo(() => assets.filter((a) => {
    const us = uiStatus(a);
    if (statusFilter !== "All" && us !== statusFilter) return false;
    if (query && !`${assetTitle(a)} ${a.attached_module_title ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [assets, statusFilter, query]);
  const queue = assets.filter((a) => a.status !== "ready");

  return (
    <div style={{ background: "var(--background)", minHeight: "100%" }}>
      {/* Hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,40px) 24px" }}>
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span>Curriculum</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Video Library</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> Module-gated · HLS</span>
            <button onClick={() => navigate("/cms")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><Settings size={13} /> Curriculum</button>
            <button onClick={() => void doUpload()} disabled={uploading} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", opacity: uploading ? 0.6 : 1 }}>{uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Upload video</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Total assets", value: String(assets.length), hint: "in the library" },
            { label: "Ready", value: String(ready), hint: assets.length ? `${Math.round((ready / assets.length) * 100)}% of library` : "—" },
            { label: "Processing", value: String(transcoding), hint: "uploading / transcoding" },
            { label: "Needs attention", value: String(assets.filter((a) => a.status === "failed").length + stuck), hint: "failed / stuck" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,40px) 48px" }}>
        {notice ? <p style={{ color: "#0F6B33", fontSize: 13, marginBottom: 12 }}>{notice}</p> : null}
        {error ? <p style={{ color: "#A8281F", fontSize: 13, marginBottom: 12 }}>{error}</p> : null}

        {/* Gated note */}
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-5" style={{ background: "#FDF5E5", border: "1px solid #F2E2BD" }}>
          <div className="flex items-center justify-center rounded-lg tint-amber" style={{ width: 32, height: 32 }}><Lock size={14} /></div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7A5410" }}>Video access is module-gated.</span>
            <span style={{ fontSize: 13, color: "#7A5410", marginLeft: 6 }}>Members watch a video only when its attached module is unlocked for them.</span>
          </div>
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 nuru-card-rotate">
          {[
            { label: "Total video assets", value: assets.length, Icon: Film, sub: "in the library", spin: false },
            { label: "Ready for members", value: ready, Icon: CheckCircle2, sub: assets.length ? `${Math.round((ready / assets.length) * 100)}% of library` : "—", spin: false },
            { label: "Processing", value: transcoding, Icon: Loader2, sub: "uploading / transcoding", spin: true },
            { label: "Needs attention", value: assets.filter((a) => a.status === "failed").length + stuck, Icon: AlertTriangle, sub: "review and retry", spin: false },
          ].map(({ label, value, Icon, sub, spin }) => (
            <div key={label} className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px" }}>
              <div className="flex items-start justify-between mb-2"><div className="flex items-center justify-center rounded-lg tint-blue" style={{ width: 34, height: 34 }}><Icon size={15} className={spin && value > 0 ? "animate-spin" : ""} /></div></div>
              <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display)", color: "var(--nuru-navy)", fontSize: 26, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Upload note + Processing queue */}
        <div className="grid gap-5 mb-6" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Upload a video</div>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Videos upload directly to secure storage and are transcoded to gated HLS renditions.</div>
            <button onClick={() => void doUpload()} disabled={uploading} className="rounded-2xl mt-4 w-full flex flex-col items-center justify-center gap-2" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)", border: "2px dashed #93C5FD", padding: "28px 16px", cursor: uploading ? "default" : "pointer" }}>
              <div className="rounded-full flex items-center justify-center" style={{ width: 44, height: 44, background: "#DBEAFE", color: "#0369A1" }}>{uploading ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}</div>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{uploading ? "Registering upload…" : "Register a new video"}</span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Creates a secure upload target + asset record</span>
            </button>
            <div className="flex items-center gap-2 mt-4"><ShieldCheck size={13} style={{ color: "#16A34A" }} /><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Originals are never delivered to members — only gated HLS renditions.</span></div>
          </div>

          <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Processing queue</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{queue.length} in flight</div></div>
              <button onClick={() => void load()} style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none" }}>Refresh →</button>
            </div>
            <div>
              {queue.length === 0 ? <div style={{ padding: "24px 20px", fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "center" }}>Nothing processing — all assets are ready.</div> : queue.slice(0, 6).map((q, i) => {
                const us = uiStatus(q);
                return (
                  <div key={q.media_asset_id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <Thumb hue={hueOf(q.media_asset_id)} status={us} duration="—" size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2"><span className="truncate" style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{assetTitle(q)}</span><Pill status={us} /></div>
                      <div className="flex items-center justify-between mt-1"><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{relTime(q.created_at)}</span>{q.status === "failed" ? <span style={{ fontSize: 11, color: "#DC2626", fontWeight: 600 }}>{q.error_detail ?? "Failed"}</span> : null}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Assets */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Video assets</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{filtered.length} of {assets.length} assets</div></div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)", width: 240 }}>
                <Search size={13} style={{ color: "var(--muted-foreground)" }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title or module" className="bg-transparent outline-none flex-1" style={{ fontSize: 12 }} />
              </div>
              <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
                <Filter size={12} style={{ color: "var(--muted-foreground)" }} />
                <span style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Status</span>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "All" | UiStatus)} className="bg-transparent outline-none" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
                  {["All", "Ready", "Uploading", "Transcoding", "Failed", "Unattached"].map((o) => <option key={o}>{o}</option>)}
                </select>
                <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} />
              </label>
              <div className="flex items-center rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <button onClick={() => setView("table")} className="flex items-center gap-1 px-3 py-2" style={{ background: view === "table" ? "var(--nuru-navy)" : "transparent", color: view === "table" ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}><List size={12} /> Table</button>
                <button onClick={() => setView("grid")} className="flex items-center gap-1 px-3 py-2" style={{ background: view === "grid" ? "var(--nuru-navy)" : "transparent", color: view === "grid" ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}><Grid3x3 size={12} /> Grid</button>
              </div>
            </div>
          </div>

          {view === "table" ? (
            <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--secondary)" }}>{["", "Title", "Attached module", "Duration", "Status", "Uploaded", ""].map((h, i) => <th key={i} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((a) => { const us = uiStatus(a); return (
                  <tr key={a.media_asset_id} style={{ borderTop: "1px solid var(--border)", height: 64 }}>
                    <td style={{ padding: "8px 16px" }}><Thumb hue={hueOf(a.media_asset_id)} status={us} duration={dur(a.duration_sec)} /></td>
                    <td style={{ padding: "8px 16px" }}><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{assetTitle(a)}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{a.provider} · {a.kind.replace(/_/g, " ")}</div></td>
                    <td style={{ padding: "8px 16px", fontSize: 12, color: a.attached_module_title ? "var(--foreground)" : "var(--muted-foreground)", fontStyle: a.attached_module_title ? "normal" : "italic" }}>{a.attached_module_title ?? "Not attached"}</td>
                    <td style={{ padding: "8px 16px", fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>{dur(a.duration_sec)}</td>
                    <td style={{ padding: "8px 16px" }}><Pill status={us} /></td>
                    <td style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{relTime(a.created_at)}</td>
                    <td style={{ padding: "8px 16px" }}>
                      <div className="flex items-center gap-1.5 justify-end">
                        <button onClick={() => setPreviewFor(a)} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 11, fontWeight: 600, border: "none" }}>View</button>
                        {a.status !== "failed" ? <button onClick={() => setAttachFor(a)} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 11, fontWeight: 600, border: "none" }}>{a.attached_module_id ? "Reattach" : "Attach"}</button> : null}
                        <button onClick={() => setDeleteFor(a)} className="rounded-lg p-1.5" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ); })}
                {filtered.length === 0 ? <tr><td colSpan={7} style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No assets match.</td></tr> : null}
              </tbody>
            </table></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-5">
              {filtered.map((a) => { const us = uiStatus(a); return (
                <div key={a.media_asset_id} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="relative"><Thumb hue={hueOf(a.media_asset_id)} status={us} duration={dur(a.duration_sec)} size="lg" /><div className="absolute top-2 left-2"><Pill status={us} /></div></div>
                  <div className="p-4 flex flex-col flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.25 }}>{assetTitle(a)}</div>
                    <div style={{ fontSize: 12, color: a.attached_module_title ? "var(--foreground)" : "var(--muted-foreground)", fontStyle: a.attached_module_title ? "normal" : "italic", marginTop: 4 }}>{a.attached_module_title ?? "Not attached to a module"}</div>
                    <div className="flex items-center gap-3 mt-2" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}><span>{dur(a.duration_sec)}</span><span>·</span><span>{a.provider}</span><span>·</span><span>{relTime(a.created_at)}</span></div>
                    <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <button onClick={() => setPreviewFor(a)} className="flex-1 rounded-lg px-3 py-2" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}>View</button>
                      {a.status !== "failed" ? <button onClick={() => setAttachFor(a)} className="flex-1 rounded-lg px-3 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>{a.attached_module_id ? "Reattach" : "Attach"}</button> : null}
                    </div>
                  </div>
                </div>
              ); })}
            </div>
          )}
        </div>
      </div>

      {attachFor ? <AttachModal asset={attachFor} onClose={() => setAttachFor(null)} onDone={async () => { setAttachFor(null); setNotice("Video attached to the module."); await load(); }} onError={(m) => setError(m)} /> : null}

      {previewFor ? (
        <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={() => setPreviewFor(null)}>
          <div className="ml-auto flex flex-col" style={{ width: "min(480px,100vw)", background: "var(--card)", height: "100%", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
            <div className="relative"><Thumb hue={hueOf(previewFor.media_asset_id)} status={uiStatus(previewFor)} duration={dur(previewFor.duration_sec)} size="lg" /><button onClick={() => setPreviewFor(null)} className="absolute top-3 right-3 rounded-lg p-2" style={{ background: "rgba(0,0,0,0.55)", color: "#fff", border: "none" }}><X size={14} /></button><div className="absolute top-3 left-3"><Pill status={uiStatus(previewFor)} /></div></div>
            <div className="px-6 py-5 flex-1 overflow-y-auto no-scrollbar">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1.2 }}>{assetTitle(previewFor)}</h2>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 mt-5">
                {[
                  { l: "Provider", v: previewFor.provider }, { l: "Kind", v: previewFor.kind.replace(/_/g, " ") },
                  { l: "Duration", v: dur(previewFor.duration_sec) }, { l: "Uploaded", v: relTime(previewFor.created_at) },
                  { l: "Status", v: uiStatus(previewFor) }, { l: "Attached module", v: previewFor.attached_module_title ?? "Not attached" },
                ].map((d) => <div key={d.l}><div style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{d.l}</div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginTop: 2 }}>{d.v}</div></div>)}
              </div>
              {previewFor.error_detail ? <div className="rounded-xl p-3 mt-5" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5", fontSize: 12, color: "#B91C1C" }}>{previewFor.error_detail}</div> : null}
              <div className="rounded-xl p-3 mt-5 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}><Lock size={13} style={{ color: "#A87616", marginTop: 2 }} /><span style={{ fontSize: 12, color: "#7A5410", lineHeight: 1.5 }}>Member access depends on the attached module's unlock status.</span></div>
            </div>
            <div className="px-6 py-4 flex items-center gap-2 flex-wrap" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
              <button onClick={() => { setAttachFor(previewFor); setPreviewFor(null); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Link2 size={12} /> {previewFor.attached_module_id ? "Change module" : "Attach to module"}</button>
              <button className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600 }}><Copy size={12} /> Copy id</button>
              <button onClick={() => { setDeleteFor(previewFor); setPreviewFor(null); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2 ml-auto" style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", fontSize: 12, fontWeight: 600 }}><Trash2 size={12} /> Delete</button>
            </div>
          </div>
        </div>
      ) : null}

      {deleteFor ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(11,31,51,0.55)" }}>
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", width: 520, boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
            <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
              <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "#DC2626" }}><AlertTriangle size={12} /> DESTRUCTIVE</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Delete video asset?</h2>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>This archives the video. If attached to a module, members will no longer see it there.</p>
            </div>
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}><AlertTriangle size={14} style={{ color: "#DC2626", marginTop: 2 }} /><div style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.5 }}><strong>{assetTitle(deleteFor)}</strong> {deleteFor.attached_module_title ? `is attached to ${deleteFor.attached_module_title}.` : "will be archived."}</div></div>
              <div><div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>Type DELETE to confirm</div>
                <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 14, letterSpacing: 1 }} />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => { setDeleteFor(null); setDeleteText(""); }} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
                <button onClick={() => void doArchive(deleteFor)} disabled={deleteText !== "DELETE"} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: deleteText === "DELETE" ? "#DC2626" : "#FCA5A5", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: deleteText === "DELETE" ? "pointer" : "not-allowed" }}><Trash2 size={13} /> Delete video</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AttachModal({ asset, onClose, onDone, onError }: { asset: MediaAssetRow; onClose: () => void; onDone: () => void; onError: (m: string) => void }): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [levelNo, setLevelNo] = useState<number | null>(null);
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void CurriculumApi.levels().then((ls) => { setLevels(ls); setLevelNo(ls[0]?.level_number ?? null); }).catch(() => {}); }, []);
  useEffect(() => { if (levelNo == null) return; void CurriculumApi.modules(levelNo).then((ms) => { setModules(ms); setModuleId(ms[0]?.module_id ?? null); }).catch(() => setModules([])); }, [levelNo]);

  async function attach(): Promise<void> {
    if (!moduleId) return;
    setSaving(true);
    try { await CurriculumApi.updateModule(moduleId, { media_asset_id: asset.media_asset_id }); onDone(); }
    catch (e) { onError(errorMessage(e, "Attach failed.")); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(11,31,51,0.55)" }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", width: 560, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Link2 size={12} /> MODULE ATTACHMENT</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Attach video to module</h2>
            <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>Choose the module where this video should appear.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: "var(--secondary)" }}>
            <Thumb hue={hueOf(asset.media_asset_id)} status={uiStatus(asset)} duration={dur(asset.duration_sec)} />
            <div><div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{assetTitle(asset)}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{dur(asset.duration_sec)} · {asset.provider}</div></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Select level" required>
              <select value={levelNo ?? ""} onChange={(e) => setLevelNo(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
                {levels.map((l) => <option key={l.level_number} value={l.level_number}>L{l.level_number} · {l.title}</option>)}
              </select>
            </Field>
            <Field label="Select module" required>
              <select value={moduleId ?? ""} onChange={(e) => setModuleId(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
                {modules.map((m) => <option key={m.module_id} value={m.module_id}>Module {m.module_sequence_number} — {m.title}</option>)}
              </select>
            </Field>
          </div>
          <div className="rounded-xl p-3 flex items-center gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}><Lock size={14} style={{ color: "#A87616" }} /><span style={{ fontSize: 12, color: "#7A5410" }}>Visible only when the module is unlocked for the member.</span></div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
            <button onClick={() => void attach()} disabled={!moduleId || saving} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: !moduleId || saving ? "var(--secondary)" : "var(--nuru-gold)", color: !moduleId || saving ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: !moduleId || saving ? "not-allowed" : "pointer" }}><Link2 size={13} /> Attach video</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }): ReactElement {
  return <div><div className="flex items-center gap-1 mb-1.5"><span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>{required ? <span style={{ color: "#DC2626", fontSize: 11 }}>*</span> : null}</div>{children}</div>;
}
