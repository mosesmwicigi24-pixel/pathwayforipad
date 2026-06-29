// Members — a faithful, complete native port of the web admin Members.tsx.
// Hero (breadcrumb · "N on pathway" · Export · Add member) + band stat strip +
// "By country" filter chips; toolbar (debounced search · Band · Cell); rich member
// rows; and the four flows: Add member, Edit member, Member results, Export — all
// wired to the live ops API (list/detail/results reads; add/update/enrollment/
// graduation writes via APIClient's put/patch/post). Tap a row → MemberDetailView.
import SwiftUI

// MARK: - Page-local models (the shared MemberRow is a slim subset)

private struct MRow: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    @DefaultFalse var isMinor: Bool
    let currentLevel: Int?
    let startLevel: Int?
    let startModuleSequence: Int?
    let eScore: Double?
    let band: String?
    let cellName: String?
    let cellGroupId: String?
    let lastActivity: String?
    let gender: String?
    let city: String?
    let programme: String?
    let countryCode: String?
    let status: String?     // server-derived: graduated | band
    var id: String { userId }
}
private struct MPage: Codable { let data: [MRow] }

private struct MEditDetail: Codable {
    @DefaultEmpty var fullName: String
    let email: String?
    @DefaultEmpty var phoneNumber: String
    let gender: String?
    let dateOfBirth: String?
    let countryCode: String?
    let city: String?
    let language: String?
    let cellGroupId: String?
    let programme: String?
    @DefaultFalse var isBaptized: Bool
    let currentLevel: Int?
    let startLevel: Int?
    let startModuleSequence: Int?
}

private struct OkResponse: Codable {}

// Conditional JSON body (omit absent keys, mirroring the web's spread).
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}

// MARK: - Results dossier models

private struct MResults: Codable {
    struct User: Codable { @DefaultEmpty var fullName: String }
    struct Summary: Codable {
        let overallScore: Double?
        @DefaultZero var modulesCompleted: Int
        @DefaultZero var modulesTotal: Int
        @DefaultZero var levelsCompleted: Int
        @DefaultZero var badges: Int
        @DefaultZero var certificates: Int
    }
    struct Exam: Codable { let score: Double?; @DefaultFalse var passed: Bool; @DefaultZero var attempts: Int }
    struct Module: Codable, Identifiable {
        @DefaultEmpty var moduleId: String
        @DefaultZero var sequence: Int
        @DefaultEmpty var title: String
        @DefaultFalse var completed: Bool
        let bestScore: Double?
        @DefaultZero var attempts: Int
        var id: String { moduleId }
    }
    struct Level: Codable, Identifiable {
        @DefaultZero var levelNumber: Int
        @DefaultEmpty var title: String
        let moduleAverage: Double?
        let levelScore: Double?
        @DefaultFalse var completed: Bool
        let exam: Exam?
        @MListDefault var modules: [Module]
        var id: Int { levelNumber }
    }
    struct Badge: Codable, Identifiable { @DefaultEmpty var code: String; @DefaultEmpty var name: String; var id: String { code } }
    struct Cert: Codable, Identifiable {
        @DefaultZero var levelNumber: Int
        let levelTitle: String?
        @DefaultEmpty var verificationCode: String
        @DefaultEmpty var issuedAt: String
        var id: String { verificationCode }
    }
    let user: User
    let summary: Summary
    @MListDefault var levels: [Level]
    @MListDefault var badges: [Badge]
    @MListDefault var certificates: [Cert]
}

@propertyWrapper private struct MListDefault<E: Codable>: Codable {
    var wrappedValue: [E]
    init() { wrappedValue = [] }
    init(from decoder: Decoder) throws { wrappedValue = (try? [E](from: decoder)) ?? [] }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}
extension KeyedDecodingContainer {
    fileprivate func decode<E>(_ t: MListDefault<E>.Type, forKey k: Key) throws -> MListDefault<E> {
        try decodeIfPresent(t, forKey: k) ?? MListDefault<E>()
    }
}

// MARK: - Status meta (band → label + colors)

