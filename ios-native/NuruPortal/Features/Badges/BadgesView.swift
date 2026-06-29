// Badges — line-by-line port of the web make (packages/admin-web/src/components/
// pages/Badges.tsx), tailored for iPad. Navy hero with the "Admin › Badges
// Catalog" breadcrumb + count tag + New badge chip, a 4-up KPI stat strip,
// category/status/sort filters, the medallion card grid (an SVG-style gold seal
// rendered natively), an active/inactive status dot + deactivate↔reactivate
// toggle, a detail drawer (sheet on iPad), the pastoral note + "How awarding
// works" sidebar, and a create sheet (criteria builder matching the server's
// registered rules). Badges are for encouragement, not competition — no
// leaderboards. Reuses PortalAPI.badges()/admin badges; mutations + create use
// page-local request bodies.
import SwiftUI
import UIKit

// MARK: - Category metadata (mirrors catMeta)

private enum BadgeCat: String, CaseIterable, Identifiable {
    case journey, consistency, community, service
    var id: String { rawValue }
    var label: String {
        switch self {
        case .journey: "Journey"; case .consistency: "Consistency"
        case .community: "Community"; case .service: "Service"
        }
    }
    var color: Color {
        switch self {
        case .journey: Color(hex: 0xA87616); case .consistency: Color(hex: 0xC2410C)
        case .community: Color(hex: 0x4F46E5); case .service: Color(hex: 0xBE185D)
        }
    }
    var bg: Color {
        switch self {
        case .journey: Color(hex: 0xFFF6E0); case .consistency: Color(hex: 0xFDF0E6)
        case .community: Color(hex: 0xEEF0FF); case .service: Color(hex: 0xFCE7F3)
        }
    }
    var icon: String {
        switch self {
        case .journey: "book.closed"; case .consistency: "flame"
        case .community: "person.2"; case .service: "hand.raised"
        }
    }
    static func from(_ s: String) -> BadgeCat { BadgeCat(rawValue: s) ?? .journey }
}

// MARK: - View

struct BadgesView: View {
    @State private var badges: [BadgeRow] = []
    @State private var query = ""
    @State private var category: BadgeCat?         // nil = All
    @State private var statusFilter = StatusFilter.all
    @State private var sort = SortMode.mostEarned
    @State private var detail: BadgeRow?
    @State private var createOpen = false
    @State private var retiring: BadgeRow?     // pending deactivate confirmation
    @State private var notice: String?
    @State private var error: String?

    private enum StatusFilter: String, CaseIterable { case all = "All", active = "Active", inactive = "Inactive" }
    private enum SortMode: String, CaseIterable { case mostEarned = "Most earned", leastEarned = "Least earned", name = "Name" }

    private let grid = [GridItem(.adaptive(minimum: 184), spacing: 14)]

    private func isActive(_ b: BadgeRow) -> Bool { b.isActive != false }

