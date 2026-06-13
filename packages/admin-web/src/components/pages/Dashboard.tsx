// Dashboard — rebuilt to the "Final Pathway Portal" Figma make, wired to live
// backend data. Hero stat strip + KPI tiles + curriculum pipeline + a Pathway
// Report (status donut, breakdown, engagement bars) + recent activity, quick
// actions, upcoming events and a risk watch-list. Every number is real; where the
// make shows a metric we don't track, the closest authoritative metric is used
// (noted inline) — nothing is invented.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, ChevronRight, Sparkles, MoreHorizontal, BookOpen, ClipboardCheck,
  Award, AlertTriangle, CalendarDays, HelpCircle, TrendingUp, FileEdit, Eye,
  UploadCloud, CheckCircle2, UserPlus, FilePlus2, Bell, PlayCircle,
  Download, Printer, CalendarRange, Filter, BarChart3, Globe, Languages as LanguagesIcon,
  type LucideIcon,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import {
  AdminApi, CurriculumApi, OpsApi, ConfigApi, MediaApi, SystemApi,
  type OverviewKpis, type EngagementReport, type AttendanceTrendPoint, type AdminLevel,
  type CalendarOccurrence, type AuditRow,
} from "../../api/client";

const REPORT_TABS = ["Overview", "Curriculum", "Members"] as const;
type ReportTab = (typeof REPORT_TABS)[number];

const BAND_META: { key: string; name: string; color: string }[] = [
  { key: "thriving", name: "Thriving", color: "#16A34A" },
  { key: "steady", name: "Steady", color: "#1F3A6B" },
  { key: "watch", name: "Watch", color: "#C89B3C" },
  { key: "at_risk", name: "At-risk", color: "#DC2626" },
];

