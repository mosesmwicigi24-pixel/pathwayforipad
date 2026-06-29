// Languages — System reference page, ported line-by-line from the web
// Languages.tsx. The languages curriculum and the portal can be delivered in; one
// is the default fallback. Hero (breadcrumb · eyebrow "Localisation" · stat strip
// Total + Active + Avg cover · "Add language" chip) + search + the card grid the
// web shows (each card: name + Default badge · native name · code · direction +
// status pills · coverage bar), laid out for iPad as an adaptive grid.
//
// CRUD now wired (parity with the web): the "Add language" hero chip opens a form
// sheet (POST /admin/languages); each card carries Set-default (PUT with is_default
// in the body), Edit (PUT /admin/languages/{code}), Enable/Disable (PUT with status
// in the body) and Delete (DELETE /admin/languages/{code}, with a confirm alert —
// the default language can't be removed, matching the backend guard). The grid
// reloads after every write.
import SwiftUI

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
private struct LangBox: Identifiable { let id: String }

private enum LanguagesAPI {
    static func list() async throws -> [Language] {
        try await APIClient.shared.get("/admin/languages", as: DataList<Language>.self).data
    }
    // SystemApi.createLanguage — POST /admin/languages
    static func create(_ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.post("/admin/languages", body: body, as: OkResponse.self)
    }
    // SystemApi.updateLanguage — PUT /admin/languages/{code}
    static func update(_ code: String, _ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.put("/admin/languages/\(code)", body: body, as: OkResponse.self)
    }
    // SystemApi.deleteLanguage — DELETE /admin/languages/{code}
    static func delete(_ code: String) async throws {
        _ = try await APIClient.shared.delete("/admin/languages/\(code)", as: OkResponse.self)
    }
}

@MainActor
private final class LanguagesVM: ObservableObject {
    @Published var list: [Language] = []
    @Published var error: String?
    @Published var loading = true