private struct StatusMeta { let label: String; let fg: Color; let bg: Color }
private func statusMeta(_ key: String?) -> StatusMeta {
    switch key {
    case "thriving":  return StatusMeta(label: "Thriving", fg: Color(hex: 0x16A34A), bg: Color(hex: 0x16A34A).opacity(0.10))
    case "watch":     return StatusMeta(label: "Watch", fg: Color(hex: 0x8B6914), bg: Color(hex: 0xC89B3C).opacity(0.12))
    case "at_risk":   return StatusMeta(label: "At-risk", fg: Color(hex: 0xDC2626), bg: Color(hex: 0xDC2626).opacity(0.10))
    case "graduated": return StatusMeta(label: "Graduated", fg: Color(hex: 0x7C3AED), bg: Color(hex: 0x7C3AED).opacity(0.10))
    default:          return StatusMeta(label: "Steady", fg: Nuru.navy, bg: Nuru.navy.opacity(0.08))
    }
}
private let PROGRAMME_LABELS: [String: String] = [
    "new_believer": "New Believer", "foundations": "Foundations",
    "serving_track": "Serving Track", "leadership_prep": "Leadership Prep",
]
private let AVATAR_GRADIENTS: [[Color]] = [
    [Color(hex: 0x0B1F33), Color(hex: 0x1E4068)], [Color(hex: 0xC89B3C), Color(hex: 0x8B6914)],
    [Color(hex: 0x16A34A), Color(hex: 0x065F46)], [Color(hex: 0x7C3AED), Color(hex: 0x4C1D95)],
    [Color(hex: 0xDC2626), Color(hex: 0x7F1D1D)], [Color(hex: 0x0EA5E9), Color(hex: 0x075985)],
]
private func avatarGradient(_ i: Int) -> LinearGradient {
    LinearGradient(colors: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.count], startPoint: .topLeading, endPoint: .bottomTrailing)
}
private func initials(_ n: String) -> String {
    let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
    return p.isEmpty ? "?" : String(p).uppercased()
}
private func pctInt(_ v: Double?) -> Int { Int(((v ?? 0) * 100).rounded()) }
private func relDays(_ iso: String?) -> String {
    guard let iso, let d = ISO8601DateFormatter().date(from: iso) else { return "—" }
    let days = Int(Date().timeIntervalSince(d) / 86400)
    return days <= 0 ? "Today" : days == 1 ? "Yesterday" : "\(days)d ago"
}

// MARK: - API

private enum MembersAPI {
    static func list(search: String, band: String?, country: String?) async throws -> [MRow] {
        var q: [String: String] = [:]
        let s = search.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { q["search"] = s }
        if let band, band != "All", band != "graduated" { q["band"] = band }
        if let country, country != "All" { q["country_code"] = country }
        return try await APIClient.shared.get("/admin/members", query: q, as: MPage.self).data
    }
    static func detail(_ id: String) async throws -> MEditDetail {
        try await APIClient.shared.get("/admin/members/\(id)", as: MEditDetail.self)
    }
    static func results(_ id: String) async throws -> MResults {
        try await APIClient.shared.get("/admin/members/\(id)/results", as: MResults.self)
    }
    static func add(_ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.post("/admin/members", body: body, as: OkResponse.self)
    }
    static func update(_ id: String, _ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.patch("/admin/members/\(id)", body: body, as: OkResponse.self)
    }
    static func setStart(_ id: String, level: Int, module: Int) async throws {
        _ = try await APIClient.shared.patch("/admin/members/\(id)/enrollment",
                                             body: ["start_level": JSONValue.int(level), "start_module_sequence": .int(module)],
                                             as: OkResponse.self)
    }
    static func setGraduation(_ id: String, _ graduated: Bool) async throws {
        _ = try await APIClient.shared.patch("/admin/members/\(id)/graduation",
                                             body: ["graduated": JSONValue.bool(graduated)], as: OkResponse.self)
    }
}

// MARK: - View model

@MainActor
private final class MembersVM: ObservableObject {
    @Published var rows: [MRow] = []
    @Published var cells: [EngagementCellRow] = []
    @Published var countries: [Country] = []
    @Published var search = ""
    @Published var band: String = "All"
    @Published var cellFilter = "All"
    @Published var country = "All"
    @Published var error: String?
    @Published var loading = true
    private var task: Task<Void, Never>?