    private var filtered: [BadgeRow] {
        var l = badges.filter { b in
            (category == nil || b.category == category!.rawValue) &&
            (statusFilter == .all || (statusFilter == .active ? isActive(b) : !isActive(b))) &&
            (query.isEmpty || "\(b.name) \(b.description)".lowercased().contains(query.lowercased()))
        }
        switch sort {
        case .mostEarned: l.sort { $0.earnedCount > $1.earnedCount }
        case .leastEarned: l.sort { $0.earnedCount < $1.earnedCount }
        case .name: l.sort { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        }
        return l
    }
    private var totalAwards: Int { badges.reduce(0) { $0 + $1.earnedCount } }
    private var activeCount: Int { badges.filter(isActive).count }
    private var inactiveCount: Int { badges.count - activeCount }
    private var categoryCount: Int { Set(badges.map(\.category)).count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                hero

                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                if let notice { Text(notice).font(.nCaption).foregroundStyle(Nuru.success) }

                statStrip
                filterBar

                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 24) {
                        gridSection.frame(maxWidth: .infinity)
                        sidebar.frame(width: 320)
                    }
                    VStack(spacing: 24) {
                        gridSection
                        sidebar
                    }
                }
            }
            .padding(24)
        }
        .background(Nuru.paper)
        .navigationTitle("Badges")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .sheet(item: $detail) { b in detailDrawer(b) }
        .sheet(isPresented: $createOpen) {
            CreateBadgeSheet { name in
                createOpen = false; notice = "Created \(name)."; await load()
            } onError: { error = $0 }
        }
        .alert("Deactivate badge?", isPresented: Binding(get: { retiring != nil }, set: { if !$0 { retiring = nil } })) {
            Button("Cancel", role: .cancel) { retiring = nil }
            Button("Deactivate", role: .destructive) {
                if let b = retiring { Task { await retire(b) } }
                retiring = nil
            }
        } message: {
            Text("Deactivate \"\(retiring?.name ?? "")\"? It stops being awarded (existing earners keep it).")
        }
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Admin", "Badges Catalog"],
            title: "Badges Catalog",
            subtitle: "Encouragement, not competition — milestones members earn from verified signals."
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "\(badges.count) badges", icon: "rosette", style: .tag)
                HeroChip(label: "New badge", icon: "plus", style: .gold) { createOpen = true }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.hero, style: .continuous))
        .nuruShadow()
    }

    // MARK: KPI strip

    private var statStrip: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 200), spacing: 12)], spacing: 12) {
            statTile("Active badges", "\(activeCount)", "rosette", Color(hex: 0x16A34A), Color(hex: 0xE8F6EC))
            statTile("Inactive badges", "\(inactiveCount)", "clock", Color(hex: 0x6B7280), Color(hex: 0xF3F4F6))
            statTile("Total badge awards", totalAwards.formatted(), "star", Color(hex: 0xA87616), Color(hex: 0xFFF6E0))
            statTile("Categories", "\(categoryCount)", "sparkles", Color(hex: 0x4F46E5), Color(hex: 0xEEF0FF))
        }
    }

    // Compact stat strip cell (~84pt tall) — never a half-screen card.
    private func statTile(_ label: String, _ value: String, _ icon: String, _ color: Color, _ bg: Color) -> some View {
        Card(padding: 14) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(bg)
                    Image(systemName: icon).font(.system(size: 17)).foregroundStyle(color)
                }.frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(value).font(.fraunces(21, .medium)).foregroundStyle(Nuru.ink).lineLimit(1)
                    Text(label.uppercased()).font(.nOverline).tracking(0.4).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: Filter bar

    private var filterBar: some View {
        Card(padding: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { filterControls }
                VStack(spacing: 12) { filterControls }
            }
        }
    }

    @ViewBuilder private var filterControls: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Nuru.muted)
            TextField("Search badges by name or description", text: $query).font(.nCaption)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))

        HStack(spacing: 8) {
            categoryMenu
            statusMenu
            sortMenu
        }
    }

    private var categoryMenu: some View {
        Menu {
            Button("All categories") { category = nil }
            ForEach(BadgeCat.allCases) { c in Button(c.label) { category = c } }
        } label: {
            selectLabel("Category", category?.label ?? "All categories")
        }
    }
    private var statusMenu: some View {
        Menu {
            ForEach(StatusFilter.allCases, id: \.self) { s in Button(s.rawValue) { statusFilter = s } }
        } label: {
            selectLabel("Status", statusFilter.rawValue)
        }
    }
    private var sortMenu: some View {
        Menu {
            ForEach(SortMode.allCases, id: \.self) { s in Button(s.rawValue) { sort = s } }
        } label: {
            selectLabel("Sort", sort.rawValue, leadingIcon: "line.3.horizontal.decrease")
        }
    }

    private func selectLabel(_ label: String, _ value: String, leadingIcon: String? = nil) -> some View {
        HStack(spacing: 8) {
            if let leadingIcon { Image(systemName: leadingIcon).font(.system(size: 11)).foregroundStyle(Nuru.muted) }
            Text(label.uppercased()).font(.nOverline).tracking(0.5).foregroundStyle(Nuru.muted)
            Text(value).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
            Image(systemName: "chevron.down").font(.system(size: 10)).foregroundStyle(Nuru.muted)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Grid

    private var gridSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            if filtered.isEmpty && error == nil {
                Text("No badges match.").font(.nCaption).foregroundStyle(Nuru.muted)
            } else {
                LazyVGrid(columns: grid, spacing: 16) {
                    ForEach(filtered) { b in badgeCard(b) }
                }
            }
        }
    }

    private func badgeCard(_ b: BadgeRow) -> some View {
        let cat = BadgeCat.from(b.category)
        let active = isActive(b)
        return Button { detail = b } label: {
            VStack(spacing: 0) {
                HStack {
                    Pill(text: cat.label, color: cat.color)
                    Spacer()
                    HStack(spacing: 4) {
                        Circle().fill(active ? Color(hex: 0x16A34A) : Color(hex: 0x9CA3AF)).frame(width: 7, height: 7)
                        Text(active ? "Active" : "Inactive")
                            .font(.inter(9, .semibold)).tracking(0.3)
                            .foregroundStyle(active ? Color(hex: 0x16A34A) : Nuru.muted)
                    }
                }
                Medallion(icon: cat.icon, size: 60, color: cat.color)
                    .saturation(active ? 1 : 0.5)
                    .padding(.top, 6)
                Text(b.name).font(.fraunces(15, .medium)).foregroundStyle(Nuru.ink)
                    .multilineTextAlignment(.center).lineLimit(2).padding(.top, 10)
                Text(b.description.count > 64 ? "\(b.description.prefix(64))…" : b.description)
                    .font(.inter(11, .regular)).foregroundStyle(Nuru.muted)
                    .multilineTextAlignment(.center).lineLimit(2)
                    .frame(minHeight: 30).padding(.top, 3)

                // Awarding criteria line (real code) — the stable rule key.
                Text(b.code).font(.inter(9.5, .medium)).monospaced().tracking(0.2)
                    .foregroundStyle(Nuru.muted).lineLimit(1).minimumScaleFactor(0.8)
                    .padding(.horizontal, 7).padding(.vertical, 2)
                    .background(Nuru.surface).clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(.top, 8)

                // Awarded count — pluralized so the tile reads as a sentence, not a bare number.
                HStack(spacing: 4) {
                    Image(systemName: "person.2.fill").font(.system(size: 9)).foregroundStyle(Nuru.gold)
                    Text(b.earnedCount == 1 ? "Earned by 1 member" : "Earned by \(b.earnedCount.formatted()) members")
                        .font(.inter(10, .medium)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.8)
                }
                .padding(.horizontal, 9).padding(.vertical, 3)
                .background(Nuru.surface).clipShape(Capsule())
                .padding(.top, 6)

                Divider().overlay(Nuru.border).padding(.top, 12)
                HStack(spacing: 6) {
                    Image(systemName: "eye").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                    Button {
                        if active { retiring = b } else { Task { await reactivate(b) } }
                    } label: {
                        Image(systemName: "power").font(.system(size: 13))
                            .foregroundStyle(active ? Nuru.danger : Nuru.success)
                    }
                    .buttonStyle(.plain)
                }
                .padding(.top, 8)
            }
            .padding(14)
            .frame(maxWidth: .infinity)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            .opacity(active ? 1 : 0.72)
            .nuruShadow()
        }
        .buttonStyle(.plain)
    }

    // MARK: Sidebar

    private var sidebar: some View {
        VStack(spacing: 20) {
            // Pastoral note
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 8) {
                    Image(systemName: "heart.fill").font(.system(size: 14)).foregroundStyle(Color(hex: 0xA87616))
                    Text("PASTORAL NOTE").font(.nOverline).tracking(0.6).foregroundStyle(Color(hex: 0x7A5410))
                }
                Text("Badges are for encouragement, not competition.")
                    .font(.fraunces(20, .medium)).foregroundStyle(Color(hex: 0x0B1F33))
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 8)
                Text("They recognise faithfulness, growth and milestones. The system never creates public leaderboards or ranks members against each other.")
                    .font(.nCaption).foregroundStyle(Color(hex: 0x7A5410))
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 10)
                Text("\"Let us not become weary in doing good.\" — Galatians 6:9")
                    .font(.inter(12, .regular)).italic().foregroundStyle(Color(hex: 0x7A5410))
                    .fixedSize(horizontal: false, vertical: true).padding(.top, 10)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [Color(hex: 0xFFFBEB), Color(hex: 0xFDF5DA)], startPoint: .top, endPoint: .bottom))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))

            // How awarding works
            Card {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.shield.fill").font(.system(size: 14)).foregroundStyle(Nuru.gold)
                        Text("How awarding works").font(.inter(13, .bold)).foregroundStyle(Nuru.ink)
                    }
                    .padding(.bottom, 4)
                    ForEach(Array(awardingRules.enumerated()), id: \.offset) { i, r in
                        Divider().overlay(Nuru.border)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(r.0).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                            Text(r.1).font(.nCaption).foregroundStyle(Nuru.muted).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 10)
                    }
                }
            }
        }
    }

    private let awardingRules: [(String, String)] = [
        ("Verified signals only", "Badges trigger from server-scored quizzes, verified check-ins and approved reflections."),
        ("Registered rules", "Criteria use the server's registered rule schema (modules, level, streak, attendance) — no arbitrary expressions."),
        ("Retirable", "A badge can be retired so it stops being awarded; existing earners keep it."),
    ]

    // MARK: Detail drawer

    private func detailDrawer(_ b: BadgeRow) -> some View {
        let cat = BadgeCat.from(b.category)
        let active = isActive(b)
        return VStack(spacing: 0) {
            // Navy header
            HStack(alignment: .top, spacing: 16) {
                Medallion(icon: cat.icon, size: 64, color: cat.color)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Pill(text: cat.label, color: cat.color)
                        Pill(text: active ? "● Active" : "● Inactive", color: active ? Nuru.success : Nuru.muted)
                    }
                    Text(b.name).font(.fraunces(24, .medium)).foregroundStyle(.white)
                    Text("\(b.earnedCount) earners · code \(b.code)").font(.nCaption).foregroundStyle(Nuru.onNavyDim)
                }
                Spacer()
                Button { detail = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 14)).foregroundStyle(.white)
                        .padding(8).background(.white.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 8))
                }.buttonStyle(.plain)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.navy)

            VStack(alignment: .leading, spacing: 0) {
                Text("DESCRIPTION").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted).padding(.bottom, 6)
                Text(b.description).font(.nCaption).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                Spacer()
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack {
                Spacer()
                Button {
                    if active { detail = nil; retiring = b } else { Task { await reactivate(b) } }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "power").font(.system(size: 12))
                        Text(active ? "Deactivate badge" : "Reactivate badge").font(.inter(12, .semibold))
                    }
                    .foregroundStyle(active ? Nuru.danger : Nuru.success)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background((active ? Nuru.danger : Nuru.success).opacity(0.1))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            .padding(24)
            .background(Nuru.surface)
        }
        .presentationDetents([.medium, .large])
    }

    // MARK: Data + mutations

    private func load() async {
        do { badges = try await APIClient.shared.get("/admin/badges", as: BadgesPage.self).data }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load badges." }
    }
    private func retire(_ b: BadgeRow) async {
        do {
            _ = try await APIClient.shared.delete("/admin/badges/\(b.code)", as: Ack.self)
            detail = nil; notice = "Deactivated \(b.name)."; await load()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not deactivate badge." }
    }
    private func reactivate(_ b: BadgeRow) async {
        do {
            _ = try await APIClient.shared.post("/admin/badges/\(b.code)/reactivate", body: Empty(), as: Ack.self)
            detail = nil; notice = "Reactivated \(b.name)."; await load()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not reactivate badge." }
    }
    private struct Empty: Encodable {}
    private struct Ack: Decodable { init(from decoder: Decoder) throws {} }
}

// MARK: - Medallion (the gold seal — native render of the web's SVG)

private struct Medallion: View {
    let icon: String
    var size: CGFloat = 56
    var color: Color = Color(hex: 0xC89B3C)

    var body: some View {
        let light = shade(color, 0.30)
        let dark = shade(color, -0.20)
        ZStack {
            // 14-point star seal
            StarSeal(points: 14, innerRatio: 43.0 / 49.0)
                .fill(LinearGradient(colors: [light, dark], startPoint: .top, endPoint: .bottom))
            // Inner disc + highlight
            Circle().fill(color).frame(width: size * 0.74, height: size * 0.74)
            Circle().stroke(.white.opacity(0.55), lineWidth: 1.5).frame(width: size * 0.74, height: size * 0.74)
            Ellipse().fill(.white.opacity(0.18))
                .frame(width: size * 0.52, height: size * 0.26)
                .offset(y: -size * 0.16)
            Image(systemName: icon).font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .shadow(color: Color(hex: 0x0B1F33).opacity(0.18), radius: 4, x: 0, y: 3)
    }

    /// Lighten (amt>0) / darken (amt<0) a color by mixing toward white/black.
    private func shade(_ c: Color, _ amt: Double) -> Color {
        let ui = UIColor(c); var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        ui.getRed(&r, green: &g, blue: &b, alpha: &a)
        let t = amt >= 0 ? 1.0 : 0.0
        let f = abs(amt)
        return Color(red: r + (t - r) * f, green: g + (t - g) * f, blue: b + (t - b) * f)
    }
}

/// N-point star/seal polygon (mirrors the web's sealPath).
private struct StarSeal: Shape {
    let points: Int
    let innerRatio: CGFloat
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let cx = rect.midX, cy = rect.midY
        let rO = min(rect.width, rect.height) / 2
        let rI = rO * innerRatio
        let step = CGFloat.pi / CGFloat(points)
        for i in 0..<(points * 2) {
            let r = i % 2 == 0 ? rO : rI
            let a = CGFloat(i) * step - .pi / 2
            let pt = CGPoint(x: cx + r * cos(a), y: cy + r * sin(a))
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        p.closeSubpath()
        return p
    }
}

// MARK: - Create badge sheet (criteria builder matching the registered rules)

private struct CreateBadgeSheet: View {
    let onDone: (String) async -> Void
    let onError: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var codeOverride = ""
    @State private var description = ""
    @State private var category = BadgeCat.journey
    @State private var kind = RuleKind.moduleCount
    @State private var threshold = "5"
    @State private var busy = false

    private enum RuleKind: String, CaseIterable {
        case moduleCount = "module_count", levelReached = "level_reached"
        case streakDays = "streak_days", attendanceCount = "attendance_count"
        var label: String {
            switch self {
            case .moduleCount: "Modules completed"; case .levelReached: "Level reached"
            case .streakDays: "Habit streak (days)"; case .attendanceCount: "Events attended"
            }
        }
        var thresholdLabel: String {
            switch self {
            case .levelReached: "Reach level"; case .streakDays: "Streak days"; default: "Count"
            }
        }
    }

    private var autoCode: String {
        if !codeOverride.isEmpty { return codeOverride }
        return name.trimmingCharacters(in: .whitespaces).lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(Nuru.gold)
                        Text("BADGE EDITOR").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.gold)
                    }
                    Text("Create new badge").font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)

                    HStack(spacing: 16) {
                        field("Badge name", required: true) {
                            TextField("e.g. Faithful Learner", text: $name).textFieldStyle(.plain).font(.nBody)
                        }
                        field("Code", required: true) {
                            TextField("faithful_learner", text: Binding(get: { autoCode }, set: { codeOverride = $0 }))
                                .textFieldStyle(.plain).font(.nBody).monospaced().autocorrectionDisabled()
                        }
                    }
                    field("Category", required: true) {
                        Menu {
                            ForEach(BadgeCat.allCases) { c in Button(c.label) { category = c } }
                        } label: {
                            HStack { Text(category.label).font(.nBody).foregroundStyle(Nuru.ink); Spacer()
                                Image(systemName: "chevron.down").font(.system(size: 11)).foregroundStyle(Nuru.muted) }
                        }
                    }
                    field("Description", required: true) {
                        TextField("What this badge recognises…", text: $description, axis: .vertical)
                            .lineLimit(2...4).textFieldStyle(.plain).font(.nBody)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        labelRow("Award when (registered rule)", required: true)
                        HStack(spacing: 12) {
                            Menu {
                                ForEach(RuleKind.allCases, id: \.self) { k in Button(k.label) { kind = k } }
                            } label: {
                                HStack { Text(kind.label).font(.nBody).foregroundStyle(Nuru.ink).lineLimit(1); Spacer()
                                    Image(systemName: "chevron.down").font(.system(size: 11)).foregroundStyle(Nuru.muted) }
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(Nuru.inputBg)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(kind.thresholdLabel).font(.system(size: 10)).foregroundStyle(Nuru.muted)
                                TextField("", text: $threshold).keyboardType(.numberPad)
                                    .padding(.horizontal, 12).padding(.vertical, 10)
                                    .background(Nuru.inputBg)
                                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }
                        }
                    }
                    // Live preview
                    HStack(spacing: 12) {
                        Medallion(icon: category.icon, size: 48, color: category.color)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name.isEmpty ? "Badge name" : name).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                            Text("\(category.label) · auto-awarded").font(.inter(11.5, .regular)).foregroundStyle(Nuru.muted)
                        }
                        Spacer()
                    }
                    .padding(12).background(Nuru.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                }
                .padding(20)
            }
            .background(Nuru.paper)
            .navigationTitle("New badge").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: {
                        HStack(spacing: 6) { Image(systemName: "rosette"); Text("Create") }
                    }.disabled(busy)
                }
            }
        }
    }

    private func submit() async {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty, !autoCode.isEmpty,
              !description.trimmingCharacters(in: .whitespaces).isEmpty else {
            onError("Name, code and description are required."); return
        }
        busy = true; defer { busy = false }
        struct Body: Encodable {
            let code: String; let name: String; let description: String
            let category: String; let criteria: Criteria
        }
        struct Criteria: Encodable {
            let kind: String
            let count: Int?; let level: Int?; let days: Int?
        }
        let n = max(1, Int(threshold) ?? 1)
        let crit: Criteria
        switch kind {
        case .moduleCount, .attendanceCount: crit = Criteria(kind: kind.rawValue, count: n, level: nil, days: nil)
        case .levelReached: crit = Criteria(kind: kind.rawValue, count: nil, level: n, days: nil)
        case .streakDays: crit = Criteria(kind: kind.rawValue, count: nil, level: nil, days: n)
        }
        do {
            struct Ack: Decodable { init(from decoder: Decoder) throws {} }
            _ = try await APIClient.shared.post("/admin/badges", body: Body(
                code: autoCode, name: name.trimmingCharacters(in: .whitespaces),
                description: description.trimmingCharacters(in: .whitespaces),
                category: category.rawValue, criteria: crit), as: Ack.self)
            await onDone(name.trimmingCharacters(in: .whitespaces))
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Could not create badge.")
        }
    }

    @ViewBuilder private func field<C: View>(_ label: String, required: Bool = false, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            labelRow(label, required: required)
            content()
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func labelRow(_ label: String, required: Bool) -> some View {
        HStack(spacing: 3) {
            Text(label.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
            if required { Text("*").font(.nMicro).foregroundStyle(Nuru.danger) }
        }
    }
}
