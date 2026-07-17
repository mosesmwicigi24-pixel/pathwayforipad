// Audio Mixer (/mixer) — the virtual "Mixing Console", faithful to the Figma make
// (ZMEsnrOJCXXY7rHfTBautI) and the studio palette. Intentionally DARK, matching
// RadioStudio. Wire contract: docs/RADIO_STUDIO_CONTRACT.md.
//
// REAL (API-backed): scene presets (mixer_scenes) — load, apply channel levels,
// save the current channels as a scene; on first load with no scenes we seed the
// four defaults (Preaching / Worship / Prayer / Interview). Jingle soundboard
// (mixer_jingles) — load, upload (bytes go to /admin/media/audio/upload so the
// engine can play them on air), remove.
// LIVE MIX (API-backed when the on-air engine is reachable): /mixer/live/status
// is polled every 5s; while connected, the mapped strips (mic1→mic, music→bed,
// jingle→jingle) + master push debounced gains to /mixer/live/levels, applying
// a scene also POSTs /mixer/live/scene, and firing a pad POSTs /mixer/live/jingle.
// LIVE EQ (API-backed when connected): 3-band peaking EQ per bus (mic/bed/master;
// 100 Hz / 1.2 kHz / 8 kHz, −12…+12 dB) POSTs /mixer/live/eq — slider drags are
// debounced ~250ms per bus, preset chips send all 9 bands at once. On mount the
// board hydrates ONCE from /mixer/live/status `gains` (mic/bed/jingle/master
// 0..100 + eq_<bus>_<band> dB) so revisiting the page shows the engine's real
// state instead of Flat/defaults — skipped if the user already touched a fader
// or EQ slider, and never re-applied by later polls.
// LOCAL (client-only): the other strips, VU meters, music-bed player transport.
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  SlidersVertical, Volume2, VolumeX, Headphones, Music, Play, Pause, SkipBack,
  SkipForward, Plus, Trash2, Loader2, Save, Sparkles, Upload, Radio, ShieldAlert,
  AudioWaveform, type LucideIcon,
} from "lucide-react";
import { AxiosError } from "axios";
import {
  RadioApi,
  type MixerScene,
  type MixerJingle,
  type MixerChannel,
  type MixerSceneBody,
  type MixerLiveChannels,
  type MixerEqBus,
  type MixerEqBand,
} from "../../api/client";

/* ── studio palette (shared with RadioStudio) ── */
const BG = "#0A1120";
const PANEL = "linear-gradient(180deg, #131E33 0%, #0F1829 100%)";
const PANEL_BORDER = "rgba(255,255,255,0.08)";
const GOLD = "#E6C66E";
const GOLD_DEEP = "#C89B3C";
const RED = "#EF4444";
const GREEN = "#22C55E";
const TEXT = "#E8EEF7";
const DIM = "rgba(232,238,247,0.55)";
const DIMMER = "rgba(232,238,247,0.38)";
const MONO = "'DM Mono', monospace";
const SERIF = "'DM Serif Display', serif";

/* ── audio upload constraints (mirror the server: 70 MB, MP3/WAV/AAC/ALAC) ── */
const AUDIO_ACCEPT = ".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac";
function validAudio(file: File): string | null {
  if (file.size > 110 * 1024 * 1024) return `${file.name} is over the 110 MB limit`;
  if (!/\.(mp3|wav|m4a|aac|alac)$/i.test(file.name)) return "Only MP3, WAV, AAC or ALAC (.m4a) audio is allowed";
  return null;
}

// Channel palette for the default board (id must be stable — used as scene keys).
const DEFAULT_CHANNELS: MixerChannel[] = [
  { id: "mic1", name: "Host Mic", sub: "Dynamic", color: "#E6C66E", level: 78, pan: 0, muted: false, solo: false },
  { id: "mic2", name: "Guest Mic", sub: "Condenser", color: "#7FB5FF", level: 64, pan: -12, muted: false, solo: false },
  { id: "music", name: "Music Bed", sub: "Stereo", color: "#7BE3A3", level: 42, pan: 0, muted: false, solo: false },
  { id: "phone", name: "Call-in", sub: "Phone", color: "#FB7185", level: 55, pan: 8, muted: true, solo: false },
  { id: "jingle", name: "Jingles", sub: "SFX", color: "#C89B3C", level: 70, pan: 0, muted: false, solo: false },
  { id: "aux", name: "Aux / Video", sub: "HDMI", color: "#B794F6", level: 50, pan: 0, muted: false, solo: false },
];

// Fixed mapping of local strips onto the on-air engine's live buses. Strips not
// listed here (guest mic / call-in / aux) are honest "local" — client hardware
// only, never sent to the engine. The master fader maps to the engine "master".
const LIVE_CHANNEL_MAP: Readonly<Partial<Record<string, MixerLiveChannels>>> = {
  mic1: "mic", // Host Mic
  music: "bed", // Music Bed
  jingle: "jingle",
};

