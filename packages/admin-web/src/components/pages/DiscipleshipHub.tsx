// Discipleship Hub — the discipler's console. A master–detail screen that answers
// "where is each of my disciples, and what are they waiting on?" and connects that
// oversight straight to action. The roster (GET /disciples, server-scoped to the
// leader's cells + relationship edges) sorts needs-action-first; selecting a
// student loads their full dossier (GET /disciples/:id) with progression, the six
// growth scores, engagement, reflections and recent activity. Three actions live
// in the detail: send a DM (reuses ChatApi create/open/send), usher to the next
// level when awaiting (CurriculumApi.usherLevel), and decide a pending reflection
// (OpsApi.decideReflection). All gating/scoring/scoping is server-authoritative
// (§1.1, §5.4). Real data only. Navy/gold "Final Pathway Portal" make.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ChevronRight, Sparkles, RotateCcw, Users, HeartHandshake, Flame, Clock,
  MessageSquare, Send, ArrowUpRight, CheckCircle2, AlertTriangle, Activity,
  BookOpen, ClipboardCheck, RotateCcw as ReturnIcon, PauseCircle, CircleAlert,
} from "lucide-react";
import {
  DisciplesApi, ChatApi, CurriculumApi, OpsApi,
  type DiscipleRow, type RosterSummary, type DiscipleDossier,
  type DiscipleBand, type DiscipleReflection, type ChatMessageRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";

const initials = (n: string): string =>
  n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

// Band visual language (shared with CellDetail).
const bandMeta: Record<DiscipleBand, { label: string; dot: string; bg: string; color: string }> = {
  thriving: { label: "Thriving", dot: "#16A34A", bg: "#F0FDF4", color: "#15803D" },
  steady: { label: "Steady", dot: "#0EA5E9", bg: "#E0F2FE", color: "#0369A1" },
  watch: { label: "Watch", dot: "#F59E0B", bg: "#FFFBEB", color: "#B45309" },
  at_risk: { label: "At risk", dot: "#DC2626", bg: "#FEF2F2", color: "#B91C1C" },
};

function BandPill({ band }: { band: DiscipleBand | null }): ReactElement | null {
  if (!band || !(band in bandMeta)) return null;
  const m = bandMeta[band];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5" style={{ background: m.bg, color: m.color, fontSize: 10.5, fontWeight: 700 }}>
      <span className="rounded-full" style={{ width: 6, height: 6, background: m.dot }} /> {m.label}
    </span>
  );
}

// Score chip color scales with the value (band-like), not the member's band.
function scoreTone(v: number | null): { bg: string; color: string } {
  if (v == null) return { bg: "#F1F3F6", color: "#6B7280" };
  if (v >= 75) return { bg: "#F0FDF4", color: "#15803D" };
  if (v >= 55) return { bg: "#E0F2FE", color: "#0369A1" };
  if (v >= 35) return { bg: "#FFFBEB", color: "#B45309" };
  return { bg: "#FEF2F2", color: "#B91C1C" };
}

const reflStatePill: Record<string, { label: string; bg: string; color: string }> = {
  pending: { label: "Pending", bg: "#FFFBEB", color: "#B45309" },
  approved: { label: "Approved", bg: "#F0FDF4", color: "#15803D" },
  returned: { label: "Returned", bg: "#FEF2F2", color: "#B91C1C" },
  deferred: { label: "Deferred", bg: "#EEF2FF", color: "#4338CA" },
  rejected: { label: "Rejected", bg: "#FEF2F2", color: "#B91C1C" },
};

// Sort: awaiting_level first, then most pending reflections, then band risk, then staleness.
const bandRank: Record<string, number> = { at_risk: 0, watch: 1, steady: 2, thriving: 3 };
function needsActionRank(r: DiscipleRow): number {
  return (r.awaiting_level != null ? 0 : 1) * 1000 - r.pending_reflections * 10 + (bandRank[r.band ?? "steady"] ?? 2);
}

