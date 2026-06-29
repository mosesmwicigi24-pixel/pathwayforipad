// Dashboard — KPI tiles + per-cell engagement, from /admin/reports/overview and
// /admin/reports/engagement (the portal's defining screen, §1.3).
import SwiftUI

@MainActor
final class DashboardViewModel: ObservableObject {
    @Published var kpis: OverviewKpis?
    @Published var report: EngagementReport?
    @Published var loading = false
    @Published var error: String?

    func load() async {
        loading = true; error = nil
        do {
            async let k = PortalAPI.overview()
            async let r = PortalAPI.engagement()
            kpis = try await k
            report = try await r
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }
}

struct DashboardView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = DashboardViewModel()
    private let columns = [GridItem(.adaptive(minimum: 180), spacing: 14)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                HeroHeader(title: greeting, subtitle: "Here's how the pathway is moving today.") {
                    BrandMark(size: 46)
                }

                if let k = vm.kpis {
                    LazyVGrid(columns: columns, spacing: 14) {
                        StatCard(label: "Total Members", value: "\(k.totalMembers)", icon: "person.2.fill", color: Nuru.navy)
                        StatCard(label: "Active Learners", value: "\(k.activeLearners)", icon: "book.fill", color: Nuru.teal)
                        StatCard(label: "Avg Engagement", value: String(format: "%.0f", k.avgEngagement), icon: "chart.bar.fill", color: Nuru.gold)
                        StatCard(label: "Members at Risk", value: "\(k.membersAtRisk)", icon: "exclamationmark.triangle.fill", color: Nuru.danger)
                        StatCard(label: "Pending Reviews", value: "\(k.pendingReviews)", icon: "tray.full.fill", color: Nuru.warning, caption: k.reviewsOverdue > 0 ? "\(k.reviewsOverdue) overdue" : nil)
                        StatCard(label: "Cohorts Running", value: "\(k.cohortsRunning)", icon: "rectangle.3.group.fill", color: Nuru.info)
                        StatCard(label: "Certificates (mo.)", value: "\(k.certificatesThisMonth)", icon: "rosette", color: Nuru.gold)
                        StatCard(label: "Checked in (wk.)", value: "\(k.checkedInThisWeek)", icon: "checkmark.seal.fill", color: Nuru.teal)
                    }
                }

                if let report = vm.report, !report.cells.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        SectionTitle(text: "Cells by engagement")
                        ForEach(Array(report.cells.sorted { $0.avgEngagement < $1.avgEngagement }.enumerated()), id: \.element.id) { i, cell in
                            CellRow(cell: cell, rank: i)
                        }
                    }
                }

                if vm.loading && vm.kpis == nil { LoadingState().frame(height: 240) }
                if let error = vm.error { ErrorBanner(message: error) { Task { await vm.load() } } }
            }
            .padding(20)
        }
        .background(Nuru.background)
        .navigationTitle("Dashboard")
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.kpis == nil { await vm.load() } }
        .refreshable { await vm.load() }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"
        let first = auth.profile?.fullName.split(separator: " ").first.map(String.init)
        return first.map { "\(part), \($0)" } ?? part
    }
}

private struct CellRow: View {
    let cell: EngagementCellRow
    let rank: Int
    var body: some View {
        Card {
            HStack(spacing: 14) {
                ZStack {
                    Circle().fill(Nuru.bandColor(scoreBand).opacity(0.15)).frame(width: 46, height: 46)
                    Text(String(format: "%.0f", cell.avgEngagement))
                        .font(.headline).foregroundStyle(Nuru.bandColor(scoreBand))
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(cell.name).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                    Text("\(cell.members) members · \(cell.disciplerName ?? "Unassigned")")
                        .font(.caption).foregroundStyle(Nuru.muted)
                }
                Spacer()
                if cell.atRisk > 0 { Pill(text: "\(cell.atRisk) at risk", color: Nuru.danger) }
            }
        }
    }
    private var scoreBand: String { cell.avgEngagement >= 70 ? "high" : cell.avgEngagement >= 40 ? "medium" : "low" }
}
