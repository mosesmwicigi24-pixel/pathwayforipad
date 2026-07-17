// Sessions + Audio library panels — the studio's playlist/upload bench, moved
// out of RadioStudio.tsx so ONE implementation serves both the Uploads &
// Sessions page (/uploads-sessions, their home) and any studio surface that
// needs them. Everything is REAL (API-backed): track CRUD + upload, session
// playlists (add/remove/reorder/loop via PATCH, incl. the loop-airtime
// dialog), attach session audio, and the client-side live preview with Media
// Session lock-screen metadata. Cross-page freshness rides the same
// `rs:programs-changed` / `rs:playlist-changed` window events as before.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  ArrowDown, ArrowUp, Disc3, ListMusic, Loader2, Music, Pencil, Play, Plus,
  Repeat, Repeat1, Square, Upload, X,
} from "lucide-react";
import {
  RadioApi,
  type RadioProgram,
  type UpdateRadioProgramBody,
  type RadioTrack,
  type RadioTrackKind,
  type RadioPlaylistItem,
  type RadioLoopMode,
  type CreateRadioTrackBody,
} from "../../api/client";
import {
  PANEL, PANEL_BORDER, GOLD, RED, GREEN, TEXT, DIM, DIMMER, MONO, SERIF,
  AUDIO_ACCEPT, validAudio, probeAudioDuration, baseName, apiErrMessage,
  fmtClock, fmtBytes, playlistRuntime, fmtAirtime, trackMatchesNowPlaying,
  KIND_META, TRACK_KINDS, LOOP_MODES, LOOP_LABEL,
  setMediaSession, setMediaPlaybackState, clearMediaSession,
  Panel, SectionHead, optStyle, hiddenInput,
} from "./studioKit";

