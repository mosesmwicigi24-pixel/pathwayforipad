// People Intelligence — an admin-only analytics console answering "who are our
// people, how engaged are they, who gives, and how do they use the app". This view
// consumes ONE real backend endpoint — GET /admin/analytics/intelligence — which is
// already live in prod and powering the web portal's Member Intelligence page. The
// previous piecemeal multi-endpoint aggregation has been replaced entirely.
//
// Look: dashboard-clean COLORED — pastel KPI tiles with TintedIcon chips (like
// DashboardView) and premium tables (like FinanceView). Brand palette only — navy +
// gold + bright lumGreen; no off-brand blue; light scheme; soft shadows.
//
// HONESTY RULE: every number rendered here maps to a real field in the payload. The
// backend itself flags FOUR genuinely-missing telemetry bits via boolean capture
// flags (model_capture / screen_dwell_capture / login_capture / geo_capture). Where a
// flag is false we render a small dim "coming" note — we never fabricate a figure.
// Decoding is resilient: every field defaults if missing, so a partial payload still
// renders the sections it can.
import SwiftUI
import Charts

// MARK: - ===================== Payload (resilient decoders) =====================
// APIClient uses convertFromSnakeCase, so snake_case keys map to camelCase here.

private struct IntelKpis: Codable {
    @DefaultZero var totalMembers: Int
    @DefaultZero var active7d: Int
    @DefaultZero var active30d: Int
    @DefaultZeroD var avgEngagement: Double      // 0..100, already 1-decimal
    @DefaultZero var membersAtRisk: Int
    @DefaultZero var cohorts: Int
    @DefaultZero var givers: Int
    @DefaultZero var recurringGivers: Int
    @DefaultZero var certificatesThisMonth: Int
}

private struct IntelFundRow: Codable, Identifiable {
    @DefaultEmpty var code: String
    @DefaultZero var totalMinor: Int
    @DefaultZero var count: Int
    var id: String { code }
}
private struct IntelMethodRow: Codable, Identifiable {
    @DefaultEmpty var method: String
    @DefaultZero var schedules: Int
    @DefaultZero var givers: Int
    var id: String { method }
}
private struct IntelTopGiver: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var name: String
    @DefaultZero var totalMinor: Int
    @DefaultZero var gifts: Int
    @DefaultZero var avgMinor: Int
    let lastAt: String?
    var id: String { userId.isEmpty ? name : userId }
}
private struct IntelFreqRow: Codable, Identifiable {
    @DefaultEmpty var bucket: String     // "1" | "2-3" | "4-6" | "7+"
    @DefaultZero var givers: Int
    var id: String { bucket }
}
private struct IntelTrendRow: Codable, Identifiable {
    @DefaultEmpty var month: String
    @DefaultZero var totalMinor: Int
    var id: String { month }
}
private struct IntelGiving: Codable {
    @DefaultZero var totalMinor: Int
    @DefaultZero var giftCount: Int
    @DefaultZero var avgPerTxnMinor: Int
    @DefaultZero var medianMinor: Int
    @DefaultZero var givers: Int
    @DefaultEmpty var currency: String
    private let byFundRaw: [IntelFundRow]?
    private let byMethodRaw: [IntelMethodRow]?
    private let topGiversRaw: [IntelTopGiver]?
    private let frequencyRaw: [IntelFreqRow]?
    private let trendRaw: [IntelTrendRow]?
    var byFund: [IntelFundRow] { byFundRaw ?? [] }
    var byMethod: [IntelMethodRow] { byMethodRaw ?? [] }
    var topGivers: [IntelTopGiver] { topGiversRaw ?? [] }
    var frequency: [IntelFreqRow] { frequencyRaw ?? [] }
    var trend: [IntelTrendRow] { trendRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case totalMinor, giftCount, avgPerTxnMinor, medianMinor, givers, currency
        case byFundRaw = "byFund", byMethodRaw = "byMethod", topGiversRaw = "topGivers"
        case frequencyRaw = "frequency", trendRaw = "trend"
    }
}

private struct IntelPlatform: Codable, Identifiable {
    @DefaultEmpty var platform: String
    @DefaultZero var members: Int
    var id: String { platform }
}
private struct IntelAppVersion: Codable, Identifiable {
    @DefaultEmpty var appVersion: String
    @DefaultZero var members: Int
    var id: String { appVersion }
}
private struct IntelDeviceModel: Codable, Identifiable {
    @DefaultEmpty var model: String
    @DefaultZero var members: Int
    var id: String { model }
}
private struct IntelDevices: Codable {
    private let platformsRaw: [IntelPlatform]?
    private let appVersionsRaw: [IntelAppVersion]?
    private let modelsRaw: [IntelDeviceModel]?
    @DefaultFalse var modelCapture: Bool
    var platforms: [IntelPlatform] { platformsRaw ?? [] }
    var appVersions: [IntelAppVersion] { appVersionsRaw ?? [] }
    var models: [IntelDeviceModel] { modelsRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case platformsRaw = "platforms", appVersionsRaw = "appVersions"
        case modelsRaw = "models", modelCapture
    }
}

private struct IntelActiveTrendRow: Codable, Identifiable {
    @DefaultEmpty var week: String       // "YYYY-MM-DD" (week start), oldest→newest
    @DefaultZero var active: Int
    var id: String { week }
}
private struct IntelActiveDaysRow: Codable, Identifiable {
    @DefaultEmpty var bucket: String     // "1" | "2-3" | "4-7" | "8-15" | "16+"
    @DefaultZero var members: Int
    var id: String { bucket }
}
private struct IntelActivity: Codable {
    private let activeTrendRaw: [IntelActiveTrendRow]?
    private let activeDaysRaw: [IntelActiveDaysRow]?
    var activeTrend: [IntelActiveTrendRow] { activeTrendRaw ?? [] }
    var activeDays: [IntelActiveDaysRow] { activeDaysRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case activeTrendRaw = "activeTrend", activeDaysRaw = "activeDays"
    }
}

private struct IntelBand: Codable, Identifiable {
    @DefaultEmpty var band: String       // thriving | steady | watch | at_risk
    @DefaultZero var members: Int
    var id: String { band }
}
private struct IntelKind: Codable, Identifiable {
    @DefaultEmpty var kind: String       // lesson_open | scripture_read | video_75pct | ...
    @DefaultZero var events: Int
    @DefaultZero var members: Int
    var id: String { kind }
}
private struct IntelHour: Codable, Identifiable {
    @DefaultZero var hour: Int           // 0..23
    @DefaultZero var events: Int
    var id: Int { hour }
}
// #3 app-area dwell — time spent per app area (only meaningful once
// screen_dwell_capture is true; rows arrive sorted by total_ms desc).
private struct IntelAreaDwell: Codable, Identifiable {
    @DefaultEmpty var screen: String
    @DefaultZero var totalMs: Int
    @DefaultZero var sessions: Int
    @DefaultZero var members: Int
    var id: String { screen }
}
private struct IntelEngagement: Codable {
    private let bandsRaw: [IntelBand]?
    private let byKindRaw: [IntelKind]?
    private let byHourRaw: [IntelHour]?
    private let areaDwellRaw: [IntelAreaDwell]?
    @DefaultFalse var screenDwellCapture: Bool
    @DefaultFalse var loginCapture: Bool
    var bands: [IntelBand] { bandsRaw ?? [] }
    var byKind: [IntelKind] { byKindRaw ?? [] }
    var byHour: [IntelHour] { byHourRaw ?? [] }
    var areaDwell: [IntelAreaDwell] { areaDwellRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case bandsRaw = "bands", byKindRaw = "byKind", byHourRaw = "byHour"
        case areaDwellRaw = "areaDwell"
        case screenDwellCapture, loginCapture
    }
}

