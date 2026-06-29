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

    /// Stable per-level accent — on-brand, mutually distinct, NO off-brand bright blue.
    /// L1 = bright luminous green (Nuru.lumGreen), L2 = gold (replaces the old sky-blue),
    /// then teal · violet · pink · amber · deep navy, cycling for any extra levels.
    static let palette: [Color] = [
        Nuru.lumGreen,           // L1 — bright LED/lime green
        Nuru.gold,               // L2 — gold (was off-brand blue 0x0EA5E9)
        Color(hex: 0x0E8C8C),    // L3 — brand teal (distinct hue, not bright blue)
        Color(hex: 0x7C3AED),    // L4 — violet
        Color(hex: 0xEC4899),    // L5 — pink
        Nuru.lumAmber,           // L6 — amber/orange
        Nuru.navy,               // L7 — deep navy
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

                    // Row 3: active-level deep-dive — sits after the enrolment trend
                    // and before the levels grid (per v3 reorder).
                    if let active {
                        ActiveLevelDeepDive(level: active, trend: report.trend,
                                            onOpen: { router.openLevel(active.levelNumber) })
                    }

                    // Row 4: section heading
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("The levels").font(.nTitle).foregroundStyle(Nuru.navy)
                            Text("Tap any level to preview its overview.")
                                .font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    // Row 5: level cards — denser grid (4-up on the wide canvas)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 230), spacing: 14)], spacing: 14) {
                        ForEach(levels) { lvl in
                            LevelCard(level: lvl, active: activeId == lvl.levelNumber,
                                      onOpen: { router.openLevel(lvl.levelNumber) })
                                .onTapGesture { activeId = lvl.levelNumber }
                        }
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
                    .chartXAxis {
                        AxisMarks { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisTick().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let s = value.as(String.self) {
                                    Text(s).font(.inter(10, .medium)).foregroundStyle(Nuru.ink600)
                                }
                            }
                        }
                    }
                    .chartYAxis {
                        AxisMarks(values: [0, 25, 50, 75, 100]) { value in
                            AxisGridLine().foregroundStyle(Nuru.border)
                            AxisTick().foregroundStyle(Nuru.border)
                            AxisValueLabel {
                                if let v = value.as(Int.self) {
                                    Text("\(v)%").font(.inter(10, .medium)).foregroundStyle(Nuru.ink600)
                                }
                            }
                        }
                    }
                    .frame(height: 220)
                }
            }
        }
    }
}

// MARK: - Enrolment trend (per-month breakdown rows)

/// One month's roll-up for the breakdown: total new enrolments that month, plus the
/// per-level split (level number → count) so the bar can be segmented by level colour.
private struct MonthRoll: Identifiable {
    let month: String
    let total: Int
    let perLevel: [(level: Int, value: Int)]
    var id: String { month }
}

private struct EnrolmentTrend: View {
    let levels: [LevelAnalyticsRow]
    let trend: [CL.TrendPoint]

    private var rolls: [MonthRoll] {
        // Last ~6 months, oldest → newest (the API already returns them in order).
        trend.suffix(6).map { p in
            let split = levels.map { (level: $0.levelNumber, value: p.counts[$0.levelNumber] ?? 0) }
            return MonthRoll(month: p.month, total: split.reduce(0) { $0 + $1.value }, perLevel: split)
        }
    }

    var body: some View {
        let months = rolls
        let peak = max(months.map { $0.total }.max() ?? 0, 1)
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
                Text("New enrolments by month started — bar segments coloured by level")
                    .font(.nCaption).foregroundStyle(Nuru.ink600)

                if months.isEmpty {
                    Text("No enrolment trend recorded yet.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    VStack(spacing: 9) {
                        ForEach(months) { m in
                            EnrolmentMonthRow(roll: m, peak: peak)
                        }
                    }
                }
            }
        }
    }
}

/// A single month: label · count · a proportional, level-segmented horizontal bar.
/// Months with 0 enrolments show a faint empty track so the cadence stays readable.
private struct EnrolmentMonthRow: View {
    let roll: MonthRoll
    let peak: Int

