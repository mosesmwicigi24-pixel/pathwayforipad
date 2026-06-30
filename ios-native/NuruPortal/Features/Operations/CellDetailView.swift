// Cell Detail — native port of the web CellDetail.tsx: a navy hero (cell monogram,
// member/at-risk counts, a 4-stat strip), an "Engagement bands" health-mix card with
// a stacked bar, KPI tiles, and the per-member engagement table.
//
// Data sourcing mirrors the web CellDetail exactly (parity fix D-01): instead of the
// legacy `/cohorts/{cellId}/members` cohort endpoint, the cell is reconstructed from
// the two canonical admin reads the web portal uses —
//   • GET /admin/reports/engagement → EngagementReport; find this cell by cellGroupId
//     for the header summary (name, member count, at-risk, discipler).
//   • GET /admin/members → the directory; the roster is the rows whose `cell_group_id`
//     matches this cell, filtered client-side.
// The per-member engagement metrics (e_score, band, last activity) ride on the member
// rows, and the band breakdown / KPIs are computed from that real roster.
import SwiftUI

// MARK: - Page-local models (canonical /admin/members roster row)

// The shared MemberRow (Models.swift) does not carry the cell id, so this slim
// decoder picks up exactly the fields CellDetail needs from /admin/members —
// including `cell_group_id`, the field MembersView uses to associate a member with
// a cell. Snake_case is converted by APIClient's decoder (convertFromSnakeCase).
private struct RosterMemberRow: Decodable, Identifiable {
    @DefaultEmpty var userId: String
    let fullName: String?
    let eScore: Double?
    let band: String?
    let cellGroupId: String?
    let lastActivity: String?
    var id: String { userId }

    // Days since last activity (ISO-8601), or nil when unknown — matches the
    // "Nd ago" affordance the table already renders.
    var lastActiveDaysAgo: Int? {
        guard let lastActivity, let d = ISO8601DateFormatter().date(from: lastActivity) else { return nil }
        return max(0, Int(Date().timeIntervalSince(d) / 86_400))
    }
}
private struct RosterPageDTO: Decodable {
    @MListDefaultCD var data: [RosterMemberRow]
}

// Resilient list default (an absent/malformed `data` decodes to []), local to this file.
@propertyWrapper private struct MListDefaultCD<E: Decodable>: Decodable {
    var wrappedValue: [E]
    init() { wrappedValue = [] }
    init(from decoder: Decoder) throws { wrappedValue = (try? [E](from: decoder)) ?? [] }
}
extension KeyedDecodingContainer {
    fileprivate func decode<E>(_ t: MListDefaultCD<E>.Type, forKey k: Key) throws -> MListDefaultCD<E> {
        try decodeIfPresent(t, forKey: k) ?? MListDefaultCD<E>()
    }
}

// Engagement bands, ordered worst→display like the web.
private enum Band: String, CaseIterable {
    case thriving, steady, watch, at_risk
    var label: String {
        switch self {
        case .thriving: return "Thriving"
        case .steady:   return "Steady"
        case .watch:    return "Watch"
        case .at_risk:  return "At-risk"
        }
    }
    var color: Color { Nuru.bandColor(rawValue) }
    var bg: Color {
        switch self {
        case .thriving: return Nuru.successBg
        case .steady:   return Nuru.tintBlue
        case .watch:    return Color(hex: 0xFFFBEB)
        case .at_risk:  return Color(hex: 0xFEF2F2)
        }
    }
    var fg: Color {
        switch self {
        case .thriving: return Color(hex: 0x15803D)
        case .steady:   return Color(hex: 0x0369A1)
        case .watch:    return Color(hex: 0xB45309)
        case .at_risk:  return Color(hex: 0xB91C1C)
        }
    }
}

@MainActor
private final class CellDetailViewModel: ObservableObject {
    @Published var roster: [RosterMemberRow] = []
    @Published var cell: EngagementCellRow?     // header summary from the engagement report
    @Published var cellFound = true             // false when the report omits this cell
    @Published var loading = true
    @Published var error: String?
    @Published var sortAsc = true