private struct IntelLevelRow: Codable, Identifiable {
    @DefaultZero var levelNumber: Int
    @DefaultZero var learners: Int
    @DefaultZero var completed: Int
    var id: Int { levelNumber }
}
private struct IntelGrowth: Codable {
    private let byLevelRaw: [IntelLevelRow]?
    @DefaultZero var verseLearners: Int
    @DefaultZero var versesMastered: Int
    @DefaultZero var plansCompleted: Int
    @DefaultZero var plansActive: Int
    @DefaultZero var quizAttempts: Int
    @DefaultZero var quizPassed: Int
    var byLevel: [IntelLevelRow] { byLevelRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case byLevelRaw = "byLevel"
        case verseLearners, versesMastered, plansCompleted, plansActive, quizAttempts, quizPassed
    }
}

private struct IntelCity: Codable, Identifiable {
    @DefaultEmpty var city: String
    @DefaultZero var members: Int
    var id: String { city }
}
private struct IntelCountry: Codable, Identifiable {
    @DefaultEmpty var countryCode: String
    @DefaultZero var members: Int
    var id: String { countryCode }
}
private struct IntelLocation: Codable {
    private let byCityRaw: [IntelCity]?
    private let byCountryRaw: [IntelCountry]?
    @DefaultFalse var geoCapture: Bool
    var byCity: [IntelCity] { byCityRaw ?? [] }
    var byCountry: [IntelCountry] { byCountryRaw ?? [] }
    enum CodingKeys: String, CodingKey {
        case byCityRaw = "byCity", byCountryRaw = "byCountry", geoCapture
    }
}

/// The whole endpoint, with optional sub-objects so a partial payload still decodes.
private struct IntelPayload: Codable {
    let generatedAt: String?
    private let kpisRaw: IntelKpis?
    private let givingRaw: IntelGiving?
    private let devicesRaw: IntelDevices?
    private let activityRaw: IntelActivity?
    private let engagementRaw: IntelEngagement?
    private let growthRaw: IntelGrowth?
    private let locationRaw: IntelLocation?

    var kpis: IntelKpis { kpisRaw ?? IntelKpis() }
    var giving: IntelGiving { givingRaw ?? IntelGiving() }
    var devices: IntelDevices { devicesRaw ?? IntelDevices() }
    var activity: IntelActivity { activityRaw ?? IntelActivity() }
    var engagement: IntelEngagement { engagementRaw ?? IntelEngagement() }
    var growth: IntelGrowth { growthRaw ?? IntelGrowth() }
    var location: IntelLocation { locationRaw ?? IntelLocation() }

    enum CodingKeys: String, CodingKey {
        case generatedAt
        case kpisRaw = "kpis", givingRaw = "giving", devicesRaw = "devices"
        case activityRaw = "activity"
        case engagementRaw = "engagement", growthRaw = "growth", locationRaw = "location"
    }
}

// Defaulted memberwise inits so the optional-fallback empties above compile.
private extension IntelKpis { init() { _totalMembers = .init(wrappedValue: 0); _active7d = .init(wrappedValue: 0); _active30d = .init(wrappedValue: 0); _avgEngagement = .init(wrappedValue: 0); _membersAtRisk = .init(wrappedValue: 0); _cohorts = .init(wrappedValue: 0); _givers = .init(wrappedValue: 0); _recurringGivers = .init(wrappedValue: 0); _certificatesThisMonth = .init(wrappedValue: 0) } }
private extension IntelGiving { init() { _totalMinor = .init(wrappedValue: 0); _giftCount = .init(wrappedValue: 0); _avgPerTxnMinor = .init(wrappedValue: 0); _medianMinor = .init(wrappedValue: 0); _givers = .init(wrappedValue: 0); _currency = .init(wrappedValue: ""); byFundRaw = nil; byMethodRaw = nil; topGiversRaw = nil; frequencyRaw = nil; trendRaw = nil } }
private extension IntelDevices { init() { platformsRaw = nil; appVersionsRaw = nil; modelsRaw = nil; _modelCapture = .init(wrappedValue: false) } }
private extension IntelActivity { init() { activeTrendRaw = nil; activeDaysRaw = nil } }
private extension IntelEngagement { init() { bandsRaw = nil; byKindRaw = nil; byHourRaw = nil; areaDwellRaw = nil; _screenDwellCapture = .init(wrappedValue: false); _loginCapture = .init(wrappedValue: false) } }
private extension IntelGrowth { init() { byLevelRaw = nil; _verseLearners = .init(wrappedValue: 0); _versesMastered = .init(wrappedValue: 0); _plansCompleted = .init(wrappedValue: 0); _plansActive = .init(wrappedValue: 0); _quizAttempts = .init(wrappedValue: 0); _quizPassed = .init(wrappedValue: 0) } }
private extension IntelLocation { init() { byCityRaw = nil; byCountryRaw = nil; _geoCapture = .init(wrappedValue: false) } }

// MARK: - Tokens / helpers

private enum PiTone {
    // Engagement band colours — brand-aligned, no off-brand blue.
    static let thriving = Nuru.lumGreen          // bright lumGreen
    static let steady   = Color(hex: 0x1D4E86)   // brand navy
    static let watch    = Nuru.gold              // gold
    static let atRisk   = Color(hex: 0xDC2626)   // red
}

/// Canonical band ordering + colour for the bands donut.
private let BANDS: [(key: String, name: String, color: Color)] = [
    ("thriving", "Thriving", PiTone.thriving),
    ("steady",   "Steady",   PiTone.steady),
    ("watch",    "Watch",    PiTone.watch),
    ("at_risk",  "At-risk",  PiTone.atRisk),
]
private func bandName(_ key: String) -> String { BANDS.first { $0.key == key }?.name ?? key.capitalized }
private func bandColor(_ key: String) -> Color { BANDS.first { $0.key == key }?.color ?? Nuru.ink600 }

/// Humanise a recurring-schedule method value.
private func methodLabel(_ m: String) -> String {
    switch m.lowercased() {
    case "mpesa": return "M-Pesa"
    case "airtel": return "Airtel"
    case "paypal": return "PayPal"
    case "card", "stripe": return "Card"
    case "bank", "bank_transfer": return "Bank"
    default: return m.isEmpty ? "—" : m.prefix(1).uppercased() + m.dropFirst()
    }
}

/// Humanise an interaction-event kind into a friendly content-area label + icon.
private func kindLabel(_ k: String) -> String {
    switch k.lowercased() {
    case "lesson_open", "lesson_view":   return "Lessons"
    case "scripture_read", "verse_read": return "Scripture"
    case "video_75pct", "video_complete", "video_play": return "Video"
    case "quiz_attempt", "quiz_submit":  return "Quizzes"
    case "reflection_submit", "reflection": return "Reflections"
    case "plan_open", "reading_plan":    return "Reading plans"
    case "prayer", "prayer_log":         return "Prayer"
    case "habit_check", "habit":         return "Habits"
    case "event_rsvp", "event_view":     return "Events"
    case "give_open", "giving":          return "Giving"
    case "chat_open", "message":         return "Chat"
    default: return k.replacingOccurrences(of: "_", with: " ").capitalized
    }
}
private func kindIcon(_ k: String) -> String {
    switch k.lowercased() {
    case "lesson_open", "lesson_view":   return "book.fill"
    case "scripture_read", "verse_read": return "text.book.closed.fill"
    case "video_75pct", "video_complete", "video_play": return "play.rectangle.fill"
    case "quiz_attempt", "quiz_submit":  return "checkmark.circle.fill"
    case "reflection_submit", "reflection": return "square.and.pencil"
    case "plan_open", "reading_plan":    return "calendar"
    case "prayer", "prayer_log":         return "hands.sparkles.fill"
    case "habit_check", "habit":         return "repeat"
    case "event_rsvp", "event_view":     return "calendar.badge.clock"
    default: return "sparkles"
    }
}

