// Audit viewer (Pulse design, Contract Matrix W4 over B1). SuperAdmin-only on
// the server; actor/action/entity filters + keyset paging over the append-only
// audit trail.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ConfigApi, type AuditRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";

export function AuditLog(): ReactElement {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (append = false, before?: number) => {
      setError(null);
      try {
        const q: { action?: string; entity?: string; before?: number } = {};
        if (action.trim()) q.action = action.trim();
        if (entity.trim()) q.entity = entity.trim();
        if (before) q.before = before;
        const page = await ConfigApi.audit(q);
        setRows((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.next_cursor);
      } catch (e) {
        setError(errorMessage(e, "Could not load the audit log (SuperAdmin only)."));
      }
    },
    [action, entity],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Action prefix (e.g. giving.)"
          aria-label="Action filter"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ padding: 8, border: `1px solid ${colors.border}`, borderRadius: 6, width: 220 }}
        />
        <input
          placeholder="Entity (e.g. modules)"
          aria-label="Entity filter"
          value={entity}
          onChange={(e) => setEntity(e.target.value)}
          style={{ padding: 8, border: `1px solid ${colors.border}`, borderRadius: 6, width: 180 }}
        />
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <section style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>When</th>
              <th style={{ padding: "6px 4px" }}>Actor</th>
              <th style={{ padding: "6px 4px" }}>Action</th>
              <th style={{ padding: "6px 4px" }}>Entity</th>
              <th style={{ padding: "6px 4px" }}>Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.audit_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px", color: colors.textMuted, whiteSpace: "nowrap" }}>
                  {new Date(a.created_at).toLocaleString()}
                </td>
                <td style={{ padding: "8px 4px" }}>{a.actor_name ?? a.actor_id?.slice(0, 8) ?? "system"}</td>
                <td style={{ padding: "8px 4px", fontFamily: "ui-monospace, monospace", fontSize: font.size.sm }}>
                  {a.action}
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{a.entity ?? "—"}</td>
                <td style={{ padding: "8px 4px", color: colors.textFaint, fontSize: font.size.sm, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {a.meta ? JSON.stringify(a.meta) : ""}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 16, color: colors.textMuted }}>
                  No audit entries match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {cursor ? (
          <button type="button" onClick={() => void load(true, cursor)} style={{ marginTop: 10 }}>
            Load more
          </button>
        ) : null}
      </section>
    </div>
  );
}
