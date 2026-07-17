// Shepherd's Pulse — the leader's weekly Flock Brief + live care signals.
// Instructor+ sees THEIR flock (cells they lead + direct disciples, §5.4);
// Admin/SuperAdmin see all signals and can run the scan / brief batch now.
// Signals carry a one-line summary and coarse tone only — never full text;
// the reflection itself stays in the Reflection Queue where it already lives.
import { useEffect, useState } from "react";
import { HeartPulse, AlertTriangle, CloudDrizzle, Smile, Check, RefreshCw, ScrollText } from "lucide-react";
import { AdminApi, type PulseSignal, type FlockBrief as Brief } from "../../api/client";

const SEV: Record<string, { label: string; cls: string }> = {
  urgent: { label: "URGENT", cls: "bg-red-100 text-red-700 border-red-200" },
  watch: { label: "WATCH", cls: "bg-amber-100 text-amber-800 border-amber-200" },
  info: { label: "NOTE", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};

const KIND_ICON: Record<string, JSX.Element> = {
  crisis: <AlertTriangle size={14} className="text-red-600" />,
  drift_risk: <CloudDrizzle size={14} className="text-amber-600" />,
  emotion: <Smile size={14} className="text-emerald-600" />,
};

export function FlockBrief(): JSX.Element {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [signals, setSignals] = useState<PulseSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const role = localStorage.getItem("role") ?? "";
  const isAdmin = role === "Admin" || role === "SuperAdmin";

  const load = async (): Promise<void> => {
    setLoading(true);
    const [b, s] = await Promise.all([AdminApi.flockBrief().catch(() => null), AdminApi.pulseSignals(14).catch(() => [])]);
    setBrief(b);
    setSignals(s);
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const ack = async (id: string): Promise<void> => {
    await AdminApi.ackSignal(id).catch(() => undefined);
    setSignals((prev) => prev.map((s) => (s.signal_id === id ? { ...s, acknowledged_at: new Date().toISOString() } : s)));
  };

  const run = async (which: "scan" | "briefs"): Promise<void> => {
    setRunning(which);
    try {
      if (which === "scan") await AdminApi.runPulseScan();
      else await AdminApi.runFlockBriefs();
      await load();
    } finally {
      setRunning(null);
    }
  };

  const open = signals.filter((s) => !s.acknowledged_at);
  const acked = signals.filter((s) => s.acknowledged_at);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="nuru-eyebrow flex items-center gap-2">
            <HeartPulse size={13} /> SHEPHERD'S PULSE
          </div>
          <h1 className="type-section mt-1">Flock Brief</h1>
          <p className="type-small text-[var(--muted-foreground)] mt-1">
            Your people this week — who to celebrate, who to watch, who to reach out to first.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              className="type-button rounded-lg border border-[var(--border)] bg-white px-3 py-2 hover:bg-[var(--muted)] flex items-center gap-2"
              onClick={() => void run("scan")}
              disabled={running !== null}
            >
              <RefreshCw size={14} className={running === "scan" ? "animate-spin" : ""} /> Run scan now
            </button>
            <button
              className="type-button rounded-lg bg-[var(--nuru-navy)] text-white px-3 py-2 hover:opacity-90 flex items-center gap-2"
              onClick={() => void run("briefs")}
              disabled={running !== null}
            >
              <ScrollText size={14} className={running === "briefs" ? "animate-spin" : ""} /> Compose briefs now
            </button>
          </div>
        )}
      </div>

      {/* The brief — stationery paper */}
      <div className="rounded-2xl border border-[#f2e2bd] bg-gradient-to-b from-[#fffdf6] to-[#f8f3e6] p-6 shadow-sm">
        {loading ? (
          <p className="type-body text-[var(--muted-foreground)]">Reading the flock…</p>
        ) : brief ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="nuru-eyebrow text-[#a8861c]">WEEK OF {brief.week_of}</span>
              <span className="type-small text-[var(--muted-foreground)]">Composed for you</span>
            </div>
            <p className="type-body whitespace-pre-wrap leading-7 text-[#2a3441]">{brief.body}</p>
          </>
        ) : (
          <p className="type-body text-[var(--muted-foreground)]">
            No brief yet — it composes every Saturday evening once you shepherd a cell or disciples.
            {isAdmin ? ' Use "Compose briefs now" to write this week\'s.' : ""}
          </p>
        )}
      </div>

      {/* Live signals */}
      <div className="rounded-2xl border border-[var(--border)] bg-white overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
          <h2 className="nuru-section-title">Care signals · last 14 days</h2>
          <span className="type-small text-[var(--muted-foreground)]">
            {open.length} open · {acked.length} acknowledged
          </span>
        </div>
        {signals.length === 0 ? (
          <p className="type-body text-[var(--muted-foreground)] px-5 py-8 text-center">
            No signals — your flock is steady. 🌿
          </p>
        ) : (
          <table className="w-full">
            <tbody>
              {[...open, ...acked].map((s) => (
                <tr key={s.signal_id} className={`border-b border-[var(--border)] last:border-0 ${s.acknowledged_at ? "opacity-55" : ""}`}>
                  <td className="px-5 py-3 w-8">{KIND_ICON[s.kind]}</td>
                  <td className="py-3 pr-3">
                    <div className="type-body font-semibold text-[var(--nuru-navy)]">{s.member_name}</div>
                    <div className="type-small text-[var(--muted-foreground)]">{s.summary}</div>
                  </td>
                  <td className="py-3 pr-3 w-24">
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10.5px] font-bold tracking-wide ${SEV[s.severity]?.cls ?? ""}`}>
                      {SEV[s.severity]?.label ?? s.severity}
                    </span>
                  </td>
                  <td className="py-3 pr-3 w-28 type-small text-[var(--muted-foreground)]">
                    {new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {s.source ?? "rhythm"}
                  </td>
                  <td className="py-3 pr-5 w-24 text-right">
                    {!s.acknowledged_at && (
                      <button
                        className="type-small inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 hover:bg-[var(--muted)]"
                        onClick={() => void ack(s.signal_id)}
                      >
                        <Check size={12} /> Ack
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="nuru-footnote">
        Signals carry a one-line summary only — the member's full words stay in the Reflection Queue, exactly as before.
        Crisis signals also push a care flag to the member's leaders the moment they are detected.
      </p>
    </div>
  );
}
