// Video Library — rebuilt to the "Final Pathway Portal" make, wired to the live
// media API (PR #120). Real asset table/grid + the 4 summary counts (MediaApi.list
// with server-side Status/Source/Level/Attached + q filters), a hosted upload
// (createUpload → completeUpload) with a processing queue, a Register-external flow
// (POST /admin/media/external), caption/level edits (PATCH /admin/media/:id), the
// single mobile-app homepage welcome video (POST/DELETE …/homepage), attach to a
// module (CurriculumApi.updateModule media_asset_id) and archive (soft delete).
// Access stays module-gated (§1.9); external links are best-effort gated only.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink,
  Film, Filter, Grid3x3, Link2, List, Loader2, Lock, Play, Plus, RotateCcw, Search,
  Settings, ShieldCheck, Sparkles, Trash2, Tv, Upload, Video as VideoIcon, X,
} from "lucide-react";
import {
  MediaApi, CurriculumApi,
  type MediaAssetRow, type VideoSource, type AdminLevel, type AdminModuleSummary, type MediaListFilter, type CloudinaryUploadSignature,
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

type ProviderMeta = { label: string; bg: string; color: string };
const providerMeta: Record<VideoSource, ProviderMeta> = {
  cloudinary: { label: "Hosted", bg: "#EAF2FB", color: "#1F3A6B" },
  youtube: { label: "YouTube", bg: "#FDECEC", color: "#C4302B" },
  vimeo: { label: "Vimeo", bg: "#E6F4FB", color: "#1295C4" },
  direct: { label: "Link", bg: "#EEF1F8", color: "#1F3A6B" },
  private: { label: "Private", bg: "#E6F7EF", color: "#0F766E" },
};
// External (best-effort gated) vs hosted (true HLS gating).
const EXTERNAL: ReadonlySet<VideoSource> = new Set(["youtube", "vimeo", "direct", "private"]);
const isExternal = (s: VideoSource): boolean => EXTERNAL.has(s);

// Detect provider + id from a pasted URL (mirrors the server-side parser).
const PRIVATE_HOST = /(cloudflarestream\.com|videodelivery\.net|b-cdn\.net|mediadelivery\.net|stream\.mux\.com|\.m3u8)(\b|\/|$)/i;
function parseVideoUrl(raw: string): { provider: Exclude<VideoSource, "cloudinary">; videoId?: string; url: string } | null {
  const url = raw.trim();
  if (!url) return null;
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (yt?.[1]) return { provider: "youtube", videoId: yt[1], url };
  const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm?.[1]) return { provider: "vimeo", videoId: vm[1], url };
  if (PRIVATE_HOST.test(url)) return { provider: "private", url };
  if (/^https?:\/\/\S+/.test(url)) return { provider: "direct", url };
  return null;
}
const ytPoster = (id: string | null | undefined): string | undefined => (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined);

const hueOf = (id: string): number => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360; return h; };
const dur = (s: number | null): string => { if (!s) return "—"; const m = Math.floor(s / 60), ss = s % 60; return `${m}:${String(ss).padStart(2, "0")}`; };
const fmtBytes = (n: number): string => { if (!n) return "0 MB"; const gb = n / 1073741824; if (gb >= 1) return `${gb.toFixed(2)} GB`; const mb = n / 1048576; return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; };

