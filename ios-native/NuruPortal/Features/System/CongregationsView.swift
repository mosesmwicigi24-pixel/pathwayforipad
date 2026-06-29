// Congregations — System reference page, ported line-by-line from the web
// Congregations.tsx. A congregation is a branch/assembly; every cell and member
// belongs to one. Hero (breadcrumb · eyebrow "Branches" · stat strip Congregations
// + Cells · "Add congregation" chip) + search + the table the web shows
// (Congregation · Country · Timezone · Cells · Members), laid out for iPad.
//
// CRUD now wired (parity with the web): the "Add congregation" hero chip opens a
// form sheet (POST /admin/congregations), each row carries Edit (PUT
// /admin/congregations/{id}) + Delete (DELETE /admin/congregations/{id}, with a
// confirm alert; the server guards rows that still have cells/members). The list
// reloads after every write.
import SwiftUI

private let TIMEZONES = [
    "Africa/Nairobi", "Africa/Lagos", "Africa/Kampala", "Africa/Dar_es_Salaam",
    "Africa/Johannesburg", "Africa/Accra", "Europe/London", "America/New_York", "UTC",
]

// Conditional JSON body (mirrors the web's plain object literal).
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), double(Double), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .double(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
private struct OkResponse: Decodable {}
private struct CongIdBox: Identifiable { let id: String }

private enum CongregationsAPI {
    static func list() async throws -> [Congregation] {
        try await APIClient.shared.get("/admin/congregations", as: DataList<Congregation>.self).data
    }
    // SystemApi.createCongregation — POST /admin/congregations
    static func create(_ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.post("/admin/congregations", body: body, as: OkResponse.self)
    }
    // SystemApi.updateCongregation — PUT /admin/congregations/{id}
    static func update(_ id: String, _ body: [String: JSONValue]) async throws {
        _ = try await APIClient.shared.put("/admin/congregations/\(id)", body: body, as: OkResponse.self)
    }
    // SystemApi.deleteCongregation — DELETE /admin/congregations/{id}
    static func delete(_ id: String) async throws {
        _ = try await APIClient.shared.delete("/admin/congregations/\(id)", as: OkResponse.self)
    }
}

@MainActor
private final class CongregationsVM: ObservableObject {
    @Published var list: [Congregation] = []
    @Published var error: String?
    @Published var loading = true

    func load() async {
        do { list = try await CongregationsAPI.list(); error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load congregations." }
        loading = false
    }
    func remove(_ c: Congregation) async {
        do { try await CongregationsAPI.delete(c.congregationId); await load() }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Delete failed." }
    }
}

struct CongregationsView: View {
    @StateObject private var vm = CongregationsVM()
    @State private var query = ""
    @State private var creating = false
    @State private var editing: CongIdBox?
    @State private var deleteTarget: Congregation?

    var body: some View {
        Group {
            if vm.loading && vm.list.isEmpty {
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            } else {
                content(vm.list)
            }
        }
        .background(Nuru.paper)
        .portalPage("Congregations")
        .task { if vm.list.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .sheet(isPresented: $creating) {
            CongregationFormSheet(initial: nil) { Task { await vm.load() } }
        }
        .sheet(item: $editing) { box in
            CongregationFormSheet(initial: vm.list.first { $0.congregationId == box.id }) { Task { await vm.load() } }
        }
        .alert("Remove congregation?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button("Cancel", role: .cancel) { deleteTarget = nil }
            Button("Remove", role: .destructive) {
                if let c = deleteTarget { Task { await vm.remove(c) } }
                deleteTarget = nil
            }
        } message: {
            Text("Remove congregation \u{201C}\(deleteTarget?.name ?? "")\u{201D}? This cannot be undone.")
        }
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
                    HeroChip(label: "Add congregation", icon: "plus", style: .gold) { creating = true }
                }

                VStack(spacing: Nuru.S.base) {
                    if let e = vm.error { ErrorBanner(message: e) { Task { await vm.load() } } }
                    SearchField(text: $query, placeholder: "Search congregation…")

                    if filtered.isEmpty {
                        EmptyRow(text: "No congregations yet. Add one so cells can be registered.")
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                CongregationHeaderRow()
                                ForEach(Array(filtered.enumerated()), id: \.element.id) { i, c in
                                    if i > 0 { Divider().background(Nuru.border) }
                                    CongregationRow(c, onEdit: { editing = CongIdBox(id: c.congregationId) },
                                                    onDelete: { deleteTarget = c })
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

// MARK: - Form sheet (NEW congregation / EDIT congregation)

private struct CongregationFormSheet: View {
    let initial: Congregation?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var country: String
    @State private var timezone: String
    @State private var saving = false
    @State private var error: String?

    init(initial: Congregation?, onDone: @escaping () -> Void) {
        self.initial = initial
        self.onDone = onDone
        _name = State(initialValue: initial?.name ?? "")
        _country = State(initialValue: initial?.country ?? "KE")
        _timezone = State(initialValue: initial?.timezone ?? "Africa/Nairobi")
    }
    private var isEdit: Bool { initial != nil }

    var body: some View {
        NavigationStack {
            SysFormScaffold(error: error) {
                SysFormSection("Congregation", subtitle: "A branch or assembly. Cells and members belong to one.") {
                    SysFieldGrid {
                        SysField("Name", required: true) {
                            TextField("e.g. TGNM", text: $name).sysFieldInput()
                        }
                        SysField("Country", required: true) {
                            TextField("KE", text: $country)
                                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                .onChange(of: country) { _, v in country = String(v.uppercased().prefix(2)) }
                                .sysFieldInput()
                        }
                        SysField("Timezone", span: 2) {
                            Picker("", selection: $timezone) {
                                ForEach(TIMEZONES.contains(timezone) ? TIMEZONES : [timezone] + TIMEZONES, id: \.self) { tz in Text(tz).tag(tz) }
                            }
                            .labelsHidden().pickerStyle(.menu).tint(Nuru.gold)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
            }
            .navigationTitle(isEdit ? "Edit \(initial!.name)" : "Add a congregation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Nuru.ink600) }
                ToolbarItem(placement: .confirmationAction) {
                    SysSaveButton(title: isEdit ? "Save" : "Add", saving: saving) { Task { await submit() } }
                }
            }
        }
    }

    private func submit() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        let cc = country.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, cc.count == 2 else { error = "Name and a 2-letter country code are required."; return }
        saving = true; error = nil
        let tz = timezone.trimmingCharacters(in: .whitespaces)
        let body: [String: JSONValue] = [
            "name": .string(n),
            "country": .string(cc.uppercased()),
            "timezone": .string(tz.isEmpty ? "Africa/Nairobi" : tz),
        ]
        do {
            if isEdit { try await CongregationsAPI.update(initial!.congregationId, body) }
            else { try await CongregationsAPI.create(body) }
            onDone(); dismiss()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
        }
        saving = false
    }
}

// MARK: - System form kit (bright, roomy, two-column edit/add sheets — Pass v6)
// A small shared kit (internal visibility, defined once here) used by every System
// editor sheet: Roles, Users, Congregations, Countries, Languages. Warm cream
// background, white field rows, dark-ink labels, navy section headers, two-column
// field grid wrapped to a sensible max width, and a gold-filled Save button.
// Presentation only — the host sheets keep all their bindings/validation/actions.

/// Warm scaffold: hides the gray grouped Form chrome, paints Nuru.paper, centers the
/// content to ~760pt, and shows a soft error banner at the top when present.
struct SysFormScaffold<Content: View>: View {
    var error: String?
    @ViewBuilder var content: () -> Content
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if let error, !error.isEmpty {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 13, weight: .semibold))
                        Text(error).font(.inter(13, .medium))
                    }
                    .foregroundStyle(Nuru.danger)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.danger.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.danger.opacity(0.25), lineWidth: 1))
                }
                content()
            }
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 22).padding(.top, 18).padding(.bottom, 40)
        }
        .scrollContentBackground(.hidden)
        .background(Nuru.paper)
        .presentationDetents([.large])
    }
}