// ── Audio library panel — reusable track catalog + upload, Figma-styled ──
export function AudioLibraryPanel(): ReactElement {
  const [tracks, setTracks] = useState<RadioTrack[] | null>(null);
  const [uploadKind, setUploadKind] = useState<RadioTrackKind>("music");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState<RadioProgram[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    RadioApi.tracks()
      .then((list) => setTracks(list))
      .catch(() => { setTracks(null); setErr("Could not load the audio library."); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const loadSessions = useCallback(() => {
    RadioApi.programs().then(setSessions).catch(() => setSessions([]));
  }, []);
  useEffect(() => { loadSessions(); }, [loadSessions]);
  useEffect(() => {
    const h = (): void => loadSessions();
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, [loadSessions]);

  const upload = useCallback(async (file: File) => {
    const invalid = validAudio(file);
    if (invalid) { setErr(invalid); return; }
    setUploading(true);
    setErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      const body: CreateRadioTrackBody = { title: baseName(file.name), kind: uploadKind, audio_url: res.url, size_bytes: file.size };
      const d = res.duration_sec ?? durationSec;
      if (d != null) body.duration_sec = d;
      await RadioApi.createTrack(body);
      load();
    } catch {
      setErr("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }, [uploadKind, load]);

  const remove = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteTrack(id);
      setTracks((ts) => (ts ? ts.filter((t) => t.id !== id) : ts));
    } catch {
      setErr("Could not delete the track.");
    }
  }, []);

  const addToSession = useCallback(async (programId: string, track: RadioTrack) => {
    setNote(null);
    try {
      await RadioApi.addToPlaylist(programId, track.id);
      const s = sessions.find((p) => p.id === programId);
      setNote(`Added "${track.title}" to ${s?.title ?? "session"}.`);
      window.dispatchEvent(new CustomEvent("rs:playlist-changed", { detail: { programId } }));
      setTimeout(() => setNote((n) => (n && n.startsWith("Added") ? null : n)), 2600);
    } catch {
      setErr("Could not add the track to that session.");
    }
  }, [sessions]);

  const count = tracks?.length ?? 0;

  return (
    <Panel>
      <SectionHead icon={Music} title="Audio library" hint={loading ? "Loading…" : `${count} track${count === 1 ? "" : "s"}`} />

      {/* Upload-kind picker + dashed upload — exactly the make's row */}
      <div className="flex gap-2 mb-3 flex-wrap">
        <div className="flex gap-1 rounded-lg p-1" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${PANEL_BORDER}` }}>
          {TRACK_KINDS.map((k) => (
            <button key={k} onClick={() => setUploadKind(k)} className="rs-btn rounded-md px-2.5 py-1" style={{ fontSize: 10.5, fontWeight: 700, background: uploadKind === k ? KIND_META[k].color : "transparent", color: uploadKind === k ? "#0A1120" : DIM }}>{KIND_META[k].label}</button>
          ))}
        </div>
        <label className="rs-btn flex items-center justify-center gap-2 rounded-lg px-3 cursor-pointer" style={{ flex: 1, minWidth: 150, height: 34, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px dashed ${GOLD}66`, fontSize: 12, fontWeight: 700, opacity: uploading ? 0.6 : 1 }}>
          {uploading ? <Loader2 size={14} className="rs-spin" /> : <Upload size={14} />}
          {uploading ? "Uploading…" : `Upload ${KIND_META[uploadKind].label.toLowerCase()}`}
          <input type="file" accept={AUDIO_ACCEPT} multiple={false} disabled={uploading} hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
        </label>
      </div>

      {err && <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8 }}>{err}</div>}
      {note && <div style={{ fontSize: 11, color: GREEN, marginBottom: 8 }}>{note}</div>}

      {/* Track rows */}
      <div className="flex flex-col gap-2" style={{ maxHeight: 240, overflowY: "auto" }}>
        {loading ? (
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: DIM, padding: "6px 0" }}>
            <Loader2 size={14} className="rs-spin" /> Loading tracks…
          </div>
        ) : count === 0 ? (
          <div style={{ fontSize: 12, color: DIMMER, padding: "10px 0", textAlign: "center" }}>No tracks yet — upload one above.</div>
        ) : (
          tracks?.map((t) => {
            const meta = KIND_META[t.kind];
            const dur = fmtClock(t.duration_sec);
            const size = fmtBytes(t.size_bytes);
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: `${meta.color}22`, color: meta.color }}><Music size={15} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontSize: 12, fontWeight: 600 }}>{t.title}</div>
                  <div className="flex items-center gap-2" style={{ marginTop: 2 }}>
                    <span className="rounded-full px-1.5" style={{ fontSize: 9, fontWeight: 800, background: `${meta.color}22`, color: meta.color, textTransform: "uppercase", letterSpacing: "0.04em" }}>{meta.label}</span>
                    <span className="rs-tnum" style={{ fontSize: 10.5, color: DIM, fontFamily: MONO }}>{dur ?? "—:—"}{size ? ` · ${size}` : ""}</span>
                  </div>
                </div>
                {sessions.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => { const v = e.target.value; if (v) void addToSession(v, t); }}
                    title="Add to session"
                    className="rs-btn rounded-lg shrink-0"
                    style={{ height: 30, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: GOLD, fontSize: 11, fontWeight: 700, padding: "0 6px" }}
                  >
                    <option value="" style={optStyle}>+ Session</option>
                    {sessions.map((s) => <option key={s.id} value={s.id} style={optStyle}>{s.title}</option>)}
                  </select>
                )}
                <button onClick={() => void remove(t.id)} title="Delete track" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(255,255,255,0.05)", color: DIM }}>
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}

