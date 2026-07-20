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
private struct MPage: Codable { let data: [MRow]; let nextCursor: String? }

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

// Web-parity pills: soft pastel background + a darker cut of the same hue
// (e.g. At-risk = rose bg + deep rose text), fully rounded, no border.
private struct StatusMeta { let label: String; let fg: Color; let bg: Color }
private func statusMeta(_ key: String?) -> StatusMeta {
    switch key {
    case "thriving":  return StatusMeta(label: "Thriving", fg: Color(hex: 0x157F3D), bg: Color(hex: 0xE9F9EF))
    case "watch":     return StatusMeta(label: "Watch", fg: Color(hex: 0x8A6116), bg: Color(hex: 0xFDF3DC))
    case "at_risk":   return StatusMeta(label: "At-risk", fg: Color(hex: 0xB4232E), bg: Color(hex: 0xFDECEC))
    case "graduated": return StatusMeta(label: "Graduated", fg: Color(hex: 0x6D28D9), bg: Color(hex: 0xF1EBFB))
    default:          return StatusMeta(label: "Steady", fg: Color(hex: 0x33456B), bg: Color(hex: 0xEEF2FA))
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
    /// One keyset page. Every server-accepted filter (search/band/country/cell) goes
    /// to the DB; "graduated" is a derived flag with no server filter and is handled
    /// client-side. `cursor` is the last user_id of the prior page; nil = page 1.
    static func list(search: String, band: String?, country: String?,
                     cellGroupId: String?, cursor: String?, limit: Int) async throws -> MPage {
        var q: [String: String] = [:]
        let s = search.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { q["search"] = s }
        if let band, band != "All", band != "graduated" { q["band"] = band }
        if let country, country != "All" { q["country_code"] = country }
        if let cellGroupId, cellGroupId != "All" { q["cell_group_id"] = cellGroupId }
        if let cursor { q["cursor"] = cursor }
        q["limit"] = String(limit)
        return try await APIClient.shared.get("/admin/members", query: q, as: MPage.self)
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
    /// Elevate a member to portal (staff) access — POST /admin/members/{id}/elevate
    /// (perm users:create), body `{}`. Mirrors the web OpsApi.elevateMember: the member
    /// keeps their Student membership and now also appears on System ▸ Users, where
    /// roles/permissions are assigned. The `{ user_id, full_name, is_staff, role }` ack
    /// is ignored — the caller already holds the row's name for the toast.
    static func elevate(_ id: String) async throws {
        _ = try await APIClient.shared.post("/admin/members/\(id)/elevate",
                                            body: [String: JSONValue](), as: OkResponse.self)
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
    @Published var cellFilter = "All"     // cell_group_id or "All" (applied server-side)
    @Published var country = "All"
    @Published var error: String?
    @Published var loading = true
    // Keyset pagination: the server pages by user_id and returns next_cursor. We load
    // page 1 on any filter change, then append pages via infinite scroll / "Load more"
    // so the whole directory is reachable — never just the first 50.
    @Published var nextCursor: String?
    @Published var loadingMore = false
    private let PAGE = 100
    private var task: Task<Void, Never>?
    // Bumped on every reload so an in-flight loadMore/auto-page from a stale query
    // (e.g. after the filters changed) can bail instead of corrupting the new page.
    private var generation = 0

    var countryByCode: [String: Country] { Dictionary(countries.map { ($0.code, $0) }, uniquingKeysWith: { a, _ in a }) }
    // Cell filter cycles the FULL cell list (by id) and is applied server-side, so it
    // finds members on any page — not just those already loaded.
    var cellOptions: [String] { ["All"] + cells.map { $0.cellGroupId } }
    func cellLabel(_ id: String) -> String {
        id == "All" ? "All" : (cells.first { $0.cellGroupId == id }?.name ?? "Cell")
    }

    var filtered: [MRow] {
        // Only "graduated" is client-side (no server filter); every other filter is
        // already applied by the query, so this operates on the fully-paged set.
        band == "graduated" ? rows.filter { $0.status == "graduated" } : rows
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
        generation += 1
        let gen = generation
        if rows.isEmpty { loading = true }
        do {
            let page = try await MembersAPI.list(search: search, band: band, country: country,
                                                 cellGroupId: cellFilter, cursor: nil, limit: PAGE)
            guard gen == generation else { return }   // superseded by a newer reload
            rows = page.data
            nextCursor = page.nextCursor
            error = nil
        } catch {
            guard gen == generation else { return }
            self.error = (error as? APIError)?.errorDescription ?? "Could not load members."
        }
        loading = false
        // "Graduated" has no server filter, so to surface every graduate we must page
        // the whole set. Auto-advance through the pages while that filter is active;
        // stop if a page fails so a persistent error can't tight-loop the server.
        while gen == generation, band == "graduated", nextCursor != nil, error == nil {
            await loadMore(gen: gen)
        }
    }
    func loadMore(gen: Int? = nil) async {
        guard let cursor = nextCursor, !loadingMore else { return }
        let g = gen ?? generation
        loadingMore = true
        do {
            let page = try await MembersAPI.list(search: search, band: band, country: country,
                                                 cellGroupId: cellFilter, cursor: cursor, limit: PAGE)
            guard g == generation else { loadingMore = false; return }
            let seen = Set(rows.map { $0.userId })
            rows.append(contentsOf: page.data.filter { !seen.contains($0.userId) })
            nextCursor = page.nextCursor
        } catch {
            guard g == generation else { loadingMore = false; return }
            self.error = (error as? APIError)?.errorDescription ?? "Could not load more members."
        }
        loadingMore = false
    }
    func scheduleReload() {
        task?.cancel()
        task = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 250_000_000)
            if !Task.isCancelled { await self?.reload() }
        }
    }
    /// Returns true on success so the screen can raise a toast.
    @discardableResult
    func graduate(_ id: String, _ next: Bool) async -> Bool {
        do { try await MembersAPI.setGraduation(id, next); await reload(); return true }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not update graduation."; return false }
    }
}

// MARK: - Desktop table columns

/// Fixed table-column widths. On the Mac the directory is a workspace page —
/// the table fills the window, so the fixed columns widen to match. iPhone/iPad
/// keep the ~740pt-tuned values (compile-time gate → byte-identical layouts).
private enum MCol {
    static let name: CGFloat = MacDesign.isMac ? 280 : 175
    static let cell: CGFloat = MacDesign.isMac ? 170 : 105
    static let start: CGFloat = MacDesign.isMac ? 92 : 72
    static let progress: CGFloat = MacDesign.isMac ? 230 : 120
    static let status: CGFloat = MacDesign.isMac ? 92 : 70
}

// MARK: - Members screen

struct MembersView: View {
    @StateObject private var vm = MembersVM()
    @EnvironmentObject private var router: NavRouter
    @State private var addOpen = false
    @State private var editId: String?
    @State private var resultsId: String?
    @State private var resetPasswordFor: IdName?     // row-menu "Reset password" target
    @State private var elevateFor: IdName?           // row-menu "Make portal user" target
    @State private var exportOpen = false
    @State private var toast: ToastData?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(spacing: 14) {
                    if let e = vm.error { ErrorBanner(message: e) { Task { await vm.reload() } } }
                    statTiles
                    toolbar
                    if vm.loading && vm.rows.isEmpty {
                        SkeletonTable(rows: 8)
                    } else if vm.filtered.isEmpty {
                        emptyState
                    } else {
                        // Dense, aligned table: one card holds an overline header row +
                        // hairline-separated member rows (columns aligned via fixed widths).
                        VStack(spacing: 0) {
                            tableHeader
                            ForEach(Array(vm.filtered.enumerated()), id: \.element.id) { i, m in
                                if i > 0 { Divider().overlay(Nuru.border) }
                                MemberRowCard(member: m, index: i, country: m.countryCode.flatMap { vm.countryByCode[$0] },
                                              onResults: { resultsId = m.userId },
                                              onEdit: { editId = m.userId },
                                              onResetPassword: { resetPasswordFor = IdName(id: m.userId, name: m.fullName) },
                                              onElevate: { elevateFor = IdName(id: m.userId, name: m.fullName) },
                                              onGraduate: {
                                                  let next = m.status != "graduated"
                                                  Task {
                                                      if await vm.graduate(m.userId, next) {
                                                          toast = .success(next ? "\(m.fullName) marked graduated" : "Graduation removed for \(m.fullName)")
                                                      } else {
                                                          toast = .error(vm.error ?? "Could not update graduation.")
                                                      }
                                                  }
                                              })
                                    // Infinite scroll: the last loaded row nearing the
                                    // viewport pulls the next keyset page.
                                    .onAppear {
                                        if i == vm.filtered.count - 1, vm.nextCursor != nil {
                                            Task { await vm.loadMore() }
                                        }
                                    }
                            }
                        }
                        .background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        .nuruShadow(0.5)
                        footer
                    }
                }
                .padding(20)
                // Mac: the directory is a workspace page — the table fills the
                // window (with margins) instead of a narrow reading column.
                .macContentColumn(MacDesign.workspaceMaxWidth)
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
        .toast($toast)
        .sheet(isPresented: $addOpen) {
            MemberFormSheet(mode: .add, cells: vm.cells, countries: vm.countries) {
                toast = .success("Member added")
                Task { await vm.reload() }
            }
                .presentationDetents([.large])
        }
        .sheet(item: Binding(get: { editId.map { IdBox(id: $0) } }, set: { editId = $0?.id })) { box in
            MemberFormSheet(mode: .edit(box.id), cells: vm.cells, countries: vm.countries) {
                toast = .success("Member updated")
                Task { await vm.reload() }
            }
                .presentationDetents([.large])
        }
        .sheet(item: Binding(get: { resultsId.map { IdBox(id: $0) } }, set: { resultsId = $0?.id })) { box in
            MemberResultsSheet(userId: box.id)
        }
        .sheet(isPresented: $exportOpen) { ExportSheet(members: vm.filtered, countryByCode: vm.countryByCode) }
        // Row-menu "Reset password" — the web ResetPasswordModal, surfaced per row.
        .sheet(item: $resetPasswordFor) { t in
            MemberResetPasswordSheet(userId: t.id, name: t.name)
                .presentationDetents([.medium, .large])
        }
        // Row-menu "Make portal user" — confirm, elevate, toast, reload (web `elevate`).
        .confirmationDialog(
            "Make portal user?",
            isPresented: Binding(get: { elevateFor != nil }, set: { if !$0 { elevateFor = nil } }),
            titleVisibility: .visible,
            presenting: elevateFor
        ) { t in
            Button("Make portal user") { Task { await elevate(t) } }
            Button("Cancel", role: .cancel) {}
        } message: { t in
            Text("Make \(t.name) a portal user? They'll be able to sign in to the admin console and will appear on System ▸ Users, where you assign roles and permissions. Their member access is unchanged.")
        }
    }

    // Elevate a member to portal (staff) access from the row menu (web "Make portal
    // user"). On success: a toast pointing to System ▸ Users, then reload.
    private func elevate(_ t: IdName) async {
        do {
            try await MembersAPI.elevate(t.id)
            toast = .success("\(t.name) is now a portal user — assign roles on System ▸ Users.")
            await vm.reload()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not make portal user.")
        }
    }

    // Hero — shared PortalHero (breadcrumb · title · band stat strip · trailing chips).
    // The "By country" filter chips row is a Members-only element PortalHero can't
    // express, so it stays as a sibling on the same navy band directly beneath.
    private var hero: some View {
        VStack(alignment: .leading, spacing: 0) {
            PortalHero(
                breadcrumb: ["Nuru Pathway", "Members"],
                title: "Members"
                // Band counts moved out of the navy strip into the web-parity
                // pastel stat tiles just below the hero (see `statTiles`).
            ) {
                HStack(spacing: 8) {
                    HeroChip(label: "\(vm.counts.total) on pathway", icon: "person.2.fill", style: .tag)
                    HeroChip(label: "Export", icon: "square.and.arrow.up", style: .ghost) { exportOpen = true }
                    HeroChip(label: "Add member", icon: "plus", style: .gold) { addOpen = true }
                }
            }
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
                .padding(.horizontal, Nuru.S.lg)
                .padding(.bottom, Nuru.S.lg)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    // Web-parity stat tiles — soft pastel tints on the warm paper with deep-tint
    // numerals (blue-grey total · mint thriving · amber watch · rose at-risk).
    private var statTiles: some View {
        HStack(spacing: 12) {
            MemberStatTile(label: "Total members", value: vm.counts.total,
                           bg: Color(hex: 0xEEF2FA), fg: Color(hex: 0x33456B))
            MemberStatTile(label: "Thriving", value: vm.counts.thriving,
                           bg: Color(hex: 0xE9F9EF), fg: Color(hex: 0x157F3D))
            MemberStatTile(label: "Watch", value: vm.counts.watch,
                           bg: Color(hex: 0xFDF3DC), fg: Color(hex: 0x8A6116))
            MemberStatTile(label: "At-risk", value: vm.counts.atRisk,
                           bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xB4232E))
        }
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
        .pressable()
        .hoverEffect(.lift)
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
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))

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
                    ForEach(vm.cellOptions, id: \.self) { Text(vm.cellLabel($0)).tag($0) }
                }
            } label: { filterLabel("Cell: \(vm.cellLabel(vm.cellFilter))") }
            .onChange(of: vm.cellFilter) { _, _ in vm.scheduleReload() }
        }
        .padding(12)
        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
    private func filterLabel(_ t: String) -> some View {
        HStack(spacing: 6) { Text(t).font(.inter(12, .semibold)); Image(systemName: "chevron.down").font(.system(size: 10)) }
            .foregroundStyle(Nuru.navy).padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg).overlay(RoundedRectangle(cornerRadius: Nuru.R.chip).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    // Column header — widths mirror MemberRowCard's fixed columns so titles align.
    // Tuned to fit ~740pt portrait width without horizontal overflow.
    private var tableHeader: some View {
        HStack(spacing: 10) {
            Text("Member").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .frame(width: 44 + MCol.name + 10, alignment: .leading)
            Text("Cell").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .frame(width: MCol.cell, alignment: .leading)
            Text("Start").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .frame(width: MCol.start, alignment: .leading)
            Text("Progress").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .frame(width: MCol.progress, alignment: .leading)
            Spacer(minLength: 0)
            Text("Status").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                .frame(width: MCol.status, alignment: .center)
            Text("").frame(width: 34 + 10 + 30)   // Results + menu action columns
        }
        .padding(.horizontal, 18).padding(.vertical, 11)
        .background(Nuru.surface)
        .overlay(Divider().overlay(Nuru.border), alignment: .bottom)
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
            Text("Showing \(vm.filtered.count)\(vm.nextCursor != nil ? " so far" : " of \(vm.filtered.count)")\(vm.loadingMore ? " · loading…" : "")")
                .font(.nCaption).foregroundStyle(Nuru.ink600)
            Spacer()
            if vm.nextCursor != nil {
                Button { Task { await vm.loadMore() } } label: {
                    HStack(spacing: 6) {
                        if vm.loadingMore { ProgressView().controlSize(.small).tint(.white) }
                        Text(vm.loadingMore ? "Loading…" : "Load more").font(.inter(12.5, .semibold))
                        Image(systemName: "chevron.down").font(.system(size: 10))
                    }
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 34)
                    .background(Nuru.navy).clipShape(Capsule())
                }
                .disabled(vm.loadingMore)
                .pressable()
                .hoverEffect(.lift)
            } else {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 11)).foregroundStyle(Nuru.success)
                    Text("All members loaded").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
            }
        }
        .padding(.top, 8)
    }
}

