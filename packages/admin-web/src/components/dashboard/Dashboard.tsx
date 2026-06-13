// Dashboard — rebuilt to the Figma make "Nuru Pathway Web Portal" exactly: navy
// hero band with breadcrumb + quick nav + embedded stat strip, pastel KPI tiles,
// curriculum pipeline, the Pathway Report (status-distribution donut + breakdown +
// engagement bar via recharts), recent events, quick actions, upcoming events and
// a needs-attention panel. Every figure is real — /admin/reports/*, engagement
// bands, attendance trend, calendar, consents, media-stuck and CMS counts.
import { useEffect, useState, type ReactElement } from "react";
import {
  ChevronRight, ArrowRight, Sparkles, MoreHorizontal, BookOpen, ClipboardCheck, Award,
  AlertTriangle, TrendingUp, FileEdit, Eye, UploadCloud, CheckCircle2,
  FilePlus2, UserPlus, HelpCircle, CalendarDays, Bell, PlayCircle, BarChart3,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  AdminApi, CurriculumApi, OpsApi, MediaApi,
  type OverviewKpis, type AttendanceTrendPoint, type ConsentRow, type AdminLevel,
  type EngagementReport, type CalendarOccurrence,
} from "../../api/client";
import { useAppSelector } from "../../store/hooks";
import { errorMessage } from "../../util/error";
import { shortWeekLabel } from "../../util/dashboardLogic";
import type { ScreenId } from "../shell/nav";