// ── Sessions panel — program playlists + loop + live preview, Figma-styled ──
// `liveProgramId`/`nowPlaying` come from the host page's health poll of the
// REAL broadcast: for the session that IS the live program, the playlist row
// whose track fuzzily matches the icy now-playing metadata gets a gold ON AIR
// mark.
export function SessionsPanel({ onPreview, onEdit, liveProgramId, nowPlaying }: {
  onPreview: (title: string | null) => void;
  onEdit: (p: RadioProgram) => void;
  liveProgramId: string | null;
  nowPlaying: string | null;
}): ReactElement {
  const [sessions, setSessions] = useState<RadioProgram[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [playlists, setPlaylists] = useState<Record<string, RadioPlaylistItem[]>>({});
  const [library, setLibrary] = useState<RadioTrack[]>([]);
  const [attachingId, setAttachingId] = useState<string | null>(null);

  // Client-side live preview.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewProgram, setPreviewProgram] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    setErr(null);
    RadioApi.programs()
      .then((list) => setSessions(list))
      .catch(() => { setSessions(null); setErr("Could not load sessions."); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { RadioApi.tracks().then(setLibrary).catch(() => setLibrary([])); }, []);

  // Silent refresh when programs change elsewhere (form create/edit, attach,
  // go-live/end from the broadcast desk) so the cards never go stale.
  useEffect(() => {
    const h = (): void => { RadioApi.programs().then((list) => setSessions(list)).catch(() => {}); };
    window.addEventListener("rs:programs-changed", h);
    return () => window.removeEventListener("rs:programs-changed", h);
  }, []);

  const loadPlaylist = useCallback((programId: string) => {
    RadioApi.playlist(programId)
      // Coerce at the single write point: everything stored in `playlists` MUST
      // be an array — a non-array here once white-screened the whole studio.
      .then((items) => setPlaylists((p) => ({ ...p, [programId]: Array.isArray(items) ? items : [] })))
      .catch(() => {});
  }, []);

  // Load each session's playlist once loaded.
  useEffect(() => {
    if (!sessions) return;
    sessions.forEach((s) => loadPlaylist(s.id));
  }, [sessions, loadPlaylist]);

  // Refresh a session's playlist when the library panel adds a track to it.
  useEffect(() => {
    const onChanged = (e: Event): void => {
      const detail = (e as CustomEvent<{ programId: string }>).detail;
      if (detail?.programId) loadPlaylist(detail.programId);
    };
    window.addEventListener("rs:playlist-changed", onChanged);
    return () => window.removeEventListener("rs:playlist-changed", onChanged);
  }, [loadPlaylist]);

  const create = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setErr(null);
    try {
      const created = await RadioApi.createProgram({ title: name.trim(), category: "Sermon" });
      setSessions((s) => [created, ...(s ?? [])]);
      setPlaylists((p) => ({ ...p, [created.id]: [] }));
      setName("");
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not create the session.");
    } finally {
      setCreating(false);
    }
  }, [name]);

  const stopPreview = useCallback(() => {
    const el = audioRef.current;
    if (el) { el.pause(); el.removeAttribute("src"); el.load(); }
    clearMediaSession();
    setPreviewProgram(null);
    setPreviewIndex(0);
    onPreview(null);
  }, [onPreview]);

  const removeSession = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteProgram(id);
      setSessions((s) => (s ? s.filter((p) => p.id !== id) : s));
      if (previewProgram === id) stopPreview();
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not delete the session.");
    }
  }, [previewProgram, stopPreview]);

  // Attach/replace a session's broadcast audio straight from its card
  // (upload → PATCH audio_url/audio_duration_sec → refresh everywhere).
  const attachSessionAudio = useCallback(async (programId: string, file: File) => {
    const invalid = validAudio(file);
    if (invalid) { setErr(invalid); return; }
    setAttachingId(programId);
    setErr(null);
    try {
      const durationSec = await probeAudioDuration(file);
      const res = await RadioApi.uploadAudio(file, durationSec);
      const body: UpdateRadioProgramBody = { audio_url: res.url };
      const d = res.duration_sec ?? durationSec;
      if (d != null) body.audio_duration_sec = d;
      const updated = await RadioApi.updateProgram(programId, body);
      setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
    } catch {
      setErr("Could not attach audio. Please try again.");
    } finally {
      setAttachingId(null);
    }
  }, []);

  // ── Loop control + airtime confirmation ──
  // Activating a loop (from none) first asks how long it should stay on air
  // before the server auto-ends the broadcast; the answer rides in the SAME
  // PATCH as loop_mode. Mode changes while already looping, and deactivation,
  // PATCH loop_mode only (duration_min untouched).
  const [loopDialog, setLoopDialog] = useState<{ program: RadioProgram; mode: RadioLoopMode } | null>(null);
  const [loopChoice, setLoopChoice] = useState<number | "manual" | "custom">("manual");
  const [loopCustom, setLoopCustom] = useState("");
  const [loopSaving, setLoopSaving] = useState(false);

  const cycleLoop = useCallback(async (program: RadioProgram) => {
    const idx = LOOP_MODES.indexOf(program.loop_mode);
    const nextMode = LOOP_MODES[(idx + 1) % LOOP_MODES.length]!;
    if (program.loop_mode === "none" && nextMode !== "none") {
      // Turning a loop ON — ask for the airtime first; PATCH happens on confirm.
      setLoopChoice("manual");
      setLoopCustom("");
      setLoopSaving(false);
      setLoopDialog({ program, mode: nextMode });
      return;
    }
    // optimistic
    setSessions((s) => (s ? s.map((p) => (p.id === program.id ? { ...p, loop_mode: nextMode } : p)) : s));
    try {
      const updated = await RadioApi.setLoop(program.id, nextMode);
      setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
    } catch {
      setSessions((s) => (s ? s.map((p) => (p.id === program.id ? { ...p, loop_mode: program.loop_mode } : p)) : s));
      setErr("Could not change the loop mode.");
    }
  }, []);

  // Custom-minutes validity (only gates confirm while "custom" is selected).
  const loopCustomMin = Number(loopCustom);
  const loopCustomValid = Number.isFinite(loopCustomMin) && loopCustomMin > 0;

  const confirmLoop = useCallback(async () => {
    if (!loopDialog) return;
    const { program, mode } = loopDialog;
    const minutes = loopChoice === "manual" ? null : loopChoice === "custom" ? Number(loopCustom) : loopChoice;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes <= 0)) return;
    setLoopSaving(true);
    try {
      // ONE call: { loop_mode, duration_min } (null clears → until ended manually).
      const updated = await RadioApi.setLoop(program.id, mode, minutes === null ? null : Math.round(minutes));
      setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
      window.dispatchEvent(new CustomEvent("rs:programs-changed"));
      setLoopDialog(null);
    } catch {
      setErr("Could not turn the loop on.");
      setLoopDialog(null);
    } finally {
      setLoopSaving(false);
    }
  }, [loopDialog, loopChoice, loopCustom]);

  const addTrack = useCallback(async (programId: string, trackId: string) => {
    try {
      await RadioApi.addToPlaylist(programId, trackId);
      loadPlaylist(programId);
    } catch {
      setErr("Could not add the track.");
    }
  }, [loadPlaylist]);

  const removeItem = useCallback(async (programId: string, itemId: string) => {
    try {
      await RadioApi.removeFromPlaylist(programId, itemId);
      loadPlaylist(programId);
    } catch {
      setErr("Could not remove the track.");
    }
  }, [loadPlaylist]);

  // Reorder derives from the SAME `items` array the rows render from (passed by
  // the caller), so it can never act on a missing/stale playlists[] entry. The
  // reorder endpoint returns {ok:true} — NOT the playlist — so after saving we
  // re-fetch to reconcile instead of storing the response (storing that object
  // as a "playlist" is what used to crash the route with `.map is not a
  // function`). Everything is wrapped so a playlist mutation can only ever
  // surface the inline error, never the router error boundary.
  const reorder = useCallback(async (programId: string, items: RadioPlaylistItem[], from: number, to: number) => {
    try {
      if (!Array.isArray(items) || items.length === 0) { loadPlaylist(programId); return; }
      if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
      const next = items.slice();
      const [moved] = next.splice(from, 1);
      if (!moved) return;
      next.splice(to, 0, moved);
      setPlaylists((p) => ({ ...p, [programId]: next })); // optimistic
      await RadioApi.reorderPlaylist(programId, next.map((i) => i.id));
      loadPlaylist(programId); // reconcile with the server's order
    } catch {
      setPlaylists((p) => ({ ...p, [programId]: items })); // revert optimistic
      setErr("Could not reorder the playlist.");
    }
  }, [loadPlaylist]);

  // ── Live preview (client-side player honoring loop_mode) ──
  const playAt = useCallback((programId: string, index: number) => {
    const items = playlists[programId];
    const item = items?.[index];
    const el = audioRef.current;
    if (!item || !el) return;
    setPreviewProgram(programId);
    setPreviewIndex(index);
    onPreview(item.track.title);
    el.src = item.track.audio_url;
    void el.play().catch(() => {});
  }, [playlists, onPreview]);

  const playLive = useCallback(async (program: RadioProgram) => {
    const items = playlists[program.id];
    if (!items || items.length === 0) { setErr("This session has no tracks to play."); return; }
    setErr(null);
    // Server-authoritative go-live (best effort — preview runs regardless).
    // A 409 CONFLICT (another session already live) surfaces the server message,
    // which names the live session, in the panel's inline error.
    RadioApi.goLive(program.id)
      .then((updated) => {
        setSessions((s) => (s ? s.map((p) => (p.id === updated.id ? updated : p)) : s));
        window.dispatchEvent(new CustomEvent("rs:programs-changed"));
      })
      .catch((e: unknown) => setErr(apiErrMessage(e, "Could not go live. Please try again.")));
    playAt(program.id, 0);
  }, [playlists, playAt]);

  // Advance on `ended`, honoring the current session's loop_mode.
  const onEnded = useCallback(() => {
    if (!previewProgram) return;
    const program = sessions?.find((p) => p.id === previewProgram);
    const items = playlists[previewProgram];
    if (!program || !items || items.length === 0) { stopPreview(); return; }
    const mode = program.loop_mode;
    if (mode === "repeat_one") { playAt(previewProgram, previewIndex); return; }
    const next = previewIndex + 1;
    if (next < items.length) { playAt(previewProgram, next); return; }
    if (mode === "loop_all") { playAt(previewProgram, 0); return; }
    stopPreview();
  }, [previewProgram, previewIndex, sessions, playlists, playAt, stopPreview]);

  // Lock-screen metadata + next/prev transport for the active preview track
  // (Media Session API) so playback survives screen-lock on iPad/mobile Safari.
  useEffect(() => {
    const el = audioRef.current;
    if (!previewProgram || !el) return;
    const items = playlists[previewProgram];
    const item = items?.[previewIndex];
    if (!items || !item) return;
    const program = sessions?.find((p) => p.id === previewProgram);
    const n = items.length;
    setMediaSession(el, item.track.title, program?.title ?? "Nuru Radio", program?.artwork_url, {
      next: () => playAt(previewProgram, (previewIndex + 1) % n),
      prev: () => playAt(previewProgram, (previewIndex - 1 + n) % n),
    });
  }, [previewProgram, previewIndex, playlists, sessions, playAt]);

  const count = sessions?.length ?? 0;
  const airing = sessions?.find((s) => s.is_live) ?? null;
  const previewItem = previewProgram ? playlists[previewProgram]?.[previewIndex] : undefined;

  return (
    <Panel>
      {/* hidden preview element */}
      <audio
        ref={audioRef}
        onEnded={onEnded}
        playsInline
        onPlay={() => setMediaPlaybackState("playing")}
        onPause={() => setMediaPlaybackState(audioRef.current?.src ? "paused" : "none")}
        style={{ display: "none" }}
      />

      <SectionHead icon={ListMusic} title="Sessions" hint={loading ? "Loading…" : airing ? `On air: ${airing.title}` : `${count} session${count === 1 ? "" : "s"}`} />

      {/* Create session */}
      <div className="flex gap-2 mb-3">
        <input
          className="rs-in rounded-lg px-3"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
          placeholder="New session name (e.g. Sunrise Devotion)"
          style={{ flex: 1, minWidth: 0, height: 36, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12, outline: "none" }}
        />
        <button onClick={() => void create()} disabled={creating || !name.trim()} className="rs-btn flex items-center gap-1.5 rounded-lg px-3" style={{ height: 36, background: GOLD, color: "#0A1120", fontSize: 12, fontWeight: 800, opacity: creating || !name.trim() ? 0.55 : 1 }}>
          {creating ? <Loader2 size={14} className="rs-spin" /> : <Plus size={14} />} Create
        </button>
      </div>

      {err && <div style={{ fontSize: 11, color: "#FCA5A5", marginBottom: 8 }}>{err}</div>}
      {previewItem && (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2 mb-3" style={{ background: "rgba(239,68,68,0.08)", border: `1px solid ${RED}44` }}>
          <Disc3 size={13} className="rs-live-dot" style={{ color: RED }} />
          <span className="truncate" style={{ fontSize: 11.5, color: "#FCA5A5" }}>On air preview: {previewItem.track.title}</span>
          <button onClick={stopPreview} className="rs-btn ml-auto flex items-center justify-center rounded-md shrink-0" style={{ width: 24, height: 24, background: "rgba(255,255,255,0.06)", color: DIM }}><Square size={12} /></button>
        </div>
      )}

      {/* Session cards */}
      <div className="flex flex-col gap-3" style={{ maxHeight: 480, overflowY: "auto" }}>
        {loading ? (
          <div className="flex items-center gap-2" style={{ fontSize: 12, color: DIM, padding: "6px 0" }}>
            <Loader2 size={14} className="rs-spin" /> Loading sessions…
          </div>
        ) : count === 0 ? (
          <div style={{ fontSize: 12, color: DIMMER, padding: "10px 0", textAlign: "center" }}>No sessions yet — create one above.</div>
        ) : (
          sessions?.map((s) => {
            const items = playlists[s.id] ?? [];
            const active = s.is_live || previewProgram === s.id;
            // The row actually airing on the REAL broadcast — only for the live
            // program, only when the icy metadata matches a track (never guess).
            const onAirIdx = liveProgramId === s.id && nowPlaying
              ? items.findIndex((it) => trackMatchesNowPlaying(nowPlaying, it.track))
              : -1;
            const LoopIcon = s.loop_mode === "repeat_one" ? Repeat1 : Repeat;
            const loopOn = s.loop_mode !== "none";
            const runtime = playlistRuntime(items);
            return (
              <div key={s.id} className="rounded-xl" style={{ background: active ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? RED + "44" : PANEL_BORDER}`, padding: 12 }}>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 28, height: 28, background: active ? RED : "rgba(230,198,110,0.14)", color: active ? "#fff" : GOLD }}>
                    {active ? <Disc3 size={14} className="rs-live-dot" /> : <ListMusic size={14} />}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="truncate" style={{ fontSize: 12.5, fontWeight: 700 }}>{s.title}</div>
                    <div style={{ fontSize: 10, color: DIM }}>{items.length} item{items.length === 1 ? "" : "s"}{runtime ? ` · ${runtime}` : ""}{s.audio_url ? ` · audio ${fmtClock(s.audio_duration_sec) ?? "✓"}` : ""}{s.is_live ? " · ON AIR" : previewProgram === s.id ? " · PREVIEW" : ""}</div>
                  </div>
                  <button onClick={() => onEdit(s)} title="Edit session" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(230,198,110,0.10)", color: GOLD, border: `1px solid ${GOLD}33` }}>
                    <Pencil size={12} />
                  </button>
                  <label title={s.audio_url ? "Replace session audio" : "Attach session audio"} className="rs-btn flex items-center gap-1 rounded-lg px-2 py-1 shrink-0" style={{ fontSize: 10, fontWeight: 700, background: "rgba(230,198,110,0.10)", color: GOLD, border: `1px solid ${GOLD}33`, cursor: attachingId === s.id ? "default" : "pointer", opacity: attachingId === s.id ? 0.6 : 1 }}>
                    {attachingId === s.id ? <Loader2 size={11} className="rs-spin" /> : <Music size={11} />}
                    {attachingId === s.id ? "Uploading…" : s.audio_url ? "Replace audio" : "Attach audio"}
                    <input type="file" accept={AUDIO_ACCEPT} disabled={attachingId === s.id} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void attachSessionAudio(s.id, f); }} style={hiddenInput} />
                  </label>
                  <button onClick={() => void cycleLoop(s)} title={`Loop: ${LOOP_LABEL[s.loop_mode]}`} className="rs-btn flex items-center gap-1 rounded-lg px-2 py-1 shrink-0" style={{ fontSize: 10, fontWeight: 700, background: loopOn ? "rgba(123,227,163,0.16)" : "rgba(255,255,255,0.05)", color: loopOn ? "#7BE3A3" : DIM, border: `1px solid ${loopOn ? "#7BE3A366" : PANEL_BORDER}` }}>
                    <LoopIcon size={11} /> {LOOP_LABEL[s.loop_mode]}
                  </button>
                  {previewProgram === s.id ? (
                    <button onClick={stopPreview} className="rs-btn flex items-center gap-1 rounded-lg px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: RED, color: "#fff", border: `1px solid ${RED}` }}>
                      <Square size={11} /> Stop
                    </button>
                  ) : (
                    <button onClick={() => void playLive(s)} disabled={items.length === 0} className="rs-btn flex items-center gap-1 rounded-lg px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: "rgba(230,198,110,0.14)", color: GOLD, border: `1px solid ${GOLD}44`, opacity: items.length === 0 ? 0.4 : 1 }}>
                      <Play size={11} /> Play live
                    </button>
                  )}
                  <button onClick={() => void removeSession(s.id)} title="Delete session" className="rs-btn flex items-center justify-center rounded-lg shrink-0" style={{ width: 26, height: 26, background: "rgba(255,255,255,0.05)", color: DIM }}><X size={12} /></button>
                </div>

                {/* playback contract — what happens on air (loop + airtime, or one pass + total runtime) */}
                {(loopOn || runtime) && (
                  <div className="flex items-center gap-1.5 mb-2" style={{ fontSize: 10, color: loopOn ? "#7BE3A3" : DIMMER }}>
                    {loopOn ? <LoopIcon size={10} className="shrink-0" /> : <Play size={10} className="shrink-0" />}
                    <span className="truncate">
                      {loopOn
                        ? s.duration_min != null
                          ? `Loops · ends after ${fmtAirtime(s.duration_min)} on air`
                          : "Loops until ended manually"
                        : `Plays once · ${runtime}`}
                    </span>
                  </div>
                )}

                {/* ordered items — "after this, play this" */}
                <div className="flex flex-col gap-1">
                  {items.length === 0 && <div style={{ fontSize: 11, color: DIMMER, padding: "6px 0" }}>Empty — add tracks from the library.</div>}
                  {items.map((it, idx) => {
                    const meta = KIND_META[it.track.kind];
                    const nowIdx = previewProgram === s.id && previewIndex === idx;
                    const onAir = idx === onAirIdx;
                    return (
                      <div key={it.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: nowIdx ? "rgba(239,68,68,0.12)" : onAir ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${nowIdx ? RED + "44" : onAir ? GOLD + "55" : "transparent"}` }}>
                        <span className="rs-tnum flex items-center justify-center rounded shrink-0" style={{ width: 18, height: 18, background: "rgba(255,255,255,0.08)", fontSize: 10, fontWeight: 700, color: nowIdx ? "#FCA5A5" : onAir ? GOLD : DIM }}>{idx + 1}</span>
                        <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: meta.color }} />
                        <span className="truncate" style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: nowIdx || onAir ? 700 : 500 }}>{it.track.title}</span>
                        {onAir && (
                          <span className="inline-flex items-center gap-1 shrink-0" style={{ fontSize: 9, fontWeight: 800, color: GOLD, letterSpacing: "0.06em" }}>
                            <span className="rs-live-dot rounded-full" style={{ width: 6, height: 6, background: GOLD }} /> ON AIR
                          </span>
                        )}
                        {nowIdx && <span className="shrink-0" style={{ fontSize: 9, fontWeight: 800, color: "#FCA5A5" }}>NOW</span>}
                        <span className="rs-tnum shrink-0" style={{ fontFamily: MONO, fontSize: 10.5, color: onAir ? GOLD : DIM, minWidth: 34, textAlign: "right" }}>{fmtClock(it.track.duration_sec) ?? "—"}</span>
                        <button onClick={() => void reorder(s.id, items, idx, idx - 1)} disabled={idx === 0} title="Move up" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, opacity: idx === 0 ? 0.3 : 1, cursor: idx === 0 ? "default" : "pointer", padding: 0 }}><ArrowUp size={13} /></button>
                        <button onClick={() => void reorder(s.id, items, idx, idx + 1)} disabled={idx === items.length - 1} title="Move down" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, opacity: idx === items.length - 1 ? 0.3 : 1, cursor: idx === items.length - 1 ? "default" : "pointer", padding: 0 }}><ArrowDown size={13} /></button>
                        <button onClick={() => void removeItem(s.id, it.id)} title="Remove from session" className="rs-btn shrink-0" style={{ background: "none", border: "none", color: DIM, cursor: "pointer", padding: 0 }}><X size={12} /></button>
                      </div>
                    );
                  })}
                </div>

                {/* append next piece */}
                <AddTrackSelect tracks={library} onPick={(trackId) => void addTrack(s.id, trackId)} />
              </div>
            );
          })
        )}
      </div>

      {/* ── Loop airtime dialog — how long the loop plays before the server auto-ends it ── */}
      {loopDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(5,9,17,0.7)", backdropFilter: "blur(4px)" }} onClick={() => { if (!loopSaving) setLoopDialog(null); }}>
          <div className="rounded-2xl" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: 26, width: "min(400px, calc(100vw - 32px))", boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-1">
              <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: "rgba(123,227,163,0.16)", color: "#7BE3A3" }}>
                {loopDialog.mode === "repeat_one" ? <Repeat1 size={16} /> : <Repeat size={16} />}
              </span>
              <div style={{ fontFamily: SERIF, fontSize: 19, lineHeight: 1.2 }}>How long should the loop play?</div>
            </div>
            <div className="truncate" style={{ fontSize: 11.5, color: DIM, marginBottom: 16 }}>{LOOP_LABEL[loopDialog.mode]} · {loopDialog.program.title}</div>

            {/* preset airtimes */}
            <div className="flex flex-wrap gap-2 mb-2">
              {[30, 60, 120, 180].map((min) => {
                const on = loopChoice === min;
                return (
                  <button key={min} onClick={() => setLoopChoice(min)} className="rs-btn rounded-lg px-3 py-1.5" style={{ fontSize: 11.5, fontWeight: 700, background: on ? "rgba(230,198,110,0.16)" : "rgba(255,255,255,0.05)", color: on ? GOLD : DIM, border: `1px solid ${on ? GOLD + "66" : PANEL_BORDER}` }}>
                    {fmtAirtime(min)}
                  </button>
                );
              })}
            </div>

            {/* custom minutes + until-ended-manually */}
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center gap-1.5 rounded-lg px-2" style={{ height: 32, background: loopChoice === "custom" ? "rgba(230,198,110,0.10)" : "rgba(255,255,255,0.05)", border: `1px solid ${loopChoice === "custom" ? GOLD + "66" : PANEL_BORDER}` }}>
                <input
                  type="number"
                  min={1}
                  value={loopCustom}
                  onFocus={() => setLoopChoice("custom")}
                  onChange={(e) => { setLoopCustom(e.target.value); setLoopChoice("custom"); }}
                  placeholder="Custom"
                  style={{ width: 64, background: "none", border: "none", outline: "none", color: loopChoice === "custom" ? GOLD : TEXT, fontSize: 11.5, fontWeight: 700 }}
                />
                <span style={{ fontSize: 10.5, color: DIM }}>min</span>
              </div>
              <button onClick={() => setLoopChoice("manual")} className="rs-btn rounded-lg px-3" style={{ height: 32, fontSize: 11.5, fontWeight: 700, background: loopChoice === "manual" ? "rgba(230,198,110,0.16)" : "rgba(255,255,255,0.05)", color: loopChoice === "manual" ? GOLD : DIM, border: `1px solid ${loopChoice === "manual" ? GOLD + "66" : PANEL_BORDER}` }}>
                Until ended manually
              </button>
            </div>

            <div style={{ fontSize: 11, color: DIMMER, lineHeight: 1.5, marginBottom: 16 }}>
              The broadcast ends automatically after this long on air (server auto-end).
            </div>

            <div className="flex gap-2">
              <button onClick={() => setLoopDialog(null)} disabled={loopSaving} className="rs-btn flex-1 rounded-xl py-2.5" style={{ background: "rgba(255,255,255,0.06)", color: TEXT, fontSize: 12.5, fontWeight: 600, opacity: loopSaving ? 0.6 : 1 }}>Cancel</button>
              <button
                onClick={() => void confirmLoop()}
                disabled={loopSaving || (loopChoice === "custom" && !loopCustomValid)}
                className="rs-btn flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5"
                style={{ background: GOLD, color: "#0A1120", fontSize: 12.5, fontWeight: 800, opacity: loopSaving || (loopChoice === "custom" && !loopCustomValid) ? 0.55 : 1 }}
              >
                {loopSaving && <Loader2 size={13} className="rs-spin" />} Turn loop on
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

// The make's dashed "+ Add track to this session…" select, fed by the real library.
function AddTrackSelect({ tracks, onPick }: { tracks: RadioTrack[]; onPick: (trackId: string) => void }): ReactElement {
  return (
    <select
      value=""
      onChange={(e) => { const v = e.target.value; if (v) onPick(v); }}
      className="rs-btn w-full rounded-lg mt-2"
      style={{ height: 32, background: "rgba(255,255,255,0.05)", border: `1px dashed ${PANEL_BORDER}`, color: GOLD, fontSize: 11.5, fontWeight: 700, padding: "0 8px" }}
    >
      <option value="" style={optStyle}>+ Add track to this session…</option>
      {tracks.map((t) => <option key={t.id} value={t.id} style={optStyle}>{KIND_META[t.kind].label} · {t.title}</option>)}
    </select>
  );
}
