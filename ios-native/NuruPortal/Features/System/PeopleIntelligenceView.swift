// People Intelligence — an admin-only analytics surface that joins the LIVE
// reporting, members, congregation and finance reads into one "who are our people,
// how engaged are they, who gives" console. Matches the Dashboard's pastel KPI look
// and the premium table style used in Finance / the System pages.
//
// HONESTY RULE (same as Finance): every number on this page is computed from a real
// endpoint (reports/overview · reports/engagement · reports/levels · /admin/members
// · /admin/congregations · /admin/finance/summary · /admin/finance/transactions).
// Where a metric needs telemetry the backend does not expose yet — device split,
// app-version adoption, last-seen recency, per-area time-spent, location/proximity —
// we render a clean, clearly-labelled "coming with backend telemetry" / "coming soon"
// card. We never fabricate a figure.
import SwiftUI
import Charts

// MARK: - Page-local decoders (resilient; default any missing field)

/// Finance transactions page row — only the fields this page needs.
private struct PiTxnRow: Codable, Identifiable {
    @DefaultEmpty var transactionId: String
    let fullName: String?
    @DefaultZero var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var status: String
    let fund: String?
    let method: String?
    @DefaultEmpty var createdAt: String
    var id: String { transactionId.isEmpty ? UUID().uuidString : transactionId }
}
private struct PiTxnPage: Codable { let data: [PiTxnRow]; let nextCursor: String? }

// MARK: - Page-local reads (actor APIClient, convertFromSnakeCase)

private enum PeopleAPI {
    static func overview() async throws -> OverviewKpis {
        try await APIClient.shared.get("/admin/reports/overview", as: OverviewKpis.self)
    }
    static func engagement() async throws -> EngagementReport {
        try await APIClient.shared.get("/admin/reports/engagement", as: EngagementReport.self)
    }
    static func levels() async throws -> [LevelAnalyticsRow] {
        try await APIClient.shared.get("/admin/reports/levels", as: LevelsReport.self).levels
    }
    static func members() async throws -> [MemberRow] {
        try await APIClient.shared.get("/admin/members", as: MembersPage.self).data
    }
    static func congregations() async throws -> [Congregation] {
        try await APIClient.shared.get("/admin/congregations", as: DataList<Congregation>.self).data
    }
    static func funds() async throws -> [FundSummary] {
        try await APIClient.shared.get("/admin/finance/summary", as: FinanceSummary.self).funds
    }
    static func transactions(limit: Int = 200) async throws -> [PiTxnRow] {
        try await APIClient.shared.get("/admin/finance/transactions", query: ["limit": String(limit)], as: PiTxnPage.self).data
    }
}

// MARK: - Tokens / helpers

private enum PiTone {
    // Engagement band colours (brand-aligned; no off-brand blue).
    static let thriving = Color(hex: 0x16A34A)   // lumGreen-family
    static let steady   = Color(hex: 0x1F3A6B)   // navy
    static let watch    = Color(hex: 0xC89B3C)   // gold / amber
    static let atRisk   = Color(hex: 0xDC2626)   // red
}

private let BANDS: [(key: String, name: String, color: Color)] = [
    ("thriving", "Thriving", PiTone.thriving),
    ("steady",   "Steady",   PiTone.steady),
    ("watch",    "Watch",    PiTone.watch),
    ("at_risk",  "At-risk",  PiTone.atRisk),
]

