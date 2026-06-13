// Badges admin (Pulse design, Contract Matrix W4). Catalog with most-earned
// ordering, create (criteria validated server-side against the registered rule
// schemas), and retire. Awards themselves are server-derived only (§G.2).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ConfigApi, type BadgeRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";
import { PageHeader } from "../../ui/PageHeader";

export function Badges(): ReactElement {
  const [rows, setRows] = useState<BadgeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await ConfigApi.badges());
    } catch (e) {
      setError(errorMessage(e, "Could not load the badge catalog."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mostEarned = useMemo(() => [...rows].sort((a, b) => b.earned_count - a.earned_count), [rows]);

  async function retire(code: string): Promise<void> {
    setError(null);
    try {
      await ConfigApi.retireBadge(code);
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not retire the badge."));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader
        title="Badges Catalog"
        action={
          <button type="button" onClick={() => setShowCreate(true)} style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
            New badge
          </button>
        }
      />
      <h2 className="type-section" style={{ fontSize: 18 }}>Catalog · most-earned first</h2>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <section className="nuru-card" style={{ padding: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Badge</th>
              <th style={{ padding: "6px 4px" }}>Category</th>
              <th style={{ padding: "6px 4px" }}>Description</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Earned</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {mostEarned.map((b) => (
              <tr key={b.code} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>
                  <strong>{b.name}</strong>
                  <span style={{ color: colors.textFaint, marginLeft: 6, fontSize: font.size.sm }}>{b.code}</span>
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{b.category}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{b.description}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontWeight: 600 }}>{b.earned_count}</td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  <button type="button" onClick={() => void retire(b.code)}>
                    Retire
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: colors.textMuted }}>
                  No active badges.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {showCreate ? (
        <CreateBadge
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateBadge(props: { onClose: () => void; onDone: () => void }): ReactElement {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("journey");
  const [criteria, setCriteria] = useState('{ "rule": "modules_completed", "count": 5 }');
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(criteria);
    } catch {
      setErr("Criteria must be valid JSON.");
      return;
    }
    try {
      await ConfigApi.createBadge({ code, name, description, category, criteria: parsed });
      props.onDone();
    } catch (e) {
      setErr(errorMessage(e, "Create failed — criteria are validated against the registered rules."));
    }
  }

  const field = { display: "block", width: "100%", padding: 8, marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 460 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>New badge</h2>
        <label>
          Code
          <input value={code} onChange={(e) => setCode(e.target.value)} style={field} placeholder="faithful-5" />
        </label>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
        </label>
        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={field} />
        </label>
        <label>
          Category
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={field}>
            {["journey", "consistency", "community", "service"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Criteria (JSON, server-validated)
          <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} style={{ ...field, minHeight: 70, fontFamily: "ui-monospace, monospace" }} />
        </label>
        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={!code || !name || !description}>
            Create
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
