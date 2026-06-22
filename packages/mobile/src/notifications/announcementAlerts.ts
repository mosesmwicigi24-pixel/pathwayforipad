// Announcement alerts (§1.5 member-facing). The platform can't deliver true
// remote push under the current signing (free Apple team → no APNs entitlement,
// and the backend push provider is a stub), so we alert *while the app is alive*:
// poll the member's announcement feed, diff against a persisted set of already-seen
// ids, and for each genuinely new one fire a sound + vibration + an in-app heads-up
// banner. No new native dependency — vibration is RN core, the chime plays through
// the audio module the app already ships (react-native-audio-recorder-player).
import { Vibration, Image, type AppStateStatic } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import AudioRecorderPlayer from "react-native-audio-recorder-player";
import { NuruApi } from "../api/client";
import type { MyAnnouncement } from "../api/types";
import notifyChime from "../assets/notify.wav";

const SEEN_KEY = "ann:seenIds:v1";
const MAX_SEEN = 300; // keep the persisted set bounded
const POLL_MS = 60_000; // foreground poll cadence

type Listener = (a: MyAnnouncement) => void;
const listeners = new Set<Listener>();
let seen: Set<string> = new Set();
let loaded = false;

/** Subscribe to "a new announcement arrived" — the heads-up toast uses this. */
export function onAnnouncementAlert(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

async function loadSeen(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (raw) seen = new Set(JSON.parse(raw) as string[]);
  } catch {
    /* AsyncStorage unavailable — alert in-memory only this session */
  }
  loaded = true;
}

async function saveSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
  } catch {
    /* ignore persistence failure */
  }
}

// Singleton player (v4 exports a ready instance, no `new`). Best-effort: any
// failure (asset missing, audio session busy) is swallowed so the vibration +
// banner still fire.
const player = AudioRecorderPlayer;
function playChime(): void {
  try {
    const src = Image.resolveAssetSource(notifyChime);
    if (src?.uri) void player.startPlayer(src.uri).catch(() => undefined);
  } catch {
    /* no sound — vibration + banner still alert */
  }
}

function buzz(): void {
  try {
    // pattern: wait, buzz, pause, buzz (ms). iOS ignores the durations and gives
    // a fixed double-tap, which is exactly the "you have a notification" feel.
    Vibration.vibrate([0, 400, 160, 400]);
  } catch {
    /* device without a vibrator */
  }
}

/**
 * Pull the announcement feed and alert on anything new. The first successful pull
 * after launch/login *seeds silently* — we never blast the whole backlog; we only
 * alert on announcements that appear after the member is already set up.
 */
export async function checkAnnouncementsForAlerts(): Promise<void> {
  await loadSeen();
  let list: MyAnnouncement[];
  try {
    list = await NuruApi.myAnnouncements();
  } catch {
    return; // offline or not logged in (401) — try again next tick
  }
  const ids = list.map((a) => a.announcement_id).filter(Boolean);

  if (seen.size === 0) {
    // Seed: mark everything currently visible as already-seen, no alert.
    ids.forEach((id) => seen.add(id));
    await saveSeen();
    return;
  }

  const fresh = list.filter((a) => a.announcement_id && !seen.has(a.announcement_id));
  if (fresh.length === 0) return;
  fresh.forEach((a) => seen.add(a.announcement_id));
  await saveSeen();

  // One sound + buzz for the batch; a banner per new announcement (cap the burst).
  buzz();
  playChime();
  fresh.slice(0, 3).forEach((a) => listeners.forEach((fn) => fn(a)));
}

/**
 * Start the foreground alert loop: an immediate check, a 60s poll, and an extra
 * check whenever the app returns to the foreground. Returns a stop function.
 */
export function startAnnouncementAlerts(appState: AppStateStatic): () => void {
  const tick = (): void => void checkAnnouncementsForAlerts();
  tick();
  const timer = setInterval(tick, POLL_MS);
  const sub = appState.addEventListener("change", (s) => {
    if (s === "active") tick();
  });
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}

/** Forget the seen-set (call on sign-out so the next member re-seeds cleanly). */
export function resetAnnouncementAlerts(): void {
  seen = new Set();
  loaded = false;
  void AsyncStorage.removeItem(SEEN_KEY).catch(() => undefined);
}