private struct IdBox: Identifiable { let id: String }
/// Row-menu action target that carries the display name for confirm copy / toasts.
private struct IdName: Identifiable { let id: String; let name: String }

// MARK: - Reset password (row-menu flow — mirrors the web ResetPasswordModal)

/// Surfaced from the member row's ⋮ menu. Explains the consequences, then POSTs the
/// reset and reveals the freshly-minted temporary password EXACTLY ONCE with a Copy
/// affordance. The server revokes every session and invalidates the old password.
private struct MemberResetPasswordSheet: View {
    let userId: String
    let name: String
    @Environment(\.dismiss) private var dismiss
    @State private var resetting = false
    @State private var temp: String?
    @State private var error: String?
    @State private var toast: ToastData?

    private static let teal = Color(hex: 0x0E7490)     // web KeyRound accent
    private var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        TintedIcon(systemName: "key.fill", color: Self.teal, size: 40)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(name).font(.inter(15, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Text("Manual password reset").font(.inter(12)).foregroundStyle(Nuru.ink600)
                        }
                        Spacer(minLength: 0)
                    }

                    if let error {
                        Text(error).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12).background(Nuru.danger.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    }

                    if let temp {
                        // Shown ONCE — never retrievable again.
                        (Text("Hand this to \(firstName) — it works immediately and they can change it in their app under Profile. ")
                            + Text("It will not be shown again.").bold())
                            .font(.inter(13)).foregroundStyle(Nuru.ink600)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 12) {
                            Text(temp)
                                .font(.system(size: 20, weight: .bold, design: .monospaced))
                                .foregroundStyle(Nuru.navy).textSelection(.enabled)
                                .lineLimit(1).minimumScaleFactor(0.6)
                            Spacer(minLength: 0)
                            Button {
                                UIPasteboard.general.string = temp
                                toast = .success("Password copied")
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: "doc.on.doc").font(.system(size: 12, weight: .semibold))
                                    Text("Copy").font(.inter(12.5, .bold))
                                }
                                .foregroundStyle(.white).padding(.horizontal, 14).frame(height: 34)
                                .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .pressable().hoverEffect(.lift)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 13)
                        .background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    } else {
                        Text("This creates a new temporary password for \(name), signs them out of every device, and invalidates their old password. Use it when a member is locked out and can't reset it themselves.")
                            .font(.inter(13)).foregroundStyle(Nuru.ink600)
                            .fixedSize(horizontal: false, vertical: true)
                        Button { Task { await reset() } } label: {
                            HStack(spacing: 8) {
                                if resetting { ProgressView().controlSize(.small).tint(.white) }
                                else { Image(systemName: "key.fill").font(.system(size: 13, weight: .semibold)) }
                                Text(resetting ? "Resetting…" : "Reset & get password").font(.inter(13.5, .bold))
                            }
                            .foregroundStyle(.white).frame(maxWidth: .infinity).frame(height: 46)
                            .background(Self.teal).clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                        }
                        .pressable().hoverEffect(.lift).disabled(resetting)
                    }
                }
                .padding(20)
                .frame(maxWidth: 560).frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Reset password")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .toast($toast)
        }
    }

    private func reset() async {
        guard !resetting else { return }
        resetting = true; error = nil
        do { temp = try await PortalAPI.resetMemberPassword(userId) }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not reset password." }
        resetting = false
    }
}