    var body: some View {
        HStack(spacing: 12) {
            Text(monthLabel(roll.month))
                .font(.inter(11.5, .semibold)).foregroundStyle(Nuru.navy)
                .frame(width: 58, alignment: .leading)
                .lineLimit(1).minimumScaleFactor(0.8)

            GeometryReader { geo in
                let w = geo.size.width
                ZStack(alignment: .leading) {
                    // Faint empty track (also the bar for 0-count months).
                    Capsule().fill(Nuru.ink600.opacity(0.08))
                        .frame(height: 16)
                    if roll.total > 0 {
                        // Filled width proportional to the busiest month; segmented by level.
                        let filled = w * CGFloat(roll.total) / CGFloat(peak)
                        HStack(spacing: 0) {
                            ForEach(roll.perLevel.filter { $0.value > 0 }, id: \.level) { seg in
                                Rectangle()
                                    .fill(CL.color(seg.level))
                                    .frame(width: max(filled * CGFloat(seg.value) / CGFloat(roll.total), 2))
                            }
                        }
                        .frame(height: 16)
                        .clipShape(Capsule())
                    }
                }
                .frame(height: 16)
                .frame(maxHeight: .infinity, alignment: .center)
            }
            .frame(height: 16)

            Text("\(roll.total)")
                .font(.inter(12, .bold))
                .foregroundStyle(roll.total > 0 ? Nuru.navy : Nuru.ink600.opacity(0.6))
                .frame(width: 26, alignment: .trailing)
                .monospacedDigit()
        }
    }

    /// "2026-01" → "Jan ’26"; falls back to the raw string if it doesn't parse.
    private func monthLabel(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return raw }
        let names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        let yr = parts[0].suffix(2)
        return "\(names[m - 1]) ’\(yr)"
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
        // Last ~6 months of this level's new enrolments, for the momentum breakdown.
        let months: [(month: String, value: Int)] = trend.suffix(6).map {
            (month: $0.month, value: $0.counts[level.levelNumber] ?? 0)
        }
        let peak = max(months.map { $0.value }.max() ?? 0, 1)
        return Card(padding: 20) {
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
                    if months.allSatisfy({ $0.value == 0 }) {
                        Text("No enrolment momentum recorded.").font(.nCaption).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                    } else {
                        // Compact per-month breakdown: month label · proportional bar · count.
                        VStack(spacing: 7) {
                            ForEach(months, id: \.month) { m in
                                HStack(spacing: 10) {
                                    Text(momentumLabel(m.month))
                                        .font(.inter(11, .semibold)).foregroundStyle(Nuru.navy)
                                        .frame(width: 52, alignment: .leading)
                                        .lineLimit(1).minimumScaleFactor(0.8)
                                    GeometryReader { geo in
                                        ZStack(alignment: .leading) {
                                            Capsule().fill(Nuru.ink600.opacity(0.08)).frame(height: 12)
                                            if m.value > 0 {
                                                Capsule().fill(color)
                                                    .frame(width: max(geo.size.width * CGFloat(m.value) / CGFloat(peak), 3),
                                                           height: 12)
                                            }
                                        }
                                        .frame(maxHeight: .infinity, alignment: .center)
                                    }
                                    .frame(height: 12)
                                    Text("\(m.value)")
                                        .font(.inter(11, .bold))
                                        .foregroundStyle(m.value > 0 ? Nuru.navy : Nuru.ink600.opacity(0.6))
                                        .frame(width: 22, alignment: .trailing)
                                        .monospacedDigit()
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /// "2026-01" → "Jan ’26"; falls back to the raw string if it doesn't parse.
    private func momentumLabel(_ raw: String) -> String {
        let parts = raw.split(separator: "-")
        guard parts.count >= 2, let m = Int(parts[1]), (1...12).contains(m) else { return raw }
        let names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
        return "\(names[m - 1]) ’\(parts[0].suffix(2))"
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
