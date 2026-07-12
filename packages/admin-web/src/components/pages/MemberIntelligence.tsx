// Member Intelligence — SuperAdmin/Admin analytics cockpit. Ported to match the
// iPad app's "People Intelligence" design (iPad has design precedence): pastel
// tinted KPI cards, premium tables, charts with visible axes, brand colours
// (bright green / gold / navy) only. Every number is real (AdminApi.intelligence
// → /admin/analytics/intelligence). Telemetry not yet captured (device model,
// screen dwell, login frequency, geo) is gated on the payload's boolean capture
// flags and rendered as honest "coming" notes — never fabricated. Prayer is
// excluded (pastoral-private, §5.4).
//
// Data fetching + wiring are unchanged from the prior version — this is a
// visual/design port only.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  Brain, Wallet, Users, Smartphone, Activity, BookOpen, MapPin, TrendingUp,
  Sparkles, Clock, Lock, Trophy, Gift, Repeat, PieChart as PieIcon, Grid2x2,
  Building2, Globe, BarChart3, CalendarCheck, CalendarDays, BadgeCheck,
  CheckCircle2, HelpCircle, Hourglass, Radio, type LucideIcon,
} from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LabelList, AreaChart, Area, Legend,
} from "recharts";
import { Link } from "react-router-dom";
import { AdminApi, type MemberIntelligence as Intel } from "../../api/client";

// ── Brand palette (matches index.css tokens; bright green / gold / navy only) ──
const NAVY = "#1d4e86";        // brand navy used for charts (lighter, on-brand)
const NAVY_INK = "#0b1f33";    // deep navy for text / hero
const GOLD = "#c89b3c";
const GREEN = "#22c55e";       // --nuru-green / --lum-green
const TEAL = "#0d7e73";
const VIOLET = "#5b2bb8";
const RED = "#dc2626";
// Brand tint rotation for ranked bars / fund rows.
const BRAND_TINTS = [NAVY, GOLD, TEAL, GREEN, VIOLET];
// Active-days frequency buckets: pale → bright green = more frequent use.
const ACTIVE_DAYS_TINTS = ["#9bd6ab", "#6ecb86", GREEN, TEAL, NAVY];

// Canonical engagement-band ordering + colour for the donut.
const BANDS: { key: string; name: string; color: string }[] = [
  { key: "thriving", name: "Thriving", color: GREEN },
  { key: "steady", name: "Steady", color: NAVY },
  { key: "watch", name: "Watch", color: GOLD },
  { key: "at_risk", name: "At-risk", color: RED },
];

