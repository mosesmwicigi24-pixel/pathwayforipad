// Shared Radio Studio kit — the dark "Live Broadcast Studio" design system
// (palette, page CSS, formatting helpers, media-session glue and the panel
// building blocks) used by BOTH studio pages: Radio Studio (/radio, the
// broadcast desk) and Uploads & Sessions (/uploads-sessions, the audio library
// + session playlists). Extracted verbatim from RadioStudio.tsx so there is
// exactly ONE implementation of every primitive.
import { useState, type ReactElement } from "react";
import { Check, Copy, type LucideIcon } from "lucide-react";
import { AxiosError } from "axios";
import type {
  RadioComment,
  RadioLoopMode,
  RadioPlaylistItem,
  RadioProgram,
  RadioTrack,
  RadioTrackKind,
  StreamHealth,
} from "../../api/client";

/* ── studio palette (Figma make) ── */
export const BG = "#0A1120";
export const PANEL = "linear-gradient(180deg, #131E33 0%, #0F1829 100%)";
export const PANEL_BORDER = "rgba(255,255,255,0.08)";
export const GOLD = "#E6C66E";
export const GOLD_DEEP = "#C89B3C";
export const RED = "#EF4444";
export const GREEN = "#22C55E";
export const TEXT = "#E8EEF7";
export const DIM = "rgba(232,238,247,0.55)";
export const DIMMER = "rgba(232,238,247,0.38)";
export const MONO = "'DM Mono', monospace";
export const SERIF = "'DM Serif Display', serif";

/* ── page-level studio CSS (animations, lanes, columns) — one <style> per page ── */
export const STUDIO_CSS = `
  .rs-panel { transition: box-shadow .3s ease, transform .3s ease, border-color .3s ease; }
  .rs-panel:hover { border-color: rgba(230,198,110,0.22); box-shadow: 0 24px 50px -30px rgba(0,0,0,0.9); }
  .rs-btn { transition: transform .15s ease, filter .2s ease, background .2s ease, box-shadow .2s ease; }
  .rs-btn:hover { filter: brightness(1.08); }
  .rs-btn:active { transform: translateY(1px); }
  .rs-tnum { font-variant-numeric: tabular-nums; }
  .rs-in::placeholder { color: ${DIMMER}; }
  @keyframes rs-pulse { 0%,100% { opacity: 1; transform: scale(1); } 50% { opacity: .45; transform: scale(.82); } }
  @keyframes rs-pop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: scale(1); } }
  @keyframes rs-spin { to { transform: rotate(360deg); } }
  @keyframes rs-reveal { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }
  .rs-live-dot { animation: rs-pulse 1.4s ease-in-out infinite; }
  .rs-count { animation: rs-pop .4s cubic-bezier(.22,1,.36,1); }
  .rs-spin { animation: rs-spin 1s linear infinite; }
  .rs-reveal { animation: rs-reveal .2s ease; }
  @media (prefers-reduced-motion: reduce) { .rs-live-dot, .rs-count, .rs-panel, .rs-spin, .rs-reveal { animation: none !important; transition: none !important; } }
  /* Radio Studio broadcast desk — three top-aligned lanes (operate / program / context). */
  .rs-lanes { display: grid; gap: 20px; align-items: start; grid-template-columns: minmax(0,36fr) minmax(0,36fr) minmax(0,28fr); }
  .rs-lane { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
  /* Uploads & Sessions — two top-aligned columns (library / sessions). */
  .rs-cols { display: grid; gap: 20px; align-items: start; grid-template-columns: minmax(0,1fr) minmax(0,1.25fr); }
  @media (max-width: 1100px) {
    .rs-lanes { grid-template-columns: minmax(0,1fr); }
    .rs-cols { grid-template-columns: minmax(0,1fr); }
  }
`;

/* Ambient studio glows behind both studio pages. */
export function StudioBackdrop(): ReactElement {
  return (
    <>
      <div aria-hidden style={{ position: "absolute", top: -180, right: -80, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,155,60,0.10), transparent 62%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", top: 120, left: -140, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07), transparent 62%)", pointerEvents: "none" }} />
    </>
  );
}

/* ── audio upload constraints (mirror the server: MP3/WAV/AAC/ALAC) ── */
export const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac";
export function validAudio(file: File): string | null {
  if (file.size > 250 * 1024 * 1024) return `${file.name} is over the 250 MB limit`;
  if (!/\.(mp3|wav|m4a|aac|alac)$/i.test(file.name)) return "Only MP3, WAV, AAC or ALAC (.m4a) audio is allowed";
  return null;
}