/// Humanise a screen / app-area key (e.g. "lesson_player" → "Lesson player",
/// "GiveScreen" → "Give") into a friendly label for the time-per-area card.
private func areaLabel(_ s: String) -> String {
    if s.isEmpty { return "—" }
    var t = s
    // Strip common route/component suffixes the client may emit.
    for suffix in ["Screen", "View", "Page", "_screen", "_view", "_page"] {
        if t.hasSuffix(suffix) { t = String(t.dropLast(suffix.count)) }
    }
    t = t.replacingOccurrences(of: "_", with: " ")
    // Split camelCase / PascalCase into words.
    var out = ""
    for (i, ch) in t.enumerated() {
        if ch.isUppercase, i > 0, let prev = out.last, !prev.isUppercase, prev != " " { out.append(" ") }
        out.append(ch)
    }
    out = out.trimmingCharacters(in: .whitespaces)
    if out.isEmpty { return s }
    return out.prefix(1).uppercased() + out.dropFirst()
}

/// Format a millisecond duration as "Xh Ym", "Xm", or "Xs".
private func dwellDuration(_ ms: Int) -> String {
    let totalSeconds = max(ms, 0) / 1000
    let h = totalSeconds / 3600
    let m = (totalSeconds % 3600) / 60
    if h > 0 { return m > 0 ? "\(h)h \(m)m" : "\(h)h" }
    if m > 0 { return "\(m)m" }
    return "\(totalSeconds)s"
}

private func platformLabel(_ p: String) -> String {
    switch p.lowercased() {
    case "ios": return "iOS"
    case "android": return "Android"
    case "web": return "Web"
    default: return p.isEmpty ? "Unknown" : p.capitalized
    }
}
private func platformColor(_ p: String) -> Color {
    switch p.lowercased() {
    case "ios": return Color(hex: 0x1D4E86)      // brand navy
    case "android": return Nuru.lumGreen         // bright green
    case "web": return Nuru.gold
    default: return Nuru.ink400
    }
}

private func countryName(_ code: String) -> String {
    let c = code.uppercased()
    if #available(iOS 16, *) { return Locale.current.localizedString(forRegionCode: c) ?? (c.isEmpty ? "—" : c) }
    return (Locale.current as NSLocale).displayName(forKey: .countryCode, value: c) ?? (c.isEmpty ? "—" : c)
}

private func hourLabel(_ h: Int) -> String {
    let hr = ((h % 24) + 24) % 24
    if hr == 0 { return "12a" }
    if hr == 12 { return "12p" }
    return hr < 12 ? "\(hr)a" : "\(hr - 12)p"
}

// MARK: - ===================== PeopleIntelligenceView =====================

struct PeopleIntelligenceView: View {
    @State private var payload: IntelPayload?
    @State private var loaded = false
    @State private var error: String?

    private static func fetch() async throws -> IntelPayload {
        try await APIClient.shared.get("/admin/analytics/intelligence", as: IntelPayload.self)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(spacing: 18) {
                    if let error, payload == nil {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if !loaded && payload == nil {
                        SkeletonList(rows: 7)
                    } else if let p = payload {
                        KpiStripSection(k: p.kpis)                                   // 1
                        GivingSection(g: p.giving)                                   // 2
                        AppUsageSection(devices: p.devices, engagement: p.engagement,
                                        activity: p.activity,
                                        active7d: p.kpis.active7d, active30d: p.kpis.active30d,
                                        totalMembers: p.kpis.totalMembers)           // 3
                        AffinitySection(kinds: p.engagement.byKind,
                                        engagement: p.engagement)                    // 4
                        EngagementGrowthSection(bands: p.engagement.bands,
                                                avgEngagement: p.kpis.avgEngagement,
                                                growth: p.growth)                    // 5
                        LocationSection(loc: p.location)                             // 6
                        if let at = p.generatedAt, !at.isEmpty { asOfCaption(at) }
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

    private func load() async {
        do { payload = try await Self.fetch(); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load people intelligence." }
        loaded = true
    }

    private func asOfCaption(_ iso: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "clock").font(.system(size: 10)).foregroundStyle(Nuru.ink400)
            Text("As of \(Fmt.date(iso, style: .dateTime.day().month(.abbreviated).year().hour().minute()))")
                .font(.inter(11)).foregroundStyle(Nuru.ink400)
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
    }

    // MARK: hero

    private var hero: some View {
        let k = payload?.kpis ?? IntelKpis()
        return VStack(alignment: .leading, spacing: 16) {
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
                Text("Who your people are, how engaged they are, who gives, and how they use the app — one live read across the whole platform.")
                    .font(.nBody).foregroundStyle(Nuru.onNavyDim).fixedSize(horizontal: false, vertical: true)
            }
            heroStatStrip(k)
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, 22).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private func heroStatStrip(_ k: IntelKpis) -> some View {
        let items: [(label: String, value: String, hint: String)] = [
            ("Members", "\(k.totalMembers)", "on the pathway"),
            ("Active (7d)", "\(k.active7d)", "in-app last week"),
            ("Avg engagement", Pctf1(k.avgEngagement), "0–100 score"),
            ("At risk", "\(k.membersAtRisk)", "need attention"),
            ("Givers", "\(k.givers)", "\(k.recurringGivers) recurring"),
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
}

/// Percent with one decimal (avgEngagement arrives 0..100 already, 1-decimal).
private func Pctf1(_ v: Double) -> String {
    String(format: "%.1f%%", v)
}

// MARK: - Shared small pieces

private func piSectionTitle(icon: String, _ title: String, _ caption: String) -> some View {
    HStack(spacing: 8) {
        TintedIcon(systemName: icon, color: Nuru.navy, size: 30)
        VStack(alignment: .leading, spacing: 1) {
            Text(title).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            Text(caption).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        Spacer(minLength: 0)
    }
}

/// Pastel KPI tile (Dashboard-parity), non-interactive (read surface).
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

/// White-card header band (icon + serif title + right caption), matches Finance.
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

/// Inset panel used inside section cards (matches Finance/Dashboard report panels).
private struct PiPanel<C: View>: View {
    let title: String
    var trailing: String? = nil
    @ViewBuilder var content: () -> C
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                Spacer()
                if let trailing { Text(trailing).font(.nMicro).foregroundStyle(Nuru.ink600) }
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

/// Small dim "coming" note for a genuinely-missing telemetry bit (capture flag false).
private struct ComingNote: View {
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "hourglass").font(.system(size: 10)).foregroundStyle(Nuru.ink300).padding(.top, 1)
            Text(text).font(.inter(11)).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
        }
    }
}

private func emptyNote(_ s: String) -> some View {
    Text(s).font(.nCaption).foregroundStyle(Nuru.ink600)
        .frame(maxWidth: .infinity, alignment: .leading)
}

// X-axis label style shared by the bar charts (visible, brand-muted).
private let axisLabelColor = Color(hex: 0x6B7280)

// MARK: - ===================== 1 · KPI strip =====================

private struct KpiStripSection: View {
    let k: IntelKpis
    private let grid = [GridItem(.adaptive(minimum: 132), spacing: 12)]
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            piSectionTitle(icon: "person.3.fill", "Overview", "Live membership, engagement & giving signal")
            LazyVGrid(columns: grid, spacing: 12) {
                PiKpiTile(label: "Total members", value: "\(k.totalMembers)", icon: "person.3.fill",
                          tint: .init(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)))
                PiKpiTile(label: "Active (7d)", value: "\(k.active7d)", icon: "iphone.gen3",
                          tint: .init(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33)))
                PiKpiTile(label: "Active (30d)", value: "\(k.active30d)", icon: "calendar",
                          tint: .init(bg: Color(hex: 0xE2F4F1), fg: Color(hex: 0x0D7E73)))
                PiKpiTile(label: "Avg engagement", value: Pctf1(k.avgEngagement), icon: "chart.bar.xaxis",
                          tint: .init(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F)))
                PiKpiTile(label: "Members at risk", value: "\(k.membersAtRisk)", icon: "exclamationmark.triangle.fill",
                          tint: .init(bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xB42318)))
                PiKpiTile(label: "Givers", value: "\(k.givers)", icon: "person.crop.circle.badge.checkmark",
                          tint: .init(bg: Color(hex: 0xDCFCE7), fg: Color(hex: 0x166534)))
                PiKpiTile(label: "Recurring givers", value: "\(k.recurringGivers)", icon: "arrow.triangle.2.circlepath",
                          tint: .init(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x6D28D9)))
                PiKpiTile(label: "Certificates (mo.)", value: "\(k.certificatesThisMonth)", icon: "rosette",
                          tint: .init(bg: Color(hex: 0xFFF4DA), fg: Color(hex: 0xA87616)))
            }
        }
    }
}

