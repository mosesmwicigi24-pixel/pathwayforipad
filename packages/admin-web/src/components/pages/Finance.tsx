// Finance — Giving Ledger console, ported to the iPad app's Finance design (the
// native iPad surface has design precedence). A 5-tab read-only reporting surface
// (Overview / Transactions / Ledger / Audit / Configuration), wired to the live
// finance reads in ConfigApi. Money is integer minor units + ISO currency. This
// page is read-only: it issues no writes, no payment actions, and shows no secrets
// — cards never touch the server and config is informational only (PCI SAQ-A,
// §5.6; step-up MFA is administrator-managed).
//
// Visual/design port only — data fetching, tabs, transaction-detail/reconcile
// drawers, and wiring are unchanged. Palette: brand green/gold/navy + pastel tint
// tokens from index.css; no off-brand blue; Manrope/DM-Serif fonts kept.
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
  AlertTriangle,
  ArrowRight,
  Banknote,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Clock,
  CreditCard,
  Download,
  Gift,
  Hash,
  Hourglass,
  Inbox,
  Layers,
  ListChecks,
  Lock,
  MinusCircle,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  Smartphone,
  TrendingUp,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
const GREEN = "var(--nuru-green)";
const MUTED = "var(--muted-foreground)";
const BORDER = "var(--border)";
const SURFACE = "var(--secondary)";
const DISPLAY = "var(--font-display)";
const MONO = "var(--font-mono)";
const INK400 = "#9aa3af";
// Fund / donut palette — brand-aligned, no off-brand blue (mirrors the iPad FinanceTone palette).
const TONES = ["#C89B3C", "#16A34A", "#1D4E86", "#7C3AED", "#0D9488", "#B45309"];

// Pastel tint pairs (bg / deeper fg) for tinted icon chips + cards — mirrors the
// iPad KPI palette and the index.css --tint-* tokens.
type Tint = { bg: string; fg: string };
const TINT_GREEN: Tint = { bg: "#E8F6EE", fg: "#0F6B33" };
const TINT_GOLD: Tint = { bg: "#FDF5E5", fg: "#8A6B1F" };
const TINT_VIOLET: Tint = { bg: "#F3EAFE", fg: "#6D28D9" };
const TINT_NAVY: Tint = { bg: "#E3EAF3", fg: "#1D4E86" };
const TINT_TEAL: Tint = { bg: "#E2F4F1", fg: "#0D7E73" };
const TINT_AMBER: Tint = { bg: "#FFF4DA", fg: "#A87616" };
const TINT_RED: Tint = { bg: "#FDECEC", fg: "#B42318" };
// Rotating soft fills for fund cards.
const FUND_TINTS: Tint[] = [TINT_GOLD, TINT_GREEN, TINT_NAVY, TINT_VIOLET, TINT_TEAL, TINT_AMBER];

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

const isPendingStatus = (s: string): boolean =>
  s === "requires_action" || s === "processing" || s === "pending";
const isFailedStatus = (s: string): boolean => s === "failed" || s === "refunded";

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

/* ---------- payment channels (real: cash:* ledger debits + method-grouped txns) ---------- */
type Channel = {
  id: string; // method value
  label: string;
  cashAccount: string; // ledger account whose debit total = money received by that channel
  key: string; // solid brand color for the leading icon chip
  icon: ReactNode;
};
const CHANNELS: Channel[] = [
  { id: "mpesa", label: "M-Pesa", cashAccount: "cash:mpesa", key: "#0F6B33", icon: <Smartphone size={15} /> },
  { id: "airtel", label: "Airtel", cashAccount: "cash:airtel", key: "#B42318", icon: <Smartphone size={15} /> },
  { id: "paypal", label: "PayPal", cashAccount: "cash:paypal", key: "#1D4E86", icon: <Wallet size={15} /> },
  { id: "card", label: "Card", cashAccount: "cash:stripe", key: "#8A6B1F", icon: <CreditCard size={15} /> },
];

