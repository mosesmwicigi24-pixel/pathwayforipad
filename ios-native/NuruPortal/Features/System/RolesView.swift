// Roles & Permissions — System page, a SwiftUI port of the web admin portal's
// Roles.tsx (packages/admin-web/src/components/pages/Roles.tsx). Navy hero, a
// "Key roles in the pathway" grid of access tiers, a searchable list of all
// configured roles (name/key, type, permission count, users, status), and an
// editable PERMISSIONS matrix (17 modules × 6 capabilities).
//
// Fully wired to the RBAC role API, mirroring SystemApi in api/client.ts:
//   • Create role      → POST   /admin/roles                  { name, role_type, description, copy_from }
//   • Edit role        → PUT    /admin/roles/{key}            { name, role_type, description }
//   • Delete role      → DELETE /admin/roles/{key}            (confirm alert; built-ins blocked)
//   • Save permissions → PUT    /admin/roles/{key}/permissions { permissions: [{ module_id, capability }] }
// The matrix checkboxes toggle locally and Save persists; every write refreshes
// the list. The shared SystemRole model does NOT carry `permissions`/`is_system`,
// so this page decodes a local LocalRole that includes them.
import SwiftUI

struct RolesView: View {
    @EnvironmentObject private var router: NavRouter
    @State private var query = ""
    @State private var openRole: LocalRole?
    @State private var editRole: LocalRole?
    @State private var createOpen = false
    @State private var pendingDelete: LocalRole?
    @State private var actionError: String?
    @State private var reloadToken = 0