    var countryByCode: [String: Country] { Dictionary(countries.map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a }) }
    var cellNames: [String] { ["All"] + Array(Set(rows.compactMap { $0.cellName })).sorted() }

    var filtered: [MRow] {
        rows.filter { m in
            (cellFilter == "All" || m.cellName == cellFilter) &&
            (band != "graduated" || m.status == "graduated")
        }
    }
    var counts: (total: Int, thriving: Int, watch: Int, atRisk: Int) {
        (rows.count,
         rows.filter { $0.status == "thriving" }.count,
         rows.filter { $0.status == "watch" }.count,
         rows.filter { $0.status == "at_risk" }.count)
    }
    var countryChips: [(code: String, count: Int, country: Country?)] {
        var counts: [String: Int] = [:]
        for m in rows { if let c = m.countryCode { counts[c, default: 0] += 1 } }
        return counts.map { ($0.key, $0.value, countryByCode[$0.key]) }.sorted { $0.1 > $1.1 }
    }

    func bootstrap() async {
        async let c = try? PortalAPI.engagement()
        async let co = try? PortalAPI.countries()
        cells = (await c)?.cells ?? []
        countries = await co ?? []
        await reload()
    }
    func reload() async {
        do { rows = try await MembersAPI.list(search: search, band: band, country: country); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load members." }
        loading = false
    }
    func scheduleReload() {
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            if !Task.isCancelled { await self?.reload() }
        }
    }
    func graduate(_ id: String, _ next: Bool) async {
        do { try await MembersAPI.setGraduation(id, next); await reload() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not update graduation." }
    }
}

// MARK: - Members screen

struct MembersView: View {
    @StateObject private var vm = MembersVM()
    @EnvironmentObject private var router: NavRouter
    @State private var addOpen = false
    @State private var editId: String?
    @State private var resultsId: String?
    @State private var exportOpen = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(spacing: 14) {
                    if let e = vm.error { ErrorBanner(message: e) { Task { await vm.reload() } } }
                    toolbar
                    if vm.loading && vm.rows.isEmpty {
                        SkeletonList(rows: 6)
                    } else if vm.filtered.isEmpty {
                        emptyState
                    } else {
                        ForEach(Array(vm.filtered.enumerated()), id: \.element.id) { i, m in
                            MemberRowCard(member: m, index: i, country: m.countryCode.flatMap { vm.countryByCode[$0] },
                                          onResults: { resultsId = m.userId },
                                          onEdit: { editId = m.userId },
                                          onGraduate: { Task { await vm.graduate(m.userId, m.status != "graduated") } })
                        }
                        footer
                    }
                }
                .padding(20)
            }
        }
        .background(Nuru.paper)
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if let q = router.memberSearch { vm.search = q; router.memberSearch = nil }
            if vm.rows.isEmpty { await vm.bootstrap() }
        }
        .onChange(of: router.memberSearch) { _, q in
            if let q { vm.search = q; router.memberSearch = nil; Task { await vm.reload() } }
        }
        .refreshable { await vm.reload() }
        .sheet(isPresented: $addOpen) { MemberFormSheet(mode: .add, cells: vm.cells, countries: vm.countries) { Task { await vm.reload() } } }
        .sheet(item: Binding(get: { editId.map { IdBox(id: $0) } }, set: { editId = $0?.id })) { box in
            MemberFormSheet(mode: .edit(box.id), cells: vm.cells, countries: vm.countries) { Task { await vm.reload() } }
        }
        .sheet(item: Binding(get: { resultsId.map { IdBox(id: $0) } }, set: { resultsId = $0?.id })) { box in
            MemberResultsSheet(userId: box.id)
        }
        .sheet(isPresented: $exportOpen) { ExportSheet(members: vm.filtered, countryByCode: vm.countryByCode) }
    }

    // Hero
    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                HStack(spacing: 6) {
                    Text("Nuru Pathway").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                    Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                    Text("Members").font(.nMicro).foregroundStyle(.white)
                }
                Spacer()
                HStack(spacing: 8) {
                    HeroChip(label: "\(vm.counts.total) on pathway", icon: "person.2.fill", style: .tag)
                    HeroChip(label: "Export", icon: "square.and.arrow.up", style: .ghost) { exportOpen = true }
                    HeroChip(label: "Add member", icon: "plus", style: .gold) { addOpen = true }
                }
            }
            HStack(spacing: 0) {
                bandStat("Total members", "\(vm.counts.total)", nil)
                bandStat("Thriving", "\(vm.counts.thriving)", Color(hex: 0x16A34A))
                bandStat("Watch", "\(vm.counts.watch)", Color(hex: 0xA87616))
                bandStat("At-risk", "\(vm.counts.atRisk)", Color(hex: 0xDC2626))
            }
            .background(.white.opacity(0.04))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
            if !vm.countryChips.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        Text("BY COUNTRY").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.onNavyDim)
                        countryChip("All", flag: nil, count: nil, code: "All")
                        ForEach(vm.countryChips, id: \.code) { c in
                            countryChip(c.country?.name ?? c.code, flag: c.country?.flag, count: c.count, code: c.code)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, Nuru.S.lg).padding(.bottom, Nuru.S.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private func bandStat(_ label: String, _ value: String, _ band: Color?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.nOverline).tracking(1.4).foregroundStyle(Nuru.onNavyDim)
            if let band {
                Text("● \(value)").font(.inter(13, .bold)).foregroundStyle(band)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(band.opacity(0.16)).clipShape(Capsule())
            } else {
                Text(value).font(.fraunces(22, .medium)).foregroundStyle(.white)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 18).padding(.vertical, 14)
    }

    private func countryChip(_ name: String, flag: String?, count: Int?, code: String) -> some View {
        let active = vm.country == code
        return Button {
            vm.country = (vm.country == code) ? "All" : code
            vm.scheduleReload()
        } label: {
            HStack(spacing: 5) {
                if let flag { Text(flag) }
                Text(name).font(.inter(11.5, .semibold))
                if let count { Text("· \(count)").font(.inter(11.5, .regular)).opacity(0.7) }
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 10).frame(height: 26)
            .background(active ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(.white.opacity(0.06)))
            .overlay(Capsule().stroke(.white.opacity(0.15), lineWidth: 1))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // Toolbar
    private var toolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink400)
                TextField("Search by name, email or programme…", text: $vm.search)
                    .font(.nBody).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: vm.search) { _, _ in vm.scheduleReload() }
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            Menu {
                Picker("Band", selection: $vm.band) {
                    Text("All").tag("All")
                    Text("Thriving").tag("thriving"); Text("Steady").tag("steady")
                    Text("Watch").tag("watch"); Text("At-risk").tag("at_risk"); Text("Graduated").tag("graduated")
                }
            } label: { filterLabel("Band: \(vm.band == "All" ? "All" : statusMeta(vm.band).label)") }
            .onChange(of: vm.band) { _, _ in vm.scheduleReload() }

            Menu {
                Picker("Cell", selection: $vm.cellFilter) {
                    ForEach(vm.cellNames, id: \.self) { Text($0).tag($0) }
                }
            } label: { filterLabel("Cell: \(vm.cellFilter)") }
        }
        .padding(12)
        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
    private func filterLabel(_ t: String) -> some View {
        HStack(spacing: 6) { Text(t).font(.inter(12, .semibold)); Image(systemName: "chevron.down").font(.system(size: 10)) }
            .foregroundStyle(Nuru.navy).padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg).overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2").font(.title).foregroundStyle(Nuru.ink300)
            Text("No members match those filters.").font(.nBody).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundStyle(Nuru.border))
    }

    private var footer: some View {
        HStack {
            Text("Showing \(vm.filtered.count) of \(vm.rows.count) loaded").font(.nCaption).foregroundStyle(Nuru.ink600)
            Spacer()
            HStack(spacing: 5) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(Nuru.success)
                Text("Live from the directory").font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
        .padding(.top, 8)
    }
}

