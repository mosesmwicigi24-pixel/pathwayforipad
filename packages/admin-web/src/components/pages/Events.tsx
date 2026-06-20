// Events — Nuru Events Command Center, ported from the Figma Make design and wired
// to the live ops/admin APIs.
//   - Calendar grid / Week / List, Today's Ministry Flow, Upcoming, "Active event
//     series" all derive from OpsApi.calendar(now → +60d) → CalendarOccurrence[].
//   - Event insights + recent attendance come from AdminApi.attendanceReport(8).
//   - The attendance / QR drawer + manual check-in + add guest use OpsApi.roster,
//     OpsApi.manualCheckIn and OpsApi.addGuest.
//   - Create Event → OpsApi.createSeries; Announcements section + Create Announcement
//     + the announcement drawer → AnnouncementsApi.
//   - Features with no backend yet (rotating QR secret, insight %, follow-up queue,
//     series pause, RSVP roster) are presentational; each is marked display-only.
import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  AlertCircle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Filter,
  Mail,
  MapPin,
  MessageSquare,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Phone,
  Plus,
  QrCode,
  RefreshCw,
  Repeat,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  OpsApi,
  AdminApi,
  AnnouncementsApi,
  type CalendarOccurrence,
  type EventRoster,
  type RsvpRoster,
  type RsvpRosterRow,
  type RecentEventRow,
  type MemberRow,
  type AnnouncementRow,
  type AnnouncementStats,
} from "../../api/client";
import { errorMessage } from "../../util/error";

/* ------------------------------------------------------------------ */
/* Categories & derivation                                            */
/* ------------------------------------------------------------------ */

type EventCategory = "worship" | "class" | "cell" | "leadership" | "youth" | "special";

const CATEGORY_META: Record<EventCategory, { label: string; color: string; soft: string }> = {
  worship: { label: "Worship", color: "#C89B3C", soft: "#FBF1DA" },
  class: { label: "Class", color: "#0B1F33", soft: "#E1E6ED" },
  cell: { label: "Cell", color: "#16A34A", soft: "#DCF7E4" },
  leadership: { label: "Leadership", color: "#6366F1", soft: "#E4E5FB" },
  youth: { label: "Youth", color: "#2563EB", soft: "#DBE7FE" },
  special: { label: "Special", color: "#F97316", soft: "#FFE6D2" },
};

// No category column on the wire — infer one from the title so pills stay colourful.
function deriveCategory(occ: { title: string; cell_group_id: string | null }): EventCategory {
  const t = occ.title.toLowerCase();
  if (/worship|service|prayer/.test(t)) return "worship";
  if (/class|discipleship|pathway|lesson|study/.test(t)) return "class";
  if (/leader|training|sync/.test(t)) return "leadership";
  if (/youth|teen|ablaze|fellowship/.test(t)) return "youth";
  if (/cell|home group/.test(t) || occ.cell_group_id) return "cell";
  return "special";
}

/* ------------------------------------------------------------------ */
/* UI occurrence shape (mapped from CalendarOccurrence + roster)       */
/* ------------------------------------------------------------------ */

type UiOccurrence = {
  id: string;
  seriesId: string;
  originalStartAt: string; // original recurrence instant (exception key)
  title: string;
  category: EventCategory;
  iso: string; // YYYY-MM-DD (local)
  startsAt: string; // raw ISO
  endsAt: string;
  date: string; // "Sun 7 Jun 2026"
  time: string; // "9:00 AM"
  endTime: string;
  duration: string;
  location: string;
  cellGroupId: string | null;
  visibility: string;
};