    var body: some View {
        AsyncView({ try await APIClient.shared.get("/admin/roles", as: LocalRolesPage.self) }) { page in
            content(page.data)
        }
        .id(reloadToken)
        .portalPage("Roles & Permissions")
        .sheet(item: $openRole) { role in
            PermissionsMatrixSheet(role: role) { refresh() }
        }
        .sheet(item: $editRole) { role in
            RoleForm(mode: .edit(role), allRoles: [], onSaved: { _ in refresh() })
        }
        .sheet(isPresented: $createOpen) {
            RoleForm(mode: .create, allRoles: createRoles, onSaved: { key in
                createOpen = false
                refresh()
                // Open the new role's matrix so the user can fine-tune it (web onCreated).
                Task {
                    if let created = try? await APIClient.shared.get("/admin/roles", as: LocalRolesPage.self).data.first(where: { $0.roleKey == key }) {
                        openRole = created
                    }
                }
            })
        }
        .alert("Delete role", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                if let r = pendingDelete { delete(r) }
                pendingDelete = nil
            }
        } message: {
            Text("Delete the role \"\(pendingDelete?.name ?? "")\"? This cannot be undone.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    // The web Create modal lists every role except super_admin as a "copy from" source.
    @State private var createRoles: [LocalRole] = []

    @ViewBuilder
    private func content(_ roles: [LocalRole]) -> some View {
        let filtered = roles.filter { query.isEmpty || "\($0.name) \($0.roleKey)".lowercased().contains(query.lowercased()) }
        let keyRoles = roles.filter { RolePerm.keyIcons[$0.roleKey] != nil }.prefix(6)

        ScrollView {
            VStack(spacing: 0) {
                hero

                VStack(alignment: .leading, spacing: Nuru.S.lg) {
                    if !keyRoles.isEmpty {
                        VStack(alignment: .leading, spacing: 14) {
                            SectionHeader(overline: "Access tiers", title: "Key roles in the pathway")
                            VStack(spacing: 10) {
                                ForEach(Array(keyRoles)) { KeyRoleCard(role: $0) }
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 12) {
                        HStack(alignment: .bottom) {
                            SectionHeader(overline: "All roles", title: "Configured roles")
                            Spacer(minLength: 12)
                            searchField.frame(maxWidth: 240)
                        }

                        if filtered.isEmpty {
                            Text("No roles match.")
                                .font(.inter(14)).foregroundStyle(Nuru.ink600)
                                .frame(maxWidth: .infinity).padding(.vertical, 48)
                                .background(Nuru.white)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        } else {
                            VStack(spacing: 10) {
                                ForEach(filtered) { role in
                                    RoleRowCard(
                                        role: role,
                                        onOpen: { openRole = role },
                                        onEdit: { editRole = role },
                                        onDelete: { if !role.isSystem { pendingDelete = role } }
                                    )
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, Nuru.S.screen)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, Nuru.S.xxl)
            }
        }
        .onAppear { createRoles = roles }
    }

    private var hero: some View {
        PortalHero(
            breadcrumb: ["System", "Roles & Permissions"],
            eyebrow: "Access control",
            title: "Roles & Permissions",
            subtitle: "Define what each kind of user can do. Super Admin has full access; field and staff roles are scoped."
        ) {
            HeroChip(label: "Create role", icon: "plus", style: .gold) { createOpen = true }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
            TextField("Search roles…", text: $query)
                .font(.inter(13)).foregroundStyle(Nuru.ink)
                .textInputAutocapitalization(.never).autocorrectionDisabled()
        }
        .padding(.horizontal, 12).frame(height: 38)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Writes

    private func refresh() { reloadToken &+= 1 }

    private func delete(_ role: LocalRole) {
        guard !role.isSystem else { return }
        Task {
            do { try await RolesAPI.delete(role.roleKey); refresh() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Delete failed." }
        }
    }
}

// MARK: - Write API (mirrors SystemApi.createRole / updateRole / setRolePermissions / deleteRole)

private struct RoleOk: Codable {}

private enum RolesAPI {
    struct CreateBody: Encodable {
        let name: String
        let roleType: String
        let description: String
        let copyFrom: String?
        enum CodingKeys: String, CodingKey { case name, roleType, description, copyFrom }
    }
    struct UpdateBody: Encodable {
        let name: String
        let roleType: String
        let description: String
    }
    struct PermItem: Encodable { let moduleId: String; let capability: String }
    struct PermsBody: Encodable { let permissions: [PermItem] }

    static func create(_ body: CreateBody) async throws -> String {
        struct Created: Codable { @DefaultEmpty var roleKey: String }
        return try await APIClient.shared.post("/admin/roles", body: body, as: Created.self).roleKey
    }
    static func update(_ key: String, _ body: UpdateBody) async throws {
        _ = try await APIClient.shared.put("/admin/roles/\(key)", body: body, as: RoleOk.self)
    }
    static func setPermissions(_ key: String, _ perms: [PermItem]) async throws {
        _ = try await APIClient.shared.put("/admin/roles/\(key)/permissions", body: PermsBody(permissions: perms), as: RoleOk.self)
    }
    static func delete(_ key: String) async throws {
        _ = try await APIClient.shared.delete("/admin/roles/\(key)", as: RoleOk.self)
    }
}

// MARK: - Page-local model (SystemRole + permissions, is_system, status, user_count)

struct LocalRolesPage: Codable { let data: [LocalRole] }

struct LocalRole: Codable, Identifiable {
    @DefaultEmpty var roleKey: String
    @DefaultEmpty var name: String
    @DefaultEmpty var roleType: String          // "system" | "staff" | "field"
    @DefaultEmpty var description: String
    @DefaultEmpty var status: String
    @DefaultZero var userCount: Int
    @DefaultFalse var isSystem: Bool
    @DefaultEmptyList var permissions: [LocalPerm]
    var id: String { roleKey }
}

struct LocalPerm: Codable, Hashable {
    @DefaultEmpty var moduleId: String
    @DefaultEmpty var capability: String        // "view" | "create" | "edit" | "delete" | "approve" | "export"
}

/// Decodes a missing/null array to []. (Local mirror of the Default* wrappers in Defaults.swift.)
@propertyWrapper struct DefaultEmptyList<E: Codable>: Codable {
    var wrappedValue: [E]
    init() { wrappedValue = [] }
    init(from decoder: Decoder) throws {
        wrappedValue = (try? [E](from: decoder)) ?? []
    }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}
extension KeyedDecodingContainer {
    func decode<E>(_ type: DefaultEmptyList<E>.Type, forKey key: Key) throws -> DefaultEmptyList<E> {
        (try? decodeIfPresent(type, forKey: key)) ?? DefaultEmptyList<E>()
    }
}

// MARK: - Matrix definition (mirrors web PERM_MODULES / CAPABILITIES)

enum RolePerm {
    struct Module: Identifiable { let id: String; let label: String; let group: String }
    static let modules: [Module] = [
        Module(id: "dashboard",     label: "Dashboard & analytics", group: "Portal"),
        Module(id: "levels",        label: "Curriculum Levels",     group: "Curriculum"),
        Module(id: "cms",           label: "Modules (CMS)",         group: "Curriculum"),
        Module(id: "quiz",          label: "Quiz Builder",          group: "Curriculum"),
        Module(id: "videos",        label: "Video Library",         group: "Curriculum"),
        Module(id: "cells",         label: "Cell Engagement",       group: "Operations"),
        Module(id: "members",       label: "Members",               group: "Operations"),
        Module(id: "reflections",   label: "Reflection Queue",      group: "Operations"),
        Module(id: "events",        label: "Events & Attendance",   group: "Operations"),
        Module(id: "finance",       label: "Finance",               group: "Operations"),
        Module(id: "certificates",  label: "Certificates",          group: "Operations"),
        Module(id: "badges",        label: "Badges",                group: "Operations"),
        Module(id: "users",         label: "Users",                 group: "System"),
        Module(id: "rolesAdmin",    label: "Roles & Permissions",   group: "System"),
        Module(id: "countries",     label: "Countries",             group: "System"),
        Module(id: "languages",     label: "Languages",             group: "System"),
        Module(id: "congregations", label: "Congregations",         group: "System"),
    ]
    struct Capability: Identifiable { let key: String; let label: String; var id: String { key } }
    static let capabilities: [Capability] = [
        Capability(key: "view", label: "View"), Capability(key: "create", label: "Create"),
        Capability(key: "edit", label: "Edit"), Capability(key: "delete", label: "Delete"),
        Capability(key: "approve", label: "Approve"), Capability(key: "export", label: "Export"),
    ]
    static var groups: [String] {
        var seen = Set<String>(); var out: [String] = []
        for m in modules where !seen.contains(m.group) { seen.insert(m.group); out.append(m.group) }
        return out
    }

    // role_type → table chip tones (web roleChip)
    static func typeChip(_ t: String) -> (bg: Color, fg: Color) {
        switch t {
        case "system": return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F))
        case "staff":  return (Color(hex: 0xEEF1F8), Color(hex: 0x1F3A6B))
        default:       return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33))
        }
    }

    // Icon set keyed by role_key for the "Key roles" cards (web KEY_ICONS).
    struct IconTone { let icon: String; let tone: Color; let bg: Color }
    static let keyIcons: [String: IconTone] = [
        "super_admin":        IconTone(icon: "exclamationmark.shield.fill", tone: Color(hex: 0xA8281F), bg: Color(hex: 0xFDECEC)),
        "national_director":  IconTone(icon: "globe",                       tone: Color(hex: 0x1F3A6B), bg: Color(hex: 0xEEF1F8)),
        "regional_coach":     IconTone(icon: "person.3.fill",               tone: Color(hex: 0x7C3AED), bg: Color(hex: 0xF3E8FF)),
        "curriculum_editor":  IconTone(icon: "book.closed.fill",            tone: Color(hex: 0x8A6B1F), bg: Color(hex: 0xFDF5E5)),
        "pastoral_reviewer":  IconTone(icon: "hands.sparkles.fill",         tone: Color(hex: 0x0F6B33), bg: Color(hex: 0xE8F6EE)),
        "discipler":          IconTone(icon: "checkmark.shield.fill",       tone: Color(hex: 0x0B7285), bg: Color(hex: 0xE0F2F4)),
    ]
    // role_type fallback icon (web typeIcon)
    static func typeIcon(_ t: String) -> IconTone {
        switch t {
        case "system": return IconTone(icon: "exclamationmark.shield.fill", tone: Color(hex: 0xA8281F), bg: Color(hex: 0xFDECEC))
        case "staff":  return IconTone(icon: "book.closed.fill",            tone: Color(hex: 0x8A6B1F), bg: Color(hex: 0xFDF5E5))
        default:       return IconTone(icon: "checkmark.shield.fill",       tone: Color(hex: 0x0B7285), bg: Color(hex: 0xE0F2F4))
        }
    }
}

// MARK: - Key role card (icon chip + name + description)

private struct KeyRoleCard: View {
    let role: LocalRole
    var body: some View {
        let ic = RolePerm.keyIcons[role.roleKey] ?? RolePerm.typeIcon(role.roleType)
        Card {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(ic.bg)
                    Image(systemName: ic.icon).font(.system(size: 16, weight: .semibold)).foregroundStyle(ic.tone)
                }.frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(role.name).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                    Text(role.description).font(.nCaption).foregroundStyle(Nuru.ink600)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
    }
}

// MARK: - Role row card (name/key, type, perms, users, status, edit/delete)

private struct RoleRowCard: View {
    let role: LocalRole
    let onOpen: () -> Void
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(role.name).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                        Text(role.roleKey).font(.system(size: 11.5, design: .monospaced)).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 8)
                    typePill
                }

                HStack(spacing: 10) {
                    statusPill
                    Spacer(minLength: 0)
                    HStack(spacing: 4) {
                        Image(systemName: "person.2.fill").font(.system(size: 10)).foregroundStyle(Nuru.ink400)
                        Text("\(role.userCount) users").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                }

                Button(action: onOpen) {
                    HStack(spacing: 6) {
                        Image(systemName: "shield.lefthalf.filled").font(.system(size: 12, weight: .semibold))
                        Text("\(role.permissions.count) permissions").font(.inter(12, .semibold))
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
                    }
                    .foregroundStyle(Nuru.gold)
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .background(Nuru.gold.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                }
                .buttonStyle(.plain)

                // Edit / Delete actions (web row buttons).
                HStack(spacing: 8) {
                    Button(action: onEdit) {
                        HStack(spacing: 5) {
                            Image(systemName: "pencil").font(.system(size: 12, weight: .semibold))
                            Text("Edit").font(.inter(12, .semibold))
                        }
                        .foregroundStyle(Nuru.navy)
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background(Nuru.navy.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    Spacer(minLength: 0)

                    Button(action: onDelete) {
                        HStack(spacing: 5) {
                            Image(systemName: "trash").font(.system(size: 12, weight: .semibold))
                            Text(role.isSystem ? "Built-in" : "Delete").font(.inter(12, .semibold))
                        }
                        .foregroundStyle(role.isSystem ? Nuru.ink400 : Color(hex: 0xDC2626))
                        .padding(.horizontal, 11).padding(.vertical, 7)
                        .background((role.isSystem ? Nuru.ink400 : Color(hex: 0xDC2626)).opacity(0.10))
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(role.isSystem)
                }
            }
        }
    }

    private var typePill: some View {
        let tone = RolePerm.typeChip(role.roleType)
        return Text(role.roleType.capitalized)
            .font(.inter(11, .semibold)).foregroundStyle(tone.fg)
            .padding(.horizontal, 9).padding(.vertical, 3)
            .background(tone.bg).clipShape(Capsule())
    }

    private var statusPill: some View {
        let active = role.status == "active"
        let bg = active ? Color(hex: 0xE8F6EE) : Color(hex: 0xF3F4F6)
        let fg = active ? Color(hex: 0x0F6B33) : Color(hex: 0x6B7280)
        return HStack(spacing: 5) {
            Circle().fill(fg).frame(width: 6, height: 6)
            Text(role.status.capitalized).font(.inter(11, .semibold)).foregroundStyle(fg)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(bg).clipShape(Capsule())
    }
}

// MARK: - Create / Edit role form (web CreateRoleModal + the edit path)

private struct RoleForm: View {
    enum Mode { case create, edit(LocalRole) }
    let mode: Mode
    let allRoles: [LocalRole]            // copy-from sources (create only)
    var onSaved: (String) -> Void = { _ in }   // create passes the new key
    @Environment(\.dismiss) private var dismiss

    private var isEdit: Bool { if case .edit = mode { return true }; return false }
    private var existing: LocalRole? { if case .edit(let r) = mode { return r }; return nil }

    @State private var name = ""
    @State private var roleType = "staff"
    @State private var description = ""
    @State private var copyFrom = ""
    @State private var saving = false
    @State private var error: String?

    private var slug: String {
        let lowered = name.trimmingCharacters(in: .whitespaces).lowercased()
        let mapped = lowered.map { ($0.isLetter || $0.isNumber) ? $0 : "_" }
        var s = String(mapped)
        while s.contains("__") { s = s.replacingOccurrences(of: "__", with: "_") }
        return s.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                SwiftUI.Section {
                    HStack {
                        Text("Name *").foregroundStyle(Nuru.ink600).frame(width: 110, alignment: .leading)
                        TextField("e.g. Cell Coordinator", text: $name)
                    }
                    if !isEdit, !slug.isEmpty {
                        HStack {
                            Text("Key").foregroundStyle(Nuru.ink600).frame(width: 110, alignment: .leading)
                            Text(slug).font(.system(size: 13, design: .monospaced)).foregroundStyle(Nuru.navy)
                        }
                    }
                    Picker("Type", selection: $roleType) {
                        Text("Staff — office / ministry").tag("staff")
                        Text("Field — front-line disciple-maker").tag("field")
                        if existing?.roleType == "system" { Text("System").tag("system") }
                    }
                } header: {
                    Text(isEdit ? "Role" : "New role")
                }

                SwiftUI.Section("Description") {
                    TextEditor(text: $description).frame(minHeight: 72).font(.inter(14))
                }

                if !isEdit {
                    SwiftUI.Section {
                        Picker("Starting permissions", selection: $copyFrom) {
                            Text("Blank — no permissions").tag("")
                            ForEach(allRoles.filter { $0.roleKey != "super_admin" }) { r in
                                Text("Copy from: \(r.name)").tag(r.roleKey)
                            }
                        }
                    } footer: {
                        Text("You can adjust every capability in the permissions matrix next.")
                    }
                }
            }
            .navigationTitle(isEdit ? "Edit role" : "Create role")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEdit ? "Save" : "Create") { Task { await submit() } }.disabled(saving)
                }
            }
            .task {
                if let r = existing { name = r.name; roleType = r.roleType; description = r.description }
            }
        }
    }

    private func submit() async {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { error = "Please enter a role name."; return }
        saving = true; error = nil
        let desc = description.trimmingCharacters(in: .whitespaces).isEmpty ? "Custom role." : description.trimmingCharacters(in: .whitespaces)
        do {
            if let r = existing {
                try await RolesAPI.update(r.roleKey, .init(name: n, roleType: roleType, description: desc))
                saving = false; onSaved(r.roleKey); dismiss()
            } else {
                let key = try await RolesAPI.create(.init(name: n, roleType: roleType, description: desc, copyFrom: copyFrom.isEmpty ? nil : copyFrom))
                saving = false; onSaved(key); dismiss()
            }
        } catch {
            saving = false
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
        }
    }
}

// MARK: - Permissions matrix sheet (module × capability — editable + Save)

private struct PermissionsMatrixSheet: View {
    let role: LocalRole
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var locked: Bool { role.roleKey == "super_admin" }
    private var capacity: Int { RolePerm.modules.count * RolePerm.capabilities.count }