private struct IdBox: Identifiable { let id: String }

// MARK: - Member row

private struct MemberRowCard: View {
    let member: MRow
    let index: Int
    let country: Country?
    let onResults: () -> Void
    let onEdit: () -> Void
    let onGraduate: () -> Void

    var body: some View {
        let sm = statusMeta(member.status)
        let progress = pctInt(member.eScore)
        return NavigationLink {
            MemberDetailView(userId: member.userId, name: member.fullName)
        } label: {
            HStack(spacing: 14) {
                ZStack(alignment: .bottomTrailing) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(avatarGradient(index))
                        .frame(width: 44, height: 44)
                        .overlay(Text(initials(member.fullName)).font(.inter(14, .bold)).foregroundStyle(.white))
                    if member.status == "thriving" {
                        Circle().fill(Color(hex: 0x16A34A)).frame(width: 12, height: 12)
                            .overlay(Circle().stroke(.white, lineWidth: 2)).offset(x: 3, y: 3)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(member.fullName).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text("L\(member.currentLevel.map(String.init) ?? "—")").font(.inter(9.5, .bold))
                            .foregroundStyle(Nuru.goldLo).padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Nuru.gold.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 4))
                        if member.isMinor {
                            Text("MINOR").font(.inter(9, .bold)).foregroundStyle(Color(hex: 0xA87616))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color(hex: 0xF59E0B).opacity(0.18)).clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                    Label(member.email ?? member.phoneNumber, systemImage: "envelope").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                    if country != nil || member.city != nil {
                        HStack(spacing: 4) {
                            if let f = country?.flag { Text(f).font(.system(size: 12)) }
                            Text([country?.name ?? member.countryCode, member.city].compactMap { $0 }.joined(separator: " · "))
                                .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                    }
                }
                .frame(width: 210, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Text(member.cellName ?? "—").font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Label("cell", systemImage: "person.crop.circle.badge.checkmark").font(.nMicro).foregroundStyle(Nuru.ink600)
                }.frame(width: 150, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Label("L\(member.startLevel ?? 1)·M\(member.startModuleSequence ?? 1)", systemImage: "flag.fill")
                        .font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                    Text("start point").font(.nMicro).foregroundStyle(Nuru.ink600)
                }.frame(width: 100, alignment: .leading)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(member.programme.flatMap { PROGRAMME_LABELS[$0] } ?? "Engagement").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                        Spacer()
                        Text("\(progress)%").font(.inter(12, .bold)).foregroundStyle(Nuru.navy)
                    }
                    ProgressBar(pct: Double(progress), fill: sm.fg, height: 6)
                }.frame(width: 170)

