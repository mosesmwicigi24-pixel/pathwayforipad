// Countries — System reference page, ported line-by-line from the web
// Countries.tsx. Where disciples and cells are active. Hero (breadcrumb · eyebrow
// "Reach" · stat strip Total + Active · "Add country" chip) + search + a cycling
// region filter chip + the table the web shows (Country [flag · name · code] ·
// Region · Currency · Dial code · Status), laid out for iPad.
//
// CRUD now wired (parity with the web): the "Add country" hero chip opens a form
// sheet (POST /admin/countries), each row carries Edit (PUT /admin/countries/{code}
// — code is fixed on edit) and an Enable/Disable toggle that PUTs the new status.
// The Country model lacks `subregion`, so the row shows region only, but the form
// still sends subregion (defaulting to the region) to match the web body. The list
// reloads after every write.
import SwiftUI

private let REGIONS = ["Africa", "Americas", "Asia", "Europe", "Oceania"]

// Conditional JSON body (mirrors the web's plain object literal).
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
private struct OkResponse: Decodable {}
private struct CountryBox: Identifiable { let id: String }

private enum CountriesAPI {
    static func list() async throws -> [Country] {
        try await APIClient.shared.get("/admin/countries", as: DataList<Country>.self).data
    }
    // SystemApi.createCountry — POST /admin/countries
    static func create(_ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.post("/admin/countries", body: body, as: OkResponse.self)
    }
    // SystemApi.updateCountry — PUT /admin/countries/{code}
    static func update(_ code: String, _ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.put("/admin/countries/\(code)", body: body, as: OkResponse.self)
    }
}

@MainActor
private final class CountriesVM: ObservableObject {
    @Published var list: [Country] = []
    @Published var error: String?
    @Published var loading = true

    func load() async {
        do { list = try await CountriesAPI.list(); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load countries." }
        loading = false
    }
    // Enable/disable via the update body's status (mirrors web `toggle`).
    func toggle(_ c: Country) async {
        do {
            try await CountriesAPI.update(c.code, ["status": .string(c.status == "active" ? "inactive" : "active")])
            await load()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Update failed." }
    }
}

struct CountriesView: View {
    @StateObject private var vm = CountriesVM()
    @State private var query = ""
    @State private var region = "All regions"
    @State private var creating = false
    @State private var editing: CountryBox?

    var body: some View {
        Group {
            if vm.loading && vm.list.isEmpty {
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            } else {
                content(vm.list)
            }
        }
        .background(Nuru.paper)
        .portalPage("Countries")
        .task { if vm.list.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .sheet(isPresented: $creating) {
            CountryFormSheet(initial: nil) { Task { await vm.load() } }
        }
        .sheet(item: $editing) { box in
            CountryFormSheet(initial: vm.list.first { $0.code == box.id }) { Task { await vm.load() } }
        }
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
                    HeroChip(label: "Add country", icon: "plus", style: .gold) { creating = true }
                }

                VStack(spacing: Nuru.S.base) {
                    if let e = vm.error { ErrorBanner(message: e) { Task { await vm.load() } } }
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
                                    CountryRow(c, onEdit: { editing = CountryBox(id: c.code) },
                                               onToggle: { Task { await vm.toggle(c) } })
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

// MARK: - Form sheet (NEW country / EDIT country)

private struct CountryFormSheet: View {
    let initial: Country?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var flag: String
    @State private var name: String
    @State private var code: String
    @State private var region: String
    @State private var subregion: String
    @State private var dialCode: String
    @State private var currency: String
    @State private var status: String
    @State private var saving = false
    @State private var error: String?

    init(initial: Country?, onDone: @escaping () -> Void) {
        self.initial = initial
        self.onDone = onDone
        _flag = State(initialValue: initial?.flag ?? "")
        _name = State(initialValue: initial?.name ?? "")
        _code = State(initialValue: initial?.code ?? "")
        _region = State(initialValue: initial?.region ?? "Africa")
        _subregion = State(initialValue: "")
        _dialCode = State(initialValue: initial?.dialCode ?? "+")
        _currency = State(initialValue: initial?.currency ?? "")
        _status = State(initialValue: initial?.status ?? "active")
    }
    private var isEdit: Bool { initial != nil }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                SwiftUI.Section("Country") {
                    field("Flag") { TextField("🇰🇪", text: $flag) }
                    field("Name *") { TextField("e.g. Kenya", text: $name) }
                    field("Code *") {
                        TextField("KE", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .disabled(isEdit)
                            .onChange(of: code) { _, v in code = String(v.uppercased().prefix(2)) }
                    }
                }
                SwiftUI.Section("Region") {
                    Picker("Region", selection: $region) { ForEach(REGIONS, id: \.self) { Text($0).tag($0) } }
                    field("Sub-region") { TextField("Eastern Africa", text: $subregion) }
                }
                SwiftUI.Section("Detail") {
                    field("Dial code") { TextField("+254", text: $dialCode).keyboardType(.phonePad) }
                    field("Currency") {
                        TextField("KES", text: $currency).textInputAutocapitalization(.characters).autocorrectionDisabled()
                            .onChange(of: currency) { _, v in currency = String(v.uppercased().prefix(3)) }
                    }
                    Picker("Status", selection: $status) { Text("Active").tag("active"); Text("Inactive").tag("inactive") }
                }
            }
            .navigationTitle(isEdit ? "Edit \(initial!.name)" : "Add a country")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEdit ? "Save" : "Add") { Task { await submit() } }.disabled(saving)
                }
            }
        }
    }

