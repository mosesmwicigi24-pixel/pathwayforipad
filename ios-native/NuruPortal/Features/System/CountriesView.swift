// Countries — System reference page, ported line-by-line from the web
// Countries.tsx. Where disciples and cells are active. Hero (breadcrumb · eyebrow
// "Reach" · stat strip Total + Active · "Add country" chip) + search + a cycling
// region filter chip + the table the web shows (Country [flag · name · code] ·
// Region · Currency · Dial code · Status), laid out for iPad.
//
// The web page also does create/edit and enable/disable (SystemApi.createCountry /
// updateCountry — POST/PUT). The shared APIClient exposes only get/post, so the
// row Edit + Enable/Disable affordances are read-only here. The Country model
// lacks `subregion`, so the region cell shows region only (matching the fields we
// actually decode). See NEEDS in the porting notes.
import SwiftUI

struct CountriesView: View {
    @State private var query = ""
    @State private var region = "All regions"

    var body: some View {
        AsyncView(PortalAPI.countries) { list in
            content(list)
        }
        .portalPage("Countries")
    }

    @ViewBuilder
    private func content(_ list: [Country]) -> some View {
        let regions = ["All regions"] + Array(Set(list.compactMap { $0.region })).sorted()
        let filtered = list.filter { c in
            let matchesQuery = query.isEmpty ||
                "\(c.name) \(c.code) \(c.region ?? "")".lowercased().contains(query.lowercased())
            let matchesRegion = region == "All regions" || c.region == region
            return matchesQuery && matchesRegion
        }
        let activeCount = list.filter { $0.status == "active" }.count

        ScrollView {
            VStack(spacing: 0) {
                PortalHero(
                    breadcrumb: ["System", "Countries"],
                    eyebrow: "Reach",
                    title: "Countries",
                    subtitle: "Where disciples and cells are active. Enable a country to allow its language and currency.",
                    stats: [
                        HeroStat(label: "Total", value: "\(list.count)", hint: "countries"),
                        HeroStat(label: "Active", value: "\(activeCount)", hint: "enabled"),
                    ]
                ) {
                    HeroChip(label: "Add country", icon: "plus", style: .gold)
                }

                VStack(spacing: Nuru.S.base) {
                    HStack(spacing: 12) {
                        CountrySearchField(text: $query, placeholder: "Search country…")
                        Button {
                            let idx = regions.firstIndex(of: region) ?? 0
                            region = regions[(idx + 1) % regions.count]
                        } label: {
                            HStack(spacing: 6) {
                                Text(region).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold)).foregroundStyle(Nuru.navy)
                            }
                            .padding(.horizontal, 14).frame(height: 44)
                            .background(Nuru.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }

                    if filtered.isEmpty {
                        CountryEmptyRow(text: "No countries match.")
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                CountryHeaderRow()
                                ForEach(Array(filtered.enumerated()), id: \.element.id) { i, c in
                                    if i > 0 { Divider().background(Nuru.border) }
                                    CountryRow(c)
                                }
                            }
                        }
                    }
                }
                .padding(Nuru.S.screen)
            }
        }
    }
}

private struct CountryHeaderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            cell("Country", flex: 3)
            cell("Region", flex: 2)
            cell("Currency", flex: 1)
            cell("Dial code", flex: 1)
            cell("Status", flex: 1, align: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 13)
        .background(Nuru.surface)
    }
    private func cell(_ t: String, flex: CGFloat, align: Alignment = .leading) -> some View {
        Text(t.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.ink600)
            .frame(maxWidth: .infinity, alignment: align)
            .layoutPriority(Double(flex))
    }
}

private struct CountryRow: View {
    let c: Country
    init(_ c: Country) { self.c = c }
    var body: some View {
        let active = c.status == "active"
        HStack(spacing: 12) {
            HStack(spacing: 12) {
                Text(c.flag ?? "🏳️").font(.system(size: 22))
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.name).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                    Text(c.code).font(.system(.caption, design: .monospaced)).foregroundStyle(Nuru.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(3)

            Text(c.region ?? "—").font(.inter(13)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(2)
            Text(c.currency ?? "—").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
            Text(c.dialCode ?? "—").font(.system(.subheadline, design: .monospaced)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
            HStack {
                Spacer(minLength: 0)
                Pill(text: c.status.capitalized, color: active ? Nuru.success : Nuru.muted)
            }
            .frame(maxWidth: .infinity, alignment: .trailing).layoutPriority(1)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
    }
}

// MARK: - Local primitives (fileprivate to avoid cross-file collisions)

fileprivate struct CountrySearchField: View {
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
    }
}

fileprivate struct CountryEmptyRow: View {
    var text: String
    var body: some View {
        Text(text).font(.inter(14)).foregroundStyle(Nuru.muted)
            .frame(maxWidth: .infinity).padding(.vertical, 48)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