type ChannelStat = {
  channel: Channel;
  receivedMinor: number;
  currency: string;
  count: number;
  succeeded: number;
  pending: number;
  failed: number;
  enabled: boolean | null;
};

function computeChannelStats(
  ledger: LedgerRow[],
  txns: TransactionRow[],
  config: FinanceConfig | null,
): ChannelStat[] {
  return CHANNELS.map((ch) => {
    const s: ChannelStat = {
      channel: ch,
      receivedMinor: 0,
      currency: "KES",
      count: 0,
      succeeded: 0,
      pending: 0,
      failed: 0,
      enabled: null,
    };
    for (const l of ledger) {
      if (l.account === ch.cashAccount && l.side === "debit") {
        s.receivedMinor += l.amount_minor;
        if (l.currency) s.currency = l.currency;
      }
    }
    for (const t of txns) {
      if (t.method === ch.id) {
        s.count += 1;
        if (isFailedStatus(t.status)) s.failed += 1;
        else if (isPendingStatus(t.status)) s.pending += 1;
        else s.succeeded += 1;
      }
    }
    if (config?.providers) {
      const keys = ch.id === "card" ? new Set(["card", "stripe"]) : new Set([ch.id]);
      const p = config.providers.find((pr) => keys.has(pr.key));
      if (p) s.enabled = p.enabled;
    }
    return s;
  });
}

/* ---------- shared primitives ---------- */
function Card({ children, style }: { children: ReactNode; style?: CSSProperties }): ReactElement {
  return (
    <div
      className="rounded-2xl"
      style={{
        background: "var(--card)",
        border: `1px solid ${BORDER}`,
        boxShadow: "0 1px 3px rgba(11,31,51,0.05)",
        ...style,
      }}
    >
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

// Rounded tinted icon chip (mirrors the iPad TintedIcon).
function TintedIcon({ tint, size = 30, children }: { tint: Tint; size?: number; children: ReactNode }): ReactElement {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: tint.bg, color: tint.fg, flexShrink: 0 }}
    >
      {children}
    </span>
  );
}
function KeyIcon({ color, size = 30, children }: { color: string; size?: number; children: ReactNode }): ReactElement {
  return (
    <span
      className="inline-flex items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: `${color}1F`, color, flexShrink: 0 }}
    >
      {children}
    </span>
  );
}

// Honest placeholder for data the backend doesn't expose yet.
function NotTracked({ text }: { text: string }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: INK400 }}>
      <MinusCircle size={11} /> {text}
    </span>
  );
}

