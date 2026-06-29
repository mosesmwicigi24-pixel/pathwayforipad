// Curriculum Levels — a faithful native port of the web portal's CurriculumLevels.tsx:
// navy hero with a 4-up KPI strip, the "Learners by level" donut and
// "Completion by level" bars (Swift Charts), an enrolment-trend area chart, the
// per-level cards (modules / learners / certificates / completion / status), and
// an active-level deep-dive. Wired to PortalAPI.levels() plus a page-local decode
// of /admin/reports/levels for the enrolment trend (the trend the web reads).
import SwiftUI
import Charts

// MARK: - Page-local models (extra metrics the shared model doesn't carry)

private enum CL {
    /// /admin/reports/levels → { levels, trend }. We re-decode here to capture the
    /// `trend` array (rows keyed by month + per-level `L1…Ln` counts) that the
    /// shared `LevelsReport` drops. Per-level color/duration aren't tracked by the
    /// API, so colour is derived locally by level number — nothing invented.
    struct Report: Decodable {
        let levels: [LevelAnalyticsRow]
        let trend: [TrendPoint]
    }

    /// One month of the enrolment trend. Decodes `month` + a bag of `L1…Ln` ints.
    struct TrendPoint: Decodable {
        let month: String
        let counts: [Int: Int]   // levelNumber → enrolments that month

        private struct Key: CodingKey {
            let stringValue: String
            init?(stringValue: String) { self.stringValue = stringValue }
            var intValue: Int? { nil }
            init?(intValue: Int) { return nil }
        }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: Key.self)
            var month = ""
            var counts: [Int: Int] = [:]
            for k in c.allKeys {
                if k.stringValue == "month" {
                    month = (try? c.decode(String.self, forKey: k)) ?? ""
                } else if k.stringValue.first == "L", let n = Int(k.stringValue.dropFirst()) {
                    counts[n] = (try? c.decode(Int.self, forKey: k)) ?? 0
                }
            }
            self.month = month
            self.counts = counts
        }
    }

    static func fetch() async throws -> Report {
        try await APIClient.shared.get("/admin/reports/levels", as: Report.self)
    }

    /// Stable per-level accent — mirrors the make's level-coloured cards.
    static let palette: [Color] = [
        Color(hex: 0x16A34A), Color(hex: 0x0EA5E9), Color(hex: 0xC89B3C),
        Color(hex: 0x7C3AED), Color(hex: 0xEC4899), Color(hex: 0xF97316),
        Color(hex: 0x0B1F33), Color(hex: 0x059669),
    ]
    static func color(_ levelNumber: Int) -> Color {
        palette[((levelNumber - 1) % palette.count + palette.count) % palette.count]
    }
}

// MARK: - View

struct CurriculumLevelsView: View {
    @EnvironmentObject private var router: NavRouter
    @State private var activeId: Int?

    var body: some View {
        AsyncView(CL.fetch) { report in
            content(report)
        }
        .portalPage("Curriculum Levels")
    }