function Avatar({ url, name, size }: { url: string | null; name: string; size: number }): ReactElement {
  if (url) {
    return <img src={url} alt={name} className="rounded-xl object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: size, height: size, background: "linear-gradient(135deg,#0B1F33,#16324F)", color: "#fff", fontFamily: "var(--font-display)", fontSize: size * 0.36 }}>
      {initials(name)}
    </div>
  );
}

export function DiscipleshipHub(): ReactElement {
  const [rows, setRows] = useState<DiscipleRow[]>([]);
  const [summary, setSummary] = useState<RosterSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadRoster = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, summary: s } = await DisciplesApi.roster();
      const sorted = [...data].sort((a, b) => needsActionRank(a) - needsActionRank(b));
      setRows(sorted);
      setSummary(s);
      // Keep the current selection if it's still in the roster; otherwise pick the
      // top (needs-action-first) row. Functional update avoids depending on state.
      const top = sorted[0]?.user_id ?? null;
      setSelectedId((cur) => (cur && sorted.some((r) => r.user_id === cur) ? cur : top));
    } catch (e) {
      setError(errorMessage(e, "Could not load your disciples."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadRoster(); }, [loadRoster]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);

  const awaiting = summary?.awaiting_action ?? rows.filter((r) => r.awaiting_level != null || r.pending_reflections > 0).length;
  const bandCounts = useMemo(() => {
    const c: Record<DiscipleBand, number> = { thriving: 0, steady: 0, watch: 0, at_risk: 0 };
    for (const r of rows) { const b = r.band; if (b && b in c) c[b] += 1; }
    return c;
  }, [rows]);

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(115deg, #0B2545 0%, #123057 55%, #173A63 100%)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ padding: "24px clamp(16px,4vw,48px) 24px" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(226,234,246,0.6)" }}>
            <span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Discipleship Hub</span>
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap" style={{ marginTop: 12 }}>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>Discipleship Hub</h1>
                {awaiting > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3" style={{ height: 26, background: "rgba(245,199,126,0.16)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.3)" }}>
                    <Sparkles size={11} /> {awaiting} need attention
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: "rgba(226,234,246,0.66)", marginTop: 6, maxWidth: 560, lineHeight: 1.5 }}>
                Your disciples and their journey — progress, engagement and what they're waiting on, all in one place.
              </p>
            </div>
            <button
              onClick={() => void loadRoster()}
              disabled={loading}
              className="flex items-center gap-2 rounded-lg px-3"
              style={{ height: 36, background: "rgba(255,255,255,0.1)", color: "#fff", border: "1px solid rgba(255,255,255,0.18)", fontSize: 12.5, fontWeight: 600, opacity: loading ? 0.6 : 1 }}
            >
              <RotateCcw size={14} /> Refresh
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "20px clamp(16px,4vw,48px) 40px" }}>
        {notice && (
          <div className="rounded-xl mb-4 flex items-center gap-2" style={{ padding: "10px 14px", background: "#E8F6EE", color: "#0F6B33", fontSize: 13, fontWeight: 600 }}>
            <CheckCircle2 size={15} /> {notice}
          </div>
        )}

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
          {[
            { label: "Disciples", value: String(summary?.total_students ?? rows.length), Icon: Users, tint: "#EEF4FB", tone: "#1E4E8C" },
            { label: "Awaiting action", value: String(awaiting), Icon: HeartHandshake, tint: "#FDF5E5", tone: "#8A6B1F" },
            { label: "On watch", value: String(bandCounts.watch), Icon: Clock, tint: "#FFFBEB", tone: "#B45309" },
            { label: "At risk", value: String(bandCounts.at_risk), Icon: CircleAlert, tint: "#FEF2F2", tone: "#B91C1C" },
          ].map((k) => {
            const Icon = k.Icon;
            return (
              <div key={k.label} className="rounded-2xl flex items-center gap-3" style={{ background: "#fff", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 42, height: 42, background: k.tint, color: k.tone }}><Icon size={19} /></div>
                <div className="min-w-0 flex-1">
                  <div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{k.label}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1, marginTop: 2 }}>{k.value}</div>
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="rounded-xl mb-4 flex items-center justify-between gap-3 flex-wrap" style={{ padding: "12px 14px", background: "#FDECEC", color: "#A8281F", fontSize: 13, fontWeight: 600 }}>
            <span>{error}</span>
            <button onClick={() => void loadRoster()} className="rounded-lg px-3 py-1.5" style={{ background: "#A8281F", color: "#fff", border: "none", fontSize: 12, fontWeight: 700 }}>Try again</button>
          </div>
        )}

        {/* Master–detail */}
        {loading && !rows.length ? (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl flex items-center gap-3" style={{ background: "#fff", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="rounded-xl shrink-0" style={{ width: 44, height: 44, background: "#EEF0F3" }} />
                <div className="flex-1 min-w-0">
                  <div style={{ height: 13, width: "38%", background: "#EEF0F3", borderRadius: 6 }} />
                  <div style={{ height: 11, width: "26%", background: "#F1F3F6", borderRadius: 6, marginTop: 8 }} />
                </div>
              </div>
            ))}
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="rounded-2xl flex flex-col items-center text-center" style={{ background: "#fff", border: "1px solid var(--border)", padding: 64, boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
            <div className="rounded-2xl flex items-center justify-center mb-5" style={{ width: 72, height: 72, background: "#F5E7C5", color: "#92651B" }}><HeartHandshake size={32} /></div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", marginBottom: 8 }}>You don't have any disciples assigned yet.</h2>
            <p style={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 440, lineHeight: 1.6 }}>
              When members are added to a cell you lead — or paired with you directly — they'll appear here for you to walk with on their journey.
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 360px) minmax(0, 1fr)" }}>
            {/* Roster */}
            <div className="flex flex-col gap-2.5" style={{ minWidth: 0 }}>
              {rows.map((r) => {
                const active = r.user_id === selectedId;
                return (
                  <button
                    key={r.user_id}
                    onClick={() => setSelectedId(r.user_id)}
                    className="rounded-2xl flex items-center gap-3 text-left w-full"
                    style={{
                      background: active ? "#0B1F33" : "#fff",
                      border: active ? "1px solid #0B1F33" : "1px solid rgba(10,37,64,0.14)",
                      padding: "13px 15px",
                      boxShadow: active ? "0 6px 18px rgba(11,31,51,0.22)" : "0 1px 2px rgba(11,31,51,0.05)",
                      cursor: "pointer",
                    }}
                  >
                    <Avatar url={r.avatar_url} name={r.full_name} size={42} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span style={{ fontSize: 14, fontWeight: 700, color: active ? "#fff" : "var(--foreground)" }}>{r.full_name}</span>
                        <BandPill band={r.band} />
                      </div>
                      <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 4, fontSize: 11.5, color: active ? "rgba(226,234,246,0.7)" : "var(--muted-foreground)" }}>
                        <span>{r.cell_name ?? "No cell"}</span>
                        <span>·</span>
                        <span>Level {r.current_level}</span>
                        <span className="inline-flex items-center gap-1"><Flame size={11} style={{ color: r.streak_days > 0 ? "#E0913A" : "inherit" }} /> {r.streak_days}d</span>
                      </div>
                      {(r.awaiting_level != null || r.pending_reflections > 0) && (
                        <div className="flex items-center gap-1.5 flex-wrap" style={{ marginTop: 7 }}>
                          {r.awaiting_level != null && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(200,155,60,0.18)", color: active ? "#F5C77E" : "#8A6B1F", fontSize: 10, fontWeight: 700, border: "1px solid rgba(200,155,60,0.35)" }}>
                              <ArrowUpRight size={10} /> Level {r.awaiting_level} to usher
                            </span>
                          )}
                          {r.pending_reflections > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: active ? "rgba(255,255,255,0.14)" : "#EEF4FB", color: active ? "#DCE9F7" : "#1E4E8C", fontSize: 10, fontWeight: 700 }}>
                              <BookOpen size={10} /> {r.pending_reflections} reflection{r.pending_reflections === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Detail */}
            <div style={{ minWidth: 0 }}>
              {selectedId ? (
                <DossierPanel
                  key={selectedId}
                  studentId={selectedId}
                  onNotice={setNotice}
                  onMutated={() => void loadRoster()}
                />
              ) : (
                <div className="rounded-2xl flex items-center justify-center" style={{ background: "#fff", border: "1px solid var(--border)", padding: 64, color: "var(--muted-foreground)", fontSize: 14 }}>
                  Select a disciple to see their journey.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Detail panel: the full dossier + the three inline actions ────────────────
function DossierPanel({
  studentId, onNotice, onMutated,
}: {
  studentId: string;
  onNotice: (m: string) => void;
  onMutated: () => void;
}): ReactElement {
  const [d, setD] = useState<DiscipleDossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setD(await DisciplesApi.dossier(studentId));
    } catch (e) {
      setError(errorMessage(e, "Could not load this disciple's journey."));
    } finally {
      setLoading(false);
    }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !d) {
    return (
      <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: 24 }}>
        <div style={{ height: 18, width: "40%", background: "#EEF0F3", borderRadius: 6 }} />
        <div style={{ height: 12, width: "24%", background: "#F1F3F6", borderRadius: 6, marginTop: 10 }} />
        <div className="grid grid-cols-3 gap-3" style={{ marginTop: 22 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} style={{ height: 64, background: "#F1F3F6", borderRadius: 12 }} />)}
        </div>
      </div>
    );
  }
  if (error || !d) {
    return (
      <div className="rounded-2xl flex items-center justify-between gap-3 flex-wrap" style={{ background: "#FDECEC", border: "1px solid #F5C5C0", padding: "14px 16px", color: "#A8281F", fontSize: 13, fontWeight: 600 }}>
        <span>{error ?? "Could not load this disciple."}</span>
        <button onClick={() => void load()} className="rounded-lg px-3 py-1.5" style={{ background: "#A8281F", color: "#fff", border: "none", fontSize: 12, fontWeight: 700 }}>Try again</button>
      </div>
    );
  }

  const modulesPct = d.progression.modules_total > 0
    ? Math.round((d.progression.modules_completed / d.progression.modules_total) * 100)
    : 0;

  const scoreRows: Array<{ key: string; label: string; value: number | null }> = [
    { key: "overall", label: "Overall", value: d.scores.overall },
    { key: "word", label: "Word", value: d.scores.word },
    { key: "prayer", label: "Prayer", value: d.scores.prayer },
    { key: "habits", label: "Habits", value: d.scores.habits },
    { key: "curriculum", label: "Curriculum", value: d.scores.curriculum },
    { key: "attendance", label: "Attendance", value: d.scores.attendance },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header card */}
      <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "20px 22px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
        <div className="flex items-start gap-4 flex-wrap">
          <Avatar url={d.member.avatar_url} name={d.member.full_name} size={56} />
          <div className="flex-1" style={{ minWidth: 200 }}>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--nuru-navy)", lineHeight: 1.1 }}>{d.member.full_name}</h2>
              <BandPill band={d.engagement.band} />
            </div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 5 }}>
              {d.member.cell_name ?? "No cell"}
              {d.member.established_at ? ` · with you since ${fmtDate(d.member.established_at)}` : d.member.joined_at ? ` · joined ${fmtDate(d.member.joined_at)}` : ""}
            </div>
          </div>
        </div>

        {/* Progression */}
        <div className="rounded-xl" style={{ marginTop: 18, padding: "14px 16px", background: "var(--background)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1" style={{ background: "var(--nuru-navy)", color: "#fff", fontSize: 11.5, fontWeight: 700 }}>Level {d.progression.current_level}</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground)" }}>{d.progression.level_title}</span>
            </div>
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--muted-foreground)", fontWeight: 600 }}>
              <Flame size={13} style={{ color: d.progression.streak_days > 0 ? "#E0913A" : "inherit" }} /> {d.progression.streak_days}-day streak
            </span>
          </div>
          <div className="flex items-center justify-between" style={{ marginTop: 12, fontSize: 11.5, color: "var(--muted-foreground)" }}>
            <span>Modules</span>
            <span style={{ fontWeight: 700, color: "var(--foreground)" }}>{d.progression.modules_completed}/{d.progression.modules_total}</span>
          </div>
          <div className="rounded-full overflow-hidden" style={{ height: 8, background: "#E7EBF0", marginTop: 6 }}>
            <div style={{ height: "100%", width: `${modulesPct}%`, background: "linear-gradient(90deg,#C89B3C,#E0B25A)", borderRadius: 999 }} />
          </div>
        </div>
      </div>

      {/* Growth scores */}
      <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
          <Activity size={15} style={{ color: "var(--nuru-gold)" }} />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Growth scores</h3>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {scoreRows.map((s) => {
            const t = scoreTone(s.value);
            return (
              <div key={s.key} className="rounded-xl" style={{ padding: "12px 14px", background: t.bg }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.color, opacity: 0.85 }}>{s.label}</div>
                <div style={{ fontFamily: "var(--font-display)", fontSize: 24, color: t.color, lineHeight: 1.1, marginTop: 2 }}>
                  {s.value == null ? "—" : s.value}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 flex-wrap" style={{ marginTop: 14, fontSize: 11.5, color: "var(--muted-foreground)" }}>
          <span className="inline-flex items-center gap-1.5"><span className="rounded-full" style={{ width: 7, height: 7, background: bandMeta[d.engagement.band ?? "steady"].dot }} /> Engagement {d.engagement.e_score == null ? "—" : d.engagement.e_score}</span>
          <span className="inline-flex items-center gap-1.5"><Clock size={12} /> {d.engagement.days_since_last_activity === 0 ? "Active today" : `${d.engagement.days_since_last_activity}d since active`}</span>
        </div>
      </div>

      {/* Usher action */}
      {d.progression.awaiting_level != null && (
        <UsherCard
          studentId={studentId}
          awaitingLevel={d.progression.awaiting_level}
          name={d.member.full_name}
          onDone={(lvl) => { onNotice(`${d.member.full_name.split(/\s+/)[0]} ushered into Level ${lvl}.`); void load(); onMutated(); }}
        />
      )}

      {/* Reflections */}
      <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
        <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
          <BookOpen size={15} style={{ color: "var(--nuru-gold)" }} />
          <h3 style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Reflections</h3>
        </div>
        {d.reflections.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No reflections submitted yet.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {d.reflections.map((r) => (
              <ReflectionCard
                key={r.reflection_id}
                r={r}
                onDone={(verb) => { onNotice(`Reflection ${verb}.`); void load(); onMutated(); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent activity */}
      {d.recent_activity.length > 0 && (
        <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
          <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
            <Activity size={15} style={{ color: "var(--nuru-gold)" }} />
            <h3 style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Recent activity</h3>
          </div>
          <div className="flex flex-col gap-2.5">
            {d.recent_activity.slice(0, 20).map((a, i) => (
              <div key={i} className="flex items-center gap-3" style={{ fontSize: 12.5 }}>
                <span className="rounded-full shrink-0" style={{ width: 7, height: 7, background: "var(--nuru-gold)" }} />
                <span style={{ color: "var(--foreground)", fontWeight: 500, textTransform: "capitalize" }}>{a.kind.replace(/_/g, " ")}</span>
                <span style={{ marginLeft: "auto", color: "var(--muted-foreground)" }}>{fmtDate(a.occurred_at)} · {fmtTime(a.occurred_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messenger */}
      <Messenger
        studentId={d.member.user_id}
        studentName={d.member.full_name}
        conversationId={d.dm_conversation_id}
        onConversationCreated={() => { void load(); }}
      />
    </div>
  );
}

// ── Usher-to-next-level card ─────────────────────────────────────────────────
function UsherCard({
  studentId, awaitingLevel, name, onDone,
}: {
  studentId: string;
  awaitingLevel: number;
  name: string;
  onDone: (level: number) => void;
}): ReactElement {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function usher(): Promise<void> {
    setBusy(true);
    setErr(null);
    try {
      // /reviews/levels/:id/usher keys on the ADVANCEMENT id, not the member —
      // resolve it from the awaiting-review queue for this student first.
      const reviews = await CurriculumApi.levelReviews();
      const row = reviews.find((r) => r.user_id === studentId && r.level_number === awaitingLevel)
        ?? reviews.find((r) => r.user_id === studentId);
      if (!row) {
        setErr("No pending advancement found for this disciple — they may already have been ushered.");
        return;
      }
      await CurriculumApi.usherLevel(row.id, note);
      onDone(awaitingLevel);
    } catch (e) {
      setErr(errorMessage(e, "Could not usher this disciple. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl" style={{ background: "linear-gradient(135deg,#FBF3DF,#F7E8C4)", border: "1px solid rgba(200,155,60,0.4)", padding: "18px 20px" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 4 }}>
        <ArrowUpRight size={16} style={{ color: "#8A6B1F" }} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#7A5A15", fontFamily: "var(--font-display)" }}>Ready to advance to Level {awaitingLevel}</h3>
      </div>
      <p style={{ fontSize: 12.5, color: "#8A6B1F", lineHeight: 1.5, marginBottom: 12 }}>
        {name.split(/\s+/)[0]} passed the level exam. Usher them into <strong>Level {awaitingLevel}</strong> — add a blessing to send along.
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="Blessing note (optional)…"
        className="w-full rounded-xl px-3.5 py-2.5 outline-none resize-none"
        style={{ background: "#fff", border: "1px solid rgba(200,155,60,0.4)", fontSize: 13, lineHeight: 1.5 }}
      />
      {err && <div className="rounded-lg mt-2" style={{ padding: "8px 11px", background: "#FDECEC", color: "#A8281F", fontSize: 12, fontWeight: 600 }}>{err}</div>}
      <button
        onClick={() => void usher()}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl px-4 mt-3"
        style={{ height: 40, background: "var(--nuru-navy)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, opacity: busy ? 0.7 : 1 }}
      >
        <CheckCircle2 size={15} style={{ color: "var(--nuru-gold)" }} /> {busy ? "Ushering…" : `Usher to Level ${awaitingLevel}`}
      </button>
    </div>
  );
}

// ── One reflection with an inline approve / return / defer decision ──────────
function ReflectionCard({
  r, onDone,
}: {
  r: DiscipleReflection;
  onDone: (verb: string) => void;
}): ReactElement {
  const pill = reflStatePill[r.state] ?? { label: r.state, bg: "#F1F3F6", color: "#6B7280" };
  const pending = r.state === "pending" || r.state === "deferred";
  const [mode, setMode] = useState<null | "approve" | "return" | "defer">(null);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: "approve" | "return" | "defer"): Promise<void> {
    if (decision === "return" && !feedback.trim()) {
      setErr("Add feedback so they know what to revisit.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await OpsApi.decideReflection(r.reflection_id, {
        decision,
        ...(feedback.trim() ? { feedback_notes: feedback.trim() } : {}),
      });
      onDone(decision === "approve" ? "approved" : decision === "return" ? "returned" : "deferred");
    } catch (e) {
      setErr(errorMessage(e, "Could not record this decision."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl" style={{ border: "1px solid var(--border)", padding: "13px 15px", background: "var(--background)" }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--foreground)" }}>{r.module_title}</span>
        <span className="rounded-full px-2 py-0.5" style={{ background: "#EEF4FB", color: "#1E4E8C", fontSize: 10, fontWeight: 700 }}>Level {r.level_number}</span>
        <span className="rounded-full px-2 py-0.5" style={{ background: pill.bg, color: pill.color, fontSize: 10, fontWeight: 700 }}>{pill.label}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted-foreground)" }}>{fmtDate(r.submitted_at)}</span>
      </div>
      <p style={{ fontSize: 13, color: "var(--foreground)", lineHeight: 1.6, marginTop: 8, whiteSpace: "pre-wrap" }}>{r.body}</p>
      {r.feedback_notes && (
        <div className="rounded-lg" style={{ marginTop: 8, padding: "8px 11px", background: "#EEF4FB", fontSize: 12, color: "#1E4E8C", lineHeight: 1.5 }}>
          <strong>Your feedback:</strong> {r.feedback_notes}
        </div>
      )}

      {pending && (
        <div style={{ marginTop: 12 }}>
          {mode === "return" && (
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={2}
              placeholder="What should they revisit? (required to return)"
              className="w-full rounded-lg px-3 py-2 outline-none resize-none mb-2"
              style={{ background: "#fff", border: "1px solid var(--border)", fontSize: 12.5, lineHeight: 1.5 }}
            />
          )}
          {err && <div className="rounded-lg mb-2" style={{ padding: "7px 10px", background: "#FDECEC", color: "#A8281F", fontSize: 11.5, fontWeight: 600 }}>{err}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => void decide("approve")}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3"
              style={{ height: 34, background: "#0F6B33", color: "#fff", border: "none", fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
            >
              <ClipboardCheck size={13} /> Approve
            </button>
            <button
              onClick={() => { if (mode === "return") void decide("return"); else { setMode("return"); setErr(null); } }}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3"
              style={{ height: 34, background: mode === "return" ? "#B91C1C" : "#fff", color: mode === "return" ? "#fff" : "#B91C1C", border: "1px solid #E7B7B2", fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
            >
              <ReturnIcon size={13} /> {mode === "return" ? "Send return" : "Return"}
            </button>
            <button
              onClick={() => void decide("defer")}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg px-3"
              style={{ height: 34, background: "#fff", color: "#4338CA", border: "1px solid #C7CBF0", fontSize: 12.5, fontWeight: 700, opacity: busy ? 0.6 : 1 }}
            >
              <PauseCircle size={13} /> Defer
            </button>
            {mode === "return" && (
              <button onClick={() => { setMode(null); setFeedback(""); setErr(null); }} disabled={busy} className="rounded-lg px-2" style={{ height: 34, background: "none", color: "var(--muted-foreground)", border: "none", fontSize: 12 }}>Cancel</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Lightweight inline messenger (read + send text over the DM) ──────────────
function Messenger({
  studentId, studentName, conversationId, onConversationCreated,
}: {
  studentId: string;
  studentName: string;
  conversationId: string | null;
  onConversationCreated: () => void;
}): ReactElement {
  const [convId, setConvId] = useState<string | null>(conversationId);
  const [messages, setMessages] = useState<ChatMessageRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setConvId(conversationId); }, [conversationId]);

  const loadThread = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const detail = await ChatApi.conversation(id);
      setMessages(detail.messages);
    } catch (e) {
      setError(errorMessage(e, "Could not load the conversation."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (convId) void loadThread(convId); else setMessages([]); }, [convId, loadThread]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

  async function start(): Promise<void> {
    setStarting(true);
    setError(null);
    try {
      const { conversation_id } = await ChatApi.createDm(studentId);
      setConvId(conversation_id);
      onConversationCreated();
    } catch (e) {
      setError(errorMessage(e, "Could not start a conversation."));
    } finally {
      setStarting(false);
    }
  }

  async function send(): Promise<void> {
    const body = draft.trim();
    if (!body || !convId) return;
    setSending(true);
    setError(null);
    try {
      await ChatApi.sendMessage(convId, { message_id: crypto.randomUUID(), body, msg_type: "text" });
      setDraft("");
      await loadThread(convId);
    } catch (e) {
      setError(errorMessage(e, "Could not send your message."));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "18px 20px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
      <div className="flex items-center gap-2" style={{ marginBottom: 14 }}>
        <MessageSquare size={15} style={{ color: "var(--nuru-gold)" }} />
        <h3 style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>Message {studentName.split(/\s+/)[0]}</h3>
      </div>

      {error && (
        <div className="rounded-lg mb-3 flex items-center gap-2" style={{ padding: "8px 11px", background: "#FDECEC", color: "#A8281F", fontSize: 12, fontWeight: 600 }}>
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {!convId ? (
        <div className="flex flex-col items-center text-center" style={{ padding: "18px 8px" }}>
          <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.6, marginBottom: 12, maxWidth: 320 }}>
            Reach out directly to walk with {studentName.split(/\s+/)[0]} — start a private conversation.
          </p>
          <button
            onClick={() => void start()}
            disabled={starting}
            className="flex items-center gap-2 rounded-xl px-4"
            style={{ height: 40, background: "var(--nuru-navy)", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, opacity: starting ? 0.7 : 1 }}
          >
            <MessageSquare size={15} style={{ color: "var(--nuru-gold)" }} /> {starting ? "Starting…" : "Start conversation"}
          </button>
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex flex-col gap-2" style={{ maxHeight: 260, overflowY: "auto", padding: "4px 2px 8px", marginBottom: 12 }}>
            {loading && !messages.length ? (
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "12px 0" }}>Loading conversation…</div>
            ) : messages.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "12px 0" }}>No messages yet — say hello.</div>
            ) : (
              messages.map((m) => (
                <div key={m.message_id} className="flex flex-col" style={{ alignItems: m.mine ? "flex-end" : "flex-start" }}>
                  <div
                    className="rounded-2xl"
                    style={{
                      maxWidth: "78%",
                      padding: "8px 12px",
                      background: m.mine ? "var(--nuru-navy)" : "var(--background)",
                      color: m.mine ? "#fff" : "var(--foreground)",
                      border: m.mine ? "none" : "1px solid var(--border)",
                      fontSize: 13,
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {m.msg_type === "text" || !m.msg_type ? m.body : <em style={{ opacity: 0.8 }}>[{m.msg_type}]</em>}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 3 }}>{fmtTime(m.created_at)}</span>
                </div>
              ))
            )}
          </div>
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
              rows={1}
              placeholder="Write a message…"
              className="flex-1 rounded-xl px-3.5 py-2.5 outline-none resize-none"
              style={{ background: "var(--background)", border: "1px solid var(--border)", fontSize: 13, lineHeight: 1.5, minHeight: 42 }}
            />
            <button
              onClick={() => void send()}
              disabled={sending || !draft.trim()}
              className="flex items-center justify-center rounded-xl shrink-0"
              style={{ width: 44, height: 44, background: "var(--nuru-navy)", color: "#fff", border: "none", opacity: sending || !draft.trim() ? 0.5 : 1 }}
              aria-label="Send"
            >
              <Send size={16} style={{ color: "var(--nuru-gold)" }} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