// Tidy card header: small icon + serif-weight title + right-aligned caption.
function CardHeader({ icon, title, caption }: { icon: ReactNode; title: string; caption?: string }): ReactElement {
  return (
    <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
      <span style={{ color: NAVY, display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: NAVY }}>{title}</span>
      {caption ? <span style={{ marginLeft: "auto", fontSize: 11, color: MUTED }}>{caption}</span> : null}
    </div>
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
  // Dominant currency = the one carrying the most all-time giving.
  const currency = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const f of funds) totals[f.currency ?? "KES"] = (totals[f.currency ?? "KES"] ?? 0) + f.total_minor;
    let best: string | null = null;
    let bestV = -1;
    for (const [k, v] of Object.entries(totals))
      if (v > bestV) {
        best = k;
        bestV = v;
      }
    return best ?? funds[0]?.currency ?? "KES";
  }, [funds]);

  const monthTotal = funds.reduce((s, f) => s + f.month_minor, 0);
  const allTotal = funds.reduce((s, f) => s + f.total_minor, 0);
  const giftCount = funds.reduce((s, f) => s + f.gift_count, 0);
  const avgGift = giftCount > 0 ? Math.round(allTotal / giftCount) : 0;
  const activeFundCount = funds.filter((f) => f.total_minor > 0).length;

  const pendingCount = useMemo(() => txns.filter((t) => isPendingStatus(t.status)).length, [txns]);
  const failedCount = useMemo(() => txns.filter((t) => isFailedStatus(t.status)).length, [txns]);

  const channelStats = useMemo(() => computeChannelStats(ledger, txns, config), [ledger, txns, config]);

  const donut = useMemo(
    () =>
      funds
        .filter((f) => f.month_minor > 0)
        .map((f, i) => ({ name: f.name, value: Math.round(f.month_minor / 100), color: TONES[i % TONES.length] as string })),
    [funds],
  );

  // Giving by payment method — from the ledger cash:* debit totals (real money received).
  const methodSlices = useMemo(
    () =>
      channelStats
        .filter((c) => c.receivedMinor > 0)
        .map((c) => ({ name: c.channel.label, value: Math.round(c.receivedMinor / 100), color: c.channel.key })),
    [channelStats],
  );

  const trendPoints = useMemo(
    () => trend.map((t) => ({ m: t.m, value: Math.round(t.total_minor / 100) })),
    [trend],
  );

  const visibleTxns = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return txns;
    return txns.filter((t) =>
      `${t.full_name ?? ""} ${t.fund ?? ""} ${methodLabel(t.method)} ${Math.round(t.amount_minor / 100)} ${t.transaction_id}`
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
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 mt-4 rounded-xl"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}
        >
          {[
            { label: "This month", value: money(monthTotal, currency), hint: `${giftCount} gifts` },
            { label: "All time", value: money(allTotal, currency), hint: "across funds" },
            { label: "Avg gift", value: money(avgGift, currency), hint: "per gift" },
            { label: "Funds", value: String(activeFundCount), hint: "active" },
            { label: "Gifts", value: String(giftCount), hint: "received" },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                padding: "14px 18px",
                borderRight: "1px solid rgba(255,255,255,0.07)",
                borderBottom: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "rgba(232,239,245,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                {item.label}
              </div>
              <div style={{ fontFamily: DISPLAY, fontSize: 18, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
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
            methodSlices={methodSlices}
            trendPoints={trendPoints}
            channelStats={channelStats}
            monthTotal={monthTotal}
            allTotal={allTotal}
            giftCount={giftCount}
            avgGift={avgGift}
            activeFundCount={activeFundCount}
            pendingCount={pendingCount}
            failedCount={failedCount}
            txnCount={txns.length}
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
  methodSlices,
  trendPoints,
  channelStats,
  monthTotal,
  allTotal,
  giftCount,
  avgGift,
  activeFundCount,
  pendingCount,
  failedCount,
  txnCount,
}: {
  funds: FundSummary[];
  currency: string;
  donut: { name: string; value: number; color: string }[];
  methodSlices: { name: string; value: number; color: string }[];
  trendPoints: { m: string; value: number }[];
  channelStats: ChannelStat[];
  monthTotal: number;
  allTotal: number;
  giftCount: number;
  avgGift: number;
  activeFundCount: number;
  pendingCount: number;
  failedCount: number;
  txnCount: number;
}): ReactElement {
  /* 1 — KPI summary table (premium table inside a white card) */
  const kpiRows: { name: string; sub: string; value: string; icon: ReactNode; tint: Tint }[] = [
    { name: "This Month Received", sub: "this term", value: money(monthTotal, currency), icon: <Banknote size={15} />, tint: TINT_GREEN },
    { name: "All-Time Giving", sub: "across funds", value: money(allTotal, currency), icon: <TrendingUp size={15} />, tint: TINT_GOLD },
    { name: "Average Gift", sub: "per gift", value: money(avgGift, currency), icon: <Gift size={15} />, tint: TINT_VIOLET },
    { name: "Total Gifts", sub: "received", value: giftCount.toLocaleString(), icon: <Hash size={15} />, tint: TINT_NAVY },
    { name: "Active Funds", sub: "with giving", value: activeFundCount.toLocaleString(), icon: <Inbox size={15} />, tint: TINT_TEAL },
    { name: "Pending", sub: "in recent page", value: pendingCount.toLocaleString(), icon: <Clock size={15} />, tint: TINT_AMBER },
    { name: "Failed / Refunded", sub: "in recent page", value: failedCount.toLocaleString(), icon: <AlertTriangle size={15} />, tint: TINT_RED },
  ];

  /* 1b — transaction-status pipeline tiles */
  const succeeded = Math.max(0, txnCount - pendingCount - failedCount);
  const statusTiles: { label: string; value: number; icon: ReactNode; tint: Tint }[] = [
    { label: "Succeeded", value: succeeded, icon: <CheckCircle2 size={15} />, tint: TINT_GREEN },
    { label: "Pending", value: pendingCount, icon: <Clock size={15} />, tint: TINT_AMBER },
    { label: "Failed", value: failedCount, icon: <AlertTriangle size={15} />, tint: TINT_RED },
    { label: "In page", value: txnCount, icon: <Inbox size={15} />, tint: TINT_NAVY },
  ];

  const sortedFunds = [...funds].sort((a, b) => b.month_minor - a.month_minor);
  const donutTotal = donut.reduce((s, d) => s + d.value, 0);
  const methodTotal = methodSlices.reduce((s, m) => s + m.value, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* 1 — KPI summary table */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Card style={{ overflow: "hidden" }}>
          {/* header band */}
          <div
            className="flex items-center"
            style={{ background: SURFACE, borderBottom: `1px solid ${BORDER}`, padding: "11px 16px" }}
          >
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: MUTED, textTransform: "uppercase", flex: 1 }}>
              Metric
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: MUTED, textTransform: "uppercase", width: 150, textAlign: "right" }}>
              Value
            </span>
          </div>
          {kpiRows.map((r, i) => (
            <div
              key={r.name}
              className="flex items-center gap-3"
              style={{
                minHeight: 52,
                padding: "0 16px",
                borderTop: i === 0 ? "none" : `1px solid ${BORDER}`,
                background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent",
              }}
            >
              <TintedIcon tint={r.tint}>{r.icon}</TintedIcon>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{r.name}</div>
                <div style={{ fontSize: 11, color: INK400 }}>{r.sub}</div>
              </div>
              <div style={{ width: 150, textAlign: "right", fontFamily: MONO, fontSize: 15, fontWeight: 600, color: NAVY }}>
                {r.value}
              </div>
            </div>
          ))}
        </Card>
        <span style={{ fontSize: 10.5, color: INK400 }}>
          Pending and failed are counted in the {txnCount} most-recent transactions fetched, not all-time.
        </span>
      </div>

      {/* 1b — transaction status pipeline tiles */}
      <Card style={{ padding: 18 }}>
        <CardHeader icon={<ListChecks size={14} />} title="Transaction status" caption="recent page" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ marginTop: 12 }}>
          {statusTiles.map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-3 rounded-xl"
              style={{ background: t.tint.bg, padding: "12px 14px" }}
            >
              <TintedIcon tint={{ bg: "rgba(255,255,255,0.6)", fg: t.tint.fg }} size={32}>
                {t.icon}
              </TintedIcon>
              <div>
                <div style={{ fontFamily: DISPLAY, fontSize: 22, lineHeight: 1, color: t.tint.fg }}>{t.value}</div>
                <div style={{ fontSize: 11, fontWeight: 600, color: t.tint.fg, opacity: 0.85, marginTop: 3 }}>{t.label}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 2 — payment-channels table */}
      <Card style={{ overflow: "hidden" }}>
        <div style={{ padding: "16px 16px 12px" }}>
          <CardHeader icon={<CreditCard size={14} />} title="Payment channels" caption="received · all-time" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 620 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                <th style={thStyle}>Channel</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Received</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Txns</th>
                <th style={{ ...thStyle, textAlign: "right" }}>OK</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Pend</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Fail</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {channelStats.map((s, i) => {
                const hasData = s.receivedMinor > 0 || s.count > 0;
                return (
                  <tr
                    key={s.channel.id}
                    style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.45)" : "transparent" }}
                  >
                    <td style={{ padding: "12px 16px" }}>
                      <span className="inline-flex items-center gap-2.5">
                        <KeyIcon color={s.channel.key}>{s.channel.icon}</KeyIcon>
                        <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{s.channel.label}</span>
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: MONO, fontSize: 13.5, fontWeight: 600, color: NAVY }}>
                      {hasData ? money(s.receivedMinor, s.currency) : "—"}
                    </td>
                    <td style={chanNum(s.count, MUTED)}>{s.count}</td>
                    <td style={chanNum(s.succeeded, "#0F6B33")}>{s.succeeded}</td>
                    <td style={chanNum(s.pending, "#A87616")}>{s.pending}</td>
                    <td style={chanNum(s.failed, "#B42318")}>{s.failed}</td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      {s.enabled === true ? (
                        <Pill bg="#E8F6EE" color="#0F6B33">
                          <CheckCircle2 size={11} /> Wired
                        </Pill>
                      ) : s.enabled === false ? (
                        <Pill bg="#EEF0F3" color="#6B7280">Not wired</Pill>
                      ) : (
                        <Pill bg="#EEF0F3" color={INK400}>—</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${BORDER}` }}>
          <NotTracked text="Processor fees per channel — not tracked yet" />
        </div>
      </Card>

      {/* 3 — fund cards (soft pastel tinted, % bars) */}
      {funds.length === 0 ? (
        <Card style={{ padding: "16px 18px" }}>
          <span style={{ fontSize: 13, color: MUTED }}>No funds configured.</span>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {sortedFunds.map((f, i) => {
            const tint = FUND_TINTS[i % FUND_TINTS.length] as Tint;
            const pct = allTotal > 0 ? (f.total_minor / allTotal) * 100 : 0;
            const avg = f.gift_count > 0 ? Math.round(f.total_minor / f.gift_count) : 0;
            return (
              <div
                key={f.code}
                className="rounded-2xl"
                style={{ background: tint.bg, border: `1px solid ${tint.fg}2E`, padding: 14 }}
              >
                <div className="flex items-center gap-2.5">
                  <TintedIcon tint={{ bg: "rgba(255,255,255,0.55)", fg: tint.fg }} size={32}>
                    <Banknote size={15} />
                  </TintedIcon>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: NAVY }}>{f.name}</span>
                </div>
                <div style={{ fontFamily: DISPLAY, fontSize: 22, color: NAVY, lineHeight: 1, marginTop: 10 }}>
                  {money(f.month_minor, f.currency)}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>this month</div>

                {/* % of total giving bar */}
                <div style={{ marginTop: 10 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED }}>{Math.round(pct)}% of total</span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: MUTED, fontFamily: MONO }}>
                      {money(f.total_minor, f.currency)}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: "rgba(11,31,51,0.08)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tint.fg, borderRadius: 99 }} />
                  </div>
                </div>

                <div className="flex gap-5" style={{ marginTop: 10 }}>
                  <Metric value={String(f.gift_count)} label="gifts" />
                  <Metric value={money(avg, f.currency)} label="avg" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 4a — monthly giving trend (white card) */}
      <Card style={{ padding: 18 }}>
        <CardHeader icon={<TrendingUp size={14} />} title="Monthly giving trend" caption={`last 6 · ${currency}`} />
        <div style={{ height: 220, minWidth: 0, marginTop: 12 }}>
          {trendPoints.length === 0 ? (
            <EmptyChart text="No giving recorded yet." />
          ) : (
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <AreaChart data={trendPoints} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="finGoldFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C89B3C" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="#C89B3C" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
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
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#C89B3C"
                  strokeWidth={2.5}
                  fill="url(#finGoldFill)"
                  dot={{ r: 3, fill: "#C89B3C" }}
                  activeDot={{ r: 5 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* 4b/4c — giving by fund (donut) + giving by method (bar) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card style={{ padding: 18 }}>
          <CardHeader icon={<PieChartIcon size={14} />} title="Giving by fund" caption={`this month · ${currency}`} />
          {donut.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 13, color: MUTED }}>No giving this month yet.</span>
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-wrap" style={{ marginTop: 14 }}>
              <div style={{ position: "relative", width: 150, height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donut} dataKey="value" innerRadius={46} outerRadius={72} paddingAngle={2} stroke="none">
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
                <div
                  className="flex flex-col items-center justify-center"
                  style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                >
                  <span style={{ fontSize: 9, fontWeight: 600, color: MUTED }}>{currency}</span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{donutTotal.toLocaleString()}</span>
                  <span style={{ fontSize: 9.5, color: INK400 }}>this month</span>
                </div>
              </div>
              <div className="flex flex-col gap-2" style={{ flex: 1, minWidth: 160 }}>
                {donut.map((d) => (
                  <LegendRow key={d.name} name={d.name} value={d.value} color={d.color} total={donutTotal} currency={currency} />
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card style={{ padding: 18 }}>
          <CardHeader icon={<BarChart3 size={14} />} title="Giving by payment method" caption={`all-time · ${currency}`} />
          {methodSlices.length === 0 ? (
            <div style={{ marginTop: 16 }}>
              <span style={{ fontSize: 13, color: MUTED }}>No channel postings yet.</span>
            </div>
          ) : (
            <>
              <div style={{ height: 180, minWidth: 0, marginTop: 12 }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={methodSlices} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis
                      tick={{ fontSize: 11, fill: "#6B7280", fontFamily: "DM Mono" }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      formatter={(v) => `${currency} ${Number(v).toLocaleString()}`}
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: `1px solid ${BORDER}` }}
                      cursor={{ fill: "rgba(11,31,51,0.04)" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {methodSlices.map((m) => (
                        <Cell key={m.name} fill={m.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col gap-2" style={{ marginTop: 12 }}>
                {methodSlices.map((m) => (
                  <LegendRow key={m.name} name={m.name} value={m.value} color={m.color} total={methodTotal} currency={currency} />
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* honest note */}
      <Card style={{ padding: "14px 18px" }}>
        <div className="flex items-start gap-2.5">
          <Hourglass size={15} style={{ color: INK400, marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>
              Expenses &amp; reconciliation — coming with backend support
            </div>
            <div style={{ fontSize: 11.5, color: INK400, marginTop: 2 }}>
              Net-after-fees, expense tracking, and reconciliation variance need data the finance backend doesn't expose
              yet. This page shows only verified giving and ledger postings.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

const chanNum = (n: number, color: string): CSSProperties => ({
  padding: "12px 16px",
  textAlign: "right",
  fontFamily: MONO,
  fontSize: 13,
  fontWeight: 600,
  color: n === 0 ? INK400 : color,
});

function Metric({ value, label }: { value: string; label: string }): ReactElement {
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: NAVY }}>{value}</div>
      <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase", color: INK400, marginTop: 1 }}>
        {label}
      </div>
    </div>
  );
}

function LegendRow({
  name,
  value,
  color,
  total,
  currency,
}: {
  name: string;
  value: number;
  color: string;
  total: number;
  currency: string;
}): ReactElement {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 500, color: NAVY, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {name}
      </span>
      <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: NAVY, fontFamily: MONO }}>
        {currency} {value.toLocaleString()}
      </span>
      <span style={{ width: 34, textAlign: "right", fontSize: 11, color: MUTED }}>{Math.round(pct)}%</span>
    </div>
  );
}

function EmptyChart({ text }: { text: string }): ReactElement {
  return (
    <div className="flex items-center justify-center" style={{ height: "100%", fontSize: 13, color: MUTED }}>
      {text}
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
              placeholder="Search member, fund, method, amount, reference"
              style={{ height: 34, padding: "0 12px 0 30px", background: "var(--input-background)", border: `1px solid ${BORDER}`, borderRadius: 10, width: 280, fontSize: 13 }}
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
        <table className="w-full" style={{ borderCollapse: "collapse", minWidth: 880 }}>
          <thead>
            <tr style={{ background: SURFACE }}>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Member</th>
              <th style={thStyle}>Fund</th>
              <th style={thStyle}>Method</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Amount</th>
              <th style={thStyle}>Payment Status</th>
              <th style={thStyle}>Ledger Status</th>
              <th style={thStyle}>Reference</th>
              <th style={{ ...thStyle, textAlign: "right" }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t, i) => {
              const sc = statusChip[t.status] ?? statusChip.pending!;
              const lc = ledgerStatus(t.status);
              return (
                <tr
                  key={t.transaction_id}
                  style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent" }}
                >
                  <td style={{ padding: "9px 16px", fontSize: 12, color: NAVY, fontFamily: MONO, whiteSpace: "nowrap" }}>{fmtDate(t.created_at)}</td>
                  <td style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, color: NAVY, whiteSpace: "nowrap" }}>{t.full_name ?? "Anonymous"}</td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: MUTED }}>{t.fund ?? "—"}</td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: MUTED }}>{methodLabel(t.method)}</td>
                  <td style={{ padding: "9px 16px", fontSize: 13, fontWeight: 700, color: NAVY, fontFamily: MONO, textAlign: "right", whiteSpace: "nowrap" }}>{money(t.amount_minor, t.currency)}</td>
                  <td style={{ padding: "9px 16px" }}>
                    <span className="rounded-full px-2.5 py-0.5" style={{ fontSize: 11, fontWeight: 700, textTransform: "capitalize", whiteSpace: "nowrap", ...sc }}>
                      {t.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td style={{ padding: "9px 16px" }}>
                    <Pill bg={lc.bg} color={lc.color}>{lc.label}</Pill>
                  </td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: MUTED, fontFamily: MONO }}>{shortRef(t.transaction_id)}</td>
                  <td style={{ padding: "9px 16px", textAlign: "right" }}>
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
                <td colSpan={9} style={{ padding: "24px 16px", textAlign: "center", fontSize: 13, color: MUTED }}>
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
type AccountGroup = { key: string; display: string; debit: number; credit: number };
const FAMILIES: { id: string; title: string; subtitle: string; prefix: string; tint: Tint }[] = [
  { id: "income", title: "Income · funds", subtitle: "Giving credited into each fund", prefix: "fund:", tint: TINT_GREEN },
  { id: "channels", title: "Assets · channels", subtitle: "Money received by payment channel", prefix: "cash:", tint: TINT_NAVY },
  { id: "sales", title: "Sales", subtitle: "Media & other sales", prefix: "sales:", tint: TINT_GOLD },
];

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

  const groupsFor = (prefix: string): AccountGroup[] => {
    const map = new Map<string, AccountGroup>();
    for (const l of ledger) {
      if (!l.account.startsWith(prefix)) continue;
      const g = map.get(l.account) ?? { key: l.account, display: l.account.slice(prefix.length).toUpperCase(), debit: 0, credit: 0 };
      if (l.side === "debit") g.debit += l.amount_minor;
      else g.credit += l.amount_minor;
      map.set(l.account, g);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.credit - b.debit) - Math.abs(a.credit - a.debit));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* balance strip */}
      <Card style={{ overflow: "hidden" }}>
        <div className="px-5 py-4 flex items-center justify-between flex-wrap gap-3" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="nuru-section-title">Double-entry ledger</div>
          <span className="inline-flex items-center gap-1.5" style={{ fontSize: 11.5, color: MUTED }}>
            <ShieldCheck size={13} style={{ color: GREEN }} /> Server-authoritative · verified webhooks only
          </span>
        </div>
        <div className="flex items-center gap-5 flex-wrap" style={{ padding: "14px 20px", background: "#E8F6EC" }}>
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
      </Card>

      {/* account-family summaries (grouped accounts with balances) */}
      {FAMILIES.map((fam) => {
        const gs = groupsFor(fam.prefix);
        if (gs.length === 0) return null;
        return (
          <Card key={fam.id} style={{ overflow: "hidden" }}>
            <div className="flex items-center gap-2.5 px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <TintedIcon tint={fam.tint} size={28}>
                <Layers size={14} />
              </TintedIcon>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>{fam.title}</div>
                <div style={{ fontSize: 11, color: MUTED }}>{fam.subtitle}</div>
              </div>
            </div>
            {gs.map((g, i) => {
              const net = g.credit - g.debit;
              return (
                <div
                  key={g.key}
                  className="flex items-center justify-between px-5"
                  style={{ padding: "11px 20px", borderTop: i === 0 ? "none" : `1px solid ${BORDER}` }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>{g.display}</span>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 700, color: NAVY }}>{money(Math.abs(net), currency)}</div>
                    <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: 0.4, color: net >= 0 ? "#0F6B33" : "#1F3A6B" }}>
                      {net >= 0 ? "net credit" : "net debit"}
                    </div>
                  </div>
                </div>
              );
            })}
          </Card>
        );
      })}

      {/* raw postings */}
      <Card style={{ overflow: "hidden" }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <div className="nuru-section-title">All postings</div>
          <div style={{ fontSize: 12, color: MUTED }}>Most recent ledger entries.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                {["Account", "Side", "Amount", "When"].map((h) => (
                  <th key={h} style={h === "Amount" ? { ...thStyle, textAlign: "right" } : thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={l.entry_id} style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent" }}>
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
                  <td style={{ padding: "9px 16px", fontSize: 12.5, fontFamily: MONO, color: "var(--foreground)", textAlign: "right" }}>{money(l.amount_minor, l.currency)}</td>
                  <td style={{ padding: "9px 16px", fontSize: 12, color: MUTED, whiteSpace: "nowrap" }}>{fmtDateTime(l.created_at)}</td>
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
    </div>
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
            <tr style={{ background: SURFACE }}>
              {["When", "Action", "Actor", "Type", "Reference"].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {audit.map((a, i) => (
              <tr key={a.audit_id} style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent" }}>
                <td style={{ padding: "10px 16px", fontSize: 12, color: NAVY, fontFamily: MONO, whiteSpace: "nowrap" }}>{fmtDateTime(a.occurred_at)}</td>
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
        <ShieldCheck size={16} style={{ color: GOLD, marginTop: 1, flexShrink: 0 }} />
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
              <tr style={{ background: SURFACE }}>
                {["Fund", "Code", "Status"].map((h) => (
                  <th key={h} style={thStyle}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {config.funds.map((f, i) => (
                <tr key={f.code} style={{ borderTop: `1px solid ${BORDER}`, background: i % 2 === 1 ? "rgba(238,240,243,0.4)" : "transparent" }}>
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

      {/* honest note: fee/expense/receipt config not yet backed */}
      <Card style={{ padding: "14px 18px" }}>
        <div className="flex items-start gap-2.5">
          <Wrench size={15} style={{ color: INK400, marginTop: 1, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>Fee, expense &amp; receipt configuration</div>
            <div style={{ fontSize: 11.5, color: INK400, marginTop: 2 }}>
              Processor-fee schedules, expense categories, and receipt numbering arrive with backend support. They are not
              configurable here yet.
            </div>
          </div>
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
              <tr style={{ background: SURFACE }}>
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
        <ShieldCheck size={18} style={{ color: GREEN, flexShrink: 0, marginTop: 1 }} />
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
        <p style={{ fontSize: 11.5, color: INK400 }}>
          Reconciliation variance against bank/processor statements is not tracked yet — it arrives with backend support.
        </p>
      </div>
    </DrawerShell>
  );
}

export default Finance;