/* Track-kind chrome exactly as the make: MUSIC green, PREACHING gold, AUDIO blue. */
export const KIND_META: Record<RadioTrackKind, { label: string; color: string }> = {
  music: { label: "Music", color: "#7BE3A3" },
  preaching: { label: "Preaching", color: "#E6C66E" },
  audio: { label: "Audio", color: "#7FB5FF" },
};
export const TRACK_KINDS = ["music", "preaching", "audio"] as const;

export const LOOP_MODES: RadioLoopMode[] = ["none", "loop_all", "repeat_one"];
export const LOOP_LABEL: Record<RadioLoopMode, string> = { none: "Loop", loop_all: "Loop all", repeat_one: "Repeat one" };

export const REPEAT_OPTIONS = ["none", "daily", "weekdays", "weekly"] as const;
export const REPEAT_LABEL: Record<string, string> = { none: "Once", daily: "Daily", weekdays: "Weekdays", weekly: "Weekly" };

/* ── formatting helpers ── */
// Two-letter initials for a listener's avatar fallback (no photo).
export function listenerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0];
  if (!first) return "?";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return ((first[0] ?? "") + (last[0] ?? "")).toUpperCase();
}

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600).toString().padStart(2, "0");
  const m = Math.floor((s % 3600) / 60).toString().padStart(2, "0");
  const sec = Math.floor(s % 60).toString().padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// Short human label for a scheduled_at ISO string (falls back gracefully).
export function fmtSchedule(iso: string | null | undefined): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Not scheduled";
  return d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