    @ViewBuilder
    private func content(_ report: CL.Report) -> some View {
        let levels = report.levels
        let active = levels.first { $0.levelNumber == activeId } ?? levels.first

        ScrollView {
            VStack(spacing: 18) {
                hero(levels)

                VStack(spacing: 18) {
                    // Row 1: distribution + completion — side-by-side on the wide
                    // iPad canvas, stacked when narrow. Same cards, denser use of width.
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 18) {
                            LearnersByLevel(levels: levels).frame(maxWidth: .infinity)
                            CompletionByLevel(levels: levels).frame(maxWidth: .infinity)
                        }
                        VStack(spacing: 18) {
                            LearnersByLevel(levels: levels)
                            CompletionByLevel(levels: levels)
                        }
                    }

                    // Row 2: enrolment trend
                    EnrolmentTrend(levels: levels, trend: report.trend)

                    // Row 3: section heading
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("The levels").font(.nTitle).foregroundStyle(Nuru.navy)
                            Text("Tap any level to preview its overview.")
                                .font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Row 4: level cards — denser grid (4-up on the wide canvas)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                        ForEach(levels) { lvl in
                            LevelCard(level: lvl, active: activeId == lvl.levelNumber,
                                      onOpen: { router.openLevel(lvl.levelNumber) })
                                .onTapGesture { activeId = lvl.levelNumber }
                        }
                    }

                    // Row 5: active-level deep-dive
                    if let active {
                        ActiveLevelDeepDive(level: active, trend: report.trend,
                                            onOpen: { router.openLevel(active.levelNumber) })
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
        .onAppear { if activeId == nil { activeId = levels.first?.levelNumber } }
    }

    // Hero — navy banner with breadcrumb, action chips, KPI strip.
    private func hero(_ levels: [LevelAnalyticsRow]) -> some View {
        let totalLearners = levels.reduce(0) { $0 + $1.learners }
        let totalModules = levels.reduce(0) { $0 + $1.modulesTotal }
        let avgCompletion = levels.isEmpty ? 0
            : Int((levels.reduce(0.0) { $0 + $1.completionPct } / Double(levels.count)).rounded())
        let totalCerts = levels.reduce(0) { $0 + $1.certificates }

        let stats = [
            HeroStat(label: "Active learners", value: "\(totalLearners)", hint: "enrolled across the pathway"),
            HeroStat(label: "Total modules", value: "\(totalModules)", hint: "across \(levels.count) levels"),
            HeroStat(label: "Avg completion", value: "\(avgCompletion)%", hint: "of published modules"),
            HeroStat(label: "Certificates", value: "\(totalCerts)", hint: "issued to date"),
        ]
        return PortalHero(breadcrumb: ["Curriculum", "Levels overview"],
                          title: "Levels overview",
                          subtitle: "Per-level analytics across the discipleship pathway.",
                          stats: stats) {
            HStack(spacing: 8) {
                HeroChip(label: "\(levels.count)-level pathway", icon: "sparkles", style: .tag)
                HeroChip(label: "Video library", icon: "play.rectangle", style: .ghost) { router.go(.videoLibrary) }
                HeroChip(label: "Open CMS", icon: "square.and.pencil", style: .gold) { router.go(.cms) }
            }
        }
    }
}

// MARK: - Learners by level (donut)

private struct LearnerSlice: Identifiable { let level: Int; let value: Int; let color: Color; var id: Int { level } }

private struct LearnersByLevel: View {
    let levels: [LevelAnalyticsRow]
    var body: some View {
        let slices = levels.map { LearnerSlice(level: $0.levelNumber, value: $0.learners, color: CL.color($0.levelNumber)) }
        let total = slices.reduce(0) { $0 + $1.value }
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 6) {
                    Image(systemName: "graduationcap.fill").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                    Text("Learners by level").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                }
                Text("Distribution across the pathway").font(.nCaption).foregroundStyle(Nuru.ink600)
                ZStack {
                    Chart(total == 0 ? [LearnerSlice(level: 0, value: 1, color: Nuru.border)] : slices) { s in
                        SectorMark(angle: .value("Learners", s.value), innerRadius: .ratio(0.62), angularInset: 1.5)
                            .foregroundStyle(s.color).cornerRadius(3)
                    }
                    .chartLegend(.hidden)
                    .frame(height: 190)
                    VStack(spacing: 2) {
                        Text("\(total)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                        Text("LEARNERS").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                    }
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                    ForEach(levels) { l in
                        HStack(spacing: 8) {
                            Circle().fill(CL.color(l.levelNumber)).frame(width: 8, height: 8)
                            Text("L\(l.levelNumber)").font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                            Spacer()
                            Text("\(l.learners)").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Completion by level (bars)

private struct CompletionBar: Identifiable { let level: Int; let pct: Double; let color: Color; var id: Int { level } }

private struct CompletionByLevel: View {
    let levels: [LevelAnalyticsRow]
    var body: some View {
        let bars = levels.map { CompletionBar(level: $0.levelNumber, pct: $0.completionPct, color: CL.color($0.levelNumber)) }
        let avg = levels.isEmpty ? 0 : Int((levels.reduce(0.0) { $0 + $1.completionPct } / Double(levels.count)).rounded())
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "chart.line.uptrend.xyaxis").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                        Text("Completion by level").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    Text("Avg \(avg)%").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                Text("Published modules completed by enrolled learners")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)
                if bars.isEmpty {
                    Text("No level data yet.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 200)
                } else {
                    Chart(bars) { b in
                        BarMark(x: .value("Level", "L\(b.level)"), y: .value("Completion", b.pct), width: .fixed(22))
                            .foregroundStyle(b.color)
                            .cornerRadius(6)
                    }
                    .chartYScale(domain: 0...100)
                    .chartYAxis { AxisMarks(values: [0, 25, 50, 75, 100]) { value in
                        AxisGridLine()
                        AxisValueLabel { if let v = value.as(Int.self) { Text("\(v)%") } }
                    } }
                    .frame(height: 220)
                }
            }
        }
    }
}

// MARK: - Enrolment trend (area)

private struct TrendBar: Identifiable { let id = UUID(); let month: String; let series: String; let value: Int; let color: Color }

private struct EnrolmentTrend: View {
    let levels: [LevelAnalyticsRow]
    let trend: [CL.TrendPoint]
    var body: some View {
        let points: [TrendBar] = trend.flatMap { p -> [TrendBar] in
            levels.map { l in
                TrendBar(month: p.month, series: "L\(l.levelNumber)",
                         value: p.counts[l.levelNumber] ?? 0, color: CL.color(l.levelNumber))
            }
        }
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "flame.fill").font(.system(size: 13)).foregroundStyle(Nuru.gold)
                        Text("Enrolment trend (6 months)").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    HStack(spacing: 10) {
                        ForEach(levels) { l in
                            HStack(spacing: 5) {
                                Circle().fill(CL.color(l.levelNumber)).frame(width: 8, height: 8)
                                Text("L\(l.levelNumber)").font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                        }
                    }
                }
                Text("New enrolments per level, by month started")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)
                if points.isEmpty {
                    Text("No enrolment trend recorded yet.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 230)
                } else {
                    Chart(points) { p in
                        AreaMark(x: .value("Month", p.month), y: .value("Enrolments", p.value))
                            .foregroundStyle(by: .value("Level", p.series))
                            .opacity(0.18)
                        LineMark(x: .value("Month", p.month), y: .value("Enrolments", p.value))
                            .foregroundStyle(by: .value("Level", p.series))
                            .lineStyle(StrokeStyle(lineWidth: 2))
                            .symbol(.circle)
                    }
                    .chartForegroundStyleScale(domain: levels.map { "L\($0.levelNumber)" },
                                               range: levels.map { CL.color($0.levelNumber) })
                    .chartLegend(.hidden)
                    .frame(height: 230)
                }
            }
        }
    }
}

// MARK: - Level card

private struct LevelCard: View {
    let level: LevelAnalyticsRow
    let active: Bool
    let onOpen: () -> Void
    private var color: Color { CL.color(level.levelNumber) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Coloured header bar
            HStack {
                HStack(spacing: 8) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(.white.opacity(0.2))
                        Text("\(level.levelNumber)").font(.fraunces(14, .semibold)).foregroundStyle(.white)
                    }.frame(width: 28, height: 28)
                    Text("LEVEL \(level.levelNumber)").font(.inter(11, .bold)).tracking(1.4).foregroundStyle(.white)
                }
                Spacer()
                Pill(text: level.status.capitalized,
                     color: .white, filled: false)
                    .opacity(0.95)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .background(Nuru.tintGradient(color))