/// Normalise a member's band into one of the four canonical keys.
private func canonicalBand(_ band: String?) -> String {
    switch band?.lowercased() {
    case "thriving", "high":          return "thriving"
    case "steady", "medium":          return "steady"
    case "watch":                     return "watch"
    case "at_risk", "at risk", "low": return "at_risk"
    default:                          return "steady"
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
private func methodColor(_ m: String?) -> Color {
    switch m {
    case "mpesa":  return Color(hex: 0x0F6B33)
    case "airtel": return Color(hex: 0xB42318)
    case "paypal": return Color(hex: 0x1D4E86)
    case "card", "stripe": return Color(hex: 0x8A6B1F)
    default:       return Nuru.ink600
    }
}
private func isConfirmed(_ s: String) -> Bool {
    s == "confirmed" || s == "settled" || s == "succeeded"
}

// MARK: - Derived rollups

private struct TopGiver: Identifiable {
    let name: String
    var count: Int = 0
    var totalMinor: Int = 0
    var currency: String = "KES"
    var avgMinor: Int { count > 0 ? totalMinor / count : 0 }
    var id: String { name }
}
private struct MethodStat: Identifiable {
    let key: String
    var totalMinor: Int = 0
    var count: Int = 0
    var currency: String = "KES"
    var id: String { key }
}
private struct CongStat: Identifiable {
    let name: String
    var members: Int = 0
    var id: String { name }
}

// MARK: - ===================== PeopleIntelligenceView =====================

struct PeopleIntelligenceView: View {
    @State private var loaded = false
    @State private var error: String?

    @State private var overview: OverviewKpis?
    @State private var bands: [String: Int] = [:]
    @State private var levels: [LevelAnalyticsRow] = []
    @State private var members: [MemberRow] = []
    @State private var congregations: [Congregation] = []
    @State private var funds: [FundSummary] = []
    @State private var txns: [PiTxnRow] = []

    // MARK: derived — giving

    private var currency: String {
        var totals: [String: Int] = [:]
        for f in funds { totals[(f.currency ?? "KES"), default: 0] += f.totalMinor }
        return totals.max { $0.value < $1.value }?.key ?? funds.first?.currency ?? "KES"
    }
    private var allTotalMinor: Int { funds.reduce(0) { $0 + $1.totalMinor } }
    private var giftCount: Int { funds.reduce(0) { $0 + $1.giftCount } }
    private var avgGiftMinor: Int { giftCount > 0 ? allTotalMinor / giftCount : 0 }

    /// Confirmed transactions only — the honest basis for per-giver intelligence.
    private var confirmedTxns: [PiTxnRow] { txns.filter { isConfirmed($0.status) } }

    private var topGivers: [TopGiver] {
        var map: [String: TopGiver] = [:]
        for t in confirmedTxns {
            let name = (t.fullName?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? "Anonymous"
            var g = map[name] ?? TopGiver(name: name)
            g.count += 1
            g.totalMinor += t.amountMinor
            if !t.currency.isEmpty { g.currency = t.currency }
            map[name] = g
        }
        return map.values.sorted { $0.totalMinor > $1.totalMinor }
    }
    private var activeGivers: Int { topGivers.filter { $0.name != "Anonymous" }.count }
    private var avgPerTxnMinor: Int {
        let c = confirmedTxns.count
        guard c > 0 else { return avgGiftMinor }
        return confirmedTxns.reduce(0) { $0 + $1.amountMinor } / c
    }

    private var methodStats: [MethodStat] {
        var map: [String: MethodStat] = [:]
        for t in confirmedTxns {
            let key = (t.method?.isEmpty == false) ? t.method! : "other"
            var s = map[key] ?? MethodStat(key: key)
            s.count += 1
            s.totalMinor += t.amountMinor
            if !t.currency.isEmpty { s.currency = t.currency }
            map[key] = s
        }
        return map.values.sorted { $0.totalMinor > $1.totalMinor }
    }

    // MARK: derived — people

    private var bandSlices: [(name: String, value: Int, color: Color)] {
        // Prefer the engagement-report bands; fall back to counting members by band.
        if bands.values.reduce(0, +) > 0 {
            return BANDS.map { ($0.name, bands[$0.key] ?? 0, $0.color) }
        }
        var counts: [String: Int] = [:]
        for m in members { counts[canonicalBand(m.band), default: 0] += 1 }
        return BANDS.map { ($0.name, counts[$0.key] ?? 0, $0.color) }
    }
    private var bandTotal: Int { bandSlices.reduce(0) { $0 + $1.value } }

    /// Members per congregation — counted from the members list by cell→congregation
    /// is not exposed, so we count by the congregation memberCount where present and
    /// fall back to per-cell member grouping from the members list.
    private var congStats: [CongStat] {
        // The congregations endpoint exposes memberCount directly — trust it.
        if congregations.contains(where: { $0.memberCount > 0 }) {
            return congregations
                .map { CongStat(name: $0.name, members: $0.memberCount) }
                .filter { $0.members > 0 }
                .sorted { $0.members > $1.members }
        }
        return []
    }
    private var congMax: Int { congStats.map(\.members).max() ?? 1 }

    // MARK: body

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(spacing: 18) {
                    if let error { errorNote(error) }
                    if !loaded && overview == nil {
                        SkeletonList(rows: 6)
                    } else {
                        overviewStrip                 // 1 — REAL
                        EngagementSection(slices: bandSlices, total: bandTotal,
                                          avgEngagement: overview?.avgEngagement ?? 0,
                                          levels: levels)   // 2 — REAL
                        GivingSection(currency: currency, allTotalMinor: allTotalMinor,
                                      giftCount: giftCount, avgPerTxnMinor: avgPerTxnMinor,
                                      activeGivers: activeGivers, topGivers: topGivers,
                                      methodStats: methodStats, funds: funds)   // 3 — REAL
                        CongregationSection(stats: congStats, max: congMax,
                                            levels: levels)   // 4 — REAL
                        AppUsageSection(activeInApp: overview?.activeLearners ?? 0,
                                        totalMembers: overview?.totalMembers ?? members.count)  // 5 — REAL hero + coming
                        ProximitySection()   // 6 — coming soon
                    }
                }
                .padding(.horizontal, Nuru.S.lg)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, 48)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load() } }
        .refreshable { await load() }
    }

    private func errorNote(_ m: String) -> some View {
        Card { Text(m).font(.nCaption).foregroundStyle(Nuru.danger).frame(maxWidth: .infinity, alignment: .leading) }
    }

    // MARK: hero

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                Text("System").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                Text("People Intelligence").font(.nMicro).foregroundStyle(.white)
                Spacer(minLength: 8)
                HeroChip(label: "Admin only", icon: "lock.fill", style: .tag)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("PEOPLE & GROWTH").font(.nOverline).tracking(1.8).foregroundStyle(Nuru.goldGlow)
                Text("People Intelligence").font(.nDisplay).foregroundStyle(.white)
                Text("Who your people are, how engaged they are, and who gives — joined from live reporting, membership and giving.")
                    .font(.nBody).foregroundStyle(Nuru.onNavyDim).fixedSize(horizontal: false, vertical: true)
            }
            heroStatStrip
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, 22).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private var heroStatStrip: some View {
        let o = overview
        let items: [(label: String, value: String, hint: String)] = [
            ("Members", "\(o?.totalMembers ?? members.count)", "on the pathway"),
            ("Active in app", "\(o?.activeLearners ?? 0)", "last 7 days"),
            ("Avg engagement", Pctf(o?.avgEngagement ?? 0), "last 7 days"),
            ("At risk", "\(o?.membersAtRisk ?? 0)", "need attention"),
            ("Givers", "\(activeGivers)", "named, confirmed"),
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

    // MARK: 1 — Overview KPI strip (pastel Dashboard-style tiles)

    private let kpiGrid = [GridItem(.adaptive(minimum: 132), spacing: 12)]

    private var overviewStrip: some View {
        let o = overview
        return VStack(alignment: .leading, spacing: 10) {
            sectionTitle(icon: "person.3.fill", "Overview", "Live membership & engagement signal")
            LazyVGrid(columns: kpiGrid, spacing: 12) {
                PiKpiTile(label: "Total members", value: "\(o?.totalMembers ?? members.count)", icon: "person.3.fill",
                          tint: .init(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)))
                PiKpiTile(label: "Active in app (7d)", value: "\(o?.activeLearners ?? 0)", icon: "iphone.gen3",
                          tint: .init(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33)))
                PiKpiTile(label: "Avg engagement", value: Pctf(o?.avgEngagement ?? 0), icon: "chart.bar.xaxis",
                          tint: .init(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F)))
                PiKpiTile(label: "Members at risk", value: "\(o?.membersAtRisk ?? 0)", icon: "exclamationmark.triangle.fill",
                          tint: .init(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xB42318)))
                PiKpiTile(label: "Cohorts", value: "\(o?.cohortsRunning ?? 0)", icon: "person.2.wave.2.fill",
                          tint: .init(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x6D28D9)))
                PiKpiTile(label: "Certificates (mo.)", value: "\(o?.certificatesThisMonth ?? 0)", icon: "rosette",
                          tint: .init(bg: Color(hex: 0xE2F4F1), fg: Color(hex: 0x0D7E73)))
            }
        }
    }

    // MARK: loader

    private func load() async {
        async let o = try? PeopleAPI.overview()
        async let e = try? PeopleAPI.engagement()
        async let l = try? PeopleAPI.levels()
        async let m = try? PeopleAPI.members()
        async let c = try? PeopleAPI.congregations()
        async let f = try? PeopleAPI.funds()
        async let t = try? PeopleAPI.transactions(limit: 200)

        overview = await o
        bands = (await e)?.bands ?? [:]
        levels = await l ?? []
        members = await m ?? []
        congregations = await c ?? []
        funds = await f ?? []
        txns = await t ?? []

        if overview == nil && members.isEmpty && funds.isEmpty {
            error = "Could not load people intelligence. Pull to refresh."
        } else {
            error = nil
        }
        loaded = true
    }
}