// MARK: - ===================== 2 · Giving intelligence =====================

private struct GivingSection: View {
    let g: IntelGiving
    private var currency: String { g.currency.isEmpty ? "KES" : g.currency }
    private let kpiGrid = [GridItem(.adaptive(minimum: 150), spacing: 12)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            piSectionTitle(icon: "gift.fill", "Giving intelligence", "\(g.giftCount) gifts · \(g.givers) givers")
            LazyVGrid(columns: kpiGrid, spacing: 12) {
                PiKpiTile(label: "Total giving", value: Fmt.money(minor: g.totalMinor, currency: currency), icon: "banknote.fill",
                          tint: .init(bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33)))
                PiKpiTile(label: "Avg / transaction", value: Fmt.money(minor: g.avgPerTxnMinor, currency: currency), icon: "divide.circle.fill",
                          tint: .init(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F)))
                PiKpiTile(label: "Median gift", value: Fmt.money(minor: g.medianMinor, currency: currency), icon: "chart.bar.fill",
                          tint: .init(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x6D28D9)))
                PiKpiTile(label: "Givers", value: "\(g.givers)", icon: "person.2.fill",
                          tint: .init(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)))
            }
            frequencyCard
            topGiversCard
            trendCard
            byFundCard
            byMethodCard
        }
    }

    // ── Giving frequency (buckets 1 / 2-3 / 4-6 / 7+)
    private struct FreqBar: Identifiable { let bucket: String; let givers: Int; let color: Color; var id: String { bucket } }
    private var frequencyOrder: [String] { ["1", "2-3", "4-6", "7+"] }
    private var freqBars: [FreqBar] {
        let palette: [Color] = [Color(hex: 0x1D4E86), Nuru.gold, Color(hex: 0x0D7E73), Nuru.lumGreen]
        let byBucket = Dictionary(uniqueKeysWithValues: g.frequency.map { ($0.bucket, $0.givers) })
        return frequencyOrder.enumerated().map { i, b in FreqBar(bucket: b, givers: byBucket[b] ?? 0, color: palette[i % palette.count]) }
    }
    private var frequencyCard: some View {
        let bars = freqBars
        let total = bars.reduce(0) { $0 + $1.givers }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.bar.doc.horizontal.fill", title: "Giving frequency", caption: "givers by gift count")
                if total == 0 {
                    emptyNote("No giving recorded yet.").padding(.top, 14)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Gifts", b.bucket), y: .value("Givers", b.givers), width: .fixed(34))
                            .foregroundStyle(b.color).cornerRadius(5)
                            .annotation(position: .top) {
                                Text("\(b.givers)").font(.inter(10, .bold)).foregroundStyle(Nuru.navy)
                            }
                    }
                    .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.inter(11)).foregroundStyle(axisLabelColor) } }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .frame(height: 168).padding(.top, 14)
                    HStack(spacing: 14) {
                        ForEach(bars) { b in
                            HStack(spacing: 5) {
                                RoundedRectangle(cornerRadius: 3).fill(b.color).frame(width: 9, height: 9)
                                Text("\(b.bucket) gifts").font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 10)
                }
            }
        }
    }

    // ── Top givers (premium table: Name · Gifts · Total · Avg · Last)
    private enum Col { static let gifts: CGFloat = 48; static let total: CGFloat = 100; static let avg: CGFloat = 88; static let last: CGFloat = 64 }
    private var topGiversCard: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "trophy.fill").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Top givers").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("by total").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)

                HStack(spacing: 10) {
                    Text("GIVER").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    head("GIFTS", Col.gifts)
                    head("TOTAL", Col.total)
                    head("AVG", Col.avg)
                    head("LAST", Col.last)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)

                if g.topGivers.isEmpty {
                    emptyNote("No givers yet.").padding(16)
                } else {
                    ForEach(Array(g.topGivers.prefix(12).enumerated()), id: \.element.id) { i, gv in
                        row(gv, rank: i + 1, zebra: i % 2 == 1)
                        if i < min(g.topGivers.count, 12) - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }
    private func head(_ s: String, _ w: CGFloat) -> some View {
        Text(s).font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: w, alignment: .trailing)
    }
    private func row(_ gv: IntelTopGiver, rank: Int, zebra: Bool) -> some View {
        let name = gv.name.isEmpty ? "Anonymous" : gv.name
        return HStack(spacing: 10) {
            HStack(spacing: 10) {
                ZStack {
                    Circle().fill(rank <= 3 ? Nuru.gold.opacity(0.16) : Nuru.inputBg)
                    Text("\(rank)").font(.inter(11, .bold)).foregroundStyle(rank <= 3 ? Nuru.goldLo : Nuru.ink600)
                }.frame(width: 26, height: 26)
                Monogram(name: name, size: 30, gradient: Nuru.navyGradient)
                Text(name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text("\(gv.gifts)").font(.inter(13, .semibold)).monospacedDigit().foregroundStyle(Nuru.ink600)
                .frame(width: Col.gifts, alignment: .trailing)
            Text(Fmt.money(minor: gv.totalMinor, currency: currency))
                .font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                .lineLimit(1).minimumScaleFactor(0.55).frame(width: Col.total, alignment: .trailing)
            Text(Fmt.money(minor: gv.avgMinor, currency: currency))
                .font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                .lineLimit(1).minimumScaleFactor(0.6).frame(width: Col.avg, alignment: .trailing)
            Text(gv.lastAt.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated)) } ?? "—")
                .font(.inter(11)).foregroundStyle(Nuru.ink400)
                .lineLimit(1).minimumScaleFactor(0.7).frame(width: Col.last, alignment: .trailing)
        }
        .padding(.horizontal, 16).frame(minHeight: 52)
        .background(zebra ? Nuru.surface.opacity(0.45) : Color.clear)
    }

    // ── Giving trend (6mo line)
    private struct TrendPoint: Identifiable { let month: String; let value: Int; var id: String { month } }
    private var trendCard: some View {
        let pts = g.trend.map { TrendPoint(month: monthShort($0.month), value: Int((Double($0.totalMinor) / 100).rounded())) }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.line.uptrend.xyaxis", title: "Giving trend", caption: "last 6 months · \(currency)")
                if pts.isEmpty {
                    emptyNote("No giving recorded yet.").padding(.top, 14)
                } else {
                    Chart(pts) { p in
                        AreaMark(x: .value("Month", p.month), y: .value("Amount", p.value))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [Nuru.gold.opacity(0.28), Nuru.gold.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Month", p.month), y: .value("Amount", p.value))
                            .interpolationMethod(.monotone).foregroundStyle(Nuru.gold).lineStyle(StrokeStyle(lineWidth: 2.5))
                        PointMark(x: .value("Month", p.month), y: .value("Amount", p.value))
                            .foregroundStyle(Nuru.gold).symbolSize(30)
                    }
                    .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.inter(11)).foregroundStyle(axisLabelColor) } }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let v = value.as(Int.self) {
                                    Text(v >= 1000 ? "\(Int((Double(v)/1000).rounded()))k" : "\(v)").font(.inter(10)).foregroundStyle(axisLabelColor)
                                }
                            }
                        }
                    }
                    .frame(height: 196).padding(.top, 12)
                }
            }
        }
    }

    // ── By fund (pastel % bars)
    private var byFundCard: some View {
        let total = g.byFund.reduce(0) { $0 + $1.totalMinor }
        let sorted = g.byFund.sorted { $0.totalMinor > $1.totalMinor }.filter { $0.totalMinor > 0 }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                PiCardHeader(icon: "tray.full.fill", title: "Giving by fund", caption: "all-time · \(currency)")
                if sorted.isEmpty {
                    emptyNote("No fund giving recorded yet.")
                } else {
                    VStack(spacing: 12) {
                        ForEach(Array(sorted.enumerated()), id: \.element.id) { i, f in
                            let pct = total > 0 ? Double(f.totalMinor) / Double(total) : 0
                            let tint = Nuru.brandTint(i)
                            VStack(spacing: 6) {
                                HStack {
                                    Circle().fill(tint.fg).frame(width: 9, height: 9)
                                    Text(f.code.isEmpty ? "—" : f.code.capitalized).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                    Text("· \(f.count)").font(.nMicro).foregroundStyle(Nuru.ink400)
                                    Spacer(minLength: 6)
                                    Text(Fmt.money(minor: f.totalMinor, currency: currency))
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

    // ── By method (recurring schedules) — mini table
    private enum MCol { static let sched: CGFloat = 88; static let givers: CGFloat = 72 }
    private var byMethodCard: some View {
        let rows = g.byMethod.sorted { $0.schedules > $1.schedules }
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Recurring giving by method").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("active schedules").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                HStack(spacing: 10) {
                    Text("METHOD").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    head("SCHEDULES", MCol.sched)
                    head("GIVERS", MCol.givers)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)
                if rows.isEmpty {
                    emptyNote("No active recurring schedules.").padding(16)
                } else {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, m in
                        HStack(spacing: 10) {
                            HStack(spacing: 10) {
                                TintedIcon(systemName: "creditcard.fill", color: Nuru.brandTint(i).fg, size: 28)
                                Text(methodLabel(m.method)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                Spacer(minLength: 0)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            Text("\(m.schedules)").font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                .frame(width: MCol.sched, alignment: .trailing)
                            Text("\(m.givers)").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                .frame(width: MCol.givers, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).frame(minHeight: 50)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < rows.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }
}

/// "YYYY-MM-DD" week start → compact "d MMM" label (e.g. "3 Mar").
private func weekShort(_ s: String) -> String {
    let parts = s.split(separator: "-")
    if parts.count >= 3, let m = Int(parts[1]), (1...12).contains(m), let d = Int(parts[2]) {
        return "\(d) \(Calendar.current.shortMonthSymbols[m - 1])"
    }
    return Fmt.date(s, style: .dateTime.day().month(.abbreviated))
}

/// "2026-03" or ISO → short month label.
private func monthShort(_ s: String) -> String {
    let parts = s.split(separator: "-")
    if parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) {
        return Calendar.current.shortMonthSymbols[m - 1]
    }
    return Fmt.date(s, style: .dateTime.month(.abbreviated))
}

// MARK: - ===================== 3 · App usage & devices =====================

private struct AppUsageSection: View {
    let devices: IntelDevices
    let engagement: IntelEngagement
    let activity: IntelActivity
    let active7d: Int
    let active30d: Int
    let totalMembers: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            piSectionTitle(icon: "iphone.gen3", "App usage & devices", "Platforms, versions & when the app is used")
            activeHighlight
            activeTrendCard
            activeDaysCard
            platformAndVersionCard
            deviceModelsCard
            activityByHourCard
            comingNotes
        }
    }

    // REAL — active users, last 12 weeks (oldest→newest)
    private struct WeekBar: Identifiable { let week: String; let label: String; let active: Int; var id: String { week } }
    private var activeTrendCard: some View {
        let bars = activity.activeTrend.map { WeekBar(week: $0.week, label: weekShort($0.week), active: $0.active) }
        let total = bars.reduce(0) { $0 + $1.active }
        let peak = bars.max { $0.active < $1.active }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.line.uptrend.xyaxis", title: "Active users — last 12 weeks",
                             caption: peak.map { "peak \($0.active)" } ?? "weekly active members")
                if total == 0 {
                    emptyNote("No weekly activity recorded yet.").padding(.top, 14)
                } else {
                    Chart(bars) { b in
                        AreaMark(x: .value("Week", b.label), y: .value("Active", b.active))
                            .interpolationMethod(.monotone)
                            .foregroundStyle(LinearGradient(colors: [Nuru.lumGreen.opacity(0.26), Nuru.lumGreen.opacity(0.02)], startPoint: .top, endPoint: .bottom))
                        LineMark(x: .value("Week", b.label), y: .value("Active", b.active))
                            .interpolationMethod(.monotone).foregroundStyle(Color(hex: 0x0F6B33)).lineStyle(StrokeStyle(lineWidth: 2.5))
                        PointMark(x: .value("Week", b.label), y: .value("Active", b.active))
                            .foregroundStyle(Color(hex: 0x0F6B33)).symbolSize(26)
                    }
                    .chartXAxis {
                        AxisMarks { value in
                            AxisValueLabel { if let s = value.as(String.self) { Text(s).font(.inter(9)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .frame(height: 188).padding(.top, 12)
                }
            }
        }
    }

    // REAL — active days over 30d (login-frequency signal). Fixed 5-bucket order.
    private struct DaysBar: Identifiable { let bucket: String; let members: Int; let color: Color; var id: String { bucket } }
    private var activeDaysOrder: [String] { ["1", "2-3", "4-7", "8-15", "16+"] }
    private var activeDaysCard: some View {
        let palette: [Color] = [Color(hex: 0x1D4E86), Color(hex: 0x0D7E73), Nuru.gold, Color(hex: 0x0F6B33), Nuru.lumGreen]
        let byBucket = Dictionary(activity.activeDays.map { ($0.bucket, $0.members) }, uniquingKeysWith: { a, _ in a })
        let bars = activeDaysOrder.enumerated().map { i, b in DaysBar(bucket: b, members: byBucket[b] ?? 0, color: palette[i % palette.count]) }
        let total = bars.reduce(0) { $0 + $1.members }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.bar.doc.horizontal.fill", title: "How often members use the app",
                             caption: "active days · last 30 days")
                if total == 0 {
                    emptyNote("No active-day data recorded yet.").padding(.top, 14)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Active days", b.bucket), y: .value("Members", b.members), width: .fixed(32))
                            .foregroundStyle(b.color).cornerRadius(5)
                            .annotation(position: .top) {
                                Text("\(b.members)").font(.inter(10, .bold)).foregroundStyle(Nuru.navy)
                            }
                    }
                    .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.inter(11)).foregroundStyle(axisLabelColor) } }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .frame(height: 168).padding(.top, 14)
                    HStack(spacing: 14) {
                        ForEach(bars) { b in
                            HStack(spacing: 5) {
                                RoundedRectangle(cornerRadius: 3).fill(b.color).frame(width: 9, height: 9)
                                Text("\(b.bucket) days").font(.inter(10.5)).foregroundStyle(Nuru.ink600)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 10)
                }
            }
        }
    }

    // REAL — active 7d / 30d highlighted
    private var activeHighlight: some View {
        let pct7 = totalMembers > 0 ? Double(active7d) / Double(totalMembers) * 100 : 0
        return Card(padding: 18) {
            HStack(spacing: 14) {
                TintedIcon(systemName: "wave.3.right", color: Color(hex: 0x0F6B33), size: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text("Active in app").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink600)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("\(active7d)").font(.fraunces(30, .semibold)).foregroundStyle(Nuru.navy)
                            Text("LAST 7 DAYS").font(.inter(9, .bold)).tracking(0.6).foregroundStyle(Nuru.ink400)
                        }
                        VStack(alignment: .leading, spacing: 0) {
                            Text("\(active30d)").font(.fraunces(30, .semibold)).foregroundStyle(Color(hex: 0x0F6B33))
                            Text("LAST 30 DAYS").font(.inter(9, .bold)).tracking(0.6).foregroundStyle(Nuru.ink400)
                        }
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 2) {
                    Text("\(Int(pct7.rounded()))%").font(.fraunces(24, .semibold)).foregroundStyle(Color(hex: 0x0F6B33))
                    Text("of \(totalMembers)").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
            }
        }
    }

    // REAL — platform donut + app-version table
    private struct PlatSlice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var platformAndVersionCard: some View {
        let slices = devices.platforms.filter { $0.members > 0 }
            .map { PlatSlice(name: platformLabel($0.platform), value: $0.members, color: platformColor($0.platform)) }
        let total = slices.reduce(0) { $0 + $1.value }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                PiCardHeader(icon: "circle.lefthalf.filled", title: "Platform & app version", caption: "members per platform")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 14, alignment: .top)], spacing: 14) {
                    PiPanel(title: "Platform split", trailing: "\(total) members") {
                        if total == 0 {
                            emptyNote("No platform data yet.").frame(height: 150)
                        } else {
                            HStack(spacing: 14) {
                                ZStack {
                                    Chart(slices) { s in
                                        SectorMark(angle: .value("v", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                                            .foregroundStyle(s.color).cornerRadius(3)
                                    }
                                    .chartLegend(.hidden).frame(width: 120, height: 120)
                                    VStack(spacing: 0) {
                                        Text("\(total)").font(.fraunces(20, .semibold)).foregroundStyle(Nuru.navy)
                                        Text("DEVICES").font(.inter(8, .bold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                                    }
                                }
                                VStack(spacing: 8) {
                                    ForEach(slices) { s in
                                        HStack(spacing: 7) {
                                            Circle().fill(s.color).frame(width: 9, height: 9)
                                            Text(s.name).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                                            Spacer(minLength: 6)
                                            Text("\(s.value)").font(.inter(12.5, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                            Text(total > 0 ? "\(Int((Double(s.value)/Double(total)*100).rounded()))%" : "0%")
                                                .font(.nMicro).foregroundStyle(Nuru.ink600).frame(width: 34, alignment: .trailing)
                                        }
                                    }
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                    PiPanel(title: "App-version adoption", trailing: "top \(min(devices.appVersions.count, 8))") {
                        if devices.appVersions.isEmpty {
                            emptyNote("No version data yet.")
                        } else {
                            let maxV = devices.appVersions.map(\.members).max() ?? 1
                            VStack(spacing: 0) {
                                ForEach(Array(devices.appVersions.prefix(8).enumerated()), id: \.element.id) { i, v in
                                    HStack(spacing: 10) {
                                        Text(v.appVersion.isEmpty ? "—" : v.appVersion)
                                            .font(.inter(12, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                            .frame(width: 64, alignment: .leading)
                                        GeometryReader { geo in
                                            ZStack(alignment: .leading) {
                                                Capsule().fill(Nuru.track)
                                                Capsule().fill(i == 0 ? Nuru.lumGreen : Nuru.gold)
                                                    .frame(width: geo.size.width * CGFloat(v.members) / CGFloat(Swift.max(maxV, 1)))
                                            }
                                        }
                                        .frame(height: 9)
                                        Text("\(v.members)").font(.inter(12, .semibold)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                            .frame(width: 44, alignment: .trailing)
                                    }
                                    .frame(minHeight: 34)
                                    if i < min(devices.appVersions.count, 8) - 1 { Divider().overlay(Nuru.border.opacity(0.5)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // REAL (graceful upgrade) — top device models, only once capture is on AND we have rows.
    // When modelCapture == false this renders nothing; the honest "coming" note in
    // comingNotes still shows. So the page upgrades from "coming" to real data in place.
    @ViewBuilder private var deviceModelsCard: some View {
        let models = devices.models.filter { $0.members > 0 }.sorted { $0.members > $1.members }
        if devices.modelCapture, !models.isEmpty {
            let maxM = models.map(\.members).max() ?? 1
            Card(padding: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    PiCardHeader(icon: "ipad.and.iphone", title: "Top device models",
                                 caption: "top \(min(models.count, 8)) · members")
                    VStack(spacing: 0) {
                        ForEach(Array(models.prefix(8).enumerated()), id: \.element.id) { i, m in
                            HStack(spacing: 10) {
                                Text(m.model.isEmpty ? "—" : m.model)
                                    .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                                    .lineLimit(1).minimumScaleFactor(0.8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                GeometryReader { geo in
                                    ZStack(alignment: .leading) {
                                        Capsule().fill(Nuru.track)
                                        Capsule().fill(Nuru.brandTint(i).fg)
                                            .frame(width: geo.size.width * CGFloat(m.members) / CGFloat(Swift.max(maxM, 1)))
                                    }
                                }
                                .frame(width: 120, height: 9)
                                Text("\(m.members)").font(.inter(12, .semibold)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                    .frame(width: 44, alignment: .trailing)
                            }
                            .frame(minHeight: 36)
                            if i < min(models.count, 8) - 1 { Divider().overlay(Nuru.border.opacity(0.5)) }
                        }
                    }
                }
            }
        }
    }

    // REAL — activity by hour (0..23)
    private struct HourBar: Identifiable { let hour: Int; let label: String; let events: Int; var id: Int { hour } }
    private var activityByHourCard: some View {
        let byHour = Dictionary(uniqueKeysWithValues: engagement.byHour.map { ($0.hour, $0.events) })
        let bars = (0..<24).map { HourBar(hour: $0, label: hourLabel($0), events: byHour[$0] ?? 0) }
        let total = bars.reduce(0) { $0 + $1.events }
        let peak = bars.max { $0.events < $1.events }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "clock.fill", title: "Activity by hour",
                             caption: peak.map { "peak \($0.label)" } ?? "when the app is used")
                if total == 0 {
                    emptyNote("No in-app activity recorded yet.").padding(.top, 14)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Hour", b.label), y: .value("Events", b.events), width: .fixed(7))
                            .foregroundStyle(b.hour == peak?.hour ? Nuru.lumGreen : Nuru.gold).cornerRadius(2)
                    }
                    .chartXAxis {
                        AxisMarks(values: ["12a", "6a", "12p", "6p"]) { _ in
                            AxisValueLabel().font(.inter(10)).foregroundStyle(axisLabelColor)
                        }
                    }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .frame(height: 168).padding(.top, 14)
                }
            }
        }
    }

    // Gated coming notes — only the genuinely-missing bits.
    @ViewBuilder private var comingNotes: some View {
        let notes: [String] = {
            var out: [String] = []
            if devices.modelCapture == false { out.append("Exact device model — coming") }
            if engagement.screenDwellCapture == false { out.append("Per-screen time — coming") }
            if engagement.loginCapture == false { out.append("Active-days distribution & weekly trend above are real; exact login timestamps are still not captured, so active-days stands in for sign-in frequency.") }
            return out
        }()
        if !notes.isEmpty {
            Card(padding: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(notes, id: \.self) { ComingNote(text: $0) }
                }
            }
        }
    }
}

// MARK: - ===================== 4 · App-area affinity =====================

private struct AffinitySection: View {
    let kinds: [IntelKind]
    let engagement: IntelEngagement
    private enum Col { static let events: CGFloat = 80; static let members: CGFloat = 72 }
    // Columns for the time-per-area mini-table.
    private enum DCol { static let time: CGFloat = 78; static let sessions: CGFloat = 64; static let members: CGFloat = 64 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            piSectionTitle(icon: "heart.text.square.fill", "App-area affinity", "Which content members engage with most")
            card
            timePerAreaCard
        }
    }

    // #3 app-area dwell — only render once the client actually captures screen
    // dwell AND we have rows; otherwise fall back to the honest "coming" note,
    // so the page upgrades from "coming" to real data in place.
    @ViewBuilder private var timePerAreaCard: some View {
        let rows = engagement.areaDwell
            .filter { $0.totalMs > 0 }
            .sorted { $0.totalMs > $1.totalMs }
        if engagement.screenDwellCapture, !rows.isEmpty {
            let maxMs = rows.map(\.totalMs).max() ?? 1
            Card(padding: 0) {
                VStack(spacing: 0) {
                    HStack(spacing: 6) {
                        Image(systemName: "hourglass").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                        Text("Time per app area").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        Spacer(minLength: 8)
                        Text("total time · sessions · members").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                    HStack(spacing: 10) {
                        Text("AREA").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        Text("TIME").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: DCol.time, alignment: .trailing)
                        Text("SESS.").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: DCol.sessions, alignment: .trailing)
                        Text("MEMBERS").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: DCol.members, alignment: .trailing)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10)
                    .background(Nuru.surface)
                    Divider().overlay(Nuru.border)
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, d in
                        VStack(spacing: 8) {
                            HStack(spacing: 10) {
                                HStack(spacing: 10) {
                                    TintedIcon(systemName: "clock.fill", color: Nuru.tint(i).fg, size: 30)
                                    Text(areaLabel(d.screen)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                                    Spacer(minLength: 0)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text(dwellDuration(d.totalMs)).font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                    .lineLimit(1).minimumScaleFactor(0.6).frame(width: DCol.time, alignment: .trailing)
                                Text("\(d.sessions)").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                    .frame(width: DCol.sessions, alignment: .trailing)
                                Text("\(d.members)").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                    .frame(width: DCol.members, alignment: .trailing)
                            }
                            ProgressBar(pct: Double(d.totalMs) / Double(Swift.max(maxMs, 1)) * 100, fill: Nuru.tint(i).fg, height: 5)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < rows.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        } else {
            Card(padding: 14) {
                ComingNote(text: "Per-screen time — coming")
            }
        }
    }

    private var sorted: [IntelKind] { kinds.sorted { $0.events > $1.events } }
    private var maxEvents: Int { sorted.map(\.events).max() ?? 1 }

    private var card: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "square.grid.2x2.fill").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Content areas").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("events · members").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                HStack(spacing: 10) {
                    Text("AREA").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Text("EVENTS").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: Col.events, alignment: .trailing)
                    Text("MEMBERS").font(.inter(11, .bold)).tracking(0.6).foregroundStyle(Nuru.ink600).frame(width: Col.members, alignment: .trailing)
                }
                .padding(.horizontal, 16).padding(.vertical, 10)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)
                if sorted.isEmpty {
                    emptyNote("No app-area engagement recorded yet.").padding(16)
                } else {
                    ForEach(Array(sorted.enumerated()), id: \.element.id) { i, k in
                        VStack(spacing: 8) {
                            HStack(spacing: 10) {
                                HStack(spacing: 10) {
                                    TintedIcon(systemName: kindIcon(k.kind), color: Nuru.tint(i).fg, size: 30)
                                    Text(kindLabel(k.kind)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                                    Spacer(minLength: 0)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Text("\(k.events)").font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                    .frame(width: Col.events, alignment: .trailing)
                                Text("\(k.members)").font(.inter(12.5, .medium)).monospacedDigit().foregroundStyle(Nuru.ink600)
                                    .frame(width: Col.members, alignment: .trailing)
                            }
                            ProgressBar(pct: Double(k.events) / Double(Swift.max(maxEvents, 1)) * 100, fill: Nuru.tint(i).fg, height: 5)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 11)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < sorted.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }
}

// MARK: - ===================== 5 · Engagement & growth =====================

private struct EngagementGrowthSection: View {
    let bands: [IntelBand]
    let avgEngagement: Double
    let growth: IntelGrowth

    private struct Slice: Identifiable { let name: String; let value: Int; let color: Color; var id: String { name } }
    private var slices: [Slice] {
        // Order bands canonically; default missing to 0.
        let byBand = Dictionary(uniqueKeysWithValues: bands.map { ($0.band, $0.members) })
        return BANDS.map { Slice(name: $0.name, value: byBand[$0.key] ?? 0, color: $0.color) }
    }
    private var total: Int { slices.reduce(0) { $0 + $1.value } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            piSectionTitle(icon: "chart.pie.fill", "Engagement & growth", "\(total) members · \(Pctf1(avgEngagement)) avg score")
            bandsCard
            levelCard
            growthTiles
        }
    }

    private var bandsCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                PiCardHeader(icon: "chart.pie.fill", title: "Engagement bands", caption: "\(total) members")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 14, alignment: .top)], spacing: 14) {
                    PiPanel(title: "Distribution", trailing: "\(total) members") {
                        ZStack {
                            Chart(total == 0 ? [Slice(name: "None", value: 1, color: Nuru.border)] : slices) { s in
                                SectorMark(angle: .value("v", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                                    .foregroundStyle(s.color).cornerRadius(3)
                            }
                            .chartLegend(.hidden).frame(height: 160)
                            VStack(spacing: 2) {
                                Text("\(total)").font(.fraunces(24, .semibold)).foregroundStyle(Nuru.navy)
                                Text("MEMBERS").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                    PiPanel(title: "Band breakdown", trailing: "by band") {
                        VStack(spacing: 0) {
                            ForEach(Array(slices.enumerated()), id: \.element.id) { i, d in
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
            }
        }
    }

    // Per-level distribution (learners + completed)
    private struct LevelBar: Identifiable { let level: String; let series: String; let value: Int; var id: String { "\(level)-\(series)" } }
    private var levelCard: some View {
        let rows = growth.byLevel.sorted { $0.levelNumber < $1.levelNumber }
        let bars = rows.flatMap { r -> [LevelBar] in
            [LevelBar(level: "L\(r.levelNumber)", series: "Learners", value: r.learners),
             LevelBar(level: "L\(r.levelNumber)", series: "Completed", value: r.completed)]
        }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 0) {
                PiCardHeader(icon: "chart.bar.fill", title: "Per-level distribution", caption: "learners & completions")
                if bars.allSatisfy({ $0.value == 0 }) {
                    emptyNote("No level enrolment recorded yet.").padding(.top, 14)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Level", b.level), y: .value("Count", b.value), width: .fixed(12))
                            .foregroundStyle(by: .value("Series", b.series))
                            .position(by: .value("Series", b.series))
                            .cornerRadius(3)
                    }
                    .chartForegroundStyleScale(["Learners": Color(hex: 0x1D4E86), "Completed": Nuru.lumGreen])
                    .chartXAxis { AxisMarks { _ in AxisValueLabel().font(.inter(10)).foregroundStyle(axisLabelColor) } }
                    .chartYAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)").font(.inter(10)).foregroundStyle(axisLabelColor) } }
                        }
                    }
                    .chartLegend(.hidden)
                    .frame(height: 176).padding(.top, 14)
                    HStack(spacing: 16) {
                        legend("Learners", Color(hex: 0x1D4E86))
                        legend("Completed", Nuru.lumGreen)
                        Spacer(minLength: 0)
                    }
                    .padding(.top, 10)
                }
            }
        }
    }
    private func legend(_ t: String, _ c: Color) -> some View {
        HStack(spacing: 6) { RoundedRectangle(cornerRadius: 2).fill(c).frame(width: 9, height: 9); Text(t).font(.nMicro).foregroundStyle(Nuru.ink600) }
    }

    // Word & curriculum growth tiles
    private let grid = [GridItem(.adaptive(minimum: 150), spacing: 12)]
    private var growthTiles: some View {
        LazyVGrid(columns: grid, spacing: 12) {
            PiKpiTile(label: "Verse learners", value: "\(growth.verseLearners)", icon: "text.book.closed.fill",
                      tint: .init(bg: Color(hex: 0xDCFCE7), fg: Color(hex: 0x166534)))
            PiKpiTile(label: "Verses mastered", value: "\(growth.versesMastered)", icon: "checkmark.seal.fill",
                      tint: .init(bg: Color(hex: 0xFDF5E5), fg: Color(hex: 0x8A6B1F)))
            PiKpiTile(label: "Plans completed", value: "\(growth.plansCompleted)", icon: "calendar.badge.checkmark",
                      tint: .init(bg: Color(hex: 0xE3EAF3), fg: Color(hex: 0x1D4E86)))
            PiKpiTile(label: "Plans active", value: "\(growth.plansActive)", icon: "calendar",
                      tint: .init(bg: Color(hex: 0xE2F4F1), fg: Color(hex: 0x0D7E73)))
            PiKpiTile(label: "Quiz attempts", value: "\(growth.quizAttempts)", icon: "questionmark.circle.fill",
                      tint: .init(bg: Color(hex: 0xF3EAFE), fg: Color(hex: 0x6D28D9)))
            PiKpiTile(label: "Quiz passed", value: "\(growth.quizPassed)", icon: "checkmark.circle.fill",
                      tint: .init(bg: Color(hex: 0xFFF4DA), fg: Color(hex: 0xA87616)))
        }
    }
}

// MARK: - ===================== 6 · Location =====================

private struct LocationSection: View {
    let loc: IntelLocation

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            piSectionTitle(icon: "mappin.and.ellipse", "Location", "Where your people are — coarse, free-text")
            byCityCard
            byCountryCard
            if loc.geoCapture == false { proximityComingCard }
        }
    }

    private var byCityCard: some View {
        let rows = loc.byCity.sorted { $0.members > $1.members }.filter { $0.members > 0 }
        let maxV = rows.map(\.members).max() ?? 1
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: "building.2.fill").font(.system(size: 13)).foregroundStyle(Nuru.navy)
                    Text("Members by city").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("top \(min(rows.count, 10))").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                Divider().overlay(Nuru.border)
                if rows.isEmpty {
                    emptyNote("No city data captured yet.").padding(16)
                } else {
                    ForEach(Array(rows.prefix(10).enumerated()), id: \.element.id) { i, c in
                        HStack(spacing: 12) {
                            TintedIcon(systemName: "mappin.circle.fill", color: Nuru.brandTint(i).fg, size: 28)
                            Text(c.city.isEmpty ? "Unknown" : c.city).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                .lineLimit(1).minimumScaleFactor(0.85).frame(width: 120, alignment: .leading)
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Nuru.track)
                                    Capsule().fill(Nuru.brandTint(i).fg)
                                        .frame(width: geo.size.width * CGFloat(c.members) / CGFloat(Swift.max(maxV, 1)))
                                }
                            }
                            .frame(height: 10)
                            Text("\(c.members)").font(.fraunces(15, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
                                .frame(width: 48, alignment: .trailing)
                        }
                        .padding(.horizontal, 16).frame(minHeight: 50)
                        .background(i % 2 == 1 ? Nuru.surface.opacity(0.45) : Color.clear)
                        if i < min(rows.count, 10) - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }
            }
        }
    }

    private var byCountryCard: some View {
        let rows = loc.byCountry.sorted { $0.members > $1.members }.filter { $0.members > 0 }
        let total = rows.reduce(0) { $0 + $1.members }
        return Card(padding: 18) {
            VStack(alignment: .leading, spacing: 14) {
                PiCardHeader(icon: "globe", title: "Members by country", caption: "top \(min(rows.count, 8))")
                if rows.isEmpty {
                    emptyNote("No country data captured yet.")
                } else {
                    VStack(spacing: 12) {
                        ForEach(Array(rows.prefix(8).enumerated()), id: \.element.id) { i, c in
                            let pct = total > 0 ? Double(c.members) / Double(total) : 0
                            let tint = Nuru.brandTint(i)
                            VStack(spacing: 6) {
                                HStack {
                                    Circle().fill(tint.fg).frame(width: 9, height: 9)
                                    Text(countryName(c.countryCode)).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                    Spacer(minLength: 6)
                                    Text("\(c.members)").font(.inter(12.5, .semibold)).monospacedDigit().foregroundStyle(Nuru.navy)
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

    // geo_capture == false → forward-looking proximity card. No fake coordinates.
    private var proximityComingCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: "point.3.connected.trianglepath.dotted", color: Color(hex: 0x6D28D9), size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Location & proximity matching").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        Text("Coming soon").font(.nMicro).foregroundStyle(Color(hex: 0x6D28D9))
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "sparkles").font(.system(size: 14)).foregroundStyle(Nuru.gold)
                }
                Text("Today we only know coarse, free-text city and country — no precise coordinates are collected. When opt-in location tagging ships, we'll surface members who live near each other and suggest pairing them into the same cell, so no one is discipled in isolation. Nothing here is estimated.")
                    .font(.inter(12)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 7) {
                    ForEach([
                        "Opt-in, privacy-first location tags (area, never precise coordinates in the admin view)",
                        "Proximity clusters that respect congregation and language boundaries",
                        "One-tap 'suggest a cell' from nearby unassigned members",
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