const money = (minor: number, ccy: string): string =>
  `${ccy} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;
const pct1 = (v: number): string => `${(v ?? 0).toFixed(1)}%`;
const pretty = (s: string): string => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const KIND_LABEL: Record<string, string> = {
  lesson_open: "Lessons", lesson_view: "Lessons",
  scripture_read: "Scripture", verse_read: "Scripture",
  video_75pct: "Video", video_complete: "Video", video_play: "Video",
  quiz_attempt: "Quizzes", quiz_submit: "Quizzes",
  reflection_submit: "Reflections", reflection: "Reflections",
  plan_open: "Reading plans", reading_plan: "Reading plans",
  prayer: "Prayer", prayer_log: "Prayer",
  habit_check: "Habits", habit: "Habits",
  event_rsvp: "Events", event_view: "Events",
  give_open: "Giving", giving: "Giving",
  chat_open: "Chat", message: "Chat",
};
const kindLabel = (k: string): string => KIND_LABEL[k.toLowerCase()] ?? pretty(k);

const platformLabel = (p: string): string => {
  switch (p.toLowerCase()) {
    case "ios": return "iOS";
    case "android": return "Android";
    case "web": return "Web";
    default: return p ? pretty(p) : "Unknown";
  }
};
const platformColor = (p: string): string => {
  switch (p.toLowerCase()) {
    case "ios": return NAVY;
    case "android": return GREEN;
    case "web": return GOLD;
    default: return "#9ca3af";
  }
};

// Humanise a screen/route key into a friendly app-area label (reuses the
// affinity KIND_LABEL where it overlaps; falls back to title-cased text).
const SCREEN_LABEL: Record<string, string> = {
  home: "Home", dashboard: "Home", feed: "Home",
  lessons: "Lessons", lesson: "Lessons", curriculum: "Lessons", learn: "Lessons",
  scripture: "Scripture", bible: "Scripture", verses: "Scripture", verse: "Scripture",
  reading_plan: "Reading plans", plans: "Reading plans", plan: "Reading plans",
  video: "Video", videos: "Video",
  quiz: "Quizzes", quizzes: "Quizzes",
  reflections: "Reflections", reflection: "Reflections",
  prayer: "Prayer", habits: "Habits", habit: "Habits",
  events: "Events", event: "Events", calendar: "Events",
  giving: "Giving", give: "Giving",
  chat: "Chat", messages: "Chat",
  profile: "Profile", settings: "Settings", notifications: "Notifications",
  cell: "My cell", cells: "My cell", community: "Community",
};
const screenLabel = (s: string): string => {
  const key = (s ?? "").toLowerCase().replace(/[-/\s]+/g, "_").replace(/_screen$|^app_/g, "");
  return SCREEN_LABEL[key] ?? KIND_LABEL[key] ?? pretty(s || "—");
};

// Milliseconds → compact human duration: "Xh Ym", "Ym", or "Zs".
const fmtMs = (ms: number): string => {
  const total = Math.max(0, Math.round((ms ?? 0) / 1000)); // seconds
  if (total < 60) return `${total}s`;
  const mins = Math.round(total / 60);
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const hourLabel = (h: number): string => {
  const hr = ((h % 24) + 24) % 24;
  if (hr === 0) return "12a";
  if (hr === 12) return "12p";
  return hr < 12 ? `${hr}a` : `${hr - 12}p`;
};

// Week start (YYYY-MM-DD) → short "D Mon" axis label.
const weekLabel = (s: string): string => {
  const parts = (s ?? "").split("-");
  if (parts.length >= 3) {
    const m = Number(parts[1]);
    const day = Number(parts[2]);
    if (m >= 1 && m <= 12 && day >= 1 && day <= 31) {
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1];
      return `${day} ${mon}`;
    }
  }
  return s;
};

let regionNames: Intl.DisplayNames | null = null;
try { regionNames = new Intl.DisplayNames(undefined, { type: "region" }); } catch { regionNames = null; }
const countryName = (code: string): string => {
  const c = (code ?? "").toUpperCase();
  if (!c) return "—";
  try { return regionNames?.of(c) ?? c; } catch { return c; }
};

export function MemberIntelligence(): ReactElement {
  const [d, setD] = useState<Intel | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    AdminApi.intelligence().then(setD).catch(() => setErr("Could not load intelligence (Admin/SuperAdmin only)."));
  }, []);

  const ccy = d?.giving.currency || "KES";

  // Engagement bands ordered canonically; missing bands default to 0.
  const bandData = useMemo(() => {
    const by = new Map((d?.engagement.bands ?? []).map((b) => [b.band, b.members]));
    return BANDS.map((b) => ({ name: b.name, value: by.get(b.key) ?? 0, color: b.color }));
  }, [d]);

  const platformData = useMemo(
    () => (d?.devices.platforms ?? []).filter((p) => p.members > 0)
      .map((p) => ({ name: platformLabel(p.platform), value: p.members, color: platformColor(p.platform) })),
    [d],
  );

  if (err) {
    return (
      <div style={cardStyle(20)}>
        <h3 style={{ color: NAVY_INK, fontWeight: 700, fontFamily: "var(--font-display)" }}>Member Intelligence</h3>
        <p style={{ color: "var(--muted-foreground)", marginTop: 6 }}>{err}</p>
      </div>
    );
  }
  if (!d) return <div style={{ padding: 24, color: "var(--muted-foreground)" }}>Loading intelligence…</div>;

  const k = d.kpis;
  const g = d.giving;
  const dv = d.devices;
  const en = d.engagement;
  const gr = d.growth;
  const loc = d.location;
  const passRate = gr.quiz_attempts > 0 ? Math.round((gr.quiz_passed / gr.quiz_attempts) * 100) : 0;

  // Giving frequency, fixed bucket order, missing → 0.
  const freqOrder = ["1", "2-3", "4-6", "7+"];
  const freqByBucket = new Map(g.frequency.map((f) => [f.bucket, f.givers]));
  const freqColors = [NAVY, GOLD, TEAL, GREEN];
  const freqData = freqOrder.map((b, i) => ({ bucket: b, givers: freqByBucket.get(b) ?? 0, color: freqColors[i] ?? GOLD }));
  const freqTotal = freqData.reduce((s, f) => s + f.givers, 0);
  // Note: money breakdowns (giving trend / by fund / recurring-by-method) were
  // intentionally removed here — they live on the Finance page (no duplication).

  // Activity by hour 0..23, missing → 0; flag the peak.
  const hourMap = new Map(en.by_hour.map((h) => [h.hour, h.events]));
  const hourData = Array.from({ length: 24 }, (_, h) => ({ hour: h, label: hourLabel(h), events: hourMap.get(h) ?? 0 }));
  const hourTotal = hourData.reduce((s, h) => s + h.events, 0);
  const peakHour = hourData.reduce((a, b) => (b.events > a.events ? b : a), hourData[0]!);

  // Per-level distribution (learners + completed).
  const levelData = [...gr.by_level].sort((a, b) => a.level_number - b.level_number)
    .map((l) => ({ level: `L${l.level_number}`, Learners: l.learners, Completed: l.completed }));
  const levelHasData = levelData.some((l) => l.Learners > 0 || l.Completed > 0);

  const bandTotal = bandData.reduce((s, b) => s + b.value, 0);
  const platTotal = platformData.reduce((s, p) => s + p.value, 0);
  const active7Pct = k.total_members > 0 ? Math.round((k.active_7d / k.total_members) * 100) : 0;

  // Activity (additive block — older payloads omit it; render only when present & non-empty).
  const activeTrendData = (d.activity?.active_trend ?? []).map((t) => ({ week: weekLabel(t.week), active: t.active }));
  const activeTrendHasData = activeTrendData.some((t) => t.active > 0);
  const activeDaysOrder = ["1", "2-3", "4-7", "8-15", "16+"];
  const activeDaysBy = new Map((d.activity?.active_days ?? []).map((a) => [a.bucket, a.members]));
  const activeDaysData = activeDaysOrder.map((b, i) => ({
    bucket: b,
    members: activeDaysBy.get(b) ?? 0,
    color: ACTIVE_DAYS_TINTS[i] ?? GOLD,
  }));
  const activeDaysHasData = (d.activity?.active_days ?? []).length > 0 && activeDaysData.some((a) => a.members > 0);

  // Top device models (additive — older payloads omit `models`; render only when
  // capture is live AND we actually have rows, else keep the honest "coming" note).
  const deviceModels = (dv.models ?? []).filter((m) => m.members > 0).slice(0, 8);
  const showDeviceModels = dv.model_capture && deviceModels.length > 0;

  // Time per app area (#3 — additive; render only when capture is live AND rows
  // exist, else keep the honest "per-screen time — coming" note below).
  const areaDwell = [...(en.area_dwell ?? [])]
    .filter((a) => a.total_ms > 0)
    .sort((a, b) => b.total_ms - a.total_ms);
  const showAreaDwell = en.screen_dwell_capture && areaDwell.length > 0;
  const areaDwellTotalMs = areaDwell.reduce((s, a) => s + a.total_ms, 0);

  const deviceComing: string[] = [];
  if (!showDeviceModels) deviceComing.push("Exact device model & OS version — coming with capture-on-login.");
  if (!en.screen_dwell_capture) deviceComing.push("Per-screen time (which areas they linger in) — coming once screen telemetry ships.");
  if (!en.login_capture) deviceComing.push("Exact sign-in timestamps aren't captured yet — but active-users trend and active-days frequency below are real.");

  return (
    <div className="flex flex-col gap-6" style={{ padding: 4 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--nuru-navy-gradient, " + NAVY_INK + ")", color: "#fff", padding: "24px 26px", position: "relative" }}>
        <div style={{ position: "absolute", right: -50, top: -60, width: 200, height: 200, borderRadius: 999, background: "rgba(200,155,60,0.16)" }} />
        <div className="flex items-center justify-between" style={{ position: "relative" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,0.75)" }}>
            <span>System</span><span style={{ opacity: 0.5 }}>›</span><span style={{ color: "#fff" }}>People Intelligence</span>
          </div>
          <span className="flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: GOLD, background: "rgba(200,155,60,0.16)", padding: "4px 9px", borderRadius: 999 }}>
            <Lock size={11} /> Admin only
          </span>
        </div>
        <div style={{ position: "relative", marginTop: 14 }}>
          <div className="flex items-center gap-1.5" style={{ color: "#e6c46a", fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase" }}>
            <Brain size={14} /> People &amp; Growth
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, marginTop: 6, lineHeight: 1.1 }}>People Intelligence</h1>
          <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13.5, marginTop: 6, maxWidth: 620, lineHeight: 1.55 }}>
            Who your people are, how engaged they are, who gives, and how they use the app — one live read across the whole platform.
          </p>
        </div>
        {/* Hero stat strip */}
        <div style={{ position: "relative", marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 1, background: "rgba(255,255,255,0.08)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
          {[
            { label: "Members", value: `${k.total_members}`, hint: "on the pathway" },
            { label: "Active (7d)", value: `${k.active_7d}`, hint: "in-app last week" },
            { label: "Avg engagement", value: pct1(k.avg_engagement), hint: "0–100 score" },
            { label: "At risk", value: `${k.members_at_risk}`, hint: "need attention" },
            { label: "Givers", value: `${k.givers}`, hint: `${k.recurring_givers} recurring` },
          ].map((s) => (
            <div key={s.label} style={{ background: "rgba(255,255,255,0.05)", padding: "11px 13px" }}>
              <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: "rgba(255,255,255,0.6)" }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#fff", marginTop: 3 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", marginTop: 1 }}>{s.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── 1 · Overview block (two coherent strips at the top of the page) ──
          A single row of 8 KPI tiles (membership · engagement · giving · certs),
          then a single row of 6 growth stat tiles directly beneath — same tile
          styling so the two rows read as one overview block. Both strips use
          dedicated equal-column grids (8-up / 6-up) that step down responsively,
          not the 12-col dashboard grid used by the rest of the page. */}
      <Section icon={Users} title="Overview" hint="Live membership, engagement, giving & growth signal">
        <Strip cols={8}>
          <Kpi icon={Users} tint="navy" label="Total members" value={k.total_members} />
          <Kpi icon={Smartphone} tint="green" label="Active (7d)" value={k.active_7d} />
          <Kpi icon={CalendarDays} tint="teal" label="Active (30d)" value={k.active_30d} />
          <Kpi icon={TrendingUp} tint="gold" label="Avg engagement" value={pct1(k.avg_engagement)} />
          <Kpi icon={Activity} tint="rose" label="Members at risk" value={k.members_at_risk} />
          <Kpi icon={BadgeCheck} tint="green" label="Givers" value={k.givers} />
          <Kpi icon={Repeat} tint="violet" label="Recurring givers" value={k.recurring_givers} />
          <Kpi icon={Trophy} tint="amber" label="Certificates (mo.)" value={k.certificates_this_month} />
        </Strip>
        <div style={{ marginTop: 16 }}>
          <Strip cols={6}>
            <Kpi icon={BookOpen} tint="green" label="Verse learners" value={gr.verse_learners} small />
            <Kpi icon={BadgeCheck} tint="gold" label="Verses mastered" value={gr.verses_mastered} small />
            <Kpi icon={CalendarCheck} tint="navy" label="Plans completed" value={gr.plans_completed} small />
            <Kpi icon={CalendarDays} tint="teal" label="Plans active" value={gr.plans_active} small />
            <Kpi icon={HelpCircle} tint="violet" label="Quiz attempts" value={gr.quiz_attempts} small />
            <Kpi icon={CheckCircle2} tint="amber" label={`Quiz passed · ${passRate}%`} value={gr.quiz_passed} small />
          </Strip>
        </div>
      </Section>

      {/* ── 2 · Usage, giving & devices ──────────────────────────
          One coordinated dashboard block (matches the iPad reorg). Money
          breakdowns (by fund, trend, recurring-by-method, totals/medians) stay
          on the Finance page, which owns the ledger — we do NOT duplicate them;
          a quiet "→ Finance" pointer links across. Layout flows into explicit
          rows via the 12-column grid:
            Row of 4  · Givers · Giving frequency · App usage & devices · How often
            Full row  · Top givers table
            Row of 4  · Top device models · Activity by hour · App-area affinity · Time per app area
            Row of 3  · Platform split · App-version adoption · Active users (12 wk) */}
      <Section icon={Gift} title="Usage, giving & devices" hint={`${g.givers} givers · who gives, how they use the app & on what`}>
        <Grid>
          {/* ── Row of 4 ── */}

          {/* Givers — folds "recurring givers" into this one card. Quarter. */}
          <GridCell span={3}>
          <SubCard icon={BadgeCheck} title="Givers" hint={`${g.givers} total`}>
            <div className="flex items-baseline gap-2" style={{ marginTop: 2 }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 34, color: NAVY_INK, lineHeight: 1 }}>{g.givers}</span>
              <span style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>givers</span>
            </div>
            <div className="flex items-center gap-2" style={{ marginTop: "auto", padding: "10px 12px", background: "var(--tint-violet-bg)", borderRadius: 11, border: "1px solid var(--tint-violet-fg)2e" }}>
              <span style={{ width: 30, height: 30, borderRadius: 9, background: "rgba(255,255,255,0.55)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Repeat size={15} style={{ color: "var(--tint-violet-fg)" }} />
              </span>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: NAVY_INK, lineHeight: 1 }}>{k.recurring_givers}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 3 }}>recurring givers</div>
              </div>
            </div>
          </SubCard>
          </GridCell>

          {/* Giving frequency — 1/2-3/4-6/7+ chart. Quarter. */}
          <GridCell span={3}>
          <SubCard icon={BarChart3} title="Giving frequency" hint="givers by gift count">
            {freqTotal === 0 ? <Empty text="No giving recorded yet." /> : (
              <>
                <div style={{ height: 168 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={freqData} margin={{ top: 18, right: 6, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                      <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                      <Bar dataKey="givers" radius={[5, 5, 0, 0]} maxBarSize={40}>
                        <LabelList dataKey="givers" position="top" style={{ fontSize: 10, fontWeight: 700, fill: NAVY_INK }} />
                        {freqData.map((f) => <Cell key={f.bucket} fill={f.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-x-3.5 gap-y-1.5" style={{ marginTop: 10 }}>
                  {freqData.map((f) => (
                    <span key={f.bucket} className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                      <span style={{ width: 9, height: 9, borderRadius: 3, background: f.color, display: "inline-block" }} /> {f.bucket} gifts
                    </span>
                  ))}
                </div>
              </>
            )}
          </SubCard>
          </GridCell>

          {/* App usage & devices — the active-in-app 7d/30d card. Quarter. */}
          <GridCell span={3}>
          <SubCard icon={Radio} title="App usage & devices" hint="active in app">
            <div className="flex items-baseline gap-4" style={{ marginTop: 4 }}>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: NAVY_INK, lineHeight: 1 }}>{k.active_7d}</div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#9ca3af", marginTop: 3 }}>LAST 7 DAYS</div>
              </div>
              <div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 30, color: "var(--tint-green-fg)", lineHeight: 1 }}>{k.active_30d}</div>
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "#9ca3af", marginTop: 3 }}>LAST 30 DAYS</div>
              </div>
            </div>
            <div className="flex items-center gap-2" style={{ marginTop: "auto", padding: "10px 12px", background: "var(--tint-green-bg)", borderRadius: 11, border: "1px solid var(--tint-green-fg)2e" }}>
              <span style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--tint-green-fg)", lineHeight: 1 }}>{active7Pct}%</span>
              <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>active (7d) of {k.total_members} members</span>
            </div>
          </SubCard>
          </GridCell>

          {/* How often members use the app — active-days distribution. Quarter. */}
          <GridCell span={3}>
          {activeDaysHasData ? (
            <SubCard icon={CalendarCheck} title="How often they use the app" hint="active days · last 30d">
              <div style={{ height: 168 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activeDaysData} margin={{ top: 18, right: 6, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="bucket" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                    <Bar dataKey="members" radius={[5, 5, 0, 0]} maxBarSize={40}>
                      <LabelList dataKey="members" position="top" style={{ fontSize: 10, fontWeight: 700, fill: NAVY_INK }} />
                      {activeDaysData.map((a) => <Cell key={a.bucket} fill={a.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1.5" style={{ marginTop: 10 }}>
                {activeDaysData.map((a) => (
                  <span key={a.bucket} className="flex items-center gap-1.5" style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: a.color, display: "inline-block" }} /> {a.bucket} {a.bucket === "1" ? "day" : "days"}
                  </span>
                ))}
              </div>
            </SubCard>
          ) : (
            <SubCard icon={CalendarCheck} title="How often they use the app" hint="active days · last 30d">
              <Empty text="No active-days distribution recorded yet." />
            </SubCard>
          )}
          </GridCell>

          {/* ── Top givers table — FULL WIDTH ── */}
          <GridCell span={12}>
          <div style={{ ...cardStyle(0), overflow: "hidden", height: "100%" }}>
            <CardHeader icon={Trophy} title="Top givers" hint="by total" />
            {g.top_givers.length === 0 ? <div style={{ padding: "0 20px 16px" }}><Empty text="No givers yet." /></div> : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "var(--secondary)" }}>
                    <th style={{ ...thL }}>GIVER</th>
                    <th style={thR}>GIFTS</th>
                    <th style={thR}>TOTAL</th>
                    <th style={thR}>AVG</th>
                    <th style={thR}>LAST</th>
                  </tr>
                </thead>
                <tbody>
                  {g.top_givers.slice(0, 12).map((t, i) => {
                    const name = t.name || "Anonymous";
                    return (
                      <tr key={t.user_id || name} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent" }}>
                        <td style={{ ...tdL }}>
                          <span className="flex items-center gap-2.5">
                            <span style={rankBadge(i + 1)}>{i + 1}</span>
                            <span style={monogram()}>{initials(name)}</span>
                            <span style={{ fontWeight: 600, color: NAVY_INK }}>{name}</span>
                          </span>
                        </td>
                        <td style={tdR}>{t.gifts}</td>
                        <td style={{ ...tdR, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 14.5, color: NAVY_INK }}>{money(t.total_minor, ccy)}</td>
                        <td style={{ ...tdR, color: "var(--muted-foreground)" }}>{money(t.avg_minor, ccy)}</td>
                        <td style={{ ...tdR, color: "#9ca3af", fontWeight: 500 }}>
                          {t.last_at ? new Date(t.last_at).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          </GridCell>

          {/* ── Row of 4 ── */}

          {/* Top device models — Quarter. (REAL; gated on dv.model_capture +
              non-empty dv.models — else honest "coming" note.) */}
          <GridCell span={3}>
          {showDeviceModels ? (
            <SubCard icon={Smartphone} title="Top device models" hint={`top ${deviceModels.length}`}>
              <BarList
                rows={deviceModels.map((m, i) => ({
                  label: m.model || "Unknown",
                  value: m.members,
                  display: `${m.members}`,
                  color: i === 0 ? GREEN : BRAND_TINTS[i % BRAND_TINTS.length],
                }))}
              />
            </SubCard>
          ) : (
            <SubCard icon={Smartphone} title="Top device models" hint="coming">
              <div style={{ ...comingCard, padding: 12 }} className="flex items-start gap-2">
                <Hourglass size={12} style={{ color: "#cbd5e1", marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#9ca3af", lineHeight: 1.45 }}>
                  Exact device model &amp; OS version — coming with capture-on-login. Nothing here is estimated.
                </span>
              </div>
            </SubCard>
          )}
          </GridCell>

          {/* Activity by hour — Quarter. */}
          <GridCell span={3}>
          <SubCard icon={Clock} title="Activity by hour" hint={hourTotal > 0 ? `peak ${peakHour.label}` : "when the app is used"}>
            {hourTotal === 0 ? <Empty text="No in-app activity recorded yet." /> : (
              <div style={{ height: 180 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }} barCategoryGap={1}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fill: "#6b7280" }}
                      ticks={["12a", "6a", "12p", "6p"]} interval={0} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                    <Bar dataKey="events" radius={[2, 2, 0, 0]}>
                      {hourData.map((h) => <Cell key={h.hour} fill={h.hour === peakHour.hour ? GREEN : GOLD} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SubCard>
          </GridCell>

          {/* App-area affinity — the by_kind "content areas". Quarter. */}
          <GridCell span={3}>
          <div style={{ ...cardStyle(0), overflow: "hidden", height: "100%" }}>
            <CardHeader icon={Grid2x2} title="App-area affinity" hint="events · members" />
            {en.by_kind.length === 0 ? <div style={{ padding: "0 20px 16px" }}><Empty text="No app-area engagement recorded yet." /></div> : (
              <BarList
                padded
                rows={[...en.by_kind].sort((a, b) => b.events - a.events).map((x, i) => ({
                  label: kindLabel(x.kind),
                  value: x.events,
                  display: `${x.events.toLocaleString()}`,
                  tag: `${x.members} ppl`,
                  color: BRAND_TINTS[i % BRAND_TINTS.length],
                }))}
              />
            )}
          </div>
          </GridCell>

          {/* Time per app area (dwell) — Quarter. (REAL; gated on
              screen_dwell_capture + non-empty — else honest "coming" note.) */}
          <GridCell span={3}>
          {showAreaDwell ? (
            <div style={{ ...cardStyle(0), overflow: "hidden", height: "100%" }}>
              <CardHeader icon={Clock} title="Time per app area" hint={`last 30d · ${fmtMs(areaDwellTotalMs)}`} />
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "var(--secondary)" }}>
                    <th style={thL}>APP AREA</th>
                    <th style={thR}>TIME</th>
                    <th style={thR}>SHARE</th>
                    <th style={thR}>MEMBERS</th>
                  </tr>
                </thead>
                <tbody>
                  {areaDwell.map((a, i) => {
                    const share = areaDwellTotalMs > 0 ? (a.total_ms / areaDwellTotalMs) * 100 : 0;
                    const color = BRAND_TINTS[i % BRAND_TINTS.length] ?? NAVY;
                    return (
                      <tr key={a.screen} style={{ borderTop: "1px solid var(--border)", background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent" }}>
                        <td style={tdL}>
                          <span className="flex items-center gap-2">
                            <span style={tintChip(color)}><Clock size={13} /></span>
                            <span style={{ fontWeight: 600, color: NAVY_INK }}>{screenLabel(a.screen)}</span>
                          </span>
                        </td>
                        <td style={{ ...tdR, fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 13.5, color: NAVY_INK }}>{fmtMs(a.total_ms)}</td>
                        <td style={{ ...tdR, color: "var(--muted-foreground)" }}>{Math.round(share)}%</td>
                        <td style={{ ...tdR, color: "var(--muted-foreground)" }}>{a.members.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <SubCard icon={Clock} title="Time per app area" hint="coming">
              <div style={{ ...comingCard, padding: 12 }} className="flex items-start gap-2">
                <Hourglass size={12} style={{ color: "#cbd5e1", marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#9ca3af", lineHeight: 1.45 }}>
                  Per-screen time (which areas members linger in) — coming once screen telemetry ships. Nothing here is estimated.
                </span>
              </div>
            </SubCard>
          )}
          </GridCell>

          {/* ── Row of 3 — remaining usage cards ── */}

          {/* Platform split — Third. */}
          <GridCell span={4}>
          <SubCard icon={PieIcon} title="Platform split" hint={`${platTotal} devices`}>
            {platTotal === 0 ? <Empty text="No platform data yet." /> : (
              <div className="flex items-center gap-4" style={{ flexWrap: "wrap" }}>
                <Donut data={platformData} centerLabel="Devices" centerValue={platTotal} />
                <ul className="flex flex-col gap-2" style={{ flex: 1, minWidth: 140 }}>
                  {platformData.map((p) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span style={{ width: 9, height: 9, borderRadius: 99, background: p.color }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{p.name}</span>
                      <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{p.value}</span>
                      <span style={{ fontSize: 11, color: "var(--muted-foreground)", width: 36, textAlign: "right" }}>
                        {Math.round((p.value / platTotal) * 100)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </SubCard>
          </GridCell>

          {/* App-version adoption — Third. */}
          <GridCell span={4}>
          <SubCard icon={Smartphone} title="App-version adoption" hint={`top ${Math.min(dv.app_versions.length, 8)}`}>
            {dv.app_versions.length === 0 ? <Empty text="No version data yet." /> : (
              <BarList
                rows={dv.app_versions.slice(0, 8).map((v, i) => ({
                  label: v.app_version || "—",
                  value: v.members,
                  display: `${v.members}`,
                  color: i === 0 ? GREEN : GOLD,
                  mono: true,
                }))}
              />
            )}
          </SubCard>
          </GridCell>

          {/* Active users — last 12 weeks — Third. (REAL; from activity.active_trend.) */}
          <GridCell span={4}>
          {activeTrendHasData ? (
            <SubCard icon={TrendingUp} title="Active users — last 12 weeks" hint="distinct members / week">
              <div style={{ height: 200 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={activeTrendData} margin={{ top: 8, right: 6, left: -10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="activeTrend" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={GREEN} stopOpacity={0.28} />
                        <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="week" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fill: "#6b7280" }} interval="preserveStartEnd" minTickGap={18} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ stroke: GREEN, strokeOpacity: 0.4 }} contentStyle={tip} />
                    <Area type="monotone" dataKey="active" name="Active members" stroke={GREEN} strokeWidth={2.5} fill="url(#activeTrend)" dot={{ r: 3, fill: GREEN }} activeDot={{ r: 5 }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </SubCard>
          ) : (
            <SubCard icon={TrendingUp} title="Active users — last 12 weeks" hint="distinct members / week">
              <Empty text="No weekly-active trend recorded yet." />
            </SubCard>
          )}
          </GridCell>

          {/* Gated "coming" notes — genuinely-missing login telemetry only. Full row.
              (Device-model & per-screen-dwell notes now live inline in their cards
              above; this carries only the remaining login-timestamp note.) */}
          {!en.login_capture && (
            <GridCell span={12}>
            <div style={comingCard}>
              <div className="flex items-start gap-2">
                <Hourglass size={12} style={{ color: "#cbd5e1", marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, color: "#9ca3af", lineHeight: 1.45 }}>
                  Exact sign-in timestamps aren't captured yet — but the active-users trend and active-days frequency above are real.
                </span>
              </div>
            </div>
            </GridCell>
          )}

          {/* → Finance pointer — fund / channel / ledger detail lives there. Full row. */}
          <GridCell span={12}>
          <Link to="/finance" style={{ textDecoration: "none" }}>
            <div style={{ ...cardStyle(14) }} className="flex items-center gap-2.5">
              <span style={{ width: 32, height: 32, borderRadius: 9, background: "var(--tint-gold-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Wallet size={15} style={{ color: "var(--tint-gold-fg)" }} />
              </span>
              <span style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>
                Fund, channel &amp; ledger detail — giving by fund, monthly trend and recurring-by-method —
                live on the <span style={{ color: NAVY, fontWeight: 600 }}>Finance</span> page.
              </span>
              <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 600, color: NAVY, flexShrink: 0, whiteSpace: "nowrap" }}>
                Finance →
              </span>
            </div>
          </Link>
          </GridCell>
        </Grid>
      </Section>

      {/* ── 5 · Engagement & growth ──────────────────────────── */}
      <Section icon={PieIcon} title="Engagement & growth" hint={`${bandTotal} members · ${pct1(k.avg_engagement)} avg score`}>
        <Grid>
          {/* ── Row of 3 ── */}

          {/* Engagement bands donut — Third. */}
          <GridCell span={4}>
          <SubCard icon={PieIcon} title="Engagement bands" hint={`${bandTotal} members`}>
            <div className="flex items-center justify-center" style={{ minHeight: 150 }}>
              <Donut data={bandTotal === 0 ? [{ name: "None", value: 1, color: "var(--border)" }] : bandData} centerLabel="Members" centerValue={bandTotal} />
            </div>
          </SubCard>
          </GridCell>

          {/* Band breakdown — Third. (Same band data, list form.) */}
          <GridCell span={4}>
          <SubCard icon={BarChart3} title="Band breakdown" hint="members per band">
            <ul className="flex flex-col gap-3" style={{ marginTop: 4 }}>
              {bandData.map((b) => (
                <li key={b.name}>
                  <div className="flex items-center gap-2" style={{ marginBottom: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 99, background: b.color }} />
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{b.name}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--font-display)", fontSize: 15, color: NAVY_INK }}>{b.value}</span>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", width: 38, textAlign: "right" }}>
                      {bandTotal > 0 ? Math.round((b.value / bandTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ width: `${bandTotal > 0 ? (b.value / bandTotal) * 100 : 0}%`, height: "100%", borderRadius: 99, background: b.color }} />
                  </div>
                </li>
              ))}
            </ul>
          </SubCard>
          </GridCell>

          {/* Per-level distribution — Third. */}
          <GridCell span={4}>
          <SubCard icon={BarChart3} title="Per-level distribution" hint="learners & completions">
            {!levelHasData ? <Empty text="No level enrolment recorded yet." /> : (
              <div style={{ height: 188 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={levelData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="var(--border)" />
                    <XAxis dataKey="level" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fill: "#6b7280" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#6b7280" }} allowDecimals={false} width={34} />
                    <Tooltip cursor={{ fill: "rgba(11,31,51,0.05)" }} contentStyle={tip} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, color: "#6b7280" }} />
                    <Bar dataKey="Learners" fill={NAVY} radius={[3, 3, 0, 0]} maxBarSize={14} />
                    <Bar dataKey="Completed" fill={GREEN} radius={[3, 3, 0, 0]} maxBarSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </SubCard>
          </GridCell>
        </Grid>
      </Section>

      {/* ── 6 · Location ─────────────────────────────────────── */}
      <Section icon={MapPin} title="Location" hint="Where your people are — coarse, free-text">
        <Grid>
          {/* By city — Third. */}
          <GridCell span={4}>
          <SubCard icon={Building2} title="Members by city" hint={`top ${Math.min(loc.by_city.filter((c) => c.members > 0).length, 10)}`}>
            <BarList
              rows={[...loc.by_city].filter((c) => c.members > 0).sort((a, b) => b.members - a.members).slice(0, 10)
                .map((c, i) => ({ label: c.city || "Unknown", value: c.members, display: `${c.members}`, color: BRAND_TINTS[i % BRAND_TINTS.length] }))}
              emptyText="No city data captured yet."
            />
          </SubCard>
          </GridCell>

          {/* By country — Third. */}
          <GridCell span={4}>
          <SubCard icon={Globe} title="Members by country" hint={`top ${Math.min(loc.by_country.filter((c) => c.members > 0).length, 8)}`}>
            <BarList
              showPct
              rows={[...loc.by_country].filter((c) => c.members > 0).sort((a, b) => b.members - a.members).slice(0, 8)
                .map((c, i) => ({ label: countryName(c.country_code), value: c.members, display: `${c.members}`, color: BRAND_TINTS[i % BRAND_TINTS.length] }))}
              emptyText="No country data captured yet."
            />
          </SubCard>
          </GridCell>

        {/* Location & proximity matching — gated on geo_capture, no fake
            coordinates — "coming soon" card. Third (completes the row of 3). */}
        {!loc.geo_capture && (
          <GridCell span={4}>
          <div style={{ ...cardStyle(18), height: "100%" }}>
            <div className="flex items-center gap-2.5">
              <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--tint-violet-bg)", display: "grid", placeItems: "center" }}>
                <Sparkles size={18} style={{ color: "var(--tint-violet-fg)" }} />
              </span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: NAVY_INK }}>Location &amp; proximity matching</div>
                <div style={{ fontSize: 11, color: "var(--tint-violet-fg)", fontWeight: 600 }}>Coming soon</div>
              </div>
              <Sparkles size={14} style={{ color: GOLD, marginLeft: "auto" }} />
            </div>
            <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 12, lineHeight: 1.55 }}>
              Today we only know coarse, free-text city and country — no precise coordinates are collected. When opt-in location
              tagging ships, we'll surface members who live near each other and suggest pairing them into the same cell, so no one is
              discipled in isolation. Nothing here is estimated.
            </p>
            <ul className="flex flex-col gap-1.5" style={{ marginTop: 12, padding: 12, background: "var(--secondary)", borderRadius: 10, border: "1px solid var(--border)" }}>
              {[
                "Opt-in, privacy-first location tags (area, never precise coordinates in the admin view)",
                "Proximity clusters that respect congregation and language boundaries",
                "One-tap 'suggest a cell' from nearby unassigned members",
                "Travel-aware reassignment when a member relocates",
              ].map((b) => (
                <li key={b} className="flex items-start gap-2">
                  <span style={{ width: 8, height: 8, borderRadius: 99, border: "1.5px dashed #cbd5e1", marginTop: 4, flexShrink: 0 }} />
                  <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", lineHeight: 1.45 }}>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          </GridCell>
        )}
        </Grid>
      </Section>

      {/* ── Formation & companion — waves 1-3 + spiritual growth, all counted ── */}
      {d.formation && (
        <Section icon={Sparkles} title="Formation & companion"
                 hint="What members actually did — reading, reflecting, memorising — plus the companion layer meeting them (echoes, voice notes, celebrations). All real rows.">
          <Strip cols={6}>
            <Kpi icon={BookOpen} label="Read this week" value={d.formation.totals.readers_7d} tint="navy" small />
            <Kpi icon={Clock} label="Reading hours (all time)" value={d.formation.totals.reading_hours_all_time} tint="gold" small />
            <Kpi icon={BadgeCheck} label="Verses mastered" value={d.formation.totals.verses_mastered} tint="green" small />
            <Kpi icon={Hourglass} label="Verses in training" value={d.formation.totals.verses_learning} tint="teal" small />
            <Kpi icon={CalendarCheck} label="Plans completed" value={d.formation.totals.plans_completed} tint="violet" small />
            <Kpi icon={Trophy} label="Badges awarded" value={d.formation.totals.badges_awarded} tint="gold" small />
          </Strip>

          <Grid>
            <GridCell span={12}>
              <SubCard icon={TrendingUp} title="Eight weeks of formation" hint="modules finished · reflections written · verses mastered · distinct readers">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={d.formation.weekly} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="week" tick={{ fontSize: 10.5 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10.5 }} />
                    <Tooltip contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 11.5 }} />
                    <Area type="monotone" dataKey="readers" name="Readers" stroke={NAVY} fill={NAVY} fillOpacity={0.12} strokeWidth={2} />
                    <Area type="monotone" dataKey="modules" name="Modules" stroke={GREEN} fill={GREEN} fillOpacity={0.12} strokeWidth={2} />
                    <Area type="monotone" dataKey="reflections" name="Reflections" stroke={GOLD} fill={GOLD} fillOpacity={0.14} strokeWidth={2} />
                    <Area type="monotone" dataKey="verses" name="Verses" stroke={VIOLET} fill={VIOLET} fillOpacity={0.1} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </SubCard>
            </GridCell>

            <GridCell span={6}>
              <SubCard icon={Sparkles} title="The companion at work" hint="last 7 days">
                {[
                  { label: "Echoes served", value: d.formation.companion.echoes_7d },
                  { label: "Members welcomed back", value: d.formation.companion.welcome_backs_7d },
                  { label: "Reflections echoed", value: d.formation.companion.reflection_echoes_7d },
                  { label: "Month anniversaries", value: d.formation.companion.anniversaries_7d },
                  { label: "Milestones celebrated", value: d.formation.companion.moments_7d },
                  { label: "Blessings given", value: d.formation.companion.blessings_7d },
                ].map((r) => (
                  <div key={r.label} className="flex items-center justify-between" style={{ padding: "8px 0", borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{r.label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: NAVY_INK, fontVariantNumeric: "tabular-nums" }}>{r.value}</span>
                  </div>
                ))}
                <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
                  "Members welcomed back" = returned after 4+ quiet days and were met with grace, not guilt — a shepherding signal worth watching.
                </p>
              </SubCard>
            </GridCell>

            <GridCell span={6}>
              <SubCard icon={BookOpen} title="Voices of the flock" hint={`${d.formation.reflections.total} reflections · ${d.formation.reflections.last_7d} this week · avg ${d.formation.reflections.avg_length} chars`}>
                {d.formation.reflections.latest.length === 0 ? <Empty text="No reflections written yet." /> : (
                  <div className="flex flex-col gap-3">
                    {d.formation.reflections.latest.map((r, i) => (
                      <div key={i} style={{ padding: "10px 12px", background: "var(--secondary)", borderRadius: 10, borderLeft: `3px solid ${GOLD}` }}>
                        <div style={{ fontSize: 12.5, color: NAVY_INK, fontStyle: "italic", lineHeight: 1.5 }}>“{r.excerpt}”</div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 5 }}>
                          {r.first_name} · after "{r.module_title}" · {new Date(r.submitted_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SubCard>
            </GridCell>

            <GridCell span={6}>
              <SubCard icon={Users} title="Cells reading together" hint="members who opened a lesson in the last 7 days">
                {d.formation.cells_reading.length === 0 ? <Empty text="No cells yet." /> : (
                  <div className="flex flex-col gap-2.5">
                    {d.formation.cells_reading.map((c) => {
                      const p = c.members > 0 ? Math.round((100 * c.reading_7d) / c.members) : 0;
                      return (
                        <div key={c.cell}>
                          <div className="flex items-center justify-between" style={{ marginBottom: 3 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: NAVY_INK }}>{c.cell}</span>
                            <span style={{ fontSize: 11.5, color: "var(--muted-foreground)", fontVariantNumeric: "tabular-nums" }}>{c.reading_7d}/{c.members} · {p}%</span>
                          </div>
                          <div style={{ height: 7, background: "var(--secondary)", borderRadius: 99 }}>
                            <div style={{ width: `${p}%`, height: 7, borderRadius: 99, background: p >= 60 ? GREEN : p >= 30 ? GOLD : RED, transition: "width .3s" }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SubCard>
            </GridCell>

            <GridCell span={6}>
              <SubCard icon={Radio} title="A word from the discipler" hint="voice notes on lessons, by congregation">
                {d.formation.voice_notes.length === 0 ? (
                  <Empty text="No voice notes yet — leaders can record one atop any module in the app." />
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead><tr style={{ textAlign: "left" }}>
                      <th style={{ ...thBase, padding: "6px 0" }}>Congregation</th>
                      <th style={{ ...thBase, padding: "6px 0", textAlign: "right" }}>Notes</th>
                      <th style={{ ...thBase, padding: "6px 0", textAlign: "right" }}>Voices</th>
                      <th style={{ ...thBase, padding: "6px 0", textAlign: "right" }}>Coverage</th>
                    </tr></thead>
                    <tbody>
                      {d.formation.voice_notes.map((v) => (
                        <tr key={v.congregation} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ ...tdBase, padding: "9px 0", fontWeight: 600, color: NAVY_INK }}>{v.congregation}</td>
                          <td style={{ ...tdR, padding: "9px 0" }}>{v.notes}</td>
                          <td style={{ ...tdR, padding: "9px 0" }}>{v.voices}</td>
                          <td style={{ ...tdR, padding: "9px 0" }}>{v.coverage_pct}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </SubCard>
            </GridCell>

            <GridCell span={6}>
              <SubCard icon={BadgeCheck} title="Level exams" hint="attempts · passes · average passing score">
                {d.formation.exams.length === 0 ? <Empty text="No exam attempts yet." /> : (
                  <BarList
                    rows={d.formation.exams.map((e, i) => ({
                      label: `Level ${e.level_number}`,
                      value: e.passes,
                      display: `${e.passes}/${e.attempts} passed · avg ${e.avg_pass_score}%`,
                      color: BRAND_TINTS[i % BRAND_TINTS.length],
                    }))}
                    emptyText="No exam attempts yet."
                  />
                )}
              </SubCard>
            </GridCell>
          </Grid>
        </Section>
      )}

      {/* Footer */}
      <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", padding: "4px 0 12px" }}>
        <Lock size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
        SuperAdmin / Admin only · prayer activity excluded (pastoral-private, §5.4) · As of {new Date(d.generated_at).toLocaleString()}
      </p>
    </div>
  );
}

// ── building blocks ──────────────────────────────────────────────────────────

// One soft shadow, matching the Dashboard's card chrome.
const SHADOW = "0 6px 18px rgba(10,37,64,0.06)";
const cardStyle = (pad: number): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});
const tip = { background: "#fff", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, boxShadow: "0 4px 12px rgba(10,37,64,0.08)" } as const;

const thBase: React.CSSProperties = { padding: "10px 20px", fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted-foreground)", textTransform: "uppercase" };
const thL: React.CSSProperties = { ...thBase, textAlign: "left" };
const thR: React.CSSProperties = { ...thBase, textAlign: "right" };
const tdBase: React.CSSProperties = { padding: "12px 20px", color: "var(--foreground)" };
const tdL: React.CSSProperties = { ...tdBase, textAlign: "left" };
const tdR: React.CSSProperties = { ...tdBase, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "var(--muted-foreground)" };

const comingCard: React.CSSProperties = {
  ...cardStyle(14),
  background: "repeating-linear-gradient(45deg, #fff, #fff 10px, rgba(11,31,51,0.012) 10px, rgba(11,31,51,0.012) 20px)",
};

// Pastel-tint registry (uses index.css --tint-*-bg / --tint-*-fg tokens).
type Tint = "navy" | "green" | "gold" | "teal" | "amber" | "rose" | "violet";
const tintBg = (t: Tint): string => (t === "teal" ? "#e2f4f1" : `var(--tint-${t}-bg)`);
const tintFg = (t: Tint): string => (t === "teal" ? TEAL : `var(--tint-${t}-fg)`);

// ── Dense dashboard grid ──────────────────────────────────────────────────────
// A 12-column grid at xl so cards can lay out cleanly into rows of 4 (span 3),
// rows of 3 (span 4), rows of 6 (span 2), halves (span 6) and full-width tables
// (span 12). It collapses to 6 columns (≤1100px) then 1 (≤640px). Each child
// declares how many of the 12 columns it spans via <GridCell span={…}>. The
// responsive CSS below remaps spans so nothing overflows a 6- or 1-column layout
// (e.g. a span-3 quarter becomes a span-3 = half of 6 at the mid breakpoint, a
// span-2 sixth becomes a span-2 = third of 6, etc.). One scoped <style> drives
// the media queries (inline styles can't express them); the brand palette, fonts
// and card shadows are untouched — this is pure layout.
//
// Span vocabulary (out of 12): 12 = full · 6 = half · 4 = third (row of 3) ·
// 3 = quarter (row of 4) · 2 = sixth (row of 6).
type Span = 2 | 3 | 4 | 6 | 12;
const GRID_CSS = `
.mi-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; align-items: stretch; }
.mi-grid > .mi-cell { min-width: 0; }
.mi-grid > .mi-cell > * { height: 100%; box-sizing: border-box; }
.mi-cell.mi-span-2 { grid-column: span 2; }
.mi-cell.mi-span-3 { grid-column: span 3; }
.mi-cell.mi-span-4 { grid-column: span 4; }
.mi-cell.mi-span-6 { grid-column: span 6; }
.mi-cell.mi-span-12 { grid-column: span 12; }
@media (max-width: 1100px) {
  /* 6-column mid layout: quarters→halves, thirds→halves, sixths→thirds */
  .mi-grid { grid-template-columns: repeat(6, minmax(0, 1fr)); }
  .mi-cell.mi-span-2 { grid-column: span 2; }   /* sixth → third of 6 */
  .mi-cell.mi-span-3 { grid-column: span 3; }   /* quarter → half of 6 */
  .mi-cell.mi-span-4 { grid-column: span 3; }   /* third → half of 6 */
  .mi-cell.mi-span-6 { grid-column: span 6; }   /* half → full */
  .mi-cell.mi-span-12 { grid-column: span 6; }  /* full → full */
}
@media (max-width: 640px) {
  .mi-grid { grid-template-columns: minmax(0, 1fr); }
  .mi-cell.mi-span-2, .mi-cell.mi-span-3, .mi-cell.mi-span-4,
  .mi-cell.mi-span-6, .mi-cell.mi-span-12 { grid-column: span 1; }
}
`;
function Grid({ children }: { children: ReactNode }): ReactElement {
  return (
    <>
      <style>{GRID_CSS}</style>
      <div className="mi-grid">{children}</div>
    </>
  );
}
function GridCell({ span, children }: { span: Span; children: ReactNode }): ReactElement {
  return <div className={`mi-cell mi-span-${span}`}>{children}</div>;
}

// ── Overview strips ───────────────────────────────────────────────────────────
// Equal-column tile rows used only by the top-of-page Overview block: an 8-up KPI
// row and a 6-up growth-stat row. Unlike the 12-col dashboard grid, every child
// is one equal fraction of the row (no per-cell spans). Both step down cleanly:
//   8-up: 8 → 4 → 2   ·   6-up: 6 → 3 → 2   (single column ≤640px)
// Equal heights come free from grid stretch (Kpi already fills height:100%).
const STRIP_CSS = `
.mi-strip { display: grid; gap: 16px; align-items: stretch; }
.mi-strip-8 { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.mi-strip-6 { grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 1100px) {
  .mi-strip-8 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .mi-strip-6 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 640px) {
  .mi-strip-8, .mi-strip-6 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 380px) {
  .mi-strip-8, .mi-strip-6 { grid-template-columns: minmax(0, 1fr); }
}
`;
function Strip({ cols, children }: { cols: 6 | 8; children: ReactNode }): ReactElement {
  return (
    <>
      <style>{STRIP_CSS}</style>
      <div className={`mi-strip mi-strip-${cols}`}>{children}</div>
    </>
  );
}

function Kpi({ icon: Icon, label, value, tint, small }: { icon: LucideIcon; label: string; value: number | string; tint: Tint; small?: boolean }): ReactElement {
  return (
    <div className="rounded-2xl flex flex-col" style={{ background: tintBg(tint), padding: "16px 16px 18px", border: `1px solid ${tintFg(tint)}2e`, height: "100%" }}>
      <span style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.65)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={17} style={{ color: tintFg(tint) }} />
      </span>
      <div style={{ fontFamily: "var(--font-display)", fontSize: small ? 20 : 24, color: NAVY_INK, marginTop: 11, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: tintFg(tint), fontWeight: 600, marginTop: 6, lineHeight: 1.25 }}>{label}</div>
    </div>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <section style={cardStyle(22)}>
      <div className="flex items-center gap-2.5 mb-5">
        <span style={{ width: 34, height: 34, borderRadius: 10, background: "var(--tint-navy-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Icon size={17} style={{ color: "var(--tint-navy-fg)" }} />
        </span>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: NAVY_INK, lineHeight: 1.2 }}>{title}</h2>
          {hint ? <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{hint}</div> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

// Uniform card header — a small tinted icon chip + title + optional right-aligned
// caption, matching the Dashboard's card headers. Used by every card so no card
// looks bespoke next to its row-mates.
function ChipHeader({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string | undefined }): ReactElement {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--tint-navy-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={15} style={{ color: "var(--tint-navy-fg)" }} />
      </span>
      <h3 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY_INK, lineHeight: 1.2 }}>{title}</h3>
      {hint ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{hint}</span> : null}
    </div>
  );
}

// Header variant for cards that bleed content to the card edges (tables) — the
// same tinted chip + title + caption, but with the card's own padding around it.
function CardHeader({ icon: Icon, title, hint }: { icon: LucideIcon; title: string; hint?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2.5" style={{ padding: "18px 20px 14px" }}>
      <span style={{ width: 30, height: 30, borderRadius: 9, background: "var(--tint-navy-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
        <Icon size={15} style={{ color: "var(--tint-navy-fg)" }} />
      </span>
      <h3 style={{ fontSize: 13.5, fontWeight: 700, color: NAVY_INK, lineHeight: 1.2 }}>{title}</h3>
      {hint ? <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>{hint}</span> : null}
    </div>
  );
}

// White inset SubCard (used inside Sections): a full-height flex column so short
// cards pin their content to the top and stretch to match their row-mates. Card
// chrome (radius, padding, the one soft shadow) matches the Dashboard exactly.
function SubCard({ icon: Icon, title, hint, children, className }: { icon: LucideIcon; title: string; hint?: string; children: ReactNode; className?: string }): ReactElement {
  return (
    <div className={`flex flex-col ${className ?? ""}`} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: "18px 20px", boxShadow: SHADOW, height: "100%" }}>
      <ChipHeader icon={Icon} title={title} hint={hint} />
      <div className="flex flex-col" style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  );
}

type BarRow = { label: string; value: number; display?: string; tag?: string; color?: string | undefined; mono?: boolean };
function BarList({ rows, showPct, padded, emptyText }: { rows: BarRow[]; showPct?: boolean; padded?: boolean; emptyText?: string }): ReactElement {
  if (rows.length === 0) return <div style={{ padding: padded ? "0 20px 16px" : 0 }}><Empty text={emptyText ?? "No data yet."} /></div>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="flex flex-col" style={{ gap: 11, padding: padded ? "2px 20px 18px" : 0 }}>
      {rows.map((r, i) => (
        <li key={r.label + i}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 5 }}>
            <span style={{ fontSize: 12.5, color: NAVY_INK, fontWeight: 600, fontFamily: r.mono ? "var(--font-mono)" : undefined }}>{r.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span style={{ fontSize: 12.5, color: NAVY_INK, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{r.display ?? r.value.toLocaleString()}</span>
              {r.tag ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)" }}>· {r.tag}</span> : null}
              {showPct ? <span style={{ fontSize: 10.5, color: "var(--muted-foreground)", width: 32, textAlign: "right" }}>{total > 0 ? Math.round((r.value / total) * 100) : 0}%</span> : null}
            </span>
          </div>
          <div style={{ height: 7, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: "100%", borderRadius: 99, background: r.color ?? BRAND_TINTS[i % BRAND_TINTS.length] ?? NAVY }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Donut({ data, centerLabel, centerValue }: { data: { name: string; value: number; color: string }[]; centerLabel: string; centerValue: number }): ReactElement {
  return (
    <div style={{ position: "relative", width: 128, height: 128, flexShrink: 0 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" innerRadius={40} outerRadius={62} paddingAngle={2} stroke="none">
            {data.map((x) => <Cell key={x.name} fill={x.color} />)}
          </Pie>
          <Tooltip contentStyle={tip} />
        </PieChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: NAVY_INK, lineHeight: 1 }}>{centerValue}</div>
        <div style={{ fontSize: 8.5, color: "var(--muted-foreground)", letterSpacing: "0.08em", textTransform: "uppercase", marginTop: 3, fontWeight: 700 }}>{centerLabel}</div>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }): ReactElement {
  return <p style={{ fontSize: 12, color: "var(--muted-foreground)", padding: "8px 0" }}>{text}</p>;
}

// ── small visual helpers ──
const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";

const rankBadge = (rank: number): React.CSSProperties => ({
  width: 24, height: 24, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
  fontSize: 11, fontWeight: 700,
  background: rank <= 3 ? "rgba(200,155,60,0.16)" : "var(--secondary)",
  color: rank <= 3 ? "#8a6b1f" : "var(--muted-foreground)",
});
const monogram = (): React.CSSProperties => ({
  width: 28, height: 28, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
  fontSize: 11, fontWeight: 700, color: "#fff",
  background: "var(--nuru-navy-gradient, " + NAVY_INK + ")",
});
const tintChip = (color: string | undefined): React.CSSProperties => {
  const c = color ?? NAVY;
  return { width: 28, height: 28, borderRadius: 9, display: "grid", placeItems: "center", flexShrink: 0, color: c, background: `${c}1f` };
};
