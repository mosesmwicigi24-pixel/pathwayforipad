// Level Reviews — the discipler's "usher members to the next level" screen. Lists
// members who passed a level exam and await their discipler advancing them into
// the next level (server-scoped to the signed-in leader's cells, §5.4). Each row
// has an "Usher to Level N+1" action that opens a small confirm with an optional
// blessing note, then advances the member and drops the row on success. The usher
// call is server-authoritative and idempotent (§1.1, §3.6). Real data only, wired
// to CurriculumApi.levelReviews / usherLevel. Matches the portal's navy/gold make.
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import {
  ChevronRight, Sparkles, Award, Clock, ArrowUpRight, CheckCircle2, X,
  UserCheck, RotateCcw, Users,
} from "lucide-react";
import { CurriculumApi, type LevelReviewRow } from "../../api/client";
import { errorMessage } from "../../util/error";

const initials = (n: string): string =>
  n.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

// Human "time waiting" from the created_at timestamp.
function waitingLabel(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m waiting`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h waiting`;
  const days = Math.floor(hrs / 24);
  return `${days}d waiting`;
}
const waitDays = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : Math.floor((Date.now() - t) / 86400000);
};

export function LevelReviews(): ReactElement {
  const [rows, setRows] = useState<LevelReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Confirm modal state.
  const [confirmRow, setConfirmRow] = useState<LevelReviewRow | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await CurriculumApi.levelReviews();
      setRows(data);
    } catch (e) {
      setError(errorMessage(e, "Could not load members awaiting ushering."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3500); return () => clearTimeout(t); }, [notice]);

  // Reset the note whenever a fresh confirm opens.
  useEffect(() => { setNote(""); }, [confirmRow?.id]);

  const oldest = useMemo(() => rows.reduce((m, r) => Math.max(m, waitDays(r.created_at)), 0), [rows]);
  const avgScore = useMemo(() => {
    const scored = rows.filter((r) => r.exam_score != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((s, r) => s + (r.exam_score ?? 0), 0) / scored.length);
  }, [rows]);

  async function usher(): Promise<void> {
    if (!confirmRow) return;
    setBusy(true);
    setError(null);
    try {
      await CurriculumApi.usherLevel(confirmRow.id, note);
      setRows((cur) => cur.filter((r) => r.id !== confirmRow.id));
      setNotice(`${confirmRow.member_name} ushered into Level ${confirmRow.level_number + 1}.`);
      setConfirmRow(null);
    } catch (e) {
      setError(errorMessage(e, "Could not usher this member. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minWidth: 0, background: "var(--background)", minHeight: "100%" }}>
      {/* Hero */}
      <div style={{ background: "linear-gradient(115deg, #0B2545 0%, #123057 55%, #173A63 100%)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ padding: "24px clamp(16px,4vw,48px) 24px" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(226,234,246,0.6)" }}>
            <span>Discipleship</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Level Reviews</span>
          </div>
          <div className="flex items-end justify-between gap-4 flex-wrap" style={{ marginTop: 12 }}>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>Level Reviews</h1>
                <span className="inline-flex items-center gap-1.5 rounded-full px-3" style={{ height: 26, background: "rgba(245,199,126,0.16)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.3)" }}>
                  <Sparkles size={11} /> {rows.length} awaiting
                </span>
              </div>
              <p style={{ fontSize: 13, color: "rgba(226,234,246,0.66)", marginTop: 6, maxWidth: 560, lineHeight: 1.5 }}>
                Members who passed their level exam and are ready for you to usher them into the next level of the pathway.
              </p>
            </div>
            <button
              onClick={() => void load()}
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-5">
          {[
            { label: "Awaiting ushering", value: String(rows.length), Icon: UserCheck, tint: "#FDF5E5", tone: "#8A6B1F" },
            { label: "Oldest waiting", value: rows.length ? `${oldest}d` : "—", Icon: Clock, tint: "#FDF0E6", tone: "#C2410C" },
            { label: "Avg exam score", value: avgScore != null ? `${avgScore}%` : "—", Icon: Award, tint: "#E8F6EE", tone: "#0F6B33" },
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
            <button onClick={() => void load()} className="rounded-lg px-3 py-1.5" style={{ background: "#A8281F", color: "#fff", border: "none", fontSize: 12, fontWeight: 700 }}>Try again</button>
          </div>
        )}

        {/* List */}
        {loading ? (
          <div className="flex flex-col gap-2.5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-2xl flex items-center gap-3" style={{ background: "#fff", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="rounded-xl shrink-0" style={{ width: 44, height: 44, background: "#EEF0F3" }} />
                <div className="flex-1 min-w-0">
                  <div style={{ height: 13, width: "38%", background: "#EEF0F3", borderRadius: 6 }} />
                  <div style={{ height: 11, width: "26%", background: "#F1F3F6", borderRadius: 6, marginTop: 8 }} />
                </div>
                <div className="rounded-xl" style={{ width: 150, height: 40, background: "#EEF0F3" }} />
              </div>
            ))}
          </div>
        ) : rows.length === 0 && !error ? (
          <div className="rounded-2xl flex flex-col items-center text-center" style={{ background: "#fff", border: "1px solid var(--border)", padding: 64, boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
            <div className="rounded-2xl flex items-center justify-center mb-5" style={{ width: 72, height: 72, background: "#F5E7C5", color: "#92651B" }}><Users size={32} /></div>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: 24, color: "var(--nuru-navy)", marginBottom: 8 }}>No one is waiting to be ushered right now.</h2>
            <p style={{ fontSize: 14, color: "var(--muted-foreground)", maxWidth: 440, lineHeight: 1.6 }}>
              When a member in your cells passes a level exam, they'll appear here for you to advance into the next level.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {rows.map((r) => (
              <div key={r.id} className="rounded-2xl flex items-center gap-3 flex-wrap" style={{ background: "#fff", border: "1px solid rgba(10,37,64,0.16)", padding: "15px 18px", boxShadow: "0 1px 2px rgba(11,31,51,0.05)" }}>
                <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 44, height: 44, background: "linear-gradient(135deg,#0B1F33,#16324F)", color: "#fff", fontFamily: "var(--font-display)", fontSize: 16 }}>{initials(r.member_name)}</div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>{r.member_name}</span>
                    <span className="rounded-full px-2.5 py-0.5" style={{ background: "#F5E7C5", color: "#92651B", fontSize: 10.5, fontWeight: 700 }}>Completed Level {r.level_number}</span>
                    {r.exam_score != null && (
                      <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: "rgba(200,155,60,0.16)", color: "#8A6B1F", fontSize: 10.5, fontWeight: 700, border: "1px solid rgba(200,155,60,0.35)" }}>
                        <Award size={11} /> {r.exam_score}%
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5" style={{ marginTop: 5 }}>
                    <Clock size={11} style={{ color: waitDays(r.created_at) >= 4 ? "#C2410C" : "var(--muted-foreground)" }} />
                    <span style={{ fontSize: 11.5, color: waitDays(r.created_at) >= 4 ? "#C2410C" : "var(--muted-foreground)" }}>{waitingLabel(r.created_at)} · since {fmtDate(r.created_at)}</span>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmRow(r)}
                  className="flex items-center gap-2 rounded-xl px-4 shrink-0"
                  style={{ height: 40, background: "var(--nuru-navy)", color: "#fff", border: "1px solid transparent", fontSize: 13, fontWeight: 700 }}
                >
                  Usher to Level {r.level_number + 1} <ArrowUpRight size={15} style={{ color: "var(--nuru-gold)" }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Confirm modal */}
      {confirmRow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.45)" }} onClick={() => !busy && setConfirmRow(null)}>
          <div className="rounded-2xl overflow-hidden" style={{ width: "min(480px, 100%)", background: "var(--card)", boxShadow: "0 24px 70px rgba(0,0,0,0.35)" }} onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-5 flex items-center justify-between" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
              <div className="flex items-center gap-2">
                <UserCheck size={16} style={{ color: "var(--nuru-gold)" }} />
                <h2 style={{ fontFamily: "var(--font-display)", fontSize: 18 }}>Usher to Level {confirmRow.level_number + 1}</h2>
              </div>
              <button onClick={() => setConfirmRow(null)} disabled={busy} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none", opacity: busy ? 0.5 : 1 }}><X size={16} color="#fff" /></button>
            </div>
            <div className="px-6 py-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-xl flex items-center justify-center shrink-0" style={{ width: 44, height: 44, background: "linear-gradient(135deg,#0B1F33,#16324F)", color: "#fff", fontFamily: "var(--font-display)", fontSize: 16 }}>{initials(confirmRow.member_name)}</div>
                <div className="min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--foreground)" }}>{confirmRow.member_name}</div>
                  <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>
                    Completed Level {confirmRow.level_number}{confirmRow.exam_score != null ? ` · ${confirmRow.exam_score}% exam` : ""}
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.6, marginBottom: 16 }}>
                This advances {confirmRow.member_name.split(/\s+/)[0]} to <strong style={{ color: "var(--nuru-navy)" }}>Level {confirmRow.level_number + 1}</strong> and notifies them.
              </p>
              <div className="mb-1">
                <label style={{ fontSize: 12, fontWeight: 700, color: "var(--foreground)" }}>Blessing note <span style={{ fontWeight: 500, color: "var(--muted-foreground)" }}>(optional)</span></label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Add an encouraging word to send along with their advancement…"
                  className="w-full rounded-xl px-4 py-3 outline-none resize-none mt-2"
                  style={{ background: "var(--input-background)", border: "1px solid var(--border)", fontSize: 14, lineHeight: 1.6 }}
                />
              </div>
              {error && <div className="rounded-xl mt-2" style={{ padding: "9px 12px", background: "#FDECEC", color: "#A8281F", fontSize: 12.5, fontWeight: 600 }}>{error}</div>}
            </div>
            <div className="px-6 py-4 flex items-center justify-end gap-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={() => setConfirmRow(null)} disabled={busy} className="rounded-xl px-4" style={{ height: 40, background: "#fff", color: "var(--foreground)", border: "1px solid rgba(10,37,64,0.22)", fontSize: 13, fontWeight: 600, opacity: busy ? 0.5 : 1 }}>Cancel</button>
              <button onClick={() => void usher()} disabled={busy} className="flex items-center gap-2 rounded-xl px-4" style={{ height: 40, background: "var(--nuru-navy)", color: "#fff", border: "1px solid transparent", fontSize: 13, fontWeight: 700, opacity: busy ? 0.7 : 1 }}>
                <CheckCircle2 size={15} style={{ color: "var(--nuru-gold)" }} /> {busy ? "Ushering…" : `Usher to Level ${confirmRow.level_number + 1}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
