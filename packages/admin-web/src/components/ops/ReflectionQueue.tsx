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
      <section style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setState(t)} disabled={t === state}>
            {t}
          </button>
        ))}
        <label style={{ marginLeft: 12, fontSize: font.size.md, color: colors.textMuted }}>
          <input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> overdue
          only (&gt;3 days)
        </label>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <section style={card}>
        {rows.length === 0 ? (
          <p style={{ color: colors.textMuted, margin: 0 }}>Nothing in “{state}”.</p>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => (
              <li key={r.reflection_id} style={{ borderBottom: `1px solid ${colors.border}`, padding: "10px 4px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong>
                    {r.full_name} · L{r.level_number} — {r.module_title}
                  </strong>
                  <span style={{ color: colors.textMuted, fontSize: font.size.sm }}>
                    {new Date(r.submitted_at).toLocaleDateString()}
                    {r.overdue ? <span style={{ color: colors.danger, marginLeft: 8 }}>⚠ overdue</span> : null}
                  </span>
                </div>
                <p style={{ margin: "6px 0", fontSize: font.size.md, whiteSpace: "pre-wrap" }}>{r.body}</p>
                {state === "pending" || state === "deferred" ? (
                  <button type="button" onClick={() => setOpen(r)}>
                    Review…
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
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
