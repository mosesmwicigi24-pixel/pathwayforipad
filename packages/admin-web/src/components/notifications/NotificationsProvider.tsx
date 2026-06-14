// Notifications context — the portal bell + Notifications page. The feed itself is
// REAL: AdminApi.notifications() synthesizes it from live events (pending
// reflections, issued certificates, new members, at-risk engagement, RBAC audit).
// We don't have a per-admin read-state table, so read/dismissed flags are tracked
// client-side in localStorage and overlaid on the fetched feed.
import { createContext, useContext, useEffect, useState, useCallback, useMemo, type ReactElement, type ReactNode } from "react";
import { CheckCircle2, Info, AlertTriangle, ShieldCheck, type LucideIcon } from "lucide-react";
import { AdminApi, type NotificationFeedItem } from "../../api/client";

export type NotifCategory = "success" | "info" | "warning" | "security";

export const CATEGORY_META: Record<NotifCategory, { icon: LucideIcon; color: string; bg: string; label: string }> = {
  success: { icon: CheckCircle2, color: "#16A34A", bg: "rgba(22,163,74,0.12)", label: "Success" },
  info: { icon: Info, color: "#2563EB", bg: "rgba(37,99,235,0.12)", label: "Updates" },
  warning: { icon: AlertTriangle, color: "#D97706", bg: "rgba(217,119,6,0.14)", label: "Alerts" },
  security: { icon: ShieldCheck, color: "#C89B3C", bg: "rgba(200,155,60,0.14)", label: "Security" },
};

export interface AppNotification {
  id: string;
  title: string;
  message?: string;
  category: NotifCategory;
  read: boolean;
  at: number; // epoch ms
  href?: string;
}

interface NotificationsContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clearAll: () => void;
  refresh: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

const LS_READ = "np_notif_read";       // ids the admin has read
const LS_DISMISSED = "np_notif_dismissed"; // ids the admin has dismissed

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function saveSet(key: string, set: Set<string>): void {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* ignore */ }
}

export function NotificationsProvider({ children }: { children: ReactNode }): ReactElement {
  const [feed, setFeed] = useState<NotificationFeedItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadSet(LS_READ));
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => loadSet(LS_DISMISSED));

  const refresh = useCallback(() => {
    AdminApi.notifications().then(setFeed).catch(() => { /* unauthenticated / offline */ });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { saveSet(LS_READ, readIds); }, [readIds]);
  useEffect(() => { saveSet(LS_DISMISSED, dismissedIds); }, [dismissedIds]);

  const notifications = useMemo<AppNotification[]>(() =>
    feed
      .filter((n) => !dismissedIds.has(n.id))
      .map((n) => ({
        id: n.id,
        title: n.title,
        ...(n.message ? { message: n.message } : {}),
        category: n.category,
        read: readIds.has(n.id),
        at: Date.parse(n.at) || 0,
        ...(n.href ? { href: n.href } : {}),
      }))
      .sort((a, b) => b.at - a.at),
    [feed, readIds, dismissedIds]);

  const unreadCount = notifications.reduce((acc, n) => acc + (n.read ? 0 : 1), 0);

  const markRead = useCallback((id: string) => setReadIds((p) => new Set(p).add(id)), []);
  const markUnread = useCallback((id: string) => setReadIds((p) => { const n = new Set(p); n.delete(id); return n; }), []);
  const markAllRead = useCallback(() => setReadIds(() => new Set(feed.map((n) => n.id))), [feed]);
  const remove = useCallback((id: string) => setDismissedIds((p) => new Set(p).add(id)), []);
  const clearAll = useCallback(() => setDismissedIds(() => new Set(feed.map((n) => n.id))), [feed]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markRead, markUnread, markAllRead, remove, clearAll, refresh }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}

export function notifDayLabel(at: number): string {
  const d = new Date(at);
  const today = new Date();
  const startOf = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function notifTimeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 45) return "Just now";
  if (s < 90) return "1 min ago";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}
