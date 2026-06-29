// Members — native SwiftUI port of the web Members page (Members.tsx). Matches the
// make: navy hero with breadcrumb + "on pathway" tag + Export/Add chips, a 4-up
// stat strip (Total / Thriving / Watch / At-risk), a "By country" chip filter row,
// the full filter bar (search + band/level/cell/gender/programme/country), and the
// roster list. Each row carries identity (monogram, name, L-pill, MINOR, email,
// country·city), cell, start point, programme progress, last active, and a server-
// derived status pill, and pushes MemberDetailView. Cursor pagination.
//
// Roster rows come from a page-local Codable that mirrors the web MemberRow (the
// shared MemberRow is a slimmer subset), fetched through APIClient.shared.get so we
// can pass every filter param from api/client.ts. The shared MemberRow/MembersPage
// and PortalAPI.members stay untouched.
import SwiftUI

// MARK: - Page-local wire models (full web MemberRow shape; snake_case via decoder)

fileprivate enum MemberStatusKey: String, CaseIterable {
    case thriving, steady, watch, at_risk, graduated
    var label: String {
        switch self {
        case .thriving: "Thriving"; case .steady: "Steady"; case .watch: "Watch"
        case .at_risk: "At-risk"; case .graduated: "Graduated"
        }
    }
    /// Pill colours mirror statusMeta in Members.tsx.
    var fg: Color {
        switch self {
        case .thriving: Color(hex: 0x16A34A); case .steady: Color(hex: 0x0B1F33)
        case .watch:    Color(hex: 0x8B6914); case .at_risk: Color(hex: 0xDC2626)
        case .graduated: Color(hex: 0x7C3AED)
        }
    }
    var bg: Color {
        switch self {
        case .thriving: Color(hex: 0x16A34A, alpha: 0.10); case .steady: Color(hex: 0x0B1F33, alpha: 0.08)
        case .watch:    Color(hex: 0xC89B3C, alpha: 0.12); case .at_risk: Color(hex: 0xDC2626, alpha: 0.10)
        case .graduated: Color(hex: 0x7C3AED, alpha: 0.10)
        }
    }
    var ring: Color {
        switch self {
        case .thriving: Color(hex: 0x16A34A, alpha: 0.20); case .steady: Color(hex: 0x0B1F33, alpha: 0.15)
        case .watch:    Color(hex: 0xC89B3C, alpha: 0.25); case .at_risk: Color(hex: 0xDC2626, alpha: 0.20)
        case .graduated: Color(hex: 0x7C3AED, alpha: 0.25)
        }
    }
}

private let programmeLabels: [String: String] = [
    "new_believer": "New Believer", "foundations": "Foundations",
    "serving_track": "Serving Track", "leadership_prep": "Leadership Prep",
]

fileprivate struct MemberListRow: Codable, Identifiable {
    var userId: String = ""
    var fullName: String = ""
    let email: String?
    var phoneNumber: String = ""
    var isMinor: Bool = false
    let cellName: String?
    let cellGroupId: String?
    let currentLevel: Int?
    let startLevel: Int?
    let startModuleSequence: Int?
    let eScore: Double?
    let band: String?
    let lastActivity: String?
    let gender: String?
    let city: String?
    let programme: String?
    let countryCode: String?
    let age: Int?
    let status: String?
    var id: String { userId }

    var statusKey: MemberStatusKey { MemberStatusKey(rawValue: status ?? "steady") ?? .steady }
    var progress: Int { Int((eScore ?? 0) * 100) }
}

private struct MemberListPage: Codable {
    let data: [MemberListRow]
    let nextCursor: String?
}

// MARK: - View model

