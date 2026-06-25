// Announcement alerts (§1.5 member-facing). The platform can't deliver true
// remote push under the current signing (free Apple team → no APNs entitlement,
// and the backend push provider is a stub), so we alert *while the app is alive*:
// poll the member's announcement feed, diff against a persisted set of already-seen
// ids, and for each genuinely new one fire a sound + vibration + an in-app heads-up
// banner. No new native dependency — vibration is RN core, the chime plays through
// the audio module the app already ships (react-native-audio-recorder-player).
import { type AppStateStatic } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NuruApi } from "../api/client";
import type { MyAnnouncement } from "../api/types";
import { displayLocal } from "./localNotify";

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

  // A real OS notification per new announcement (tray + vibrate + sound, toggleable
  // in phone settings) PLUS the in-app heads-up banner when the app is open. The OS
  // notification supplies the buzz/chime, so we no longer fire the raw RN vibration.
  fresh.slice(0, 3).forEach((a) => {
    void displayLocal({
      title: a.title || "New announcement",
      ...(a.body ? { body: a.body } : {}),
      channel: "general",
      data: { template: "announcement", announcement_id: a.announcement_id, ...(a.title ? { title: a.title } : {}) },
    });
    listeners.forEach((fn) => fn(a));
  });
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
