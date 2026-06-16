// Member Profile — rebuilt to the make, wired to the real member-detail aggregate
// (OpsApi.memberDetail). Reflection/prayer content is never shown (§5.4): the
// activity feed is metadata only. Mock-only guardian fields the API doesn't return
// (phone/email/document) are omitted; metrics come from real curriculum/attendance/
// habit aggregates. Read the member id from the ?id= query param.
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Award, BookOpen, CalendarDays, CheckCircle2, ChevronRight, Droplets, Flag,
  Heart, Mail, MessageSquare, ShieldAlert, Sparkles, Sunrise, Flame, X, GraduationCap,
} from "lucide-react";
import { OpsApi, SystemApi, type MemberDetail, type Country, type Programme } from "../../api/client";
import { errorMessage } from "../../util/error";

const PROGRAMME_LABELS: Record<Programme, string> = {
  new_believer: "New Believer",
  foundations: "Foundations",
  serving_track: "Serving Track",
  leadership_prep: "Leadership Prep",
};

const STEADY = { bg: "#FFF6E0", color: "#A87616" };
const bandStyle: Record<string, { bg: string; color: string }> = {
  Thriving: { bg: "#E8F6EC", color: "#16A34A" },
  Steady: STEADY,
  Watch: { bg: "#FDF0E6", color: "#E07B28" },
  "At-risk": { bg: "#FDECEC", color: "#DC2626" },
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtWhen(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" }) + " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function Ring({ value, color, size = 88 }: { value: number; color: string; size?: number }): ReactElement {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (value / 100) * c;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#EEF0F3" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} strokeLinecap="round" fill="none" strokeDasharray={c} strokeDashoffset={offset} />
    </svg>
  );
}
function ThinBar({ value, color }: { value: number; color: string }): ReactElement {
  return <div style={{ height: 4, background: "#EEF0F3", borderRadius: 999, overflow: "hidden" }}><div style={{ width: `${value}%`, height: "100%", background: color, borderRadius: 999 }} /></div>;
}

export function MemberProfile(): ReactElement {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const id = params.get("id") ?? "";
  const [m, setM] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [gradBusy, setGradBusy] = useState(false);

  useEffect(() => {
    if (!id) { setError("No member selected."); return; }
    OpsApi.memberDetail(id).then(setM).catch((e) => setError(errorMessage(e, "Could not load member.")));
  }, [id]);
  useEffect(() => { void SystemApi.countries().then(setCountries).catch(() => {}); }, []);

  async function toggleGraduation(): Promise<void> {
    if (!m) return;
    setGradBusy(true);
    try { await OpsApi.setGraduation(m.user_id, !m.graduated); const fresh = await OpsApi.memberDetail(m.user_id); setM(fresh); }
    catch (e) { setError(errorMessage(e, "Could not update graduation.")); }
    finally { setGradBusy(false); }
  }

  const band = useMemo(() => (m?.engagement.band ? bandStyle[m.engagement.band] ?? STEADY : STEADY), [m]);

  if (error) return <div style={{ padding: 48, color: "#A8281F" }}>{error}</div>;
  if (!m) return <div style={{ padding: 48, color: "var(--muted-foreground)" }}>Loading…</div>;

  const lvl = m.enrollment;
  const country = m.country_code ? countries.find((c) => c.code === m.country_code) ?? null : null;
  const genderLabel = m.gender ? m.gender.charAt(0).toUpperCase() + m.gender.slice(1) : null;
  const locationValue = [country ? `${country.flag ?? ""} ${country.name}`.trim() : m.country_code, m.city].filter(Boolean).join(" · ") || "—";
  const heroItems = [
    { label: "Cell", value: m.cell_name ?? "Unassigned" },
    { label: "Current level", value: `L${lvl.current_level}${lvl.level_title ? ` · ${lvl.level_title}` : ""}` },
    { label: "Engagement band", value: m.engagement.band ?? "—", isBand: !!m.engagement.band },
    { label: "Programme", value: m.programme ? PROGRAMME_LABELS[m.programme] : "—" },
    { label: "Location", value: locationValue },
    { label: "Age · Gender", value: [m.age != null ? `${m.age}` : null, genderLabel].filter(Boolean).join(" · ") || "—" },
    { label: "Language", value: m.language ?? "—" },
    { label: "Joined", value: fmtDate(m.created_at) },
    { label: "Last activity", value: fmtWhen(m.last_activity) },
  ];

  const kpis = [
    { label: "Habits", value: `${m.metrics.habits_pct}%`, Icon: Sunrise, tint: "tint-green", cardBg: "#F3FAF5", border: "#D6ECDF", sub: `${m.metrics.active_days_30} / 30 active days` },
    { label: "Curriculum", value: `${m.metrics.curriculum_pct}%`, Icon: BookOpen, tint: "tint-amber", cardBg: "#FDF9EF", border: "#F0E2BD", sub: `Level ${lvl.current_level}` },
    { label: "Attendance", value: `${m.metrics.attendance_pct}%`, Icon: CalendarDays, tint: "tint-blue", cardBg: "#F4F6FB", border: "#DBE2EF", sub: `${m.metrics.attended} / ${m.metrics.events_held} gatherings` },
    { label: "Badges", value: String(m.badges.length), Icon: Award, tint: "tint-violet", cardBg: "#F7F3FC", border: "#E2D7F2", sub: `${m.certificates.length} certificates` },
  ];

  const progressCards = [
    { key: "habits", title: "Habits", icon: Sunrise, value: m.metrics.habits_pct, summary: "Prayer · Word · Reflection", detail: `${m.metrics.active_days_30} of 30 active days · ${m.metrics.current_streak_days}-day streak`, accent: "#16A34A", bg: "#F3FAF5", border: "#D6ECDF" },
    { key: "curriculum", title: "Curriculum", icon: BookOpen, value: m.metrics.curriculum_pct, summary: `Level ${lvl.current_level}`, detail: `${m.metrics.modules_done} of ${m.metrics.modules_total} modules complete`, accent: "#C89B3C", bg: "#FDF9EF", border: "#F0E2BD" },
    { key: "attendance", title: "Attendance", icon: CalendarDays, value: m.metrics.attendance_pct, summary: "Cell + Sunday gatherings", detail: `${m.metrics.attended} of ${m.metrics.events_held} last 90 days`, accent: "#0B1F33", bg: "#F4F6FB", border: "#DBE2EF" },
  ];

  const milestones = [
    { title: "Baptism", date: m.is_baptized ? "Recorded" : "Not yet recorded", note: "Water baptism", icon: Droplets, color: "#0B1F33", complete: m.is_baptized },
    { title: `Level ${lvl.current_level} Completion`, date: lvl.level_title ?? `Level ${lvl.current_level}`, note: `${m.metrics.modules_done} of ${m.metrics.modules_total} modules`, icon: Flag, color: "#C89B3C", complete: m.metrics.modules_total > 0 && m.metrics.modules_done >= m.metrics.modules_total },
    { title: "Pathway Completion", date: lvl.completed_at ? fmtDate(lvl.completed_at) : "In progress", note: lvl.state === "completed" ? "All levels complete" : `${6 - lvl.current_level} levels to go`, icon: Sparkles, color: "#6B7280", complete: lvl.state === "completed" },
  ];

  return (
    <div style={{ minHeight: "100%", background: "var(--background)", minWidth: 0 }}>
      {/* Hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}>
            <span>Nuru Pathway</span><ChevronRight size={10} /><button onClick={() => navigate("/members")} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer" }}>Members</button><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>{m.full_name}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {m.graduated ? <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(124,58,237,0.18)", color: "#C4B5FD", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(124,58,237,0.4)" }}><GraduationCap size={12} /> Graduated</span> : null}
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> {m.cell_name ?? "Unassigned"} · L{lvl.current_level}</span>
            {m.email ? <a href={`mailto:${m.email}`} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)", textDecoration: "none" }}><Mail size={13} /> Message</a> : null}
            <button onClick={() => void toggleGraduation()} disabled={gradBusy} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: m.graduated ? "rgba(255,255,255,0.08)" : "rgba(124,58,237,0.9)", color: "#fff", fontSize: 12, fontWeight: 600, border: m.graduated ? "1px solid rgba(255,255,255,0.15)" : "none", opacity: gradBusy ? 0.6 : 1 }}><GraduationCap size={13} /> {m.graduated ? "Un-graduate" : "Mark graduated"}</button>
            <button onClick={() => navigate("/reflection-queue")} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Heart size={13} /> Pastoral note</button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-5">
          <div className="rounded-2xl flex items-center justify-center shrink-0" style={{ width: 56, height: 56, background: "rgba(245,199,126,0.16)", color: "#F5C77E", fontFamily: "var(--font-display)", fontSize: 22, border: "1px solid rgba(245,199,126,0.3)" }}>{initials(m.full_name)}</div>
          <div><h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(22px,4vw,30px)", lineHeight: 1.05 }}>{m.full_name}</h1><p style={{ fontSize: 13, color: "rgba(232,239,245,0.6)", marginTop: 2 }}>{m.phone_number}{m.email ? ` · ${m.email}` : ""}</p></div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {heroItems.map((item) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: "1px solid rgba(255,255,255,0.07)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              {item.isBand ? <span className="inline-flex items-center rounded-full px-2.5 py-1" style={{ background: band.bg, color: band.color, fontSize: 12, fontWeight: 700 }}>● {item.value}</span> : <div style={{ fontSize: 14, color: "#fff", fontWeight: 600, lineHeight: 1.35 }}>{item.value}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Minor / guardian banner */}
      {m.is_minor && (
        <div className="flex flex-wrap items-center gap-3 px-8 lg:px-12 py-3" style={{ background: "linear-gradient(90deg,#FFFBEB,#FEF3C7)", borderBottom: "1px solid #F5E0A8" }}>
          <ShieldAlert size={16} style={{ color: "#A87616", flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: "#7A5410" }}>Minor — Guardian consent required</span>
          {m.guardian ? <span style={{ fontSize: 12, color: "#7A5410" }}>Consent {m.guardian.consent.toLowerCase()} by {m.guardian.name} ({m.guardian.relationship}) on {fmtDate(m.guardian.granted_at)}.</span> : <span style={{ fontSize: 12, color: "#7A5410" }}>No consent on file.</span>}
          <span className="ml-auto flex items-center gap-2">
            <span className="rounded-full px-2.5 py-0.5" style={{ background: m.guardian && m.guardian.consent === "Granted" ? "#E8F6EC" : "#FDECEC", color: m.guardian && m.guardian.consent === "Granted" ? "#16A34A" : "#DC2626", fontSize: 11, fontWeight: 700 }}>{m.guardian && m.guardian.consent === "Granted" ? "✓ Consent on file" : "⚠ Action needed"}</span>
            {m.guardian ? <button onClick={() => setConsentOpen(true)} className="flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: "rgba(122,84,16,0.10)", color: "#7A5410", fontSize: 11, fontWeight: 600, border: "none" }}>View details <ChevronRight size={11} /></button> : null}
          </span>
        </div>
      )}

      {/* Body */}
      <div style={{ padding: "28px clamp(16px, 4vw, 48px) 48px" }}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {kpis.map(({ label, value, Icon, tint, cardBg, border, sub }) => (
            <div key={label} className="rounded-2xl" style={{ background: cardBg, border: `1px solid ${border}`, padding: "14px 16px" }}>
              <div className="flex items-start justify-between mb-2"><div className={`flex items-center justify-center rounded-lg ${tint}`} style={{ width: 34, height: 34 }}><Icon size={15} /></div></div>
              <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{label}</div>
              <div style={{ fontFamily: "var(--font-display)", color: "var(--nuru-navy)", fontSize: 26, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 6 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
          {progressCards.map(({ key, title, icon: Icon, value, summary, detail, accent, bg, border }) => (
            <div key={key} className="rounded-2xl p-5 flex items-center gap-5" style={{ background: bg, border: `1px solid ${border}` }}>
              <div className="relative shrink-0" style={{ width: 88, height: 88 }}>
                <Ring value={value} color={accent} />
                <div className="absolute inset-0 flex items-center justify-center" style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)" }}>{value}%</div>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2"><Icon size={14} style={{ color: accent }} /><span style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)", textTransform: "uppercase", letterSpacing: 0.5 }}>{title}</span></div>
                <div style={{ fontSize: 13, color: "var(--foreground)", marginTop: 6 }}>{summary}</div>
                <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, marginBottom: 8 }}>{detail}</div>
                <ThinBar value={value} color={accent} />
              </div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Activity */}
          <div className="rounded-2xl p-6" style={{ background: "#FDF9EF", border: "1px solid #F0E2BD" }}>
            <div className="flex items-center justify-between mb-5"><div className="flex items-center gap-2"><MessageSquare size={16} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Recent activity</span></div></div>
            {m.timeline.length === 0 ? <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No recorded activity yet.</p> : (
              <div className="relative" style={{ paddingLeft: 22 }}>
                <div className="absolute top-1 bottom-1" style={{ left: 6, width: 2, background: "var(--border)", borderRadius: 1 }} />
                {m.timeline.map((t, i) => {
                  const dot = t.kind.includes("quiz") || t.kind.includes("completed") ? "#16A34A" : t.kind.includes("badge") ? "#C89B3C" : "#9CA3AF";
                  return (
                    <div key={i} className="relative" style={{ marginBottom: i === m.timeline.length - 1 ? 0 : 16 }}>
                      <div className="absolute rounded-full" style={{ left: -22, top: 4, width: 12, height: 12, background: dot, border: "3px solid var(--card)", boxShadow: "0 0 0 1px var(--border)" }} />
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.4 }}>{t.label}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{t.module_title ? `${t.module_title} · ` : ""}{fmtWhen(t.occurred_at)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Milestones */}
          <div className="rounded-2xl p-6" style={{ background: "#F4F6FB", border: "1px solid #DBE2EF" }}>
            <div className="flex items-center justify-between mb-5"><div className="flex items-center gap-2"><Flag size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Milestones</span></div><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{milestones.filter((mm) => mm.complete).length} of {milestones.length}</span></div>
            {milestones.map((mm, i) => {
              const Icon = mm.icon;
              return (
                <div key={mm.title} className="flex items-start gap-3 py-3" style={{ borderBottom: i < milestones.length - 1 ? "1px dashed var(--border)" : "none" }}>
                  <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 38, height: 38, background: mm.complete ? "#E8F6EC" : "#F3F4F6", color: mm.complete ? "#16A34A" : mm.color }}>{mm.complete ? <CheckCircle2 size={18} /> : <Icon size={18} />}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap"><span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{mm.title}</span>{mm.complete && <span className="rounded-full px-2 py-0.5" style={{ background: "#E8F6EC", color: "#16A34A", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em" }}>COMPLETE</span>}</div>
                    <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{mm.date}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{mm.note}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Certificates + Badges */}
          <div className="flex flex-col gap-5">
            <div className="rounded-2xl p-6" style={{ background: "#F3FAF5", border: "1px solid #D6ECDF" }}>
              <div className="flex items-center justify-between mb-4"><div className="flex items-center gap-2"><Award size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Certificates</span></div><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.certificates.length} earned</span></div>
              {m.certificates.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>None issued yet.</p> : m.certificates.map((c, i) => (
                <div key={c.certificate_id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: i < m.certificates.length - 1 ? "1px dashed var(--border)" : "none" }}>
                  <div className="rounded-lg flex items-center justify-center shrink-0" style={{ width: 36, height: 36, background: "#FFF6E0", color: "#A87616" }}><Award size={18} /></div>
                  <div className="flex-1 min-w-0"><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", lineHeight: 1.3 }}>{c.level_number ? `Level ${c.level_number} — ` : ""}{c.level_title}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>Issued {fmtDate(c.issued_at)}</div></div>
                </div>
              ))}
              <button onClick={() => navigate("/certificates")} className="w-full mt-4 flex items-center justify-center gap-1.5 rounded-lg" style={{ height: 34, background: "var(--input-background)", color: "var(--nuru-navy)", fontSize: 12, fontWeight: 600, border: "none" }}>View certificates →</button>
            </div>

            <div className="rounded-2xl p-6" style={{ background: "#F7F3FC", border: "1px solid #E2D7F2" }}>
              <div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><Sparkles size={15} style={{ color: "var(--nuru-gold)" }} /><span style={{ fontSize: 14, fontWeight: 700, color: "var(--foreground)" }}>Badges</span></div><span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.badges.length} earned</span></div>
              {m.badges.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>No badges yet.</p> : (
                <div className="flex flex-col gap-2">
                  {m.badges.map((b) => (
                    <div key={b.code} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: "var(--secondary, var(--input-background))" }}>
                      <div className="rounded-full flex items-center justify-center shrink-0" style={{ width: 36, height: 36, background: "#fff", color: "#A87616" }}><Flame size={18} /></div>
                      <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{b.name}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{b.description}</div></div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Guardian consent modal */}
      {consentOpen && m.guardian && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(11,31,51,0.55)", backdropFilter: "blur(4px)" }} onClick={() => setConsentOpen(false)}>
          <div className="rounded-2xl w-full overflow-hidden" style={{ maxWidth: 520, background: "#fff", boxShadow: "0 40px 120px -20px rgba(0,0,0,0.55)" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between px-7 py-5" style={{ background: "linear-gradient(135deg,#FFFBEB,#FEF3C7)", borderBottom: "1px solid #F5E0A8" }}>
              <div className="flex items-start gap-3">
                <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 42, background: "#F59E0B", color: "#fff" }}><ShieldAlert size={20} /></div>
                <div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#5C3F0E", lineHeight: 1.15 }}>Guardian Consent</h2><p style={{ fontSize: 12.5, color: "#7A5410", marginTop: 2 }}>Required for minors on the Nuru Pathway</p></div>
              </div>
              <button onClick={() => setConsentOpen(false)} className="rounded-full flex items-center justify-center" style={{ width: 32, height: 32, color: "#7A5410", background: "none", border: "none" }}><X size={16} /></button>
            </div>
            <div className="px-7 py-6">
              <div className="flex items-center gap-2 mb-5">
                <span className="flex items-center gap-1.5 rounded-full px-3 py-1" style={{ background: m.guardian.consent === "Granted" ? "#E8F6EC" : "#FDECEC", color: m.guardian.consent === "Granted" ? "#15803D" : "#DC2626", fontSize: 12, fontWeight: 700 }}><CheckCircle2 size={13} /> Consent {m.guardian.consent.toLowerCase()}</span>
                <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>on {fmtDate(m.guardian.granted_at)}</span>
              </div>
              <div className="rounded-xl p-4 mb-5" style={{ background: "var(--input-background)", border: "1px solid var(--border)" }}>
                <div className="grid grid-cols-2 gap-y-4 gap-x-5">
                  {[
                    { l: "Guardian name", v: m.guardian.name },
                    { l: "Relationship", v: m.guardian.relationship },
                    { l: "Granted", v: fmtDate(m.guardian.granted_at) },
                    { l: "Consent version", v: m.guardian.consent_version ?? "—" },
                  ].map((x) => (
                    <div key={x.l}><div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>{x.l}</div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{x.v}</div></div>
                  ))}
                </div>
              </div>
              <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 16, lineHeight: 1.5 }}>Guardian contact details are stored encrypted and are not displayed here (§5.5). Use the Operations team to reach the guardian.</p>
              <button onClick={() => setConsentOpen(false)} className="w-full rounded-xl" style={{ height: 42, background: "var(--nuru-navy)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
