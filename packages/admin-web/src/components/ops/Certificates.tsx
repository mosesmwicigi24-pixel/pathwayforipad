// Certificates admin (Pulse design, Contract Matrix W4 over B1). Issued
// register with verification codes, manual issuance (idempotent server-side),
// and revocation with a required reason — verify() turns invalid immediately.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ConfigApi, type CertificateRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";
import { PageHeader } from "../../ui/PageHeader";

export function Certificates(): ReactElement {
  const [rows, setRows] = useState<CertificateRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState(false);

  const load = useCallback(async (append = false, before?: string) => {
    setError(null);
    try {
      const page = await ConfigApi.certificates(before);
      setRows((prev) => (append ? [...prev, ...page.data] : page.data));
      setCursor(page.next_cursor);
    } catch (e) {
      setError(errorMessage(e, "Could not load certificates."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string): Promise<void> {
    const reason = window.prompt("Reason for revocation (required, min 5 chars):");
    if (!reason) return;
    setError(null);
    try {
      await ConfigApi.revokeCertificate(id, reason);
      setNotice("Certificate revoked — public verification now reports it invalid.");
      await load();
    } catch (e) {
      setError(errorMessage(e, "Revocation failed."));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader
        title="Certificates &amp; Badges"
        action={
          <button type="button" onClick={() => setShowIssue(true)} style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
            Issue manually
          </button>
        }
      />
      <h2 className="type-section" style={{ fontSize: 18 }}>Issued certificates</h2>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      <section className="nuru-card" style={{ padding: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Member</th>
              <th style={{ padding: "6px 4px" }}>Level</th>
              <th style={{ padding: "6px 4px" }}>Verification code</th>
              <th style={{ padding: "6px 4px" }}>Issued</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.certificate_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>{c.full_name}</td>
                <td style={{ padding: "8px 4px" }}>{c.level_number ?? "pathway"}</td>
                <td style={{ padding: "8px 4px", fontFamily: "ui-monospace, monospace", fontSize: font.size.sm }}>
                  {c.verification_code}
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>
                  {new Date(c.issued_at).toLocaleDateString()}
                </td>
                <td style={{ padding: "8px 4px" }}>
                  {c.revoked_at ? (
                    <span style={{ color: colors.danger }} title={c.revoked_reason ?? ""}>
                      revoked
                    </span>
                  ) : (
                    <span style={{ color: colors.success }}>valid</span>
                  )}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  {!c.revoked_at ? (
                    <button type="button" onClick={() => void revoke(c.certificate_id)}>
                      Revoke
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: colors.textMuted }}>
                  Nothing issued yet.
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

      {showIssue ? (
        <IssueModal
          onClose={() => setShowIssue(false)}
          onDone={() => {
            setShowIssue(false);
            setNotice("Certificate issued.");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function IssueModal(props: { onClose: () => void; onDone: () => void }): ReactElement {
  const [userId, setUserId] = useState("");
  const [level, setLevel] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await ConfigApi.issueCertificate({
        user_id: userId.trim(),
        level_number: level === "" ? null : Number(level),
      });
      props.onDone();
    } catch (e) {
      setErr(errorMessage(e, "Issuance failed."));
    }
  }

  const field = { display: "block", width: "100%", padding: 8, marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 400 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>Issue certificate</h2>
        <label>
          Member user id
          <input value={userId} onChange={(e) => setUserId(e.target.value)} style={field} placeholder="uuid" />
        </label>
        <label>
          Level (blank = full-pathway certificate)
          <input value={level} onChange={(e) => setLevel(e.target.value)} style={field} placeholder="1–6" />
        </label>
        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={!userId.trim()}>
            Issue
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