/* ── live EQ (3-band peaking EQ per on-air bus; server applies to broadcast) ── */
type EqState = Record<MixerEqBus, Record<MixerEqBand, number>>;
const EQ_MIN = -12;
const EQ_MAX = 12;
const EQ_BUSES: ReadonlyArray<{ id: MixerEqBus; label: string; sub: string; tint: string }> = [
  { id: "mic", label: "MIC", sub: "Host voice", tint: GOLD },
  { id: "bed", label: "MUSIC BED", sub: "Underscore", tint: "#7BE3A3" },
  { id: "master", label: "MASTER", sub: "Main out", tint: TEXT },
];
const EQ_BANDS: ReadonlyArray<{ id: MixerEqBand; label: string; freq: string }> = [
  { id: "low", label: "LOW", freq: "100 Hz" },
  { id: "mid", label: "MID", freq: "1.2 kHz" },
  { id: "high", label: "HIGH", freq: "8 kHz" },
];
function eqState(
  mic: [number, number, number], bed: [number, number, number], master: [number, number, number],
): EqState {
  return {
    mic: { low: mic[0], mid: mic[1], high: mic[2] },
    bed: { low: bed[0], mid: bed[1], high: bed[2] },
    master: { low: master[0], mid: master[1], high: master[2] },
  };
}
const EQ_FLAT: EqState = eqState([0, 0, 0], [0, 0, 0], [0, 0, 0]);
// Sound presets — one tap sets all 9 bands. Most are tone-only (scenes handle
// levels), but a preset may optionally carry `levels` (0..100 on-air gains for
// the mic/bed buses): applying it then also moves the mapped strips (mic1/music)
// and pushes one /mixer/live/levels POST alongside the EQ POST.
const EQ_PRESETS: ReadonlyArray<{
  id: string; name: string; bands: EqState; levels?: { mic?: number; bed?: number };
}> = [
  { id: "flat", name: "Flat", bands: EQ_FLAT },
  { id: "talk", name: "Talk Show", bands: eqState([-2, 2.5, 3.5], [1, -1.5, -1], [0, 0, 1]), levels: { mic: 93, bed: 10 } },
  { id: "podcast", name: "Podcast Studio", bands: eqState([1.5, 1, 2.5], [0, -2, 0], [0.5, 0, 1]) },
  // Presenter loud and clear, music professionally tucked (mid-carved) underneath.
  { id: "voiceover", name: "Voice Over Music", bands: eqState([-1, 3, 4], [1, -5.5, -2], [0, 0, 0.5]), levels: { mic: 93, bed: 20 } },
  // Levels swing back to music-forward; EQ unchanged.
  { id: "warm", name: "Warm Music", bands: eqState([0, 0, 0], [3, 0, -1], [1, 0, 0]), levels: { mic: 60, bed: 80 } },
  { id: "bright", name: "Bright Music", bands: eqState([0, 0, 0], [1, 0.5, 3], [0, 0, 1.5]) },
];
// +3.5 / −2.0 / 0 — signed one-decimal dB readout (unicode minus, flat shows "0").
function fmtDb(v: number): string {
  return v === 0 ? "0" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
}

// The four scenes seeded on first load. Each preset tweaks channel levels.
const SEED_SCENES: MixerSceneBody[] = [
  { name: "Preaching", hint: "Host mic forward, music low", is_default: true, channels: tweak({ mic1: 88, mic2: 30, music: 18, phone: 0, jingle: 40, aux: 20 }) },
  { name: "Worship", hint: "Music bed up, mics balanced", channels: tweak({ mic1: 62, mic2: 62, music: 82, phone: 0, jingle: 55, aux: 60 }) },
  { name: "Prayer", hint: "Intimate — host only, soft bed", channels: tweak({ mic1: 80, mic2: 20, music: 35, phone: 0, jingle: 25, aux: 10 }) },
  { name: "Interview", hint: "Two mics + call-in balanced", channels: tweak({ mic1: 74, mic2: 74, music: 24, phone: 70, jingle: 40, aux: 20 }) },
];

function tweak(levels: Record<string, number>): MixerChannel[] {
  return DEFAULT_CHANNELS.map((c) => ({ ...c, level: levels[c.id] ?? c.level ?? 50, muted: (levels[c.id] ?? 1) === 0 }));
}

const BED_TRACKS = [
  { id: "b1", name: "Ambient Worship — Calm", len: "8:30" },
  { id: "b2", name: "Piano Underscore — Reflective", len: "6:12" },
  { id: "b3", name: "Uplift Pad — Sunday", len: "10:04" },
];

const JINGLE_COLORS = ["#E6C66E", "#7BE3A3", "#7FB5FF", "#FB7185", "#C89B3C", "#B794F6"];

