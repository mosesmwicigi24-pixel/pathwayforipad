// Cell Engagement — cells grouped by engagement band, from /admin/reports/engagement.
import SwiftUI

struct CellEngagementView: View {
    var body: some View {
        AsyncView(PortalAPI.engagement) { report in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if !report.bands.isEmpty {
                        let cols = [GridItem(.adaptive(minimum: 150), spacing: 12)]
                        LazyVGrid(columns: cols, spacing: 12) {
                            ForEach(report.bands.sorted(by: { $0.key < $1.key }), id: \.key) { band, count in
                                Card {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("\(count)").font(.nuruDisplay(26)).foregroundStyle(Nuru.bandColor(band))
                                        Text(band.capitalized).font(.nCaption).foregroundStyle(Nuru.muted)
                                    }
                                }
                            }
                        }
                    }
                    SectionTitle(text: "Cells")
                    ForEach(report.cells.sorted { $0.avgEngagement < $1.avgEngagement }) { cell in
                        Card {
                            HStack(spacing: 14) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(cell.name).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                                    Text("\(cell.members) members · \(cell.disciplerName ?? "Unassigned")")
                                        .font(.nCaption).foregroundStyle(Nuru.muted)
                                    if let level = cell.levelLabel { Pill(text: level, color: Nuru.navy) }
                                }
                                Spacer()
                                if cell.atRisk > 0 { Pill(text: "\(cell.atRisk) at risk", color: Nuru.danger) }
                                Text(String(format: "%.0f", cell.avgEngagement))
                                    .font(.fraunces(22, .semibold)).foregroundStyle(Nuru.gold)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Cell Engagement")
    }
}
