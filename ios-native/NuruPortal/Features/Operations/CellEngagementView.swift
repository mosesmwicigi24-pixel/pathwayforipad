// Cell Engagement — native port of the web CellEngagement.tsx: a navy hero with a
// 4-stat strip and action chips, the "Cell roster" grid of cell cards (each a
// NavigationLink into CellDetailView), an engagement leaderboard, and an at-risk
// watch list. Wired to PortalAPI.engagement() → EngagementReport.cells.
import SwiftUI

// Tone palette mirrors the web (TONES) — deterministic per cell id so a cell keeps
// the same accent colour across the roster, leaderboard and watch list.
private let cellTones: [Color] = [
    Color(hex: 0x16A34A), Color(hex: 0x0B84E8), Color(hex: 0x7C3AED),
    Color(hex: 0xC89B3C), Color(hex: 0xDC2626), Color(hex: 0x0D9488),
]
private func toneOf(_ id: String) -> Color {
    var h = 0
    for ch in id.unicodeScalars { h = (h &* 31 &+ Int(ch.value)) % cellTones.count }
    return cellTones[((h % cellTones.count) + cellTones.count) % cellTones.count]
}
private func cellInitials(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(
        of: #"^(pastor|rev|dr|mr|mrs|ms)\.?\s+"#, with: "",
        options: [.regularExpression, .caseInsensitive])
    let parts = cleaned.split(separator: " ").prefix(2).compactMap { $0.first }
    return parts.isEmpty ? "C" : String(parts).uppercased()
}
private func engPct(_ v: Double) -> Int { Int((v).rounded()) }

struct CellEngagementView: View {
    private let grid = [GridItem(.adaptive(minimum: 280), spacing: 16)]

    var body: some View {
        AsyncView(PortalAPI.engagement) { report in
            content(report)
        }
        .portalPage("Cell Engagement")
    }

