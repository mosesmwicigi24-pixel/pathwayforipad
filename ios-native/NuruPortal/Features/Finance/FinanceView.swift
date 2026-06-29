// Finance — Giving Ledger console, a line-by-line SwiftUI port of the web
// admin portal's Finance.tsx ("Final Pathway Portal" make): a 5-tab read-only
// reporting surface (Overview / Transactions / Ledger / Audit / Configuration),
// wired to the live finance reads. Money is integer minor units + ISO currency.
//
// This page is READ-ONLY: it issues no writes, no payment actions, and shows no
// secrets — cards never touch the server and config is informational only
// (PCI SAQ-A, §5.6; step-up MFA is administrator-managed, server-side).
import SwiftUI
import Charts

// MARK: - Page-local Codable shapes (mirror the TS interfaces in api/client.ts)

private struct TransactionRow: Codable, Identifiable {
    @DefaultEmpty var transactionId: String
    let fullName: String?
    @DefaultZero var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var status: String
    let fund: String?
    let method: String?
    @DefaultEmpty var createdAt: String
    let settledAt: String?
    var id: String { transactionId }
}
private struct TransactionsPage: Codable { let data: [TransactionRow] }

private struct LedgerRow: Codable, Identifiable {
    @DefaultEmpty var entryId: String
    @DefaultEmpty var transactionId: String
    @DefaultEmpty var account: String
    @DefaultEmpty var side: String
    @DefaultZero var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var createdAt: String
    var id: String { entryId }
}
private struct LedgerPage: Codable { let data: [LedgerRow] }

private struct FinanceTrendPoint: Codable, Identifiable {
    @DefaultEmpty var m: String
    @DefaultEmpty var month: String
    @DefaultZero var totalMinor: Int
    var id: String { month.isEmpty ? m : month }
}
private struct TrendPage: Codable { let data: [FinanceTrendPoint] }

private struct FinanceAuditRow: Codable, Identifiable {
    @DefaultZero var auditId: Int
    let actorId: String?
    let actorName: String?
    @DefaultEmpty var action: String
    let entity: String?
    let entityId: String?
    @DefaultEmpty var occurredAt: String
    @DefaultEmpty var actorType: String  // "System" | "Admin"
    var id: Int { auditId }
}
private struct FinanceAuditPage: Codable { let data: [FinanceAuditRow] }

private struct TransactionDetailRow: Codable {
    @DefaultEmpty var transactionId: String
    let fullName: String?
    @DefaultZero var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var status: String
    let fund: String?
    let fundName: String?
    let method: String?
    @DefaultEmpty var createdAt: String
    let settledAt: String?
    let providerRef: String?
    let stripePaymentIntent: String?
}
private struct TransactionDetail: Codable {
    let transaction: TransactionDetailRow
    private let ledgerEntriesRaw: [LedgerRow]?
    var ledgerEntries: [LedgerRow] { ledgerEntriesRaw ?? [] }
    enum CodingKeys: String, CodingKey { case transaction, ledgerEntriesRaw = "ledgerEntries" }
}

private struct FinanceConfigFund: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    @DefaultFalse var isActive: Bool
    var id: String { code }
}
private struct FinanceConfigProvider: Codable, Identifiable {
    @DefaultEmpty var key: String
    @DefaultEmpty var label: String
    @DefaultFalse var enabled: Bool
    var id: String { key }
}
private struct FinanceConfig: Codable {
    private let fundsRaw: [FinanceConfigFund]?
    private let providersRaw: [FinanceConfigProvider]?
    @DefaultFalse var stepUpRequired: Bool
    var funds: [FinanceConfigFund] { fundsRaw ?? [] }
    var providers: [FinanceConfigProvider] { providersRaw ?? [] }
    enum CodingKeys: String, CodingKey { case fundsRaw = "funds", providersRaw = "providers", stepUpRequired }
}

// MARK: - Finance reads (page-local; actor APIClient, convertFromSnakeCase)

private enum FinanceAPI {
    static func summary() async throws -> [FundSummary] {
        try await APIClient.shared.get("/admin/finance/summary", as: FinanceSummary.self).funds
    }
    static func transactions(fund: String?, status: String?) async throws -> [TransactionRow] {
        var q: [String: String] = [:]
        if let fund, fund != "All" { q["fund"] = fund }
        if let status, status != "All" { q["status"] = status }
        return try await APIClient.shared.get("/admin/finance/transactions", query: q, as: TransactionsPage.self).data
    }
    static func ledger(limit: Int = 200) async throws -> [LedgerRow] {
        try await APIClient.shared.get("/admin/finance/ledger", query: ["limit": String(limit)], as: LedgerPage.self).data
    }
    static func trend(months: Int = 6) async throws -> [FinanceTrendPoint] {
        try await APIClient.shared.get("/admin/finance/trend", query: ["months": String(months)], as: TrendPage.self).data
    }
    static func audit(actor: String, limit: Int = 100) async throws -> [FinanceAuditRow] {
        var q: [String: String] = ["limit": String(limit)]
        if actor != "All" { q["actor"] = actor }
        return try await APIClient.shared.get("/admin/finance/audit", query: q, as: FinanceAuditPage.self).data
    }
    static func config() async throws -> FinanceConfig {
        try await APIClient.shared.get("/admin/finance/config", as: FinanceConfig.self)
    }
    static func transactionDetail(_ id: String) async throws -> TransactionDetail {
        try await APIClient.shared.get("/admin/finance/transactions/\(id)", as: TransactionDetail.self)
    }
}

// MARK: - Tokens / helpers (ported from the web page)

