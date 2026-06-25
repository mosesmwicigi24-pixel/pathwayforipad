// Local OS notifications (Notifee). These are REAL phone notifications — they show
// in the system tray / lock screen, vibrate, play a sound, and are toggleable in
// the phone's Settings (per-channel on Android). No Firebase / APNs needed: the app
// schedules + displays them on-device, so this works under the current free signing
// on both platforms. Remote (closed-app, server-pushed) notifications still require
// FCM/APNs — see docs; this module is the local layer that works today.
//
// Every call is wrapped so a notification failure can never crash the app.
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  AuthorizationStatus,
  EventType,
  RepeatFrequency,
  TriggerType,
  type TimestampTrigger,
} from "@notifee/react-native";
import { Platform } from "react-native";
import { navigate } from "../navigation/navigationRef";

export type NotifChannel = "messages" | "encouragements" | "reminders" | "events" | "general";

// Android notification channels. Each appears in Settings → Apps → Nuru Place →
// Notifications, where the member can independently toggle / silence it. iOS has no
// channels (it ignores channelId) — there the single app-level toggle governs all.
const CHANNELS: { id: NotifChannel; name: string; description: string }[] = [
  { id: "messages", name: "Messages", description: "Direct messages and group chats" },
  { id: "encouragements", name: "Encouragement", description: "Encouragement, reflections and celebrations" },
  { id: "reminders", name: "Reminders", description: "Daily verse and rhythm reminders" },
  { id: "events", name: "Events", description: "Upcoming gatherings and reminders" },
  { id: "general", name: "General", description: "Announcements and other updates" },
];

let channelsReady = false;
export async function ensureChannels(): Promise<void> {
  if (Platform.OS !== "android" || channelsReady) return;
  try {
    for (const c of CHANNELS) {
      await notifee.createChannel({
        id: c.id,
        name: c.name,
        description: c.description,
        importance: AndroidImportance.HIGH, // heads-up + sound + vibrate
        vibration: true,
        vibrationPattern: [300, 500],
        visibility: AndroidVisibility.PUBLIC,
      });
    }
    channelsReady = true;
  } catch {
    /* channel creation failed — notifications will still try the default channel */
  }
}

/** Ask the OS for notification permission (iOS prompt; Android 13+ runtime grant). */
export async function requestNotifPermission(): Promise<boolean> {
  try {
    const settings = await notifee.requestPermission();
    return (
      settings.authorizationStatus === AuthorizationStatus.AUTHORIZED ||
      settings.authorizationStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch {
    return false;
  }
}

/** Display a real OS notification now (tray + vibrate + sound). */
export async function displayLocal(opts: {
  title: string;
  body?: string;
  channel: NotifChannel;
  data?: Record<string, string>;
}): Promise<void> {
  try {
    await ensureChannels();
    await notifee.displayNotification({
      title: opts.title,
      ...(opts.body ? { body: opts.body } : {}),
      data: opts.data ?? {},
      android: {
        channelId: opts.channel,
        importance: AndroidImportance.HIGH,
        smallIcon: "ic_launcher",
        pressAction: { id: "default", launchActivity: "default" },
        showTimestamp: true,
      },
      ios: { sound: "default" },
    });
  } catch {
    /* non-fatal */
  }
}

// A daily reminder fires at a set time EVEN IF the app is closed — the OS holds the
// scheduled trigger. This is the one "closed-app" notification local can do (it's
// time-based, not server-driven).
const DAILY_ID = "daily-verse-reminder";
export async function scheduleDailyReminder(hour = 7, minute = 0): Promise<void> {
  try {
    await ensureChannels();
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    const trigger: TimestampTrigger = {
      type: TriggerType.TIMESTAMP,
      timestamp: next.getTime(),
      repeatFrequency: RepeatFrequency.DAILY,
    };
    await notifee.createTriggerNotification(
      {
        id: DAILY_ID,
        title: "Time with God 🕊️",
        body: "Your verse for today is ready — take a quiet moment.",
        data: { template: "reminder_daily" },
        android: { channelId: "reminders", smallIcon: "ic_launcher", pressAction: { id: "default", launchActivity: "default" } },
        ios: { sound: "default" },
      },
      trigger,
    );
  } catch {
    /* non-fatal */
  }
}

export async function cancelDailyReminder(): Promise<void> {
  try {
    await notifee.cancelTriggerNotification(DAILY_ID);
  } catch {
    /* non-fatal */
  }
}

/** Open the OS notification settings for this app (where the toggles live). */
export async function openNotificationSettings(): Promise<void> {
  try {
    await notifee.openNotificationSettings();
  } catch {
    /* non-fatal */
  }
}

/** Map a notification template to the channel it belongs in. */
export function channelForTemplate(template: string): NotifChannel {
  const t = template || "";
  if (t.startsWith("chat") || t.startsWith("message") || t.startsWith("dm")) return "messages";
  if (t.startsWith("event")) return "events";
  if (t.startsWith("reengage") || t.startsWith("reminder")) return "reminders";
  if (
    t.startsWith("encourage") || t.startsWith("reflection") || t.startsWith("badge") ||
    t.startsWith("level") || t.startsWith("certificate") || t.startsWith("celebration")
  ) {
    return "encouragements";
  }
  return "general";
}

/** Navigate to the right screen from a tapped notification's data (mirrors the
 *  in-app Notifications screen routing). Data values are strings (Notifee limit). */
export function routeFromData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  const t = String(data.template ?? "");
  const announcementId = typeof data.announcement_id === "string" ? data.announcement_id : null;
  const moduleId = typeof data.module_id === "string" ? data.module_id : null;
  const conversationId = typeof data.conversation_id === "string" ? data.conversation_id : null;
  if (t.startsWith("announcement")) {
    if (announcementId) navigate("AnnouncementDetail", { announcementId, ...(typeof data.title === "string" ? { title: data.title } : {}) });
    else navigate("Tabs", { screen: "Events" });
  } else if (t.startsWith("chat") || t.startsWith("message") || t.startsWith("dm")) {
    if (conversationId) navigate("ChatThread", { conversationId });
    else navigate("Tabs", { screen: "Chat" });
  } else if (t.startsWith("reflection")) {
    if (moduleId) navigate("Module", { moduleId });
    else navigate("Tabs", { screen: "Pathway" });
  } else if (t.startsWith("event")) {
    navigate("Calendar");
  } else if (t.startsWith("level") || t.startsWith("certificate") || t.startsWith("badge") || t.startsWith("celebration")) {
    navigate("Tabs", { screen: "Profile" });
  } else if (t.startsWith("giving")) {
    navigate("Tabs", { screen: "Give" });
  } else if (t.startsWith("reminder") || t === "reengage") {
    navigate("Tabs", { screen: "Home" });
  } else {
    navigate("Notifications");
  }
}

/** Register the in-app tap handler + route a cold-start tap. Returns an unsubscribe. */
export function initNotificationTaps(): () => void {
  void notifee
    .getInitialNotification()
    .then((initial) => {
      if (initial?.notification?.data) {
        // Defer so the navigator is mounted/ready.
        setTimeout(() => routeFromData(initial.notification.data), 600);
      }
    })
    .catch(() => undefined);
  return notifee.onForegroundEvent(({ type, detail }) => {
    if (type === EventType.PRESS && detail.notification?.data) routeFromData(detail.notification.data);
  });
}
