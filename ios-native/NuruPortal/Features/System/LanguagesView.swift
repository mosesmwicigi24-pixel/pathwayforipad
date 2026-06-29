// Languages — System reference page, ported line-by-line from the web
// Languages.tsx. The languages curriculum and the portal can be delivered in; one
// is the default fallback. Hero (breadcrumb · eyebrow "Localisation" · stat strip
// Total + Active + Avg cover · "Add language" chip) + search + the card grid the
// web shows (each card: name + Default badge · native name · code · direction +
// status pills · coverage bar), laid out for iPad as an adaptive grid.
//
// The web page also does create/edit, set-default, enable/disable and delete
// (SystemApi.createLanguage / updateLanguage / deleteLanguage — POST/PUT/DELETE).
// The shared APIClient exposes only get/post, so the per-card actions are
// read-only here. See NEEDS in the porting notes.
import SwiftUI

struct LanguagesView: View {
    @State private var query = ""

    private let columns = [GridItem(.adaptive(minimum: 300), spacing: Nuru.S.base)]

    var body: some View {
        AsyncView(PortalAPI.languages) { list in
            content(list)
        }
        .portalPage("Languages")
    }

    @ViewBuilder
    private func content(_ list: [Language]) -> some View {
        let filtered = list.filter { l in
            query.isEmpty || "\(l.name) \(l.nativeName) \(l.code)".lowercased().contains(query.lowercased())
        }
        let activeCount = list.filter { $0.status == "active" }.count
        let avgCoverage = list.isEmpty ? 0 : Int((list.reduce(0.0) { $0 + $1.coverage } / Double(list.count)).rounded())

        ScrollView {
            VStack(spacing: 0) {
                PortalHero(
                    breadcrumb: ["System", "Languages"],
                    eyebrow: "Localisation",
                    title: "Languages",
                    subtitle: "The languages curriculum and the portal can be delivered in. One is the default fallback.",
                    stats: [
                        HeroStat(label: "Total", value: "\(list.count)", hint: "languages"),
                        HeroStat(label: "Active", value: "\(activeCount)", hint: "enabled"),
                        HeroStat(label: "Avg cover", value: "\(avgCoverage)%", hint: "translated"),
                    ]
                ) {
                    HeroChip(label: "Add language", icon: "plus", style: .gold)
                }

                VStack(spacing: Nuru.S.base) {
                    LanguageSearchField(text: $query, placeholder: "Search language…")

                    if filtered.isEmpty {
                        LanguageEmptyRow(text: "No languages match.")
                    } else {
                        LazyVGrid(columns: columns, spacing: Nuru.S.base) {
                            ForEach(filtered) { l in
                                LanguageCard(l)
                            }
                        }
                    }
                }
                .padding(Nuru.S.screen)
            }
        }
    }
}

private struct LanguageCard: View {
    let l: Language
    init(_ l: Language) { self.l = l }
    var body: some View {
        let active = l.status == "active"
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 8) {
                        Text(l.name).font(.fraunces(19, .semibold)).foregroundStyle(Nuru.foreground)
                        if l.isDefault {
                            HStack(spacing: 4) {
                                Image(systemName: "star.fill").font(.system(size: 8))
                                Text("Default").font(.inter(10, .bold)).tracking(0.5)
                            }
                            .textCase(.uppercase)
                            .foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Nuru.gold.opacity(0.14))
                            .clipShape(Capsule())
                        }
                    }
                    Text(l.nativeName).font(.inter(13)).foregroundStyle(Nuru.muted)
                }
                Spacer(minLength: 8)
                Text(l.code.uppercased()).font(.system(.caption, design: .monospaced)).foregroundStyle(Nuru.muted)
            }

            HStack(spacing: 8) {
                Text(l.direction.uppercased()).font(.inter(10.5, .semibold))
                    .foregroundStyle(Nuru.muted)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(Nuru.surface).clipShape(Capsule())
                Pill(text: l.status.capitalized, color: active ? Nuru.success : Nuru.muted)
            }

            VStack(spacing: 4) {
                HStack {
                    Text("Coverage").font(.inter(11)).foregroundStyle(Nuru.muted)
                    Spacer()
                    Text("\(Int(l.coverage.rounded()))%").font(.inter(11, .bold)).foregroundStyle(Nuru.foreground)
                }
                ProgressBar(pct: l.coverage, fill: Nuru.gold, height: 6)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
                .stroke(l.isDefault ? Nuru.gold : Nuru.border, lineWidth: l.isDefault ? 1.5 : 1)
        )
        .nuruShadow()
    }
}

// MARK: - Local primitives (fileprivate to avoid cross-file collisions)

fileprivate struct LanguageSearchField: View {
    @Binding var text: String
    var placeholder: String
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Nuru.muted)
            TextField(placeholder, text: $text)
                .font(.inter(14)).foregroundStyle(Nuru.foreground)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        .padding(.horizontal, 14).frame(height: 44)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

fileprivate struct LanguageEmptyRow: View {
    var text: String
    var body: some View {
        Text(text).font(.inter(14)).foregroundStyle(Nuru.muted)
            .frame(maxWidth: .infinity).padding(.vertical, 48)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