private enum FinanceTone {
    /// The TONES palette used for the fund cards + donut.
    static let palette: [Color] = [
        Color(hex: 0xC89B3C), Color(hex: 0x16A34A), Color(hex: 0x0B84E8),
        Color(hex: 0x7C3AED), Color(hex: 0xDC2626), Color(hex: 0x0D9488),
    ]
    static func at(_ i: Int) -> Color { palette[((i % palette.count) + palette.count) % palette.count] }
}

private struct ChipColor { let bg: Color; let fg: Color }

/// Payment status chip (web `statusChip`).
private func paymentChip(_ status: String) -> ChipColor {
    switch status {
    case "confirmed", "settled", "succeeded": return ChipColor(bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
    case "pending", "processing", "requires_action": return ChipColor(bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xA87616))
    case "failed": return ChipColor(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xDC2626))
    case "refunded": return ChipColor(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x7C3AED))
    default: return ChipColor(bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xA87616)) // fallback → pending
    }
}

/// Ledger status DERIVED from payment status (web `ledgerStatus`).
private struct LedgerChip { let label: String; let bg: Color; let fg: Color }
private func ledgerStatus(_ status: String) -> LedgerChip {
    switch status {
    case "succeeded", "settled", "confirmed":
        return LedgerChip(label: "Posted", bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
    case "processing", "requires_action", "pending":
        return LedgerChip(label: "Waiting", bg: Color(hex: 0xFFFBEB), fg: Color(hex: 0xA87616))
    case "failed":
        return LedgerChip(label: "Not posted", bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
    case "refunded":
        return LedgerChip(label: "Reversed", bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x7C3AED))
    default:
        return LedgerChip(label: "—", bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
    }
}

private func methodLabel(_ m: String?) -> String {
    guard let m, !m.isEmpty else { return "—" }
    switch m {
    case "mpesa": return "M-Pesa"
    case "airtel": return "Airtel"
    case "paypal": return "PayPal"
    case "card", "stripe": return "Card"
    default: return m.prefix(1).uppercased() + m.dropFirst()
    }
}

private func statusTitle(_ s: String) -> String {
    s.replacingOccurrences(of: "_", with: " ").capitalized
}

private func shortRef(_ id: String) -> String {
    id.count > 12 ? "\(id.prefix(8))…\(id.suffix(4))" : id
}

// MARK: - CSV export (presentational in the web — window.print; here a native
// ShareLink over the current read-only rows. No write endpoints are involved.)

/// RFC-4180 quote: wrap in quotes and double any embedded quote.
private func csvCell(_ s: String) -> String {
    "\"\(s.replacingOccurrences(of: "\"", with: "\"\""))\""
}
private func csvRow(_ cols: [String]) -> String {
    cols.map(csvCell).joined(separator: ",") + "\n"
}

/// Whole-units amount for CSV (mirrors the web `money` rounding to major units).
private func csvAmount(_ minor: Int, _ currency: String) -> String {
    "\(currency) \(Int((Double(minor) / 100).rounded()))"
}

private func transactionsCSV(_ rows: [TransactionRow]) -> String {
    var out = csvRow(["Date", "Member", "Fund", "Amount", "Payment Status", "Ledger Status", "Reference"])
    for t in rows {
        out += csvRow([
            fmtDate(t.createdAt),
            t.fullName ?? "Anonymous",
            t.fund ?? "—",
            csvAmount(t.amountMinor, t.currency),
            statusTitle(t.status),
            ledgerStatus(t.status).label,
            t.transactionId,
        ])
    }
    return out
}

private func ledgerCSV(_ rows: [LedgerRow]) -> String {
    var out = csvRow(["Account", "Side", "Amount", "When"])
    for l in rows {
        out += csvRow([l.account, l.side, csvAmount(l.amountMinor, l.currency), fmtDateTime(l.createdAt)])
    }
    return out
}

private func fmtDate(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "—" }
    return Fmt.date(iso, style: .dateTime.day().month(.abbreviated).year())
}
private func fmtDateTime(_ iso: String?) -> String {
    guard let iso, !iso.isEmpty else { return "—" }
    return Fmt.date(iso, style: .dateTime.day().month(.abbreviated).year().hour().minute())
}

/// Wire-status filters for the Status dropdown (label → API status value).
private let statusFilters: [(label: String, value: String)] = [
    ("All", "All"), ("Confirmed", "succeeded"), ("Pending", "processing"),
    ("Failed", "failed"), ("Refunded", "refunded"),
]

private enum FinanceTab: String, CaseIterable { case overview, transactions, ledger, audit, config
    var label: String {
        switch self {
        case .overview: return "Overview"
        case .transactions: return "Transactions"
        case .ledger: return "Ledger"
        case .audit: return "Audit"
        case .config: return "Configuration"
        }
    }
    var locked: Bool { self == .config }
}

// MARK: - Table header cell (web `thStyle`)

private struct Th: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.inter(11, .bold)).tracking(0.6)
            .foregroundStyle(Nuru.ink600)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Small pill (web Pill)

private struct ColorPill: View {
    let text: String
    var icon: String? = nil
    let bg: Color
    let fg: Color
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 9, weight: .bold)) }
            Text(text).font(.inter(11, .bold)).tracking(0.2)
        }
        .foregroundStyle(fg)
        .padding(.horizontal, 9).padding(.vertical, 3)
        .background(bg)
        .clipShape(Capsule())
    }
}

// MARK: - ===================== FinanceView =====================

struct FinanceView: View {
    @State private var tab: FinanceTab = .overview
    @State private var error: String?

    // data
    @State private var funds: [FundSummary] = []
    @State private var trend: [FinanceTrendPoint] = []
    @State private var txns: [TransactionRow] = []
    @State private var ledger: [LedgerRow] = []
    @State private var audit: [FinanceAuditRow] = []
    @State private var config: FinanceConfig?

    // transactions filters
    @State private var search = ""
    @State private var fundFilter = "All"
    @State private var statusFilter = "All"

