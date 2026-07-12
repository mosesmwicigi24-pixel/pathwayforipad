// Uploads & Sessions (/uploads-sessions) — the studio's audio bench, split out
// of the Radio Studio broadcast desk (Mac-app IA parity). Hosts the SAME
// AudioLibraryPanel + SessionsPanel implementations
// (src/components/radio/SessionsPanels.tsx): track upload + tagging + delete,
// add-to-session, session create/delete, playlist add/remove/reorder, loop
// cycling with the loop-airtime dialog, attach/replace session audio, playlist
// totals, and Play live (server-authoritative go-live + client preview with
// lock-screen Media Session metadata). Editing a session deep-links back into
// the broadcast desk's edit form (/radio?edit=<id>). Freshness rides the same
// `rs:programs-changed` / `rs:playlist-changed` window events as the desk —
// this page owns its own 30s ticker since only one studio page is mounted at
// a time.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Disc3, ListMusic, Radio as RadioIcon } from "lucide-react";
import { RadioApi, type RadioProgram } from "../../api/client";
import {
  BG, PANEL_BORDER, GOLD, GOLD_DEEP, RED, TEXT, DIM, DIMMER, SERIF,
  STUDIO_CSS, StudioBackdrop,
} from "../radio/studioKit";
import { AudioLibraryPanel, SessionsPanel } from "../radio/SessionsPanels";

export function UploadsSessions(): ReactElement {
  const navigate = useNavigate();
  const [programs, setPrograms] = useState<RadioProgram[]>([]);
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<string | null>(null);

  // Program list — only for the page-level live context (the panels load their
  // own lists); refreshed by the same event fan-out the panels listen to.
  const refresh = useCallback(() => {
    RadioApi.programs().then(setPrograms).catch(() => setPrograms([]));
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const h = (): void => refresh();
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, [refresh]);

  // Auto-air freshness — the same 30s nudge the broadcast desk dispatches; it
  // fans out to this page's refresh() AND the Sessions/library panels.
  useEffect(() => {
    const t = setInterval(() => window.dispatchEvent(new CustomEvent("rs:programs-changed")), 30_000);
    return () => clearInterval(t);
  }, []);

  const live = programs.find((p) => p.is_live) ?? null;
  const liveId = live?.id ?? null;

  // Icy now-playing metadata for the live program (drives the gold ON AIR row
  // marker in the Sessions panel) — a light health poll while something is live.
  useEffect(() => {
    if (!liveId) { setNowPlaying(null); return; }
    let alive = true;
    const poll = (): void => {
      RadioApi.health(liveId)
        .then((h) => { if (alive) setNowPlaying(h.now_playing ?? null); })
        .catch(() => { if (alive) setNowPlaying(null); });
    };
    poll();
    const t = setInterval(poll, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [liveId]);

  // Edit a session → deep-link into the broadcast desk's edit form.
  const openInStudio = useCallback((p: RadioProgram) => {
    navigate(`/radio?edit=${p.id}`);
  }, [navigate]);

  return (
    <div className="relative overflow-hidden" style={{ minHeight: "100%", background: BG, fontFamily: "'Manrope', sans-serif", color: TEXT }}>
      <style>{STUDIO_CSS}</style>

      {/* ambient studio glows */}
      <StudioBackdrop />

      {/* ── Top studio bar ── */}
      <div className="relative flex items-center justify-between gap-4 flex-wrap" style={{ padding: "16px clamp(16px,4vw,40px)", borderBottom: `1px solid ${PANEL_BORDER}`, background: "rgba(255,255,255,0.02)", backdropFilter: "blur(6px)" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, background: "linear-gradient(90deg, transparent, rgba(200,155,60,0.6), rgba(245,199,126,0.3), transparent)", pointerEvents: "none" }} />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120" }}>
            <ListMusic size={20} />
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1 }}>Uploads & Sessions</div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>Audio library · session playlists · Pathway Radio</div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {previewTitle && (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(239,68,68,0.10)", border: `1px solid ${RED}44`, color: "#FCA5A5", fontSize: 11.5, fontWeight: 700, maxWidth: 280 }}>
              <Disc3 size={12} className="rs-live-dot shrink-0" style={{ color: RED }} />
              <span className="truncate">Preview: {previewTitle}</span>
            </span>
          )}
          {live ? (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(239,68,68,0.15)", border: `1px solid ${RED}66`, color: "#FCA5A5", fontSize: 12, fontWeight: 800, letterSpacing: "0.06em", maxWidth: 320 }}>
              <span className="rs-live-dot rounded-full shrink-0" style={{ width: 8, height: 8, background: RED }} /> ON AIR
              <span className="truncate" style={{ fontWeight: 700, letterSpacing: 0, textTransform: "none" }}>· {live.title}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${PANEL_BORDER}`, color: DIM, fontSize: 12, fontWeight: 700 }}>
              <span className="rounded-full" style={{ width: 8, height: 8, background: DIMMER }} /> Off air
            </span>
          )}
          <Link to="/radio" className="rs-btn flex items-center gap-1.5 rounded-full px-3.5" style={{ height: 34, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120", fontSize: 12, fontWeight: 800, border: "none", textDecoration: "none" }}>
            <RadioIcon size={14} /> Open Radio Studio
          </Link>
        </div>
      </div>

      {/* ── Two top-aligned columns — Uploads (library) · Sessions (playlists) ── */}
      <div className="relative" style={{ padding: "22px clamp(16px,4vw,40px) 44px" }}>
        <div className="rs-cols">
          <AudioLibraryPanel />
          <SessionsPanel
            onPreview={setPreviewTitle}
            onEdit={openInStudio}
            liveProgramId={liveId}
            nowPlaying={nowPlaying}
          />
        </div>
      </div>
    </div>
  );
}

export default UploadsSessions;
