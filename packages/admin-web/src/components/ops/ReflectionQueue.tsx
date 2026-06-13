// Reflection Queue v2 (Pulse design, Contract Matrix W3 over B3). Module
// reflections with the unified states: approve / return (re-locks gating) /
// defer, member-visible feedback, an INTERNAL pastoral note (never reaches the
// member, §5.4), overdue (>3 days) flagging, and state-tab filtering.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { OpsApi, type ReflectionRow, type ReflectionState } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";

const TABS: ReflectionState[] = ["pending", "returned", "deferred", "approved"];

export function ReflectionQueue(): ReactElement {
  const [state, setState] = useState<ReflectionState>("pending");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [rows, setRows] = useState<ReflectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<ReflectionRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await OpsApi.reflections({ state, ...(overdueOnly ? { overdue: true } : {}) }));
    } catch (e) {
      setError(errorMessage(e, "Could not load the queue."));
    }
  }, [state, overdueOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div>
        <div className="nuru-eyebrow nuru-eyebrow-gold">OPERATIONS</div>
        <h1 className="nuru-display" style={{ fontSize: 28 }}>Reflection Queue</h1>
      </div>

      <div className="flex items-center justify-between" style={{ flexWrap: "wrap", gap: 10 }}>
        <div className="nuru-tabs">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setState(t)} data-active={t === state} className="nuru-tab" style={{ textTransform: "capitalize", background: "transparent" }}>
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2" style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only (&gt;3 days)
        </label>
      </div>

      {error ? <p style={{ color: "var(--color-danger)", margin: 0 }}>{error}</p> : null}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {rows.length === 0 ? (
          <div className="nuru-card" style={{ padding: 24, color: "var(--muted-foreground)", fontSize: 13 }}>{`Nothing in “${state}”.`}</div>
        ) : (
          rows.map((r) => (
            <div key={r.reflection_id} className="nuru-card" style={{ padding: 16 }}>
              <div className="flex items-center justify-between" style={{ gap: 12 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--nuru-navy)" }}>
                  {`${r.full_name} · L${r.level_number} — ${r.module_title}`}
                </div>
                <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>
                  {new Date(r.submitted_at).toLocaleDateString()}
                  {r.overdue ? <span style={{ color: "var(--color-danger)", marginLeft: 8, fontWeight: 600 }}>⚠ overdue</span> : null}
                </span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--foreground)", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{r.body}</p>
              {state === "pending" || state === "deferred" ? (
                <button type="button" onClick={() => setOpen(r)} style={{ marginTop: 12, background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 9, padding: "8px 14px", fontSize: 13, fontWeight: 600 }}>
                  Review…
                </button>
              ) : null}
            </div>
          ))
        )}
      </section>

      {open ? (
        <DecisionModal
          row={open}
          onClose={() => setOpen(null)}
          onDecided={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function DecisionModal(props: { row: ReflectionRow; onClose: () => void; onDecided: () => void }): ReactElement {
  const [decision, setDecision] = useState<"approve" | "return" | "defer">("approve");
  const [feedback, setFeedback] = useState("");
  const [pastoral, setPastoral] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await OpsApi.decideReflection(props.row.reflection_id, {
        decision,
        ...(feedback.trim() ? { feedback_notes: feedback.trim() } : {}),
        ...(pastoral.trim() ? { pastoral_note: pastoral.trim() } : {}),
      });
      props.onDecided();
    } catch (e) {
      setErr(errorMessage(e, "Decision failed — returns need feedback for the member."));
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 520, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>
          {props.row.full_name} — {props.row.module_title}
        </h2>
        <p style={{ whiteSpace: "pre-wrap", fontSize: font.size.md }}>{props.row.body}</p>

        <div role="radiogroup" aria-label="Decision" style={{ display: "flex", gap: 12, margin: "10px 0" }}>
          {(["approve", "return", "defer"] as const).map((d) => (
            <label key={d} style={{ fontSize: font.size.base }}>
              <input type="radio" name="decision" checked={decision === d} onChange={() => setDecision(d)} /> {d}
            </label>
          ))}
        </div>
        {decision === "return" ? (
          <p style={{ color: colors.warningText, fontSize: font.size.sm, margin: "4px 0" }}>
            Returning re-locks the module until the member resubmits — feedback below is required.
          </p>
        ) : null}

        <label style={{ display: "block", marginTop: 8, fontSize: font.size.md }}>
          Feedback to the member {decision === "return" ? "(required)" : "(optional)"}
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            style={{ display: "block", width: "100%", minHeight: 70, marginTop: 4, padding: 8, border: `1px solid ${colors.border}`, borderRadius: 6 }}
          />
        </label>
        <label style={{ display: "block", marginTop: 8, fontSize: font.size.md }}>
          Pastoral note — <strong>internal only, never shown to the member</strong>
          <textarea
            value={pastoral}
            onChange={(e) => setPastoral(e.target.value)}
            style={{ display: "block", width: "100%", minHeight: 50, marginTop: 4, padding: 8, border: `1px solid ${colors.warningText}`, borderRadius: 6, background: colors.warningBg }}
          />
        </label>

        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={decision === "return" && !feedback.trim()}>
            Submit decision
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
