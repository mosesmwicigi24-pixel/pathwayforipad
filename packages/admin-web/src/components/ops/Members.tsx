// Members admin (Pulse design, Contract Matrix W3 over B1). Congregation-wide
// list with search/band/level filters, keyset "load more", and the Add-learner
// flow (creates the Student + an L1 enrollment server-side, audited).
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { OpsApi, type MemberRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { bandColor, bandLabel } from "../../util/engagement";
import { colors, card, font } from "../../theme";

export function Members(): ReactElement {
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [band, setBand] = useState("");
  const [level, setLevel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(
    async (append = false, fromCursor?: string) => {
      setError(null);
      try {
        const q: { search?: string; band?: string; level?: number; cursor?: string } = {};
        if (search.trim()) q.search = search.trim();
        if (band) q.band = band;
        if (level) q.level = Number(level);
        if (fromCursor) q.cursor = fromCursor;
        const page = await OpsApi.members(q);
        setRows((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.next_cursor);
      } catch (e) {
        setError(errorMessage(e, "Could not load members."));
      }
    },
    [search, band, level],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="Search by name…"
          aria-label="Search members"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: 8, border: `1px solid ${colors.border}`, borderRadius: 6, width: 240 }}
        />
        <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="Band filter">
          <option value="">All bands</option>
          {["thriving", "steady", "watch", "at_risk"].map((b) => (
            <option key={b} value={b}>
              {bandLabel(b)}
            </option>
          ))}
        </select>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level filter">
          <option value="">All levels</option>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <option key={n} value={n}>
              Level {n}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowAdd(true)}>
          Add learner
        </button>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <section style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Name</th>
              <th style={{ padding: "6px 4px" }}>Cell</th>
              <th style={{ padding: "6px 4px" }}>Level</th>
              <th style={{ padding: "6px 4px" }}>Engagement</th>
              <th style={{ padding: "6px 4px" }}>Last activity</th>
              <th style={{ padding: "6px 4px" }}>Contact</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.user_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>
                  {m.full_name}
                  {m.is_minor ? <span style={{ color: colors.warningText, marginLeft: 6, fontSize: font.size.xs }}>minor</span> : null}
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{m.cell_name ?? "—"}</td>
                <td style={{ padding: "8px 4px" }}>{m.current_level ?? "—"}</td>
                <td style={{ padding: "8px 4px" }}>
                  {m.band ? <span style={{ color: bandColor(m.band) }}>{bandLabel(m.band)}</span> : "—"}
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>
                  {m.last_activity ? new Date(m.last_activity).toLocaleDateString() : "never"}
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{m.email ?? m.phone_number}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: colors.textMuted }}>
                  No members match.
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

      {showAdd ? (
        <AddLearner
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function AddLearner(props: { onClose: () => void; onAdded: () => void }): ReactElement {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [cellId, setCellId] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await OpsApi.addMember({
        full_name: fullName,
        phone_number: phone,
        ...(email ? { email } : {}),
        ...(dob ? { date_of_birth: dob } : {}),
        cell_group_id: cellId,
      });
      props.onAdded();
    } catch (e) {
      setErr(errorMessage(e, "Could not add the learner."));
    }
  }

  const field = { display: "block", width: "100%", padding: 8, marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 420 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>Add learner</h2>
        <label>
          Full name
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} style={field} />
        </label>
        <label>
          Phone (required)
          <input value={phone} onChange={(e) => setPhone(e.target.value)} style={field} placeholder="+2547…" />
        </label>
        <label>
          Email (optional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} style={field} />
        </label>
        <label>
          Date of birth (optional)
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} style={field} />
        </label>
        <label>
          Cell group id
          <input value={cellId} onChange={(e) => setCellId(e.target.value)} style={field} placeholder="uuid" />
        </label>
        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={!fullName || !phone || !cellId}>
            Create + enroll at Level 1
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