                Spacer(minLength: 0)

                Text(sm.label).font(.inter(11, .bold)).foregroundStyle(sm.fg)
                    .frame(width: 80).padding(.vertical, 5)
                    .background(sm.bg).overlay(Capsule().stroke(sm.fg.opacity(0.2), lineWidth: 1)).clipShape(Capsule())

                Button(action: onResults) {
                    Image(systemName: "chart.bar.xaxis").font(.system(size: 15)).foregroundStyle(Nuru.goldLo)
                        .frame(width: 36, height: 36).background(Nuru.inputBg)
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }.buttonStyle(.plain)

                Menu {
                    Button { onEdit() } label: { Label("Edit member", systemImage: "pencil") }
                    Button { onGraduate() } label: { Label(member.status == "graduated" ? "Un-graduate" : "Mark graduated", systemImage: "graduationcap") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15)).foregroundStyle(Nuru.ink600)
                        .frame(width: 32, height: 32).background(Nuru.inputBg)
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .nuruShadow(0.5)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add / Edit form

private struct MemberFormSheet: View {
    enum Mode { case add, edit(String) }
    let mode: Mode
    let cells: [EngagementCellRow]
    let countries: [Country]
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var fullName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var gender = ""
    @State private var hasDob = false
    @State private var dob = Date()
    @State private var country = ""
    @State private var city = ""
    @State private var language = ""
    @State private var cellId = ""
    @State private var startLevel = 1
    @State private var startModule = 1
    @State private var programme = ""
    @State private var baptized = false
    @State private var levels: [AdminLevel] = []
    @State private var modules: [AdminModuleSummary] = []
    @State private var saving = false
    @State private var error: String?
    @State private var loaded = false