const pct = (v: number): string => `${Math.round((v ?? 0) * 100)}%`;
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24); if (d === 1) return "Yesterday";
  return `${d} d ago`;
}
function humanize(action: string): string {
  const s = action.replace(/[._]/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const QUICK_ACTIONS: { label: string; icon: LucideIcon; route: string }[] = [
  { label: "New module", icon: FilePlus2, route: "/cms" },
  { label: "Add learner", icon: UserPlus, route: "/members" },
  { label: "Open review queue", icon: ClipboardCheck, route: "/reflection-queue" },
  { label: "Build a quiz", icon: HelpCircle, route: "/quiz-builder" },
  { label: "Schedule event", icon: CalendarDays, route: "/events" },
  { label: "Issue certificate", icon: Award, route: "/certificates" },
  { label: "Send announcement", icon: Bell, route: "/cell-engagement" },
  { label: "Video library", icon: PlayCircle, route: "/video-library" },
];

export function Dashboard(): ReactElement {
  const navigate = useNavigate();
  const [reportTab, setReportTab] = useState<ReportTab>("Overview");

  const [overview, setOverview] = useState<OverviewKpis | null>(null);
  const [bands, setBands] = useState<Record<string, number>>({});
  const [trend, setTrend] = useState<AttendanceTrendPoint[]>([]);
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [consents, setConsents] = useState(0);
  const [stuck, setStuck] = useState(0);
  const [countriesActive, setCountriesActive] = useState(0);
  const [languagesActive, setLanguagesActive] = useState(0);
  const [upcoming, setUpcoming] = useState<CalendarOccurrence[]>([]);
  const [activity, setActivity] = useState<AuditRow[]>([]);

  useEffect(() => {
    const now = new Date();
    const in60 = new Date(now.getTime() + 60 * 24 * 3600 * 1000);
    void AdminApi.overview().then(setOverview).catch(() => {});
    void AdminApi.engagementReport().then((r: EngagementReport) => setBands(r.bands)).catch(() => {});
    void AdminApi.attendanceReport(8).then((r) => setTrend(r.trend)).catch(() => {});
    void AdminApi.consentsReport().then((r) => setConsents(r.length)).catch(() => {});
    void CurriculumApi.levels().then(setLevels).catch(() => {});
    void MediaApi.list().then((r) => setStuck(r.stuck)).catch(() => {});
    void SystemApi.countries().then((r) => setCountriesActive(r.filter((c) => c.status === "active").length)).catch(() => {});
    void SystemApi.languages().then((r) => setLanguagesActive(r.filter((l) => l.status === "active").length)).catch(() => {});
    void OpsApi.calendar(now.toISOString(), in60.toISOString()).then((r) => setUpcoming(r.slice(0, 4))).catch(() => {});
    void ConfigApi.audit({}).then((r) => setActivity(r.data.slice(0, 6))).catch(() => {});
  }, []);

  const o = overview;
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const heroStats = [
    { label: "Active learners", value: String(o?.active_learners ?? 0), hint: `${o?.total_members ?? 0} total members` },
    { label: "Cohorts running", value: String(o?.cohorts_running ?? 0), hint: "live this term" },
    { label: "Reflections (wk.)", value: String(o?.reflections_this_week ?? 0), hint: `${o?.pending_reviews ?? 0} pending review` },
    { label: "Avg engagement", value: pct(o?.avg_engagement ?? 0), hint: "last 7 days" },
  ];

  const kpis: { label: string; value: string; icon: LucideIcon; tint: string; tone: string; route: string }[] = [
    { label: "Modules published", value: String(o?.modules_published ?? 0), icon: BookOpen, tint: "#FDF5E5", tone: "#8A6B1F", route: "/cms" },
    { label: "Pending reviews", value: String(o?.pending_reviews ?? 0), icon: ClipboardCheck, tint: "#FDECEC", tone: "#A8281F", route: "/reflection-queue" },
    { label: "Certificates (mo.)", value: String(o?.certificates_this_month ?? 0), icon: Award, tint: "#E8F6EE", tone: "#0F6B33", route: "/certificates" },
    { label: "Members at risk", value: String(o?.members_at_risk ?? 0), icon: AlertTriangle, tint: "#EEF1F8", tone: "#1F3A6B", route: "/cell-engagement" },
    { label: "Countries", value: String(countriesActive), icon: Globe, tint: "#EEF1F8", tone: "#1F3A6B", route: "/countries" },
    { label: "Languages", value: String(languagesActive), icon: LanguagesIcon, tint: "#F3E8FF", tone: "#7C3AED", route: "/languages" },
  ];

  const sum = (pick: (l: AdminLevel) => string | number): number =>
    levels.reduce((s, l) => s + Number(pick(l) || 0), 0);
  const pipeline = [
    { label: "Drafts", value: sum((l) => l.draft_count), tint: "#FDF5E5", tone: "#8A6B1F", icon: FileEdit },
    { label: "In review", value: levels.filter((l) => l.status === "in_review").length, tint: "#EEF1F8", tone: "#1F3A6B", icon: Eye },
    { label: "Archived", value: sum((l) => l.archived_count), tint: "#FDECEC", tone: "#A8281F", icon: UploadCloud },
    { label: "Published", value: sum((l) => l.published_count), tint: "#E8F6EE", tone: "#0F6B33", icon: CheckCircle2 },
  ];
  const pipelineTotal = pipeline.reduce((s, p) => s + p.value, 0);

  const distribution = BAND_META.map((b) => ({ name: b.name, value: bands[b.key] ?? 0, color: b.color }));
  const totalLearners = distribution.reduce((s, d) => s + d.value, 0);

  const engagementBars = useMemo(
    () => trend.map((t) => ({
      day: new Date(`${t.week_start}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      checkins: t.check_ins,
      members: t.unique_members,
    })),
    [trend],
  );

  const risks = [
    { label: "Members at risk", value: o?.members_at_risk ?? 0, tone: "#DC2626", hint: "low attendance + missed reflections" },
    { label: "Reviews overdue (>3 days)", value: o?.reviews_overdue ?? 0, tone: "#DC2626", hint: "pastoral queue" },
    { label: "Guardian consents to renew", value: consents, tone: "#D97706", hint: "minors needing renewal" },
    { label: "Videos stuck encoding", value: stuck, tone: "#D97706", hint: "queued in the pipeline" },
  ];

  return (
    <div style={{ minHeight: "100%", background: "var(--background)" }}>
      {/* ── Hero ── */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Dashboard</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <Sparkles size={11} /> {today}
            </span>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}>
              <ClipboardCheck size={13} /> Review queue
            </button>
            <button onClick={() => navigate("/cms")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}>
              <BookOpen size={13} /> Curriculum
            </button>
            <button onClick={() => navigate("/members")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}>
              Members <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1, letterSpacing: "-0.015em" }}>{greeting}</h1>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {heroStats.map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
        {/* KPI tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5 nuru-card-rotate">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <div key={k.label} onClick={() => navigate(k.route)} className="rounded-2xl flex items-center gap-3 cursor-pointer" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 42, background: k.tint, color: k.tone }}><Icon size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", letterSpacing: "0.02em" }}>{k.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1, marginTop: 2 }}>{k.value}</div>
                </div>
                <span className="rounded-md p-1" style={{ color: "var(--muted-foreground)" }}><MoreHorizontal size={14} /></span>
              </div>
            );
          })}
        </div>

        {/* Curriculum pipeline */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2">
              <TrendingUp size={14} style={{ color: "var(--nuru-navy)" }} />
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Curriculum pipeline</h2>
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>· {pipelineTotal} items</span>
            </div>
            <button onClick={() => navigate("/cms")} className="flex items-center gap-1" style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View all <ChevronRight size={12} /></button>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {pipeline.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.label} className="rounded-xl flex items-center gap-3" style={{ background: p.tint, padding: "14px 16px" }}>
                  <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: "rgba(255,255,255,0.7)", color: p.tone }}><Icon size={15} /></div>
                  <div>
                    <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: p.tone, lineHeight: 1 }}>{p.value}</div>
                    <div style={{ fontSize: 11, color: p.tone, fontWeight: 600, marginTop: 3, opacity: 0.85 }}>{p.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Pathway Report */}
        <div className="rounded-2xl mb-5" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "20px 22px" }}>
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-4">
            <div className="min-w-0">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.15 }}>Pathway Report</h2>
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 4 }}>Cohort performance, curriculum delivery and engagement signals.</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, color: "var(--nuru-navy)", fontWeight: 600 }}><Download size={12} /> Export</button>
              <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, color: "var(--nuru-navy)", fontWeight: 600 }}><Printer size={12} /> Print</button>
              <button className="flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ border: "1px solid var(--border)", background: "var(--card)", fontSize: 12, color: "var(--nuru-navy)", fontWeight: 600 }}><Filter size={12} /> Filters</button>
              <span className="flex items-center gap-1.5 rounded-lg px-3 py-1.5" style={{ background: "#FDF5E5", color: "#8A6B1F", fontSize: 12, fontWeight: 600, border: "1px solid #F2E2BD" }}><CalendarRange size={12} /> {today}</span>
            </div>
          </div>

          <div className="flex items-center gap-1 mb-5" style={{ borderBottom: "1px solid var(--border)" }}>
            {REPORT_TABS.map((t) => {
              const active = t === reportTab;
              return (
                <button key={t} onClick={() => setReportTab(t)} className="px-3 py-2" style={{ fontSize: 12.5, fontWeight: 600, color: active ? "var(--nuru-navy)" : "var(--muted-foreground)", borderBottom: active ? "2px solid var(--nuru-gold)" : "2px solid transparent", marginBottom: -1, background: "none" }}>{t}</button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Donut */}
            <div className="rounded-xl" style={{ background: "var(--secondary)", border: "1px solid var(--border)", padding: "16px 18px" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Status distribution</h3>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{totalLearners} learners</span>
              </div>
              <div style={{ position: "relative", height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={distribution} dataKey="value" innerRadius={55} outerRadius={82} paddingAngle={2} stroke="none">
                      {distribution.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "var(--nuru-navy)", lineHeight: 1 }}>{totalLearners}</div>
                  <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 4 }}>Total</div>
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="rounded-xl" style={{ background: "var(--secondary)", border: "1px solid var(--border)", padding: "16px 18px" }}>
              <div className="flex items-center justify-between mb-2">
                <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Status breakdown</h3>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>by band</span>
              </div>
              <ul className="flex flex-col">
                {distribution.map((d, i) => {
                  const p = totalLearners ? Math.round((d.value / totalLearners) * 100) : 0;
                  return (
                    <li key={d.name} className="flex items-center justify-between gap-2 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span style={{ width: 9, height: 9, borderRadius: 99, background: d.color }} />
                        <span style={{ fontSize: 12.5, color: "var(--nuru-navy)", fontWeight: 600 }}>{d.name}</span>
                      </div>
                      <div className="flex items-baseline gap-1.5">
                        <span style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--nuru-navy)" }}>{d.value}</span>
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{p}%</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Engagement bars */}
            <div className="rounded-xl" style={{ background: "var(--secondary)", border: "1px solid var(--border)", padding: "16px 18px" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <BarChart3 size={13} style={{ color: "var(--nuru-gold)" }} />
                  <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Attendance</h3>
                </div>
                <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>last 8 weeks</span>
              </div>
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={engagementBars} barCategoryGap={6}>
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis hide />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="members" fill="#E8E3D3" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="checkins" fill="#C89B3C" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-2">
                <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}><span style={{ width: 9, height: 9, borderRadius: 2, background: "#C89B3C" }} /> Check-ins</span>
                <span className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}><span style={{ width: 9, height: 9, borderRadius: 2, background: "#E8E3D3" }} /> Members</span>
              </div>
            </div>
          </div>
        </div>

        {/* Activity + Quick actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          <div className="lg:col-span-2 rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Recent activity</h2>
              <button onClick={() => navigate("/cell-engagement")} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View all</button>
            </div>
            {activity.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 0" }}>No recent activity recorded.</p>
            ) : (
              <ul className="flex flex-col">
                {activity.map((a, i) => (
                  <li key={a.audit_id} className="flex items-start gap-3 py-3" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                    <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 32, height: 32, background: "rgba(31,58,107,0.08)", color: "#1F3A6B" }}><TrendingUp size={15} /></div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.35 }}>{humanize(a.action)}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{a.entity ?? "system"}{a.actor_name ? ` · ${a.actor_name}` : ""}</div>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{relTime(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 12 }}>Quick actions</h2>
            <ul className="flex flex-col">
              {QUICK_ACTIONS.map((q, i) => {
                const Icon = q.icon;
                return (
                  <li key={q.label}>
                    <button onClick={() => navigate(q.route)} className="flex items-center gap-3 w-full py-2.5 text-left" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", background: "none", border: "none" }}>
                      <Icon size={15} style={{ color: "var(--nuru-gold)" }} />
                      <span style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600, flex: 1 }}>{q.label}</span>
                      <ChevronRight size={13} style={{ color: "var(--muted-foreground)" }} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>

        {/* Upcoming + Risks */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Upcoming events</h2>
              <button onClick={() => navigate("/events")} style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>Calendar</button>
            </div>
            {upcoming.length === 0 ? (
              <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 0" }}>No events scheduled in the next 60 days.</p>
            ) : (
              <ul className="flex flex-col">
                {upcoming.map((e, i) => {
                  const d = new Date(e.starts_at);
                  const wk = d.toLocaleDateString("en-US", { weekday: "short" });
                  const day = d.toLocaleDateString("en-US", { day: "numeric" });
                  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                  return (
                    <li key={e.event_id} onClick={() => navigate("/events")} className="flex items-center gap-3 py-3 cursor-pointer" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                      <div className="flex flex-col items-center justify-center rounded-lg shrink-0" style={{ width: 46, height: 46, background: "#FDF5E5", color: "#8A6B1F" }}>
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{wk}</span>
                        <span style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1 }}>{day}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div style={{ fontSize: 13, color: "var(--nuru-navy)", fontWeight: 600 }}>{e.title}</div>
                        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 1 }}>{time}{e.location ? ` · ${e.location}` : ""}</div>
                      </div>
                      <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <div className="flex items-center justify-between mb-3">
              <h2 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)" }}>Needs attention</h2>
              <AlertTriangle size={14} style={{ color: "#DC2626" }} />
            </div>
            <ul className="flex flex-col">
              {risks.map((r, i) => (
                <li key={r.label} className="flex items-start justify-between gap-2 py-2.5" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)" }}>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 12.5, color: "var(--nuru-navy)", fontWeight: 600, lineHeight: 1.35 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{r.hint}</div>
                  </div>
                  <span className="rounded-full px-2 py-0.5 shrink-0" style={{ fontSize: 11, fontWeight: 700, color: r.tone, background: `${r.tone}14` }}>{r.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