    @ViewBuilder private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        HStack { Text(label).foregroundStyle(Nuru.ink600).frame(width: 90, alignment: .leading); content() }
    }

    private func submit() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let cc = code.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, cc.count == 2 else { error = "Name and a 2-letter code are required."; return }
        saving = true; error = nil
        let f = flag.trimmingCharacters(in: .whitespaces)
        let sub = subregion.trimmingCharacters(in: .whitespaces)
        let dial = dialCode.trimmingCharacters(in: .whitespaces)
        let cur = currency.trimmingCharacters(in: .whitespaces).uppercased()
        var body: [String: JSONValue] = [
            "name": .string(n),
            "flag": f.isEmpty ? .null : .string(f),
            "region": .string(region),
            "subregion": .string(sub.isEmpty ? region : sub),
            "dial_code": dial.isEmpty ? .null : .string(dial),
            "currency": cur.isEmpty ? .null : .string(cur),
            "status": .string(status),
        ]
        do {
            if isEdit { try await CountriesAPI.update(initial!.code, body) }
            else { body["code"] = .string(cc.uppercased()); try await CountriesAPI.create(body) }
            onDone(); dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
        }
        saving = false
    }
}

// Fixed column widths so every cell aligns across rows and the status Pill is
// never squeezed to zero. The Country (name) column flexes; the rest are fixed.
// Tuned for PORTRAIT: usable row width ≈ 688pt (724 Card − 36 row padding).
// fixed 470 + 5×14 gaps + name flex ≈ 148 → fits without clipping.
private enum CountryCol {
    static let region: CGFloat = 130
    static let currency: CGFloat = 70
    static let dial: CGFloat = 78
    static let status: CGFloat = 96
    static let actions: CGFloat = 96
}

private struct CountryHeaderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            Text("Country").modifier(CountryHead(maxWidth: .infinity, align: .leading))
            Text("Region").modifier(CountryHead(width: CountryCol.region, align: .leading))
            Text("Currency").modifier(CountryHead(width: CountryCol.currency, align: .leading))
            Text("Dial").modifier(CountryHead(width: CountryCol.dial, align: .leading))
            Text("Status").modifier(CountryHead(width: CountryCol.status, align: .leading))
            Text("").modifier(CountryHead(width: CountryCol.actions, align: .trailing))
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Nuru.surface)
    }
}

private struct CountryHead: ViewModifier {
    var width: CGFloat? = nil
    var maxWidth: CGFloat? = nil
    var align: Alignment
    func body(content: Content) -> some View {
        content
            .font(.nOverline).tracking(0.6).foregroundStyle(Nuru.ink600)
            .lineLimit(1)
            .frame(width: width, alignment: align)
            .frame(maxWidth: maxWidth, alignment: align)
    }
}

// Stable tinted accent per region, so each row carries a quiet colour cue.
private func regionTint(_ region: String?) -> Color {
    switch region {
    case "Africa":   return Nuru.gold
    case "Americas": return Color(hex: 0x1B5FAE)
    case "Asia":     return Color(hex: 0x7A4FB0)
    case "Europe":   return Nuru.success
    case "Oceania":  return Color(hex: 0x0E8C9B)
    default:         return Nuru.ink600
    }
}

private struct CountryRow: View {
    let c: Country
    let onEdit: () -> Void
    let onToggle: () -> Void
    init(_ c: Country, onEdit: @escaping () -> Void, onToggle: @escaping () -> Void) {
        self.c = c; self.onEdit = onEdit; self.onToggle = onToggle
    }
    var body: some View {
        let active = c.status == "active"
        let tint = regionTint(c.region)
        HStack(spacing: 12) {
            HStack(spacing: 10) {
                // Tinted flag chip — a premium leading accent.
                Text(c.flag ?? "🏳️").font(.system(size: 17))
                    .frame(width: 34, height: 34)
                    .background(tint.opacity(0.12))
                    .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(tint.opacity(0.22), lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.name).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(c.code).font(.system(.caption2, design: .monospaced)).foregroundStyle(Nuru.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 7) {
                Circle().fill(tint).frame(width: 6, height: 6)
                Text(c.region ?? "—").font(.inter(12.5)).foregroundStyle(Nuru.foreground).lineLimit(1).minimumScaleFactor(0.85)
            }
            .frame(width: CountryCol.region, alignment: .leading)
            Text(c.currency ?? "—").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.foreground).lineLimit(1)
                .frame(width: CountryCol.currency, alignment: .leading)
            Text(c.dialCode ?? "—").font(.system(size: 12.5, design: .monospaced)).foregroundStyle(Nuru.muted).lineLimit(1)
                .frame(width: CountryCol.dial, alignment: .leading)
            HStack {
                Pill(text: active ? "Active" : "Inactive", color: active ? Nuru.success : Nuru.muted)
                Spacer(minLength: 0)
            }
            .frame(width: CountryCol.status, alignment: .leading)
            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button(action: onEdit) { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(Nuru.muted) }
                    .buttonStyle(.plain)
                Button(action: onToggle) {
                    Text(active ? "Disable" : "Enable").font(.inter(11.5, .bold))
                        .foregroundStyle(active ? Color(hex: 0xDC2626) : Color(hex: 0x16A34A))
                        .lineLimit(1).fixedSize()
                }
                .buttonStyle(.plain)
            }
            .frame(width: CountryCol.actions, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(minHeight: 54)
        .background(active ? Color.clear : Nuru.surface.opacity(0.5))
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