    private var isEdit: Bool { if case .edit = mode { return true }; return false }
    private var selectedCell: EngagementCellRow? { cells.first { $0.cellGroupId == cellId } }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                personalSection
                placementSection
                SwiftUI.Section("Discipleship") { Toggle("Baptized", isOn: $baptized) }
            }
            .navigationTitle(isEdit ? "Edit member" : "Add a disciple")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEdit ? "Save" : "Add") { Task { await submit() } }.disabled(saving || (isEdit && !loaded))
                }
            }
            .task { await setup() }
            .onChange(of: startLevel) { _, n in Task { await loadModules(n) } }
        }
    }

    @ViewBuilder private var personalSection: some View {
        SwiftUI.Section("Personal details") {
            labeledField("Full name", required: true) { TextField("e.g. Grace Wanjiru", text: $fullName) }
            labeledField("Email", required: !isEdit) { TextField("name@email.com", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never) }
            labeledField("Phone") { TextField("+254 …", text: $phone).keyboardType(.phonePad) }
            Picker("Gender", selection: $gender) { Text("—").tag(""); Text("Female").tag("female"); Text("Male").tag("male"); Text("Other").tag("other") }
            Toggle("Set date of birth", isOn: $hasDob)
            if hasDob { DatePicker("Date of birth", selection: $dob, displayedComponents: .date) }
            Picker("Country", selection: $country) { Text("—").tag(""); ForEach(countries) { c in Text("\(c.flag ?? "") \(c.name)").tag(c.code) } }
            labeledField("City") { TextField("e.g. Nairobi", text: $city) }
            labeledField("Language") { TextField("e.g. en", text: $language).textInputAutocapitalization(.never) }
        }
    }

    @ViewBuilder private var placementSection: some View {
        SwiftUI.Section("Pathway placement") {
            Picker("Cell", selection: $cellId) { ForEach(cells) { c in Text(c.name).tag(c.cellGroupId) } }
            HStack { Text("Discipler").foregroundStyle(Nuru.ink600); Spacer(); Text(selectedCell?.disciplerName ?? "—").foregroundStyle(Nuru.navy) }
            Picker("Current level", selection: $startLevel) {
                if levels.isEmpty { Text("Level \(startLevel)").tag(startLevel) }
                else { ForEach(levels) { l in Text("Level \(l.levelNumber) — \(l.title)").tag(l.levelNumber) } }
            }
            Picker("Module reached", selection: $startModule) {
                if modules.isEmpty { Text("Module \(startModule)").tag(startModule) }
                else { ForEach(modules) { m in Text("Module \(m.moduleSequenceNumber) — \(m.title)").tag(m.moduleSequenceNumber) } }
            }
            Picker("Programme", selection: $programme) {
                Text("—").tag("")
                ForEach(Array(PROGRAMME_LABELS.keys).sorted(), id: \.self) { k in Text(PROGRAMME_LABELS[k] ?? k).tag(k) }
            }
            Text("Unlocks every earlier level in full, plus this level up to the selected module.")
                .font(.nMicro).foregroundStyle(Nuru.ink600)
        }
    }

    @ViewBuilder private func labeledField<C: View>(_ label: String, required: Bool = false, @ViewBuilder _ field: () -> C) -> some View {
        HStack { Text(label + (required ? " *" : "")).foregroundStyle(Nuru.ink600).frame(width: 110, alignment: .leading); field() }
    }

    private func setup() async {
        levels = (try? await PortalAPI.curriculumLevels()) ?? []
        if cellId.isEmpty, let first = cells.first { cellId = first.cellGroupId }
        if case .edit(let id) = mode {
            if let d = try? await MembersAPI.detail(id) {
                fullName = d.fullName; email = d.email ?? ""; phone = d.phoneNumber
                gender = d.gender ?? ""; country = d.countryCode ?? ""; city = d.city ?? ""
                language = d.language ?? ""; cellId = d.cellGroupId ?? cellId; programme = d.programme ?? ""
                baptized = d.isBaptized
                startLevel = d.startLevel ?? d.currentLevel ?? 1
                startModule = d.startModuleSequence ?? 1
                if let dobStr = d.dateOfBirth, let parsed = ISO8601DateFormatter().date(from: dobStr) { dob = parsed; hasDob = true }
            }
            loaded = true
        }
        await loadModules(startLevel)
    }
    private func loadModules(_ level: Int) async {
        modules = (try? await PortalAPI.modules(level: level)) ?? []
        if !modules.isEmpty, !modules.contains(where: { $0.moduleSequenceNumber == startModule }) {
            startModule = modules.first?.moduleSequenceNumber ?? 1
        }
    }

    private func submit() async {
        guard !fullName.trimmingCharacters(in: .whitespaces).isEmpty else { error = "Please enter the member's name."; return }
        guard !cellId.isEmpty else { error = "Select a cell."; return }
        if !isEdit, email.trimmingCharacters(in: .whitespaces).isEmpty { error = "Email is required."; return }
        saving = true; error = nil
        let dobStr: String? = hasDob ? { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; return f.string(from: dob) }() : nil
        do {
            if case .edit(let id) = mode {
                let body: [String: JSONValue] = [
                    "full_name": .string(fullName.trimmingCharacters(in: .whitespaces)),
                    "phone_number": .string(phone.isEmpty ? "n/a" : phone),
                    "cell_group_id": .string(cellId),
                    "is_baptized": .bool(baptized),
                    "email": email.isEmpty ? .null : .string(email),
                    "gender": gender.isEmpty ? .null : .string(gender),
                    "city": city.isEmpty ? .null : .string(city),
                    "programme": programme.isEmpty ? .null : .string(programme),
                    "country_code": country.isEmpty ? .null : .string(country),
                    "language": language.isEmpty ? .null : .string(language),
                    "date_of_birth": dobStr.map { JSONValue.string($0) } ?? .null,
                ]
                try await MembersAPI.update(id, body)
                try await MembersAPI.setStart(id, level: startLevel, module: startModule)
            } else {
                var body: [String: JSONValue] = [
                    "full_name": .string(fullName.trimmingCharacters(in: .whitespaces)),
                    "phone_number": .string(phone.isEmpty ? "n/a" : phone),
                    "email": .string(email.trimmingCharacters(in: .whitespaces)),
                    "cell_group_id": .string(cellId),
                    "is_baptized": .bool(baptized),
                    "start_level": .int(startLevel),
                    "start_module_sequence": .int(startModule),
                ]
                if !gender.isEmpty { body["gender"] = .string(gender) }
                if !city.isEmpty { body["city"] = .string(city) }
                if !programme.isEmpty { body["programme"] = .string(programme) }
                if !country.isEmpty { body["country_code"] = .string(country) }
                if !language.isEmpty { body["language"] = .string(language) }
                if let dobStr { body["date_of_birth"] = .string(dobStr) }
                try await MembersAPI.add(body)
            }
            saving = false; onDone(); dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false
        }
    }
}

