// Congregations — System reference page, ported line-by-line from the web
// Congregations.tsx. A congregation is a branch/assembly; every cell and member
// belongs to one. Hero (breadcrumb · eyebrow "Branches" · stat strip Congregations
// + Cells · "Add congregation" chip) + search + the table the web shows
// (Congregation · Country · Timezone · Cells · Members), laid out for iPad.
//
// The web page also does create/edit/delete (SystemApi.createCongregation /
// updateCongregation / deleteCongregation — POST/PUT/DELETE). The shared APIClient
// only exposes get/post, so the row edit/delete affordances are read-only here.
// See NEEDS in the porting notes for the put/delete the mutations require.
import SwiftUI

struct CongregationsView: View {
    @State private var query = ""

    var body: some View {
        AsyncView(PortalAPI.congregations) { list in
            content(list)
        }
        .portalPage("Congregations")
    }

    @ViewBuilder
    private func content(_ list: [Congregation]) -> some View {
        let filtered = list.filter { c in
            query.isEmpty || "\(c.name) \(c.country)".lowercased().contains(query.lowercased())
        }
        let totalCells = list.reduce(0) { $0 + $1.cellCount }

        ScrollView {
            VStack(spacing: 0) {
                PortalHero(
                    breadcrumb: ["System", "Congregations"],
                    eyebrow: "Branches",
                    title: "Congregations",
                    subtitle: "Each congregation is a branch or assembly. Cells and members belong to one — register at least one so new cells can be added.",
                    stats: [
                        HeroStat(label: "Congregations", value: "\(list.count)", hint: "branches"),
                        HeroStat(label: "Cells", value: "\(totalCells)", hint: "across all"),
                    ]
                ) {
                    HeroChip(label: "Add congregation", icon: "plus", style: .gold)
                }

                VStack(spacing: Nuru.S.base) {
                    SearchField(text: $query, placeholder: "Search congregation…")

                    if filtered.isEmpty {
                        EmptyRow(text: "No congregations yet. Add one so cells can be registered.")
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                CongregationHeaderRow()
                                ForEach(Array(filtered.enumerated()), id: \.element.id) { i, c in
                                    if i > 0 { Divider().background(Nuru.border) }
                                    CongregationRow(c)
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

// MARK: - Shared local primitives (fileprivate to avoid cross-file collisions)

fileprivate struct SearchField: View {
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

fileprivate struct EmptyRow: View {
    var text: String
    var body: some View {
        Text(text).font(.inter(14)).foregroundStyle(Nuru.muted)
            .frame(maxWidth: .infinity).padding(.vertical, 48)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

private struct CongregationHeaderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            cell("Congregation", flex: 3)
            cell("Country", flex: 1)
            cell("Timezone", flex: 2)
            cell("Cells", flex: 1, align: .trailing)
            cell("Members", flex: 1, align: .trailing)
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

private struct CongregationRow: View {
    let c: Congregation
    init(_ c: Congregation) { self.c = c }
    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: "building.columns")
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(Nuru.navy)
                    .frame(width: 38, height: 38).background(Nuru.navy.opacity(0.10))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                Text(c.name).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
            }
            .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(3)

            Text(c.country).font(.system(.subheadline, design: .monospaced)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
            Text(c.timezone).font(.inter(13)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .leading).layoutPriority(2)
            Text("\(c.cellCount)").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .trailing).layoutPriority(1)
            Text("\(c.memberCount)").font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                .frame(maxWidth: .infinity, alignment: .trailing).layoutPriority(1)
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
    }
}
