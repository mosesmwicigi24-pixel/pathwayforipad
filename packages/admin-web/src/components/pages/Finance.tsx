// Finance — rebuilt to the "Final Pathway Portal" make, wired to the live finance
// reads (ConfigApi.financeSummary / transactions / ledger). Fund cards, a
// giving-by-fund donut, a filterable transactions table, and the double-entry
// ledger. Money is integer minor units + ISO currency (§ money path). This page
// is read-only reporting — cards never touch the server (PCI SAQ-A, §5.6).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, Download, RefreshCw, Sparkles, Wallet, ChevronDown, ShieldCheck } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { ConfigApi, type FundSummary, type TransactionRow, type LedgerRow } from "../../api/client";
import { errorMessage } from "../../util/error";

const TONES = ["#C89B3C", "#16A34A", "#0B84E8", "#7C3AED", "#DC2626", "#0D9488"];
const money = (minor: number, currency: string | null): string => `${currency ?? "KES"} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;
const statusChip: Record<string, { bg: string; color: string }> = {
  confirmed: { bg: "#E8F6EC", color: "#0F6B33" }, settled: { bg: "#E8F6EC", color: "#0F6B33" }, succeeded: { bg: "#E8F6EC", color: "#0F6B33" },
  pending: { bg: "#FFFBEB", color: "#A87616" }, processing: { bg: "#FFFBEB", color: "#A87616" },
  failed: { bg: "#FDECEC", color: "#DC2626" }, refunded: { bg: "#EEF1F8", color: "#1F3A6B" },
};
const METHOD_LABEL: Record<string, string> = { mpesa: "M-Pesa", airtel: "Airtel", paypal: "PayPal", card: "Card", stripe: "Card" };
const methodLabel = (m: string | null): string => (m ? METHOD_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1) : "—");
const fmtDate = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); };
const STATUS_FILTERS = ["All", "confirmed", "pending", "failed", "refunded"] as const;

export function Finance(): ReactElement {
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [txns, setTxns] = useState<TransactionRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [fundFilter, setFundFilter] = useState<string>("All");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [error, setError] = useState<string | null>(null);

  const loadTxns = useCallback(async () => {
    try {
      const q: { fund?: string; status?: string } = {};
      if (fundFilter !== "All") q.fund = fundFilter;
      if (statusFilter !== "All") q.status = statusFilter;
      const r = await ConfigApi.transactions(q);
      setTxns(r.data);
    } catch (e) { setError(errorMessage(e, "Could not load transactions.")); }
  }, [fundFilter, statusFilter]);

  useEffect(() => { void ConfigApi.financeSummary().then((r) => setFunds(r.funds)).catch((e) => setError(errorMessage(e, "Could not load funds."))); }, []);
  useEffect(() => { void ConfigApi.ledger(100).then(setLedger).catch(() => {}); }, []);
  useEffect(() => { void loadTxns(); }, [loadTxns]);

  const currency = funds[0]?.currency ?? "KES";
  const monthTotal = funds.reduce((s, f) => s + f.month_minor, 0);
  const allTotal = funds.reduce((s, f) => s + f.total_minor, 0);
  const giftCount = funds.reduce((s, f) => s + f.gift_count, 0);
  const donut = useMemo(() => funds.filter((f) => f.month_minor > 0).map((f, i) => ({ name: f.name, value: Math.round(f.month_minor / 100), color: TONES[i % TONES.length] as string })), [funds]);

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Nuru Pathway</span><ChevronRight size={10} /><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Finance</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> Giving ledger</span>
            <button onClick={() => window.print()} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><Download size={13} /> Export</button>
            <button onClick={() => void loadTxns()} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>Finance</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "This month", value: money(monthTotal, currency), hint: `${giftCount} gifts` },
            { label: "All time", value: money(allTotal, currency), hint: "across funds" },
            { label: "Funds", value: String(funds.length), hint: "active" },
            { label: "Transactions", value: String(txns.length), hint: "in view" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}

        {/* Fund cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-5 nuru-card-rotate">
          {funds.map((f, i) => {
            const tone = TONES[i % TONES.length] as string;
            return (
              <div key={f.code} className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "16px 18px" }}>
                <div className="flex items-center justify-between mb-2"><div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: `${tone}18`, color: tone }}><Wallet size={16} /></div><span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)" }}>{f.gift_count} gifts</span></div>
                <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{f.name}</div>
                <div style={{ fontFamily: "var(--font-display)", color: "var(--nuru-navy)", fontSize: 24, lineHeight: 1 }}>{money(f.total_minor, f.currency)}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 6 }}>{money(f.month_minor, f.currency)} this month</div>
              </div>
            );
          })}
          {funds.length === 0 && !error ? <p style={{ color: "var(--muted-foreground)", fontSize: 13 }}>No funds configured.</p> : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
          {/* Giving by fund donut */}
          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "18px 20px" }}>
            <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 4 }}>Giving by fund</h3>
            <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 12 }}>This month · {currency}</p>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart><Pie data={donut} dataKey="value" innerRadius={52} outerRadius={82} paddingAngle={2} stroke="none">{donut.map((d) => <Cell key={d.name} fill={d.color} />)}</Pie><Tooltip contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} /></PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-1.5 mt-2">{donut.map((d) => <div key={d.name} className="flex items-center justify-between"><span className="flex items-center gap-2" style={{ fontSize: 12, color: "var(--nuru-navy)", fontWeight: 600 }}><span style={{ width: 8, height: 8, borderRadius: 99, background: d.color }} /> {d.name}</span><span className="font-mono" style={{ fontSize: 12, color: "var(--muted-foreground)" }}>{currency} {d.value.toLocaleString()}</span></div>)}</div>
          </div>

          {/* Transactions */}
          <div className="lg:col-span-2 rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="nuru-section-title">Recent gifts</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setFundFilter(["All", ...funds.map((f) => f.code)][(["All", ...funds.map((f) => f.code)].indexOf(fundFilter) + 1) % (funds.length + 1)] ?? "All")} className="flex items-center gap-1.5 rounded-lg" style={{ height: 32, padding: "0 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)" }}>Fund: {fundFilter === "All" ? "All" : funds.find((f) => f.code === fundFilter)?.name ?? fundFilter} <ChevronDown size={12} /></button>
                <button onClick={() => setStatusFilter(STATUS_FILTERS[(STATUS_FILTERS.indexOf(statusFilter) + 1) % STATUS_FILTERS.length] as (typeof STATUS_FILTERS)[number])} className="flex items-center gap-1.5 rounded-lg" style={{ height: 32, padding: "0 10px", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)", background: "var(--card)", color: "var(--nuru-navy)", textTransform: "capitalize" }}>Status: {statusFilter} <ChevronDown size={12} /></button>
              </div>
            </div>
            <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--secondary)" }}>{["Member", "Fund", "Method", "Amount", "Status", "Date"].map((h) => <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
              <tbody>
                {txns.map((t) => { const sc = statusChip[t.status] ?? statusChip.pending!; return (
                  <tr key={t.transaction_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{t.full_name ?? "Anonymous"}</td>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{t.fund ?? "—"}</td>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{methodLabel(t.method)}</td>
                    <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)", fontFamily: "var(--font-mono)" }}>{money(t.amount_minor, t.currency)}</td>
                    <td style={{ padding: "10px 16px" }}><span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", ...sc }}>{t.status}</span></td>
                    <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{fmtDate(t.created_at)}</td>
                  </tr>
                ); })}
                {txns.length === 0 ? <tr><td colSpan={6} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No transactions match.</td></tr> : null}
              </tbody>
            </table></div>
          </div>
        </div>

        {/* Ledger */}
        <div className="rounded-2xl overflow-hidden" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
          <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}><span className="nuru-section-title">Double-entry ledger</span><span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}><ShieldCheck size={13} style={{ color: "#16A34A" }} /> Server-authoritative · verified webhooks only</span></div>
          <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "var(--secondary)" }}>{["Account", "Side", "Amount", "When"].map((h) => <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.entry_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, color: "var(--nuru-navy)" }}>{l.account}</td>
                  <td style={{ padding: "9px 16px" }}><span className="rounded px-2 py-0.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", background: l.side === "debit" ? "#EEF1F8" : "#E8F6EC", color: l.side === "debit" ? "#1F3A6B" : "#0F6B33" }}>{l.side}</span></td>
                  <td style={{ padding: "9px 16px", fontSize: 12.5, fontFamily: "var(--font-mono)", color: "var(--foreground)" }}>{money(l.amount_minor, l.currency)}</td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{fmtDate(l.created_at)}</td>
                </tr>
              ))}
              {ledger.length === 0 ? <tr><td colSpan={4} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: "var(--muted-foreground)" }}>No ledger entries yet.</td></tr> : null}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
}
