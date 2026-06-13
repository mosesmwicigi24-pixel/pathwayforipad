// Dashboard — rebuilt to the Figma make "Nuru Pathway Web Portal". Greeting +
// date pill, hero KPI band, pastel stat cards, the curriculum pipeline (drafts/
// published/archived from the CMS), an attendance/engagement trend, and guardian
// consents needing renewal. Every figure is real (B1 report endpoints + CMS) —
// no mock data.
import { useEffect, useState, type ReactElement } from "react";
import { BookOpen, ClipboardList, Award, AlertTriangle, TrendingUp, FileEdit, Upload, CheckCircle2 } from "lucide-react";
import {
  AdminApi,
  CurriculumApi,
  type OverviewKpis,
  type AttendanceTrendPoint,
  type ConsentRow,
  type AdminLevel,
} from "../../api/client";
import { useAppSelector } from "../../store/hooks";
import { errorMessage } from "../../util/error";
import { trendBars, shortWeekLabel } from "../../util/dashboardLogic";

const navy = "var(--nuru-navy)";
const gold = "var(--nuru-gold)";

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function nameFrom(email: string | null): string {
  const raw = (email ?? "there").split("@")[0] ?? "there";
  const first = raw.split(/[.\-_]/)[0] ?? raw;
  return first.charAt(0).toUpperCase() + first.slice(1);
}
function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase();
}

interface Data {
  overview: OverviewKpis;
  trend: AttendanceTrendPoint[];
  consents: ConsentRow[];
  levels: AdminLevel[];
}