const localIso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const fmtTime = (d: Date): string =>
  Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtDateShort = (d: Date): string =>
  Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function durationLabel(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function toUi(occ: CalendarOccurrence): UiOccurrence {
  const start = new Date(occ.start_at);
  const end = new Date(occ.end_at);
  return {
    id: occ.occurrence_id,
    seriesId: occ.series_id,
    originalStartAt: occ.original_start_at,
    title: occ.title,
    category: deriveCategory(occ),
    iso: localIso(start),
    startsAt: occ.start_at,
    endsAt: occ.end_at,
    date: fmtDateShort(start),
    time: fmtTime(start),
    endTime: fmtTime(end),
    duration: durationLabel(start, end),
    location: occ.location ?? "Location TBC",
    cellGroupId: occ.cell_group_id,
    visibility: occ.visibility,
  };
}

type AnnouncementStatusLabel = "Draft" | "Scheduled" | "Sent" | "Failed";
const announcementStatusLabel = (s: AnnouncementRow["status"]): AnnouncementStatusLabel => {
  if (s === "scheduled") return "Scheduled";
  if (s === "sent") return "Sent";
  if (s === "cancelled") return "Failed";
  return "Draft";
};
const fmtAnnouncementWhen = (a: AnnouncementRow): string => {
  const iso = a.sent_at ?? a.scheduled_at;
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · ${fmtTime(d)}`;
};
const audienceLabel = (a: AnnouncementRow): string =>
  a.audience_kind === "all" ? "All members" : a.audience_kind === "cells" ? "Specific cells" : "Specific level";

/* ------------------------------------------------------------------ */
/* Procedural QR placeholder (display-only — no QR endpoint yet)       */
/* ------------------------------------------------------------------ */

function QrPlaceholder({ value, size = 200 }: { value: string; size?: number }): ReactElement {
  const cells = useMemo(() => {
    const arr: boolean[] = [];
    let seed = 0;
    for (let i = 0; i < value.length; i++) seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
    for (let i = 0; i < 21 * 21; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      arr.push((seed & 1) === 1);
    }
    return arr;
  }, [value]);

  const isCorner = (r: number, c: number): boolean =>
    (r < 7 && c < 7) || (r < 7 && c >= 14) || (r >= 14 && c < 7);

  return (
    <div className="rounded-2xl p-4" style={{ background: "#fff", border: "1px solid var(--border)" }}>
      <svg width={size} height={size} viewBox="0 0 21 21" style={{ display: "block" }}>
        <rect width={21} height={21} fill="#fff" />
        {Array.from({ length: 21 * 21 }).map((_, i) => {
          const r = Math.floor(i / 21);
          const c = i % 21;
          if (isCorner(r, c)) {
            const lr = r < 7 ? r : r - 14;
            const lc = c < 7 ? c : c - 14;
            const onEdge = lr === 0 || lr === 6 || lc === 0 || lc === 6;
            const inner = lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4;
            return onEdge || inner ? <rect key={i} x={c} y={r} width={1} height={1} fill="#0B1F33" /> : null;
          }
          return cells[i] ? <rect key={i} x={c} y={r} width={1} height={1} fill="#0B1F33" /> : null;
        })}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Calendar                                                            */
/* ------------------------------------------------------------------ */

function CalendarGrid({
  month,
  year,
  todayIso,
  selectedIso,
  byDay,
  onSelectDate,
  onSelectOccurrence,
}: {
  month: number;
  year: number;
  todayIso: string;
  selectedIso: string;
  byDay: Map<string, UiOccurrence[]>;
  onSelectDate: (iso: string) => void;
  onSelectOccurrence: (id: string) => void;
}): ReactElement {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: ({ iso: string; day: number } | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ iso, day: d });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-2">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
          <div key={d} className="text-center" style={{ fontSize: 10, color: "var(--muted-foreground)", letterSpacing: 0.8, fontWeight: 700, paddingBottom: 4 }}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} style={{ minHeight: 96 }} />;
          const dayEvents = byDay.get(c.iso) ?? [];
          const isSelected = c.iso === selectedIso;
          const isToday = c.iso === todayIso;
          return (
            <button
              key={i}
              onClick={() => onSelectDate(c.iso)}
              className="rounded-xl text-left p-2 transition-colors"
              style={{
                minHeight: 96,
                background: isSelected ? "var(--secondary)" : isToday ? "#FBF1DA" : "var(--card)",
                border: "1px solid",
                borderColor: isSelected ? "var(--nuru-navy)" : isToday ? "var(--nuru-gold)" : "var(--border)",
                cursor: "pointer",
              }}
            >
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 12, fontWeight: isToday || isSelected ? 700 : 600, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{c.day}</span>
                {dayEvents.length > 0 && <span style={{ fontSize: 9, color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{dayEvents.length}</span>}
              </div>
              <div className="flex flex-col gap-1 mt-1">
                {dayEvents.slice(0, 2).map((d) => (
                  <span
                    key={d.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectOccurrence(d.id);
                    }}
                    className="rounded-md px-1.5 py-0.5 truncate"
                    style={{ background: CATEGORY_META[d.category].soft, color: CATEGORY_META[d.category].color, fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)" }}>{d.time.split(" ")[0]}</span> {d.title}
                  </span>
                ))}
                {dayEvents.length > 2 && <span style={{ fontSize: 10, color: "var(--muted-foreground)", paddingLeft: 4 }}>+{dayEvents.length - 2} more</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WeekStrip({
  selectedIso,
  weekStart,
  byDay,
  onSelectDate,
  onSelectOccurrence,
}: {
  selectedIso: string;
  weekStart: Date;
  byDay: Map<string, UiOccurrence[]>;
  onSelectDate: (iso: string) => void;
  onSelectOccurrence: (id: string) => void;
}): ReactElement {
  const days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return { iso: localIso(d), day: d.getDate(), label: d.toLocaleDateString("en-US", { weekday: "short" }) };
  });
  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((d) => {
        const evs = byDay.get(d.iso) ?? [];
        const isSel = d.iso === selectedIso;
        return (
          <button
            key={d.iso}
            onClick={() => onSelectDate(d.iso)}
            className="rounded-xl p-3 text-left"
            style={{ minHeight: 200, background: isSel ? "var(--secondary)" : "var(--card)", border: "1px solid", borderColor: isSel ? "var(--nuru-navy)" : "var(--border)" }}
          >
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", letterSpacing: 0.5, textTransform: "uppercase" }}>{d.label}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 700, color: "var(--foreground)", lineHeight: 1, marginTop: 2 }}>{d.day}</div>
            <div className="flex flex-col gap-1 mt-3">
              {evs.map((e) => (
                <span
                  key={e.id}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onSelectOccurrence(e.id);
                  }}
                  className="rounded-md px-1.5 py-1 truncate"
                  style={{ background: CATEGORY_META[e.category].soft, color: CATEGORY_META[e.category].color, fontSize: 10, fontWeight: 600, cursor: "pointer" }}
                >
                  <span style={{ fontFamily: "var(--font-mono)" }}>{e.time.split(" ")[0]}</span> {e.title}
                </span>
              ))}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function EventListView({ events, onOpen }: { events: UiOccurrence[]; onOpen: (id: string) => void }): ReactElement {
  if (events.length === 0) {
    return <EmptyState icon={<CalendarDays size={20} />} title="No events scheduled" body="Create your first event to begin managing RSVP, reminders, and attendance." cta="Create event" />;
  }
  return (
    <div className="flex flex-col">
      {events.map((o, i) => (
        <button key={o.id} onClick={() => onOpen(o.id)} className="text-left flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
          <div className="rounded-md shrink-0" style={{ width: 4, height: 36, background: CATEGORY_META[o.category].color }} />
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{o.title}</div>
            <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
              <span style={{ fontFamily: "var(--font-mono)" }}>{o.date}</span>
              <span>·</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{o.time}</span>
              <span>·</span>
              {o.location}
            </div>
          </div>
          <StatusPill status="scheduled" />
          <div className="text-right" style={{ minWidth: 60 }}>
            <div style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>{CATEGORY_META[o.category].label}</div>
            <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>Type</div>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small UI helpers                                                    */
/* ------------------------------------------------------------------ */

type PillStatus = "draft" | "scheduled" | "live" | "completed" | "cancelled" | "rescheduled" | AnnouncementStatusLabel | "Verified" | "Manual" | "Guest" | "Late";

function StatusPill({ status }: { status: PillStatus }): ReactElement {
  const map: Record<string, { bg: string; fg: string }> = {
    draft: { bg: "#EEF0F3", fg: "#6B7280" },
    scheduled: { bg: "#E1E6ED", fg: "#0B1F33" },
    live: { bg: "#DCF7E4", fg: "#15803D" },
    completed: { bg: "#DCF7E4", fg: "#15803D" },
    cancelled: { bg: "#FEE2E2", fg: "#B91C1C" },
    rescheduled: { bg: "#FFE6D2", fg: "#9A3412" },
    Draft: { bg: "#EEF0F3", fg: "#6B7280" },
    Scheduled: { bg: "#E1E6ED", fg: "#0B1F33" },
    Sent: { bg: "#DCF7E4", fg: "#15803D" },
    Failed: { bg: "#FEE2E2", fg: "#B91C1C" },
    Verified: { bg: "#DCF7E4", fg: "#15803D" },
    Manual: { bg: "#FBF1DA", fg: "#A87616" },
    Guest: { bg: "#DBE7FE", fg: "#1D4ED8" },
    Late: { bg: "#FFE6D2", fg: "#9A3412" },
  };
  const m = map[status] ?? { bg: "#EEF0F3", fg: "#6B7280" };
  return (
    <span className="rounded-full px-2 py-0.5" style={{ background: m.bg, color: m.fg, fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>
      {status === "live" && <span style={{ color: "#15803D" }}>● </span>}
      {status}
    </span>
  );
}

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Card({ children, padded = true, className = "" }: { children: ReactNode; padded?: boolean; className?: string }): ReactElement {
  return (
    <div className={`rounded-2xl ${className}`} style={{ background: "var(--card)", border: "1px solid var(--border)", padding: padded ? 20 : 0 }}>
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex items-end justify-between mb-3">
      <div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)", lineHeight: 1.2 }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }): ReactElement {
  return (
    <div className="rounded-xl p-3" style={{ background: "var(--secondary)" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 10, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginTop: 4, fontWeight: 700 }}>{label}</div>
    </div>
  );
}

function InsightCard({ label, value, hint, trend }: { label: string; value: string; hint: string; trend: "up" | "down" }): ReactElement {
  return (
    <div className="rounded-xl p-4" style={{ background: "var(--secondary)" }}>
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</span>
        <TrendingUp size={12} style={{ color: trend === "up" ? "#15803D" : "#B91C1C", transform: trend === "down" ? "scaleY(-1)" : undefined }} />
      </div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--foreground)", marginTop: 4, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 4 }}>{hint}</div>
    </div>
  );
}

function DrawerAction({ icon, label, onClick, primary, danger }: { icon: ReactNode; label: string; onClick?: () => void; primary?: boolean; danger?: boolean }): ReactElement {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-xl px-3 py-2.5"
      style={{
        background: primary ? "var(--nuru-gold)" : danger ? "#FEE2E2" : "var(--secondary)",
        color: primary ? "#fff" : danger ? "#B91C1C" : "var(--foreground)",
        fontSize: 12,
        fontWeight: 600,
        border: "1px solid",
        borderColor: primary ? "var(--nuru-gold)" : danger ? "#FECACA" : "var(--border)",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 12, color: "var(--foreground)", marginTop: 2, fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</div>
    </div>
  );
}

function ToggleRow({ label, defaultOn, icon }: { label: string; defaultOn: boolean; icon: ReactNode }): ReactElement {
  const [on, setOn] = useState(defaultOn);
  return (
    <button type="button" onClick={() => setOn((v) => !v)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
      <span className="rounded-md flex items-center justify-center" style={{ width: 32, height: 18, background: on ? "#16A34A" : "#D1D5DB", position: "relative" }}>
        <span className="rounded-full bg-white absolute" style={{ width: 14, height: 14, top: 2, left: on ? 16 : 2, transition: "left 0.15s" }} />
      </span>
      <span style={{ color: "var(--muted-foreground)" }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--foreground)" }}>{label}</span>
    </button>
  );
}

function SectionDivider({ label }: { label: string }): ReactElement {
  return (
    <div className="flex items-center gap-3">
      <div style={{ fontSize: 10, fontWeight: 700, color: "var(--nuru-gold)", textTransform: "uppercase", letterSpacing: 0.8, whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function EmptyState({ icon, title, body, cta, onCta }: { icon: ReactNode; title: string; body: string; cta: string; onCta?: () => void }): ReactElement {
  return (
    <div className="flex flex-col items-center text-center py-10">
      <div className="rounded-2xl flex items-center justify-center mb-3" style={{ width: 48, height: 48, background: "var(--secondary)", color: "var(--muted-foreground)" }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, maxWidth: 280 }}>{body}</div>
      {onCta && (
        <button onClick={onCta} className="flex items-center gap-1.5 rounded-xl px-4 py-2 mt-4" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none" }}>
          <Plus size={12} /> {cta}
        </button>
      )}
    </div>
  );
}

function Drawer({ children, onClose, width }: { children: ReactNode; onClose: () => void; width: number }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div className="h-full overflow-y-auto" style={{ background: "var(--card)", width: `min(${width}px, 100vw)`, maxWidth: "100vw", boxShadow: "-20px 0 60px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end p-3">
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Modal({ children, onClose, width }: { children: ReactNode; onClose: () => void; width: number }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: "var(--card)", width: `min(${width}px, calc(100vw - 32px))`, maxWidth: "calc(100vw - 32px)", maxHeight: "92vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,0.25)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main page                                                           */
/* ------------------------------------------------------------------ */

const startOfWeek = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
};

export function Events(): ReactElement {
  const now = useMemo(() => new Date(), []);
  const todayIso = localIso(now);

  const [events, setEvents] = useState<UiOccurrence[]>([]);
  const [recent, setRecent] = useState<RecentEventRow[]>([]);
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [view, setView] = useState<"Month" | "Week" | "List">("Month");
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(now));

  const [drawerOccId, setDrawerOccId] = useState<string | null>(null);
  const [dayDrawerIso, setDayDrawerIso] = useState<string | null>(null);
  const [rsvpDrawerId, setRsvpDrawerId] = useState<string | null>(null);
  const [attendanceDrawerId, setAttendanceDrawerId] = useState<string | null>(null);
  const [announcementDrawerId, setAnnouncementDrawerId] = useState<string | null>(null);

  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateAnnouncement, setShowCreateAnnouncement] = useState(false);
  const [showQrScreen, setShowQrScreen] = useState<string | null>(null);
  const [manualCheckinFor, setManualCheckinFor] = useState<string | null>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [rescheduleDate, setRescheduleDate] = useState(""); // YYYY-MM-DD
  const [rescheduleTime, setRescheduleTime] = useState(""); // HH:MM
  const [rescheduleReason, setRescheduleReason] = useState("");
  const [occActionBusy, setOccActionBusy] = useState(false);

  // Rosters cached per event id (loaded lazily for the panels that need real counts).
  const [rosters, setRosters] = useState<Record<string, EventRoster>>({});
  // RSVP rosters cached per occurrence id (PR #127 GET /admin/events/:id/rsvps).
  const [rsvpRosters, setRsvpRosters] = useState<Record<string, RsvpRoster>>({});
  const [rsvpFilter, setRsvpFilter] = useState<"going" | "maybe" | "declined" | "no_response">("going");
  const [qrTick, setQrTick] = useState(0); // display-only QR rotation (no QR endpoint yet)

  // Series pause/resume (PR #127). The calendar wire carries no `is_paused` and a
  // paused series stops projecting occurrences (so it drops out of the calendar);
  // we track paused series from the toggle response so we can keep showing them as
  // "Paused" rows with a Resume action. { series_id -> { title, paused } }.
  const [pausedSeries, setPausedSeries] = useState<Record<string, { title: string; paused: boolean }>>({});
  const [seriesBusy, setSeriesBusy] = useState<string | null>(null);

  const loadCalendar = useCallback(async () => {
    const from = new Date(now);
    from.setMonth(from.getMonth() - 1); // include this month's earlier days
    const to = new Date(now.getTime() + 60 * 86400000);
    const cal = await OpsApi.calendar(from.toISOString(), to.toISOString());
    setEvents(cal.map(toUi));
  }, [now]);

  const load = useCallback(async () => {
    try {
      const [, att, anns] = await Promise.all([
        loadCalendar(),
        AdminApi.attendanceReport(8).catch(() => ({ trend: [], recent_events: [] as RecentEventRow[] })),
        AnnouncementsApi.list().catch(() => [] as AnnouncementRow[]),
      ]);
      setRecent(att.recent_events);
      setAnnouncements(anns);
    } catch (e) {
      setError(errorMessage(e, "Could not load events."));
    }
  }, [loadCalendar]);
  useEffect(() => {
    void load();
  }, [load]);

  const loadRoster = useCallback(async (id: string): Promise<EventRoster | null> => {
    try {
      const r = await OpsApi.roster(id);
      setRosters((prev) => ({ ...prev, [id]: r }));
      return r;
    } catch {
      return null;
    }
  }, []);

  const loadRsvpRoster = useCallback(async (id: string): Promise<void> => {
    try {
      const r = await OpsApi.rsvpRoster(id);
      setRsvpRosters((prev) => ({ ...prev, [id]: r }));
    } catch {
      /* leave undefined — drawer shows a loading/empty state */
    }
  }, []);

  const byDay = useMemo(() => {
    const m = new Map<string, UiOccurrence[]>();
    for (const e of events) {
      const arr = m.get(e.iso) ?? [];
      arr.push(e);
      m.set(e.iso, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return m;
  }, [events]);

  const monthLabel = new Date(year, month, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
  const todayOccurrences = useMemo(() => (byDay.get(todayIso) ?? []), [byDay, todayIso]);
  const upcoming = useMemo(
    () => events.filter((o) => o.startsAt >= now.toISOString()).sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, 6),
    [events, now],
  );
  // "Active event series" — group occurrences by series_id (one row per recurring
  // series). count/next are real; pause/resume is server-authoritative (PR #127).
  const seriesRows = useMemo(() => {
    const m = new Map<string, { seriesId: string; title: string; category: EventCategory; count: number; next: UiOccurrence }>();
    for (const o of upcoming.length ? events.filter((e) => e.startsAt >= now.toISOString()) : events) {
      const key = o.seriesId;
      const ex = m.get(key);
      if (!ex) m.set(key, { seriesId: o.seriesId, title: o.title, category: o.category, count: 1, next: o });
      else {
        ex.count += 1;
        if (o.startsAt < ex.next.startsAt) ex.next = o;
      }
    }
    return Array.from(m.values()).sort((a, b) => a.next.startsAt.localeCompare(b.next.startsAt)).slice(0, 6);
  }, [events, now, upcoming.length]);

  const drawerOcc = drawerOccId ? events.find((o) => o.id === drawerOccId) ?? null : null;
  const qrScreenOcc = showQrScreen ? events.find((o) => o.id === showQrScreen) ?? null : null;
  const rsvpDrawerOcc = rsvpDrawerId ? events.find((o) => o.id === rsvpDrawerId) ?? null : null;
  const attendanceDrawerOcc = attendanceDrawerId ? events.find((o) => o.id === attendanceDrawerId) ?? null : null;
  const announcementDrawerObj = announcementDrawerId ? announcements.find((a) => a.announcement_id === announcementDrawerId) ?? null : null;
  const dayDrawerEvents = dayDrawerIso ? byDay.get(dayDrawerIso) ?? [] : [];

  // Lazily pull rosters for any drawer/QR that needs real counts.
  useEffect(() => {
    for (const id of [drawerOccId, attendanceDrawerId, showQrScreen]) {
      if (id && !rosters[id]) void loadRoster(id);
    }
  }, [drawerOccId, attendanceDrawerId, showQrScreen, rosters, loadRoster]);

  // Lazily pull the RSVP roster when the RSVP drawer opens (PR #127).
  useEffect(() => {
    if (rsvpDrawerId && !rsvpRosters[rsvpDrawerId]) void loadRsvpRoster(rsvpDrawerId);
  }, [rsvpDrawerId, rsvpRosters, loadRsvpRoster]);

  const qrSecret = useMemo(() => {
    const base = qrScreenOcc?.id ?? drawerOcc?.id ?? "occurrence";
    return `NURU-${base.slice(0, 8).toUpperCase()}-${qrTick.toString(36).toUpperCase()}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  }, [qrScreenOcc, drawerOcc, qrTick]);

  // Hero KPIs from real data; RSVP is display-only (no RSVP report endpoint).
  const checkedThisWeek = recent.reduce((s, e) => s + e.checked_in, 0);
  const scheduledAnnouncements = announcements.filter((a) => a.status === "scheduled").length;

  const refetch = useCallback(async () => {
    setRosters({});
    await load();
  }, [load]);

  const toggleSeriesPause = useCallback(
    async (seriesId: string, title: string, currentlyPaused: boolean) => {
      setSeriesBusy(seriesId);
      try {
        const row = currentlyPaused ? await OpsApi.resumeSeries(seriesId) : await OpsApi.pauseSeries(seriesId);
        setPausedSeries((prev) => {
          const next = { ...prev };
          if (row.is_paused) next[seriesId] = { title: row.title || title, paused: true };
          else delete next[seriesId];
          return next;
        });
        // Paused series stop projecting future occurrences; refetch to drop/restore them.
        await refetch();
        setNotice(row.is_paused ? "Series paused — future occurrences hidden." : "Series resumed.");
      } catch (e) {
        setError(errorMessage(e, "Could not update series."));
      } finally {
        setSeriesBusy(null);
      }
    },
    [refetch],
  );

  const submitCancelOccurrence = useCallback(async () => {
    if (!drawerOcc) return;
    setOccActionBusy(true);
    try {
      await OpsApi.addEventException(drawerOcc.seriesId, {
        original_start_at: drawerOcc.originalStartAt,
        is_cancelled: true,
        ...(cancelReason.trim() ? { note: cancelReason.trim() } : {}),
      });
      setShowCancelModal(false);
      setDrawerOccId(null);
      setCancelReason("");
      await refetch();
      setNotice("Occurrence cancelled.");
    } catch (e) {
      setError(errorMessage(e, "Could not cancel occurrence."));
    } finally {
      setOccActionBusy(false);
    }
  }, [drawerOcc, cancelReason, refetch]);

  const submitRescheduleOccurrence = useCallback(async () => {
    if (!drawerOcc) return;
    if (!rescheduleDate || !rescheduleTime) {
      setError("Enter a new date and start time to reschedule.");
      return;
    }
    const newStart = new Date(`${rescheduleDate}T${rescheduleTime}`);
    if (Number.isNaN(newStart.getTime())) {
      setError("Invalid date or time.");
      return;
    }
    const durationMs = new Date(drawerOcc.endsAt).getTime() - new Date(drawerOcc.startsAt).getTime();
    const newEnd = new Date(newStart.getTime() + (Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 60 * 60 * 1000));
    setOccActionBusy(true);
    try {
      await OpsApi.addEventException(drawerOcc.seriesId, {
        original_start_at: drawerOcc.originalStartAt,
        new_start_at: newStart.toISOString(),
        new_end_at: newEnd.toISOString(),
        ...(rescheduleReason.trim() ? { note: rescheduleReason.trim() } : {}),
      });
      setShowRescheduleModal(false);
      setDrawerOccId(null);
      setRescheduleDate("");
      setRescheduleTime("");
      setRescheduleReason("");
      await refetch();
      setNotice("Occurrence rescheduled.");
    } catch (e) {
      setError(errorMessage(e, "Could not reschedule occurrence."));
    } finally {
      setOccActionBusy(false);
    }
  }, [drawerOcc, rescheduleDate, rescheduleTime, rescheduleReason, refetch]);

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* ────── Hero ────── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Operations</span>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Events &amp; Announcements</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <ShieldCheck size={11} /> EAT timezone
            </span>
            <button onClick={() => setView("Month")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)", fontWeight: 600 }}>
              <CalendarDays size={13} /> Calendar
            </button>
            <button onClick={() => setShowCreateAnnouncement(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, border: "1px solid rgba(255,255,255,0.15)", fontWeight: 600 }}>
              <Bell size={13} /> Announcement
            </button>
            <button onClick={() => setShowCreateEvent(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, boxShadow: "0 6px 18px rgba(200,155,60,0.32)", border: "none" }}>
              <Plus size={13} /> Create event
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Upcoming events", value: String(upcoming.length), hint: `${todayOccurrences.length} today` },
            { label: "Recent events", value: String(recent.length), hint: "last 8 weeks" },
            { label: "Checked in (recent)", value: String(checkedThisWeek), hint: "QR verified" },
            { label: "Announcements", value: String(announcements.length), hint: `${scheduledAnnouncements} scheduled` },
          ].map((item, idx) => (
            <div key={item.label} className="flex-1" style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ────── Body ────── */}
      <div style={{ padding: "28px clamp(16px,4vw,48px) 48px" }}>
        <div style={{ maxWidth: 1180, marginInline: "auto" }}>
          {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
          {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}

          {/* Alert strip */}
          <div className="rounded-2xl flex items-start gap-3 mb-5" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8", padding: "12px 16px" }}>
            <ShieldCheck size={16} style={{ color: "#A87616", marginTop: 2, flexShrink: 0 }} />
            <div className="flex-1">
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7A5410" }}>QR attendance is occurrence-based.</div>
              <div style={{ fontSize: 12, color: "#7A5410", marginTop: 2 }}>
                Each event occurrence has its own rotating QR code for secure check-in. Secrets refresh every 30 seconds and expire one hour after the occurrence ends.
              </div>
            </div>
          </div>

          {/* Calendar + Today panel */}
          <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: "1fr 360px" }}>
            <Card padded={false}>
              <div className="flex items-center justify-between p-5" style={{ borderBottom: "1px solid var(--border)" }}>
                <div className="flex items-center gap-3">
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{view === "Week" ? "This week" : monthLabel}</h2>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        if (view === "Week") {
                          const x = new Date(weekStart);
                          x.setDate(x.getDate() - 7);
                          setWeekStart(x);
                        } else if (month === 0) {
                          setMonth(11);
                          setYear((y) => y - 1);
                        } else setMonth((m) => m - 1);
                      }}
                      className="rounded-lg p-2"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (view === "Week") {
                          const x = new Date(weekStart);
                          x.setDate(x.getDate() + 7);
                          setWeekStart(x);
                        } else if (month === 11) {
                          setMonth(0);
                          setYear((y) => y + 1);
                        } else setMonth((m) => m + 1);
                      }}
                      className="rounded-lg p-2"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}
                    >
                      <ChevronRight size={14} />
                    </button>
                    <button
                      onClick={() => {
                        setMonth(now.getMonth());
                        setYear(now.getFullYear());
                        setSelectedIso(todayIso);
                        setWeekStart(startOfWeek(now));
                      }}
                      className="rounded-lg px-3 py-1.5 ml-2"
                      style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}
                    >
                      Today
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--secondary)" }}>
                  {(["Month", "Week", "List"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setView(v)}
                      className="rounded-lg px-3 py-1.5"
                      style={{ background: view === v ? "var(--card)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: view === v ? 700 : 500, boxShadow: view === v ? "0 1px 3px rgba(0,0,0,0.06)" : "none", border: "none" }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-5">
                {view === "Month" && (
                  <CalendarGrid
                    month={month}
                    year={year}
                    todayIso={todayIso}
                    selectedIso={selectedIso}
                    byDay={byDay}
                    onSelectDate={(iso) => {
                      setSelectedIso(iso);
                      setDayDrawerIso(iso);
                    }}
                    onSelectOccurrence={(id) => setDrawerOccId(id)}
                  />
                )}
                {view === "Week" && <WeekStrip selectedIso={selectedIso} weekStart={weekStart} byDay={byDay} onSelectDate={setSelectedIso} onSelectOccurrence={(id) => setDrawerOccId(id)} />}
                {view === "List" && <EventListView events={[...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt))} onOpen={(id) => setDrawerOccId(id)} />}

                <div className="flex flex-wrap gap-x-5 gap-y-2 mt-5 pt-4" style={{ borderTop: "1px solid var(--border)" }}>
                  {(Object.keys(CATEGORY_META) as EventCategory[]).map((k) => (
                    <div key={k} className="flex items-center gap-2">
                      <span className="rounded-full" style={{ width: 8, height: 8, background: CATEGORY_META[k].color }} />
                      <span style={{ fontSize: 12, color: "var(--foreground)" }}>{CATEGORY_META[k].label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* Today panel */}
            <Card padded={false}>
              <div className="p-5" style={{ borderBottom: "1px solid var(--border)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Today's Ministry Flow</div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--foreground)", marginTop: 4 }}>{now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h3>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, fontFamily: "var(--font-mono)" }}>{todayOccurrences.length} events</div>
              </div>
              <div className="p-5 flex flex-col gap-3" style={{ maxHeight: 540, overflowY: "auto" }}>
                {todayOccurrences.length === 0 ? (
                  <EmptyState icon={<CalendarDays size={20} />} title="Nothing scheduled today" body="When events are scheduled for today they appear here as a timeline." cta="Create event" onCta={() => setShowCreateEvent(true)} />
                ) : (
                  todayOccurrences.map((o) => (
                    <button key={o.id} onClick={() => setDrawerOccId(o.id)} className="rounded-xl text-left p-3 transition-colors" style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}>
                      <div className="flex items-start gap-3">
                        <div className="rounded-md shrink-0" style={{ width: 4, height: 44, background: CATEGORY_META[o.category].color }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", fontFamily: "var(--font-mono)" }}>{o.time}</span>
                            <StatusPill status="scheduled" />
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)", marginTop: 2 }}>{o.title}</div>
                          <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            <MapPin size={10} /> {o.location}
                          </div>
                          <div className="flex items-center gap-1.5 mt-2">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setShowQrScreen(o.id);
                              }}
                              className="flex items-center gap-1 rounded-md px-2 py-1"
                              style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}
                            >
                              <QrCode size={10} /> Show QR
                            </span>
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                setAttendanceDrawerId(o.id);
                              }}
                              className="flex items-center gap-1 rounded-md px-2 py-1"
                              style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 600, color: "var(--foreground)", cursor: "pointer" }}
                            >
                              <Users size={10} /> Attendance
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </Card>
          </div>

          {/* Upcoming + Series */}
          <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Card>
              <SectionHeader
                title="Upcoming events"
                subtitle="Next scheduled occurrences across all series"
                action={
                  <button className="flex items-center gap-1 rounded-md px-2 py-1" style={{ fontSize: 11, color: "var(--muted-foreground)", background: "var(--secondary)", border: "none" }}>
                    <Filter size={11} /> Filter
                  </button>
                }
              />
              <div className="flex flex-col">
                {upcoming.length === 0 ? (
                  <EmptyState icon={<CalendarDays size={20} />} title="No events scheduled yet" body="Create your first event to begin managing RSVP, reminders, and attendance." cta="Create event" onCta={() => setShowCreateEvent(true)} />
                ) : (
                  upcoming.map((o, i) => {
                    const d = new Date(o.startsAt);
                    return (
                      <button key={o.id} onClick={() => setDrawerOccId(o.id)} className="text-left flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                        <div className="rounded-lg flex flex-col items-center justify-center shrink-0" style={{ width: 48, height: 48, background: CATEGORY_META[o.category].soft, color: CATEGORY_META[o.category].color }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.4 }}>{d.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</span>
                          <span style={{ fontSize: 16, fontWeight: 800, fontFamily: "var(--font-mono)", lineHeight: 1 }}>{d.getDate()}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{o.title}</div>
                          <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            <span style={{ fontFamily: "var(--font-mono)" }}>{o.time}</span>
                            <span>·</span>
                            <MapPin size={10} /> {o.location}
                          </div>
                        </div>
                        <div className="text-right">
                          <div style={{ fontSize: 12, fontWeight: 700, color: CATEGORY_META[o.category].color }}>{CATEGORY_META[o.category].label}</div>
                          <div style={{ fontSize: 10, color: "var(--muted-foreground)", letterSpacing: 0.4, textTransform: "uppercase" }}>Type</div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>

            <Card>
              <SectionHeader title="Active event series" subtitle={`${seriesRows.length} recurring series running`} />
              <div className="flex flex-col">
                {(() => {
                  // Active rows (from the projected calendar) plus any locally-tracked
                  // paused rows (which no longer project occurrences, so they're not in
                  // seriesRows). A row currently being toggled to paused may still be in
                  // seriesRows until the refetch lands — flag it from pausedSeries.
                  const activeIds = new Set(seriesRows.map((s) => s.seriesId));
                  const pausedExtra = Object.entries(pausedSeries)
                    .filter(([id, v]) => v.paused && !activeIds.has(id))
                    .map(([seriesId, v]) => ({ seriesId, title: v.title }));
                  if (seriesRows.length === 0 && pausedExtra.length === 0) {
                    return <EmptyState icon={<Repeat size={20} />} title="No recurring series" body="Create a recurring event and its series shows up here." cta="Create event" onCta={() => setShowCreateEvent(true)} />;
                  }
                  return (
                    <>
                      {seriesRows.map((s, i) => {
                        const paused = pausedSeries[s.seriesId]?.paused ?? false;
                        const busy = seriesBusy === s.seriesId;
                        return (
                          <div key={s.seriesId} className="flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                            <div className="rounded-md shrink-0" style={{ width: 4, height: 40, background: CATEGORY_META[s.category].color }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{s.title}</span>
                                {paused ? (
                                  <span className="rounded-full px-2 py-0.5" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>Paused</span>
                                ) : (
                                  <span className="rounded-full px-2 py-0.5" style={{ background: "#DCF7E4", color: "#15803D", fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>Active</span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                                <Repeat size={10} /> {s.count} upcoming
                                <span>·</span>
                                <span style={{ fontFamily: "var(--font-mono)" }}>{s.next.date}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button onClick={() => setDrawerOccId(s.next.id)} className="rounded-md p-1.5" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }} title="View next">
                                <Eye size={12} />
                              </button>
                              <button
                                onClick={() => void toggleSeriesPause(s.seriesId, s.title, paused)}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-md px-2 py-1.5"
                                style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", fontSize: 11, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
                                title={paused ? "Resume" : "Pause"}
                              >
                                {paused ? <Play size={12} /> : <Pause size={12} />}
                                {paused ? "Resume" : "Pause"}
                              </button>
                              <button className="rounded-md p-1.5" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }} title="More">
                                <MoreHorizontal size={12} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {pausedExtra.map((s, i) => {
                        const busy = seriesBusy === s.seriesId;
                        return (
                          <div key={s.seriesId} className="flex items-center gap-3 py-3" style={{ borderTop: seriesRows.length === 0 && i === 0 ? "none" : "1px solid var(--border)" }}>
                            <div className="rounded-md shrink-0" style={{ width: 4, height: 40, background: "#D1D5DB" }} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{s.title}</span>
                                <span className="rounded-full px-2 py-0.5" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 9, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase" }}>Paused</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                                <Pause size={10} /> Future occurrences hidden
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => void toggleSeriesPause(s.seriesId, s.title, true)}
                                disabled={busy}
                                className="flex items-center gap-1 rounded-md px-2 py-1.5"
                                style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none", fontSize: 11, fontWeight: 600, opacity: busy ? 0.6 : 1 }}
                                title="Resume"
                              >
                                <Play size={12} /> Resume
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>
            </Card>
          </div>

          {/* Announcements + QR panel */}
          <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
            <Card>
              <SectionHeader
                title="Announcements"
                subtitle="Send updates, reminders, and ministry notices connected to events"
                action={
                  <button onClick={() => setShowCreateAnnouncement(true)} className="flex items-center gap-1 rounded-lg px-3 py-1.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
                    <Plus size={12} /> New announcement
                  </button>
                }
              />
              {announcements.length === 0 ? (
                <EmptyState icon={<Bell size={20} />} title="No announcements yet" body="Send updates, reminders, and event notices to the right audience." cta="Create announcement" onCta={() => setShowCreateAnnouncement(true)} />
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {announcements.map((a) => (
                    <button key={a.announcement_id} onClick={() => setAnnouncementDrawerId(a.announcement_id)} className="text-left rounded-xl p-3" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
                      <div className="flex items-start justify-between mb-2">
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{a.title}</span>
                        <StatusPill status={announcementStatusLabel(a.status)} />
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.channels.map((c) => (
                          <span key={c} className="rounded-md px-2 py-0.5" style={{ background: "var(--secondary)", fontSize: 10, color: "var(--foreground)", fontWeight: 600 }}>{c}</span>
                        ))}
                      </div>
                      <div className="flex items-center justify-between" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        <span><span style={{ fontWeight: 600 }}>Audience:</span> {audienceLabel(a)}</span>
                        <span style={{ fontFamily: "var(--font-mono)" }}>{fmtAnnouncementWhen(a)}</span>
                      </div>
                      {a.delivered_count !== undefined && (
                        <div className="mt-2 pt-2 flex items-center justify-between" style={{ borderTop: "1px solid var(--border)", fontSize: 11 }}>
                          <span style={{ color: "var(--muted-foreground)" }}>
                            Delivered <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--foreground)" }}>{a.delivered_count}</span>
                          </span>
                          {a.opened_count !== undefined && (
                            <span style={{ color: "#15803D", fontWeight: 700 }}>
                              <span style={{ fontFamily: "var(--font-mono)" }}>{a.opened_count}</span> opened
                            </span>
                          )}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Live QR panel — secret/counts are display-only until the QR endpoint lands */}
            <Card padded={false}>
              <div className="px-5 py-4" style={{ background: "var(--nuru-navy)", color: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
                <div className="flex items-center justify-between mb-1">
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "rgba(232,239,245,0.7)" }}>Live QR</span>
                  <span className="rounded-full px-2 py-0.5" style={{ background: "rgba(22,163,74,0.25)", color: "#7FE0A0", fontSize: 10, fontWeight: 700, letterSpacing: 0.5 }}>● LIVE</span>
                </div>
                <h3 style={{ fontFamily: "var(--font-display)", fontSize: 18, lineHeight: 1.2 }}>{todayOccurrences[0]?.title ?? upcoming[0]?.title ?? "Next occurrence"}</h3>
                <div className="flex items-center gap-3 mt-2" style={{ fontSize: 11, color: "rgba(232,239,245,0.75)" }}>
                  <span className="flex items-center gap-1">
                    <Clock size={10} /> {todayOccurrences[0]?.time ?? upcoming[0]?.time ?? "—"} · {todayOccurrences[0]?.location ?? upcoming[0]?.location ?? "—"}
                  </span>
                </div>
              </div>
              <div className="p-5 flex flex-col items-center">
                <QrPlaceholder value={qrSecret} size={180} />
                <div className="flex items-center gap-2 mt-3">
                  <span className="flex items-center gap-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                    <Sparkles size={11} style={{ color: "var(--nuru-gold)" }} /> Rotating secret
                  </span>
                  <button onClick={() => setQrTick((t) => t + 1)} className="flex items-center gap-1 rounded-md px-2 py-1" style={{ background: "var(--secondary)", fontSize: 11, color: "var(--foreground)", border: "none" }}>
                    <RefreshCw size={10} /> Refresh
                  </button>
                </div>
                <code className="mt-2" style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-foreground)", letterSpacing: 1 }}>{qrSecret}</code>
                <button
                  onClick={() => {
                    const id = todayOccurrences[0]?.id ?? upcoming[0]?.id ?? null;
                    if (id) setShowQrScreen(id);
                  }}
                  className="w-full mt-4 rounded-xl py-2.5"
                  style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700, border: "none" }}
                >
                  Open full QR screen
                </button>
              </div>
            </Card>
          </div>

          {/* Insights + Follow-up */}
          <div className="grid gap-5 mb-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <Card>
              <SectionHeader title="Event insights" subtitle="Patterns across recent occurrences" />
              {/* display-only percentages (no insights endpoint yet) — seeded from recent attendance where possible */}
              <div className="grid grid-cols-2 gap-3">
                <InsightCard label="Checked in" value={String(checkedThisWeek)} hint="Across recent events" trend="up" />
                <InsightCard label="Recent events" value={String(recent.length)} hint="Last 8 weeks" trend="up" />
                <InsightCard label="RSVP conversion" value="74%" hint="RSVP members checked in" trend="up" />
                <InsightCard label="Follow-up needed" value="23" hint="RSVP'd but did not attend" trend="down" />
              </div>
            </Card>

            <Card>
              <SectionHeader
                title="Follow-up queue"
                subtitle="From recent events — connect attendance to discipleship care"
                action={
                  <button className="flex items-center gap-1 rounded-md px-2 py-1" style={{ fontSize: 11, color: "var(--muted-foreground)", background: "var(--secondary)", border: "none" }}>
                    <Download size={11} /> Export
                  </button>
                }
              />
              {/* display-only counts (no follow-up endpoint yet) */}
              <div className="flex flex-col">
                {[
                  { label: "RSVP'd but absent", count: 23, icon: <AlertCircle size={14} />, color: "#B91C1C" },
                  { label: "First-time guests", count: 12, icon: <UserPlus size={14} />, color: "#15803D" },
                  { label: "Manual check-ins", count: 5, icon: <ShieldCheck size={14} />, color: "#A87616" },
                  { label: "No response", count: 48, icon: <Users size={14} />, color: "#6B7280" },
                ].map((r, i) => (
                  <div key={r.label} className="flex items-center gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <div className="rounded-lg flex items-center justify-center" style={{ width: 32, height: 32, background: "var(--secondary)", color: r.color }}>{r.icon}</div>
                    <div className="flex-1">
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, color: "var(--foreground)" }}>{r.count}</span> members
                      </div>
                    </div>
                    <button onClick={() => setShowCreateAnnouncement(true)} className="flex items-center gap-1 rounded-md px-3 py-1.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 600, border: "none" }}>
                      <Send size={11} /> Send follow-up
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          {/* Recent attendance (real) */}
          {recent.length > 0 && (
            <Card padded={false}>
              <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: 18, color: "var(--foreground)" }}>Recent attendance</span>
                <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>last 8 weeks</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "var(--secondary)" }}>
                      {["Event", "When", "Checked in", "RSVP going"].map((h) => (
                        <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((e) => (
                      <tr key={e.event_id} style={{ borderTop: "1px solid var(--border)" }}>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{e.title}</td>
                        <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{fmtDateShort(new Date(e.occurs_at))}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: "#0F6B33" }}>{e.checked_in}</td>
                        <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--foreground)" }}>{e.rsvp_going}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="text-center mt-6" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
            Nuru Events Command Center · All times in East Africa Time (UTC+3)
          </div>
        </div>
      </div>

      {/* ============== DRAWERS & MODALS ============== */}

      {/* Event detail drawer */}
      {drawerOcc && (
        <Drawer onClose={() => setDrawerOccId(null)} width={520}>
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <span style={{ fontSize: 10, fontWeight: 700, color: CATEGORY_META[drawerOcc.category].color, letterSpacing: 0.5, textTransform: "uppercase" }}>{CATEGORY_META[drawerOcc.category].label} occurrence</span>
              <StatusPill status="scheduled" />
            </div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--foreground)", lineHeight: 1.2 }}>{drawerOcc.title}</h2>
            <div className="flex flex-col gap-1 mt-3" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
              <span className="flex items-center gap-2">
                <CalendarDays size={12} />
                <span style={{ fontFamily: "var(--font-mono)" }}>{drawerOcc.date}</span>
              </span>
              <span className="flex items-center gap-2">
                <Clock size={12} />
                <span style={{ fontFamily: "var(--font-mono)" }}>{drawerOcc.time} – {drawerOcc.endTime}</span> · {drawerOcc.duration}
              </span>
              <span className="flex items-center gap-2">
                <MapPin size={12} /> {drawerOcc.location}
              </span>
              <span className="flex items-center gap-2">
                <Eye size={12} /> Visibility: {drawerOcc.visibility}
              </span>
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
              <Metric label="Checked in" value={String(rosters[drawerOcc.id]?.checked_in.length ?? 0)} color="#15803D" />
              <Metric label="Guests" value={String(rosters[drawerOcc.id]?.guests.length ?? 0)} color="var(--nuru-navy)" />
              <Metric label="No-shows" value={String(rosters[drawerOcc.id]?.rsvp_no_show.length ?? 0)} color="#B91C1C" />
              <Metric label="QR" value="Ready" color="var(--nuru-gold)" />
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              <DrawerAction icon={<QrCode size={13} />} label="Show QR" onClick={() => setShowQrScreen(drawerOcc.id)} primary />
              <DrawerAction icon={<Send size={13} />} label="Send announcement" onClick={() => setShowCreateAnnouncement(true)} />
              <DrawerAction icon={<Users size={13} />} label="View attendance" onClick={() => setAttendanceDrawerId(drawerOcc.id)} />
              <DrawerAction icon={<CheckCircle2 size={13} />} label="Manual check-in" onClick={() => setManualCheckinFor(drawerOcc.id)} />
              <DrawerAction icon={<RefreshCw size={13} />} label="Reschedule" onClick={() => setShowRescheduleModal(true)} />
              <DrawerAction icon={<X size={13} />} label="Cancel occurrence" onClick={() => setShowCancelModal(true)} danger />
            </div>

            <div className="rounded-xl mt-4 p-3 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}>
              <ShieldCheck size={13} style={{ color: "#A87616", marginTop: 2, flexShrink: 0 }} />
              <div style={{ fontSize: 11, color: "#7A5410" }}>Changing this occurrence will not affect the whole series unless &quot;entire series&quot; is selected.</div>
            </div>
          </div>
        </Drawer>
      )}

      {/* Day schedule drawer */}
      {dayDrawerIso && (
        <Drawer onClose={() => setDayDrawerIso(null)} width={460}>
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Day schedule</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>{new Date(`${dayDrawerIso}T00:00:00`).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</h2>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4, fontFamily: "var(--font-mono)" }}>{dayDrawerEvents.length} events</div>
          </div>
          <div className="px-6 py-5 flex flex-col gap-3">
            {dayDrawerEvents.length === 0 ? (
              <EmptyState
                icon={<CalendarDays size={20} />}
                title="No events on this day"
                body="Create one to begin planning."
                cta="Create event"
                onCta={() => {
                  setDayDrawerIso(null);
                  setShowCreateEvent(true);
                }}
              />
            ) : (
              dayDrawerEvents.map((o) => (
                <button
                  key={o.id}
                  onClick={() => {
                    setDayDrawerIso(null);
                    setDrawerOccId(o.id);
                  }}
                  className="text-left rounded-xl p-3"
                  style={{ background: "var(--secondary)", border: "1px solid var(--border)" }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 12, color: "var(--foreground)" }}>{o.time}</span>
                    <StatusPill status="scheduled" />
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{o.title}</div>
                  <div className="flex items-center gap-1.5 mt-1" style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                    <MapPin size={10} /> {o.location}
                  </div>
                </button>
              ))
            )}
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => {
                  setDayDrawerIso(null);
                  setShowCreateEvent(true);
                }}
                className="flex-1 rounded-xl py-2 flex items-center justify-center gap-1"
                style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}
              >
                <Plus size={12} /> Create event
              </button>
              <button
                onClick={() => {
                  setDayDrawerIso(null);
                  setShowCreateAnnouncement(true);
                }}
                className="flex-1 rounded-xl py-2 flex items-center justify-center gap-1"
                style={{ background: "var(--secondary)", color: "var(--foreground)", fontSize: 12, fontWeight: 600, border: "none" }}
              >
                <Bell size={12} /> Day announcement
              </button>
            </div>
          </div>
        </Drawer>
      )}

      {/* RSVP drawer — real roster (PR #127 GET /admin/events/:id/rsvps) */}
      {rsvpDrawerOcc && (
        <Drawer onClose={() => setRsvpDrawerId(null)} width={520}>
          <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>RSVP list · {rsvpDrawerOcc.title}</div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>RSVP responses</h2>
          </div>
          {(() => {
            const roster = rsvpRosters[rsvpDrawerOcc.id];
            if (!roster) return <div className="px-6 py-10" style={{ textAlign: "center", color: "var(--muted-foreground)", fontSize: 13 }}>Loading RSVPs…</div>;
            const META: Record<string, { label: string; fg: string; bg: string }> = {
              going: { label: "Going", fg: "#0F6B33", bg: "#E8F6EE" },
              maybe: { label: "Maybe", fg: "#B45309", bg: "#FFF7E6" },
              declined: { label: "Not going", fg: "#B91C1C", bg: "#FEF2F2" },
              no_response: { label: "No response", fg: "#6B7280", bg: "#F3F4F6" },
            };
            const tabs = (["going", "maybe", "declined", "no_response"] as const).filter((k) => k !== "no_response" || roster.no_response_scope === "cell");
            const rows: RsvpRosterRow[] = roster.buckets[rsvpFilter] ?? [];
            return (
              <>
                <div className="px-6 pt-4 flex items-center gap-2 flex-wrap">
                  {tabs.map((k) => (
                    <button key={k} onClick={() => setRsvpFilter(k)} className="rounded-full px-3 py-1.5" style={{ fontSize: 12, fontWeight: 700, border: "1px solid var(--border)", background: rsvpFilter === k ? META[k]!.bg : "var(--input-background)", color: rsvpFilter === k ? META[k]!.fg : "var(--muted-foreground)" }}>
                      {META[k]!.label} · {roster.counts[k]}
                    </button>
                  ))}
                </div>
                <div className="px-6 py-3 flex flex-col gap-1.5" style={{ maxHeight: 420, overflowY: "auto" }}>
                  {rows.length === 0 ? (
                    <p style={{ fontSize: 13, color: "var(--muted-foreground)", padding: "16px 0", textAlign: "center" }}>No members in “{META[rsvpFilter]!.label}”.</p>
                  ) : rows.map((m) => (
                    <div key={m.user_id} className="flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: "#fff", border: "1px solid var(--border)" }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{m.full_name}</div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.cell_name ?? "—"}</div>
                      </div>
                      <span className="rounded-full px-2.5 py-1 shrink-0" style={{ fontSize: 10.5, fontWeight: 700, background: META[m.response]?.bg ?? "#F3F4F6", color: META[m.response]?.fg ?? "#6B7280" }}>
                        {m.responded_at ? new Date(m.responded_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : META[m.response]?.label ?? "—"}
                      </span>
                    </div>
                  ))}
                  {roster.no_response_scope !== "cell" && (
                    <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>A no-response list is only available for cell-scoped events.</p>
                  )}
                </div>
                <div className="px-6 py-4" style={{ borderTop: "1px solid var(--border)" }}>
                  <button onClick={() => { setRsvpDrawerId(null); setShowCreateAnnouncement(true); }} className="w-full rounded-xl" style={{ height: 42, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
                    Send reminder to non-responders
                  </button>
                </div>
              </>
            );
          })()}
        </Drawer>
      )}

      {/* Attendance drawer (real roster + manual check-in + add guest) */}
      {attendanceDrawerOcc && (
        <AttendanceDrawer
          occ={attendanceDrawerOcc}
          roster={rosters[attendanceDrawerOcc.id] ?? null}
          onClose={() => setAttendanceDrawerId(null)}
          onManualCheckin={() => setManualCheckinFor(attendanceDrawerOcc.id)}
        />
      )}

      {/* Announcement drawer (real detail via AnnouncementsApi.get) */}
      {announcementDrawerObj && (
        <AnnouncementDrawer
          row={announcementDrawerObj}
          onClose={() => setAnnouncementDrawerId(null)}
          onSent={async () => {
            setNotice(`Announcement sent.`);
            setAnnouncementDrawerId(null);
            setAnnouncements(await AnnouncementsApi.list().catch(() => announcements));
          }}
          onCancelled={async () => {
            setNotice(`Announcement cancelled.`);
            setAnnouncementDrawerId(null);
            setAnnouncements(await AnnouncementsApi.list().catch(() => announcements));
          }}
          onError={setError}
        />
      )}

      {/* Create Event modal → OpsApi.createSeries */}
      {showCreateEvent && (
        <CreateEventModal
          onClose={() => setShowCreateEvent(false)}
          onCreated={async () => {
            setShowCreateEvent(false);
            setNotice("Event created. Occurrences generated and QR attendance is ready.");
            await refetch();
          }}
          onError={setError}
        />
      )}

      {/* Create Announcement modal → AnnouncementsApi.create */}
      {showCreateAnnouncement && (
        <CreateAnnouncementModal
          events={upcoming}
          onClose={() => setShowCreateAnnouncement(false)}
          onCreated={async () => {
            setShowCreateAnnouncement(false);
            setNotice("Announcement created.");
            setAnnouncements(await AnnouncementsApi.list().catch(() => announcements));
          }}
          onError={setError}
        />
      )}

      {/* QR full screen — secret/recent display-only; counts from real roster */}
      {qrScreenOcc && (
        <Modal onClose={() => setShowQrScreen(null)} width={960}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#15803D", letterSpacing: 0.5, textTransform: "uppercase" }}>● Live check-in</div>
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{qrScreenOcc.title}</h2>
              <div className="flex items-center gap-3 mt-1" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{qrScreenOcc.date} · {qrScreenOcc.time}</span>
                <span>·</span>
                <span>{qrScreenOcc.location}</span>
              </div>
            </div>
            <button onClick={() => setShowQrScreen(null)} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
              <X size={16} />
            </button>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "1.2fr 1fr" }}>
            <div className="flex flex-col items-center justify-center p-8" style={{ background: "var(--secondary)" }}>
              <QrPlaceholder value={qrSecret} size={320} />
              <div className="flex items-center gap-2 mt-4">
                <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                  <Sparkles size={12} style={{ color: "var(--nuru-gold)" }} /> QR refreshes every 30 seconds
                </span>
                <button onClick={() => setQrTick((t) => t + 1)} className="flex items-center gap-1 rounded-md px-3 py-1.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, color: "var(--foreground)", fontWeight: 600 }}>
                  <RefreshCw size={12} /> Refresh
                </button>
              </div>
              <code className="mt-3" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)", letterSpacing: 1.5 }}>{qrSecret}</code>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 8, textAlign: "center", maxWidth: 320 }}>Members scan this QR at the entrance to check in. Manual check-ins are logged separately and audited.</div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-3 gap-3 mb-5">
                <Metric label="Checked in" value={String(rosters[qrScreenOcc.id]?.checked_in.length ?? 0)} color="#15803D" />
                <Metric label="Guests" value={String(rosters[qrScreenOcc.id]?.guests.length ?? 0)} color="var(--nuru-navy)" />
                <Metric label="No-shows" value={String(rosters[qrScreenOcc.id]?.rsvp_no_show.length ?? 0)} color="#A87616" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Recent check-ins</div>
                <div className="flex flex-col gap-2" style={{ maxHeight: 220, overflowY: "auto" }}>
                  {(rosters[qrScreenOcc.id]?.checked_in ?? []).length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>No check-ins yet.</div>
                  ) : (
                    (rosters[qrScreenOcc.id]?.checked_in ?? []).map((c) => (
                      <div key={c.attendance_id} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--secondary)" }}>
                        <div className="flex items-center gap-2">
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", minWidth: 44 }}>{fmtTime(new Date(c.checked_in_at))}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>{c.full_name}</span>
                        </div>
                        <span style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600 }}>{c.method}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setManualCheckinFor(qrScreenOcc.id)} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
                  <UserPlus size={12} /> Manual check-in
                </button>
                <button
                  onClick={() => {
                    setShowQrScreen(null);
                    setAttendanceDrawerId(qrScreenOcc.id);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5"
                  style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}
                >
                  <Eye size={12} /> View attendance
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Manual check-in modal → OpsApi.manualCheckIn */}
      {manualCheckinFor && (
        <ManualCheckinModal
          eventId={manualCheckinFor}
          onClose={() => setManualCheckinFor(null)}
          onDone={async (name) => {
            const id = manualCheckinFor;
            setManualCheckinFor(null);
            setNotice(`Checked in ${name}.`);
            if (id) await loadRoster(id);
          }}
          onError={setError}
        />
      )}

      {/* Cancel modal — wired to POST /admin/events/series/:id/exceptions (is_cancelled) */}
      {showCancelModal && (
        <Modal onClose={() => setShowCancelModal(false)} width={460}>
          <div className="px-6 py-5">
            <div className="flex items-start gap-3">
              <div className="rounded-lg p-2" style={{ background: "#FEE2E2", color: "#B91C1C" }}>
                <AlertCircle size={18} />
              </div>
              <div>
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--foreground)" }}>Cancel this occurrence?</h2>
                <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>This will cancel only this event occurrence. The rest of the series will remain active.</p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-3">
              <Field label="Reason for cancellation">
                <textarea value={cancelReason} onChange={(ev) => setCancelReason(ev.target.value)} rows={2} className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
              </Field>
              <ToggleRow label="Notify attendees" defaultOn icon={<Bell size={13} />} />
              <ToggleRow label="Send cancellation announcement" defaultOn icon={<Send size={13} />} />
            </div>
          </div>
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowCancelModal(false)} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Keep event</button>
            <button
              onClick={() => void submitCancelOccurrence()}
              disabled={occActionBusy}
              className="rounded-xl px-4 py-2.5"
              style={{ background: "#B91C1C", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: occActionBusy ? 0.6 : 1 }}
            >
              {occActionBusy ? "Cancelling…" : "Cancel occurrence"}
            </button>
          </div>
        </Modal>
      )}

      {/* Reschedule modal — wired to POST /admin/events/series/:id/exceptions (new_start_at/new_end_at) */}
      {showRescheduleModal && (
        <Modal onClose={() => setShowRescheduleModal(false)} width={520}>
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Reschedule event</h2>
            <button onClick={() => setShowRescheduleModal(false)} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
              <X size={16} />
            </button>
          </div>
          <div className="px-6 py-5 flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="New date">
                <input type="date" value={rescheduleDate} onChange={(ev) => setRescheduleDate(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              </Field>
              <Field label="New start time">
                <input type="time" value={rescheduleTime} onChange={(ev) => setRescheduleTime(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
              </Field>
              <Field label="Duration">
                <select disabled className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
                  <option>{drawerOcc?.duration ?? "—"} (kept)</option>
                </select>
              </Field>
            </div>
            <Field label="Reason">
              <input value={rescheduleReason} onChange={(ev) => setRescheduleReason(ev.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
            </Field>
            <Field label="Scope">
              <div className="grid grid-cols-3 gap-2">
                {["This occurrence", "This + following", "Entire series"].map((s, i) => (
                  <button key={s} className="rounded-xl py-2" style={{ background: i === 0 ? "var(--nuru-navy)" : "var(--input-background)", color: i === 0 ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: i === 0 ? "var(--nuru-navy)" : "var(--border)", fontSize: 12, fontWeight: 600 }}>
                    {s}
                  </button>
                ))}
              </div>
            </Field>
            <ToggleRow label="Notify RSVP'd attendees" defaultOn icon={<Bell size={13} />} />
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Rescheduling can automatically send an announcement to RSVP'd members.</div>
          </div>
          <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
            <button onClick={() => setShowRescheduleModal(false)} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
            <button
              onClick={() => void submitRescheduleOccurrence()}
              disabled={occActionBusy}
              className="rounded-xl px-4 py-2.5"
              style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", opacity: occActionBusy ? 0.6 : 1 }}
            >
              {occActionBusy ? "Rescheduling…" : "Reschedule event"}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Attendance drawer (real roster)                                     */
/* ------------------------------------------------------------------ */

function AttendanceDrawer({ occ, roster, onClose, onManualCheckin }: { occ: UiOccurrence; roster: EventRoster | null; onClose: () => void; onManualCheckin: () => void }): ReactElement {
  const checkedIn = roster?.checked_in ?? [];
  const guests = roster?.guests ?? [];
  const total = checkedIn.length + guests.length;
  return (
    <Drawer onClose={onClose} width={560}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Attendance list · {occ.title}</div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 4 }}>{total} checked in</h2>
      </div>
      <div className="px-6 py-3">
        <div className="grid" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
          <span>Member</span>
          <span>Check-in</span>
          <span>Method</span>
          <span>Status</span>
        </div>
        {checkedIn.length === 0 && guests.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "16px 0" }}>No check-ins recorded yet.</div>
        ) : (
          <>
            {checkedIn.map((c) => (
              <div key={c.attendance_id} className="grid items-center py-2.5" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{c.full_name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtTime(new Date(c.checked_in_at))}</span>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{c.method}</span>
                <StatusPill status={c.method.toLowerCase() === "manual" ? "Manual" : "Verified"} />
              </div>
            ))}
            {guests.map((g) => (
              <div key={g.guest_id} className="grid items-center py-2.5" style={{ gridTemplateColumns: "1.3fr 0.7fr 0.7fr 0.8fr", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
                <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{g.guest_name}{g.first_time ? " · first-time" : ""}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtTime(new Date(g.created_at))}</span>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Guest</span>
                <StatusPill status="Guest" />
              </div>
            ))}
          </>
        )}
      </div>
      <div className="px-6 py-4 flex gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
        <button onClick={onManualCheckin} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
          <UserPlus size={12} /> Manual check-in
        </button>
        <button className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 12, fontWeight: 600, color: "var(--foreground)" }}>
          <Download size={12} /> Export
        </button>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Announcement drawer (real detail + send/cancel)                     */
/* ------------------------------------------------------------------ */

function AnnouncementDrawer({ row, onClose, onSent, onCancelled, onError }: { row: AnnouncementRow; onClose: () => void; onSent: () => void; onCancelled: () => void; onError: (m: string) => void }): ReactElement {
  const [detail, setDetail] = useState<(AnnouncementRow & { stats: AnnouncementStats[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void AnnouncementsApi.get(row.announcement_id).then(setDetail).catch(() => setDetail(null));
  }, [row.announcement_id]);
  const a = detail ?? row;
  async function send(): Promise<void> {
    setBusy(true);
    try {
      await AnnouncementsApi.send(row.announcement_id);
      onSent();
    } catch (e) {
      onError(errorMessage(e, "Could not send announcement."));
    } finally {
      setBusy(false);
    }
  }
  async function cancel(): Promise<void> {
    setBusy(true);
    try {
      await AnnouncementsApi.cancel(row.announcement_id);
      onCancelled();
    } catch (e) {
      onError(errorMessage(e, "Could not cancel announcement."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer onClose={onClose} width={520}>
      <div className="px-6 py-5" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-2">
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>Announcement</span>
          <StatusPill status={announcementStatusLabel(a.status)} />
        </div>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1.2 }}>{a.title}</h2>
      </div>
      <div className="px-6 py-5">
        <div className="rounded-xl p-4" style={{ background: "var(--secondary)", fontSize: 13, color: "var(--foreground)", lineHeight: 1.5 }}>{a.body}</div>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <DetailRow label="Audience" value={audienceLabel(a)} />
          <DetailRow label="Channels" value={a.channels.join(", ")} />
          <DetailRow label="Send time" value={fmtAnnouncementWhen(a)} mono />
          <DetailRow label="Status" value={announcementStatusLabel(a.status)} />
        </div>
        {detail && detail.stats.length > 0 && (
          <div className="mt-4">
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>Delivery</div>
            <div className="flex flex-col gap-2">
              {detail.stats.map((s) => (
                <div key={s.channel} className="flex items-center justify-between rounded-lg px-3 py-2" style={{ background: "var(--secondary)", fontSize: 12 }}>
                  <span style={{ fontWeight: 600, color: "var(--foreground)" }}>{s.channel}</span>
                  <span style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>{s.delivered}/{s.targeted} delivered · {s.opened} opened</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-wrap gap-2 mt-5">
          {(a.status === "draft" || a.status === "scheduled") && (
            <button onClick={() => void send()} disabled={busy} className="rounded-lg px-3 py-2" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>Send now</button>
          )}
          {a.status === "scheduled" && (
            <button onClick={() => void cancel()} disabled={busy} className="rounded-lg px-3 py-2" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: 12, fontWeight: 600, border: "none" }}>Cancel scheduled send</button>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/* ------------------------------------------------------------------ */
/* Manual check-in modal (member search → OpsApi.manualCheckIn)         */
/* ------------------------------------------------------------------ */

function ManualCheckinModal({ eventId, onClose, onDone, onError }: { eventId: string; onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [tab, setTab] = useState<"member" | "guest">("member");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [firstTime, setFirstTime] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      if (query.trim()) void OpsApi.members({ search: query.trim() }).then((r) => setResults(r.data.slice(0, 8))).catch(() => setResults([]));
      else setResults([]);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  async function checkIn(m: MemberRow): Promise<void> {
    setBusy(true);
    try {
      await OpsApi.manualCheckIn(eventId, { user_id: m.user_id, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone(m.full_name);
    } catch (e) {
      onError(errorMessage(e, "Check-in failed."));
    } finally {
      setBusy(false);
    }
  }
  async function addGuest(): Promise<void> {
    if (!guestName.trim()) return;
    setBusy(true);
    try {
      await OpsApi.addGuest(eventId, { guest_name: guestName.trim(), ...(guestPhone.trim() ? { phone: guestPhone.trim() } : {}), first_time: firstTime });
      onDone(guestName.trim());
    } catch (e) {
      onError(errorMessage(e, "Could not add guest."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width={480}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20 }}>Manual check-in</h2>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
          <X size={16} />
        </button>
      </div>
      <div className="px-6 pt-4">
        <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "var(--secondary)", width: "fit-content" }}>
          {(["member", "guest"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className="rounded-lg px-3 py-1.5" style={{ background: tab === t ? "var(--card)" : "transparent", color: "var(--foreground)", fontSize: 12, fontWeight: tab === t ? 700 : 500, border: "none", textTransform: "capitalize" }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      {tab === "member" ? (
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Search member">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
              <Search size={14} style={{ color: "var(--muted-foreground)" }} />
              <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member name…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
            </div>
          </Field>
          <div className="flex flex-col gap-1.5" style={{ maxHeight: 240, overflowY: "auto" }}>
            {results.map((m) => (
              <button key={m.user_id} onClick={() => void checkIn(m)} disabled={busy} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
                <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>
                  {m.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{m.full_name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.cell_name ?? "—"} · L{m.current_level ?? "—"}</div>
                </div>
                <CheckCircle2 size={16} style={{ color: "var(--nuru-gold)" }} />
              </button>
            ))}
            {query.trim() && results.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 4px" }}>No matches.</p> : null}
          </div>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. QR scan failed" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <div className="rounded-xl p-3 flex items-start gap-2" style={{ background: "#FFFBEB", border: "1px solid #F5E0A8" }}>
            <ShieldCheck size={13} style={{ color: "#A87616", marginTop: 2 }} />
            <div style={{ fontSize: 11, color: "#7A5410" }}>Manual check-ins are audited and visible in the attendance log.</div>
          </div>
        </div>
      ) : (
        <div className="px-6 py-5 flex flex-col gap-4">
          <Field label="Guest name *">
            <input autoFocus value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Visitor name" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <Field label="Phone">
            <input value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="+254 …" className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
          </Field>
          <label className="flex items-center gap-2.5 cursor-pointer">
            <span onClick={() => setFirstTime((v) => !v)} style={{ width: 36, height: 20, borderRadius: 999, background: firstTime ? "#16A34A" : "var(--switch-background)", position: "relative", flexShrink: 0 }}>
              <span style={{ position: "absolute", top: 2, left: firstTime ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} />
            </span>
            <span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>First-time visitor</span>
          </label>
        </div>
      )}
      <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
        {tab === "guest" && (
          <button onClick={() => void addGuest()} disabled={busy || !guestName.trim()} className="flex items-center gap-2 rounded-xl px-4 py-2.5" style={{ background: !guestName.trim() ? "var(--muted)" : "var(--nuru-navy)", color: !guestName.trim() ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none" }}>
            <UserPlus size={14} /> Add guest
          </button>
        )}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Create Event modal → OpsApi.createSeries                            */
/* ------------------------------------------------------------------ */

const EVENT_TYPES: { label: string; category: EventCategory }[] = [
  { label: "Worship Service", category: "worship" },
  { label: "Cell Gathering", category: "cell" },
  { label: "Discipleship Class", category: "class" },
  { label: "Leadership Meeting", category: "leadership" },
  { label: "Youth Event", category: "youth" },
  { label: "Prayer Meeting", category: "worship" },
  { label: "Special Event", category: "special" },
  { label: "Other", category: "special" },
];
const RECURRENCE = ["One-time", "Daily", "Weekly", "Monthly", "Custom"] as const;
const WEEKDAY_RRULE = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function CreateEventModal({ onClose, onCreated, onError }: { onClose: () => void; onCreated: () => void; onError: (m: string) => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [typeLabel, setTypeLabel] = useState(EVENT_TYPES[0]!.label);
  const [location, setLocation] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(90);
  const [recurrence, setRecurrence] = useState<(typeof RECURRENCE)[number]>("Weekly");
  const [days, setDays] = useState<Set<number>>(new Set([0]));
  const [visibility, setVisibility] = useState<"members" | "leaders" | "public">("members");
  const [rsvp, setRsvp] = useState(true);
  const [qr, setQr] = useState(true);
  const [manual, setManual] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function buildRrule(): string | undefined {
    if (recurrence === "One-time") return undefined;
    if (recurrence === "Daily") return "FREQ=DAILY";
    if (recurrence === "Monthly") return "FREQ=MONTHLY";
    if (recurrence === "Weekly" || recurrence === "Custom") {
      const sel = Array.from(days).sort().map((i) => WEEKDAY_RRULE[i]);
      return sel.length ? `FREQ=WEEKLY;BYDAY=${sel.join(",")}` : "FREQ=WEEKLY";
    }
    return undefined;
  }

  async function submit(asDraft: boolean): Promise<void> {
    setErr(null);
    if (!title.trim() || !startDate.trim()) {
      setErr("Event title and start date are required.");
      return;
    }
    const category = EVENT_TYPES.find((t) => t.label === typeLabel)?.category ?? "special";
    const startsAt = new Date(`${startDate}T${startTime || "09:00"}:00`);
    const body: Record<string, unknown> = {
      title: title.trim(),
      category,
      timezone: "Africa/Nairobi",
      starts_at: Number.isNaN(startsAt.getTime()) ? startDate : startsAt.toISOString(),
      start_date: startDate,
      start_time: startTime,
      duration_min: durationMin,
      visibility,
      rsvp_enabled: rsvp,
      qr_enabled: qr,
      manual_checkin_enabled: manual,
      status: asDraft ? "draft" : "active",
      ...(location.trim() ? { location: location.trim() } : {}),
    };
    const rrule = buildRrule();
    if (rrule) body.rrule = rrule;
    setBusy(true);
    try {
      await OpsApi.createSeries(body);
      onCreated();
    } catch (e) {
      const msg = errorMessage(e, "Could not create event.");
      setErr(msg);
      onError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width={720}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", letterSpacing: 0.5, textTransform: "uppercase" }}>New event</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>Create event</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
          <X size={16} />
        </button>
      </div>

      <div className="px-6 py-5 flex flex-col gap-5" style={{ maxHeight: "65vh", overflowY: "auto" }}>
        <SectionDivider label="Basic details" />
        <Field label="Event title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday Worship Service" className="w-full rounded-xl px-4 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Event type">
            <select value={typeLabel} onChange={(e) => setTypeLabel(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
              {EVENT_TYPES.map((t) => (
                <option key={t.label}>{t.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Location">
            <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
              <MapPin size={14} style={{ color: "var(--muted-foreground)" }} />
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Main Sanctuary" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} />
            </div>
          </Field>
        </div>

        <SectionDivider label="Date & time" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Field label="Start date">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Field label="Start time">
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, fontFamily: "var(--font-mono)" }} />
          </Field>
          <Field label="Duration">
            <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
              <option value={60}>1 hour</option>
              <option value={90}>1h 30m</option>
              <option value={120}>2 hours</option>
              <option value={150}>2h 30m</option>
              <option value={180}>3 hours</option>
            </select>
          </Field>
          <Field label="Timezone">
            <select className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
              <option>EAT (UTC+3)</option>
            </select>
          </Field>
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: -8 }}>Events are scheduled in East Africa Time.</div>

        <SectionDivider label="Recurrence" />
        <div className="grid grid-cols-5 gap-2">
          {RECURRENCE.map((r) => {
            const active = recurrence === r;
            return (
              <button key={r} onClick={() => setRecurrence(r)} className="rounded-xl py-2" style={{ background: active ? "var(--nuru-navy)" : "var(--input-background)", color: active ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: active ? 700 : 500, border: "1px solid", borderColor: active ? "var(--nuru-navy)" : "var(--border)" }}>
                <Repeat size={11} className="inline mr-1" /> {r}
              </button>
            );
          })}
        </div>
        {(recurrence === "Weekly" || recurrence === "Custom") && (
          <div className="grid grid-cols-7 gap-2">
            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => {
              const active = days.has(i);
              return (
                <button
                  key={i}
                  onClick={() =>
                    setDays((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="rounded-lg py-2"
                  style={{ background: active ? "var(--nuru-gold)" : "var(--input-background)", color: active ? "#fff" : "var(--foreground)", fontSize: 12, fontWeight: 700, border: "1px solid", borderColor: active ? "var(--nuru-gold)" : "var(--border)" }}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}

        <SectionDivider label="Attendance" />
        <div className="flex flex-col gap-2">
          <AttendanceToggle label="Enable RSVP" on={rsvp} setOn={setRsvp} icon={<Users size={13} />} />
          <AttendanceToggle label="Enable QR check-in" on={qr} setOn={setQr} icon={<QrCode size={13} />} />
          <AttendanceToggle label="Allow manual check-in" on={manual} setOn={setManual} icon={<CheckCircle2 size={13} />} />
        </div>

        <SectionDivider label="Visibility & reminders" />
        <Field label="Visibility">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as "members" | "leaders" | "public")} className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
            <option value="members">Members</option>
            <option value="leaders">Leaders only</option>
            <option value="public">Public</option>
          </select>
        </Field>
        <div className="flex flex-col gap-2">
          <ToggleRow label="Reminder 24 hours before" defaultOn icon={<Bell size={13} />} />
          <ToggleRow label="Reminder 1 hour before" defaultOn icon={<Bell size={13} />} />
          <ToggleRow label="Respect quiet hours (10pm – 6am)" defaultOn icon={<ShieldCheck size={13} />} />
        </div>
      </div>

      {err ? (
        <div className="mx-6 mb-1 rounded-lg" role="alert" style={{ background: "#FDECEC", color: "#A8281F", fontSize: 12.5, padding: "9px 12px", border: "1px solid #F5C6C2" }}>{err}</div>
      ) : null}
      <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", background: "transparent", border: "none" }}>Cancel</button>
        <button onClick={() => void submit(true)} disabled={busy} className="rounded-xl px-4 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{busy ? "Saving…" : "Save as draft"}</button>
        <button onClick={() => void submit(false)} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
          <QrCode size={14} /> Create event
        </button>
      </div>
    </Modal>
  );
}

function AttendanceToggle({ label, on, setOn, icon }: { label: string; on: boolean; setOn: (v: boolean) => void; icon: ReactNode }): ReactElement {
  return (
    <button type="button" onClick={() => setOn(!on)} className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
      <span className="rounded-md flex items-center justify-center" style={{ width: 32, height: 18, background: on ? "#16A34A" : "#D1D5DB", position: "relative" }}>
        <span className="rounded-full bg-white absolute" style={{ width: 14, height: 14, top: 2, left: on ? 16 : 2, transition: "left 0.15s" }} />
      </span>
      <span style={{ color: "var(--muted-foreground)" }}>{icon}</span>
      <span style={{ fontSize: 13, color: "var(--foreground)" }}>{label}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Create Announcement modal → AnnouncementsApi.create                 */
/* ------------------------------------------------------------------ */

const CHANNELS: { key: "push" | "email" | "sms" | "whatsapp" | "banner"; label: string; icon: ReactNode }[] = [
  { key: "push", label: "App push", icon: <Smartphone size={14} /> },
  { key: "email", label: "Email", icon: <Mail size={14} /> },
  { key: "sms", label: "SMS", icon: <Phone size={14} /> },
  { key: "whatsapp", label: "WhatsApp", icon: <MessageSquare size={14} /> },
  { key: "banner", label: "In-app banner", icon: <Mic2 size={14} /> },
];

function CreateAnnouncementModal({ events, onClose, onCreated, onError }: { events: UiOccurrence[]; onClose: () => void; onCreated: () => void; onError: (m: string) => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<Set<string>>(new Set(["push", "email"]));
  const [audience, setAudience] = useState<"all" | "cells" | "level">("all");
  const [schedule, setSchedule] = useState<"now" | "schedule">("now");
  const [busy, setBusy] = useState(false);

  async function submit(asDraft: boolean): Promise<void> {
    if (!title.trim() || !body.trim()) {
      onError("Announcement title and body are required.");
      return;
    }
    const payload: Record<string, unknown> = {
      title: title.trim(),
      body: body.trim(),
      channels: Array.from(channels),
      audience_kind: audience,
      status: asDraft ? "draft" : schedule === "now" ? "draft" : "scheduled",
    };
    setBusy(true);
    try {
      const created = await AnnouncementsApi.create(payload);
      if (!asDraft && schedule === "now") {
        await AnnouncementsApi.send(created.announcement_id).catch(() => undefined);
      }
      onCreated();
    } catch (e) {
      onError(errorMessage(e, "Could not create announcement."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} width={700}>
      <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", letterSpacing: 0.5, textTransform: "uppercase" }}>New announcement</div>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>Create announcement</h2>
        </div>
        <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", border: "none" }}>
          <X size={16} />
        </button>
      </div>
      <div className="px-6 py-5 flex flex-col gap-5" style={{ maxHeight: "65vh", overflowY: "auto" }}>
        <SectionDivider label="Message details" />
        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sunday Service Reminder" className="w-full rounded-xl px-4 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }} />
        </Field>
        <Field label="Body">
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Tomorrow we gather for worship at 9:00 AM…" className="w-full rounded-xl px-3 py-2.5 outline-none resize-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.5 }} />
        </Field>
        <Field label="Attach to event (optional)">
          <select className="w-full rounded-xl px-3 py-2.5 outline-none" style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 13 }}>
            <option>None — standalone</option>
            {events.map((e) => (
              <option key={e.id}>{e.title} · {e.date}</option>
            ))}
          </select>
        </Field>

        <SectionDivider label="Channels" />
        <div className="grid grid-cols-5 gap-2">
          {CHANNELS.map((c) => {
            const on = channels.has(c.key);
            return (
              <button
                key={c.key}
                onClick={() =>
                  setChannels((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.key)) next.delete(c.key);
                    else next.add(c.key);
                    return next;
                  })
                }
                className="rounded-xl py-3 flex flex-col items-center gap-1"
                style={{ background: on ? "var(--nuru-navy)" : "var(--input-background)", color: on ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: on ? "var(--nuru-navy)" : "var(--border)", fontSize: 11, fontWeight: 600 }}
              >
                {c.icon}
                {c.label}
              </button>
            );
          })}
        </div>

        <SectionDivider label="Audience" />
        <div className="grid grid-cols-3 gap-2">
          {([
            { key: "all", label: "All members" },
            { key: "cells", label: "Specific cells" },
            { key: "level", label: "Specific level" },
          ] as const).map((a) => {
            const on = audience === a.key;
            return (
              <button key={a.key} onClick={() => setAudience(a.key)} className="rounded-xl px-3 py-2" style={{ background: on ? "var(--nuru-gold)" : "var(--input-background)", color: on ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: on ? "var(--nuru-gold)" : "var(--border)", fontSize: 12, fontWeight: 600 }}>
                {a.label}
              </button>
            );
          })}
        </div>

        <SectionDivider label="Schedule" />
        <div className="grid grid-cols-2 gap-2">
          {([
            { key: "now", label: "Send now" },
            { key: "schedule", label: "Schedule later" },
          ] as const).map((s) => {
            const on = schedule === s.key;
            return (
              <button key={s.key} onClick={() => setSchedule(s.key)} className="rounded-xl py-2" style={{ background: on ? "var(--nuru-navy)" : "var(--input-background)", color: on ? "#fff" : "var(--foreground)", border: "1px solid", borderColor: on ? "var(--nuru-navy)" : "var(--border)", fontSize: 12, fontWeight: 600 }}>
                {s.label}
              </button>
            );
          })}
        </div>

        <SectionDivider label="Live preview" />
        <div className="rounded-xl p-4" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
          <div style={{ fontSize: 11, color: "rgba(232,239,245,0.7)", textTransform: "uppercase", letterSpacing: 0.5 }}>Nuru Church · Push notification</div>
          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6 }}>{title || "Announcement title"}</div>
          <div style={{ fontSize: 12, color: "rgba(232,239,245,0.85)", marginTop: 4, lineHeight: 1.5 }}>{body || "Your message preview appears here."}</div>
        </div>
      </div>
      <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ background: "var(--secondary)", borderTop: "1px solid var(--border)" }}>
        <button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ fontSize: 13, fontWeight: 600, background: "transparent", border: "none", color: "var(--foreground)" }}>Cancel</button>
        <button onClick={() => void submit(true)} disabled={busy} className="rounded-xl px-4 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Save draft</button>
        <button onClick={() => void submit(false)} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none" }}>
          <Send size={13} /> {schedule === "now" ? "Send now" : "Schedule"}
        </button>
      </div>
    </Modal>
  );
}

export default Events;