    @State private var working: Set<String> = []        // "moduleId|capability"
    @State private var saving = false
    @State private var error: String?

    private func cellKey(_ mod: String, _ cap: String) -> String { "\(mod)|\(cap)" }
    private var total: Int { working.count }

    var body: some View {
        VStack(spacing: 0) {
            header
            if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger).padding(.horizontal, 22).padding(.top, 8) }
            ScrollView([.vertical, .horizontal]) {
                matrix.padding(.horizontal, 18).padding(.vertical, 14)
            }
            .background(Nuru.paper)
            footer
        }
        .background(Nuru.paper)
        .onAppear { working = Set(role.permissions.map { cellKey($0.moduleId, $0.capability) }) }
    }

    // MARK: Toggles (web setCell / toggleRow / toggleColumn)

    private func toggleCell(_ mod: String, _ cap: String) {
        guard !locked else { return }
        let k = cellKey(mod, cap)
        if working.contains(k) { working.remove(k) } else { working.insert(k) }
    }
    private func toggleRow(_ mod: String) {
        guard !locked else { return }
        let allOn = RolePerm.capabilities.allSatisfy { working.contains(cellKey(mod, $0.key)) }
        for c in RolePerm.capabilities {
            let k = cellKey(mod, c.key)
            if allOn { working.remove(k) } else { working.insert(k) }
        }
    }
    private func toggleColumn(_ cap: String) {
        guard !locked else { return }
        let allOn = RolePerm.modules.allSatisfy { working.contains(cellKey($0.id, cap)) }
        for m in RolePerm.modules {
            let k = cellKey(m.id, cap)
            if allOn { working.remove(k) } else { working.insert(k) }
        }
    }

    private func save() {
        guard !locked else { return }
        saving = true; error = nil
        let perms: [RolesAPI.PermItem] = RolePerm.modules.flatMap { m in
            RolePerm.capabilities.compactMap { c in
                working.contains(cellKey(m.id, c.key)) ? RolesAPI.PermItem(moduleId: m.id, capability: c.key) : nil
            }
        }
        Task {
            do { try await RolesAPI.setPermissions(role.roleKey, perms); saving = false; onSaved(); dismiss() }
            catch {
                saving = false
                self.error = (error as? APIError)?.errorDescription ?? "Save failed."
            }
        }
    }

    // Navy drawer header (web PermissionsDrawer head)
    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 6) {
                        Image(systemName: "shield.lefthalf.filled").font(.system(size: 12, weight: .semibold))
                        Text("PERMISSIONS").font(.inter(11, .bold)).tracking(0.5)
                    }.foregroundStyle(Nuru.goldGlow)
                    Text(role.name).font(.fraunces(22, .semibold)).foregroundStyle(.white)
                    HStack(spacing: 6) {
                        Text(role.roleKey).font(.system(size: 12, design: .monospaced))
                        Text("· \(total) of \(capacity) capabilities").font(.inter(12))
                    }.foregroundStyle(Nuru.onNavyDim)
                }
                Spacer(minLength: 0)
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 14, weight: .semibold)).foregroundStyle(.white)
                        .padding(8).background(Color.white.opacity(0.1)).clipShape(RoundedRectangle(cornerRadius: 8))
                }
            }
            if locked {
                HStack(spacing: 6) {
                    Image(systemName: "lock.fill").font(.system(size: 11))
                    Text("Super Admin always has full access and cannot be restricted.")
                        .font(.inter(11.5, .semibold))
                }
                .foregroundStyle(Nuru.goldGlow)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(Nuru.gold.opacity(0.14))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.top, 12)
            }
        }
        .padding(.horizontal, 22).padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navy)
    }

    private var matrix: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Column header row — tapping a capability label toggles the whole column.
            HStack(spacing: 0) {
                Text("MODULE").font(.inter(10.5, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    .frame(width: 190, alignment: .leading).padding(.vertical, 8)
                ForEach(RolePerm.capabilities) { cap in
                    Button { toggleColumn(cap.key) } label: {
                        Text(cap.label.uppercased()).font(.inter(10.5, .bold)).tracking(0.3).foregroundStyle(Nuru.navy)
                            .frame(width: 60).padding(.vertical, 8)
                    }
                    .buttonStyle(.plain).disabled(locked)
                }
            }

            ForEach(RolePerm.groups, id: \.self) { group in
                Text(group.uppercased())
                    .font(.inter(11.5, .semibold)).tracking(1.4).foregroundStyle(Nuru.goldLo)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12).padding(.bottom, 5).padding(.horizontal, 0)

                ForEach(RolePerm.modules.filter { $0.group == group }) { mod in
                    HStack(spacing: 0) {
                        // Tapping the module label toggles the whole row.
                        Button { toggleRow(mod.id) } label: {
                            Text(mod.label).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                .frame(width: 190, alignment: .leading).padding(.vertical, 8)
                        }
                        .buttonStyle(.plain).disabled(locked)
                        ForEach(RolePerm.capabilities) { cap in
                            Button { toggleCell(mod.id, cap.key) } label: {
                                MatrixBox(on: working.contains(cellKey(mod.id, cap.key)))
                                    .frame(width: 60).padding(.vertical, 6)
                            }
                            .buttonStyle(.plain).disabled(locked)
                        }
                    }
                    .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .top)
                }
            }
        }
    }

    // Footer: Reset (restore from server) + Cancel + Save.
    private var footer: some View {
        HStack(spacing: 10) {
            Button {
                working = Set(role.permissions.map { cellKey($0.moduleId, $0.capability) })
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.counterclockwise").font(.system(size: 12, weight: .semibold))
                    Text("Reset").font(.inter(12.5, .semibold))
                }.foregroundStyle(Nuru.ink600)
            }
            .buttonStyle(.plain).disabled(locked)

            Spacer(minLength: 0)

            Button("Cancel") { dismiss() }
                .font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                .padding(.horizontal, 16).padding(.vertical, 9)
                .background(Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))

            Button { save() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
                    Text("Save changes").font(.inter(13, .semibold))
                }
                .foregroundStyle(locked ? Nuru.ink400 : .white)
                .padding(.horizontal, 18).padding(.vertical, 9)
                .background(locked ? Nuru.inputBg : Nuru.gold)
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            .buttonStyle(.plain).disabled(locked || saving)
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
        .frame(maxWidth: .infinity)
        .background(Nuru.surface)
        .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .top)
    }
}

// MARK: - Matrix cell (green when granted, hollow when not — web Box)

private struct MatrixBox: View {
    let on: Bool
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(on ? Color(hex: 0x16A34A) : Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(on ? Color(hex: 0x16A34A) : Nuru.border, lineWidth: 1.5))
            if on { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
        }
        .frame(width: 22, height: 22)
    }
}
