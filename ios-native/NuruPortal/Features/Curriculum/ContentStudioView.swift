// Content Studio — the growth library (devotionals, memory verses, reading plans,
// resources) over /admin/growth/*, as a native segmented browser.
import SwiftUI

struct ContentStudioView: View {
    enum Tab: String, CaseIterable, Identifiable {
        case devotionals = "Devotionals", verses = "Verses", plans = "Plans", resources = "Resources"
        var id: String { rawValue }
    }
    @State private var tab: Tab = .devotionals

    var body: some View {
        VStack(spacing: 0) {
            Picker("Section", selection: $tab) {
                ForEach(Tab.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 20).padding(.vertical, 12)
            .background(Nuru.background)

            switch tab {
            case .devotionals:
                AsyncView(PortalAPI.devotionals) { rows in list(rows) { d in
                    row(title: "Day \(d.dayNumber) · \(d.title)",
                        subtitle: d.scriptureRef ?? d.series ?? "",
                        body: d.body, active: d.isPublished, activeLabel: "Published")
                }}
            case .verses:
                AsyncView(PortalAPI.verses) { rows in list(rows) { v in
                    row(title: v.reference, subtitle: "\(v.version)\(v.weekNumber.map { " · Week \($0)" } ?? "")",
                        body: v.verseText, active: v.isActive)
                }}
            case .plans:
                AsyncView(PortalAPI.plans) { rows in list(rows) { p in
                    row(title: p.title, subtitle: "\(p.category ?? "Plan") · \(p.dayCount) days",
                        body: p.description ?? p.subtitle ?? "", active: p.isActive)
                }}
            case .resources:
                AsyncView(PortalAPI.resources) { rows in list(rows) { r in
                    row(title: r.title, subtitle: "\(r.kind.capitalized)\(r.author.map { " · \($0)" } ?? "")",
                        body: r.durationLabel ?? "", active: r.isActive)
                }}
            }
        }
        .background(Nuru.background)
        .portalPage("Content Studio")
    }

    private func list<T: Identifiable, R: View>(_ rows: [T], @ViewBuilder _ rowFor: @escaping (T) -> R) -> some View {
        ScrollView {
            VStack(spacing: 10) {
                ForEach(rows) { rowFor($0) }
            }
            .padding(20)
        }
    }

    private func row(title: String, subtitle: String, body: String, active: Bool, activeLabel: String = "Active") -> some View {
        Card {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                    Spacer()
                    Pill(text: active ? activeLabel : "Hidden", color: active ? Nuru.success : Nuru.muted)
                }
                if !subtitle.isEmpty { Text(subtitle).font(.caption).foregroundStyle(Nuru.gold) }
                if !body.isEmpty { Text(body).font(.caption).foregroundStyle(Nuru.muted).lineLimit(3) }
            }
        }
    }
}