    // audit filter
    @State private var auditActor = "All"   // All | System | Admin

    // overlays
    @State private var reconcileOpen = false
    @State private var detail: TransactionDetail?
    @State private var detailLoading = false
    @State private var detailPresented = false

    // MARK: derived

    private var currency: String { funds.first?.currency ?? "KES" }
    private var monthTotal: Int { funds.reduce(0) { $0 + $1.monthMinor } }
    private var allTotal: Int { funds.reduce(0) { $0 + $1.totalMinor } }
    private var giftCount: Int { funds.reduce(0) { $0 + $1.giftCount } }

    fileprivate struct DonutSlice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var donut: [DonutSlice] {
        funds.enumerated()
            .filter { $0.element.monthMinor > 0 }
            .map { i, f in DonutSlice(name: f.name, value: Int((Double(f.monthMinor) / 100).rounded()), color: FinanceTone.at(i)) }
    }

    fileprivate struct TrendBar: Identifiable { let m: String; let value: Int; var id: String { m } }
    private var trendPoints: [TrendBar] {
        trend.map { TrendBar(m: $0.m, value: Int((Double($0.totalMinor) / 100).rounded())) }
    }

    private var visibleTxns: [TransactionRow] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return txns }
        return txns.filter {
            "\($0.fullName ?? "") \($0.fund ?? "") \(Int(Double($0.amountMinor) / 100)) \($0.transactionId)"
                .lowercased().contains(q)
        }
    }

    private var debitTotal: Int { ledger.filter { $0.side == "debit" }.reduce(0) { $0 + $1.amountMinor } }
    private var creditTotal: Int { ledger.filter { $0.side == "credit" }.reduce(0) { $0 + $1.amountMinor } }

    // Export Report (hero): the web window.print()s the page; here we share a CSV of
    // whatever the current tab is showing — Ledger on the ledger tab, otherwise the
    // (filtered/searched) transactions. Read-only: no write endpoint is touched.
    private var heroExportCSV: String {
        tab == .ledger ? ledgerCSV(ledger) : transactionsCSV(visibleTxns)
    }
    private var heroExportName: String {
        tab == .ledger ? "Nuru Pathway — Ledger.csv" : "Nuru Pathway — Transactions.csv"
    }

    // MARK: body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                tabBar
                content
                    .padding(.horizontal, Nuru.S.lg)
                    .padding(.top, Nuru.S.lg)
                    .padding(.bottom, 48)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadStatic() }
        .task(id: "\(fundFilter)|\(statusFilter)") { await loadTxns() }
        .task(id: auditActor) { await loadAudit() }
        .sheet(isPresented: $reconcileOpen) { ReconcileSheet() }
        .sheet(isPresented: $detailPresented, onDismiss: { detail = nil; detailLoading = false }) {
            TxDetailSheet(detail: detail, loading: detailLoading) {
                detailPresented = false
                tab = .ledger
            }
        }
    }

    // MARK: hero (navy banner + stat strip)

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    Text("Operations").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                    Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                    Text("Finance — Giving Ledger").font(.nMicro).foregroundStyle(.white)
                }
                Spacer(minLength: 8)
            }
            // action chips row
            HStack(spacing: 8) {
                HeroChip(label: "Audit-protected", icon: "checkmark.shield.fill", style: .tag)
                Spacer(minLength: 0)
                HeroChip(label: "Reconcile", icon: "arrow.triangle.2.circlepath", style: .ghost) { reconcileOpen = true }
                ShareLink(item: heroExportCSV, preview: SharePreview(heroExportName)) {
                    HStack(spacing: 6) {
                        Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .semibold))
                        Text("Export Report").font(.inter(11.5, .semibold))
                    }
                    .padding(.horizontal, 12).frame(height: 32)
                    .foregroundStyle(.white)
                    .background(Nuru.gold)
                    .clipShape(Capsule())
                }
            }
            Text("Finance").font(.nDisplay).foregroundStyle(.white)
            heroStatStrip
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, 22).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyDeep)
    }

    private var heroStatStrip: some View {
        // ~5 compact tiles across the narrow portrait canvas. Small value fonts so
        // the currency reads compactly; one short hint each. No half-screen cards.
        let avgGift = giftCount > 0 ? allTotal / giftCount : 0
        let items: [(label: String, value: String, hint: String)] = [
            ("This month", Fmt.money(minor: monthTotal, currency: currency), "\(giftCount) gifts"),
            ("All time", Fmt.money(minor: allTotal, currency: currency), "across funds"),
            ("Avg gift", Fmt.money(minor: avgGift, currency: currency), "per gift"),
            ("Funds", String(funds.count), "active"),
            ("Gifts", String(giftCount), "received"),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 1)], spacing: 1) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.label.uppercased()).font(.nOverline).tracking(1.0)
                        .foregroundStyle(Nuru.onNavyDim).lineLimit(1).minimumScaleFactor(0.85)
                    Text(item.value).font(.inter(15, .semibold)).foregroundStyle(.white)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text(item.hint).font(.nMicro).foregroundStyle(Nuru.onNavyFaint)
                        .lineLimit(1).minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color.white.opacity(0.04))
            }
        }
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
    }

    // MARK: tab bar

    private var tabBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(FinanceTab.allCases, id: \.self) { t in
                    let active = tab == t
                    Button { tab = t } label: {
                        HStack(spacing: 7) {
                            if t.locked { Image(systemName: "lock.fill").font(.system(size: 11)) }
                            Text(t.label).font(.inter(14, active ? .bold : .medium))
                        }
                        .foregroundStyle(active ? Nuru.navy : Nuru.ink600)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(active ? Nuru.gold : .clear).frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, Nuru.S.lg)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
        .background(Nuru.paper)
    }

    // MARK: content switch

    @ViewBuilder private var content: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
            switch tab {
            case .overview:
                OverviewTab(funds: funds, currency: currency, donut: donut, trendPoints: trendPoints,
                            monthTotal: monthTotal, allTotal: allTotal, giftCount: giftCount)
            case .transactions:
                TransactionsTab(txns: visibleTxns, funds: funds, search: $search,
                                fundFilter: $fundFilter, statusFilter: $statusFilter,
                                onView: { id in Task { await openDetail(id) } })
            case .ledger:
                LedgerTab(ledger: ledger, debitTotal: debitTotal, creditTotal: creditTotal, currency: currency)
            case .audit:
                AuditTab(audit: audit, actor: $auditActor)
            case .config:
                ConfigTab(config: config)
            }
        }
    }

    // MARK: loaders

    private func loadStatic() async {
        do { funds = try await FinanceAPI.summary() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load funds." }
        trend = (try? await FinanceAPI.trend(months: 6)) ?? trend
        ledger = (try? await FinanceAPI.ledger(limit: 200)) ?? ledger
        config = (try? await FinanceAPI.config()) ?? config
    }
    private func loadTxns() async {
        do { txns = try await FinanceAPI.transactions(fund: fundFilter, status: statusFilter) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load transactions." }
    }
    private func loadAudit() async {
        do { audit = try await FinanceAPI.audit(actor: auditActor, limit: 100) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load the audit trail." }
    }
    private func openDetail(_ id: String) async {
        detail = nil; detailLoading = true; detailPresented = true
        do { detail = try await FinanceAPI.transactionDetail(id) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load transaction detail." }
        detailLoading = false
    }
}

// MARK: - ===================== OVERVIEW =====================

private struct OverviewTab: View {
    let funds: [FundSummary]
    let currency: String
    let donut: [FinanceView.DonutSlice]
    let trendPoints: [FinanceView.TrendBar]
    let monthTotal: Int
    let allTotal: Int
    let giftCount: Int

    // ~5 compact fund tiles per row at ~740pt portrait width.
    private let cols = [GridItem(.adaptive(minimum: 132), spacing: 12)]

    var body: some View {
        VStack(spacing: 16) {
            // fund tiles — compact stat strip, small amount font
            if funds.isEmpty {
                Card { Text("No funds configured.").font(.nCaption).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity, alignment: .leading) }
            } else {
                LazyVGrid(columns: cols, spacing: 12) {
                    ForEach(Array(funds.enumerated()), id: \.element.id) { i, f in
                        fundTile(f, tone: FinanceTone.at(i))
                    }
                }
            }

            // monthly giving trend
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Monthly giving").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    Text("Last 6 months · \(currency)").font(.nMicro).foregroundStyle(Nuru.ink600).padding(.top, 2)
                    trendChart.frame(height: 200).padding(.top, 12)
                }
            }

            // giving by fund — donut + clear legend (value + %)
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Giving by fund").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    Text("This month · \(currency)").font(.nMicro).foregroundStyle(Nuru.ink600).padding(.top, 2)
                    if donut.isEmpty {
                        Text("No giving this month yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
                    } else {
                        HStack(alignment: .center, spacing: 16) {
                            donutChart
                                .frame(width: 132, height: 132)
                                .overlay {
                                    VStack(spacing: 0) {
                                        Text("\(currency)").font(.inter(9, .semibold)).foregroundStyle(Nuru.ink600)
                                        Text(donutTotal.formatted()).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
                                            .lineLimit(1).minimumScaleFactor(0.6)
                                        Text("this month").font(.nMicro).foregroundStyle(Nuru.ink400)
                                    }
                                    .padding(.horizontal, 6)
                                }
                            VStack(spacing: 7) {
                                ForEach(donut) { d in donutLegendRow(d) }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.top, 14)
                    }
                }
            }

            // Discipleship / Gift / Mission breakdown — aligned bars
            breakdownCard

            // summary
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Summary").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    VStack(spacing: 0) {
                        ForEach(Array(summaryRows.enumerated()), id: \.element.label) { idx, row in
                            HStack(alignment: .firstTextBaseline) {
                                Text(row.label).font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                                Spacer(minLength: 8)
                                Text(row.value).font(.inter(13.5, .semibold)).monospaced().foregroundStyle(Nuru.navy)
                                    .lineLimit(1).minimumScaleFactor(0.7)
                            }
                            .padding(.vertical, 9)
                            .overlay(alignment: .top) {
                                if idx > 0 { Rectangle().fill(Nuru.border).frame(height: 1) }
                            }
                        }
                    }
                    .padding(.top, 6)
                }
            }
        }
    }

    private var summaryRows: [(label: String, value: String)] {
        let avg = giftCount > 0 ? allTotal / giftCount : 0
        return [("This month", Fmt.money(minor: monthTotal, currency: currency)),
                ("All time", Fmt.money(minor: allTotal, currency: currency)),
                ("Average gift", Fmt.money(minor: avg, currency: currency)),
                ("Funds", String(funds.count)),
                ("Gifts received", String(giftCount))]
    }

    // compact fund tile — small icon, small label, small amount, one hint
    private func fundTile(_ f: FundSummary, tone: Color) -> some View {
        Card(padding: 12) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 7, style: .continuous).fill(tone.opacity(0.12))
                        Image(systemName: "banknote.fill").font(.system(size: 11, weight: .semibold)).foregroundStyle(tone)
                    }.frame(width: 24, height: 24)
                    Spacer(minLength: 0)
                    Text("\(f.giftCount)").font(.inter(10.5, .semibold)).foregroundStyle(Nuru.ink600)
                }
                Text(f.name.uppercased()).font(.nOverline).tracking(0.8).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).minimumScaleFactor(0.8).padding(.top, 7)
                Text(Fmt.money(minor: f.totalMinor, currency: f.currency))
                    .font(.inter(15, .semibold)).foregroundStyle(Nuru.navy).padding(.top, 2)
                    .lineLimit(1).minimumScaleFactor(0.55)
                Text("\(Fmt.money(minor: f.monthMinor, currency: f.currency)) this mo.")
                    .font(.nMicro).foregroundStyle(Nuru.ink400).padding(.top, 3)
                    .lineLimit(1).minimumScaleFactor(0.7)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var donutTotal: Int { donut.reduce(0) { $0 + $1.value } }

    private func donutLegendRow(_ d: FinanceView.DonutSlice) -> some View {
        let pct = donutTotal > 0 ? Double(d.value) / Double(donutTotal) * 100 : 0
        return HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 3, style: .continuous).fill(d.color).frame(width: 10, height: 10)
            Text(d.name).font(.inter(12, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
            Spacer(minLength: 6)
            Text("\(currency) \(d.value.formatted())").font(.inter(12, .semibold)).monospaced().foregroundStyle(Nuru.navy)
            Text("\(Int(pct.rounded()))%").font(.inter(11)).foregroundStyle(Nuru.ink600)
                .frame(width: 34, alignment: .trailing)
        }
    }

    // Discipleship / Gift / Mission breakdown — labelled bars with amounts.
    private var breakdownCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 0) {
                Text("Breakdown").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                Text("By fund · this month").font(.nMicro).foregroundStyle(Nuru.ink600).padding(.top, 2)
                if donut.isEmpty {
                    Text("No giving this month yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 14)
                } else {
                    VStack(spacing: 12) {
                        ForEach(donut) { d in breakdownRow(d) }
                    }
                    .padding(.top, 14)
                }
            }
        }
    }

    private func breakdownRow(_ d: FinanceView.DonutSlice) -> some View {
        let frac = donutTotal > 0 ? Double(d.value) / Double(donutTotal) : 0
        return VStack(spacing: 5) {
            HStack {
                Text(d.name).font(.inter(12.5, .medium)).foregroundStyle(Nuru.navy).lineLimit(1)
                Spacer(minLength: 8)
                Text("\(currency) \(d.value.formatted())").font(.inter(12.5, .semibold)).monospaced().foregroundStyle(Nuru.navy)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Nuru.mutedBg)
                    Capsule().fill(d.color).frame(width: max(4, geo.size.width * frac))
                }
            }
            .frame(height: 7)
        }
    }

    @ViewBuilder private var trendChart: some View {
        if trendPoints.isEmpty {
            Text("No giving recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart(trendPoints) { p in
                LineMark(x: .value("Month", p.m), y: .value("Amount", p.value))
                    .interpolationMethod(.monotone)
                    .foregroundStyle(Color(hex: 0xC89B3C))
                    .lineStyle(StrokeStyle(lineWidth: 2.5))
                PointMark(x: .value("Month", p.m), y: .value("Amount", p.value))
                    .foregroundStyle(Color(hex: 0xC89B3C))
                    .symbolSize(30)
            }
            .chartXAxis {
                AxisMarks { _ in
                    AxisValueLabel().font(.inter(11)).foregroundStyle(Color(hex: 0x6B7280))
                }
            }
            .chartYAxis {
                AxisMarks { value in
                    AxisGridLine().foregroundStyle(Nuru.border)
                    AxisValueLabel {
                        if let v = value.as(Int.self) {
                            Text(v >= 1000 ? "\(Int((Double(v) / 1000).rounded()))k" : "\(v)")
                                .font(.inter(11)).foregroundStyle(Color(hex: 0x6B7280))
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private var donutChart: some View {
        if donut.isEmpty {
            Text("No giving this month yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart(donut) { d in
                SectorMark(angle: .value("Amount", d.value), innerRadius: .ratio(0.62), angularInset: 2)
                    .foregroundStyle(d.color)
                    .cornerRadius(2)
            }
            .chartLegend(.hidden)
        }
    }
}

// MARK: - ===================== TRANSACTIONS =====================

private struct TransactionsTab: View {
    let txns: [TransactionRow]
    let funds: [FundSummary]
    @Binding var search: String
    @Binding var fundFilter: String
    @Binding var statusFilter: String
    let onView: (String) -> Void

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // header
                VStack(alignment: .leading, spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Recent transactions").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text("Every confirmed gift links to a balanced ledger entry.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    // search
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Color(hex: 0x6B7280))
                        TextField("Search member, fund, amount, reference", text: $search)
                            .font(.inter(13)).textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    .padding(.horizontal, 12).frame(height: 36)
                    .background(Nuru.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    // filters
                    HStack(spacing: 8) {
                        Menu {
                            Button("All") { fundFilter = "All" }
                            ForEach(funds) { f in Button(f.name) { fundFilter = f.code } }
                        } label: {
                            filterLabel("Fund: \(fundFilter == "All" ? "All" : (funds.first { $0.code == fundFilter }?.name ?? fundFilter))")
                        }
                        Menu {
                            ForEach(statusFilters, id: \.value) { s in
                                Button(s.label) { statusFilter = s.value }
                            }
                        } label: {
                            filterLabel("Status: \(statusFilters.first { $0.value == statusFilter }?.label ?? "All")")
                        }
                        Spacer(minLength: 0)
                        // Export (web window.print) → native CSV ShareLink of the
                        // currently visible (filtered + searched) transactions.
                        ShareLink(item: transactionsCSV(txns),
                                  preview: SharePreview("Nuru Pathway — Transactions.csv")) {
                            HStack(spacing: 6) {
                                Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .semibold))
                                Text("Export").font(.inter(13, .semibold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12).frame(height: 34)
                            .background(Nuru.navy)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }
                        .disabled(txns.isEmpty)
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                // table — horizontally scrollable
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(spacing: 0) {
                        HStack(spacing: 12) {
                            Th(text: "Date").frame(width: 92, alignment: .leading)
                            Th(text: "Member").frame(width: 168, alignment: .leading)
                            Th(text: "Fund").frame(width: 96, alignment: .leading)
                            Th(text: "Amount").frame(width: 116, alignment: .trailing)
                            Th(text: "Payment").frame(width: 116, alignment: .leading)
                            Th(text: "Ledger").frame(width: 104, alignment: .leading)
                            Th(text: "Reference").frame(width: 132, alignment: .leading)
                            Th(text: "").frame(width: 64, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Nuru.mutedBg)

                        if txns.isEmpty {
                            Text("No transactions match.").font(.nCaption).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(txns) { t in row(t) }
                        }
                    }
                }
            }
        }
    }

    private func filterLabel(_ text: String) -> some View {
        HStack(spacing: 6) {
            Text(text).font(.inter(13)).foregroundStyle(Nuru.navy).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Nuru.ink400)
        }
        .padding(.horizontal, 12).frame(height: 34)
        .background(Nuru.white)
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func row(_ t: TransactionRow) -> some View {
        let sc = paymentChip(t.status)
        let lc = ledgerStatus(t.status)
        return HStack(spacing: 12) {
            Text(fmtDate(t.createdAt)).font(.inter(12)).monospaced().foregroundStyle(Nuru.navy)
                .frame(width: 92, alignment: .leading)
            Text(t.fullName ?? "Anonymous").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                .frame(width: 168, alignment: .leading).lineLimit(1)
            Text(t.fund ?? "—").font(.inter(12)).foregroundStyle(Nuru.ink600)
                .frame(width: 96, alignment: .leading).lineLimit(1)
            Text(Fmt.money(minor: t.amountMinor, currency: t.currency)).font(.inter(13, .bold)).monospaced().foregroundStyle(Nuru.navy)
                .frame(width: 116, alignment: .trailing)
            ColorPill(text: statusTitle(t.status), bg: sc.bg, fg: sc.fg)
                .frame(width: 116, alignment: .leading)
            ColorPill(text: lc.label, bg: lc.bg, fg: lc.fg)
                .frame(width: 104, alignment: .leading)
            Text(shortRef(t.transactionId)).font(.inter(12)).monospaced().foregroundStyle(Nuru.ink600)
                .frame(width: 132, alignment: .leading)
            Button("View") { onView(t.transactionId) }
                .font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .frame(width: 64, alignment: .trailing)
                .buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }
}

// MARK: - ===================== LEDGER =====================

private struct LedgerTab: View {
    let ledger: [LedgerRow]
    let debitTotal: Int
    let creditTotal: Int
    let currency: String

    private var balanced: Bool { debitTotal == creditTotal }

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // header
                HStack {
                    Text("Double-entry ledger").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark.shield.fill").font(.system(size: 12)).foregroundStyle(Color(hex: 0x16A34A))
                        Text("Server-authoritative · verified webhooks only").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                // totals strip
                HStack(spacing: 20) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("DEBITS").font(.nOverline).tracking(0.7).foregroundStyle(Nuru.ink600)
                        Text(Fmt.money(minor: debitTotal, currency: currency)).font(.inter(18, .bold)).monospaced().foregroundStyle(Nuru.navy)
                    }
                    Rectangle().fill(Color(hex: 0x16A34A).opacity(0.2)).frame(width: 1, height: 34)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("CREDITS").font(.nOverline).tracking(0.7).foregroundStyle(Nuru.ink600)
                        Text(Fmt.money(minor: creditTotal, currency: currency)).font(.inter(18, .bold)).monospaced().foregroundStyle(Nuru.navy)
                    }
                    Spacer(minLength: 8)
                    ColorPill(text: balanced ? "Balanced" : "Review", icon: "checkmark.circle.fill",
                              bg: .white, fg: balanced ? Color(hex: 0x0F6B33) : Color(hex: 0xA87616))
                }
                .padding(.horizontal, 20).padding(.vertical, 14)
                .background(Color(hex: 0xE8F6EC))
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                // table
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(spacing: 0) {
                        HStack(spacing: 12) {
                            Th(text: "Account").frame(maxWidth: .infinity, alignment: .leading)
                            Th(text: "Side").frame(width: 92, alignment: .leading)
                            Th(text: "Amount").frame(width: 132, alignment: .trailing)
                            Th(text: "When").frame(width: 176, alignment: .leading)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Nuru.mutedBg)

                        if ledger.isEmpty {
                            Text("No ledger entries yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(ledger) { l in ledgerRow(l) }
                        }
                    }
                }
            }
        }
    }

    private func ledgerRow(_ l: LedgerRow) -> some View {
        HStack(spacing: 12) {
            Text(l.account).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                .frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
            sideBadge(l.side).frame(width: 92, alignment: .leading)
            Text(Fmt.money(minor: l.amountMinor, currency: l.currency)).font(.inter(12.5, .semibold)).monospaced().foregroundStyle(Nuru.ink)
                .frame(width: 132, alignment: .trailing)
            Text(fmtDateTime(l.createdAt)).font(.inter(12)).monospaced().foregroundStyle(Nuru.ink600)
                .frame(width: 176, alignment: .leading)
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }

    private func sideBadge(_ side: String) -> some View {
        let isDebit = side == "debit"
        return Text(side.uppercased()).font(.inter(11, .bold))
            .foregroundStyle(isDebit ? Color(hex: 0x1F3A6B) : Color(hex: 0x0F6B33))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(isDebit ? Color(hex: 0xEEF1F8) : Color(hex: 0xE8F6EC))
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

// MARK: - ===================== AUDIT =====================

private struct AuditTab: View {
    let audit: [FinanceAuditRow]
    @Binding var actor: String

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // header
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Audit trail").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text("System and admin actions related to finance.").font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 8)
                    Menu {
                        ForEach(["All", "System", "Admin"], id: \.self) { o in Button(o) { actor = o } }
                    } label: {
                        HStack(spacing: 6) {
                            Text("Actor: \(actor)").font(.inter(13)).foregroundStyle(Nuru.navy)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Nuru.ink400)
                        }
                        .padding(.horizontal, 12).frame(height: 34)
                        .background(Nuru.white)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
                .padding(.horizontal, 18).padding(.vertical, 16)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                // table
                ScrollView(.horizontal, showsIndicators: false) {
                    VStack(spacing: 0) {
                        HStack(spacing: 12) {
                            Th(text: "When").frame(width: 160, alignment: .leading)
                            Th(text: "Action").frame(width: 180, alignment: .leading)
                            Th(text: "Actor").frame(width: 150, alignment: .leading)
                            Th(text: "Type").frame(width: 90, alignment: .leading)
                            Th(text: "Reference").frame(width: 130, alignment: .leading)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Nuru.mutedBg)

                        if audit.isEmpty {
                            Text("No audit events.").font(.nCaption).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(audit) { a in auditRow(a) }
                        }
                    }
                }
            }
        }
    }

    private func auditRow(_ a: FinanceAuditRow) -> some View {
        let isSystem = a.actorType == "System"
        return HStack(spacing: 12) {
            Text(fmtDateTime(a.occurredAt)).font(.inter(12)).monospaced().foregroundStyle(Nuru.navy)
                .frame(width: 160, alignment: .leading)
            Text(a.action).font(.inter(13)).foregroundStyle(Nuru.navy)
                .frame(width: 180, alignment: .leading).lineLimit(2)
            HStack(spacing: 8) {
                if isSystem {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5, style: .continuous).fill(Color(hex: 0xEEF0F3))
                        Image(systemName: "shield.fill").font(.system(size: 11)).foregroundStyle(Nuru.navy)
                    }.frame(width: 22, height: 22)
                }
                Text(a.actorName ?? "System").font(.inter(13)).foregroundStyle(Nuru.navy).lineLimit(1)
            }
            .frame(width: 150, alignment: .leading)
            ColorPill(text: a.actorType,
                      bg: isSystem ? Color(hex: 0xEEF1F8) : Color(hex: 0xF3EAFE),
                      fg: isSystem ? Color(hex: 0x1F3A6B) : Color(hex: 0x7C3AED))
                .frame(width: 90, alignment: .leading)
            Text(a.entityId ?? "—").font(.inter(12)).monospaced().foregroundStyle(Nuru.ink600)
                .frame(width: 130, alignment: .leading).lineLimit(1)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }
}