// MARK: - Results dossier

private struct MemberResultsSheet: View {
    let userId: String
    @Environment(\.dismiss) private var dismiss
    @State private var data: MResults?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                    if let d = data {
                        ForEach(d.levels) { lv in LevelResultCard(lv: lv) }
                        if !d.badges.isEmpty {
                            SectionHeader(overline: "Achievements", title: "Badges attained")
                            FlexChips(d.badges.map { $0.name })
                        }
                        if !d.certificates.isEmpty {
                            SectionHeader(overline: "Records", title: "Certificates earned")
                            ForEach(d.certificates) { c in
                                Card {
                                    HStack(spacing: 12) {
                                        Image(systemName: "rosette").foregroundStyle(Color(hex: 0x7C3AED))
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text("Level \(c.levelNumber)\(c.levelTitle.map { " — \($0)" } ?? "")").font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                            Text("Issued \(Fmt.date(c.issuedAt)) · \(c.verificationCode)").font(.nMicro).foregroundStyle(Nuru.ink600)
                                        }
                                        Spacer()
                                    }
                                }
                            }
                        }
                    } else if error == nil {
                        SkeletonList(rows: 4)
                    }
                }
                .padding(20)
            }
            .background(Nuru.paper)
            .navigationTitle("Member results")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .task {
                do { data = try await MembersAPI.results(userId) }
                catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load results." }
            }
        }
    }
    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(data?.user.fullName ?? "Member results").font(.nTitle).foregroundStyle(.white)
            if let s = data?.summary {
                HStack(spacing: 10) {
                    summaryTile("Overall", s.overallScore.map { "\(Int($0.rounded()))%" } ?? "—")
                    summaryTile("Modules", "\(s.modulesCompleted)/\(s.modulesTotal)")
                    summaryTile("Levels", "\(s.levelsCompleted)")
                    summaryTile("Badges·Certs", "\(s.badges)·\(s.certificates)")
                }
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyGradient).clipShape(RoundedRectangle(cornerRadius: Nuru.R.hero, style: .continuous))
    }
    private func summaryTile(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.fraunces(18, .semibold)).foregroundStyle(.white)
            Text(label.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.onNavyDim)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(10)
        .background(.white.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private func scoreColor(_ n: Double?) -> Color {
    guard let n else { return Nuru.ink600 }
    return n >= 70 ? Color(hex: 0x16A34A) : n > 0 ? Color(hex: 0xA87616) : Color(hex: 0xDC2626)
}
private func pctLabel(_ n: Double?) -> String { n == nil ? "—" : "\(Int(n!.rounded()))%" }

private struct LevelResultCard: View {
    let lv: MResults.Level
    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Image(systemName: "book.closed").font(.system(size: 14)).foregroundStyle(Nuru.goldLo)
                            Text("Level \(lv.levelNumber) — \(lv.title)").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                            if lv.completed { Pill(text: "Complete", color: Color(hex: 0x16A34A)) }
                        }
                        Text("Modules avg \(pctLabel(lv.moduleAverage))" + (lv.exam.map { " · Exam \(pctLabel($0.score))" } ?? " · Exam —"))
                            .font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(pctLabel(lv.levelScore)).font(.inter(17, .bold)).foregroundStyle(scoreColor(lv.levelScore))
                        Text("LEVEL OVERALL").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(Nuru.ink600)
                    }
                }
                .padding(14)
                Divider()
                VStack(spacing: 0) {
                    ForEach(lv.modules) { m in
                        HStack(spacing: 10) {
                            Circle().fill(m.completed ? Color(hex: 0x16A34A) : m.attempts > 0 ? Color(hex: 0xA87616) : Color(hex: 0xD1D5DB)).frame(width: 8, height: 8)
                            Text("M\(m.sequence)").font(.nMicro).foregroundStyle(Nuru.ink600).frame(width: 26, alignment: .leading)
                            Text(m.title).font(.inter(12.5, .regular)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Spacer()
                            Text(pctLabel(m.bestScore)).font(.inter(13, .bold)).foregroundStyle(scoreColor(m.bestScore))
                        }
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        Divider()
                    }
                    if let exam = lv.exam {
                        HStack(spacing: 10) {
                            Image(systemName: "rosette").font(.system(size: 13)).foregroundStyle(Color(hex: 0x7C3AED))
                            Text("Level exam\(exam.passed ? " · passed" : "")").font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                            Spacer()
                            Text(pctLabel(exam.score)).font(.inter(13, .bold)).foregroundStyle(scoreColor(exam.score))
                        }
                        .padding(.horizontal, 14).padding(.vertical, 10)
                    }
                }
            }
        }
    }
}