@MainActor
fileprivate final class MembersViewModel: ObservableObject {
    @Published var rows: [MemberListRow] = []
    @Published var countries: [Country] = []
    @Published var loading = false
    @Published var loadingMore = false
    @Published var error: String?

    // Filters (mirror the web toolbar + chips)
    @Published var search = ""
    @Published var band: MemberStatusKey?       // nil == All; .graduated filters client-side
    @Published var level: Int?                   // nil == All
    @Published var cellFilter = "All"
    @Published var gender: String?               // nil == All
    @Published var programme: String?            // nil == All
    @Published var countryFilter = "All"         // ISO-2 or "All"

    private var cursor: String?
    private var canLoadMore = true

    var countryByCode: [String: Country] { Dictionary(uniqueKeysWithValues: countries.map { ($0.code, $0) }) }

    /// Cell names present in the loaded roster (web cellNames).
    var cellNames: [String] {
        ["All"] + Array(Set(rows.compactMap { $0.cellName })).sorted()
    }

    /// Rows after the client-side cell + graduated filters (web `filtered`).
    var filtered: [MemberListRow] {
        rows.filter { m in
            (cellFilter == "All" || m.cellName == cellFilter) &&
            (band != .graduated || m.status == "graduated")
        }
    }

    /// "By country" chips with counts over the loaded roster (web countryChips).
    struct CountryChip: Identifiable { let code: String; let count: Int; let country: Country?; var id: String { code } }
    var countryChips: [CountryChip] {
        var counts: [String: Int] = [:]
        for m in rows { if let c = m.countryCode { counts[c, default: 0] += 1 } }
        return counts.map { CountryChip(code: $0.key, count: $0.value, country: countryByCode[$0.key]) }
            .sorted { $0.count > $1.count }
    }

    var totals: (total: Int, thriving: Int, watch: Int, atRisk: Int) {
        (rows.count,
         rows.filter { $0.status == "thriving" }.count,
         rows.filter { $0.status == "watch" }.count,
         rows.filter { $0.status == "at_risk" }.count)
    }

    private func query(cursor: String?) -> [String: String] {
        var q: [String: String] = [:]
        let s = search.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { q["search"] = s }
        // Band goes to the server; "graduated" is derived, so it filters client-side.
        if let band, band != .graduated { q["band"] = band.rawValue }
        if let level { q["level"] = String(level) }
        if let gender { q["gender"] = gender }
        if let programme { q["programme"] = programme }
        if countryFilter != "All" { q["country_code"] = countryFilter }
        if let cursor { q["cursor"] = cursor }
        return q
    }

    func reload() async {
        cursor = nil; canLoadMore = true; rows = []
        await load(reset: true)
    }

    func loadMore() async {
        guard canLoadMore, !loading, !loadingMore else { return }
        await load(reset: false)
    }

    private func load(reset: Bool) async {
        if reset { loading = true } else { loadingMore = true }
        error = nil
        do {
            let page = try await APIClient.shared.get("/admin/members", query: query(cursor: cursor), as: MemberListPage.self)
            rows.append(contentsOf: page.data)
            cursor = page.nextCursor
            canLoadMore = page.nextCursor != nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false; loadingMore = false
    }

    func loadCountries() async {
        countries = (try? await PortalAPI.countries()) ?? []
    }
}

// MARK: - Members screen

struct MembersView: View {
    @StateObject private var vm = MembersViewModel()
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0, pinnedViews: []) {
                hero
                VStack(spacing: 12) {
                    if let error = vm.error {
                        ErrorBanner(message: error) { Task { await vm.reload() } }
                    }
                    filterBar
                    roster
                    footer
                }
                .padding(.horizontal, Nuru.S.base)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, Nuru.S.xxl)
            }
        }
        .background(Nuru.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if vm.rows.isEmpty { await vm.reload() }
            if vm.countries.isEmpty { await vm.loadCountries() }
        }
        .refreshable { await vm.reload() }
    }

    // MARK: Hero (navy)

    private var hero: some View {
        let t = vm.totals
        return VStack(alignment: .leading, spacing: 16) {
            // Breadcrumb + action chips
            HStack(alignment: .center) {
                HStack(spacing: 6) {
                    Text("Nuru Pathway").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                    Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                    Text("Members").font(.nMicro).foregroundStyle(.white)
                }
                Spacer(minLength: 8)
            }
            HStack(spacing: 8) {
                HeroChip(label: "\(t.total) on pathway", icon: "person.2.fill", style: .tag)
                Spacer(minLength: 0)
                HeroChip(label: "Export", icon: "square.and.arrow.down", style: .ghost)
                HeroChip(label: "Add member", icon: "plus", style: .gold)
            }

            statStrip(t)

            if !vm.countryChips.isEmpty { countryChipRow }
        }
        .padding(.horizontal, Nuru.S.base).padding(.top, Nuru.S.lg).padding(.bottom, Nuru.S.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private func statStrip(_ t: (total: Int, thriving: Int, watch: Int, atRisk: Int)) -> some View {
        let cells: [(String, String, Color?, Color)] = [
            ("Total members", String(t.total), nil, .white),
            ("Thriving", String(t.thriving), Color(hex: 0xE8F6EC), Color(hex: 0x16A34A)),
            ("Watch", String(t.watch), Color(hex: 0xFFF6E0), Color(hex: 0xA87616)),
            ("At-risk", String(t.atRisk), Color(hex: 0xFDECEC), Color(hex: 0xDC2626)),
        ]
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 0), GridItem(.flexible(), spacing: 0)], spacing: 0) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, c in
                VStack(alignment: .leading, spacing: 6) {
                    Text(c.0.uppercased()).font(.nOverline).tracking(1.4).foregroundStyle(Nuru.onNavyDim)
                    if let bandBg = c.2 {
                        Text("● \(c.1)").font(.inter(13, .bold)).foregroundStyle(c.3)
                            .padding(.horizontal, 10).padding(.vertical, 4)
                            .background(bandBg).clipShape(Capsule())
                    } else {
                        Text(c.1).font(.fraunces(22, .medium)).foregroundStyle(.white)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18).padding(.vertical, 14)
            }
        }
        .background(.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
    }

    private var countryChipRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text("By country").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.onNavyDim)
                countryPill(label: "All", active: vm.countryFilter == "All") {
                    vm.countryFilter = "All"; Task { await vm.reload() }
                }
                ForEach(vm.countryChips) { c in
                    countryPill(
                        label: "\(c.country?.flag ?? "🏳️") \(c.country?.name ?? c.code) · \(c.count)",
                        active: vm.countryFilter == c.code
                    ) {
                        vm.countryFilter = (vm.countryFilter == c.code) ? "All" : c.code
                        Task { await vm.reload() }
                    }
                }
            }
        }
    }

    private func countryPill(label: String, active: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.inter(11.5, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 10).frame(height: 26)
                .background(active ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Color.white.opacity(0.06)))
                .overlay(Capsule().stroke(.white.opacity(0.15), lineWidth: 1))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: Filter bar

    private var filterBar: some View {
        VStack(spacing: 12) {
            // Search
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                TextField("Search by name, email or programme…", text: $vm.search)
                    .font(.inter(13)).foregroundStyle(Nuru.ink)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .onChange(of: vm.search) { _, _ in debouncedReload() }
                    .submitLabel(.search)
                    .onSubmit { Task { await vm.reload() } }
                if !vm.search.isEmpty {
                    Button { vm.search = ""; Task { await vm.reload() } } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(Nuru.ink300)
                    }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).frame(height: 40)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            // Filter menus (band / level / cell / gender / programme / country)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    bandMenu
                    levelMenu
                    cellMenu
                    genderMenu
                    programmeMenu
                    countryMenu
                }
            }
        }
        .padding(12)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func filterChip(_ title: String, active: Bool) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
            Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.muted)
        }
        .padding(.horizontal, 12).frame(height: 38)
        .background(active ? AnyShapeStyle(Nuru.gold.opacity(0.12)) : AnyShapeStyle(Nuru.inputBg))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(active ? Nuru.gold.opacity(0.4) : Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var bandMenu: some View {
        Menu {
            Button("All") { vm.band = nil; Task { await vm.reload() } }
            ForEach(MemberStatusKey.allCases, id: \.self) { b in
                Button(b.label) { vm.band = b; Task { await vm.reload() } }
            }
        } label: {
            filterChip("Band: \(vm.band?.label ?? "All")", active: vm.band != nil)
        }
    }

    private var levelMenu: some View {
        Menu {
            Button("All") { vm.level = nil; Task { await vm.reload() } }
            ForEach(1...6, id: \.self) { l in
                Button("Level \(l)") { vm.level = l; Task { await vm.reload() } }
            }
        } label: {
            filterChip("Level: \(vm.level.map { "L\($0)" } ?? "All")", active: vm.level != nil)
        }
    }

    private var cellMenu: some View {
        Menu {
            ForEach(vm.cellNames, id: \.self) { name in
                Button(name) { vm.cellFilter = name }   // client-side filter, no reload
            }
        } label: {
            filterChip("Cell: \(vm.cellFilter)", active: vm.cellFilter != "All")
        }
    }

    private var genderMenu: some View {
        Menu {
            Button("All") { vm.gender = nil; Task { await vm.reload() } }
            ForEach([("female", "Female"), ("male", "Male"), ("other", "Other")], id: \.0) { g in
                Button(g.1) { vm.gender = g.0; Task { await vm.reload() } }
            }
        } label: {
            filterChip("Gender: \(vm.gender.map { $0.capitalized } ?? "All")", active: vm.gender != nil)
        }
    }

    private var programmeMenu: some View {
        Menu {
            Button("All") { vm.programme = nil; Task { await vm.reload() } }
            ForEach(["new_believer", "foundations", "serving_track", "leadership_prep"], id: \.self) { p in
                Button(programmeLabels[p] ?? p) { vm.programme = p; Task { await vm.reload() } }
            }
        } label: {
            filterChip("Programme: \(vm.programme.flatMap { programmeLabels[$0] } ?? "All")", active: vm.programme != nil)
        }
    }

    private var countryMenu: some View {
        Menu {
            Button("All") { vm.countryFilter = "All"; Task { await vm.reload() } }
            ForEach(vm.countries) { c in
                Button("\(c.flag ?? "") \(c.name)") { vm.countryFilter = c.code; Task { await vm.reload() } }
            }
        } label: {
            let label = vm.countryFilter == "All" ? "All" : (vm.countryByCode[vm.countryFilter]?.name ?? vm.countryFilter)
            filterChip("Country: \(label)", active: vm.countryFilter != "All")
        }
    }

    // MARK: Roster

    private var roster: some View {
        let list = vm.filtered
        return VStack(spacing: 8) {
            if vm.loading && list.isEmpty {
                SkeletonList(rows: 6)
            } else if list.isEmpty {
                emptyState
            } else {
                ForEach(Array(list.enumerated()), id: \.element.id) { idx, m in
                    NavigationLink {
                        MemberDetailView(userId: m.userId, name: m.fullName)
                    } label: {
                        MemberCardRow(member: m, index: idx, country: m.countryCode.flatMap { vm.countryByCode[$0] })
                    }
                    .buttonStyle(.plain)
                    .onAppear { if m.id == list.last?.id { Task { await vm.loadMore() } } }
                }
                if vm.loadingMore {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 8)
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("No members match those filters.").font(.nBody).foregroundStyle(Nuru.muted)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }

    private var footer: some View {
        HStack {
            Text("Showing \(vm.filtered.count) of \(vm.rows.count) loaded").font(.nCaption).foregroundStyle(Nuru.muted)
            Spacer()
            HStack(spacing: 6) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 12)).foregroundStyle(Color(hex: 0x16A34A))
                Text("Live from the directory").font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
        .padding(.top, 6)
    }

    // Debounced search reload (web's 250ms timeout).
    private func debouncedReload() {
        searchTask?.cancel()
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            await vm.reload()
        }
    }
}