// MARK: - ===================== CONFIGURATION (read-only) =====================

private struct ConfigTab: View {
    let config: FinanceConfig?

    var body: some View {
        if let config {
            VStack(spacing: 16) {
                // step-up MFA banner
                Card {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.shield.fill").font(.system(size: 16)).foregroundStyle(Color(hex: 0xC89B3C))
                        (Text("Step-up MFA is required to change financial configuration").font(.inter(13, .bold)).foregroundColor(Nuru.navy)
                         + Text(" — managed by your administrator. Provider secrets are configured server-side and never shown here.").font(.inter(13)).foregroundColor(Color(hex: 0x5A4A22)))
                    }
                }
                .background(Color(hex: 0xFFF6E0).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)))

                // funds
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Funds").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                            Text("Giving funds configured for this organization.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        .padding(.horizontal, 18).padding(.vertical, 16)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }

                        HStack(spacing: 12) {
                            Th(text: "Fund").frame(maxWidth: .infinity, alignment: .leading)
                            Th(text: "Code").frame(width: 120, alignment: .leading)
                            Th(text: "Status").frame(width: 100, alignment: .leading)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .background(Nuru.mutedBg)

                        if config.funds.isEmpty {
                            Text("No funds configured.").font(.nCaption).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(config.funds) { f in
                                HStack(spacing: 12) {
                                    Text(f.name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                    Text(f.code).font(.inter(12)).monospaced().foregroundStyle(Nuru.ink600)
                                        .frame(width: 120, alignment: .leading)
                                    Group {
                                        if f.isActive {
                                            ColorPill(text: "Active", icon: "checkmark.circle.fill", bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
                                        } else {
                                            ColorPill(text: "Inactive", bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
                                        }
                                    }.frame(width: 100, alignment: .leading)
                                }
                                .padding(.horizontal, 16).padding(.vertical, 10)
                                .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                            }
                        }
                    }
                }

                // payment providers
                Card {
                    VStack(alignment: .leading, spacing: 0) {
                        Text("Payment providers").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        Text("Connections are managed server-side. Secrets are never displayed.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600).padding(.top, 4)
                        if config.providers.isEmpty {
                            Text("No providers configured.").font(.nCaption).foregroundStyle(Nuru.ink600).padding(.top, 12)
                        } else {
                            VStack(spacing: 0) {
                                ForEach(config.providers) { p in
                                    HStack {
                                        Text(p.label).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                        Spacer()
                                        if p.enabled {
                                            ColorPill(text: "Connected", icon: "checkmark.circle.fill", bg: Color(hex: 0xE8F6EC), fg: Color(hex: 0x0F6B33))
                                        } else {
                                            ColorPill(text: "Not configured", bg: Color(hex: 0xEEF0F3), fg: Color(hex: 0x6B7280))
                                        }
                                    }
                                    .padding(.vertical, 12)
                                    .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
                                }
                            }
                            .padding(.top, 12)
                        }
                    }
                }
            }
        } else {
            Card(padding: 40) {
                Text("Loading configuration…").font(.nCaption).foregroundStyle(Nuru.ink600)
                    .frame(maxWidth: .infinity, alignment: .center)
            }
        }
    }
}

