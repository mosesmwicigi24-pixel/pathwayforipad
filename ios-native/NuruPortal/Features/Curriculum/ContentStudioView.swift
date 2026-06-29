// Content Studio — the growth library members read in the mobile app, ported
// line-by-line from the web admin portal's GrowthContent.tsx (the "Final Pathway
// Portal" make: navy hero with eyebrow + stats + accent chips, a tabbed section
// switcher with per-section accent + live counts, and accent-bar cards for each
// section). Tailored for the iPad canvas with adaptive multi-column grids.
//
// Sections ported (per assignment): Devotionals, Memory Verses, Reading Plans,
// Resources, Daily Verses. This is a read/browse port — the web's create/edit
// modal is authoring and is intentionally out of scope here (see NEEDS in the
// hand-off note). Data is the existing PortalAPI.{devotionals,verses,plans,
// resources} plus a page-local fetch for daily verses (no PortalAPI method).
import SwiftUI

struct ContentStudioView: View {

    // ── Section model (mirrors web `TABS`) ──────────────────────────────────
    enum Tab: String, CaseIterable, Identifiable {
        case devotionals, verses, dailyverses, plans, resources
        var id: String { rawValue }

        var label: String {
            switch self {
            case .devotionals: return "Devotionals"
            case .verses:      return "Memory Verses"
            case .dailyverses: return "Daily Verses"
            case .plans:       return "Reading Plans"
            case .resources:   return "Resources"
            }
        }
        var singular: String {
            switch self {
            case .devotionals: return "devotional"
            case .verses:      return "memory verse"
            case .dailyverses: return "daily verse"
            case .plans:       return "reading plan"
            case .resources:   return "resource"
            }
        }
        var icon: String {
            switch self {
            case .devotionals: return "book"
            case .verses:      return "quote.bubble"
            case .dailyverses: return "calendar"
            case .plans:       return "calendar.badge.clock"
            case .resources:   return "books.vertical"
            }
        }
        // web `accent` hex per tab
        var accent: Color {
            switch self {
            case .devotionals: return Color(hex: 0x0B84E8)
            case .verses:      return Color(hex: 0x7C3AED)
            case .dailyverses: return Color(hex: 0x0EA5A0)
            case .plans:       return Color(hex: 0x16A34A)
            case .resources:   return Color(hex: 0xC89B3C)
            }
        }
    }

    @State private var tab: Tab = .devotionals

    // Counts for the tab badges — loaded once, alongside each section's data.
    @State private var counts: [Tab: Int] = [:]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                switcher
                Divider().background(Nuru.border)

                // ── Body ── one AsyncView per active section ──
                Group {
                    switch tab {
                    case .devotionals:
                        AsyncView(PortalAPI.devotionals) { rows in
                            section(rows, count: .devotionals) { DevotionalCard(d: $0) }
                        }
                    case .verses:
                        AsyncView(PortalAPI.verses) { rows in
                            section(rows, count: .verses) { VerseCard(v: $0) }
                        }
                    case .dailyverses:
                        AsyncView(ContentStudioView.fetchDailyVerses) { rows in
                            section(rows, count: .dailyverses) { DailyVerseCard(d: $0) }
                        }
                    case .plans:
                        AsyncView(PortalAPI.plans) { rows in
                            section(rows, count: .plans) { PlanCard(p: $0) }
                        }
                    case .resources:
                        AsyncView(PortalAPI.resources) { rows in
                            section(rows, count: .resources) { ResourceCard(r: $0) }
                        }
                    }
                }
            }
        }
        .background(Nuru.paper)
        .portalPage("Content Studio")
    }

    // ── Hero (web: navy banner, breadcrumb, eyebrow, title, subtitle) ──
    private var hero: some View {
        PortalHero(
            breadcrumb: ["Curriculum", "Content Studio"],
            eyebrow: "Discipleship content",
            title: "Content Studio",
            subtitle: "Author the devotionals, verses, plans, resources and daily verses that members read in the mobile app.",
            stats: heroStats
        ) {
            HeroChip(label: tab.label, icon: tab.icon, style: .tag)
        }
    }

    private var heroStats: [HeroStat] {
        [
            HeroStat(label: "Devotionals", value: count(.devotionals), hint: "daily readings"),
            HeroStat(label: "Memory verses", value: count(.verses), hint: "to memorise"),
            HeroStat(label: "Reading plans", value: count(.plans), hint: "guided journeys"),
            HeroStat(label: "Resources", value: count(.resources), hint: "library items"),
        ]
    }
    private func count(_ t: Tab) -> String { counts[t].map(String.init) ?? "—" }

    // ── Section switcher (web: tabbed bar with icon + label + count badge) ──
    private var switcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Tab.allCases) { t in
                    let on = t == tab
                    Button { tab = t } label: {
                        HStack(spacing: 8) {
                            Image(systemName: t.icon).font(.system(size: 13, weight: .semibold))
                            Text(t.label).font(.inter(13.5, on ? .bold : .semibold))
                            Text(counts[t].map(String.init) ?? "·")
                                .font(.inter(10.5, .bold))
                                .foregroundStyle(on ? .white : Nuru.ink600)
                                .padding(.horizontal, 7).padding(.vertical, 1.5)
                                .background(on ? AnyShapeStyle(Nuru.gold) : AnyShapeStyle(Nuru.mutedBg))
                                .clipShape(Capsule())
                        }
                        .foregroundStyle(on ? Nuru.navy : Nuru.ink600)
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(on ? Nuru.gold : .clear).frame(height: 2)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
        .background(Nuru.paper)
    }

    // ── Generic section: adaptive grid + empty state + count capture ──
    private let cols = [GridItem(.adaptive(minimum: 360), spacing: 14)]

    private func section<T: Identifiable, C: View>(
        _ rows: [T], count tab: Tab, @ViewBuilder _ card: @escaping (T) -> C
    ) -> some View {
        Group {
            if rows.isEmpty {
                EmptyStateView(tab: self.tab)
                    .padding(20)
            } else {
                LazyVGrid(columns: cols, alignment: .leading, spacing: 14) {
                    ForEach(rows) { card($0) }
                }
                .padding(20)
            }
        }
        .onAppear { counts[tab] = rows.count }
    }

    // ── Daily verses — no PortalAPI method; page-local fetch (api/client.ts
    // GrowthAdminApi.dailyVerses → { data: [...] }). ──
    struct DailyVerseRowLocal: Codable, Identifiable {
        @DefaultZero var dayIndex: Int
        @DefaultEmpty var dayDate: String      // YYYY-MM-DD
        let theme: String?
        @DefaultEmpty var reference: String
        @DefaultEmpty var version: String
        @DefaultEmpty var verseText: String
        var id: Int { dayIndex }
    }
    static func fetchDailyVerses() async throws -> [DailyVerseRowLocal] {
        try await APIClient.shared
            .get("/admin/growth/daily-verses", as: DataList<DailyVerseRowLocal>.self).data
    }
}

