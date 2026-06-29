// Dashboard — KPI cards + per-cell engagement, from /admin/reports/overview and
// /admin/reports/engagement (the web portal's defining screen, §1.3).
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
    @StateObject private var vm = DashboardViewModel()

    private let columns = [GridItem(.adaptive(minimum: 200), spacing: 16)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                if let k = vm.kpis {
                    LazyVGrid(columns: columns, spacing: 16) {
                        KpiCard(label: "Total Members", value: "\(k.totalMembers)", icon: "person.2.fill", tint: Nuru.navy)
                        KpiCard(label: "Active Learners", value: "\(k.activeLearners)", icon: "book.fill", tint: Nuru.teal)
                        KpiCard(label: "Avg Engagement", value: String(format: "%.0f", k.avgEngagement), icon: "chart.bar.fill", tint: Nuru.gold)
                        KpiCard(label: "Members at Risk", value: "\(k.membersAtRisk)", icon: "exclamationmark.triangle.fill", tint: Nuru.danger)
                        KpiCard(label: "Pending Reviews", value: "\(k.pendingReviews)", icon: "tray.full.fill", tint: Nuru.warning)
                        KpiCard(label: "Cohorts Running", value: "\(k.cohortsRunning)", icon: "rectangle.3.group.fill", tint: Nuru.navy)
                        KpiCard(label: "Certificates (mo.)", value: "\(k.certificatesThisMonth)", icon: "rosette", tint: Nuru.gold)
                        KpiCard(label: "Checked in (wk.)", value: "\(k.checkedInThisWeek)", icon: "checkmark.seal.fill", tint: Nuru.teal)
                    }
                }

                if let cells = vm.report?.cells, !cells.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Cells by engagement").font(.title3.bold()).foregroundStyle(Nuru.navy)
                        ForEach(cells.sorted { $0.avgEngagement < $1.avgEngagement }) { cell in
                            CellRow(cell: cell)
                        }
                    }
                }

                if vm.loading && vm.kpis == nil {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.top, 60)
                }
                if let error = vm.error {
                    ErrorBanner(message: error) { Task { await vm.load() } }
                }
            }
            .padding(20)
        }
        .background(Nuru.background)
        .navigationTitle("Dashboard")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { if vm.kpis == nil { await vm.load() } }
        .refreshable { await vm.load() }
    }
}

private struct KpiCard: View {
    let label: String; let value: String; let icon: String; let tint: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Image(systemName: icon)
                .font(.title3).foregroundStyle(tint)
                .frame(width: 40, height: 40)
                .background(tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            Text(value).font(.nuruDisplay(30)).foregroundStyle(Nuru.navy)
            Text(label).font(.footnote).foregroundStyle(Nuru.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Nuru.border, lineWidth: 1))
    }
}

private struct CellRow: View {
    let cell: EngagementCellRow
    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 3) {
                Text(cell.name).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                Text("\(cell.members) members · \(cell.disciplerName ?? "—")")
                    .font(.caption).foregroundStyle(Nuru.muted)
            }
            Spacer()
            if cell.atRisk > 0 {
                Text("\(cell.atRisk) at risk")
                    .font(.caption2.weight(.bold)).foregroundStyle(Nuru.danger)
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Nuru.danger.opacity(0.1))
                    .clipShape(Capsule())
            }
            Text(String(format: "%.0f", cell.avgEngagement))
                .font(.headline).foregroundStyle(Nuru.gold)
        }
        .padding(14)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Nuru.border, lineWidth: 1))
    }
}
