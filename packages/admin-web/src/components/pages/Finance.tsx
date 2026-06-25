// Finance — Giving Ledger console, rebuilt to the "Final Pathway Portal" make as a
// 5-tab read-only reporting surface (Overview / Transactions / Ledger / Audit /
// Configuration), wired to the live finance reads in ConfigApi. Money is integer
// minor units + ISO currency. This page is read-only: it issues no writes, no
// payment actions, and shows no secrets — cards never touch the server and config
// is informational only (PCI SAQ-A, §5.6; step-up MFA is administrator-managed).
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  Lock,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ConfigApi,
  type FinanceAuditRow,
  type FinanceConfig,
  type FinanceTrendPoint,
  type FundSummary,
  type LedgerRow,
  type TransactionDetail,
  type TransactionRow,
} from "../../api/client";
import { errorMessage } from "../../util/error";

/* ---------- tokens ---------- */
const NAVY = "var(--nuru-navy)";
const GOLD = "var(--nuru-gold)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const DISPLAY = "var(--font-display)";
const MONO = "var(--font-mono)";
const TONES = ["#C89B3C", "#16A34A", "#0B84E8", "#7C3AED", "#DC2626", "#0D9488"];

/* ---------- helpers (reused conventions from prior Finance page) ---------- */
const money = (minor: number | null, currency: string | null): string =>
  `${currency ?? "KES"} ${Math.round((minor ?? 0) / 100).toLocaleString()}`;

const statusChip: Record<string, { bg: string; color: string }> = {
  confirmed: { bg: "#E8F6EC", color: "#0F6B33" },
  settled: { bg: "#E8F6EC", color: "#0F6B33" },
  succeeded: { bg: "#E8F6EC", color: "#0F6B33" },
  pending: { bg: "#FFFBEB", color: "#A87616" },
  processing: { bg: "#FFFBEB", color: "#A87616" },
  requires_action: { bg: "#FFFBEB", color: "#A87616" },
  failed: { bg: "#FDECEC", color: "#DC2626" },
  refunded: { bg: "#F3EAFE", color: "#7C3AED" },
};

// Ledger status is DERIVED from the payment status, not stored.
const ledgerChip: Record<string, { label: string; bg: string; color: string }> = {
  succeeded: { label: "Posted", bg: "#E8F6EC", color: "#0F6B33" },
  settled: { label: "Posted", bg: "#E8F6EC", color: "#0F6B33" },
  confirmed: { label: "Posted", bg: "#E8F6EC", color: "#0F6B33" },
  processing: { label: "Waiting", bg: "#FFFBEB", color: "#A87616" },
  requires_action: { label: "Waiting", bg: "#FFFBEB", color: "#A87616" },
  pending: { label: "Waiting", bg: "#FFFBEB", color: "#A87616" },
  failed: { label: "Not posted", bg: "#EEF0F3", color: "#6B7280" },
  refunded: { label: "Reversed", bg: "#F3EAFE", color: "#7C3AED" },
};
const ledgerStatus = (status: string): { label: string; bg: string; color: string } =>
  ledgerChip[status] ?? { label: "—", bg: "#EEF0F3", color: "#6B7280" };

const METHOD_LABEL: Record<string, string> = {
  mpesa: "M-Pesa",
  airtel: "Airtel",
  paypal: "PayPal",
  card: "Card",
  stripe: "Card",
};
const methodLabel = (m: string | null): string =>
  m ? METHOD_LABEL[m] ?? m.charAt(0).toUpperCase() + m.slice(1) : "—";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const fmtDateTime = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};
const shortRef = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

// Wire-status labels for the Status dropdown (label → API status value).
const STATUS_FILTERS: { label: string; value: string }[] = [
  { label: "All", value: "All" },
  { label: "Confirmed", value: "succeeded" },
  { label: "Pending", value: "processing" },
  { label: "Failed", value: "failed" },
  { label: "Refunded", value: "refunded" },
];

type TabKey = "overview" | "transactions" | "ledger" | "audit" | "config";