            VStack(alignment: .leading, spacing: 10) {
                Text(level.title).font(.fraunces(17, .semibold)).foregroundStyle(Nuru.navy)
                    .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                Text(level.theme ?? "Discipleship pathway level.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(2).frame(minHeight: 28, alignment: .top)

                // Stat tiles
                HStack(spacing: 6) {
                    miniStat("Modules", "\(level.modulesTotal)", "book.fill")
                    miniStat("Learners", "\(level.learners)", "person.2.fill")
                    miniStat("Certs", "\(level.certificates)", "rosette")
                }

                // Completion
                VStack(alignment: .leading, spacing: 5) {
                    HStack {
                        Text("Completion").font(.nMicro).foregroundStyle(Nuru.ink600)
                        Spacer()
                        Text(String(format: "%.0f%%", level.completionPct)).font(.inter(12, .bold)).foregroundStyle(color)
                    }
                    ProgressBar(pct: level.completionPct, fill: color, height: 6)
                }

                Divider().overlay(Nuru.border)

                HStack {
                    HStack(spacing: 5) {
                        Image(systemName: "clock").font(.system(size: 10)).foregroundStyle(Nuru.ink600)
                        Text("\(level.modulesPublished) published").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                    Button(action: onOpen) {
                        HStack(spacing: 4) {
                            Text("Open").font(.inter(12, .bold)).foregroundStyle(color)
                            Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(color)
                        }
                    }.buttonStyle(.plain)
                }
            }
            .padding(14)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .stroke(active ? color : Nuru.border, lineWidth: active ? 2 : 1))
        .nuruShadow(active ? 1.3 : 1)
    }