/// A titled white section card with a navy header and optional subtitle.
struct SysFormSection<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: () -> Content
    init(_ title: String, subtitle: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.title = title; self.subtitle = subtitle; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                if let subtitle {
                    Text(subtitle).font(.inter(11.5, .regular)).foregroundStyle(Nuru.ink600)
                }
            }
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

/// Lays its children in two equal columns that wrap. Each child declares a span
/// (1 = half width, 2 = full row) via `.sysSpan(_:)`; default is 1.
struct SysFieldGrid<Content: View>: View {
    @ViewBuilder var content: () -> Content
    private let columns = [GridItem(.flexible(), spacing: 14), GridItem(.flexible(), spacing: 14)]
    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: 14) { content() }
    }
}

/// One labelled field: a small dark-ink overline label above a white value row that
/// hosts the (unchanged) control. `span: 2` makes it occupy a full grid row.
struct SysField<Content: View>: View {
    let label: String
    var required: Bool = false
    var span: Int = 1
    @ViewBuilder var content: () -> Content
    init(_ label: String, required: Bool = false, span: Int = 1, @ViewBuilder content: @escaping () -> Content) {
        self.label = label; self.required = required; self.span = span; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11, .bold)).foregroundStyle(Nuru.gold) }
            }
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).frame(minHeight: 42)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .gridCellColumns(span)
    }
}