// Simple wrapping chips row.
private struct FlexChips: View {
    let items: [String]
    init(_ items: [String]) { self.items = items }
    var body: some View {
        let cols = [GridItem(.adaptive(minimum: 120), spacing: 8)]
        LazyVGrid(columns: cols, alignment: .leading, spacing: 8) {
            ForEach(items, id: \.self) { t in
                HStack(spacing: 6) { Image(systemName: "star.fill").font(.system(size: 10)); Text(t).font(.inter(12, .bold)) }
                    .foregroundStyle(Color(hex: 0xA87616)).padding(.horizontal, 12).padding(.vertical, 7)
                    .background(Color(hex: 0xFFF6E0)).overlay(Capsule().stroke(Color(hex: 0xF5E0A8), lineWidth: 1)).clipShape(Capsule())
            }
        }
    }
}

// MARK: - Export

private struct ExportSheet: View {
    let members: [MRow]
    let countryByCode: [String: Country]
    @Environment(\.dismiss) private var dismiss
    @State private var selected: Set<String>

    init(members: [MRow], countryByCode: [String: Country]) {
        self.members = members; self.countryByCode = countryByCode
        _selected = State(initialValue: Set(members.map { $0.userId }))
    }

    private var csv: String {
        var out = "Name,Email,Country,City,Cell,Level,Programme,Status,Last active\n"
        for m in members where selected.contains(m.userId) {
            let cols = [m.fullName, m.email ?? "", countryByCode[m.countryCode ?? ""]?.name ?? m.countryCode ?? "",
                        m.city ?? "", m.cellName ?? "", "L\(m.currentLevel.map(String.init) ?? "—")",
                        m.programme.flatMap { PROGRAMME_LABELS[$0] } ?? "", statusMeta(m.status).label, relDays(m.lastActivity)]
            out += cols.map { "\"\($0.replacingOccurrences(of: "\"", with: "\"\""))\"" }.joined(separator: ",") + "\n"
        }
        return out
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    Button(selected.count == members.count ? "Deselect all" : "Select all") {
                        selected = selected.count == members.count ? [] : Set(members.map { $0.userId })
                    }.font(.inter(12.5, .semibold)).tint(Nuru.goldLo)
                    Spacer()
                    Text("\(selected.count) of \(members.count) selected").font(.nCaption).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 12)
                Divider()
                List {
                    ForEach(members) { m in
                        Button {
                            if selected.contains(m.userId) { selected.remove(m.userId) } else { selected.insert(m.userId) }
                        } label: {
                            HStack {
                                Image(systemName: selected.contains(m.userId) ? "checkmark.square.fill" : "square").foregroundStyle(selected.contains(m.userId) ? Nuru.gold : Nuru.ink300)
                                Text(m.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                Spacer()
                                Text(m.cellName ?? "—").font(.nCaption).foregroundStyle(Nuru.ink600)
                            }
                        }.buttonStyle(.plain)
                    }
                }
                .listStyle(.plain)
            }
            .navigationTitle("Export members")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    ShareLink(item: csv, preview: SharePreview("Nuru Pathway — Members.csv")) {
                        Label("Export \(selected.count)", systemImage: "square.and.arrow.up")
                    }.disabled(selected.isEmpty)
                }
            }
        }
    }
}