// HH:MM chip for the scheduled-playout list.
export function fmtTimeChip(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--:--";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// mm:ss (or h:mm:ss) label for an audio duration in seconds.
export function fmtClock(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = (s % 60).toString().padStart(2, "0");
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// Cumulative playlist runtime — the sum of the known track durations. Tracks
// with no duration are excluded from the sum and the label gets a trailing "+"
// so it stays honest (e.g. "3:47:12+"). Null when nothing is summable.
export function playlistRuntime(items: RadioPlaylistItem[]): string | null {
  let total = 0;
  let unknown = false;
  for (const it of items) {
    const d = it.track.duration_sec;
    if (d != null && Number.isFinite(d) && d > 0) total += d;
    else unknown = true;
  }
  const clock = fmtClock(total);
  return clock ? `${clock}${unknown ? "+" : ""}` : null;
}

// Minutes → short airtime label for the loop captions/chips (45 → "45 min",
// 60 → "1h", 90 → "1h 30m", 120 → "2h").
export function fmtAirtime(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// Human-readable byte size ("31.2 MB").
export function fmtBytes(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n >= 100 || u === 0 ? Math.round(n) : n.toFixed(1)} ${units[u]}`;
}

// ISO → value for <input type="datetime-local"> in the user's local time.
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// "18:00" → next occurrence of that wall-clock time as an ISO instant.
export function nextOccurrenceIso(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

// Filename without its extension → default track title.
export function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

// Best-effort filename from a stored audio URL (edit-mode prefill).
export function urlFileName(url: string): string {
  try {
    const path = new URL(url, window.location.origin).pathname;
    const last = path.split("/").pop() ?? "";
    return decodeURIComponent(last) || "Attached audio";
  } catch {
    return "Attached audio";
  }
}

// Fuzzy-match the encoder's icy now-playing metadata ("Artist — Title" or bare
// title) against a library track: case-insensitive containment either way on
// the track title, with the audio_url basename (extension stripped) as a
// fallback key. No match → no highlight; we never guess.
export function trackMatchesNowPlaying(nowPlaying: string, track: RadioTrack): boolean {
  const np = nowPlaying.trim().toLowerCase();
  if (!np) return false;
  const title = track.title.trim().toLowerCase();
  if (title && (np.includes(title) || title.includes(np))) return true;
  const file = urlFileName(track.audio_url);
  if (file === "Attached audio") return false; // urlFileName's failure fallback
  const base = baseName(file).trim().toLowerCase();
  return base.length > 0 && (np.includes(base) || base.includes(np));
}

// Recording target label ("saving to Cloud + Local").
export function fmtTarget(target: RadioProgram["record_target"]): string {
  if (target === "both") return "Cloud + Local";
  if (target === "local") return "Local";
  return "Cloud";
}

// A comment's real author name (users LEFT JOIN server-side) — the bare
// "Listener" fallback only when the member is gone/null.
export function authorLabel(c: RadioComment): string {
  return c.author_name ?? "Listener";
}

export function statusLabel(s: RadioProgram["status"]): string {
  return s === "live" ? "Live" : s === "scheduled" ? "Scheduled" : s === "ended" ? "Ended" : "Draft";
}
export function healthWord(h: StreamHealth | null): string {
  if (!h) return "—";
  if (h.stability > 95 && h.dropped === 0) return "Excellent";
  if (h.stability > 85) return "Good";
  return "Fair";
}

// Server error envelope ({error:{code,message}}) → human message, else fallback.
// Used so a go-live 409 CONFLICT surfaces the server's message (it names the
// session that is currently live) instead of a generic failure line.
export function apiErrMessage(e: unknown, fallback: string): string {
  if (e instanceof AxiosError) {
    const data = e.response?.data as { error?: { message?: string } } | undefined;
    const msg = data?.error?.message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return fallback;
}

// Read an audio file's duration client-side (best-effort) for upload hints.
export function probeAudioDuration(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.onloadedmetadata = () => {
        const d = Number.isFinite(el.duration) ? Math.round(el.duration) : undefined;
        URL.revokeObjectURL(url);
        resolve(d && d > 0 ? d : undefined);
      };
      el.onerror = () => { URL.revokeObjectURL(url); resolve(undefined); };
      el.src = url;
    } catch { resolve(undefined); }
  });
}

// ── Media Session (lock-screen / media-key) integration ──
// Registers now-playing metadata + transport handlers so browser audio keeps
// playing when the screen locks on iPad/mobile Safari and can be controlled
// from the lock screen / media keys. No-op where the API is unsupported.
// Note: nothing in the studio pages listens to `visibilitychange` — audio must
// keep playing when the tab is backgrounded or the screen locks.
export function setMediaSession(
  audio: HTMLAudioElement,
  title: string,
  artist: string,
  artworkUrl?: string | null,
  skip?: { next?: () => void; prev?: () => void },
): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({
      title,
      artist,
      album: "Nuru Radio",
      artwork: artworkUrl ? [{ src: artworkUrl, sizes: "512x512" }] : [],
    });
    ms.setActionHandler("play", () => { void audio.play().catch(() => {}); });
    ms.setActionHandler("pause", () => { audio.pause(); });
    ms.setActionHandler("nexttrack", skip?.next ?? null);
    ms.setActionHandler("previoustrack", skip?.prev ?? null);
    ms.playbackState = "playing";
  } catch {
    // Some browsers throw on unrecognized actions — metadata is best-effort.
  }
}

// Mirror the element's play/pause state onto the lock-screen controls.
export function setMediaPlaybackState(state: "none" | "paused" | "playing"): void {
  if (!("mediaSession" in navigator)) return;
  try { navigator.mediaSession.playbackState = state; } catch { /* best-effort */ }
}

// Drop metadata + handlers when playback fully stops (preview stopped).
export function clearMediaSession(): void {
  if (!("mediaSession" in navigator)) return;
  const ms = navigator.mediaSession;
  try {
    ms.metadata = null;
    ms.playbackState = "none";
    ms.setActionHandler("play", null);
    ms.setActionHandler("pause", null);
    ms.setActionHandler("nexttrack", null);
    ms.setActionHandler("previoustrack", null);
  } catch { /* best-effort */ }
}

/* ── shared input styles ── */
export const inputStyle: React.CSSProperties = {
  width: "100%", height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`,
  color: TEXT, fontSize: 12.5, outline: "none", borderRadius: 10, padding: "0 12px",
};
export const optStyle: React.CSSProperties = { background: "#131E33", color: TEXT };

export const hiddenInput: React.CSSProperties = {
  position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
  overflow: "hidden", clip: "rect(0 0 0 0)", border: 0,
};

/* ── building blocks (Figma make) ── */
export function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): ReactElement {
  return (
    <div className="rs-panel rounded-2xl" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: 18, boxShadow: "0 18px 40px -28px rgba(0,0,0,0.8)", ...style }}>
      {children}
    </div>
  );
}

export function SectionHead({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): ReactElement {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: GOLD }} />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.01em" }}>{title}</span>
      </div>
      {hint && <span style={{ fontSize: 11, color: DIM }}>{hint}</span>}
    </div>
  );
}