/// Full-width container for content that brings its own surface (e.g. a TextEditor
/// section or a checklist) — label on top, no inner field chrome.
struct SysBlock<Content: View>: View {
    let label: String
    var span: Int = 2
    @ViewBuilder var content: () -> Content
    init(_ label: String, span: Int = 2, @ViewBuilder content: @escaping () -> Content) {
        self.label = label; self.span = span; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .gridCellColumns(span)
    }
}

/// Gold brand-filled confirm button for the sheet toolbar.
struct SysSaveButton: View {
    let title: String
    var saving: Bool = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.inter(14, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 18).padding(.vertical, 7)
                .background(Nuru.gold)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(saving)
        .opacity(saving ? 0.6 : 1)
    }
}

extension View {
    /// Readable value typography for a bare TextField/SecureField inside a SysField row.
    func sysFieldInput() -> some View {
        self.font(.inter(15)).foregroundStyle(Nuru.ink).tint(Nuru.gold)
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

// Fixed column widths so every cell aligns across rows. The Congregation (name)
// column flexes; the rest are fixed. Tuned for PORTRAIT (usable row ≈ 692pt):
// fixed 416 + 5×12 gaps + name flex ≈ 216 → fits cleanly.
private enum CongCol {
    static let country: CGFloat = 64
    static let timezone: CGFloat = 150
    static let cells: CGFloat = 56
    static let members: CGFloat = 70
    static let actions: CGFloat = 76
}

private struct CongregationHeaderRow: View {
    var body: some View {
        HStack(spacing: 12) {
            head("Congregation", maxWidth: .infinity, align: .leading)
            head("Country", width: CongCol.country, align: .leading)
            head("Timezone", width: CongCol.timezone, align: .leading)
            head("Cells", width: CongCol.cells, align: .trailing)
            head("Members", width: CongCol.members, align: .trailing)
            head("", width: CongCol.actions, align: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 10)
        .background(Nuru.surface)
    }
    @ViewBuilder private func head(_ t: String, width: CGFloat? = nil, maxWidth: CGFloat? = nil, align: Alignment) -> some View {
        Text(t.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.ink600).lineLimit(1)
            .frame(width: width, alignment: align)
            .frame(maxWidth: maxWidth, alignment: align)
    }
}

private struct CongregationRow: View {
    let c: Congregation
    let onEdit: () -> Void
    let onDelete: () -> Void
    init(_ c: Congregation, onEdit: @escaping () -> Void, onDelete: @escaping () -> Void) {
        self.c = c; self.onEdit = onEdit; self.onDelete = onDelete
    }
    var body: some View {
        HStack(spacing: 12) {
            HStack(spacing: 11) {
                // Tinted building chip — substantial leading accent.
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Nuru.gold.opacity(0.14))
                    Image(systemName: "building.columns.fill")
                        .font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.gold)
                }
                .frame(width: 36, height: 36)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.gold.opacity(0.22), lineWidth: 1))
                VStack(alignment: .leading, spacing: 1) {
                    Text(c.name).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text("Branch").font(.inter(10.5, .medium)).tracking(0.4).foregroundStyle(Nuru.muted)
                        .textCase(.uppercase)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            HStack(spacing: 6) {
                Image(systemName: "globe").font(.system(size: 10)).foregroundStyle(Nuru.muted)
                Text(c.country).font(.system(size: 12.5, design: .monospaced)).foregroundStyle(Nuru.foreground).lineLimit(1)
            }
            .frame(width: CongCol.country, alignment: .leading)
            Text(c.timezone).font(.inter(12)).foregroundStyle(Nuru.muted).lineLimit(1).minimumScaleFactor(0.8)
                .frame(width: CongCol.timezone, alignment: .leading)
            CongStat(value: c.cellCount, label: "cells")
                .frame(width: CongCol.cells, alignment: .trailing)
            CongStat(value: c.memberCount, label: "people")
                .frame(width: CongCol.members, alignment: .trailing)
            HStack(spacing: 10) {
                Spacer(minLength: 0)
                Button(action: onEdit) { Image(systemName: "pencil").font(.system(size: 13)).foregroundStyle(Nuru.muted) }
                    .buttonStyle(.plain)
                Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(Color(hex: 0xDC2626)) }
                    .buttonStyle(.plain)
            }
            .frame(width: CongCol.actions, alignment: .trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 11)
        .frame(minHeight: 56)
    }
}

// Small labelled stat — a number over a tiny overline caption (right-aligned).
private struct CongStat: View {
    let value: Int
    let label: String
    var body: some View {
        VStack(alignment: .trailing, spacing: 0) {
            Text("\(value)").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
            Text(label).font(.inter(9, .medium)).tracking(0.3).foregroundStyle(Nuru.muted)
                .textCase(.uppercase).lineLimit(1).minimumScaleFactor(0.8)
        }
    }
}
