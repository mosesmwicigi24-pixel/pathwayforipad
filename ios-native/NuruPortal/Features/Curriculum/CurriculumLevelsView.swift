// Curriculum Levels — per-level analytics, from /admin/reports/levels.
import SwiftUI

struct CurriculumLevelsView: View {
    var body: some View {
        AsyncView(PortalAPI.levels) { levels in
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(levels) { lvl in
                        Card {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(spacing: 12) {
                                    ZStack {
                                        Circle().fill(Nuru.gold.opacity(0.15)).frame(width: 40, height: 40)
                                        Text("\(lvl.levelNumber)").font(.headline).foregroundStyle(Nuru.gold)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(lvl.title).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                        if let theme = lvl.theme { Text(theme).font(.caption).foregroundStyle(Nuru.muted) }
                                    }
                                    Spacer()
                                    Pill(text: lvl.status.capitalized,
                                         color: lvl.status == "published" ? Nuru.success : Nuru.muted)
                                }
                                ProgressView(value: lvl.completionPct / 100)
                                    .tint(Nuru.gold)
                                HStack(spacing: 18) {
                                    Stat("Learners", "\(lvl.learners)")
                                    Stat("Modules", "\(lvl.modulesPublished)/\(lvl.modulesTotal)")
                                    Stat("Certificates", "\(lvl.certificates)")
                                    Stat("Complete", String(format: "%.0f%%", lvl.completionPct))
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Curriculum Levels")
    }

    private func Stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(.subheadline.weight(.bold)).foregroundStyle(Nuru.navy)
            Text(label).font(.caption2).foregroundStyle(Nuru.muted)
        }
    }
}
