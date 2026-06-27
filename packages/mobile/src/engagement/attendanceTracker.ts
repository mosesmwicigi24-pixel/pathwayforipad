// App-engagement attendance. A member is "present" on a day when they spend at
// least 5 minutes in the app AND do some activity. We then log ONE 'attendance'
// interaction event for that day — offline-safe via the sync queue, idempotent —
// which feeds the Attendance score (§ scores) and the portal member statistics.
// One signal per day, best-effort: if the queue/store isn't ready it retries on
// the next tick, and an AsyncStorage guard prevents a re-emit across launches.
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getSyncEngine } from "../sync/engineProvider";
import { getConnectivity } from "../net/connectivity";

const PRESENT_MS = 5 * 60 * 1000; // 5 minutes of foreground time
const TICK_MS = 30_000;
const STORE_KEY = "attendance:lastMarked"; // YYYY-MM-DD of the last emitted day

let activeMs = 0; // cumulative foreground ms for `day`
let day = ""; // the local date the counter belongs to
let lastResume = 0; // timestamp of the last foreground transition (0 = backgrounded)
let hadActivity = false; // did the member do something this day
let marked = false; // already emitted for `day`
let started = false;

function localDay(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rollDay(): void {
  const today = localDay();
  if (today !== day) {
    day = today;
    activeMs = 0;
    hadActivity = false;
    marked = false;
  }
}

/** Mark that the member did something meaningful (called on navigation). */
export function markActivity(): void {
  hadActivity = true;
}

function accumulate(): void {
  if (lastResume > 0) {
    rollDay();
    activeMs += Date.now() - lastResume;
    lastResume = Date.now();
  }
}

async function maybeEmit(): Promise<void> {
  rollDay();
  if (marked || !hadActivity || activeMs < PRESENT_MS) return;
  const last = await AsyncStorage.getItem(STORE_KEY).catch(() => null);
  if (last === day) {
    marked = true; // already counted today on a previous launch
    return;
  }
  marked = true; // optimistic — clear on failure so the next tick retries
  try {
    await getSyncEngine().enqueue("interaction_events", "record", { kind: "attendance", occurred_at: new Date().toISOString() });
    await AsyncStorage.setItem(STORE_KEY, day).catch(() => undefined);
    void getSyncEngine().syncIfOnline(getConnectivity()); // best-effort flush so it lands today
  } catch {
    marked = false;
  }
}

/** Start tracking foreground time + activity. Returns a stop function. */
export function startAttendanceTracking(): () => void {
  if (started) return () => {};
  started = true;
  day = localDay();
  lastResume = AppState.currentState === "active" ? Date.now() : 0;
  const onState = (s: AppStateStatus): void => {
    if (s === "active") {
      rollDay();
      lastResume = Date.now();
    } else {
      accumulate();
      lastResume = 0;
    }
  };
  const sub = AppState.addEventListener("change", onState);
  const timer = setInterval(() => {
    accumulate();
    void maybeEmit();
  }, TICK_MS);
  return () => {
    sub.remove();
    clearInterval(timer);
    started = false;
  };
}