// MARK: - Shared small pieces

private func sectionTitle(icon: String, _ title: String, _ caption: String) -> some View {
    HStack(spacing: 8) {
        TintedIcon(systemName: icon, color: Nuru.navy, size: 30)
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        Spacer(minLength: 0)
    }
}

/// Pastel KPI tile (Dashboard-parity), non-interactive (this is a read surface).
private struct PiKpiTile: View {
    let label: String, value: String, icon: String
    let tint: Nuru.Tint
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TintedIcon(systemName: icon, color: tint.fg, size: 34)
            Text(value).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.inter(11.5, .medium)).foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(tint.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(tint.fg.opacity(0.18), lineWidth: 1))
    }
}

/// Card header used inside the white section cards (matches Finance/Dashboard).
private struct PiCardHeader: View {
    let icon: String, title: String, caption: String
    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(Nuru.navy)
            Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
            Spacer(minLength: 8)
            Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
    }
}

/// Honest dim placeholder describing telemetry not yet exposed.
private struct ComingCard: View {
    let icon: String
    let title: String
    let blurb: String
    let bullets: [String]
    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: icon, color: Nuru.goldLo, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        Text("Coming with backend telemetry").font(.nMicro).foregroundStyle(Nuru.goldLo)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "hourglass").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
                }
                Text(blurb).font(.inter(12)).foregroundStyle(Nuru.ink600)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(bullets, id: \.self) { b in
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: "circle.dashed").font(.system(size: 9)).foregroundStyle(Nuru.ink300).padding(.top, 3)
                            Text(b).font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
        }
    }
}

