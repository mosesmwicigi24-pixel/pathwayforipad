// Curriculum Levels — rebuilt to the "Final Pathway Portal" make, wired to live
// data (GET /admin/reports/levels + badge catalog + audit feed). Summary KPIs,
// learners-by-level pie, completion bar, enrolment-trend area, the six level
// cards, and an active-level deep-dive. Per-level facilitator/badge counts the
// make showed aren't tracked, so real per-level metrics (modules, learners,
// completion, certificates) are shown instead — nothing invented.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate } from "react-router-dom";
import {
  PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, LineChart, Line, Area, AreaChart,
} from "recharts";
import {
  ChevronRight, BookOpen, Users, Clock, Award, Sparkles, TrendingUp, GraduationCap,
  Heart, Flame, ArrowRight, CheckCircle2, PenSquare, Video, Star, PlayCircle,
  type LucideIcon,
} from "lucide-react";
import { AdminApi, ConfigApi, type LevelAnalyticsRow, type AuditRow } from "../../api/client";

interface Trend { [k: string]: string | number }

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  const m = Math.floor(s / 60); if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return d === 1 ? "Yesterday" : `${d}d ago`;
}
const humanize = (a: string): string => { const s = a.replace(/[._]/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

export function CurriculumLevels(): ReactElement {
  const navigate = useNavigate();
  const [levels, setLevels] = useState<LevelAnalyticsRow[]>([]);
  const [trend, setTrend] = useState<Trend[]>([]);
  const [badgeCount, setBadgeCount] = useState(0);
  const [activity, setActivity] = useState<AuditRow[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    void AdminApi.levelsReport().then((r) => {
      setLevels(r.levels);
      setTrend(r.trend);
      setActiveId((cur) => cur ?? r.levels[0]?.level_number ?? null);
    }).catch(() => {});
    void ConfigApi.badges().then((b) => setBadgeCount(b.length)).catch(() => {});
    void ConfigApi.audit({}).then((r) => setActivity(r.data.slice(0, 5))).catch(() => {});
  }, []);

  const totalLearners = levels.reduce((s, l) => s + l.learners, 0);
  const totalModules = levels.reduce((s, l) => s + l.modules_total, 0);
  const avgCompletion = levels.length ? Math.round(levels.reduce((s, l) => s + l.completion_pct, 0) / levels.length) : 0;
  const totalCertificates = levels.reduce((s, l) => s + l.certificates, 0);
  const activeLevel = levels.find((l) => l.level_number === activeId) ?? levels[0];

  const pieData = useMemo(() => levels.map((l) => ({ name: `L${l.level_number}`, value: l.learners, color: l.color })), [levels]);
  const barData = useMemo(() => levels.map((l) => ({ name: `L${l.level_number}`, completion: l.completion_pct, color: l.color })), [levels]);

  const summary = [
    { label: "Active learners", value: totalLearners.toLocaleString(), icon: Users, sub: "enrolled across the pathway", tone: "#16A34A" },
    { label: "Total modules", value: String(totalModules), icon: BookOpen, sub: `across ${levels.length} levels`, tone: "#C89B3C" },
    { label: "Avg completion", value: `${avgCompletion}%`, icon: TrendingUp, sub: "of published modules", tone: "#0EA5E9" },
    { label: "Badges available", value: String(badgeCount), icon: Award, sub: `${totalCertificates} certificates issued`, tone: "#7C3AED" },
  ];

  return (
    <div style={{ minHeight: "100%", background: "var(--background)" }}>
      {/* Hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <button onClick={() => navigate("/cms")} style={{ color: "rgba(232,239,245,0.55)", background: "none", border: "none" }}>Curriculum</button>
            <ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Levels overview</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}>
              <Sparkles size={11} /> {levels.length}-level pathway
            </span>
            <button onClick={() => navigate("/video-library")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", fontSize: 12, fontWeight: 600 }}><Video size={13} /> Video library</button>
            <button onClick={() => navigate("/cms")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", boxShadow: "0 6px 18px rgba(200,155,60,0.32)" }}><PenSquare size={13} /> Open CMS</button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {summary.map((k, idx) => {
            const Icon = k.icon;
            return (
              <div key={k.label} style={{ padding: "16px 22px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
                <div className="flex items-center justify-between mb-2">
                  <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.55)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>{k.label}</div>
                  <Icon size={14} style={{ color: k.tone }} />
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>{k.value}</div>
                <div style={{ fontSize: 11.5, color: "rgba(232,239,245,0.55)", marginTop: 4 }}>{k.sub}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: "28px clamp(16px, 4vw, 48px) 48px" }}>
        {/* Row 1: pie · bar · activity */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
          <div className="lg:col-span-4 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-2"><GraduationCap size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Learners by level</span></div>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 14 }}>Distribution across the pathway</p>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={88} paddingAngle={2} stroke="#fff" strokeWidth={2}>
                    {pieData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3">
              {levels.map((l) => (
                <div key={l.level_number} className="flex items-center gap-2 min-w-0">
                  <span style={{ width: 8, height: 8, background: l.color, borderRadius: 99, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, color: "var(--foreground)", fontWeight: 600 }}>L{l.level_number}</span>
                  <span style={{ fontSize: 11, color: "var(--muted-foreground)", marginLeft: "auto" }}>{l.learners}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2"><TrendingUp size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Completion by level</span></div>
              <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Avg {avgCompletion}%</span>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 14 }}>Published modules completed by enrolled learners</p>
            <div style={{ height: 235 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} unit="%" />
                  <Tooltip cursor={{ fill: "rgba(11,31,51,0.04)" }} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="completion" radius={[8, 8, 0, 0]}>
                    {barData.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-3 rounded-2xl p-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center gap-2 mb-4"><Sparkles size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Pathway activity</span></div>
            {activity.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--muted-foreground)" }}>No recent activity.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {activity.map((a) => (
                  <div key={a.audit_id} className="flex items-start gap-2.5">
                    <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 30, height: 30, background: "rgba(200,155,60,0.12)", color: "#C89B3C" }}><CheckCircle2 size={14} /></div>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.35 }}>
                        {a.actor_name ? <span style={{ fontWeight: 700 }}>{a.actor_name}</span> : null} {humanize(a.action)}{a.entity ? ` · ${a.entity}` : ""}
                      </div>
                      <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 2 }}>{relTime(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Row 2: trend + quick jump */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 mb-6">
          <div className="lg:col-span-8 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2"><Flame size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Enrolment trend (6 months)</span></div>
              <div className="flex items-center gap-3 flex-wrap">
                {levels.map((l) => (
                  <div key={l.level_number} className="flex items-center gap-1.5">
                    <span style={{ width: 8, height: 8, borderRadius: 99, background: l.color }} />
                    <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600 }}>L{l.level_number}</span>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 12 }}>New enrolments per level, by month started</p>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend}>
                  <defs>
                    {levels.map((l) => (
                      <linearGradient id={`grad-${l.level_number}`} key={l.level_number} x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor={l.color} stopOpacity={0.35} />
                        <stop offset="100%" stopColor={l.color} stopOpacity={0} />
                      </linearGradient>
                    ))}
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                  {levels.map((l) => (
                    <Area key={l.level_number} type="monotone" dataKey={`L${l.level_number}`} stroke={l.color} strokeWidth={2} fill={`url(#grad-${l.level_number})`} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="lg:col-span-4 flex flex-col gap-3">
            <QuickCard icon={PenSquare} title="Open the CMS" desc="Edit modules, lessons, and quizzes" tone="#0B1F33" onClick={() => navigate("/cms")} />
            <QuickCard icon={Video} title="Manage videos" desc="Upload, organise, and tag teachings" tone="#0EA5E9" onClick={() => navigate("/video-library")} />
            <QuickCard icon={Award} title="Certificates" desc="Issued credentials per level" tone="#C89B3C" onClick={() => navigate("/certificates")} />
            <QuickCard icon={Star} title="Badges" desc="Catalogue of formation markers" tone="#7C3AED" onClick={() => navigate("/badges")} />
          </div>
        </div>

        {/* Row 3: heading */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", letterSpacing: "-0.01em" }}>The levels</h2>
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>Click any level to preview its overview — open it to edit modules.</p>
          </div>
          <button onClick={() => navigate("/cms")} className="flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none" }}>Manage all in CMS <ArrowRight size={12} /></button>
        </div>

        {/* Row 4: level cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {levels.map((l) => {
            const active = activeId === l.level_number;
            return (
              <button key={l.level_number} onClick={() => setActiveId(l.level_number)} className="rounded-2xl text-left transition-all hover:-translate-y-0.5" style={{ background: "var(--card)", border: `1px solid ${active ? l.color : "var(--border)"}`, padding: 0, overflow: "hidden", boxShadow: active ? `0 8px 24px ${l.color}33, 0 0 0 2px ${l.color}22` : "0 1px 2px rgba(11,31,51,0.03)" }}>
                <div className="flex items-center justify-between" style={{ background: `linear-gradient(120deg, ${l.color} 0%, ${l.color}cc 100%)`, padding: "12px 18px", color: "#fff" }}>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center rounded-lg" style={{ width: 28, height: 28, background: "rgba(255,255,255,0.18)" }}><span style={{ fontFamily: "var(--font-display)", fontSize: 14 }}>{l.level_number}</span></div>
                    <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>LEVEL {l.level_number}</span>
                  </div>
                  {l.duration ? <span className="rounded-full" style={{ background: "rgba(255,255,255,0.2)", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "3px 9px", letterSpacing: "0.04em" }}>{l.duration}</span> : null}
                </div>
                <div style={{ padding: "16px 18px 18px" }}>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--foreground)", letterSpacing: "-0.01em", lineHeight: 1.2 }}>{l.title}</h3>
                  <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, marginTop: 4, minHeight: 36 }}>{l.theme || "Discipleship pathway level."}</p>
                  <div className="grid grid-cols-3 gap-2 mt-4">
                    {[
                      { lbl: "Modules", v: l.modules_total, I: BookOpen },
                      { lbl: "Learners", v: l.learners, I: Users },
                      { lbl: "Certs", v: l.certificates, I: Award },
                    ].map((m) => {
                      const I = m.I;
                      return (
                        <div key={m.lbl} className="rounded-lg text-center" style={{ background: `${l.color}14`, padding: "8px 6px" }}>
                          <I size={11} style={{ color: l.color, margin: "0 auto" }} />
                          <div style={{ fontFamily: "var(--font-display)", fontSize: 16, color: "var(--foreground)", marginTop: 2 }}>{m.v}</div>
                          <div style={{ fontSize: 10, color: "var(--muted-foreground)", fontWeight: 600 }}>{m.lbl}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4">
                    <div className="flex items-center justify-between mb-1.5">
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>Completion</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: l.color }}>{l.completion_pct}%</span>
                    </div>
                    <div style={{ height: 6, background: "var(--input-background)", borderRadius: 99, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${l.completion_pct}%`, background: `linear-gradient(90deg, ${l.color}, ${l.color}cc)`, borderRadius: 99 }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: "1px dashed var(--border)" }}>
                    <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "var(--muted-foreground)" }}><Clock size={11} /> {l.modules_published} published</div>
                    <span onClick={(e) => { e.stopPropagation(); navigate(`/cms/level/${l.level_number}`); }} className="flex items-center gap-1 cursor-pointer" style={{ fontSize: 12, color: l.color, fontWeight: 700 }}>Open <ArrowRight size={12} /></span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Row 5: active level deep-dive */}
        {activeLevel ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 rounded-2xl p-6" style={{ background: "var(--card)", border: "1px solid var(--border)", borderLeft: `5px solid ${activeLevel.color}` }}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: activeLevel.color, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 4 }}>Now viewing · Level {activeLevel.level_number}</div>
                  <h3 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", letterSpacing: "-0.01em" }}>{activeLevel.title}</h3>
                </div>
                <button onClick={() => navigate(`/cms/level/${activeLevel.level_number}`)} className="flex items-center gap-1.5 rounded-xl" style={{ height: 38, padding: "0 14px", background: activeLevel.color, color: "#fff", fontSize: 12.5, fontWeight: 600, border: "none", boxShadow: `0 6px 18px ${activeLevel.color}33` }}><PlayCircle size={14} /> Open level</button>
              </div>
              <p style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6 }}>{activeLevel.theme || "Discipleship pathway level."}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
                {[
                  { lbl: "Modules", v: String(activeLevel.modules_total), I: BookOpen, tone: "#0B1F33" },
                  { lbl: "Learners", v: String(activeLevel.learners), I: Users, tone: "#16A34A" },
                  { lbl: "Completion", v: `${activeLevel.completion_pct}%`, I: TrendingUp, tone: "#C89B3C" },
                  { lbl: "Certificates", v: String(activeLevel.certificates), I: Award, tone: "#7C3AED" },
                ].map((s) => {
                  const I = s.I;
                  return (
                    <div key={s.lbl} className="rounded-xl p-3" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{s.lbl}</span>
                        <I size={13} style={{ color: s.tone }} />
                      </div>
                      <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", lineHeight: 1 }}>{s.v}</div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5">
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>Enrolment momentum</div>
                <div style={{ height: 90 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend}>
                      <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                      <Line type="monotone" dataKey={`L${activeLevel.level_number}`} stroke={activeLevel.color} strokeWidth={2.5} dot={{ r: 3, fill: activeLevel.color }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <LinkRow icon={PenSquare} title="Edit modules" desc={`${activeLevel.modules_total} modules in CMS`} tone={activeLevel.color} onClick={() => navigate(`/cms/level/${activeLevel.level_number}`)} />
              <LinkRow icon={Heart} title="Reflection queue" desc="Pastoral review for this level" tone="#16A34A" onClick={() => navigate("/reflection-queue")} />
              <LinkRow icon={Users} title="Enrolled members" desc={`${activeLevel.learners} learners`} tone="#0EA5E9" onClick={() => navigate("/members")} />
              <LinkRow icon={Award} title="Certificates" desc={`${activeLevel.certificates} issued`} tone="#C89B3C" onClick={() => navigate("/certificates")} />
              <LinkRow icon={Star} title="Badges" desc="Formation markers" tone="#7C3AED" onClick={() => navigate("/badges")} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function QuickCard({ icon: Icon, title, desc, tone, onClick }: { icon: LucideIcon; title: string; desc: string; tone: string; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="rounded-2xl text-left transition-all hover:-translate-y-0.5 flex items-center gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px", boxShadow: "0 1px 2px rgba(11,31,51,0.03)" }}>
      <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 40, height: 40, background: `${tone}14`, color: tone }}><Icon size={18} /></div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{title}</div>
        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{desc}</div>
      </div>
      <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
    </button>
  );
}

function LinkRow({ icon: Icon, title, desc, tone, onClick }: { icon: LucideIcon; title: string; desc: string; tone: string; onClick: () => void }): ReactElement {
  return (
    <button onClick={onClick} className="rounded-xl text-left flex items-center gap-3 transition-all hover:bg-gray-50" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "12px 14px" }}>
      <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 34, height: 34, background: `${tone}14`, color: tone }}><Icon size={15} /></div>
      <div className="flex-1 min-w-0">
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--foreground)" }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{desc}</div>
      </div>
      <ArrowRight size={13} style={{ color: tone }} />
    </button>
  );
}