    private func miniStat(_ label: String, _ value: String, _ icon: String) -> some View {
        VStack(spacing: 3) {
            Image(systemName: icon).font(.system(size: 11)).foregroundStyle(color)
            Text(value).font(.fraunces(16, .semibold)).foregroundStyle(Nuru.navy)
            Text(label).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(color.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

// MARK: - Active-level deep-dive

private struct ActiveLevelDeepDive: View {
    let level: LevelAnalyticsRow
    let trend: [CL.TrendPoint]
    let onOpen: () -> Void
    private var color: Color { CL.color(level.levelNumber) }

    var body: some View {
        let line: [TrendBar] = trend.map {
            TrendBar(month: $0.month, series: "L\(level.levelNumber)",
                     value: $0.counts[level.levelNumber] ?? 0, color: color)
        }
        Card(padding: 20) {
            VStack(alignment: .leading, spacing: 16) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("NOW VIEWING · LEVEL \(level.levelNumber)")
                            .font(.nOverline).tracking(1.4).foregroundStyle(color)
                        Text(level.title).font(.nTitle).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    HeroChip(label: "Open level", icon: "play.circle.fill", style: .gold, action: onOpen)
                }
                Text(level.theme ?? "Discipleship pathway level.")
                    .font(.nBody).foregroundStyle(Nuru.foreground).fixedSize(horizontal: false, vertical: true)

                LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 12)], spacing: 12) {
                    deepStat("Modules", "\(level.modulesTotal)", "book.fill")
                    deepStat("Learners", "\(level.learners)", "person.2.fill")
                    deepStat("Completion", String(format: "%.0f%%", level.completionPct), "chart.line.uptrend.xyaxis")
                    deepStat("Certificates", "\(level.certificates)", "rosette")
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("ENROLMENT MOMENTUM").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.ink600)
                    if line.allSatisfy({ $0.value == 0 }) {
                        Text("No enrolment momentum recorded.").font(.nCaption).foregroundStyle(Nuru.ink600).frame(height: 90)
                    } else {
                        Chart(line) { p in
                            LineMark(x: .value("Month", p.month), y: .value("Enrolments", p.value))
                                .foregroundStyle(color)
                                .lineStyle(StrokeStyle(lineWidth: 2.5))
                                .symbol(.circle)
                        }
                        .chartLegend(.hidden)
                        .frame(height: 90)
                    }
                }
            }
        }
    }

    private func deepStat(_ label: String, _ value: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(label.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                Spacer()
                Image(systemName: icon).font(.system(size: 12)).foregroundStyle(color)
            }
            Text(value).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