    private func content(_ report: EngagementReport) -> some View {
        let cells = report.cells
        let totalMembers = cells.reduce(0) { $0 + $1.members }
        let totalAtRisk = cells.reduce(0) { $0 + $1.atRisk }
        let overallAvg = totalMembers > 0
            ? Int((cells.reduce(0.0) { $0 + $1.avgEngagement * Double($1.members) } / Double(totalMembers)).rounded())
            : 0
        let ranked = cells.sorted { $0.avgEngagement > $1.avgEngagement }
        let byRisk = cells.sorted { $0.atRisk > $1.atRisk }

        return ScrollView {
            VStack(spacing: 18) {
                PortalHero(
                    breadcrumb: ["Nuru Pathway", "Operations", "Cell Engagement"],
                    eyebrow: "Cells & disciplers",
                    title: "Cell Engagement",
                    subtitle: "A high-level read on how every cell is doing. Open a cell to see its members, progress and activity in detail.",
                    stats: [
                        HeroStat(label: "Active cells", value: "\(cells.count)", hint: "with members"),
                        HeroStat(label: "Disciples", value: "\(totalMembers)", hint: "across all cells"),
                        HeroStat(label: "At-risk", value: "\(totalAtRisk)", hint: "need pastoral call"),
                        HeroStat(label: "Avg engagement", value: "\(overallAvg)%", hint: "all cells"),
                    ]
                ) {
                    HStack(spacing: 8) {
                        HeroChip(label: "Pastoral overview", icon: "sparkles", style: .tag)
                        HeroChip(label: "Action queue", icon: "arrow.up.right", style: .ghost)
                        HeroChip(label: "New Cell", icon: "plus", style: .gold)
                    }
                }

                VStack(alignment: .leading, spacing: 16) {
                    SectionHeader(overline: "Cell roster", title: "Cells & their disciplers")

                    if cells.isEmpty {
                        Text("No cells with engagement data yet.")
                            .font(.nCaption).foregroundStyle(Nuru.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        LazyVGrid(columns: grid, spacing: 16) {
                            ForEach(cells) { cell in
                                NavigationLink {
                                    CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                                } label: {
                                    CellCard(cell: cell)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    if !cells.isEmpty {
                        leaderboard(ranked)
                        atRiskList(byRisk)
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
    }

    // Cell engagement leaderboard — ranked by average engagement.
    private func leaderboard(_ ranked: [EngagementCellRow]) -> some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: "chart.line.uptrend.xyaxis", color: Nuru.success, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("PERFORMANCE").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.goldLo)
                        Text("Cell engagement leaderboard").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
                VStack(spacing: 16) {
                    ForEach(Array(ranked.enumerated()), id: \.element.id) { idx, cell in
                        let avg = engPct(cell.avgEngagement)
                        NavigationLink {
                            CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    HStack(spacing: 8) {
                                        ZStack {
                                            Circle().fill(Nuru.navy)
                                            Text("\(idx + 1)").font(.inter(11, .bold)).foregroundStyle(.white)
                                        }.frame(width: 24, height: 24)
                                        Text(cell.name).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                                    }
                                    Spacer()
                                    Text("\(avg)%").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                                }
                                ProgressBar(pct: Double(avg), fill: toneOf(cell.cellGroupId), height: 10)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Ranked by average engagement. Tap a cell to drill in.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }

    // At-risk by cell — prioritise pastoral calls where the count is highest.
    private func atRiskList(_ byRisk: [EngagementCellRow]) -> some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: "exclamationmark.circle", color: Nuru.danger, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NEEDS ATTENTION").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.goldLo)
                        Text("At-risk by cell").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
                VStack(spacing: 12) {
                    ForEach(byRisk) { cell in
                        let tone = toneOf(cell.cellGroupId)
                        NavigationLink {
                            CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(tone.opacity(0.12))
                                    Text(cellInitials(cell.name)).font(.inter(11, .bold)).foregroundStyle(tone)
                                }.frame(width: 36, height: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cell.name).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                    Text("\(cell.members) members").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                if cell.atRisk > 0 {
                                    Pill(text: "\(cell.atRisk) at-risk", color: Nuru.danger)
                                } else {
                                    Pill(text: "Healthy", color: Nuru.success)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Prioritise pastoral calls where the at-risk count is highest.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }
}

// MARK: - Cell roster card

private struct CellCard: View {
    let cell: EngagementCellRow
    var body: some View {
        let tone = toneOf(cell.cellGroupId)
        let avg = engPct(cell.avgEngagement)
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(tone.opacity(0.12))
                        Text(cellInitials(cell.name)).font(.inter(15, .bold)).foregroundStyle(tone)
                    }.frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cell.name).font(.inter(16, .bold)).foregroundStyle(Nuru.navy).lineLimit(2)
                        Text("\(cell.members) members").font(.inter(11.5, .semibold)).foregroundStyle(Nuru.muted)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 3) {
                        Text("View").font(.inter(11, .bold)).foregroundStyle(Nuru.navy)
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.navy)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                    .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                }

                // "Feature on homepage" pill (matches the web's static state).
                HStack(spacing: 6) {
                    Image(systemName: "star").font(.system(size: 10))
                    Text("Feature on homepage").font(.inter(11, .bold))
                }
                .foregroundStyle(Nuru.muted)
                .padding(.horizontal, 10).padding(.vertical, 5)
                .background(Color.black.opacity(0.03))
                .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                .clipShape(Capsule())

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("AVG ENGAGEMENT").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                        Text("\(avg)%").font(.fraunces(32, .semibold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 4) {
                            Image(systemName: "person.2.fill").font(.system(size: 11)).foregroundStyle(tone)
                            Text("\(cell.members) members").font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                        }
                        if cell.atRisk > 0 {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.circle.fill").font(.system(size: 10))
                                Text("\(cell.atRisk) at-risk").font(.inter(11, .bold))
                            }
                            .foregroundStyle(Nuru.danger)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Nuru.danger.opacity(0.08))
                            .clipShape(Capsule())
                        } else {
                            Text("All on track").font(.inter(11, .semibold)).foregroundStyle(Nuru.success)
                        }
                    }
                }

                ProgressBar(pct: Double(avg), fill: tone, height: 8)
            }
        }
    }
}