// Cloudinary upload (signed). Large files go up in 6 MB chunks (single-request
// uploads cap out); each chunk reports byte progress. Returns the final JSON.
type CldResp = { secure_url?: string; error?: { message?: string } };
function postCloudinaryChunk(url: string, form: FormData, headers: Record<string, string>, onLoaded: (loaded: number) => void): Promise<{ status: number; json: CldResp }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) onLoaded(ev.loaded); };
    xhr.onload = () => { let json: CldResp = {}; try { json = JSON.parse(xhr.responseText) as CldResp; } catch { /* intermediate chunks return no body */ } resolve({ status: xhr.status, json }); };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(form);
  });
}
async function cloudinaryUpload(file: File, sign: CloudinaryUploadSignature, onProgress: (loaded: number) => void): Promise<CldResp> {
  const CHUNK = 6 * 1024 * 1024;
  const mkForm = (blob: Blob): FormData => {
    const f = new FormData();
    f.append("file", blob);
    f.append("api_key", sign.api_key);
    f.append("timestamp", String(sign.timestamp));
    f.append("folder", sign.folder);
    f.append("signature", sign.signature);
    return f;
  };
  if (file.size <= CHUNK) {
    const { json } = await postCloudinaryChunk(sign.upload_url, mkForm(file), {}, onProgress);
    return json;
  }
  const uploadId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1e9)}`).replace(/-/g, "");
  let start = 0;
  let last: { status: number; json: CldResp } = { status: 0, json: {} };
  while (start < file.size) {
    const end = Math.min(start + CHUNK, file.size);
    const base = start;
    last = await postCloudinaryChunk(
      sign.upload_url,
      mkForm(file.slice(start, end)),
      { "Content-Range": `bytes ${start}-${end - 1}/${file.size}`, "X-Unique-Upload-Id": uploadId },
      (loaded) => onProgress(base + loaded),
    );
    start = end;
  }
  return last.json;
}
// Compress on delivery: members stream an auto-quality, ≤1280px-wide rendition
// (Cloudinary derives + caches it) while the original stays in the library.
const compressedVideoUrl = (secureUrl: string): string =>
  secureUrl.includes("/video/upload/") ? secureUrl.replace("/video/upload/", "/video/upload/q_auto,w_1280/") : secureUrl;
function assetTitle(a: MediaAssetRow): string {
  if (a.attached_module_title) return a.attached_module_title;
  if (a.caption) return a.caption;
  return `${a.kind.replace(/_/g, " ")} · ${a.media_asset_id.slice(0, 8)}`;
}
const relTime = (iso: string): string => { const t = new Date(iso).getTime(); if (Number.isNaN(t)) return ""; const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : `${d} days ago`; };
const posterOf = (a: MediaAssetRow): string | undefined => (a.video_source === "youtube" ? ytPoster(a.external_video_id) : undefined);

function ProviderBadge({ source }: { source: VideoSource }): ReactElement {
  const m = providerMeta[source];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: m.bg, color: m.color, fontSize: 10.5, fontWeight: 700 }}>
      {source === "youtube" ? <Tv size={11} /> : source === "private" ? <ShieldCheck size={10} /> : source === "cloudinary" ? <Film size={10} /> : <Link2 size={10} />} {m.label}
    </span>
  );
}

function Thumb({ hue, status, duration, size = "md", poster }: { hue: number; status: UiStatus; duration: string; size?: "sm" | "md" | "lg"; poster?: string | undefined }): ReactElement {
  const w = size === "sm" ? 64 : size === "lg" ? "100%" : 96;
  const h = size === "sm" ? 40 : size === "lg" ? 180 : 60;
  return (
    <div className="rounded-lg relative overflow-hidden flex items-center justify-center shrink-0" style={{ width: w, height: h, background: `linear-gradient(135deg, hsl(${hue}, 35%, 28%) 0%, hsl(${hue}, 25%, 18%) 100%)` }}>
      {poster && status !== "Failed" ? <img src={poster} alt="" loading="lazy" className="absolute inset-0 w-full h-full" style={{ objectFit: "cover" }} /> : null}
      <div className="rounded-full flex items-center justify-center relative" style={{ width: size === "sm" ? 20 : 32, height: size === "sm" ? 20 : 32, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(8px)" }}>
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
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<"table" | "grid">("table");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All" | UiStatus>("All");
  const [sourceFilter, setSourceFilter] = useState<"All" | VideoSource>("All");
  const [levelFilter, setLevelFilter] = useState<"All" | "1" | "2" | "3" | "4" | "5" | "6">("All");
  const [attachedFilter, setAttachedFilter] = useState<"All" | "Attached" | "Unattached">("All");

  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [attachFor, setAttachFor] = useState<MediaAssetRow | null>(null);
  const [previewFor, setPreviewFor] = useState<MediaAssetRow | null>(null);
  const [deleteFor, setDeleteFor] = useState<MediaAssetRow | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const linkInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLoaded, setUploadLoaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadStage, setUploadStage] = useState<"" | "uploading" | "finalizing" | "done">("");

  // Server-side filters: status maps to the server's lifecycle status; the UI
  // "Unattached"/"Ready" are derived locally and applied on top of the fetch.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const f: MediaListFilter = {};
      if (statusFilter === "Uploading") f.status = "uploading";
      else if (statusFilter === "Transcoding") f.status = "transcoding";
      else if (statusFilter === "Failed") f.status = "failed";
      else if (statusFilter === "Ready") f.status = "ready";
      if (sourceFilter !== "All") f.video_source = sourceFilter;
      if (levelFilter !== "All") f.level = Number(levelFilter);
      if (attachedFilter !== "All") f.attached = attachedFilter === "Attached";
      const q = query.trim();
      if (q) f.q = q;
      const r = await MediaApi.list(f);
      setAssets(r.data);
      setStuck(r.stuck);
      setError(null);
    } catch (e) { setError(errorMessage(e, "Could not load the video library.")); }
    finally { setLoading(false); }
  }, [statusFilter, sourceFilter, levelFilter, attachedFilter, query]);
  useEffect(() => { const t = setTimeout(() => void load(), query ? 250 : 0); return () => clearTimeout(t); }, [load, query]);

  // Open the OS file picker. The actual upload runs in onFilePicked → uploadFile.
  function openFilePicker(): void {
    if (uploading) return;
    setError(null); setNotice(null);
    fileInputRef.current?.click();
  }
  async function onFilePicked(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (file) await uploadFile(file);
  }
  // Real upload: file → Cloudinary (signed, direct) → register as a 'direct' video.
  // Uses XHR so we can report live upload progress (fetch can't).
  async function uploadFile(file: File): Promise<void> {
    if (!file.type.startsWith("video/")) { setError("Please choose a video file."); return; }
    if (file.size > 2 * 1024 * 1024 * 1024) { setError("Video is larger than 2 GB. Please use a smaller file or paste an external link."); return; }
    setUploading(true); setUploadName(file.name); setError(null); setNotice(null);
    setUploadStage("uploading"); setUploadPct(0); setUploadLoaded(0); setUploadTotal(file.size);
    try {
      const sign = await MediaApi.signUpload("videos");
      // Chunked (6 MB) upload for large files; live byte progress.
      const out = await cloudinaryUpload(file, sign, (loaded) => {
        setUploadLoaded(loaded); setUploadPct(Math.round((loaded / file.size) * 100));
      });
      if (!out.secure_url) throw new Error(out.error?.message ?? "Cloudinary upload failed");
      setUploadPct(100); setUploadStage("finalizing");
      const title = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Uploaded video";
      // Store the compressed (auto-quality, ≤1280px) delivery URL — members stream
      // a light version; the original stays in your Cloudinary library.
      await MediaApi.registerExternal({ video_source: "direct", url: compressedVideoUrl(out.secure_url), title });
      setUploadStage("done");
      setNotice(`✓ Uploaded "${title}" (${fmtBytes(file.size)}) — now listed below, ready to attach.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
      setUploadStage("");
    } finally {
      setUploading(false); setUploadName(null);
      setTimeout(() => setUploadStage(""), 4000);
    }
  }
  async function doArchive(a: MediaAssetRow): Promise<void> {
    try { await MediaApi.archive(a.media_asset_id); setDeleteFor(null); setDeleteText(""); setNotice("Video archived."); await load(); }
    catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }
  async function toggleHomepage(a: MediaAssetRow): Promise<void> {
    setError(null);
    try {
      if (a.is_homepage) { await MediaApi.clearHomepage(a.media_asset_id); setNotice("Removed from the homepage."); }
      else { await MediaApi.setHomepage(a.media_asset_id); setNotice(`"${assetTitle(a)}" is now the single mobile-app welcome video.`); }
      await load();
      // Reflect the change in the open drawer without losing it.
      setPreviewFor((p) => (p && p.media_asset_id === a.media_asset_id ? { ...p, is_homepage: !a.is_homepage } : p));
    } catch (e) { setError(errorMessage(e, "Could not update the homepage video.")); }
  }
  async function saveMeta(a: MediaAssetRow, input: { caption?: string; level_number?: number | null }): Promise<void> {
    setError(null);
    try { await MediaApi.patchAsset(a.media_asset_id, input); setNotice("Saved."); await load(); }
    catch (e) { setError(errorMessage(e, "Could not save changes.")); }
  }

  // The 4 summary counts come straight from the (filtered) list payload.
  const total = assets.length;
  const ready = assets.filter((a) => a.status === "ready").length;
  const processing = assets.filter((a) => a.status === "transcoding" || a.status === "uploading").length;
  const failed = assets.filter((a) => a.status === "failed").length;

  // Local refinement only for the derived Ready/Unattached UI states; the server
  // already applied source/level/attached/q + lifecycle status.
  const filtered = useMemo(() => assets.filter((a) => {
    if (statusFilter === "Ready" && uiStatus(a) !== "Ready") return false;
    if (statusFilter === "Unattached" && uiStatus(a) !== "Unattached") return false;
    return true;
  }), [assets, statusFilter]);
  const queue = assets.filter((a) => a.status !== "ready");

  const refreshAfter = async (msg: string): Promise<void> => { setNotice(msg); await load(); };

  return (
    <div style={{ background: "var(--background)", minHeight: "100%" }}>
      {/* ────── HERO ────── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,40px) 24px" }}>
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span>Curriculum</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Video Library</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> 720p max delivery</span>
            <button onClick={() => navigate("/cms")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><Settings size={13} /> Curriculum</button>
            <button onClick={() => { linkInputRef.current?.focus(); linkInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><Link2 size={13} /> Register external</button>
            <button onClick={openFilePicker} disabled={uploading} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", opacity: uploading ? 0.6 : 1 }}>{uploading ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Upload video</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Total assets", value: String(total), hint: "in the library" },
            { label: "Ready", value: String(ready), hint: total ? `${Math.round((ready / total) * 100)}% of library` : "—" },
            { label: "Processing", value: String(processing), hint: "uploading / transcoding" },
            { label: "Failed", value: String(failed + stuck), hint: "failed / stuck" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ────── BODY ────── */}
      <div style={{ padding: "24px clamp(16px,4vw,40px) 48px" }}>
        {notice ? <p style={{ color: "#0F6B33", fontSize: 13, marginBottom: 12 }}>{notice}</p> : null}
        {error ? <p style={{ color: "#A8281F", fontSize: 13, marginBottom: 12 }}>{error}</p> : null}

        {/* Gold gated note */}
        <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-5" style={{ background: "#FDF5E5", border: "1px solid #F2E2BD" }}>
          <div className="flex items-center justify-center rounded-lg tint-amber" style={{ width: 32, height: 32 }}><Lock size={14} /></div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#7A5410" }}>Video access is module-gated.</span>
            <span style={{ fontSize: 13, color: "#7A5410", marginLeft: 6 }}>Members watch a video only when its attached module is unlocked for them.</span>
          </div>
        </div>

        {/* 4 KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 nuru-card-rotate">
          {[
            { label: "Total video assets", value: total, Icon: Film, sub: "in the library", spin: false },
            { label: "Ready for members", value: ready, Icon: CheckCircle2, sub: total ? `${Math.round((ready / total) * 100)}% of library` : "—", spin: false },
            { label: "Processing", value: processing, Icon: Loader2, sub: "uploading / transcoding", spin: true },
            { label: "Failed", value: failed + stuck, Icon: AlertTriangle, sub: "review and retry", spin: false },
          ].map(({ label, value, Icon, sub, spin }) => (
            <div key={label} className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px" }}>
              <div className="flex items-start justify-between mb-2"><div className="flex items-center justify-center rounded-lg tint-blue" style={{ width: 34, height: 34 }}><Icon size={15} className={spin && value > 0 ? "animate-spin" : ""} /></div></div>
              <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display)", color: "var(--nuru-navy)", fontSize: 26, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Upload panel + Register-external + Processing queue */}
        <div className="grid gap-5 mb-6" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <div className="flex flex-col gap-5">
            {/* Hosted upload */}
            <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Upload a video</div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>Choose a video — large files upload in chunks and are auto-compressed for members (the original stays in your library).</div>
              <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={(e) => void onFilePicked(e)} />
              {uploadStage ? (
                <div className="rounded-2xl mt-4 w-full" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)", border: "2px dashed #93C5FD", padding: "18px 18px" }}>
                  <div className="flex items-center gap-3">
                    <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: uploadStage === "done" ? "#DCFCE7" : "#DBEAFE", color: uploadStage === "done" ? "#16A34A" : "#0369A1" }}>
                      {uploadStage === "done" ? <CheckCircle2 size={20} /> : <Loader2 size={20} className="animate-spin" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{uploadName ?? "Video"}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>
                        {uploadStage === "uploading" ? `Uploading… ${fmtBytes(uploadLoaded)} / ${fmtBytes(uploadTotal)}` : uploadStage === "finalizing" ? "Finalizing — registering in the library…" : "Upload complete — listed below"}
                      </div>
                    </div>
                    <span className="shrink-0" style={{ fontSize: 15, fontWeight: 800, color: uploadStage === "done" ? "#16A34A" : "var(--nuru-navy)" }}>{uploadStage === "done" ? "100%" : `${uploadPct}%`}</span>
                  </div>
                  <div className="mt-3" style={{ height: 8, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${uploadStage === "done" ? 100 : uploadPct}%`, background: uploadStage === "done" ? "#16A34A" : "var(--nuru-gold)", borderRadius: 99, transition: "width .2s ease" }} />
                  </div>
                </div>
              ) : (
                <button onClick={openFilePicker} className="rounded-2xl mt-4 w-full flex flex-col items-center justify-center gap-2" style={{ background: "linear-gradient(180deg, #F8FAFC 0%, #EFF6FF 100%)", border: "2px dashed #93C5FD", padding: "26px 16px", cursor: "pointer" }}>
                  <div className="rounded-full flex items-center justify-center" style={{ width: 44, height: 44, background: "#DBEAFE", color: "#0369A1" }}><Upload size={20} /></div>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Choose a video to upload</span>
                  <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Click to browse — MP4, MOV, WebM · large files OK (auto-compressed)</span>
                </button>
              )}
              <div className="flex items-center gap-2 mt-4"><ShieldCheck size={13} style={{ color: "#16A34A" }} /><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Stored securely in your media library and attachable to any module.</span></div>
            </div>

            {/* Register external video */}
            <RegisterExternalPanel inputRef={linkInputRef} onDone={refreshAfter} onError={setError} />
          </div>

          {/* Processing queue */}
          <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
              <div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Processing queue</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{queue.length} in flight</div></div>
              <button onClick={() => void load()} style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}>Refresh →</button>
            </div>
            <div className="flex-1">
              {queue.length === 0 ? <div style={{ padding: "24px 20px", fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "center" }}>Nothing processing — all assets are ready.</div> : queue.slice(0, 6).map((q, i) => {
                const us = uiStatus(q);
                return (
                  <div key={q.media_asset_id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <Thumb hue={hueOf(q.media_asset_id)} status={us} duration="—" size="sm" poster={posterOf(q)} />
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

        {/* Video Assets library */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: "1px solid var(--border)" }}>
            <div><div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Video Assets</div><div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{loading ? "Loading…" : `${filtered.length} of ${total} assets`}</div></div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)", width: 240 }}>
                <Search size={13} style={{ color: "var(--muted-foreground)" }} />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search title, module, or caption" className="bg-transparent outline-none flex-1" style={{ fontSize: 12 }} />
              </div>
              <SelectFilter label="Status" value={statusFilter} onChange={(v) => setStatusFilter(v as "All" | UiStatus)} options={["All", "Ready", "Uploading", "Transcoding", "Failed", "Unattached"]} icon={<Filter size={12} />} />
              <SelectFilter label="Source" value={sourceFilter} onChange={(v) => setSourceFilter(v as "All" | VideoSource)} options={["All", "cloudinary", "youtube", "vimeo", "direct", "private"]} />
              <SelectFilter label="Level" value={levelFilter} onChange={(v) => setLevelFilter(v as typeof levelFilter)} options={["All", "1", "2", "3", "4", "5", "6"]} />
              <SelectFilter label="Attached" value={attachedFilter} onChange={(v) => setAttachedFilter(v as typeof attachedFilter)} options={["All", "Attached", "Unattached"]} />
              <div className="flex items-center rounded-xl overflow-hidden" style={{ border: "1px solid var(--border)" }}>
                <button onClick={() => setView("table")} className="flex items-center gap-1 px-3 py-2" style={{ background: view === "table" ? "var(--nuru-navy)" : "transparent", color: view === "table" ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}><List size={12} /> Table</button>
                <button onClick={() => setView("grid")} className="flex items-center gap-1 px-3 py-2" style={{ background: view === "grid" ? "var(--nuru-navy)" : "transparent", color: view === "grid" ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}><Grid3x3 size={12} /> Grid</button>
              </div>
            </div>
          </div>

          {view === "table" ? (
            <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--secondary)" }}>{["", "Title", "Attached module", "Level", "Duration", "Status", "Updated", ""].map((h, i) => <th key={i} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {filtered.map((a) => { const us = uiStatus(a); return (
                  <tr key={a.media_asset_id} style={{ borderTop: "1px solid var(--border)", height: 64 }} className="hover:bg-secondary/40 transition-colors">
                    <td style={{ padding: "8px 16px" }}><Thumb hue={hueOf(a.media_asset_id)} status={us} duration={dur(a.duration_sec)} poster={posterOf(a)} /></td>
                    <td style={{ padding: "8px 16px" }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{assetTitle(a)}</span>
                        <ProviderBadge source={a.video_source} />
                        {a.is_homepage ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(200,155,60,0.16)", color: "#8B6914", fontSize: 10, fontWeight: 700 }}><Sparkles size={10} /> Homepage</span> : null}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{a.kind.replace(/_/g, " ")}</div>
                    </td>
                    <td style={{ padding: "8px 16px", fontSize: 12, color: a.attached_module_title ? "var(--foreground)" : "var(--muted-foreground)", fontStyle: a.attached_module_title ? "normal" : "italic" }}>{a.attached_module_title ?? "Not attached"}</td>
                    <td style={{ padding: "8px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{a.level_number ? `Level ${a.level_number}` : "—"}</td>
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
                {!loading && filtered.length === 0 ? <tr><td colSpan={8} style={{ padding: "28px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No assets match.</td></tr> : null}
              </tbody>
            </table></div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-5">
              {filtered.map((a) => { const us = uiStatus(a); return (
                <div key={a.media_asset_id} className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                  <div className="relative">
                    <Thumb hue={hueOf(a.media_asset_id)} status={us} duration={dur(a.duration_sec)} size="lg" poster={posterOf(a)} />
                    <div className="absolute top-2 left-2"><Pill status={us} /></div>
                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                      {a.is_homepage ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(200,155,60,0.95)", color: "#fff", fontSize: 10, fontWeight: 700 }}><Sparkles size={10} /> Homepage</span> : null}
                      <ProviderBadge source={a.video_source} />
                    </div>
                  </div>
                  <div className="p-4 flex flex-col flex-1">
                    <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)", lineHeight: 1.25 }}>{assetTitle(a)}</div>
                    <div style={{ fontSize: 12, color: a.attached_module_title ? "var(--foreground)" : "var(--muted-foreground)", fontStyle: a.attached_module_title ? "normal" : "italic", marginTop: 4 }}>{a.attached_module_title ?? "Not attached to a module"}</div>
                    <div className="flex items-center gap-3 mt-2" style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}><span>{dur(a.duration_sec)}</span><span>·</span><span>{providerMeta[a.video_source].label}</span><span>·</span><span>{relTime(a.created_at)}</span></div>
                    <div className="mt-3">
                      {us === "Ready" ? <CompletionBar value={a.completion ?? 0} views={a.views ?? 0} /> : <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted-foreground)" }}>{us === "Failed" ? "Re-link to track engagement" : "Not released to members yet"}</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
                      <button onClick={() => setPreviewFor(a)} className="flex-1 rounded-lg px-3 py-2" style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}>View</button>
                      {a.status !== "failed" ? <button onClick={() => setAttachFor(a)} className="flex-1 rounded-lg px-3 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>{a.attached_module_id ? "Reattach" : "Attach"}</button> : null}
                    </div>
                  </div>
                </div>
              ); })}
              {!loading && filtered.length === 0 ? <div style={{ gridColumn: "1 / -1", padding: "28px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No assets match.</div> : null}
            </div>
          )}
        </div>
      </div>

      {attachFor ? <AttachModal asset={attachFor} onClose={() => setAttachFor(null)} onDone={async () => { setAttachFor(null); await refreshAfter("Video attached to the module."); }} onError={setError} /> : null}

      {previewFor ? (
        <PreviewDrawer
          asset={previewFor}
          onClose={() => setPreviewFor(null)}
          onAttach={() => { setAttachFor(previewFor); setPreviewFor(null); }}
          onReplace={() => { setAttachFor(previewFor); setPreviewFor(null); }}
          onDelete={() => { setDeleteFor(previewFor); setPreviewFor(null); }}
          onToggleHomepage={() => void toggleHomepage(previewFor)}
          onSaveMeta={(input) => void saveMeta(previewFor, input)}
        />
      ) : null}

      {deleteFor ? (
        <Modal onClose={() => { setDeleteFor(null); setDeleteText(""); }} title="Delete video asset?" subtitle="This archives the video. If attached to a module, members will no longer see it there." tone="danger">
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "#FEF2F2", border: "1px solid #FCA5A5" }}><AlertTriangle size={14} style={{ color: "#DC2626", marginTop: 2 }} /><div style={{ fontSize: 12, color: "#B91C1C", lineHeight: 1.5 }}><strong>{assetTitle(deleteFor)}</strong> {deleteFor.attached_module_title ? `is attached to ${deleteFor.attached_module_title}.` : "will be archived."}</div></div>
          <Field label="Type DELETE to confirm" required>
            <input value={deleteText} onChange={(e) => setDeleteText(e.target.value)} placeholder="DELETE" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 14, letterSpacing: 1 }} />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button onClick={() => { setDeleteFor(null); setDeleteText(""); }} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button>
            <button onClick={() => void doArchive(deleteFor)} disabled={deleteText !== "DELETE"} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: deleteText === "DELETE" ? "#DC2626" : "#FCA5A5", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: deleteText === "DELETE" ? "pointer" : "not-allowed" }}><Trash2 size={13} /> Delete video</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/* ───────────────────────── Register external video ───────────────────────── */
function RegisterExternalPanel({ inputRef, onDone, onError }: { inputRef: RefObject<HTMLInputElement>; onDone: (msg: string) => Promise<void>; onError: (m: string) => void }): ReactElement {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [level, setLevel] = useState<string>("");
  const [markPrivate, setMarkPrivate] = useState(false);
  const [saving, setSaving] = useState(false);
  const parsed = parseVideoUrl(url);
  const source = parsed ? (parsed.provider === "direct" && markPrivate ? "private" : parsed.provider) : null;

  async function register(): Promise<void> {
    if (!parsed || !source) return;
    setSaving(true);
    try {
      await MediaApi.registerExternal({
        video_source: source,
        url: parsed.url,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(caption.trim() ? { caption: caption.trim() } : {}),
        ...(level ? { level_number: Number(level) } : {}),
      });
      setUrl(""); setTitle(""); setCaption(""); setLevel(""); setMarkPrivate(false);
      await onDone("External video registered.");
    } catch (e) { onError(errorMessage(e, "Could not register the external video.")); }
    finally { setSaving(false); }
  }

  return (
    <div className="rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Register an external video</div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>Paste a YouTube, Vimeo, direct or private (signed) URL — no transcode, ready instantly.</div>
        </div>
        <Link2 size={16} style={{ color: "var(--nuru-gold)" }} />
      </div>

      <div className="rounded-2xl p-5" style={{ background: "linear-gradient(180deg, #FBFCFE 0%, #F5F8FC 100%)", border: "2px dashed #CBD5E1" }}>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 mb-3" style={{ background: "#fff", border: "1px solid var(--border)" }}>
          <Link2 size={15} style={{ color: "var(--muted-foreground)" }} />
          <input ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://youtu.be/…  ·  vimeo.com/…  ·  Cloudflare/Bunny/Mux URL" className="bg-transparent outline-none flex-1" style={{ fontSize: 13 }} />
          {source ? <ProviderBadge source={source} /> : null}
        </div>

        {parsed && source ? (
          <div className="flex items-start gap-4">
            <Thumb hue={210} status="Unattached" duration="—" poster={source === "youtube" ? ytPoster(parsed.videoId) : undefined} />
            <div className="flex-1 min-w-0">
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Video title (e.g. Introduction to Discipleship)" className="w-full rounded-lg px-3 py-2 outline-none mb-2" style={{ background: "#fff", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }} />
              <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption — a short line shown with the video" className="w-full rounded-lg px-3 py-2 outline-none mb-2" style={{ background: "#fff", border: "1px solid var(--border)", fontSize: 12.5 }} />
              <div className="flex items-center gap-2 mb-2">
                <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Level</span>
                <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg px-2 py-1.5 outline-none" style={{ background: "#fff", border: "1px solid var(--border)", fontSize: 12.5 }}>
                  <option value="">None</option>
                  {["1", "2", "3", "4", "5", "6"].map((n) => <option key={n} value={n}>Level {n}</option>)}
                </select>
              </div>
              {parsed.provider === "direct" ? (
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input type="checkbox" checked={markPrivate} onChange={(e) => setMarkPrivate(e.target.checked)} style={{ accentColor: "#0F766E" }} />
                  <span className="flex items-center gap-1" style={{ fontSize: 11.5, color: "var(--foreground)" }}><ShieldCheck size={12} style={{ color: "#0F766E" }} /> Private — deliver via signed, expiring URL</span>
                </label>
              ) : null}
              <div className="flex items-center gap-2">
                <button onClick={() => void register()} disabled={saving} className="flex items-center gap-1.5 rounded-lg px-3 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none", opacity: saving ? 0.6 : 1 }}>{saving ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Register video</button>
                <button onClick={() => { setUrl(""); setTitle(""); setCaption(""); setLevel(""); setMarkPrivate(false); }} className="rounded-lg px-3 py-2" style={{ background: "#fff", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600 }}>Clear</button>
              </div>
              {source !== "private" ? (
                <div className="flex items-start gap-1.5 mt-2" style={{ fontSize: 11, color: "#7A5410", lineHeight: 1.5 }}>
                  <AlertTriangle size={12} style={{ marginTop: 1, flexShrink: 0 }} /> External links are best-effort gated, not hard-gated — choose Private (signed) for true gating.
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 py-2" style={{ color: "var(--muted-foreground)" }}>
            <VideoIcon size={16} />
            <span style={{ fontSize: 12.5 }}>{url ? "That doesn't look like a video URL yet." : "Paste a link above. We auto-detect the host (YouTube, Vimeo, direct, private)."}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Attach modal ───────────────────────────── */
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
    <Modal onClose={onClose} title="Attach video to module" subtitle="Choose the curriculum module where this video should appear.">
      <div className="rounded-xl p-3 flex items-center gap-3" style={{ background: "var(--secondary)" }}>
        <Thumb hue={hueOf(asset.media_asset_id)} status={uiStatus(asset)} duration={dur(asset.duration_sec)} poster={posterOf(asset)} />
        <div style={{ minWidth: 0 }}>
          <div className="flex items-center gap-2"><span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{assetTitle(asset)}</span><ProviderBadge source={asset.video_source} /></div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{dur(asset.duration_sec)} · {providerMeta[asset.video_source].label}</div>
        </div>
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
    </Modal>
  );
}

/* ───────────────────────────── Preview drawer ───────────────────────────── */
function PreviewDrawer({ asset, onClose, onAttach, onReplace, onDelete, onToggleHomepage, onSaveMeta }: {
  asset: MediaAssetRow; onClose: () => void; onAttach: () => void; onReplace: () => void; onDelete: () => void;
  onToggleHomepage: () => void; onSaveMeta: (input: { caption?: string; level_number?: number | null }) => void;
}): ReactElement {
  const us = uiStatus(asset);
  const [caption, setCaption] = useState(asset.caption ?? "");
  const [level, setLevel] = useState<string>(asset.level_number ? String(asset.level_number) : "");
  const captionDirty = caption.trim() !== (asset.caption ?? "");
  const levelDirty = (level ? Number(level) : null) !== (asset.level_number ?? null);

  return (
    <Drawer onClose={onClose}>
      <div className="relative" style={{ background: "#000" }}>
        <NuruPlayer asset={asset} />
        <button onClick={onClose} className="absolute top-2.5 right-3 rounded-lg p-2 z-10" style={{ background: "rgba(0,0,0,0.55)", color: "#fff", border: "none" }}><X size={14} /></button>
      </div>
      <div className="px-6 pt-3 flex items-center gap-1.5 flex-wrap">
        <Pill status={us} />
        <ProviderBadge source={asset.video_source} />
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "#EEF1F8", color: "#1F3A6B", fontSize: 10.5, fontWeight: 700 }}><Lock size={10} /> Contained · no click-out</span>
        {asset.is_homepage ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(200,155,60,0.16)", color: "#8B6914", fontSize: 10.5, fontWeight: 700 }}><Sparkles size={10} /> Homepage welcome video</span> : null}
      </div>

      <div className="px-6 py-5 flex-1 overflow-y-auto">
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1.2 }}>{assetTitle(asset)}</h2>
        <div className="flex items-center gap-3 mt-2" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)" }}>
          <span>{dur(asset.duration_sec)}</span><span>·</span><span>{providerMeta[asset.video_source].label}</span><span>·</span><span>{us}</span>
        </div>

        <div className="grid grid-cols-2 gap-x-5 gap-y-3 mt-5">
          {[
            { l: "Kind", v: asset.kind.replace(/_/g, " ") },
            { l: "Uploaded", v: relTime(asset.created_at) },
            { l: "Source", v: providerMeta[asset.video_source].label },
            { l: "Delivery", v: us === "Failed" ? "Link broken" : isExternal(asset.video_source) ? (asset.video_source === "private" ? "Signed · expiring" : `${providerMeta[asset.video_source].label} embed`) : "Gated HLS" },
            { l: "Attached module", v: asset.attached_module_title ?? "Not attached" },
            { l: "Level", v: asset.level_number ? `Level ${asset.level_number}` : "—" },
          ].map((d) => <div key={d.l}><div style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{d.l}</div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginTop: 2 }}>{d.v}</div></div>)}
        </div>

        {asset.external_url ? (
          <div className="rounded-xl p-2.5 mt-4 flex items-center gap-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
            <Link2 size={13} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <span className="truncate" style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-foreground)" }}>{asset.external_url}</span>
            <button onClick={() => { void navigator.clipboard?.writeText(asset.external_url ?? ""); }} className="flex items-center gap-1 rounded-md px-2 py-1 shrink-0" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700, border: "none" }}><Copy size={11} /> Copy</button>
          </div>
        ) : null}

        {/* Caption + level editing (PATCH) */}
        <div className="rounded-xl p-4 mt-4" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Edit metadata</div>
          <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption — a short line shown with the video" className="w-full rounded-lg px-3 py-2 outline-none mb-2" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12.5 }} />
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Level</span>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg px-2 py-1.5 outline-none" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12.5 }}>
              <option value="">None</option>
              {["1", "2", "3", "4", "5", "6"].map((n) => <option key={n} value={n}>Level {n}</option>)}
            </select>
          </div>
          <button
            onClick={() => onSaveMeta({ caption: caption.trim(), level_number: level ? Number(level) : null })}
            disabled={!captionDirty && !levelDirty}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2"
            style={{ background: captionDirty || levelDirty ? "var(--nuru-navy)" : "var(--secondary)", color: captionDirty || levelDirty ? "#fff" : "var(--muted-foreground)", fontSize: 12, fontWeight: 700, border: "none", cursor: captionDirty || levelDirty ? "pointer" : "not-allowed" }}
          ><Check size={12} /> Save changes</button>
        </div>

        {/* Engagement */}
        <div className="rounded-xl p-4 mt-4" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-2">
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>Member engagement</span>
            <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{asset.views ?? 0} views</span>
          </div>
          <CompletionBar value={asset.completion ?? 0} views={asset.views ?? 0} hideViews />
          <div className="flex items-center gap-2 mt-3" style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            <CheckCircle2 size={12} style={{ color: "#16A34A", flexShrink: 0 }} />
            <span>Marked <strong style={{ color: "var(--foreground)" }}>watched</strong> at 90% played — synced to each member's progress.</span>
          </div>
        </div>

        {/* Gating note */}
        {isExternal(asset.video_source) && asset.video_source !== "private" ? (
          <div className="rounded-xl p-3 mt-4 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}><Lock size={13} style={{ color: "#A87616", marginTop: 2 }} /><span style={{ fontSize: 12, color: "#7A5410", lineHeight: 1.5 }}>External links are <strong>best-effort gated</strong> — not hard-gated. Choose <strong>Private (signed)</strong> or hosted upload for true gating.</span></div>
        ) : (
          <div className="rounded-xl p-3 mt-4 flex items-start gap-2" style={{ background: "#E6F7EF", border: "1px solid #BBE5C9" }}><ShieldCheck size={13} style={{ color: "#0F766E", marginTop: 2 }} /><span style={{ fontSize: 12, color: "#0F5132", lineHeight: 1.5 }}><strong>Truly gated.</strong> Delivery is via signed, expiring URLs only for members with the module unlocked.</span></div>
        )}

        {/* Homepage welcome video toggle */}
        <div className="rounded-xl p-3 mt-4 flex items-center justify-between gap-3" style={{ background: asset.is_homepage ? "rgba(200,155,60,0.1)" : "var(--secondary)", border: "1px solid " + (asset.is_homepage ? "rgba(200,155,60,0.35)" : "var(--border)") }}>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center rounded-lg" style={{ width: 32, height: 32, background: asset.is_homepage ? "var(--nuru-gold)" : "var(--card)", color: asset.is_homepage ? "#fff" : "var(--muted-foreground)" }}><Sparkles size={15} /></span>
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Mobile homepage welcome video</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>The single mobile-app welcome video — setting this clears any other.</div>
            </div>
          </div>
          <button onClick={onToggleHomepage} disabled={us !== "Ready"} className="rounded-full shrink-0" title={us !== "Ready" ? "Only a ready video can be featured" : undefined} style={{ width: 42, height: 24, background: asset.is_homepage ? "var(--nuru-gold)" : "var(--switch-background)", padding: 3, opacity: us !== "Ready" ? 0.5 : 1, cursor: us !== "Ready" ? "not-allowed" : "pointer", transition: "background 0.15s", border: "none" }}>
            <span className="block rounded-full" style={{ width: 18, height: 18, background: "#fff", transform: asset.is_homepage ? "translateX(18px)" : "translateX(0)", transition: "transform 0.15s" }} />
          </button>
        </div>
      </div>

      <div className="px-6 py-4 flex items-center gap-2 flex-wrap" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onAttach} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Link2 size={12} /> {asset.attached_module_id ? "Change module" : "Attach to module"}</button>
        {asset.external_url ? <a href={asset.external_url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600 }}><ExternalLink size={12} /> Open original</a> : null}
        <button onClick={onReplace} className="flex items-center gap-1.5 rounded-xl px-3 py-2" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 12, fontWeight: 600 }}><RotateCcw size={12} /> Replace link</button>
        <button onClick={onDelete} className="flex items-center gap-1.5 rounded-xl px-3 py-2 ml-auto" style={{ background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", fontSize: 12, fontWeight: 600 }}><Trash2 size={12} /> Delete</button>
      </div>
    </Drawer>
  );
}

/* ───────────────────────── Contained Nuru Player ───────────────────────── */
function NuruPlayer({ asset }: { asset: MediaAssetRow }): ReactElement {
  const PLAYER_H = 220;
  if (uiStatus(asset) === "Failed") {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ height: PLAYER_H, background: "#111827", color: "#fff", gap: 6, padding: 16 }}>
        <AlertTriangle size={24} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>This link is broken</span>
        <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.6)" }}>Re-link the video to restore playback.</span>
      </div>
    );
  }
  const src =
    asset.video_source === "youtube" && asset.external_video_id
      ? `https://www.youtube-nocookie.com/embed/${asset.external_video_id}?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&color=white`
      : asset.video_source === "vimeo" && asset.external_video_id
      ? `https://player.vimeo.com/video/${asset.external_video_id}?title=0&byline=0&portrait=0&dnt=1`
      : null;

  return (
    <div className="relative" style={{ height: PLAYER_H, background: "#000" }} onContextMenu={(e) => e.preventDefault()}>
      {src ? (
        <iframe src={src} title="Nuru Player" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ width: "100%", height: "100%", border: "none", display: "block" }} />
      ) : asset.external_url ? (
        <video src={asset.external_url} controls controlsList="nodownload noremoteplayback" disablePictureInPicture style={{ width: "100%", height: "100%", background: "#000", display: "block" }} />
      ) : (
        <div className="flex flex-col items-center justify-center text-center" style={{ height: "100%", color: "#fff", gap: 6 }}>
          <ShieldCheck size={22} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>Gated HLS — delivered to members only</span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>Originals are never previewed in the portal.</span>
        </div>
      )}
      <div className="absolute top-0 left-0 right-0 flex items-center gap-2" style={{ height: 40, padding: "0 12px", background: "linear-gradient(180deg, rgba(0,0,0,0.75), rgba(0,0,0,0))", pointerEvents: "auto" }}>
        <span className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}><Lock size={11} /> Nuru Player</span>
        <span className="truncate" style={{ fontSize: 11, color: "rgba(255,255,255,0.75)" }}>· {assetTitle(asset)}</span>
      </div>
    </div>
  );
}