// MARK: - 2 — Engagement & growth (REAL)

private struct EngagementSection: View {
    let slices: [(name: String, value: Int, color: Color)]
    let total: Int
    let avgEngagement: Double
    let levels: [LevelAnalyticsRow]

    private struct Slice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var donutSlices: [Slice] { slices.map { Slice(name: $0.name, value: $0.value, color: $0.color) } }

    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 16) {
                PiCardHeader(icon: "chart.pie.fill", title: "Engagement & growth",
                             caption: "\(total) learners · \(Pctf(avgEngagement)) avg")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 14, alignment: .top)], spacing: 14) {
                    donutPanel
                    breakdownPanel
                    levelPanel
                }
                // Honest note about per-discipline scoring.
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle").font(.system(size: 11)).foregroundStyle(Nuru.ink400).padding(.top, 1)
                    Text("Per-member discipline scores (Word, prayer, attendance, habits) aren't exposed as an admin aggregate — engagement band and curriculum completion stand in as the growth proxy. A per-discipline score breakdown is coming with backend telemetry.")
                        .font(.inter(11)).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var donutPanel: some View {
        panel(title: "Engagement bands", trailing: "\(total) learners") {
            ZStack {
                Chart(total == 0 ? [Slice(name: "None", value: 1, color: Nuru.border)] : donutSlices) { s in
                    SectorMark(angle: .value("v", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                        .foregroundStyle(s.color).cornerRadius(3)
                }
                .chartLegend(.hidden)
                .frame(height: 168)
                VStack(spacing: 2) {
                    Text("\(total)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                    Text("LEARNERS").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                }
            }
        }
    }

    private var breakdownPanel: some View {
        panel(title: "Band breakdown", trailing: "by band") {
            VStack(spacing: 0) {
                ForEach(Array(donutSlices.enumerated()), id: \.element.id) { i, d in
                    HStack {
                        Circle().fill(d.color).frame(width: 9, height: 9)
                        Text(d.name).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                        Spacer()
                        Text("\(d.value)").font(.fraunces(16, .medium)).foregroundStyle(Nuru.navy)
                        Text(total > 0 ? "\(Int((Double(d.value)/Double(total)*100).rounded()))%" : "0%")
                            .font(.nMicro).foregroundStyle(Nuru.ink600).frame(width: 38, alignment: .trailing)
                    }
                    .padding(.vertical, 10)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
            }
        }
    }

    private struct LevelBar: Identifiable { let level: String; let learners: Int; var id: String { level } }
    private var levelPanel: some View {
        let bars = levels.sorted { $0.levelNumber < $1.levelNumber }
            .map { LevelBar(level: "L\($0.levelNumber)", learners: $0.learners) }
        return panel(title: "Per-level distribution", trailing: "learners") {
            if bars.allSatisfy({ $0.learners == 0 }) {
                Text("No level enrolment recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 168)
            } else {
                Chart(bars) { b in
                    BarMark(x: .value("Level", b.level), y: .value("Learners", b.learners), width: .fixed(18))
                        .foregroundStyle(Nuru.gold).cornerRadius(4)
                }
                .chartXAxis {
                    AxisMarks { _ in AxisValueLabel().font(.inter(10)).foregroundStyle(Color(hex: 0x6B7280)) }
                }
                .chartYAxis {
                    AxisMarks { value in
                        AxisGridLine().foregroundStyle(Nuru.border)
                        AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(Color(hex: 0x6B7280)) } }
                    }
                }
                .frame(height: 168)
            }
        }
    }

    private func panel<C: View>(title: String, trailing: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                Spacer()
                Text(trailing).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// MARK: - 3 — Giving intelligence (REAL)

private struct GivingSection: View {
    let currency: String
    let allTotalMinor: Int
    let giftCount: Int
    let avgPerTxnMinor: Int
    let activeGivers: Int
    let topGivers: [TopGiver]
    let methodStats: [MethodStat]
    let funds: [FundSummary]

    private let kpiGrid = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(icon: "gift.fill", "Giving intelligence", "Confirmed transactions · recent page")
            LazyVGrid(columns: kpiGrid, spacing: 12) {
                PiKpiTile(label: "Total gifts", value: giftCount.formatted(), icon: "number",
                          tint: .init(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)))
                PiKpiTile(label: "Avg / transaction", value: Fmt.money(minor: avgPerTxnMinor, currency: currency), icon: "divide.circle.fill",
                          tint: .init(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x6D28D9)))
                PiKpiTile(label: "Active givers", value: activeGivers.formatted(), icon: "person.crop.circle.badge.checkmark",
                          tint: .init(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33)))
            }
            topGiversCard
            byMethodCard
            byFundCard
        }
    }

    // Premium TOP GIVERS table (Name · Gifts · Total · Avg)
    private enum Col { static let gifts: CGFloat = 52; static let total: CGFloat = 104; static let avg: CGFloat = 92 }

    private var topGiversCard: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "trophy.fill").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Top givers").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("by total · confirmed").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)

                HStack(spacing: 10) {
                    Text("GIVER").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    head("GIFTS", Col.gifts)
                    head("TOTAL", Col.total)
                    head("AVG", Col.avg)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)

                if topGivers.isEmpty {
                    Text("No confirmed gifts in the recent transactions page.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                } else {
                    ForEach(Array(topGivers.prefix(12).enumerated()), id: \.element.id) { i, g in
                        row(g, rank: i + 1, zebra: i % 2 == 1)
                        if i < min(topGivers.count, 12) - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                    Text("Top \(min(topGivers.count, 12)) of \(topGivers.count) givers · grouped from the recent confirmed transactions page.")
                        .font(.inter(10.5)).foregroundStyle(Nuru.ink400)
                        .padding(.horizontal, 16).padding(.vertical, 12)
                }
            }
        }
    }

    private func head(_ s: String, _ w: CGFloat) -> some View {
        Text(s).font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: w, alignment: .trailing)
    }

    private func row(_ g: TopGiver, rank: Int, zebra: Bool) -> some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(rank <= 3 ? Nuru.gold.opacity(0.16) : Nuru.inputBg)
                    Text("\(rank)").font(.inter(11, .bold)).foregroundStyle(rank <= 3 ? Nuru.goldLo : Nuru.ink600)
                }.frame(width: 26, height: 26)
                Monogram(name: g.name, size: 30, gradient: Nuru.navyGradient)
                Text(g.name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(g.count)").font(.inter(13, .semibold)).monospacedDigit().foregroundStyle(Nuru.ink600)
                .frame(width: Col.gifts, alignment: .trailing)
            Text(Fmt.money(minor: g.totalMinor, currency: g.currency))
                .font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.55).frame(width: Col.total, alignment: .trailing)
            Text(Fmt.money(minor: g.avgMinor, currency: g.currency))
                .font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.6).frame(width: Col.avg, alignment: .trailing)
        }
        .padding(.horizontal, 16).frame(minHeight: 52)
        .background(zebra ? Nuru.surface.opacity(0.45) : Color.clear)
    }

    // Giving by method — mini bar chart
    private struct MBar: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var byMethodCard: some View {
        let bars = methodStats.map { MBar(name: methodLabel($0.key), value: Int((Double($0.totalMinor) / 100).rounded()), color: methodColor($0.key)) }
        let total = bars.reduce(0) { $0 + $1.value }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.bar.fill", title: "Giving by method", caption: "confirmed · \(currency)")
                if bars.isEmpty {
                    Text("No confirmed gifts yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Amount", b.value), y: .value("Method", b.name), height: .fixed(18))
                            .foregroundStyle(b.color).cornerRadius(4)
                    }
                    .chartXAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let v = value.as(Int.self) {
                                    Text(v >= 1000 ? "\(Int((Double(v)/1000).rounded()))k" : "\(v)").font(.inter(10)).foregroundStyle(Color(hex: 0x6B7280))
                                }
                            }
                        }
                    }
                    .chartYAxis { AxisMarks { _ in AxisValueLabel().font(.inter(11)).foregroundStyle(Nuru.navy) } }
                    .frame(height: max(80, CGFloat(bars.count) * 38)).padding(.top, 12)
                    VStack(spacing: 6) {
                        ForEach(bars) { b in
                            HStack(spacing: 8) {
                                RoundedRectangle(cornerRadius: 3).fill(b.color).frame(width: 10, height: 10)
                                Text(b.name).font(.inter(12, .medium)).foregroundStyle(Nuru.navy)
                                Spacer(minLength: 6)
                                Text("\(currency) \(b.value.formatted())").font(.inter(12, .semibold)).monospaced().foregroundStyle(Nuru.navy)
                                Text(total > 0 ? "\(Int((Double(b.value)/Double(total)*100).rounded()))%" : "0%")
                                    .font(.inter(11)).foregroundStyle(Nuru.ink600).frame(width: 34, alignment: .trailing)
                            }
                        }
                    }
                    .padding(.top, 10)
                }
            }
        }
    }

    // Giving by fund — pastel rows with % bars (reuses ProgressBar)
    private var byFundCard: some View {
        let total = funds.reduce(0) { $0 + $1.totalMinor }
        let sorted = funds.sorted { $0.totalMinor > $1.totalMinor }.filter { $0.totalMinor > 0 }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                PiCardHeader(icon: "tray.full.fill", title: "Giving by fund", caption: "all-time · \(currency)")
                if sorted.isEmpty {
                    Text("No fund giving recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    VStack(spacing: 12) {
                        ForEach(Array(sorted.enumerated()), id: \.element.id) { i, f in
                            let pct = total > 0 ? Double(f.totalMinor) / Double(total) : 0
                            let tint = Nuru.tint(i)
                            VStack(spacing: 6) {
                                HStack {
                                    Circle().fill(tint.fg).frame(width: 9, height: 9)
                                    Text(f.name).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                    Spacer(minLength: 6)
                                    Text(Fmt.money(minor: f.totalMinor, currency: f.currency ?? currency))
                                        .font(.inter(12.5, .semibold)).monospaced().foregroundStyle(Nuru.navy)
                                        .lineLimit(1).minimumScaleFactor(0.7)
                                    Text("\(Int((pct*100).rounded()))%").font(.nMicro).foregroundStyle(Nuru.ink600).frame(width: 34, alignment: .trailing)
                                }
                                ProgressBar(pct: pct * 100, fill: tint.fg, height: 6)
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - 4 — Congregation / area concentration (REAL)

private struct CongregationSection: View {
    let stats: [CongStat]
    let max: Int
    let levels: [LevelAnalyticsRow]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(icon: "building.columns.fill", "Congregation & level concentration", "Where your people are")
            concentrationCard
            levelTableCard
        }
    }

    private var concentrationCard: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "building.2.fill").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Members per congregation").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("\(stats.count) branches").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                Divider().overlay(Nuru.border)
                if stats.isEmpty {
                    Text("No congregation member counts available.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                } else {
                    ForEach(Array(stats.prefix(12).enumerated()), id: \.element.id) { i, s in
                        HStack(spacing: 12) {
                            TintedIcon(systemName: "building.columns", color: Nuru.brandTint(i).fg, size: 28)
                            Text(s.name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                                .frame(width: 130, alignment: .leading)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Nuru.track)
                                    Capsule().fill(Nuru.brandTint(i).fg)
                                        .frame(width: geo.size.width * CGFloat(s.members) / CGFloat(Swift.max(max, 1)))
                                }
                            }
                            .frame(height: 10)
                            Text("\(s.members)").font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                .frame(width: 52, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).frame(minHeight: 50)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < min(stats.count, 12) - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }

    // Per-level table (Level · Learners · Completion · Certs) from reports/levels.
    private enum Col { static let learners: CGFloat = 72; static let comp: CGFloat = 84; static let certs: CGFloat = 56 }
    private var levelTableCard: some View {
        let rows = levels.sorted { $0.levelNumber < $1.levelNumber }
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "list.bullet.indent").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Membership by level").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("pathway distribution").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)

                HStack(spacing: 10) {
                    Text("LEVEL").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    head("LEARNERS", Col.learners)
                    head("DONE", Col.comp)
                    head("CERTS", Col.certs)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)

                if rows.isEmpty {
                    Text("No level analytics available.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                        HStack(spacing: 10) {
                            HStack(spacing: 10) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Nuru.brandTint(i).bg)
                                    Text("\(r.levelNumber)").font(.inter(12, .bold)).foregroundStyle(Nuru.brandTint(i).fg)
                                }.frame(width: 28, height: 28)
                                Text(r.title.isEmpty ? "Level \(r.levelNumber)" : r.title)
                                    .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(r.learners)").font(.inter(13, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                .frame(width: Col.learners, alignment: .trailing)
                            Text("\(Int(r.completionPct.rounded()))%").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                .frame(width: Col.comp, alignment: .trailing)
                            Text("\(r.certificates)").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                .frame(width: Col.certs, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).frame(minHeight: 50)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < rows.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }

    private func head(_ s: String, _ w: CGFloat) -> some View {
        Text(s).font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: w, alignment: .trailing)
    }
}

// MARK: - 5 — App usage & devices (REAL active-in-app + labelled coming)

private struct AppUsageSection: View {
    let activeInApp: Int
    let totalMembers: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(icon: "iphone.gen3", "App usage & devices", "Real signal today · richer telemetry coming")
            // REAL: active-in-app prominence.
            Card(padding: 18) {
                HStack(spacing: 18) {
                    TintedIcon(systemName: "wave.3.right", color: Color(hex: 0x0F6B33), size: 56)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Active in app").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                        Text("\(activeInApp)").font(.fraunces(34, .semibold)).foregroundStyle(Nuru.navy)
                        Text("distinct members with an app interaction in the last 7 days")
                            .font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 3) {
                        let pct = totalMembers > 0 ? Double(activeInApp) / Double(totalMembers) * 100 : 0
                        Text("\(Int(pct.rounded()))%").font(.fraunces(26, .semibold)).foregroundStyle(Color(hex: 0x0F6B33))
                        Text("of \(totalMembers) members").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }
            }
            // Labelled coming.
            ComingCard(
                icon: "iphone.and.arrow.forward",
                title: "Devices & app affinity",
                blurb: "These signals are stored in the data layer (push_tokens.platform, client_devices.platform / app_version / last_seen_at, interaction_events) but there's no admin endpoint to aggregate them yet, so nothing here is fetched or estimated.",
                bullets: [
                    "iOS vs Android split, and per-device-model breakdown",
                    "App-version adoption — who's on the latest build",
                    "Last-seen recency cohorts (today / this week / dormant)",
                    "Which app areas members spend the most time in — 'what they love'",
                    "Login frequency over time, and session streaks",
                ]
            )
        }
    }
}