/* ---------- shared primitives ---------- */
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): ReactElement {
  return (
    <div className="rounded-2xl" style={{ background: "var(--card)", border: `1px solid ${BORDER}`, ...style }}>
      {children}
    </div>
  );
}

function Pill({ bg, color, children }: { bg: string; color: string; children: ReactNode }): ReactElement {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full"
      style={{ background: bg, color, padding: "3px 9px", fontSize: 11, fontWeight: 700, letterSpacing: 0.2 }}
    >
      {children}
    </span>
  );
}

const thStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: MUTED,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  textAlign: "left",
  padding: "10px 16px",
  borderBottom: `1px solid ${BORDER}`,
};

/* ====================================================================== */
export function Finance(): ReactElement {
  const [tab, setTab] = useState<TabKey>("overview");
  const [error, setError] = useState<string | null>(null);

  // data
  const [funds, setFunds] = useState<FundSummary[]>([]);
  const [trend, setTrend] = useState<FinanceTrendPoint[]>([]);
  const [txns, setTxns] = useState<TransactionRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [audit, setAudit] = useState<FinanceAuditRow[]>([]);
  const [config, setConfig] = useState<FinanceConfig | null>(null);

  // transactions filters
  const [search, setSearch] = useState("");
  const [fundFilter, setFundFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  // audit filter
  const [auditActor, setAuditActor] = useState<"All" | "System" | "Admin">("All");

  // overlays
  const [reconcileOpen, setReconcileOpen] = useState(false);
  const [detail, setDetail] = useState<TransactionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  /* ---------- loaders ---------- */
  const loadTxns = useCallback(async () => {
    try {
      const q: { fund?: string; status?: string } = {};
      if (fundFilter !== "All") q.fund = fundFilter;
      if (statusFilter !== "All") q.status = statusFilter;
      const r = await ConfigApi.transactions(q);
      setTxns(r.data);
    } catch (e) {
      setError(errorMessage(e, "Could not load transactions."));
    }
  }, [fundFilter, statusFilter]);

  const loadAudit = useCallback(async () => {
    try {
      const rows = await ConfigApi.financeAudit({ actor: auditActor, limit: 100 });
      setAudit(rows);
    } catch (e) {
      setError(errorMessage(e, "Could not load the audit trail."));
    }
  }, [auditActor]);

  useEffect(() => {
    void ConfigApi.financeSummary()
      .then((r) => setFunds(r.funds))
      .catch((e) => setError(errorMessage(e, "Could not load funds.")));
    void ConfigApi.financeTrend(6).then(setTrend).catch(() => {});
    void ConfigApi.ledger(200).then(setLedger).catch(() => {});
    void ConfigApi.financeConfig().then(setConfig).catch(() => {});
  }, []);
  useEffect(() => {
    void loadTxns();
  }, [loadTxns]);
  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const openDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const d = await ConfigApi.transactionDetail(id);
      setDetail(d);
    } catch (e) {
      setError(errorMessage(e, "Could not load transaction detail."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /* ---------- derived ---------- */
  const currency = funds[0]?.currency ?? "KES";
  const monthTotal = funds.reduce((s, f) => s + f.month_minor, 0);
  const allTotal = funds.reduce((s, f) => s + f.total_minor, 0);
  const giftCount = funds.reduce((s, f) => s + f.gift_count, 0);

  const donut = useMemo(
    () =>
      funds
        .filter((f) => f.month_minor > 0)
        .map((f, i) => ({ name: f.name, value: Math.round(f.month_minor / 100), color: TONES[i % TONES.length] as string })),
    [funds],
  );

  const trendPoints = useMemo(
    () => trend.map((t) => ({ m: t.m, value: Math.round(t.total_minor / 100) })),
    [trend],
  );

  const visibleTxns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter((t) =>
      `${t.full_name ?? ""} ${t.fund ?? ""} ${Math.round(t.amount_minor / 100)} ${t.transaction_id}`
        .toLowerCase()
        .includes(q),
    );
  }, [txns, search]);

  const debitTotal = ledger.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount_minor, 0);
  const creditTotal = ledger.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount_minor, 0);

  /* ---------- header ---------- */
  const tabs: { key: TabKey; label: string; locked?: boolean }[] = [
    { key: "overview", label: "Overview" },
    { key: "transactions", label: "Transactions" },
    { key: "ledger", label: "Ledger" },
    { key: "audit", label: "Audit" },
    { key: "config", label: "Configuration", locked: true },
  ];

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      {/* hero */}
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div
            className="flex items-center gap-1.5"
            style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}
          >
            <span>Operations</span>
            <ChevronRight size={10} />
            <span style={{ color: "#fff", fontWeight: 600 }}>Finance — Giving Ledger</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5"
              style={{
                height: 32,
                background: "rgba(245,199,126,0.14)",
                color: "#F5C77E",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                border: "1px solid rgba(245,199,126,0.25)",
              }}
            >
              <ShieldCheck size={11} /> Audit-protected
            </span>
            <button
              onClick={() => setReconcileOpen(true)}
              className="flex items-center gap-2 rounded-lg px-3"
              style={{
                height: 32,
                background: "rgba(255,255,255,0.08)",
                color: "#fff",
                border: "1px solid rgba(255,255,255,0.15)",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <RefreshCw size={13} /> Reconcile
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 rounded-lg px-3"
              style={{
                height: 32,
                background: "var(--nuru-gold)",
                color: "#fff",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                boxShadow: "0 6px 18px rgba(200,155,60,0.32)",
              }}
            >
              <Download size={13} /> Export Report
            </button>
          </div>
        </div>
        <h1
          style={{
            fontFamily: DISPLAY,
            color: "#fff",
            fontSize: 24,
            lineHeight: 1.05,
            marginTop: 16,
            letterSpacing: "-0.015em",
          }}
        >
          Finance
        </h1>
        <div
          className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}
        >
          {[
            { label: "This month", value: money(monthTotal, currency), hint: `${giftCount} gifts` },
            { label: "All time", value: money(allTotal, currency), hint: "across funds" },
            { label: "Funds", value: String(funds.length), hint: "active" },
            { label: "Gifts", value: String(giftCount), hint: "received" },
          ].map((item, idx) => (
            <div
              key={item.label}
              style={{
                padding: "14px 20px",
                borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none",
                borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none",
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  color: "rgba(232,239,245,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {item.label}
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* tab bar */}
      <div style={{ padding: "0 clamp(16px,4vw,48px)", background: "var(--background)" }}>
        <div style={{ display: "flex", gap: 4, borderBottom: `1px solid ${BORDER}`, overflowX: "auto" }}>
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  padding: "12px 16px",
                  border: "none",
                  background: "transparent",
                  color: active ? NAVY : MUTED,
                  fontSize: 14,
                  fontWeight: active ? 700 : 500,
                  borderBottom: active ? `2px solid ${GOLD}` : "2px solid transparent",
                  marginBottom: -1,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 7,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {t.locked ? <Lock size={13} /> : null}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}

        {tab === "overview" && (
          <OverviewTab
            funds={funds}
            currency={currency}
            donut={donut}
            trendPoints={trendPoints}
            monthTotal={monthTotal}
            allTotal={allTotal}
            giftCount={giftCount}
          />
        )}

        {tab === "transactions" && (
          <TransactionsTab
            txns={visibleTxns}
            funds={funds}
            search={search}
            setSearch={setSearch}
            fundFilter={fundFilter}
            setFundFilter={setFundFilter}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            onView={(id) => void openDetail(id)}
          />
        )}

        {tab === "ledger" && <LedgerTab ledger={ledger} debitTotal={debitTotal} creditTotal={creditTotal} currency={currency} />}

        {tab === "audit" && <AuditTab audit={audit} actor={auditActor} setActor={setAuditActor} />}

        {tab === "config" && <ConfigTab config={config} />}
      </div>

      {/* overlays */}
      {(detail || detailLoading) && (
        <TxDrawer
          detail={detail}
          loading={detailLoading}
          onClose={() => {
            setDetail(null);
            setDetailLoading(false);
          }}
          onViewLedger={() => {
            setDetail(null);
            setDetailLoading(false);
            setTab("ledger");
          }}
        />
      )}
      {reconcileOpen && <ReconcileDrawer onClose={() => setReconcileOpen(false)} />}
    </div>
  );
}

/* ====================== OVERVIEW ====================== */
function OverviewTab({
  funds,
  currency,
  donut,
  trendPoints,
  monthTotal,
  allTotal,
  giftCount,
}: {
  funds: FundSummary[];
  currency: string;
  donut: { name: string; value: number; color: string }[];
  trendPoints: { m: string; value: number }[];
  monthTotal: number;
  allTotal: number;
  giftCount: number;
}): ReactElement {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* fund cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 nuru-card-rotate">
        {funds.map((f, i) => {
          const tone = TONES[i % TONES.length] as string;
          return (
            <div key={f.code} className="rounded-2xl" style={{ background: "var(--card)", border: `1px solid ${BORDER}`, padding: "16px 18px" }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center justify-center rounded-lg" style={{ width: 34, height: 34, background: `${tone}18`, color: tone }}>
                  <Wallet size={16} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>{f.gift_count} gifts</span>
              </div>
              <div className="nuru-eyebrow" style={{ marginBottom: 4 }}>{f.name}</div>
              <div style={{ fontFamily: DISPLAY, color: NAVY, fontSize: 24, lineHeight: 1 }}>{money(f.total_minor, f.currency)}</div>
              <div style={{ fontSize: 11.5, color: MUTED, marginTop: 6 }}>{money(f.month_minor, f.currency)} this month</div>
            </div>
          );
        })}
        {funds.length === 0 ? <p style={{ color: MUTED, fontSize: 13 }}>No funds configured.</p> : null}
      </div>

      {/* trend + donut */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card style={{ padding: "18px 20px", gridColumn: "auto" }}>
          <h3 className="nuru-section-title" style={{ marginBottom: 2 }}>Monthly giving</h3>
          <p style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>Last 6 months · {currency}</p>
          <div style={{ height: 220, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <LineChart data={trendPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="m" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6B7280", fontFamily: "DM Mono" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  formatter={(v) => `${currency} ${Number(v).toLocaleString()}`}
                  contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${BORDER}` }}
                />
                <Line type="monotone" dataKey="value" stroke="#C89B3C" strokeWidth={2.5} dot={{ r: 3, fill: "#C89B3C" }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card style={{ padding: "18px 20px" }}>
          <h3 className="nuru-section-title" style={{ marginBottom: 2 }}>Giving by fund</h3>
          <p style={{ fontSize: 11.5, color: MUTED, marginBottom: 12 }}>This month · {currency}</p>
          <div style={{ height: 180, minWidth: 0 }}>
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie data={donut} dataKey="value" innerRadius={48} outerRadius={74} paddingAngle={2} stroke="none">
                  {donut.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => `${currency} ${Number(v).toLocaleString()}`}
                  contentStyle={{ borderRadius: 10, border: `1px solid ${BORDER}`, fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-1.5 mt-2">
            {donut.map((d) => (
              <div key={d.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2" style={{ fontSize: 12, color: NAVY, fontWeight: 600 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 99, background: d.color }} /> {d.name}
                </span>
                <span style={{ fontSize: 12, color: MUTED, fontFamily: MONO }}>
                  {currency} {d.value.toLocaleString()}
                </span>
              </div>
            ))}
            {donut.length === 0 ? <span style={{ fontSize: 12, color: MUTED }}>No giving this month yet.</span> : null}
          </div>
        </Card>

        <Card style={{ padding: "18px 20px" }}>
          <h3 className="nuru-section-title" style={{ marginBottom: 12 }}>Summary</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { label: "This month", value: money(monthTotal, currency) },
              { label: "All time", value: money(allTotal, currency) },
              { label: "Funds", value: String(funds.length) },
              { label: "Gifts", value: String(giftCount) },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: 12.5, color: MUTED }}>{s.label}</span>
                <span style={{ fontFamily: DISPLAY, fontSize: 18, color: NAVY }}>{s.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ====================== TRANSACTIONS ====================== */
function TransactionsTab({
  txns,
  funds,
  search,
  setSearch,
  fundFilter,
  setFundFilter,
  statusFilter,
  setStatusFilter,
  onView,
}: {
  txns: TransactionRow[];
  funds: FundSummary[];
  search: string;
  setSearch: (v: string) => void;
  fundFilter: string;
  setFundFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  onView: (id: string) => void;
}): ReactElement {
  const selectStyle: CSSProperties = {
    height: 34,
    padding: "0 28px 0 12px",
    background: "var(--card)",
    border: `1px solid ${BORDER}`,
    borderRadius: 10,
    fontSize: 13,
    color: NAVY,
    appearance: "none",
  };
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div className="nuru-section-title">Recent transactions</div>
          <div style={{ fontSize: 12, color: MUTED }}>Every confirmed gift links to a balanced ledger entry.</div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div style={{ position: "relative" }}>
            <Search size={14} color="#6B7280" style={{ position: "absolute", left: 10, top: 10 }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search member, fund, amount, reference"
              style={{ height: 34, padding: "0 12px 0 30px", background: "var(--input-background)", border: `1px solid ${BORDER}`, borderRadius: 10, width: 260, fontSize: 13 }}
            />
          </div>
          <select value={fundFilter} onChange={(e) => setFundFilter(e.target.value)} style={selectStyle}>
            <option value="All">Fund: All</option>
            {funds.map((f) => (
              <option key={f.code} value={f.code}>
                Fund: {f.name}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            {STATUS_FILTERS.map((s) => (
              <option key={s.value} value={s.value}>
                Status: {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg"
            style={{ height: 34, padding: "0 12px", background: NAVY, color: "#fff", fontSize: 13, fontWeight: 600, border: "none" }}
          >
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--secondary)" }}>
              {["Date", "Member", "Fund", "Amount", "Payment Status", "Ledger Status", "Reference", "Action"].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => {
              const sc = statusChip[t.status] ?? statusChip.pending!;
              const lc = ledgerStatus(t.status);
              return (
                <tr key={t.transaction_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: NAVY, fontFamily: MONO }}>{fmtDate(t.created_at)}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: NAVY }}>{t.full_name ?? "Anonymous"}</td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: MUTED }}>{t.fund ?? "—"}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: MONO }}>{money(t.amount_minor, t.currency)}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", ...sc }}>
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ padding: "10px 16px" }}>
                    <Pill bg={lc.bg} color={lc.color}>{lc.label}</Pill>
                  </td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: MUTED, fontFamily: MONO }}>{shortRef(t.transaction_id)}</td>
                  <td style={{ padding: "10px 16px" }}>
                    <button
                      onClick={() => onView(t.transaction_id)}
                      style={{ padding: "6px 12px", background: "var(--card)", color: NAVY, borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1px solid ${BORDER}` }}
                    >
                      View
                    </button>
                  </td>
                </tr>
              );
            })}
            {txns.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                  No transactions match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ====================== LEDGER ====================== */
function LedgerTab({
  ledger,
  debitTotal,
  creditTotal,
  currency,
}: {
  ledger: LedgerRow[];
  debitTotal: number;
  creditTotal: number;
  currency: string;
}): ReactElement {
  const balanced = debitTotal === creditTotal;
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="nuru-section-title">Double-entry ledger</div>
        <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: MUTED }}>
          <ShieldCheck size={13} style={{ color: "#16A34A" }} /> Server-authoritative · verified webhooks only
        </span>
      </div>

      <div
        className="flex items-center gap-5 flex-wrap"
        style={{ padding: "14px 20px", background: "#E8F6EC", borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <div style={{ fontSize: 10.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700 }}>Debits</div>
          <div style={{ fontFamily: MONO, fontWeight: 700, color: NAVY, fontSize: 18 }}>{money(debitTotal, currency)}</div>
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: "#16A34A33" }} />
        <div>
          <div style={{ fontSize: 10.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.7, fontWeight: 700 }}>Credits</div>
          <div style={{ fontFamily: MONO, fontWeight: 700, color: NAVY, fontSize: 18 }}>{money(creditTotal, currency)}</div>
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Pill bg="#fff" color={balanced ? "#0F6B33" : "#A87616"}>
            <CheckCircle2 size={12} /> {balanced ? "Balanced" : "Review"}
          </Pill>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--secondary)" }}>
              {["Account", "Side", "Amount", "When"].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ledger.map((l) => (
              <tr key={l.entry_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ padding: "9px 16px", fontSize: 12.5, fontWeight: 600, color: NAVY }}>{l.account}</td>
                <td style={{ padding: "9px 16px" }}>
                  <span
                    className="rounded px-2 py-0.5"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      background: l.side === "debit" ? "#EEF1F8" : "#E8F6EC",
                      color: l.side === "debit" ? "#1F3A6B" : "#0F6B33",
                    }}
                  >
                    {l.side}
                  </span>
                </td>
                <td style={{ padding: "9px 16px", fontSize: 12.5, fontFamily: MONO, color: "var(--foreground)" }}>{money(l.amount_minor, l.currency)}</td>
                <td style={{ padding: "9px 16px", fontSize: 12, color: MUTED }}>{fmtDateTime(l.created_at)}</td>
              </tr>
            ))}
            {ledger.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                  No ledger entries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ====================== AUDIT ====================== */
function AuditTab({
  audit,
  actor,
  setActor,
}: {
  audit: FinanceAuditRow[];
  actor: "All" | "System" | "Admin";
  setActor: (v: "All" | "System" | "Admin") => void;
}): ReactElement {
  return (
    <Card style={{ overflow: "hidden" }}>
      <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <div className="nuru-section-title">Audit trail</div>
          <div style={{ fontSize: 12, color: MUTED }}>System and admin actions related to finance.</div>
        </div>
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value as "All" | "System" | "Admin")}
          style={{ height: 34, padding: "0 28px 0 12px", background: "var(--card)", border: `1px solid ${BORDER}`, borderRadius: 10, fontSize: 13, color: NAVY, appearance: "none" }}
        >
          {(["All", "System", "Admin"] as const).map((o) => (
            <option key={o} value={o}>
              Actor: {o}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--secondary)" }}>
              {["When", "Action", "Actor", "Type", "Reference"].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.audit_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ padding: "10px 16px", fontSize: 12, color: NAVY, fontFamily: MONO }}>{fmtDateTime(a.occurred_at)}</td>
                <td style={{ padding: "10px 16px", fontSize: 13, color: NAVY }}>{a.action}</td>
                <td style={{ padding: "10px 16px", fontSize: 13, color: NAVY }}>
                  <span className="inline-flex items-center gap-2">
                    {a.actor_type === "System" ? (
                      <span className="inline-flex items-center justify-center rounded" style={{ width: 22, height: 22, background: "#EEF0F3", color: NAVY }}>
                        <Shield size={12} />
                      </span>
                    ) : null}
                    {a.actor_name ?? "System"}
                  </span>
                </td>
                <td style={{ padding: "10px 16px" }}>
                  <Pill
                    bg={a.actor_type === "System" ? "#EEF1F8" : "#F3EAFE"}
                    color={a.actor_type === "System" ? "#1F3A6B" : "#7C3AED"}
                  >
                    {a.actor_type}
                  </Pill>
                </td>
                <td style={{ padding: "10px 16px", fontSize: 12, color: MUTED, fontFamily: MONO }}>{a.entity_id ?? "—"}</td>
              </tr>
            ))}
            {audit.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                  No audit events.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ====================== CONFIGURATION (read-only) ====================== */
function ConfigTab({ config }: { config: FinanceConfig | null }): ReactElement {
  if (!config) {
    return (
      <Card style={{ padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 13, color: MUTED }}>Loading configuration…</p>
      </Card>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card
        style={{
          background: "#FFF6E0",
          border: "1px solid rgba(200,155,60,0.25)",
          padding: "12px 18px",
          display: "flex",
          gap: 10,
          alignItems: "flex-start",
        }}
      >
        <ShieldCheck size={16} style={{ color: "#C89B3C", marginTop: 1, flexShrink: 0 }} />
        <div style={{ fontSize: 13, color: "#5A4A22" }}>
          <span style={{ fontWeight: 700, color: NAVY }}>Step-up MFA is required to change financial configuration</span> — managed by your
          administrator. Provider secrets are configured server-side and never shown here.
        </div>
      </Card>

      <Card style={{ overflow: "hidden" }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="nuru-section-title">Funds</div>
          <div style={{ fontSize: 12, color: MUTED }}>Giving funds configured for this organization.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--secondary)" }}>
                {["Fund", "Code", "Status"].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.funds.map((f) => (
                <tr key={f.code} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: NAVY }}>{f.name}</td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: MUTED, fontFamily: MONO }}>{f.code}</td>
                  <td style={{ padding: "10px 16px" }}>
                    {f.is_active ? (
                      <Pill bg="#E8F6EC" color="#0F6B33">
                        <CheckCircle2 size={12} /> Active
                      </Pill>
                    ) : (
                      <Pill bg="#EEF0F3" color="#6B7280">
                        Inactive
                      </Pill>
                    )}
                  </td>
                </tr>
              ))}
              {config.funds.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
                    No funds configured.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>

      <Card style={{ padding: "18px 20px" }}>
        <div className="nuru-section-title" style={{ marginBottom: 4 }}>Payment providers</div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>Connections are managed server-side. Secrets are never displayed.</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {config.providers.map((p) => (
            <div
              key={p.key}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${BORDER}` }}
            >
              <span style={{ fontSize: 13, color: NAVY, fontWeight: 600 }}>{p.label}</span>
              {p.enabled ? (
                <Pill bg="#E8F6EC" color="#0F6B33">
                  <CheckCircle2 size={12} /> Connected
                </Pill>
              ) : (
                <Pill bg="#EEF0F3" color="#6B7280">
                  Not configured
                </Pill>
              )}
            </div>
          ))}
          {config.providers.length === 0 ? <span style={{ fontSize: 13, color: MUTED }}>No providers configured.</span> : null}
        </div>
      </Card>
    </div>
  );
}

/* ====================== DRAWERS ====================== */
function DrawerShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}): ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(7,22,41,0.42)" }} />
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(520px, 100vw)",
          maxWidth: "100vw",
          background: "var(--card)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-20px 0 50px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ padding: "18px 22px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: DISPLAY, fontSize: 20, color: NAVY }}>{title}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: MUTED, padding: 4 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 22 }}>{children}</div>
        {footer ? (
          <div style={{ borderTop: `1px solid ${BORDER}`, padding: 16, display: "flex", gap: 8, justifyContent: "flex-end" }}>{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

function TxDrawer({
  detail,
  loading,
  onClose,
  onViewLedger,
}: {
  detail: TransactionDetail | null;
  loading: boolean;
  onClose: () => void;
  onViewLedger: () => void;
}): ReactElement {
  const cellStyle: CSSProperties = { padding: 12, background: "var(--input-background)", borderRadius: 10 };
  const labelStyle: CSSProperties = { fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, fontWeight: 600, marginBottom: 6 };

  if (loading || !detail) {
    return (
      <DrawerShell title="Transaction Details" onClose={onClose}>
        <p style={{ fontSize: 13, color: MUTED }}>Loading transaction…</p>
      </DrawerShell>
    );
  }

  const t = detail.transaction;
  const sc = statusChip[t.status] ?? statusChip.pending!;
  const lc = ledgerStatus(t.status);

  return (
    <DrawerShell
      title="Transaction Details"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} style={{ padding: "9px 14px", border: `1px solid ${BORDER}`, background: "var(--card)", borderRadius: 10, fontSize: 13, fontWeight: 600, color: NAVY }}>
            Close
          </button>
          <button
            onClick={onViewLedger}
            className="inline-flex items-center gap-1.5"
            style={{ padding: "9px 14px", background: NAVY, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 600 }}
          >
            View in ledger <ArrowRight size={13} />
          </button>
        </>
      }
    >
      <div>
        <div style={{ fontSize: 16, color: NAVY, fontWeight: 700 }}>{t.full_name ?? "Anonymous"}</div>
        <div style={{ fontFamily: MONO, fontSize: 24, color: NAVY, fontWeight: 600, marginTop: 2 }}>{money(t.amount_minor, t.currency)}</div>
      </div>

      <div style={{ marginTop: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div style={cellStyle}>
          <div style={labelStyle}>Fund</div>
          <div style={{ fontSize: 13, color: NAVY }}>{t.fund_name ?? t.fund ?? "—"}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Method</div>
          <div style={{ fontSize: 13, color: NAVY }}>{methodLabel(t.method)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Payment status</div>
          <span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", ...sc }}>
            {t.status.replace(/_/g, " ")}
          </span>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Ledger status</div>
          <Pill bg={lc.bg} color={lc.color}>{lc.label}</Pill>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Created</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY }}>{fmtDateTime(t.created_at)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Settled</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY }}>{fmtDateTime(t.settled_at)}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Reference</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, wordBreak: "break-all" }}>{t.transaction_id}</div>
        </div>
        <div style={cellStyle}>
          <div style={labelStyle}>Provider ref</div>
          <div style={{ fontFamily: MONO, fontSize: 12, color: NAVY, wordBreak: "break-all" }}>{t.provider_ref ?? t.stripe_payment_intent ?? "—"}</div>
        </div>
      </div>

      <div style={{ marginTop: 22 }}>
        <div style={{ fontFamily: DISPLAY, fontSize: 16, color: NAVY, marginBottom: 10 }}>Ledger postings</div>
        <div style={{ border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden", overflowX: "auto" }}>
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "var(--secondary)" }}>
                {["Account", "Side", "Amount"].map((h) => (
                  <th key={h} style={{ ...thStyle, padding: "8px 12px" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.ledger_entries.map((l) => (
                <tr key={l.entry_id} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ padding: "8px 12px", fontSize: 12.5, color: NAVY, fontWeight: 600 }}>{l.account}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      className="rounded px-2 py-0.5"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        background: l.side === "debit" ? "#EEF1F8" : "#E8F6EC",
                        color: l.side === "debit" ? "#1F3A6B" : "#0F6B33",
                      }}
                    >
                      {l.side}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", fontSize: 12.5, fontFamily: MONO, color: NAVY }}>{money(l.amount_minor, l.currency)}</td>
                </tr>
              ))}
              {detail.ledger_entries.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ padding: "16px 12px", textAlign: "center", fontSize: 12.5, color: MUTED }}>
                    No ledger postings — payment not yet confirmed.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </DrawerShell>
  );
}

function ReconcileDrawer({ onClose }: { onClose: () => void }): ReactElement {
  return (
    <DrawerShell
      title="Reconciliation"
      onClose={onClose}
      footer={
        <button onClick={onClose} style={{ padding: "9px 14px", background: NAVY, color: "#fff", borderRadius: 10, fontSize: 13, fontWeight: 600 }}>
          Close
        </button>
      }
    >
      <div
        style={{ padding: 14, background: "#E8F6EC", borderRadius: 12, border: "1px solid #16A34A22", display: "flex", gap: 10, alignItems: "flex-start" }}
      >
        <ShieldCheck size={18} style={{ color: "#16A34A", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 13, color: "#1B4332" }}>
          <span style={{ fontWeight: 700 }}>The ledger is auto-reconciled.</span> Balanced double-entry postings are created automatically when —
          and only when — a verified payment webhook is received from the provider.
        </div>
      </div>

      <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: NAVY }}>
        <p style={{ color: MUTED }}>
          This panel is informational. There is no manual reconcile action: the system is server-authoritative, so there is nothing for an admin to
          post, edit, or true up by hand.
        </p>
        <ul style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 18, listStyle: "disc", color: MUTED }}>
          <li>Confirmed payments post balanced debit/credit entries.</li>
          <li>Refunds create reversal entries rather than editing history (append-only).</li>
          <li>Pending or failed payments never touch the ledger.</li>
        </ul>
      </div>
    </DrawerShell>
  );
}

export default Finance;