// MARK: - Member roster card row (mirrors the web row layout)

private struct MemberCardRow: View {
    let member: MemberListRow
    let index: Int
    let country: Country?

    private let avatarGradients: [LinearGradient] = [
        LinearGradient(colors: [Color(hex: 0x0B1F33), Color(hex: 0x1E4068)], startPoint: .topLeading, endPoint: .bottomTrailing),
        LinearGradient(colors: [Color(hex: 0xC89B3C), Color(hex: 0x8B6914)], startPoint: .topLeading, endPoint: .bottomTrailing),
        LinearGradient(colors: [Color(hex: 0x16A34A), Color(hex: 0x065F46)], startPoint: .topLeading, endPoint: .bottomTrailing),
        LinearGradient(colors: [Color(hex: 0x7C3AED), Color(hex: 0x4C1D95)], startPoint: .topLeading, endPoint: .bottomTrailing),
        LinearGradient(colors: [Color(hex: 0xDC2626), Color(hex: 0x7F1D1D)], startPoint: .topLeading, endPoint: .bottomTrailing),
        LinearGradient(colors: [Color(hex: 0x0EA5E9), Color(hex: 0x075985)], startPoint: .topLeading, endPoint: .bottomTrailing),
    ]

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                // Avatar + thriving dot
                ZStack(alignment: .bottomTrailing) {
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(avatarGradients[index % avatarGradients.count])
                        .frame(width: 44, height: 44)
                        .overlay(Text(initials).font(.inter(14, .bold)).foregroundStyle(.white))
                    if member.status == "thriving" {
                        Circle().fill(Color(hex: 0x16A34A))
                            .frame(width: 12, height: 12)
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .offset(x: 2, y: 2)
                    }
                }
                // Identity
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(member.fullName).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text("L\(member.currentLevel.map(String.init) ?? "—")")
                            .font(.inter(9.5, .bold)).foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(Nuru.gold.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 4))
                        if member.isMinor {
                            Text("MINOR").font(.inter(9, .bold)).foregroundStyle(Color(hex: 0xA87616))
                                .padding(.horizontal, 6).padding(.vertical, 2)
                                .background(Color(hex: 0xF59E0B, alpha: 0.18)).clipShape(RoundedRectangle(cornerRadius: 4))
                        }
                    }
                    HStack(spacing: 5) {
                        Image(systemName: "envelope").font(.system(size: 10)).foregroundStyle(Nuru.muted)
                        Text(member.email ?? member.phoneNumber).font(.inter(11.5)).foregroundStyle(Nuru.muted).lineLimit(1)
                    }
                    if country != nil || member.city != nil {
                        HStack(spacing: 4) {
                            if let f = country?.flag { Text(f).font(.system(size: 12)) }
                            Text([country?.name ?? member.countryCode, member.city].compactMap { $0 }.joined(separator: " · "))
                                .font(.inter(11)).foregroundStyle(Nuru.muted).lineLimit(1)
                        }
                    }
                }
                Spacer(minLength: 0)
                // Status pill + chevron
                VStack(alignment: .trailing, spacing: 4) {
                    statusPill
                    Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.ink300)
                }
            }

            // Secondary strip: cell · start point · programme progress · last active
            HStack(spacing: 12) {
                metaCol(title: member.cellName ?? "—", caption: "cell", captionIcon: "person.crop.circle.badge.checkmark", iconColor: Nuru.gold)
                metaCol(
                    title: "L\(member.startLevel ?? 1)·M\(member.startModuleSequence ?? 1)",
                    caption: "start point", captionIcon: "flag.fill", iconColor: Color(hex: 0x0EA5E9), titleLeading: true
                )
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 3) {
                    HStack {
                        Text(member.programme.flatMap { programmeLabels[$0] } ?? "Engagement")
                            .font(.inter(11, .semibold)).foregroundStyle(Nuru.muted).lineLimit(1)
                        Spacer(minLength: 8)
                        Text("\(member.progress)%").font(.inter(12, .bold)).foregroundStyle(Nuru.navy)
                    }
                    ProgressBar(pct: Double(member.progress), fill: member.statusKey.fg, height: 6)
                        .frame(width: 130)
                }
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Last active").font(.inter(11)).foregroundStyle(Nuru.muted)
                    Text(relTime(member.lastActivity)).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                }
            }
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow(0.5)
    }

    private var statusPill: some View {
        let sk = member.statusKey
        return Text(sk.label).font(.inter(11, .bold)).foregroundStyle(sk.fg)
            .padding(.horizontal, 12).padding(.vertical, 5)
            .background(sk.bg)
            .overlay(Capsule().stroke(sk.ring, lineWidth: 1))
            .clipShape(Capsule())
    }

    private func metaCol(title: String, caption: String, captionIcon: String, iconColor: Color, titleLeading: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if titleLeading {
                HStack(spacing: 4) {
                    Image(systemName: captionIcon).font(.system(size: 11)).foregroundStyle(iconColor)
                    Text(title).font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                }
                Text(caption).font(.inter(10.5)).foregroundStyle(Nuru.muted)
            } else {
                Text(title).font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                HStack(spacing: 4) {
                    Image(systemName: captionIcon).font(.system(size: 10)).foregroundStyle(iconColor)
                    Text(caption).font(.inter(11)).foregroundStyle(Nuru.muted)
                }
            }
        }
    }

    private var initials: String {
        let p = member.fullName.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }

    /// Relative day count (web relTime).
    private func relTime(_ iso: String?) -> String {
        guard let iso, let d = isoDate(iso) else { return "—" }
        let days = Int((Date().timeIntervalSince(d)) / 86400)
        if days <= 0 { return "Today" }
        if days == 1 { return "Yesterday" }
        return "\(days)d ago"
    }
    private func isoDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}