// MARK: - 6 — Location & proximity matching (coming soon)

private struct ProximitySection: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle(icon: "mappin.and.ellipse", "Location & proximity matching", "Forward-looking")
            Card(padding: 18) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 10) {
                        TintedIcon(systemName: "point.3.connected.trianglepath.dotted", color: Color(hex: 0x6D28D9), size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Pair nearby members into the same cell").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                            Text("Coming soon").font(.nMicro).foregroundStyle(Color(hex: 0x6D28D9))
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "sparkles").font(.system(size: 14)).foregroundStyle(Nuru.gold)
                    }
                    Text("With opt-in location tagging we'll surface members who live near each other and suggest pairing them into the same cell or group — so no one is discipled in isolation. This is a planned feature; no coordinates are collected or shown today, and nothing here is estimated.")
                        .font(.inter(12)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach([
                            "Opt-in, privacy-first location tags (city / area, never precise coordinates in the admin view)",
                            "Proximity clusters that respect congregation and language boundaries",
                            "One-tap 'suggest a cell' that proposes a group from nearby unassigned members",
                            "Travel-aware reassignment when a member relocates",
                        ], id: \.self) { b in
                            HStack(alignment: .top, spacing: 8) {
                                Image(systemName: "circle.dashed").font(.system(size: 9)).foregroundStyle(Nuru.ink300).padding(.top, 3)
                                Text(b).font(.inter(11.5)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
            }
        }
    }
}