    // D-01 parity: source the cell exactly like the web CellDetail —
    // the engagement report for the header summary + the members directory,
    // filtered client-side to the rows whose cell_group_id is this cell.
    func load(cellId: String) async {
        loading = true; error = nil
        do {
            async let reportT = APIClient.shared.get("/admin/reports/engagement", as: EngagementReport.self)
            async let membersT = APIClient.shared.get("/admin/members", as: RosterPageDTO.self)
            let report = try await reportT
            let members = try await membersT
            cell = report.cells.first { $0.cellGroupId == cellId }
            cellFound = cell != nil
            roster = members.data.filter { $0.cellGroupId == cellId }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }

    private func score(_ m: RosterMemberRow) -> Double { m.eScore ?? 0 }

    var sorted: [RosterMemberRow] {
        roster.sorted { sortAsc ? score($0) < score($1) : score($0) > score($1) }
    }
    func count(_ band: Band) -> Int { roster.filter { ($0.band ?? "steady") == band.rawValue }.count }
    var atRisk: Int { count(.at_risk) }
    var watch: Int { count(.watch) }
    var avg: Int {
        guard !roster.isEmpty else { return 0 }
        return Int(((roster.reduce(0.0) { $0 + score($1) } / Double(roster.count)) * 100).rounded())
    }
}

struct CellDetailView: View {
    let cellGroupId: String
    let name: String
    @StateObject private var vm = CellDetailViewModel()
    private let kpiGrid = [GridItem(.adaptive(minimum: 168), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                hero
                if vm.loading && vm.roster.isEmpty {
                    SkeletonList(rows: 5).padding(.horizontal, 20)
                } else if let error = vm.error, vm.roster.isEmpty {
                    ErrorBanner(message: error) { Task { await vm.load(cellId: cellGroupId) } }
                        .padding(.horizontal, 20)
                } else if !vm.cellFound && vm.roster.isEmpty {
                    // The engagement report doesn't include this cell and no members
                    // map to it — show the not-found/empty state (parity with web).
                    notFound.padding(.horizontal, 20)
                } else {
                    VStack(spacing: 14) {
                        // Health mix + KPI tiles share one row on the wide canvas
                        // so neither leaves a band of empty space beside it.
                        ViewThatFits(in: .horizontal) {
                            HStack(alignment: .top, spacing: 14) {
                                bandsCard.frame(maxWidth: 460)
                                LazyVGrid(columns: kpiGrid, alignment: .leading, spacing: 12) { kpiTiles }
                                    .frame(maxWidth: .infinity)
                            }
                            VStack(spacing: 14) {
                                bandsCard
                                LazyVGrid(columns: kpiGrid, alignment: .leading, spacing: 12) { kpiTiles }
                            }
                        }
                        memberTable
                    }
                    .padding(.horizontal, 20)
                }
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
        .navigationTitle(name)
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.roster.isEmpty { await vm.load(cellId: cellGroupId) } }
        .refreshable { await vm.load(cellId: cellGroupId) }
    }

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Cell Engagement", name],
            title: name,
            subtitle: "\(vm.roster.count) members · \(vm.atRisk) at-risk",
            stats: [
                HeroStat(label: "Members", value: "\(vm.roster.count)", hint: "in this cell"),
                HeroStat(label: "Avg engagement", value: "\(vm.avg)%", hint: "this cell"),
                HeroStat(label: "At-risk", value: "\(vm.atRisk)", hint: "need pastoral call"),
                HeroStat(label: "On watch", value: "\(vm.watch)", hint: "send a nudge"),
            ]
        ) {
            // "Message cell" has no messaging endpoint — left as a styled affordance
            // (the web merely cross-navigates to the reflection queue). See NEEDS.
            HeroChip(label: "Message cell", icon: "paperplane.fill", style: .gold)
        }
    }

    // Not-found / empty state — the engagement report has no row for this cell and
    // no members map to it. Mirrors the web's empty fallback.
    private var notFound: some View {
        VStack(spacing: 8) {
            Image(systemName: "person.2.slash").font(.title).foregroundStyle(Nuru.ink300)
            Text("This cell has no members yet.").font(.nBody).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 48)
        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [5])).foregroundStyle(Nuru.border))
    }

    // Health mix — stacked band bar + per-band counts.
    private var bandsCard: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("HEALTH MIX").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.goldLo)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Text("Engagement bands").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                }
                GeometryReader { geo in
                    HStack(spacing: 0) {
                        ForEach(Band.allCases, id: \.self) { b in
                            let c = vm.count(b)
                            if vm.roster.count > 0 && c > 0 {
                                Rectangle().fill(b.color)
                                    .frame(width: geo.size.width * CGFloat(c) / CGFloat(vm.roster.count))
                            }
                        }
                    }
                }
                .frame(height: 12)
                .background(Nuru.track)
                .clipShape(Capsule())

                let cols = [GridItem(.flexible()), GridItem(.flexible())]
                LazyVGrid(columns: cols, spacing: 10) {
                    ForEach(Band.allCases, id: \.self) { b in
                        HStack {
                            HStack(spacing: 6) {
                                Circle().fill(b.color).frame(width: 8, height: 8)
                                Text(b.label).font(.inter(12, .regular)).foregroundStyle(Nuru.navy)
                                    .lineLimit(1).minimumScaleFactor(0.85)
                            }
                            Spacer()
                            Text("\(vm.count(b))").font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                }
            }
        }
    }

    @ViewBuilder private var kpiTiles: some View {
        KpiTile(label: "Members", value: "\(vm.roster.count)", icon: "person.2.fill", tint: Nuru.tint(1))
        KpiTile(label: "At-risk", value: "\(vm.atRisk)", icon: "exclamationmark.circle.fill", tint: Nuru.tint(4))
        KpiTile(label: "Watch list", value: "\(vm.watch)", icon: "clock.fill", tint: Nuru.tint(0))
        KpiTile(label: "Avg engagement", value: "\(vm.avg)%", icon: "text.bubble.fill", tint: Nuru.tint(2))
    }

    // Member engagement table (navy header + sortable rows).
    private var memberTable: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(name.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(.white.opacity(0.55))
                        Text("Member engagement").font(.fraunces(18, .medium)).foregroundStyle(.white)
                    }
                    Spacer()
                    Button { vm.sortAsc.toggle() } label: {
                        HStack(spacing: 6) {
                            Text(vm.sortAsc ? "Lowest first" : "Highest first").font(.inter(12, .bold))
                            Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                        }
                        .foregroundStyle(.white.opacity(0.85))
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.white.opacity(0.1))
                        .overlay(Capsule().stroke(.white.opacity(0.15), lineWidth: 1))
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 22).padding(.vertical, 16)
                .background(Nuru.navy)

                // Aligned column-header row (overline titles) so the table reads
                // as a real table, not a stack of cards.
                HStack(spacing: 12) {
                    Text("MEMBER").font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
                    Spacer(minLength: 8)
                    Text("ENGAGEMENT").font(.nOverline).tracking(1.1).foregroundStyle(Nuru.ink600)
                        .frame(width: 168, alignment: .trailing)
                    Spacer().frame(width: 18)
                }
                .padding(.horizontal, 22).padding(.vertical, 9)
                .background(Nuru.surface)
                Divider().overlay(Nuru.border)

                if vm.sorted.isEmpty {
                    Text("No members loaded for this cell.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity).padding(.vertical, 32)
                } else {
                    ForEach(Array(vm.sorted.enumerated()), id: \.element.id) { idx, m in
                        if idx > 0 { Divider().background(Nuru.border) }
                        // Web: row navigate(`/member-profile?id=…`) + "View" action.
                        NavigationLink {
                            MemberDetailView(userId: m.userId, name: m.fullName ?? "—")
                        } label: {
                            memberRow(m)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
    }

    private func memberRow(_ m: RosterMemberRow) -> some View {
        let score = Int(((m.eScore ?? 0) * 100).rounded())
        let band = Band(rawValue: m.band ?? "steady") ?? .steady
        let nm = m.fullName ?? "—"
        let days = m.lastActiveDaysAgo
        return HStack(spacing: 12) {
            Monogram(name: nm, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text(nm).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.ink)
                    .lineLimit(1).minimumScaleFactor(0.85)
                HStack(spacing: 8) {
                    Pill(text: band.label, color: band.fg)
                    if let days {
                        Text("\(days)d ago")
                            .font(.inter(11.5, days >= 7 ? .semibold : .regular))
                            .foregroundStyle(days >= 7 ? Nuru.danger : Nuru.muted)
                    } else {
                        Text("—").font(.nCaption).foregroundStyle(Nuru.muted)
                    }
                }
            }
            Spacer(minLength: 8)
            // Fixed-width trailing column so scores + bars line up across rows
            // and under the ENGAGEMENT header.
            VStack(alignment: .trailing, spacing: 4) {
                Text("\(score)%").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink)
                ProgressBar(pct: Double(score), fill: band.color, height: 6)
            }
            .frame(width: 168)
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(Nuru.ink300)
        }
        .padding(.horizontal, 22).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
