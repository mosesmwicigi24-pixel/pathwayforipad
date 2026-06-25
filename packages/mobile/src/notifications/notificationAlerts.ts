// Bell-feed → OS notifications. Polls the member's notification feed while the app
// is alive and raises a real OS notification (vibrate + sound + tray) for each new
// item, so the phone alerts the member instead of only the in-app bell. Announcement
// templates are skipped here — announcementAlerts.ts owns those — so nothing alerts
// twice. Diff/seen-id persistence mirrors announcementAlerts.
import { AppState, type AppStateStatic, type NativeEventSubscription } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NuruApi } from "../api/client";
import type { NotificationRow } from "../api/types";
import { channelForTemplate, displayLocal } from "./localNotify";

const SEEN_KEY = "notif:seenIds:v1";
const MAX_SEEN = 400;
const POLL_MS = 45_000;

let seen = new Set<string>();
let loaded = false;

async function loadSeen(): Promise<void> {
  if (loaded) return;
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    if (raw) seen = new Set(JSON.parse(raw) as string[]);
  } catch {
    /* in-memory only this session */
  }
  loaded = true;
}

async function saveSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
  } catch {
    /* ignore */
  }
}

function titleFor(n: NotificationRow): string {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  if (typeof p.title === "string" && p.title) return p.title;
  return (n.template || "Notification").replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function bodyFor(n: NotificationRow): string | undefined {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  if (typeof p.body === "string" && p.body) return p.body;
  if (typeof p.feedback === "string" && p.feedback) return p.feedback;
  const t = n.template || "";
  if (t.startsWith("reflection_approved")) return "Your discipler approved your reflection — well done.";
  if (t.startsWith("reflection")) return "Your discipler has reviewed your reflection.";
  if (t.startsWith("level")) return "You've completed a level. Keep pressing on!";
  if (t.startsWith("badge")) return "You earned a new badge — well done!";
  if (t.startsWith("event")) return "You have an upcoming gathering.";
  if (t === "reengage") return "We've missed you — pick up your journey where you left off.";
  return undefined;
}

/** String-only data bag for the OS notification (drives tap routing). */
function dataFor(n: NotificationRow): Record<string, string> {
  const p = (n.payload ?? {}) as Record<string, unknown>;
  const out: Record<string, string> = { template: n.template || "", notification_id: n.notification_id };
  for (const k of ["announcement_id", "module_id", "conversation_id", "title"]) {
    if (typeof p[k] === "string") out[k] = p[k] as string;
  }
  return out;
}

/** One poll: alert on genuinely new, unread, non-announcement notifications. The
 *  first pull after launch seeds silently so we never blast the backlog. */
export async function checkNotificationsForAlerts(): Promise<void> {
  await loadSeen();
  let rows: NotificationRow[] = [];
  try {
    rows = (await NuruApi.notifications()).data ?? [];
  } catch {
    return; // offline / transient — try again next tick
  }
  const seeding = seen.size === 0;
  let changed = false;
  for (const n of rows) {
    if (!n.notification_id || seen.has(n.notification_id)) continue;
    seen.add(n.notification_id);
    changed = true;
    if (seeding) continue; // first run: remember, don't alert
    if ((n.template || "").startsWith("announcement")) continue; // owned by announcementAlerts
    if (n.read_at) continue; // already read elsewhere — no need to buzz
    void displayLocal({
      title: titleFor(n),
      ...(bodyFor(n) ? { body: bodyFor(n) as string } : {}),
      channel: channelForTemplate(n.template || ""),
      data: dataFor(n),
    });
  }
  if (changed) await saveSeen();
}

/** Start polling while the app is in the foreground. Returns a stop function. */
export function startNotificationAlerts(appState: AppStateStatic = AppState): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = (): void => void checkNotificationsForAlerts();

  const start = (): void => {
    if (timer) return;
    tick();
    timer = setInterval(tick, POLL_MS);
  };
  const stop = (): void => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  start();
  const sub: NativeEventSubscription = appState.addEventListener("change", (s) => {
    if (s === "active") start();
    else stop();
  });

  return () => {
    stop();
    sub.remove();
  };
}