export function Metric({ label, value, sub, mono, valueColor, dot }: { label: string; value: string; sub?: string; mono?: boolean; valueColor?: string; dot?: string }): ReactElement {
  return (
    <div>
      <div className="flex items-center gap-1.5" style={{ marginBottom: 4 }}>
        {dot && <span className="rs-live-dot rounded-full" style={{ width: 7, height: 7, background: dot }} />}
        <span style={{ fontSize: 10, color: DIM, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{label}</span>
      </div>
      <div className="rs-tnum" style={{ fontFamily: mono ? MONO : SERIF, fontSize: 22, color: valueColor ?? TEXT, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: DIMMER, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export function Meter({ label, level }: { label: string; level: number }): ReactElement {
  const segs = 22;
  const lit = Math.round(level * segs);
  return (
    <div className="flex flex-col items-center gap-2" style={{ height: "100%" }}>
      <div className="flex flex-col-reverse gap-[3px]" style={{ flex: 1 }}>
        {Array.from({ length: segs }).map((_, i) => {
          const on = i < lit;
          const color = i > segs * 0.85 ? RED : i > segs * 0.62 ? GOLD : GREEN;
          return <span key={i} style={{ width: 18, height: 6, borderRadius: 2, background: on ? color : "rgba(255,255,255,0.07)", boxShadow: on ? `0 0 6px ${color}88` : "none", transition: "background .1s" }} />;
        })}
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color: DIM }}>{label}</span>
    </div>
  );
}

export function Toggle({ active, onClick, icon: Icon, label, danger }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; danger?: boolean }): ReactElement {
  const on = active;
  const col = danger ? RED : GOLD;
  return (
    <button onClick={onClick} className="rs-btn flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: on ? (danger ? "rgba(239,68,68,0.16)" : "rgba(230,198,110,0.14)") : "rgba(255,255,255,0.04)", border: `1px solid ${on ? col + "66" : PANEL_BORDER}`, color: on ? (danger ? "#FCA5A5" : GOLD) : DIM, fontSize: 11.5, fontWeight: 600 }}>
      <Icon size={14} /> {label}
    </button>
  );
}

export function ReactChip({ icon: Icon, color, value, label, onClick }: { icon: LucideIcon | (() => ReactElement); color: string; value: number; label: string; onClick?: () => void }): ReactElement {
  return (
    <button type="button" onClick={onClick} className="rs-btn rounded-xl flex flex-col items-center py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontFamily: "inherit", cursor: onClick ? "pointer" : "default" }}>
      <Icon size={16} style={{ color }} />
      <span className="rs-tnum" style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, marginTop: 4 }}>{value.toLocaleString()}</span>
      <span style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 1 }}>{label}</span>
    </button>
  );
}

export function Health({ icon: Icon, label, value, ok }: { icon: LucideIcon; label: string; value: string; ok?: boolean }): ReactElement {
  return (
    <div className="rounded-xl px-3 py-2.5 flex items-center gap-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
      <Icon size={15} style={{ color: ok ? GREEN : "#FCA5A5" }} />
      <div style={{ minWidth: 0 }}>
        <div className="rs-tnum" style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }): ReactElement {
  return (
    <label className="flex flex-col gap-1.5" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 10.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</span>
      {children}
    </label>
  );
}

export function CredRow({ label, value, secret, onCopy, copied }: { label: string; value: string; secret?: boolean; onCopy?: (() => void) | undefined; copied?: boolean }): ReactElement {
  const [reveal, setReveal] = useState(!secret);
  const shown = reveal ? value : value === "—" ? "—" : "•".repeat(Math.min(28, value.length));
  return (
    <div className="flex items-center gap-2 rounded-xl px-3 py-2" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 9.5, color: DIM, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700 }}>{label}</div>
        <div className="truncate" style={{ fontFamily: MONO, fontSize: 12, color: TEXT, marginTop: 2 }}>{shown}</div>
      </div>
      {secret && value !== "—" && (
        <button onClick={() => setReveal((v) => !v)} className="rs-btn shrink-0" style={{ fontSize: 10.5, fontWeight: 700, color: GOLD, background: "none", border: "none", cursor: "pointer" }}>{reveal ? "Hide" : "Show"}</button>
      )}
      {onCopy && (
        <button onClick={onCopy} title="Copy" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "rgba(255,255,255,0.05)", color: copied ? GREEN : DIM }}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}

export function StateCard({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: React.ReactNode }): ReactElement {
  return (
    <Panel style={{ textAlign: "center", padding: 32 }}>
      <span className="mx-auto flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: "rgba(239,68,68,0.12)", color: "#FCA5A5" }}><Icon size={26} /></span>
      <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 14 }}>{title}</div>
      <div style={{ fontSize: 13, color: DIM, marginTop: 8, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>{body}</div>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </Panel>
  );
}

export function GoldButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="rs-btn rounded-xl px-5 py-2.5" style={{ background: GOLD, color: "#0A1120", fontSize: 13, fontWeight: 800 }}>{children}</button>
  );
}