    func load() async {
        do { list = try await LanguagesAPI.list(); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load languages." }
        loading = false
    }
    // Set-default via update body (mirrors web `setDefault`).
    func setDefault(_ l: Language) async {
        do {
            try await LanguagesAPI.update(l.code, ["is_default": .bool(true), "status": .string("active")])
            await load()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Update failed." }
    }
    // Enable/disable via update body (mirrors web `toggle`).
    func toggle(_ l: Language) async {
        do {
            try await LanguagesAPI.update(l.code, ["status": .string(l.status == "active" ? "inactive" : "active")])
            await load()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Update failed." }
    }
    func remove(_ l: Language) async {
        do { try await LanguagesAPI.delete(l.code); await load() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Delete failed." }
    }
}

struct LanguagesView: View {
    @StateObject private var vm = LanguagesVM()
    @State private var query = ""
    @State private var creating = false
    @State private var editing: LangBox?
    @State private var deleteTarget: Language?

    // PORTRAIT-tuned adaptive grid: ~224pt min so a clean 3-up fits the ~724pt
    // content width (falls to 2-up when narrower / in split view).
    private let columns = [GridItem(.adaptive(minimum: 224), spacing: 14)]

    var body: some View {
        Group {
            if vm.loading && vm.list.isEmpty {
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            } else {
                content(vm.list)
            }
        }
        .background(Nuru.paper)
        .portalPage("Languages")
        .task { if vm.list.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .sheet(isPresented: $creating) {
            LanguageFormSheet(initial: nil) { Task { await vm.load() } }
        }
        .sheet(item: $editing) { box in
            LanguageFormSheet(initial: vm.list.first { $0.code == box.id }) { Task { await vm.load() } }
        }
        .alert("Remove language?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button("Cancel", role: .cancel) { deleteTarget = nil }
            Button("Remove", role: .destructive) {
                if let l = deleteTarget { Task { await vm.remove(l) } }
                deleteTarget = nil
            }
        } message: {
            Text("Remove \(deleteTarget?.name ?? "")? This cannot be undone.")
        }
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
                    HeroChip(label: "Add language", icon: "plus", style: .gold) { creating = true }
                }

                VStack(spacing: Nuru.S.base) {
                    if let e = vm.error { ErrorBanner(message: e) { Task { await vm.load() } } }
                    LanguageSearchField(text: $query, placeholder: "Search language…")

                    if filtered.isEmpty {
                        LanguageEmptyRow(text: "No languages match.")
                    } else {
                        LazyVGrid(columns: columns, spacing: 14) {
                            ForEach(filtered) { l in
                                LanguageCard(l,
                                             onSetDefault: { Task { await vm.setDefault(l) } },
                                             onEdit: { editing = LangBox(id: l.code) },
                                             onToggle: { Task { await vm.toggle(l) } },
                                             onDelete: { deleteTarget = l })
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
    let onSetDefault: () -> Void
    let onEdit: () -> Void
    let onToggle: () -> Void
    let onDelete: () -> Void
    init(_ l: Language, onSetDefault: @escaping () -> Void, onEdit: @escaping () -> Void,
         onToggle: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.l = l; self.onSetDefault = onSetDefault; self.onEdit = onEdit
        self.onToggle = onToggle; self.onDelete = onDelete
    }
    var body: some View {
        let active = l.status == "active"
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(l.name).font(.fraunces(15.5, .semibold)).foregroundStyle(Nuru.foreground).lineLimit(1).minimumScaleFactor(0.85)
                        if l.isDefault {
                            HStack(spacing: 3) {
                                Image(systemName: "star.fill").font(.system(size: 7.5))
                                Text("Default").font(.inter(9.5, .bold)).tracking(0.4)
                            }
                            .textCase(.uppercase)
                            .foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 7).padding(.vertical, 2.5)
                            .background(Nuru.gold.opacity(0.14))
                            .clipShape(Capsule())
                        }
                    }
                    Text(l.nativeName).font(.inter(12.5)).foregroundStyle(Nuru.muted).lineLimit(1)
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

            Divider().background(Nuru.border)

            HStack(spacing: 9) {
                if !l.isDefault {
                    Button(action: onSetDefault) {
                        HStack(spacing: 3) { Image(systemName: "star").font(.system(size: 11)); Text("Default") }
                            .font(.inter(11, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    }
                    .buttonStyle(.plain)
                }
                Button(action: onEdit) {
                    HStack(spacing: 3) { Image(systemName: "pencil").font(.system(size: 11)); Text("Edit") }
                        .font(.inter(11, .semibold)).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                .buttonStyle(.plain)
                Button(action: onToggle) {
                    Text(active ? "Disable" : "Enable").font(.inter(11, .semibold)).lineLimit(1)
                        .foregroundStyle(active ? Color(hex: 0xDC2626) : Color(hex: 0x16A34A))
                }
                .buttonStyle(.plain)
                Spacer(minLength: 0)
                if !l.isDefault {
                    Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(Color(hex: 0xDC2626)) }
                        .buttonStyle(.plain)
                }
            }
        }
        .padding(16)
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

// MARK: - Form sheet (NEW language / EDIT language)

private struct LanguageFormSheet: View {
    let initial: Language?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var nativeName: String
    @State private var code: String
    @State private var direction: String
    @State private var coverage: Double
    @State private var isDefault: Bool
    @State private var status: String
    @State private var saving = false
    @State private var error: String?

    init(initial: Language?, onDone: @escaping () -> Void) {
        self.initial = initial
        self.onDone = onDone
        _name = State(initialValue: initial?.name ?? "")
        _nativeName = State(initialValue: initial?.nativeName ?? "")
        _code = State(initialValue: initial?.code ?? "")
        _direction = State(initialValue: initial?.direction ?? "ltr")
        _coverage = State(initialValue: initial?.coverage ?? 0)
        _isDefault = State(initialValue: initial?.isDefault ?? false)
        _status = State(initialValue: initial?.status ?? "active")
    }
    private var isEdit: Bool { initial != nil }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                SwiftUI.Section("Language") {
                    field("Name *") { TextField("Swahili", text: $name) }
                    field("Native *") { TextField("Kiswahili", text: $nativeName) }
                    field("Code *") {
                        TextField("sw", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .disabled(isEdit)
                            .onChange(of: code) { _, v in code = String(v.lowercased().prefix(8)) }
                    }
                }
                SwiftUI.Section("Detail") {
                    Picker("Direction", selection: $direction) { Text("LTR").tag("ltr"); Text("RTL").tag("rtl") }
                    HStack {
                        Text("Coverage").foregroundStyle(Nuru.ink600)
                        Spacer()
                        Text("\(Int(coverage.rounded()))%").foregroundStyle(Nuru.navy)
                    }
                    Slider(value: $coverage, in: 0...100, step: 1)
                    Picker("Status", selection: $status) { Text("Active").tag("active"); Text("Inactive").tag("inactive") }
                    Toggle("Set as the default fallback language", isOn: $isDefault)
                }
            }
            .navigationTitle(isEdit ? "Edit \(initial!.name)" : "Add a language")
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
        HStack { Text(label).foregroundStyle(Nuru.ink600).frame(width: 80, alignment: .leading); content() }
    }

    private func submit() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let nat = nativeName.trimmingCharacters(in: .whitespaces)
        let cc = code.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, !nat.isEmpty, cc.count >= 2 else {
            error = "Name, native name and a code (2+ chars) are required."; return
        }
        saving = true; error = nil
        let cov = max(0, min(100, Int(coverage.rounded())))
        var body: [String: JSONValue] = [
            "name": .string(n),
            "native_name": .string(nat),
            "direction": .string(direction),
            "coverage": .int(cov),
            "is_default": .bool(isDefault),
            "status": .string(status),
        ]
        do {
            if isEdit { try await LanguagesAPI.update(initial!.code, body) }
            else { body["code"] = .string(cc.lowercased()); try await LanguagesAPI.create(body) }
            onDone(); dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
        }
        saving = false
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
