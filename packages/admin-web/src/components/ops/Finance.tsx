// Finance (Pulse design, Contract Matrix W4 over B1). View-only per §5.4:
// per-fund revenue cards (month + all-time), the transaction register with
// fund/status filters + keyset paging, and the balanced double-entry ledger.
// Money renders from integer minor units — never floats.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ConfigApi, type FundSummary, type TransactionRow, type LedgerRow } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";
import { PageHeader } from "../../ui/PageHeader";

export function money(minor: number, currency: string | null): string {
  const c = currency ?? "KES";
  return `${c} ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function Finance(): ReactElement {
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [txns, setTxns] = useState<TransactionRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [fundFilter, setFundFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showLedger, setShowLedger] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ConfigApi.financeSummary()
      .then((r) => setFunds(r.funds))
      .catch((e) => setError(errorMessage(e, "Could not load the fund summary.")));
  }, []);

  const loadTxns = useCallback(
    async (append = false, before?: string) => {
      try {
        const q: { fund?: string; status?: string; before?: string } = {};
        if (fundFilter) q.fund = fundFilter;
        if (statusFilter) q.status = statusFilter;
        if (before) q.before = before;
        const page = await ConfigApi.transactions(q);
        setTxns((prev) => (append ? [...prev, ...page.data] : page.data));
        setCursor(page.next_cursor);
      } catch (e) {
        setError(errorMessage(e, "Could not load transactions."));
      }
    },
    [fundFilter, statusFilter],
  );

  useEffect(() => {
    void loadTxns();
  }, [loadTxns]);

  async function openLedger(): Promise<void> {
    try {
      setLedger(await ConfigApi.ledger(100));
      setShowLedger(true);
    } catch (e) {
      setError(errorMessage(e, "Could not load the ledger."));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader eyebrow="OPERATIONS" title="Finance" />
      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}

      <section
        className="nuru-card-rotate"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}
        aria-label="Fund revenue"
      >
        {funds.map((f) => (
          <div key={`${f.code}-${f.currency ?? ""}`} style={{ borderRadius: 16, padding: 16, border: "1px solid var(--border)" }}>
            <div style={{ color: "var(--muted-foreground)", fontSize: 12 }}>{f.name}</div>
            <div className="nuru-numeric" style={{ fontSize: 24, marginTop: 4 }}>
              {money(f.month_minor, f.currency)}
            </div>
            <div style={{ color: "var(--muted-foreground)", fontSize: 11.5, marginTop: 2 }}>
              this month · all-time {money(f.total_minor, f.currency)} · {f.gift_count} gifts
            </div>
          </div>
        ))}
      </section>

      <section className="nuru-card" style={{ padding: 16 }} aria-label="Transactions">
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: font.size.lg }}>Transactions</h2>
          <div style={{ flex: 1 }} />
          <select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} aria-label="Fund filter">
            <option value="">All funds</option>
            {funds.map((f) => (
              <option key={f.code} value={f.code}>
                {f.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {["processing", "succeeded", "failed", "refunded"].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void openLedger()}>
            Ledger view
          </button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Member</th>
              <th style={{ padding: "6px 4px" }}>Fund</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Amount</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
              <th style={{ padding: "6px 4px" }}>Created</th>
              <th style={{ padding: "6px 4px" }}>Settled</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.transaction_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>{t.full_name ?? "—"}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{t.fund ?? "purchase"}</td>
                <td style={{ padding: "8px 4px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {money(t.amount_minor, t.currency)}
                </td>
                <td style={{ padding: "8px 4px" }}>
                  <span style={{ color: t.status === "succeeded" ? colors.success : t.status === "failed" ? colors.danger : colors.warningText }}>
                    {t.status}
                  </span>
                </td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{new Date(t.created_at).toLocaleDateString()}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>
                  {t.settled_at ? new Date(t.settled_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
            {txns.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: colors.textMuted }}>
                  No transactions match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
        {cursor ? (
          <button type="button" onClick={() => void loadTxns(true, cursor)} style={{ marginTop: 10 }}>
            Load more
          </button>
        ) : null}
      </section>

      {showLedger ? (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
          onClick={() => setShowLedger(false)}
        >
          <div style={{ ...card, width: 640, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>Double-entry ledger (latest 100)</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.sm }}>
              <thead>
                <tr style={{ textAlign: "left", color: colors.textMuted }}>
                  <th style={{ padding: 4 }}>Account</th>
                  <th style={{ padding: 4 }}>Side</th>
                  <th style={{ padding: 4, textAlign: "right" }}>Amount</th>
                  <th style={{ padding: 4 }}>When</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.entry_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: 4, fontFamily: "ui-monospace, monospace" }}>{l.account}</td>
                    <td style={{ padding: 4, color: l.side === "debit" ? colors.primary : colors.success }}>{l.side}</td>
                    <td style={{ padding: 4, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                      {money(l.amount_minor, l.currency)}
                    </td>
                    <td style={{ padding: 4, color: colors.textMuted }}>{new Date(l.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setShowLedger(false)} style={{ marginTop: 12 }}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