export function MixerStudio(): ReactElement {
  // ── live board (local) ──
  const [channels, setChannels] = useState<MixerChannel[]>(DEFAULT_CHANNELS);
  const [master, setMaster] = useState(80);
  const [masterMuted, setMasterMuted] = useState(false);
  const [meters, setMeters] = useState<number[]>(() => DEFAULT_CHANNELS.map(() => 0.1));
  const [masterMeter, setMasterMeter] = useState(0.1);

  // ── scenes (API) ──
  const [scenes, setScenes] = useState<MixerScene[] | null>(null);
  const [activeScene, setActiveScene] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingScene, setSavingScene] = useState(false);
  const [sceneName, setSceneName] = useState("");
  const [namingScene, setNamingScene] = useState(false);

  // ── jingles (API) ──
  const [jingles, setJingles] = useState<MixerJingle[]>([]);
  const [uploading, setUploading] = useState(false);
  const [firedJingle, setFiredJingle] = useState<string | null>(null);
  const [jingleNote, setJingleNote] = useState<{ id: string; msg: string } | null>(null);

  // ── live mix engine (API) ──
  const [engineConnected, setEngineConnected] = useState(false);
  const engineRef = useRef(false); // mirror for handlers/timeouts (no stale closures)
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const levelTimers = useRef(new Map<MixerLiveChannels, ReturnType<typeof setTimeout>>());

  // ── live EQ (hydrated once from the engine via /mixer/live/status `gains`) ──
  const [eq, setEq] = useState<EqState>(EQ_FLAT);
  const [eqPreset, setEqPreset] = useState<string | null>("flat");
  const eqRef = useRef<EqState>(EQ_FLAT); // latest bands for debounced POSTs (no stale closures)
  const eqTimers = useRef(new Map<MixerEqBus, ReturnType<typeof setTimeout>>());

  // ── one-shot hydration from the engine's real state ──
  const hydratedRef = useRef(false); // engine state adopted (first connected poll with gains)
  const dirtyRef = useRef(false); // any user fader/EQ edit — blocks hydration for this visit
  // strip levels applied by hydration; re-overlaid if the slower scenes load lands after
  const hydratedLevelsRef = useRef<Partial<Record<string, number>> | null>(null);

  // ── music bed player (local) ──
  const [bedIdx, setBedIdx] = useState(0);
  const [bedPlaying, setBedPlaying] = useState(false);

  const anySolo = channels.some((c) => c.solo);

  // Adopt the engine's real state (status `gains`) so a page revisit shows the
  // broadcast truth instead of Flat/defaults: the nine `eq_<bus>_<band>` dB
  // values (missing key → 0 dB) and the mapped strip/master gains (only keys
  // the engine reported). Pure state adoption — never POSTs back and never
  // arms the debounce timers, since the engine already holds these values.
  const hydrateFromEngine = useCallback((gains: Record<string, number>) => {
    hydratedRef.current = true;
    // EQ bands
    const nextEq: EqState = eqState([0, 0, 0], [0, 0, 0], [0, 0, 0]);
    for (const bus of EQ_BUSES) {
      for (const band of EQ_BANDS) {
        const v = gains[`eq_${bus.id}_${band.id}`];
        if (typeof v === "number" && Number.isFinite(v)) nextEq[bus.id][band.id] = Math.max(EQ_MIN, Math.min(EQ_MAX, v));
      }
    }
    eqRef.current = nextEq;
    setEq(nextEq);
    // Highlight the preset chip only if all 9 bands match one (±0.05 dB);
    // anything else is an implicit "Custom" — no chip lit.
    const match = EQ_PRESETS.find((p) =>
      EQ_BUSES.every((bus) => EQ_BANDS.every((band) => Math.abs(p.bands[bus.id][band.id] - nextEq[bus.id][band.id]) <= 0.05)));
    setEqPreset(match ? match.id : null);
    // Mapped strips (mic1→mic, music→bed, jingle→jingle) + master fader
    const levels: Partial<Record<string, number>> = {};
    for (const [stripId, liveId] of Object.entries(LIVE_CHANNEL_MAP)) {
      const v = liveId ? gains[liveId] : undefined;
      if (typeof v === "number" && Number.isFinite(v)) levels[stripId] = Math.max(0, Math.min(100, Math.round(v)));
    }
    hydratedLevelsRef.current = levels;
    setChannels((cs) => cs.map((c) => {
      const v = levels[c.id];
      return v == null ? c : { ...c, level: v };
    }));
    const m = gains["master"];
    if (typeof m === "number" && Number.isFinite(m)) setMaster(Math.max(0, Math.min(100, Math.round(m))));
  }, []);

  // ── engine status poll (every 5s; endpoint never errors, but be safe) ──
  // The FIRST connected response carrying `gains` hydrates the board — once,
  // and only if the user hasn't touched a fader/EQ yet. A not-connected first
  // poll simply leaves hydratedRef unset, so the next connected poll retries.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      let connected = false;
      let gains: Record<string, number> | undefined;
      try {
        const s = await RadioApi.liveStatus();
        connected = s.connected;
        gains = s.gains;
      } catch { connected = false; }
      if (cancelled) return;
      engineRef.current = connected;
      setEngineConnected(connected);
      if (connected && gains && !hydratedRef.current && !dirtyRef.current) hydrateFromEngine(gains);
    };
    void poll();
    const t = setInterval(() => { void poll(); }, 5000);
    return () => { cancelled = true; clearInterval(t); };
  }, [hydrateFromEngine]);

  // Debounced (~250ms trailing edge, per channel) gain push to the engine.
  // A fader drag collapses to one POST carrying only the changed channel; each
  // live bus has its own timer so mic/bed/jingle/master never clobber each other.
  const pushLiveLevel = useCallback((target: MixerLiveChannels, value: number) => {
    if (!engineRef.current) return; // offline → purely local, no calls
    const timers = levelTimers.current;
    const pending = timers.get(target);
    if (pending) clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      if (!engineRef.current) return; // engine dropped while debouncing
      RadioApi.liveLevels({ [target]: Math.max(0, Math.min(100, Math.round(value))) })
        .then(() => setLiveErr(null))
        .catch(() => setLiveErr("The on-air engine didn't accept a level change."));
    }, 250));
  }, []);

  // Debounced (~250ms trailing edge, per bus) EQ push to the engine. A band
  // drag collapses to one POST carrying just that bus's three bands; each bus
  // has its own timer so mic/bed/master never clobber each other. Offline →
  // purely local; values are kept and POSTed on the next change while connected.
  const pushLiveEq = useCallback((bus: MixerEqBus) => {
    if (!engineRef.current) return;
    const timers = eqTimers.current;
    const pending = timers.get(bus);
    if (pending) clearTimeout(pending);
    timers.set(bus, setTimeout(() => {
      timers.delete(bus);
      if (!engineRef.current) return; // engine dropped while debouncing
      RadioApi.liveEq({ [bus]: { ...eqRef.current[bus] } })
        .then(() => setLiveErr(null))
        .catch(() => setLiveErr("The on-air engine didn't accept an EQ change."));
    }, 250));
  }, []);

  const setEqBand = useCallback((bus: MixerEqBus, band: MixerEqBand, value: number) => {
    dirtyRef.current = true; // user edit — hydration must never overwrite it
    const v = Math.max(EQ_MIN, Math.min(EQ_MAX, value));
    const next: EqState = { ...eqRef.current, [bus]: { ...eqRef.current[bus], [band]: v } };
    eqRef.current = next;
    setEq(next);
    setEqPreset(null); // manual moves clear the active-chip highlight
    pushLiveEq(bus);
  }, [pushLiveEq]);

  const applyEqPreset = useCallback((preset: (typeof EQ_PRESETS)[number]) => {
    dirtyRef.current = true; // user edit — hydration must never overwrite it
    // clone so later slider edits never mutate the preset constants
    const next: EqState = { mic: { ...preset.bands.mic }, bed: { ...preset.bands.bed }, master: { ...preset.bands.master } };
    eqRef.current = next;
    setEq(next);
    setEqPreset(preset.id);
    // drop pending per-bus debounces so they can't overwrite the full-board POST
    eqTimers.current.forEach((t) => clearTimeout(t));
    eqTimers.current.clear();
    // Levels-carrying presets also move the mapped strip faders (mic1→mic,
    // music→bed) so the console mirrors what goes on air; affected strips are
    // unmuted since the preset asserts they're audible at these levels. The
    // engine gets ONE /mixer/live/levels POST below — so drop any pending
    // per-channel debounces instead of firing them again here.
    const levels: Partial<Record<MixerLiveChannels, number>> = {};
    if (preset.levels?.mic != null) levels.mic = Math.max(0, Math.min(100, Math.round(preset.levels.mic)));
    if (preset.levels?.bed != null) levels.bed = Math.max(0, Math.min(100, Math.round(preset.levels.bed)));
    if (preset.levels) {
      setChannels((cs) => cs.map((c) => {
        const live = LIVE_CHANNEL_MAP[c.id];
        const v = live ? levels[live] : undefined;
        return v == null ? c : { ...c, level: v, muted: false };
      }));
      for (const target of Object.keys(levels) as MixerLiveChannels[]) {
        const pending = levelTimers.current.get(target);
        if (pending) { clearTimeout(pending); levelTimers.current.delete(target); }
      }
    }
    if (!engineRef.current) return; // offline → local only
    RadioApi.liveEq(next)
      .then(() => setLiveErr(null))
      .catch(() => setLiveErr(`"${preset.name}" EQ was applied locally, but the on-air engine didn't take it.`));
    if (preset.levels) {
      RadioApi.liveLevels(levels)
        .then(() => setLiveErr(null))
        .catch(() => setLiveErr(`"${preset.name}" levels were applied locally, but the on-air engine didn't take them.`));
    }
  }, []);

  // flush pending debounce timers on unmount
  useEffect(() => {
    const timers = levelTimers.current;
    const eqT = eqTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t)); timers.clear();
      eqT.forEach((t) => clearTimeout(t)); eqT.clear();
    };
  }, []);

  // ── load scenes (seed defaults if none) + jingles ──
  const load = useCallback(async () => {
    setLoading(true);
    setForbidden(false);
    setErr(null);
    try {
      let list = await RadioApi.scenes();
      if (list.length === 0) {
        // Seed the four defaults the first time this board is opened.
        const created: MixerScene[] = [];
        for (const s of SEED_SCENES) {
          try { created.push(await RadioApi.createScene(s)); } catch { /* tolerate partial seed */ }
        }
        list = created.length ? created : list;
      }
      setScenes(list);
      const def = list.find((s) => s.is_default) ?? list[0];
      if (def) {
        setActiveScene(def.id);
        if (def.channels?.length) {
          // If the status poll already hydrated engine gains (it usually beats
          // this slower scenes load), keep those — the engine is the truth.
          const hydrated = hydratedLevelsRef.current;
          setChannels(hydrated
            ? def.channels.map((c) => {
                const v = hydrated[c.id];
                return v == null ? c : { ...c, level: v };
              })
            : def.channels);
        }
      }
    } catch (e: unknown) {
      const status = e instanceof AxiosError ? e.response?.status : undefined;
      if (status === 403) setForbidden(true);
      else setErr("Could not load mixer scenes. Please try again.");
      setScenes(null);
    } finally {
      setLoading(false);
    }
    try { setJingles(await RadioApi.jingles()); } catch { /* jingles optional */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // ── VU meters (client-simulated) ──
  useEffect(() => {
    const t = setInterval(() => {
      setMeters(channels.map((c) => {
        const audible = !c.muted && (!anySolo || c.solo) && !masterMuted;
        const drive = ((c.level ?? 0) / 100) * (master / 100);
        return audible ? Math.min(1, 0.1 + Math.random() * drive * 1.1) : 0.03 + Math.random() * 0.02;
      }));
      const mix = masterMuted ? 0.02 : Math.min(1, 0.15 + Math.random() * (master / 100) * 0.8);
      setMasterMeter(mix);
    }, 120);
    return () => clearInterval(t);
  }, [channels, anySolo, master, masterMuted]);

  const setChan = (id: string, patch: Partial<MixerChannel>) =>
    setChannels((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const applyScene = (scene: MixerScene) => {
    dirtyRef.current = true; // user chose these levels — hydration must not overwrite
    setActiveScene(scene.id);
    if (scene.channels?.length) {
      // Apply saved levels/pan/mute onto the current board by channel id.
      setChannels((cs) => cs.map((c): MixerChannel => {
        const saved = scene.channels.find((s) => s.id === c.id);
        if (!saved) return c;
        return {
          ...c,
          level: saved.level ?? c.level ?? 0,
          pan: saved.pan ?? c.pan ?? 0,
          muted: saved.muted ?? c.muted ?? false,
        };
      }));
    }
    // Mirror the scene onto the on-air engine (server maps strips → live buses).
    if (engineRef.current) {
      RadioApi.liveScene(scene.id)
        .then(() => setLiveErr(null))
        .catch(() => setLiveErr(`"${scene.name}" was applied locally, but the on-air engine didn't take it.`));
    }
  };

  const saveScene = useCallback(async () => {
    const name = sceneName.trim();
    if (!name) return;
    setSavingScene(true);
    setErr(null);
    try {
      const created = await RadioApi.createScene({ name, hint: "Saved from the live board", channels });
      setScenes((ss) => [...(ss ?? []), created]);
      setActiveScene(created.id);
      setSceneName("");
      setNamingScene(false);
    } catch {
      setErr("Could not save the scene.");
    } finally {
      setSavingScene(false);
    }
  }, [sceneName, channels]);

  const deleteScene = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteScene(id);
      setScenes((ss) => (ss ? ss.filter((s) => s.id !== id) : ss));
      setActiveScene((a) => (a === id ? null : a));
    } catch {
      setErr("Could not delete the scene.");
    }
  }, []);

  const uploadJingles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    const list = Array.from(files);
    for (let i = 0; i < list.length; i++) {
      const f = list[i]!;
      const invalid = validAudio(f);
      if (invalid) { setErr(invalid); continue; }
      try {
        // REAL upload — the bytes go to our /media store so the on-air engine
        // can actually play the pad (object-URL placeholders are unplayable
        // server-side and make /mixer/live/jingle return 422).
        const { url } = await RadioApi.uploadAudio(f);
        const created = await RadioApi.createJingle({
          label: f.name.replace(/\.[^.]+$/, "").slice(0, 40),
          color: JINGLE_COLORS[(jingles.length + i) % JINGLE_COLORS.length]!,
          audio_url: url,
          sort: jingles.length + i,
        });
        setJingles((js) => [...js, created]);
      } catch {
        setErr(`Could not upload "${f.name}".`);
      }
    }
    setUploading(false);
  }, [jingles.length]);

  // Fire a pad: always flash locally; when the engine is connected, put it on
  // air too. 422 = the stored audio_url isn't server-hosted (old placeholder).
  const fireJingle = useCallback((j: MixerJingle) => {
    setFiredJingle(j.id);
    window.setTimeout(() => setFiredJingle((cur) => (cur === j.id ? null : cur)), 450);
    setJingleNote(null);
    if (!engineRef.current) return;
    RadioApi.liveJingle(j.id).catch((e: unknown) => {
      const status = e instanceof AxiosError ? e.response?.status : undefined;
      setJingleNote({
        id: j.id,
        msg: status === 422
          ? "Re-upload this jingle — it isn't stored on the server."
          : "The on-air engine couldn't fire this jingle.",
      });
    });
  }, []);

  const removeJingle = useCallback(async (id: string) => {
    try {
      await RadioApi.deleteJingle(id);
      setJingles((js) => js.filter((j) => j.id !== id));
    } catch {
      setErr("Could not remove the jingle.");
    }
  }, []);

  return (
    <div className="relative overflow-hidden" style={{ minHeight: "100%", background: BG, fontFamily: "'Manrope', sans-serif", color: TEXT }}>
      <style>{`
        .mx-panel { transition: box-shadow .3s ease, border-color .3s ease; }
        .mx-panel:hover { border-color: rgba(230,198,110,0.22); box-shadow: 0 24px 50px -30px rgba(0,0,0,0.9); }
        .mx-btn { transition: transform .15s ease, filter .2s ease, background .2s ease; }
        .mx-btn:hover { filter: brightness(1.08); }
        .mx-btn:active { transform: translateY(1px); }
        .mx-tnum { font-variant-numeric: tabular-nums; }
        .mx-fader { -webkit-appearance: slider-vertical; writing-mode: vertical-lr; direction: rtl; width: 8px; }
        @keyframes mx-spin { to { transform: rotate(360deg); } }
        .mx-spin { animation: mx-spin 1s linear infinite; }
        @keyframes mx-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.55); } 50% { box-shadow: 0 0 0 5px rgba(34,197,94,0); } }
        .mx-pulse { animation: mx-pulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .mx-panel, .mx-spin, .mx-pulse { animation: none !important; transition: none !important; } }
      `}</style>

      {/* ambient glows */}
      <div aria-hidden style={{ position: "absolute", top: -180, left: -80, width: 520, height: 520, borderRadius: "50%", background: "radial-gradient(circle, rgba(200,155,60,0.10), transparent 62%)", pointerEvents: "none" }} />
      <div aria-hidden style={{ position: "absolute", bottom: -120, right: -140, width: 460, height: 460, borderRadius: "50%", background: "radial-gradient(circle, rgba(59,130,246,0.07), transparent 62%)", pointerEvents: "none" }} />

      {/* ── Top bar ── */}
      <div className="relative flex items-center justify-between gap-4 flex-wrap" style={{ padding: "16px clamp(16px,4vw,40px)", borderBottom: `1px solid ${PANEL_BORDER}`, background: "rgba(255,255,255,0.02)", backdropFilter: "blur(6px)" }}>
        <div aria-hidden style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, background: "linear-gradient(90deg, transparent, rgba(200,155,60,0.6), rgba(245,199,126,0.3), transparent)", pointerEvents: "none" }} />
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center rounded-xl" style={{ width: 40, height: 40, background: `linear-gradient(135deg, ${GOLD}, ${GOLD_DEEP})`, color: "#0A1120" }}>
            <SlidersVertical size={20} />
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 18, lineHeight: 1 }}>Mixing Console</div>
            <div style={{ fontSize: 11, color: DIM, marginTop: 3 }}>Virtual audio mixer · Pathway Radio</div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* on-air engine status (polled every 5s) */}
          {engineConnected ? (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(34,197,94,0.12)", border: `1px solid ${GREEN}55`, color: "#86EFAC", fontSize: 12, fontWeight: 700 }}>
              <span className="mx-pulse rounded-full shrink-0" style={{ width: 8, height: 8, background: GREEN }} />
              LIVE MIX · engine connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(255,255,255,0.04)", border: `1px solid ${PANEL_BORDER}`, color: DIMMER, fontSize: 12, fontWeight: 700 }}>
              <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: DIMMER }} />
              LOCAL — mix engine offline
            </span>
          )}
          <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5" style={{ background: "rgba(230,198,110,0.14)", border: `1px solid ${GOLD}44`, color: GOLD, fontSize: 12, fontWeight: 700 }}>
            <Radio size={13} /> {activeScene ? scenes?.find((s) => s.id === activeScene)?.name ?? "Custom" : "Custom"}
          </span>
        </div>
      </div>

      <div className="relative" style={{ padding: "22px clamp(16px,4vw,40px) 44px" }}>
        {forbidden ? (
          <StateCard title="You don't have access" body="The mixer is limited to admins. Ask a SuperAdmin to grant the radio permission if you need access." />
        ) : (
          <div className="grid gap-4 sm:gap-5 grid-cols-1 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
            {/* ══════════ LEFT — the console ══════════ */}
            <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
              {err && (
                <div className="rounded-xl px-3 py-2" style={{ background: "rgba(239,68,68,0.1)", border: `1px solid ${RED}44`, color: "#FCA5A5", fontSize: 12 }}>{err}</div>
              )}
              {liveErr && (
                <div className="rounded-xl px-3 py-2 flex items-center justify-between gap-3" style={{ background: "rgba(230,198,110,0.08)", border: `1px solid ${GOLD}44`, color: GOLD, fontSize: 12 }}>
                  <span>{liveErr}</span>
                  <button onClick={() => setLiveErr(null)} className="mx-btn shrink-0" style={{ background: "none", border: "none", color: GOLD, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
                </div>
              )}

              {/* Channel strips + master */}
              <Panel>
                <SectionHead icon={SlidersVertical} title="Channel strips" hint={`${channels.length} channels`} />
                <div className="flex gap-2.5 overflow-x-auto" style={{ paddingBottom: 6 }}>
                  {channels.map((c, i) => {
                    const liveTarget = LIVE_CHANNEL_MAP[c.id];
                    return (
                      <ChannelStrip
                        key={c.id}
                        channel={c}
                        meter={meters[i] ?? 0}
                        dimmed={anySolo && !c.solo}
                        live={liveTarget != null}
                        onLevel={(v) => {
                          dirtyRef.current = true; // user edit — blocks hydration
                          setChan(c.id, { level: v });
                          if (liveTarget) pushLiveLevel(liveTarget, c.muted ? 0 : v);
                        }}
                        onPan={(v) => setChan(c.id, { pan: v })}
                        onMute={() => {
                          dirtyRef.current = true; // changes the on-air gain — blocks hydration
                          const muted = !c.muted;
                          setChan(c.id, { muted });
                          // mute → gain 0 on air; unmute → re-send the fader value
                          if (liveTarget) pushLiveLevel(liveTarget, muted ? 0 : c.level ?? 0);
                        }}
                        onSolo={() => setChan(c.id, { solo: !c.solo })}
                      />
                    );
                  })}

                  {/* Master strip */}
                  <div className="flex flex-col items-center rounded-2xl shrink-0" style={{ width: 92, padding: "12px 8px", background: "rgba(230,198,110,0.06)", border: `1px solid ${GOLD}33` }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: GOLD, letterSpacing: "0.05em" }}>MASTER</div>
                    <div style={{ fontSize: 9.5, color: DIM, marginTop: 1, marginBottom: 10 }}>Main out</div>
                    <div className="flex items-end justify-center gap-2" style={{ height: 168 }}>
                      <VBar level={masterMeter} tall />
                      <input type="range" min={0} max={100} value={master} onChange={(e) => { dirtyRef.current = true; const v = Number(e.target.value); setMaster(v); pushLiveLevel("master", masterMuted ? 0 : v); }} className="mx-fader" style={{ height: 168, accentColor: GOLD }} />
                    </div>
                    <div className="mx-tnum" style={{ fontFamily: MONO, fontSize: 12, color: GOLD, marginTop: 8 }}>{master}</div>
                    <button onClick={() => { dirtyRef.current = true; const muted = !masterMuted; setMasterMuted(muted); pushLiveLevel("master", muted ? 0 : master); }} className="mx-btn flex items-center justify-center gap-1 rounded-lg mt-2" style={{ width: "100%", height: 30, background: masterMuted ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.05)", border: `1px solid ${masterMuted ? RED + "66" : PANEL_BORDER}`, color: masterMuted ? "#FCA5A5" : DIM, fontSize: 11, fontWeight: 700 }}>
                      {masterMuted ? <VolumeX size={13} /> : <Volume2 size={13} />} {masterMuted ? "Muted" : "Live"}
                    </button>
                  </div>
                </div>
              </Panel>

              {/* Scene presets */}
              <Panel>
                <SectionHead icon={Sparkles} title="Scene presets" hint={loading ? "Loading…" : `${scenes?.length ?? 0} scenes`} />
                {loading ? (
                  <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: DIM, padding: "6px 0" }}>
                    <Loader2 size={14} className="mx-spin" /> Loading scenes…
                  </div>
                ) : (
                  <>
                    <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
                      {(scenes ?? []).map((s) => {
                        const active = s.id === activeScene;
                        return (
                          <div key={s.id} className="rounded-xl relative" style={{ background: active ? "rgba(230,198,110,0.12)" : "rgba(255,255,255,0.03)", border: `1px solid ${active ? GOLD + "66" : PANEL_BORDER}`, padding: "10px 12px" }}>
                            <button onClick={() => applyScene(s)} className="mx-btn text-left w-full" style={{ background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
                              <div className="flex items-center gap-1.5">
                                <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: active ? GOLD : DIMMER }} />
                                <span style={{ fontSize: 13, fontWeight: 700 }}>{s.name}</span>
                                {s.is_default && <span style={{ fontSize: 8.5, fontWeight: 800, color: GOLD, background: "rgba(230,198,110,0.16)", padding: "1px 5px", borderRadius: 99, textTransform: "uppercase" }}>Default</span>}
                              </div>
                              {s.hint && <div style={{ fontSize: 10.5, color: DIM, marginTop: 3, lineHeight: 1.4 }}>{s.hint}</div>}
                            </button>
                            <button onClick={() => deleteScene(s.id)} title="Delete scene" className="mx-btn absolute flex items-center justify-center rounded-md" style={{ top: 6, right: 6, width: 22, height: 22, background: "rgba(255,255,255,0.05)", color: DIMMER, border: "none", cursor: "pointer" }}>
                              <Trash2 size={11} />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {/* Save current board as a scene */}
                    <div style={{ marginTop: 12 }}>
                      {namingScene ? (
                        <div className="flex gap-2 flex-wrap">
                          <input autoFocus value={sceneName} onChange={(e) => setSceneName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveScene(); }} placeholder="Scene name (e.g. Testimony Time)" style={{ flex: 1, minWidth: 180, height: 38, background: "rgba(255,255,255,0.05)", border: `1px solid ${PANEL_BORDER}`, color: TEXT, fontSize: 12.5, borderRadius: 10, padding: "0 12px", outline: "none" }} />
                          <button onClick={saveScene} disabled={savingScene || !sceneName.trim()} className="mx-btn flex items-center gap-1.5 rounded-lg px-4" style={{ height: 38, background: GOLD, color: "#0A1120", fontSize: 12.5, fontWeight: 800, opacity: savingScene || !sceneName.trim() ? 0.6 : 1 }}>
                            {savingScene ? <Loader2 size={14} className="mx-spin" /> : <Save size={14} />} Save
                          </button>
                          <button onClick={() => { setNamingScene(false); setSceneName(""); }} className="mx-btn rounded-lg px-3" style={{ height: 38, background: "rgba(255,255,255,0.06)", color: DIM, fontSize: 12.5, fontWeight: 600 }}>Cancel</button>
                        </div>
                      ) : (
                        <button onClick={() => setNamingScene(true)} className="mx-btn flex items-center justify-center gap-2 rounded-xl w-full py-2.5" style={{ background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px dashed ${GOLD}44`, fontSize: 12.5, fontWeight: 700 }}>
                          <Plus size={14} /> Save current board as a scene
                        </button>
                      )}
                    </div>
                  </>
                )}
              </Panel>

              {/* EQ & sound (LIVE — 3-band peaking EQ per on-air bus) */}
              <Panel>
                <SectionHead icon={AudioWaveform} title="EQ & sound" hint={engineConnected ? "Live — shaping the broadcast" : "Local — engine offline"} />

                {/* preset chips — one tap sets all 9 bands */}
                <div className="flex gap-2 flex-wrap">
                  {EQ_PRESETS.map((p) => {
                    const active = eqPreset === p.id;
                    return (
                      <button key={p.id} onClick={() => applyEqPreset(p)} className="mx-btn rounded-full" style={{ height: 30, padding: "0 14px", background: active ? "rgba(230,198,110,0.18)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? GOLD + "88" : PANEL_BORDER}`, color: active ? GOLD : DIM, fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                        {p.name}
                      </button>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10.5, color: DIMMER, marginTop: 7, marginBottom: 14 }}>
                  Presets shape tone (EQ); Voice Over Music and Warm Music also set mic/bed levels. Use Scenes for full level balance.
                </div>

                {/* three bus groups side by side */}
                <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                  {EQ_BUSES.map((bus) => (
                    <EqBusGroup key={bus.id} bus={bus} values={eq[bus.id]} onBand={(band, v) => setEqBand(bus.id, band, v)} />
                  ))}
                </div>
              </Panel>
            </div>

            {/* ══════════ RIGHT — music bed + jingles ══════════ */}
            <div className="flex flex-col gap-5" style={{ minWidth: 0 }}>
              {/* Music bed player (local) */}
              <Panel>
                <SectionHead icon={Music} title="Music bed" hint={bedPlaying ? "Playing" : "Paused"} />
                <div className="rounded-xl px-3 py-3" style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}` }}>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 44, height: 44, background: "rgba(123,227,163,0.16)", color: "#7BE3A3" }}><Music size={20} /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: 13, fontWeight: 600 }}>{BED_TRACKS[bedIdx]!.name}</div>
                      <div className="mx-tnum" style={{ fontSize: 11, color: DIM, fontFamily: MONO, marginTop: 2 }}>{BED_TRACKS[bedIdx]!.len}</div>
                    </div>
                  </div>
                  <div className="flex items-center justify-center gap-4" style={{ marginTop: 12 }}>
                    <button onClick={() => setBedIdx((i) => (i - 1 + BED_TRACKS.length) % BED_TRACKS.length)} className="mx-btn flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(255,255,255,0.05)", color: DIM, border: "none", cursor: "pointer" }}><SkipBack size={15} /></button>
                    <button onClick={() => setBedPlaying((v) => !v)} className="mx-btn flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: GOLD, color: "#0A1120", border: "none", cursor: "pointer" }}>{bedPlaying ? <Pause size={20} /> : <Play size={20} />}</button>
                    <button onClick={() => setBedIdx((i) => (i + 1) % BED_TRACKS.length)} className="mx-btn flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: "rgba(255,255,255,0.05)", color: DIM, border: "none", cursor: "pointer" }}><SkipForward size={15} /></button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5" style={{ marginTop: 10 }}>
                  {BED_TRACKS.map((t, i) => (
                    <button key={t.id} onClick={() => { setBedIdx(i); setBedPlaying(true); }} className="mx-btn flex items-center gap-2 rounded-lg px-3 py-2 text-left" style={{ background: i === bedIdx ? "rgba(123,227,163,0.1)" : "transparent", border: `1px solid ${i === bedIdx ? "#7BE3A344" : "transparent"}` }}>
                      <span className="rounded-full shrink-0" style={{ width: 6, height: 6, background: i === bedIdx ? "#7BE3A3" : DIMMER }} />
                      <span className="truncate" style={{ flex: 1, fontSize: 12, fontWeight: i === bedIdx ? 700 : 500 }}>{t.name}</span>
                      <span className="mx-tnum" style={{ fontSize: 10.5, color: DIM, fontFamily: MONO }}>{t.len}</span>
                    </button>
                  ))}
                </div>
              </Panel>

              {/* Jingle soundboard (API) */}
              <Panel>
                <SectionHead icon={Headphones} title="Jingle soundboard" hint={`${jingles.length} pads`} />
                <label className="mx-btn flex items-center justify-center gap-2 rounded-xl cursor-pointer mb-3" style={{ height: 36, background: "rgba(230,198,110,0.12)", color: GOLD, border: `1px dashed ${GOLD}44`, fontSize: 12, fontWeight: 700 }}>
                  {uploading ? <Loader2 size={14} className="mx-spin" /> : <Upload size={14} />} Upload jingle
                  <input type="file" accept={AUDIO_ACCEPT} multiple hidden onChange={(e) => uploadJingles(e.target.files)} />
                </label>
                {jingles.length === 0 ? (
                  <div style={{ fontSize: 11.5, color: DIMMER, textAlign: "center", padding: "12px 0" }}>No jingles yet — upload a few short stingers.</div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {jingles.map((j) => {
                      const color = j.color ?? GOLD;
                      const fired = firedJingle === j.id;
                      const noted = jingleNote?.id === j.id;
                      return (
                        <div key={j.id} className="rounded-xl relative flex flex-col items-center justify-center" style={{ minHeight: 76, background: fired ? `${color}30` : `${color}18`, border: `1px solid ${noted ? RED + "77" : fired ? color : color + "44"}`, padding: "12px 8px", boxShadow: fired ? `0 0 18px ${color}66` : "none", transition: "background .15s, border-color .15s, box-shadow .2s" }}>
                          <button onClick={() => fireJingle(j)} className="mx-btn flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: color, color: "#0A1120", border: "none", cursor: "pointer", transform: fired ? "scale(1.12)" : "none", transition: "transform .15s" }} title={engineConnected ? "Fire jingle on air" : "Play jingle (local)"}><Play size={15} /></button>
                          <span className="truncate w-full text-center" style={{ fontSize: 10.5, fontWeight: 700, marginTop: 6, color: TEXT }}>{j.label}</span>
                          <button onClick={() => removeJingle(j.id)} title="Remove" className="mx-btn absolute flex items-center justify-center rounded-md" style={{ top: 5, right: 5, width: 20, height: 20, background: "rgba(0,0,0,0.25)", color: TEXT, border: "none", cursor: "pointer" }}><Trash2 size={10} /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                {jingleNote && (
                  <div className="rounded-lg px-3 py-2 flex items-center justify-between gap-2" style={{ marginTop: 10, background: "rgba(239,68,68,0.08)", border: `1px solid ${RED}44`, color: "#FCA5A5", fontSize: 11 }}>
                    <span><strong>{jingles.find((j) => j.id === jingleNote.id)?.label ?? "Jingle"}</strong> — {jingleNote.msg}</span>
                    <button onClick={() => setJingleNote(null)} className="mx-btn shrink-0" style={{ background: "none", border: "none", color: "#FCA5A5", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}>Dismiss</button>
                  </div>
                )}
              </Panel>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── building blocks ── */
function Panel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }): ReactElement {
  return (
    <div className="mx-panel rounded-2xl" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, padding: 18, boxShadow: "0 18px 40px -28px rgba(0,0,0,0.8)", ...style }}>
      {children}
    </div>
  );
}

function SectionHead({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): ReactElement {
  return (
    <div className="flex items-center justify-between mb-3.5">
      <div className="flex items-center gap-2">
        <Icon size={15} style={{ color: GOLD }} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{title}</span>
      </div>
      {hint && <span style={{ fontSize: 11, color: DIM }}>{hint}</span>}
    </div>
  );
}

function ChannelStrip({ channel, meter, dimmed, live, onLevel, onPan, onMute, onSolo }: {
  channel: MixerChannel; meter: number; dimmed: boolean; live: boolean;
  onLevel: (v: number) => void; onPan: (v: number) => void; onMute: () => void; onSolo: () => void;
}): ReactElement {
  const color = channel.color ?? GOLD;
  const level = channel.level ?? 0;
  const pan = channel.pan ?? 0;
  return (
    <div className="flex flex-col items-center rounded-2xl shrink-0" style={{ width: 88, padding: "12px 8px", background: "rgba(255,255,255,0.03)", border: `1px solid ${PANEL_BORDER}`, opacity: dimmed ? 0.5 : 1, transition: "opacity .15s" }}>
      <div className="flex items-center gap-1.5" style={{ maxWidth: "100%" }}>
        <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: color }} />
        <span className="truncate" style={{ fontSize: 11.5, fontWeight: 700 }}>{channel.name}</span>
      </div>
      {channel.sub && <div className="truncate" style={{ fontSize: 9, color: DIM, marginTop: 1, maxWidth: "100%" }}>{channel.sub}</div>}
      {/* honest badge: strips outside the live path never reach the engine */}
      <div className="flex items-center justify-center" style={{ height: 13, marginTop: 3 }}>
        {!live && (
          <span style={{ fontSize: 7.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: DIMMER, background: "rgba(255,255,255,0.06)", border: `1px solid ${PANEL_BORDER}`, borderRadius: 99, padding: "1px 6px" }} title="Client hardware only — not sent to the on-air mix engine">local</span>
        )}
      </div>

      {/* pan */}
      <div className="w-full flex items-center gap-1" style={{ marginTop: 8 }}>
        <span style={{ fontSize: 8, color: DIMMER }}>L</span>
        <input type="range" min={-50} max={50} value={pan} onChange={(e) => onPan(Number(e.target.value))} style={{ flex: 1, accentColor: color, height: 3 }} title={`Pan ${pan === 0 ? "C" : pan < 0 ? `L${Math.abs(pan)}` : `R${pan}`}`} />
        <span style={{ fontSize: 8, color: DIMMER }}>R</span>
      </div>

      {/* fader + meter */}
      <div className="flex items-end justify-center gap-2" style={{ height: 150, marginTop: 8 }}>
        <VBar level={meter} />
        <input type="range" min={0} max={100} value={level} onChange={(e) => onLevel(Number(e.target.value))} className="mx-fader" style={{ height: 150, accentColor: color }} />
      </div>
      <div className="mx-tnum" style={{ fontFamily: MONO, fontSize: 11, color, marginTop: 6 }}>{level}</div>

      {/* mute / solo */}
      <div className="flex gap-1 w-full" style={{ marginTop: 6 }}>
        <button onClick={onMute} className="mx-btn flex-1 rounded-md" style={{ height: 24, fontSize: 10, fontWeight: 800, background: channel.muted ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.05)", color: channel.muted ? "#FCA5A5" : DIM, border: `1px solid ${channel.muted ? RED + "66" : PANEL_BORDER}` }}>M</button>
        <button onClick={onSolo} className="mx-btn flex-1 rounded-md" style={{ height: 24, fontSize: 10, fontWeight: 800, background: channel.solo ? "rgba(230,198,110,0.22)" : "rgba(255,255,255,0.05)", color: channel.solo ? GOLD : DIM, border: `1px solid ${channel.solo ? GOLD + "66" : PANEL_BORDER}` }}>S</button>
      </div>
    </div>
  );
}

// One EQ bus group (MIC / MUSIC BED / MASTER): three compact vertical band
// sliders styled like the console faders, each with a 0 dB centre-detent tick,
// a signed dB readout and the band's centre frequency underneath.
function EqBusGroup({ bus, values, onBand }: {
  bus: { id: MixerEqBus; label: string; sub: string; tint: string };
  values: Record<MixerEqBand, number>;
  onBand: (band: MixerEqBand, v: number) => void;
}): ReactElement {
  return (
    <div className="rounded-xl" style={{ background: `${bus.tint}0A`, border: `1px solid ${bus.tint}33`, padding: "12px 10px" }}>
      <div className="text-center" style={{ fontSize: 11.5, fontWeight: 800, color: bus.tint, letterSpacing: "0.05em" }}>{bus.label}</div>
      <div className="text-center" style={{ fontSize: 9.5, color: DIM, marginTop: 1, marginBottom: 10 }}>{bus.sub}</div>
      <div className="flex justify-center gap-4">
        {EQ_BANDS.map((band) => {
          const v = values[band.id];
          return (
            <div key={band.id} className="flex flex-col items-center" style={{ width: 46 }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: DIM }}>{band.label}</span>
              {/* vertical gain slider; the faint centre tick marks 0 dB */}
              <div className="relative flex items-center justify-center" style={{ height: 104, marginTop: 6 }}>
                <span aria-hidden style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 20, height: 2, borderRadius: 1, background: "rgba(255,255,255,0.22)", pointerEvents: "none" }} />
                <input
                  type="range" min={EQ_MIN} max={EQ_MAX} step={0.5} value={v}
                  onChange={(e) => onBand(band.id, Number(e.target.value))}
                  className="mx-fader" style={{ height: 104, accentColor: bus.tint }}
                  aria-label={`${bus.label} ${band.label} gain (${band.freq})`}
                  title={`${band.freq} · ${fmtDb(v)} dB`}
                />
              </div>
              <div className="mx-tnum" style={{ fontFamily: MONO, fontSize: 11, color: v === 0 ? DIM : bus.tint, marginTop: 6 }}>{fmtDb(v)}</div>
              <div style={{ fontSize: 8, color: DIMMER, marginTop: 2 }}>{band.freq}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function VBar({ level, tall }: { level: number; tall?: boolean }): ReactElement {
  const segs = tall ? 24 : 20;
  const lit = Math.round(level * segs);
  return (
    <div className="flex flex-col-reverse gap-[2px]" style={{ height: "100%" }}>
      {Array.from({ length: segs }).map((_, i) => {
        const on = i < lit;
        const color = i > segs * 0.85 ? RED : i > segs * 0.62 ? GOLD : GREEN;
        return <span key={i} style={{ width: 6, flex: 1, borderRadius: 1, background: on ? color : "rgba(255,255,255,0.07)", boxShadow: on ? `0 0 5px ${color}77` : "none", transition: "background .1s" }} />;
      })}
    </div>
  );
}

function StateCard({ title, body }: { title: string; body: string }): ReactElement {
  return (
    <Panel style={{ textAlign: "center", padding: 32 }}>
      <span className="mx-auto flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: "rgba(239,68,68,0.12)", color: "#FCA5A5" }}><ShieldAlert size={26} /></span>
      <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 14 }}>{title}</div>
      <div style={{ fontSize: 13, color: DIM, marginTop: 8, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>{body}</div>
    </Panel>
  );
}

export default MixerStudio;