/* ───────────────────────────── Shared bits ───────────────────────────── */
function SelectFilter({ label, value, onChange, options, icon }: { label: string; value: string; onChange: (v: string) => void; options: readonly string[]; icon?: ReactNode }): ReactElement {
  return (
    <label className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
      {icon}
      <span style={{ fontSize: 11, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>
        {options.map((o) => <option key={o} value={o}>{o === "All" ? "All" : o.charAt(0).toUpperCase() + o.slice(1)}</option>)}
      </select>
      <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} />
    </label>
  );
}

function Field({ label, children, required }: { label: string; children: ReactNode; required?: boolean }): ReactElement {
  return <div><div className="flex items-center gap-1 mb-1.5"><span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{label}</span>{required ? <span style={{ color: "#DC2626", fontSize: 11 }}>*</span> : null}</div>{children}</div>;
}

function Modal({ children, onClose, title, subtitle, tone = "default" }: { children: ReactNode; onClose: () => void; title: string; subtitle?: string; tone?: "default" | "danger" }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(11,31,51,0.55)" }}>
      <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--card)", width: 640, maxWidth: "92vw", maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div>
            <div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: tone === "danger" ? "#DC2626" : "var(--nuru-gold)" }}>{tone === "danger" ? <AlertTriangle size={12} /> : <Link2 size={12} />}{tone === "danger" ? "DESTRUCTIVE" : "MODULE ATTACHMENT"}</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{title}</h2>
            {subtitle ? <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>{subtitle}</p> : null}
          </div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function Drawer({ children, onClose }: { children: ReactNode; onClose: () => void }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div className="ml-auto flex flex-col" style={{ width: "min(480px, 100vw)", maxWidth: "100vw", background: "var(--card)", height: "100%", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function CompletionBar({ value, views, hideViews, label = "watched" }: { value: number; views: number; hideViews?: boolean; label?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
      <div style={{ flex: 1, height: 5, background: "var(--secondary)", borderRadius: 999, overflow: "hidden", minWidth: 40 }}>
        <div style={{ width: `${Math.max(0, Math.min(100, value))}%`, height: "100%", background: value >= 70 ? "#16A34A" : value >= 40 ? "#C89B3C" : "#94A3B8", borderRadius: 999 }} />
      </div>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{value}% {label}{hideViews ? "" : ` · ${views} views`}</span>
    </div>
  );
}