export function Dashboard(): ReactElement {
  const email = useAppSelector((s) => s.auth.email);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [overview, attendance, consents, levels] = await Promise.all([
          AdminApi.overview(),
          AdminApi.attendanceReport(8),
          AdminApi.consentsReport(),
          CurriculumApi.levels().catch(() => [] as AdminLevel[]),
        ]);
        if (!cancelled) setData({ overview, trend: attendance.trend, consents, levels });
      } catch (err) {
        if (!cancelled) setError(errorMessage(err, "Could not load the dashboard"));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (error) return <p style={{ color: "var(--color-danger)" }}>{error}</p>;
  if (!data) return <p style={{ color: "var(--muted-foreground)" }}>Loading dashboard…</p>;

  const o = data.overview;
  const bars = trendBars(data.trend);
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const sum = (k: keyof AdminLevel): number => data.levels.reduce((a, l) => a + Number(l[k] ?? 0), 0);
  const drafts = sum("draft_count");
  const published = sum("published_count");
  const archived = sum("archived_count");

  const heroes = [
    { label: "Active learners", value: String(o.active_learners), sub: `${o.total_members} total members` },
    { label: "Cohorts running", value: String(o.cohorts_running), sub: "across the congregation" },
    { label: "Reflections (wk)", value: String(o.reflections_this_week), sub: `${o.pending_reviews} pending review` },
    { label: "Avg engagement", value: pct(o.avg_engagement), sub: `${o.checked_in_this_week} checked in this week` },
  ];

  const stats = [
    { label: "Modules published", value: String(o.modules_published), Icon: BookOpen, cls: "card-amber", fg: "#8A6B1F" },
    { label: "Pending reviews", value: String(o.pending_reviews), Icon: ClipboardList, cls: "card-blue", fg: "#1F3A6B" },
    { label: "Certificates (mo.)", value: String(o.certificates_this_month), Icon: Award, cls: "card-green", fg: "#0F6B33" },
    { label: "Members at risk", value: String(o.members_at_risk), Icon: AlertTriangle, cls: "card-red", fg: "#A8281F" },
  ];

  const pipeline = [
    { label: "Drafts", value: drafts, Icon: FileEdit, cls: "card-amber", fg: "#8A6B1F" },
    { label: "Published", value: published, Icon: CheckCircle2, cls: "card-green", fg: "#0F6B33" },
    { label: "Archived", value: archived, Icon: Upload, cls: "card-blue", fg: "#1F3A6B" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Greeting + date */}
      <div className="flex items-end justify-between" style={{ gap: 16, flexWrap: "wrap" }}>
        <div>
          <div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 6 }}>{todayLabel()}</div>
          <h1 className="nuru-display" style={{ fontSize: 30 }}>{`${greeting()}, ${nameFrom(email)}`}</h1>
        </div>
        <span className="nuru-date-pill">{todayLabel()}</span>
      </div>

      {/* Hero KPI band (navy) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 0, background: navy, borderRadius: 16, overflow: "hidden" }}>
        {heroes.map((k, i) => (
          <div key={k.label} style={{ padding: "20px 22px", borderLeft: i === 0 ? "none" : "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(232,239,245,0.55)" }}>{k.label}</div>
            <div className="nuru-numeric" style={{ fontSize: 34, color: "#fff", marginTop: 6 }}>{k.value}</div>
            <div style={{ fontSize: 12, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Pastel stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {stats.map(({ label, value, Icon, cls, fg }) => (
          <div key={label} className={cls} style={{ borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(255,255,255,0.6)", display: "grid", placeItems: "center", color: fg }}><Icon size={20} /></div>
            <div>
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{label}</div>
              <div className="nuru-numeric" style={{ fontSize: 26 }}>{value}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Attendance / engagement trend */}
        <section className="nuru-card" style={{ padding: 20 }}>
          <div className="flex items-center justify-between" style={{ marginBottom: 14 }}>
            <div>
              <div className="nuru-eyebrow">ENGAGEMENT</div>
              <h2 className="type-section" style={{ fontSize: 20 }}>Attendance · last 8 weeks</h2>
            </div>
            <TrendingUp size={18} style={{ color: gold }} />
          </div>
          {bars.length === 0 ? (
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>No check-ins recorded yet.</p>
          ) : (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 160 }}>
              {bars.map((b) => (
                <div key={b.week_start} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 4 }}>{b.check_ins}</div>
                  <div title={`${b.check_ins} check-ins · ${b.unique_members} members`} style={{ height: Math.max(4, Math.round(b.height * 120)), background: navy, borderRadius: 6, opacity: 0.35 + b.height * 0.65 }} />
                  <div style={{ fontSize: 10.5, color: "var(--muted-foreground)", marginTop: 6 }}>{shortWeekLabel(b.week_start)}</div>
                </div>
              ))}
            </div>
          )}
          {/* Curriculum pipeline */}
          <div className="nuru-footnote" style={{ borderTopStyle: "solid" }}>
            <div className="nuru-eyebrow" style={{ marginBottom: 10 }}>CURRICULUM PIPELINE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              {pipeline.map(({ label, value, Icon, cls, fg }) => (
                <div key={label} className={cls} style={{ borderRadius: 12, padding: "12px 14px" }}>
                  <div className="flex items-center gap-2" style={{ color: fg }}><Icon size={15} /><span style={{ fontSize: 12, fontWeight: 600 }}>{label}</span></div>
                  <div className="nuru-numeric" style={{ fontSize: 22, marginTop: 6 }}>{value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Consents needing renewal */}
        <section className="nuru-card" style={{ padding: 20 }}>
          <div className="nuru-eyebrow">SAFEGUARDING</div>
          <h2 className="type-section" style={{ fontSize: 20, marginBottom: 12 }}>Consents · renew soon</h2>
          {data.consents.length === 0 ? (
            <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>Nothing expiring. 🎉</p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {data.consents.slice(0, 8).map((c) => (
                <li key={c.consent_id} style={{ padding: "10px 12px", borderRadius: 10, background: "var(--color-warning-bg)", border: "1px solid #F5E2B8" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: navy }}>{c.full_name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{`${c.guardian_name} (${c.relationship}) · renew by ${c.renew_by}`}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