// MARK: - ===================== DRAWERS (sheets) =====================

private struct TxDetailSheet: View {
    let detail: TransactionDetail?
    let loading: Bool
    let onViewLedger: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if loading || detail == nil {
                    VStack {
                        Text("Loading transaction…").font(.nCaption).foregroundStyle(Nuru.ink600)
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let detail {
                    content(detail)
                }
            }
            .background(Nuru.paper)
            .navigationTitle("Transaction Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                if !loading, detail != nil {
                    ToolbarItem(placement: .confirmationAction) {
                        Button { onViewLedger() } label: {
                            HStack(spacing: 4) { Text("Ledger"); Image(systemName: "arrow.right") }
                        }
                    }
                }
            }
        }
    }

    private func content(_ detail: TransactionDetail) -> some View {
        let t = detail.transaction
        let sc = paymentChip(t.status)
        let lc = ledgerStatus(t.status)
        return ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                Text(t.fullName ?? "Anonymous").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                Text(Fmt.money(minor: t.amountMinor, currency: t.currency))
                    .font(.inter(20, .semibold)).monospaced().foregroundStyle(Nuru.navy).padding(.top, 2)
                    .lineLimit(1).minimumScaleFactor(0.6)

                LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                    cell("Fund") { Text(t.fundName ?? t.fund ?? "—").font(.inter(13)).foregroundStyle(Nuru.navy) }
                    cell("Method") { Text(methodLabel(t.method)).font(.inter(13)).foregroundStyle(Nuru.navy) }
                    cell("Payment status") { ColorPill(text: statusTitle(t.status), bg: sc.bg, fg: sc.fg) }
                    cell("Ledger status") { ColorPill(text: lc.label, bg: lc.bg, fg: lc.fg) }
                    cell("Created") { Text(fmtDateTime(t.createdAt)).font(.inter(12)).monospaced().foregroundStyle(Nuru.navy) }
                    cell("Settled") { Text(fmtDateTime(t.settledAt)).font(.inter(12)).monospaced().foregroundStyle(Nuru.navy) }
                    cell("Reference") { Text(t.transactionId).font(.inter(12)).monospaced().foregroundStyle(Nuru.navy) }
                    cell("Provider ref") { Text(t.providerRef ?? t.stripePaymentIntent ?? "—").font(.inter(12)).monospaced().foregroundStyle(Nuru.navy) }
                }
                .padding(.top, 20)

                // ledger postings
                Text("Ledger postings").font(.fraunces(16, .medium)).foregroundStyle(Nuru.navy).padding(.top, 22).padding(.bottom, 10)
                VStack(spacing: 0) {
                    HStack(spacing: 12) {
                        Th(text: "Account").frame(maxWidth: .infinity, alignment: .leading)
                        Th(text: "Side").frame(width: 70, alignment: .leading)
                        Th(text: "Amount").frame(width: 110, alignment: .leading)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Nuru.mutedBg)

                    if detail.ledgerEntries.isEmpty {
                        Text("No ledger postings — payment not yet confirmed.")
                            .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity).padding(.vertical, 16)
                    } else {
                        ForEach(detail.ledgerEntries) { l in
                            HStack(spacing: 12) {
                                Text(l.account).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                postingSide(l.side).frame(width: 70, alignment: .leading)
                                Text(Fmt.money(minor: l.amountMinor, currency: l.currency)).font(.inter(12.5)).monospaced().foregroundStyle(Nuru.navy)
                                    .frame(width: 110, alignment: .leading)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 8)
                            .overlay(alignment: .top) { Rectangle().fill(Nuru.border).frame(height: 1) }
                        }
                    }
                }
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func cell<C: View>(_ label: String, @ViewBuilder _ value: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            value()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func postingSide(_ side: String) -> some View {
        let isDebit = side == "debit"
        return Text(side.uppercased()).font(.inter(11, .bold))
            .foregroundStyle(isDebit ? Color(hex: 0x1F3A6B) : Color(hex: 0x0F6B33))
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(isDebit ? Color(hex: 0xEEF1F8) : Color(hex: 0xE8F6EC))
            .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }
}