// MARK: - Card shell (web RowShell: 4px accent bar + white card)

private struct RowShell<Content: View>: View {
    let accent: Color
    @ViewBuilder var content: Content
    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(accent).frame(width: 4)
            content
                .padding(.horizontal, 16).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .nuruShadow()
    }
}

// A square index/icon badge with a tinted fill (web's leading 40–56px tile).
private struct LeadBadge<Content: View>: View {
    var size: CGFloat = 46
    let bg: Color
    @ViewBuilder var content: Content
    var body: some View {
        ZStack { RoundedRectangle(cornerRadius: 12, style: .continuous).fill(bg); content }
            .frame(width: size, height: size)
    }
}

// A status pill: Active/Published (success) vs Inactive/Draft (muted).
private struct StatusPill: View {
    let on: Bool
    var onLabel = "Active"
    var offLabel = "Inactive"
    var body: some View {
        Pill(text: on ? onLabel : offLabel, color: on ? Nuru.success : Nuru.ink600)
    }
}

// MARK: - Section cards

private struct DevotionalCard: View {
    let d: DevotionalRow
    var body: some View {
        RowShell(accent: Color(hex: 0x0B84E8)) {
            HStack(alignment: .top, spacing: 14) {
                LeadBadge(bg: Color(hex: 0x0B84E8).opacity(0.10)) {
                    VStack(spacing: 0) {
                        Text("DAY").font(.inter(8.5, .bold)).tracking(0.5).opacity(0.7)
                        Text("\(d.dayNumber)").font(.fraunces(18, .medium))
                    }
                    .foregroundStyle(Color(hex: 0x0B84E8))
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(d.title.isEmpty ? "Untitled devotional" : d.title)
                            .font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                        StatusPill(on: d.isPublished, onLabel: "Published", offLabel: "Draft")
                    }
                    HStack(spacing: 8) {
                        if let s = d.series, !s.isEmpty { Text(s).font(.nCaption).foregroundStyle(Nuru.ink600) }
                        if let r = d.scriptureRef, !r.isEmpty { Pill(text: r, color: Nuru.gold) }
                    }
                    if !d.body.isEmpty {
                        Text(d.body).font(.inter(12.5)).foregroundStyle(Nuru.ink600).lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct VerseCard: View {
    let v: VerseRow
    var body: some View {
        RowShell(accent: Color(hex: 0x7C3AED)) {
            HStack(alignment: .top, spacing: 14) {
                LeadBadge(size: 40, bg: Color(hex: 0x7C3AED).opacity(0.10)) {
                    Image(systemName: "quote.bubble.fill").font(.system(size: 17)).foregroundStyle(Color(hex: 0x7C3AED))
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(v.reference.isEmpty ? "Untitled verse" : v.reference)
                            .font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        if !v.version.isEmpty { Pill(text: v.version, color: Color(hex: 0x7C3AED)) }
                        if let w = v.weekNumber { Pill(text: "Week \(w)", color: Nuru.ink600) }
                        StatusPill(on: v.isActive)
                    }
                    if !v.verseText.isEmpty {
                        Text("“\(v.verseText)”").font(.fraunces(14.5, .regular)).italic()
                            .foregroundStyle(Nuru.navy).lineLimit(4)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct DailyVerseCard: View {
    let d: ContentStudioView.DailyVerseRowLocal
    private var dateLabel: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: d.dayDate) else { return d.dayDate }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
    }
    var body: some View {
        RowShell(accent: Color(hex: 0x0EA5A0)) {
            HStack(alignment: .top, spacing: 14) {
                LeadBadge(size: 44, bg: Color(hex: 0x0EA5A0).opacity(0.10)) {
                    VStack(spacing: 0) {
                        Text("DAY").font(.inter(8.5, .bold)).tracking(0.4)
                        Text("\(d.dayIndex)").font(.fraunces(16, .medium))
                    }
                    .foregroundStyle(Color(hex: 0x0E7C77))
                }
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(d.reference).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        if !d.version.isEmpty { Pill(text: d.version, color: Color(hex: 0x0E7C77)) }
                        if let t = d.theme, !t.isEmpty { Pill(text: t, color: Nuru.ink600) }
                    }
                    if !d.dayDate.isEmpty {
                        Label(dateLabel, systemImage: "calendar").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    if !d.verseText.isEmpty {
                        Text("“\(d.verseText)”").font(.fraunces(14.5, .regular)).italic()
                            .foregroundStyle(Nuru.navy).lineLimit(4)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct PlanCard: View {
    let p: PlanRow
    var body: some View {
        RowShell(accent: Color(hex: 0x16A34A)) {
            HStack(alignment: .top, spacing: 14) {
                LeadBadge(size: 56, bg: Color(hex: 0x16A34A).opacity(0.10)) {
                    Image(systemName: "calendar.badge.clock").font(.system(size: 20)).foregroundStyle(Color(hex: 0x16A34A))
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(p.title.isEmpty ? "Untitled plan" : p.title)
                            .font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                        if let c = p.category, !c.isEmpty { Pill(text: c, color: Color(hex: 0x0F6B33)) }
                        StatusPill(on: p.isActive)
                    }
                    if let s = p.subtitle, !s.isEmpty {
                        Text(s).font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                    }
                    HStack(spacing: 8) {
                        if !p.code.isEmpty {
                            Text(p.code).font(.system(.caption, design: .monospaced)).foregroundStyle(Nuru.ink600)
                        }
                        Text("·").foregroundStyle(Nuru.ink400)
                        Text("\(p.dayCount) day\(p.dayCount == 1 ? "" : "s")")
                            .font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

private struct ResourceCard: View {
    let r: ResourceAdminRow
    private var icon: String {
        switch r.kind {
        case "book":    return "book"
        case "audio":   return "music.note"
        case "video":   return "video"
        case "article": return "doc.text"
        default:        return "doc.text"
        }
    }
    var body: some View {
        RowShell(accent: Color(hex: 0xC89B3C)) {
            HStack(alignment: .center, spacing: 14) {
                LeadBadge(size: 40, bg: Color(hex: 0xC89B3C).opacity(0.12)) {
                    Image(systemName: icon).font(.system(size: 17)).foregroundStyle(Color(hex: 0x8B6914))
                }
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(r.title.isEmpty ? "Untitled resource" : r.title)
                            .font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                        Pill(text: r.kind, color: Color(hex: 0x8B6914))
                        StatusPill(on: r.isActive)
                    }
                    HStack(spacing: 8) {
                        if let a = r.author, !a.isEmpty { Text(a).font(.nCaption).foregroundStyle(Nuru.ink600) }
                        if let dur = r.durationLabel, !dur.isEmpty {
                            Text("·").foregroundStyle(Nuru.ink400)
                            Label(dur, systemImage: "clock").font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                        if let u = r.url, !u.isEmpty {
                            Text("·").foregroundStyle(Nuru.ink400)
                            Label("link", systemImage: "link").font(.nMicro).foregroundStyle(Nuru.gold)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Empty state (web EmptyState)

private struct EmptyStateView: View {
    let tab: ContentStudioView.Tab
    var body: some View {
        VStack(spacing: 8) {
            LeadBadge(size: 56, bg: tab.accent.opacity(0.10)) {
                Image(systemName: tab.icon).font(.system(size: 26, weight: .semibold)).foregroundStyle(tab.accent)
            }
            .padding(.bottom, 6)
            Text("No \(tab.label.lowercased()) yet").font(.inter(16, .bold)).foregroundStyle(Nuru.navy)
            Text("Author your first \(tab.singular) in the web portal to publish it to the mobile app.")
                .font(.nCaption).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center).frame(maxWidth: 340)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56).padding(.horizontal, 24)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }
}