const navyDark = "var(--nuru-dark, #071629)";
const BANDS = [
  { key: "thriving", name: "Thriving", color: "#16A34A" },
  { key: "steady", name: "Steady", color: "#1F3A6B" },
  { key: "watch", name: "Watch", color: "#C89B3C" },
  { key: "at_risk", name: "At-risk", color: "#DC2626" },
] as const;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function nameFrom(email: string | null): string {
  const raw = (email ?? "there").split("@")[0] ?? "there";
  const first = raw.split(/[.\-_]/)[0] ?? raw;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

interface Data {
  overview: OverviewKpis;
  trend: AttendanceTrendPoint[];
  recentEvents: { event_id: string; title: string; occurs_at: string; checked_in: number; rsvp_going: number }[];
  consents: ConsentRow[];
  levels: AdminLevel[];
  engagement: EngagementReport;
  upcoming: CalendarOccurrence[];
  mediaStuck: number;
}

export function Dashboard({ onNavigate }: { onNavigate: (id: ScreenId) => void }): ReactElement {
  const email = useAppSelector((s) => s.auth.email);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"Overview" | "Curriculum" | "Members">("Overview");

  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 86_400_000);
    void (async () => {
      try {
        const [overview, attendance, consents, levels, engagement, upcoming, media] = await Promise.all([
          AdminApi.overview(),
          AdminApi.attendanceReport(8),
          AdminApi.consentsReport(),
          CurriculumApi.levels().catch(() => [] as AdminLevel[]),
          AdminApi.engagementReport().catch(() => ({ bands: {}, cells: [] }) as EngagementReport),
          OpsApi.calendar(now.toISOString(), in60.toISOString()).catch(() => [] as CalendarOccurrence[]),
          MediaApi.list().then((r) => r.stuck).catch(() => 0),
        ]);
        if (!cancelled) setData({ overview, trend: attendance.trend, recentEvents: attendance.recent_events, consents, levels, engagement, upcoming, mediaStuck: media });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not load the dashboard"));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p style={{ color: "var(--color-danger)" }}>{error}</p>;
  if (!data) return <p style={{ color: "var(--muted-foreground)" }}>Loading dashboard…</p>;

  const o = data.overview;
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const sum = (k: keyof AdminLevel): number => data.levels.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const inReviewLevels = data.levels.filter((l) => l.status === "in_review").length;

  const heroes = [
    { label: "Active learners", value: String(o.active_learners), hint: `${o.total_members} total members` },
    { label: "Cohorts running", value: String(o.cohorts_running), hint: "across the congregation" },
    { label: "Reflections (wk.)", value: String(o.reflections_this_week), hint: `${o.pending_reviews} pending review` },
    { label: "Avg engagement", value: pct(o.avg_engagement), hint: `${o.checked_in_this_week} checked in this wk` },
  ];
  const kpis = [
    { label: "Modules published", value: String(o.modules_published), icon: BookOpen, tint: "#FDF5E5", tone: "#8A6B1F", to: "cms" as ScreenId },
    { label: "Pending reviews", value: String(o.pending_reviews), icon: ClipboardCheck, tint: "#FDECEC", tone: "#A8281F", to: "reviews" as ScreenId },
    { label: "Certificates (mo.)", value: String(o.certificates_this_month), icon: Award, tint: "#E8F6EE", tone: "#0F6B33", to: "certificates" as ScreenId },
    { label: "Members at risk", value: String(o.members_at_risk), icon: AlertTriangle, tint: "#EEF1F8", tone: "#1F3A6B", to: "cohort-engagement" as ScreenId },
  ];
  const pipeline = [
    { label: "Drafts", value: sum("draft_count"), tint: "#FDF5E5", tone: "#8A6B1F", icon: FileEdit },
    { label: "Levels in review", value: inReviewLevels, tint: "#EEF1F8", tone: "#1F3A6B", icon: Eye },
    { label: "Archived", value: sum("archived_count"), tint: "#FDECEC", tone: "#A8281F", icon: UploadCloud },
    { label: "Published", value: sum("published_count"), tint: "#E8F6EE", tone: "#0F6B33", icon: CheckCircle2 },
  ];
  const dist = BANDS.map((b) => ({ name: b.name, value: data.engagement.bands[b.key] ?? 0, color: b.color }));
  const totalLearners = dist.reduce((s, d) => s + d.value, 0);
  const bars = data.trend.map((t) => ({ day: shortWeekLabel(t.week_start), checkins: t.check_ins }));
  const quick: { label: string; icon: typeof FilePlus2; to: ScreenId }[] = [
    { label: "New module", icon: FilePlus2, to: "module-editor" },
    { label: "Add learner", icon: UserPlus, to: "members" },
    { label: "Open review queue", icon: ClipboardCheck, to: "reviews" },
    { label: "Build a quiz", icon: HelpCircle, to: "quiz-builder" },
    { label: "Schedule event", icon: CalendarDays, to: "events" },
    { label: "Issue certificate", icon: Award, to: "certificates" },
    { label: "Send announcement", icon: Bell, to: "announcements" },
    { label: "Video library", icon: PlayCircle, to: "videos" },
  ];
  const risks = [
    { label: "Members at risk", value: o.members_at_risk, tone: "#DC2626", hint: "low engagement signal" },
    { label: "Reviews overdue (>3 days)", value: o.reviews_overdue, tone: "#DC2626", hint: "pastoral queue" },
    { label: "Guardian consents expiring", value: data.consents.length, tone: "#D97706", hint: "renew soon" },
    { label: "Videos stuck encoding", value: data.mediaStuck, tone: "#D97706", hint: "queued > 30 min" },
  ];
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const card = { background: "var(--card)", border: "1px solid var(--border)" } as const;
  const hbtn = { height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" } as const;

  return (
    <div style={{ margin: -28 }}>
      {/* Hero */}
      <div style={{ background: navyDark, padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between" style={{ gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div className="flex items-center" style={{ gap: 6, fontSize: 11, color: "rgba(232,239,245,0.55)" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Dashboard</span>
          </div>
          <div className="flex items-center" style={{ gap: 8, flexWrap: "wrap" }}>
            <span className="inline-flex items-center" style={{ gap: 6, height: 32, padding: "0 10px", borderRadius: 8, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> {today}</span>
            <button onClick={() => onNavigate("reviews")} className="flex items-center" style={{ gap: 8, padding: "0 12px", borderRadius: 8, ...hbtn }}><ClipboardCheck size={13} /> Review queue</button>
            <button onClick={() => onNavigate("cms")} className="flex items-center" style={{ gap: 8, padding: "0 12px", borderRadius: 8, ...hbtn }}><BookOpen size={13} /> Curriculum</button>
            <button onClick={() => onNavigate("members")} className="flex items-center" style={{ gap: 8, padding: "0 12px", borderRadius: 8, height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>Members <ArrowRight size={12} /></button>
          </div>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1, letterSpacing: "-0.015em" }}>{greeting()}, {nameFrom(email)}</h1>
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", marginTop: 16, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {heroes.map((it, i) => (
            <div key={it.label} style={{ padding: "14px 20px", borderRight: "1px solid rgba(255,255,255,0.07)", borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{it.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{it.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{it.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px", display: "flex", flexDirection: "column", gap: 20 }}>
        {/* KPI tiles */}
        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 16 }}>
          {kpis.map((k) => (
            <div key={k.label} onClick={() => onNavigate(k.to)} className="flex items-center" style={{ ...card, borderRadius: 16, padding: "16px 18px", gap: 12, cursor: "pointer" }}>
              <div className="flex items-center justify-center" style={{ width: 42, height: 42, borderRadius: 12, background: k.tint, color: k.tone, flexShrink: 0 }}><k.icon size={19} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{k.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1, marginTop: 2 }}>{k.value}</div>
              </div>
              <MoreHorizontal size={14} style={{ color: "var(--muted-foreground)" }} />
            </div>
          ))}
        </div>

        {/* Curriculum pipeline */}
        <div style={{ ...card, borderRadius: 16, padding: "18px 20px" }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div className="flex items-center" style={{ gap: 8 }}>
              <TrendingUp size={14} style={{ color: "var(--nuru-navy)" }} />
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Curriculum pipeline</h2>
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· {pipeline.reduce((s, p) => s + p.value, 0)} items</span>
            </div>
            <button onClick={() => onNavigate("cms")} className="flex items-center" style={{ gap: 4, fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View all <ChevronRight size={12} /></button>
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 }}>
            {pipeline.map((p) => (
              <div key={p.label} className="flex items-center" style={{ background: p.tint, padding: "14px 16px", borderRadius: 12, gap: 12 }}>
                <div className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.7)", color: p.tone }}><p.icon size={15} /></div>
                <div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: p.tone, lineHeight: 1 }}>{p.value}</div>
                  <div style={{ fontSize: 11, color: p.tone, fontWeight: 600, marginTop: 3, opacity: 0.85 }}>{p.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Pathway Report */}
        <div style={{ ...card, borderRadius: 16, padding: "20px 22px" }}>
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.15 }}>Pathway Report</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>Cohort performance, curriculum delivery and engagement signals.</p>
          </div>
          <div className="flex items-center" style={{ gap: 4, margin: "16px 0", borderBottom: "1px solid var(--border)" }}>
            {(["Overview", "Curriculum", "Members"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} style={{ padding: "8px 12px", fontSize: 12.5, fontWeight: 600, background: "none", border: "none", color: t === tab ? "var(--nuru-navy)" : "var(--muted-foreground)", borderBottom: t === tab ? "2px solid var(--nuru-gold)" : "2px solid transparent", marginBottom: -1 }}>{t}</button>
            ))}
          </div>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20 }}>
            {/* Donut */}
            <div style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Status distribution</h3>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{totalLearners} learners</span>
              </div>
              <div style={{ position: "relative", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={dist.filter((d) => d.value > 0)} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={2} stroke="none">
                      {dist.filter((d) => d.value > 0).map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-col items-center justify-center" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--nuru-navy)", lineHeight: 1 }}>{totalLearners}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>Total</div>
                </div>
              </div>
            </div>
            {/* Breakdown */}
            <div style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 8 }}>Status breakdown</h3>
              <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {dist.map((d, i) => (
                  <li key={d.name} className="flex items-center justify-between" style={{ gap: 8, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <div className="flex items-center" style={{ gap: 10 }}><span style={{ width: 9, height: 9, borderRadius: 99, background: d.color }} /><span style={{ fontSize: 12.5, color: "var(--nuru-navy)", fontWeight: 600 }}>{d.name}</span></div>
                    <div className="flex items-baseline" style={{ gap: 6 }}><span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--nuru-navy)" }}>{d.value}</span><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{totalLearners ? Math.round((d.value / totalLearners) * 100) : 0}%</span></div>
                  </li>
                ))}
              </ul>
            </div>
            {/* Engagement bar */}
            <div style={{ background: "var(--secondary)", border: "1px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: 8 }}>
                <div className="flex items-center" style={{ gap: 6 }}><BarChart3 size={13} style={{ color: "var(--nuru-gold)" }} /><h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Weekly check-ins</h3></div>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Last 8 weeks</span>
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bars} barCategoryGap={6}>
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} />
                    <YAxis hide />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="checkins" name="Check-ins" fill="#C89B3C" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Recent events + Quick actions */}
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          <div style={{ ...card, borderRadius: 16, padding: "18px 20px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Recent events</h2>
              <button onClick={() => onNavigate("events")} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View all</button>
            </div>
            <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.recentEvents.slice(0, 6).map((e, i) => (
                <li key={e.event_id} className="flex items-start" style={{ gap: 12, padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: 10, background: "#1F3A6B14", color: "#1F3A6B", flexShrink: 0 }}><CalendarDays size={15} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.35 }}>{e.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{e.checked_in} checked in · {e.rsvp_going} RSVP</div>
                  </div>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{new Date(e.occurs_at).toLocaleDateString()}</span>
                </li>
              ))}
              {data.recentEvents.length === 0 ? <li style={{ padding: "12px 0", color: "var(--muted-foreground)", fontSize: 13 }}>No events in the last 30 days.</li> : null}
            </ul>
          </div>
          <div style={{ ...card, borderRadius: 16, padding: "18px 20px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 12 }}>Quick actions</h2>
            <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {quick.map((q, i) => (
                <li key={q.label}>
                  <button onClick={() => onNavigate(q.to)} className="flex items-center" style={{ gap: 12, width: "100%", padding: "10px 0", textAlign: "left", background: "none", border: "none", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <q.icon size={15} style={{ color: "var(--nuru-gold)" }} />
                    <span style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, flex: 1 }}>{q.label}</span>
                    <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Upcoming + Needs attention */}
        <div className="grid" style={{ gridTemplateColumns: "2fr 1fr", gap: 20 }}>
          <div style={{ ...card, borderRadius: 16, padding: "18px 20px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Upcoming events</h2>
              <button onClick={() => onNavigate("events")} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>Calendar</button>
            </div>
            <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.upcoming.slice(0, 5).map((e, i) => {
                const d = new Date(e.starts_at);
                return (
                  <li key={`${e.event_id}-${e.starts_at}`} onClick={() => onNavigate("events")} className="flex items-center" style={{ gap: 12, padding: "12px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)", cursor: "pointer" }}>
                    <div className="flex flex-col items-center justify-center" style={{ width: 46, height: 46, borderRadius: 10, background: "#FDF5E5", color: "#8A6B1F", flexShrink: 0 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{d.toLocaleDateString("en-US", { weekday: "short" })}</span>
                      <span style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1 }}>{d.getDate()}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600 }}>{e.title}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>{d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{e.location ? ` · ${e.location}` : ""}</div>
                    </div>
                    <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
                  </li>
                );
              })}
              {data.upcoming.length === 0 ? <li style={{ padding: "12px 0", color: "var(--muted-foreground)", fontSize: 13 }}>Nothing scheduled in the next 60 days.</li> : null}
            </ul>
          </div>
          <div style={{ ...card, borderRadius: 16, padding: "18px 20px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Needs attention</h2>
              <AlertTriangle size={14} style={{ color: "#DC2626" }} />
            </div>
            <ul className="flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {risks.map((r, i) => (
                <li key={r.label} className="flex items-start justify-between" style={{ gap: 8, padding: "10px 0", borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.35 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{r.hint}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: r.tone, background: `${r.tone}14`, borderRadius: 999, padding: "2px 8px", flexShrink: 0 }}>{r.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