private struct ReconcileSheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "checkmark.shield.fill").font(.system(size: 18)).foregroundStyle(Color(hex: 0x16A34A))
                        (Text("The ledger is auto-reconciled.").font(.inter(13, .bold)).foregroundColor(Color(hex: 0x1B4332))
                         + Text(" Balanced double-entry postings are created automatically when — and only when — a verified payment webhook is received from the provider.").font(.inter(13)).foregroundColor(Color(hex: 0x1B4332)))
                    }
                    .padding(14)
                    .background(Color(hex: 0xE8F6EC))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                    Text("This panel is informational. There is no manual reconcile action: the system is server-authoritative, so there is nothing for an admin to post, edit, or true up by hand.")
                        .font(.inter(13)).foregroundStyle(Nuru.ink600)

                    VStack(alignment: .leading, spacing: 8) {
                        bullet("Confirmed payments post balanced debit/credit entries.")
                        bullet("Refunds create reversal entries rather than editing history (append-only).")
                        bullet("Pending or failed payments never touch the ledger.")
                    }
                }
                .padding(22)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Nuru.paper)
            .navigationTitle("Reconciliation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Close") { dismiss() } } }
        }
    }

    private func bullet(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Text("•").font(.inter(13)).foregroundStyle(Nuru.ink600)
            Text(text).font(.inter(13)).foregroundStyle(Nuru.ink600)
        }
    }
}