/// One pastel stat tile: quiet muted label over a big deep-tint numeral —
/// borderless tinted surface, exactly the web Members page's airy tiles.
private struct MemberStatTile: View {
    let label: String
    let value: Int
    let bg: Color
    let fg: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.85)
            Text("\(value)").font(.fraunces(27, .semibold)).foregroundStyle(fg)
                .contentTransition(.numericText())
                .animation(.default, value: value)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Member row

private struct MemberRowCard: View {
    let member: MRow
    let index: Int
    let country: Country?
    let onResults: () -> Void
    let onEdit: () -> Void
    let onResetPassword: () -> Void
    let onElevate: () -> Void
    let onGraduate: () -> Void

    var body: some View {
        let sm = statusMeta(member.status)
        let progress = pctInt(member.eScore)
        return NavigationLink {
            MemberDetailView(userId: member.userId, name: member.fullName)
        } label: {
            HStack(spacing: 10) {
                ZStack(alignment: .bottomTrailing) {
                    RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).fill(avatarGradient(index))
                        .frame(width: 44, height: 44)
                        .overlay(Text(initials(member.fullName)).font(.inter(13.5, .bold)).foregroundStyle(.white))
                    if member.status == "thriving" {
                        Circle().fill(Color(hex: 0x16A34A)).frame(width: 12, height: 12)
                            .overlay(Circle().stroke(.white, lineWidth: 2)).offset(x: 3, y: 3)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(member.fullName).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
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
                .frame(width: MCol.name, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Text(member.cellName ?? "—").font(.inter(12, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Label("cell", systemImage: "person.crop.circle.badge.checkmark").font(.nMicro).foregroundStyle(Nuru.ink600)
                }.frame(width: MCol.cell, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Label("L\(member.startLevel ?? 1)·M\(member.startModuleSequence ?? 1)", systemImage: "flag.fill")
                        .font(.inter(12, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                    Text("start").font(.nMicro).foregroundStyle(Nuru.ink600)
                }.frame(width: MCol.start, alignment: .leading)

                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(member.programme.flatMap { PROGRAMME_LABELS[$0] } ?? "Engagement").font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.85)
                        Spacer(minLength: 4)
                        Text("\(progress)%").font(.inter(11.5, .bold)).foregroundStyle(Nuru.navy)
                    }
                    ProgressBar(pct: Double(progress), fill: sm.fg, height: 6)
                }.frame(width: MCol.progress)

                Spacer(minLength: 0)

                // Fully-rounded web pill: tinted bg + darker same-hue text, no border.
                Text(sm.label).font(.inter(10.5, .bold)).foregroundStyle(sm.fg)
                    .lineLimit(1).minimumScaleFactor(0.8)
                    .frame(width: MCol.status).padding(.vertical, 6)
                    .background(sm.bg).clipShape(Capsule())

                Button(action: onResults) {
                    Image(systemName: "chart.bar.xaxis").font(.system(size: 14)).foregroundStyle(Nuru.goldLo)
                        .frame(width: 34, height: 34).background(Nuru.inputBg)
                        .overlay(RoundedRectangle(cornerRadius: 9).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                }
                .pressable()
                .hoverEffect(.highlight)

                // Row actions — identical order to the web ⋮ menu:
                // Edit member · Reset password · Make portal user · Mark graduated.
                Menu {
                    Button { onEdit() } label: { Label("Edit member", systemImage: "pencil") }
                    Button { onResetPassword() } label: { Label("Reset password", systemImage: "key.fill") }
                    Button { onElevate() } label: { Label("Make portal user", systemImage: "shield.lefthalf.filled") }
                    Button { onGraduate() } label: { Label(member.status == "graduated" ? "Un-graduate" : "Mark graduated", systemImage: "graduationcap") }
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 14)).foregroundStyle(Nuru.ink600)
                        .frame(width: 30, height: 30).background(Nuru.inputBg)
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.xs).stroke(Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                }
            }
            // ~72pt rows (44pt avatar + 14pt above/below) — the web directory's
            // generous row height; hairline dividers do the separating.
            .padding(.horizontal, 18).padding(.vertical, 14)
            .background(Nuru.white)
            .contentShape(Rectangle())
        }
        .pressable()
        .hoverEffect(.highlight)
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
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error {
                        Text(error).font(.inter(13, .semibold)).foregroundStyle(Nuru.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(12).background(Nuru.danger.opacity(0.08))
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                    }
                    personalSection
                    placementSection
                    discipleshipSection
                }
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 22)
            }
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit member" : "Add a disciple")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.tint(Nuru.ink600) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEdit ? "Save" : "Add") { Task { await submit() } }
                        .font(.inter(14, .bold)).tint(Nuru.gold)
                        .disabled(saving || (isEdit && !loaded))
                }
            }
            .task { await setup() }
            .onChange(of: startLevel) { _, n in Task { await loadModules(n) } }
        }
    }

    @ViewBuilder private var personalSection: some View {
        MFormSection("Personal details") {
            MFieldGrid {
                MField("Full name", required: true) { TextField("e.g. Grace Wanjiru", text: $fullName).mFieldStyle() }
                MField("Email", required: !isEdit) { TextField("name@email.com", text: $email).keyboardType(.emailAddress).textInputAutocapitalization(.never).mFieldStyle() }
                MField("Phone") { TextField("+254 …", text: $phone).keyboardType(.phonePad).mFieldStyle() }
                MField("Gender") {
                    Picker("Gender", selection: $gender) { Text("—").tag(""); Text("Female").tag("female"); Text("Male").tag("male"); Text("Other").tag("other") }
                        .mPickerStyle()
                }
                MField("Date of birth") {
                    HStack(spacing: 10) {
                        Toggle("", isOn: $hasDob).labelsHidden().tint(Nuru.lumGreen)
                        if hasDob {
                            DatePicker("", selection: $dob, displayedComponents: .date).labelsHidden().tint(Nuru.gold)
                        } else {
                            Text("Not set").font(.inter(15)).foregroundStyle(Nuru.ink400)
                        }
                        Spacer(minLength: 0)
                    }
                    .mFieldChrome()
                }
                MField("Country") {
                    Picker("Country", selection: $country) { Text("—").tag(""); ForEach(countries) { c in Text("\(c.flag ?? "") \(c.name)").tag(c.code) } }
                        .mPickerStyle()
                }
                MField("City") { TextField("e.g. Nairobi", text: $city).mFieldStyle() }
                MField("Language") { TextField("e.g. en", text: $language).textInputAutocapitalization(.never).mFieldStyle() }
            }
        }
    }

    @ViewBuilder private var placementSection: some View {
        MFormSection("Pathway placement") {
            MFieldGrid {
                MField("Cell") {
                    Picker("Cell", selection: $cellId) { ForEach(cells) { c in Text(c.name).tag(c.cellGroupId) } }
                        .mPickerStyle()
                }
                MField("Discipler") {
                    HStack { Text(selectedCell?.disciplerName ?? "—").font(.inter(15)).foregroundStyle(Nuru.navy); Spacer(minLength: 0) }
                        .mFieldChrome()
                }
                MField("Current level") {
                    Picker("Current level", selection: $startLevel) {
                        if levels.isEmpty { Text("Level \(startLevel)").tag(startLevel) }
                        else { ForEach(levels) { l in Text("Level \(l.levelNumber) — \(l.title)").tag(l.levelNumber) } }
                    }.mPickerStyle()
                }
                MField("Module reached") {
                    Picker("Module reached", selection: $startModule) {
                        if modules.isEmpty { Text("Module \(startModule)").tag(startModule) }
                        else { ForEach(modules) { m in Text("Module \(m.moduleSequenceNumber) — \(m.title)").tag(m.moduleSequenceNumber) } }
                    }.mPickerStyle()
                }
                MField("Programme") {
                    Picker("Programme", selection: $programme) {
                        Text("—").tag("")
                        ForEach(Array(PROGRAMME_LABELS.keys).sorted(), id: \.self) { k in Text(PROGRAMME_LABELS[k] ?? k).tag(k) }
                    }.mPickerStyle()
                }
            }
            Text("Unlocks every earlier level in full, plus this level up to the selected module.")
                .font(.inter(12)).foregroundStyle(Nuru.ink600)
        }
    }

    @ViewBuilder private var discipleshipSection: some View {
        MFormSection("Discipleship") {
            Toggle(isOn: $baptized) {
                Text("Baptized").font(.inter(15, .semibold)).foregroundStyle(Nuru.ink)
            }
            .tint(Nuru.lumGreen)
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        }
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

// MARK: - Bright form kit (Pass v6 — warm, roomy, two-column edit/add forms)

/// A bright section card: navy overline title + a white-fielded content block on paper.
private struct MFormSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.inter(12, .bold)).tracking(1.2).foregroundStyle(Nuru.navy)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow(0.5)
    }
}

