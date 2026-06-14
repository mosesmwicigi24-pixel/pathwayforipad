// Notifications — full feed page (Final Pathway make). Real feed via the
// NotificationsProvider (AdminApi.notifications); read/dismiss client-side.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronLeft, Bell, Check, CheckCheck, X, Search, Inbox, Dot, Archive } from "lucide-react";
import {
  useNotifications, notifTimeAgo, notifDayLabel,
  CATEGORY_META, type NotifCategory, type AppNotification,
} from "../notifications/NotificationsProvider";

type FilterTab = "all" | "unread";
type CatFilter = "all" | NotifCategory;

const CAT_FILTERS: { key: CatFilter; label: string }[] = [
  { key: "all", label: "All types" },
  { key: "info", label: "Updates" },
  { key: "success", label: "Success" },
  { key: "warning", label: "Alerts" },
  { key: "security", label: "Security" },
];

const PAGE_SIZE = 50;
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function Notifications(): ReactElement {
  const navigate = useNavigate();
  const { notifications, unreadCount, markRead, markUnread, markAllRead, remove } = useNotifications();

  const [tab, setTab] = useState<FilterTab>("all");
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => setPage(0), [tab, catFilter, query]);

  const filtered = useMemo(() => notifications.filter((n) => {
    if (tab === "unread" && n.read) return false;
    if (catFilter !== "all" && n.category !== catFilter) return false;
    if (query.trim() && !`${n.title} ${n.message ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  }), [notifications, tab, catFilter, query]);

  const { pages, archiveCount } = useMemo(() => {
    const now = Date.now();
    const recent = filtered.filter((n) => now - n.at <= WEEK).slice(0, PAGE_SIZE);
    const recentIds = new Set(recent.map((n) => n.id));
    const rest = filtered.filter((n) => !recentIds.has(n.id));
    const built: AppNotification[][] = [recent];
    for (let i = 0; i < rest.length; i += PAGE_SIZE) built.push(rest.slice(i, i + PAGE_SIZE));
    return { pages: built, archiveCount: rest.length };
  }, [filtered]);

  const totalPages = pages.length;
  const safePage = Math.min(page, totalPages - 1);
  const pageItems = pages[safePage] ?? [];
  const isArchivePage = safePage > 0;

  const groups = useMemo(() => {
    const map = new Map<string, AppNotification[]>();
    for (const n of pageItems) {
      const label = notifDayLabel(n.at);
      const arr = map.get(label) ?? [];
      arr.push(n);
      map.set(label, arr);
    }
    return Array.from(map.entries());
  }, [pageItems]);

  const openNotif = (n: AppNotification): void => {
    if (!n.read) markRead(n.id);
    if (n.href) navigate(n.href);
  };

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 40px) 26px" }}>
        <div style={{ maxWidth: 920 }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Workspace</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Notifications</span>
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap" style={{ marginTop: 14 }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-display)", fontSize: 28, color: "#fff", lineHeight: 1.1 }}>Notifications</h1>
              <p style={{ fontSize: 12.5, color: "rgba(232,239,245,0.6)", marginTop: 4 }}>{notifications.length} total · {unreadCount} unread · {archiveCount} archived</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center rounded-xl" style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)", padding: 3 }}>
                <SegBtn active={tab === "all"} onClick={() => setTab("all")}>All</SegBtn>
                <SegBtn active={tab === "unread"} onClick={() => setTab("unread")}>Unread {unreadCount > 0 && <span className="rounded-full" style={{ marginLeft: 5, padding: "0 6px", fontSize: 10, fontWeight: 700, background: "var(--nuru-gold)", color: "#fff" }}>{unreadCount}</span>}</SegBtn>
              </div>
              <button onClick={markAllRead} disabled={unreadCount === 0} className="flex items-center gap-1.5 rounded-xl px-3" style={{ height: 36, border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.08)", fontSize: 12.5, fontWeight: 600, color: "#fff", opacity: unreadCount === 0 ? 0.45 : 1, cursor: unreadCount === 0 ? "default" : "pointer" }}><CheckCheck size={14} /> Mark all read</button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px clamp(16px, 4vw, 40px) 40px", maxWidth: 920 }}>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: 16 }}>
          <div className="flex items-center gap-2 rounded-xl" style={{ height: 38, background: "#fff", border: "1px solid var(--border)", padding: "0 12px", flex: "1 1 220px", minWidth: 200 }}>
            <Search size={14} style={{ color: "var(--muted-foreground)" }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notifications…" className="bg-transparent outline-none flex-1" style={{ fontSize: 13, color: "var(--foreground)" }} />
            {query && <button onClick={() => setQuery("")} style={{ color: "var(--muted-foreground)", background: "none", border: "none" }} aria-label="Clear search"><X size={14} /></button>}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {CAT_FILTERS.map((c) => {
              const active = catFilter === c.key;
              return <button key={c.key} onClick={() => setCatFilter(c.key)} className="rounded-full" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, border: "1px solid " + (active ? "var(--nuru-gold)" : "var(--border)"), background: active ? "rgba(200,155,60,0.12)" : "#fff", color: active ? "var(--nuru-gold)" : "var(--muted-foreground)" }}>{c.label}</button>;
            })}
          </div>
        </div>

        <div className="flex items-center gap-2" style={{ marginBottom: 10 }}>
          {isArchivePage ? <Archive size={14} style={{ color: "var(--nuru-gold)" }} /> : <Bell size={14} style={{ color: "var(--nuru-gold)" }} />}
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{isArchivePage ? "Archive" : "Recent · last 7 days"}</span>
          <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{isArchivePage ? "Older notifications kept on record" : "Latest activity, up to 50 items"}</span>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
          {pageItems.length === 0 ? (
            <EmptyState hasAny={notifications.length > 0} tab={tab} hasArchive={archiveCount > 0} onBrowseArchive={() => setPage(1)} />
          ) : (
            groups.map(([label, items]) => (
              <div key={label}>
                <div className="sticky top-0" style={{ padding: "9px 18px", background: "var(--input-background)", borderBottom: "1px solid var(--border)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted-foreground)", zIndex: 1 }}>{label}</div>
                {items.map((n) => {
                  const cat = CATEGORY_META[n.category];
                  const CatIcon = cat.icon;
                  return (
                    <div key={n.id} onClick={() => openNotif(n)} className="group flex gap-3.5 px-4 py-3.5 transition-colors hover:bg-gray-50" style={{ borderBottom: "1px solid var(--border)", cursor: "pointer", background: n.read ? "#fff" : "rgba(200,155,60,0.045)" }}>
                      <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: cat.bg, color: cat.color, marginTop: 1 }}><CatIcon size={18} /></div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span style={{ fontSize: 13.5, color: "var(--nuru-navy)", fontWeight: n.read ? 600 : 700 }}>{n.title}</span>
                          <span className="rounded-full" style={{ padding: "1px 8px", fontSize: 9.5, fontWeight: 700, color: cat.color, background: cat.bg, letterSpacing: "0.03em", textTransform: "uppercase" }}>{cat.label}</span>
                        </div>
                        {n.message && <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.45, marginTop: 3 }}>{n.message}</p>}
                        <div className="flex items-center gap-1 mt-1.5" style={{ fontSize: 11.5, fontWeight: 600, color: n.href ? "var(--nuru-gold)" : "var(--muted-foreground)" }}>
                          {n.href ? <>Tap to view <ChevronRight size={12} /></> : <span style={{ color: "var(--muted-foreground)", fontWeight: 500 }}>No linked page</span>}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{notifTimeAgo(n.at)}</span>
                        <div className="flex items-center gap-1">
                          <button onClick={(e) => { e.stopPropagation(); if (n.read) markUnread(n.id); else markRead(n.id); }} title={n.read ? "Mark as unread" : "Mark as read"} className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}>{n.read ? <Dot size={16} /> : <Check size={14} />}</button>
                          <button onClick={(e) => { e.stopPropagation(); remove(n.id); }} title="Dismiss" className="rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-gray-200" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><X size={14} /></button>
                          {!n.read && <span className="rounded-full shrink-0" style={{ width: 8, height: 8, background: "var(--nuru-gold)" }} />}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3 flex-wrap" style={{ marginTop: 16 }}>
            <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{safePage === 0 ? "Showing recent activity" : `Archive page ${safePage} of ${totalPages - 1}`}</span>
            <div className="flex items-center gap-2">
              <PagerBtn disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}><ChevronLeft size={14} /> Previous</PagerBtn>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--nuru-navy)", minWidth: 64, textAlign: "center" }}>{safePage + 1} / {totalPages}</span>
              <PagerBtn disabled={safePage >= totalPages - 1} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} primary>Next <ChevronRight size={14} /></PagerBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return <button onClick={onClick} className="flex items-center rounded-lg" style={{ padding: "6px 14px", fontSize: 12.5, fontWeight: 600, background: active ? "var(--nuru-gold)" : "transparent", color: active ? "#fff" : "rgba(232,239,245,0.7)", border: "none" }}>{children}</button>;
}
function PagerBtn({ children, onClick, disabled, primary }: { children: ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }): ReactElement {
  return <button onClick={onClick} disabled={disabled} className="flex items-center gap-1 rounded-xl px-3" style={{ height: 36, fontSize: 12.5, fontWeight: 600, border: "1px solid " + (primary && !disabled ? "var(--nuru-gold)" : "var(--border)"), background: primary && !disabled ? "var(--nuru-gold)" : "#fff", color: disabled ? "var(--muted-foreground)" : primary ? "#fff" : "var(--nuru-navy)", opacity: disabled ? 0.5 : 1, cursor: disabled ? "default" : "pointer" }}>{children}</button>;
}
function EmptyState({ hasAny, tab, hasArchive, onBrowseArchive }: { hasAny: boolean; tab: FilterTab; hasArchive: boolean; onBrowseArchive: () => void }): ReactElement {
  const unreadEmpty = hasAny && tab === "unread";
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: "64px 24px" }}>
      <div className="flex items-center justify-center rounded-2xl" style={{ width: 56, height: 56, background: "var(--input-background)", color: "var(--muted-foreground)", marginBottom: 16 }}>{unreadEmpty ? <Bell size={26} /> : <Inbox size={26} />}</div>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--nuru-navy)" }}>{unreadEmpty ? "You're all caught up" : "Nothing in the last 7 days"}</h3>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4, maxWidth: 340 }}>{unreadEmpty ? "Every notification has been read. New activity across the portal will show up here." : "No recent activity. Older notifications are kept in the archive."}</p>
      {hasArchive && <button onClick={onBrowseArchive} className="flex items-center gap-1.5 rounded-xl px-4" style={{ height: 36, marginTop: 16, border: "1px solid var(--border)", background: "#fff", fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)" }}><Archive size={14} /> Browse archive</button>}
    </div>
  );
}