/// Two-column adaptive grid for paired fields (wraps to one column when tight).
private struct MFieldGrid<Content: View>: View {
    @ViewBuilder let content: () -> Content
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16)],
                  alignment: .leading, spacing: 14) {
            content()
        }
    }
}

/// A labelled field cell — dark-ink overline label above the editable control.
private struct MField<Content: View>: View {
    let label: String
    let required: Bool
    @ViewBuilder let content: () -> Content
    init(_ label: String, required: Bool = false, @ViewBuilder content: @escaping () -> Content) {
        self.label = label; self.required = required; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11.5, .bold)).foregroundStyle(Nuru.danger) }
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// White, readable field chrome shared by text inputs, pickers and inline rows.
private struct MFieldChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.inter(15))
            .foregroundStyle(Nuru.ink)
            .padding(.horizontal, 14)
            .frame(height: 44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}
extension View {
    fileprivate func mFieldChrome() -> some View { modifier(MFieldChrome()) }
    fileprivate func mFieldStyle() -> some View { self.textFieldStyle(.plain).mFieldChrome() }
    fileprivate func mPickerStyle() -> some View {
        self.pickerStyle(.menu).tint(Nuru.navy)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 8).frame(height: 44)
            .background(Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
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
        .background(.white.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
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
                        }
                        .pressable()
                        .hoverEffect(.highlight)
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
