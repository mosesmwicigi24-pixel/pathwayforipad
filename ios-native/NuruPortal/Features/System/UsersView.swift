// Users — System page, a SwiftUI port of the web admin portal's Users.tsx
// (packages/admin-web/src/components/pages/Users.tsx). Navy hero with breadcrumb +
// "Add user" action and a 4-up stat strip (Total / Active / Invited / Roles in
// use), a search + role/status filter bar, and a card per user with avatar, name,
// email, role chips, status pill and last-active.
//
// This view is fully wired to the RBAC user API, mirroring SystemApi in
// api/client.ts line-for-line:
//   • Add user    → POST   /admin/users          (UsersAPI.create)
//   • Edit user   → PUT    /admin/users/{id}      (UsersAPI.update)
//   • Suspend/Re. → PUT    /admin/users/{id}      ({ account_status })
//   • Delete user → DELETE /admin/users/{id}      (UsersAPI.delete, confirm alert)
// Roles for the assignment chips + filter come from PortalAPI.roles(); countries
// and languages drive the selects. Every write refreshes the list afterwards.
import SwiftUI

struct UsersView: View {
    @EnvironmentObject private var router: NavRouter
    @State private var query = ""
    @State private var roleFilter = "All"      // "All" or a role_key
    @State private var statusFilter = "All"    // "All" | "active" | "invited" | "suspended"

    // Write surface state
    @State private var reloadToken = 0          // bump → AsyncView re-fetches
    @State private var formTarget: UserForm.Target?
    @State private var pendingDelete: SystemUser?
    @State private var actionError: String?

    var body: some View {
        AsyncView({ try await UsersLoad.fetch() }) { bundle in
            content(bundle)
        }
        .id(reloadToken)
        .portalPage("Users")
        .sheet(item: $formTarget) { target in
            UserForm(target: target) { refresh() }
        }
        .alert("Delete user", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) {
                if let u = pendingDelete { delete(u) }
                pendingDelete = nil
            }
        } message: {
            Text("Delete \(pendingDelete?.fullName ?? "this user")? This cannot be undone.")
        }
        .alert("Something went wrong", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    @ViewBuilder
    private func content(_ bundle: UsersLoad.Bundle) -> some View {
        let users = bundle.users
        let roles = bundle.roles
        let stats = UserStats(users)
        let filtered = filter(users, roles: roles)
        let roleOrder = ["All"] + roles.map(\.roleKey)
        let statusOrder = ["All", "active", "invited", "suspended"]

        ScrollView {
            VStack(spacing: 0) {
                hero(stats: stats, bundle: bundle)

                VStack(alignment: .leading, spacing: 16) {
                    filterBar(roles: roles, roleOrder: roleOrder, statusOrder: statusOrder)

                    if filtered.isEmpty {
                        emptyState
                    } else {
                        Card(padding: 0) {
                            VStack(spacing: 0) {
                                UserHeaderRow()
                                ForEach(Array(filtered.enumerated()), id: \.element.id) { idx, u in
                                    if idx > 0 { Divider().overlay(Nuru.border) }
                                    UserTableRow(
                                        user: u, index: idx, roles: roles,
                                        onEdit: { formTarget = .edit(u, roles: roles, countries: bundle.countries, languages: bundle.languages) },
                                        onToggleSuspend: { toggleSuspend(u) },
                                        onDelete: { pendingDelete = u }
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
    }

    // MARK: Hero (navy banner + breadcrumb + action + stat strip)

    private func hero(stats: UserStats, bundle: UsersLoad.Bundle) -> some View {
        PortalHero(
            breadcrumb: ["System", "Users"],
            eyebrow: "Access & accounts",
            title: "System Users",
            subtitle: "People who can sign in to the admin portal. Assign each a role, country and language.",
            stats: [
                HeroStat(label: "Total users", value: "\(stats.total)", hint: "with portal access"),
                HeroStat(label: "Active", value: "\(stats.active)", hint: "signed-in capable"),
                HeroStat(label: "Invited", value: "\(stats.invited)", hint: "awaiting first login"),
                HeroStat(label: "Roles in use", value: "\(stats.roles)", hint: "distinct assignments"),
            ]
        ) {
            HeroChip(label: "Add user", icon: "plus", style: .gold) {
                formTarget = .create(roles: bundle.roles, countries: bundle.countries, languages: bundle.languages)
            }
        }
    }

    // MARK: Filter bar (search + role/status cycling pills)

    private func filterBar(roles: [SystemRole], roleOrder: [String], statusOrder: [String]) -> some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").font(.system(size: 14)).foregroundStyle(Nuru.ink400)
                TextField("Search by name, email, or role…", text: $query)
                    .font(.inter(13)).foregroundStyle(Nuru.ink)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            HStack(spacing: 8) {
                FilterPill(label: "Role: \(roleLabel(roleFilter, roles: roles))") {
                    roleFilter = cycle(roleFilter, roleOrder)
                }
                FilterPill(label: "Status: \(statusLabel(statusFilter))") {
                    statusFilter = cycle(statusFilter, statusOrder)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(14)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var emptyState: some View {
        Text("No users match those filters.")
            .font(.inter(14)).foregroundStyle(Nuru.ink600)
            .frame(maxWidth: .infinity).padding(.vertical, 48)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Writes (mirror web toggleSuspend / remove)

    private func refresh() { reloadToken &+= 1 }

    private func toggleSuspend(_ u: SystemUser) {
        let next = u.accountStatus == "suspended" ? "active" : "suspended"
        Task {
            do { try await UsersAPI.update(u.userId, ["account_status": .string(next)]); refresh() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Update failed." }
        }
    }

    private func delete(_ u: SystemUser) {
        Task {
            do { try await UsersAPI.delete(u.userId); refresh() }
            catch { actionError = (error as? APIError)?.errorDescription ?? "Delete failed." }
        }
    }

    // MARK: Filtering / labels

    private func filter(_ users: [SystemUser], roles: [SystemRole]) -> [SystemUser] {
        users.filter { u in
            let haystack = "\(u.fullName) \(u.email ?? "") \(u.roleKeys.map { roleName($0, roles: roles) }.joined(separator: " "))".lowercased()
            let matchQ = query.isEmpty || haystack.contains(query.lowercased())
            let matchR = roleFilter == "All" || u.roleKeys.contains(roleFilter)
            let matchS = statusFilter == "All" || u.accountStatus == statusFilter
            return matchQ && matchR && matchS
        }
    }

    private func cycle(_ current: String, _ order: [String]) -> String {
        guard let i = order.firstIndex(of: current) else { return order.first ?? "All" }
        return order[(i + 1) % order.count]
    }
    private func roleName(_ key: String, roles: [SystemRole]) -> String {
        roles.first { $0.roleKey == key }?.name ?? key
    }
    private func roleLabel(_ key: String, roles: [SystemRole]) -> String {
        key == "All" ? "All" : roleName(key, roles: roles)
    }
    private func statusLabel(_ s: String) -> String {
        switch s {
        case "All": return "All"
        case "active": return "Active"
        case "invited": return "Invited"
        case "suspended": return "Suspended"
        default: return s.capitalized
        }
    }
}

// MARK: - Conditional JSON body (omit absent keys, mirroring the web spread)

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

// A role_keys array body fragment (encodes a [String] under arbitrary dict keys).
private enum JSONBodyValue: Encodable {
    case scalar(JSONValue)
    case strings([String])
    func encode(to encoder: Encoder) throws {
        switch self {
        case .scalar(let v): try v.encode(to: encoder)
        case .strings(let arr):
            var c = encoder.unkeyedContainer()
            for s in arr { try c.encode(s) }
        }
    }
}

// MARK: - Write API (mirrors SystemApi.createUser / updateUser / deleteUser)

private struct UserOk: Codable {}

private enum UsersAPI {
    static func create(_ body: [String: JSONBodyValue]) async throws {
        _ = try await APIClient.shared.post("/admin/users", body: body, as: UserOk.self)
    }
    static func update(_ id: String, _ body: [String: JSONBodyValue]) async throws {
        _ = try await APIClient.shared.put("/admin/users/\(id)", body: body, as: UserOk.self)
    }
    // Convenience for scalar-only patches like the suspend toggle.
    static func update(_ id: String, _ scalars: [String: JSONValue]) async throws {
        try await update(id, scalars.mapValues { JSONBodyValue.scalar($0) })
    }
    static func delete(_ id: String) async throws {
        _ = try await APIClient.shared.delete("/admin/users/\(id)", as: UserOk.self)
    }
}

// MARK: - Page-local decode of the extra user fields the shared SystemUser drops
// (country_code, locale, require_2fa, discipler_message, avatar_url). Fetched on
// demand when an edit form opens so its pickers/toggles start from server truth.

private struct UserExtra: Codable {
    @DefaultEmptyList var data: [Row]
    struct Row: Codable {
        @DefaultEmpty var userId: String
        let countryCode: String?
        let locale: String?
        @DefaultFalse var require2fa: Bool
        let disciplerMessage: String?
        let avatarUrl: String?
    }
}

// MARK: - Aggregated stats (mirrors the web `stats` object)

private struct UserStats {
    let total: Int, active: Int, invited: Int, roles: Int
    init(_ users: [SystemUser]) {
        total = users.count
        active = users.filter { $0.accountStatus == "active" }.count
        invited = users.filter { $0.accountStatus == "invited" }.count
        roles = Set(users.flatMap(\.roleKeys)).count
    }
}

// MARK: - Loader (users + roles + countries + languages, like the web parallel fetch)

private enum UsersLoad {
    struct Bundle { let users: [SystemUser]; let roles: [SystemRole]; let countries: [Country]; let languages: [Language] }
    static func fetch() async throws -> Bundle {
        async let users = PortalAPI.users()
        // Reference data powers chips, filters and the form pickers; tolerate
        // failures like the web (`.catch(() => {})`).
        let roles = (try? await PortalAPI.roles()) ?? []
        let countries = (try? await PortalAPI.countries()) ?? []
        let languages = (try? await PortalAPI.languages()) ?? []
        return Bundle(users: try await users, roles: roles, countries: countries, languages: languages)
    }
}

// MARK: - User table — header row + dense data rows (iPad density pass)
// Columns mirror the prompt spec: User · Email/Phone · Roles · Status · Last active · ⋯
// (the web Users.tsx table). Columns are width-aligned across rows via fixed
// frames so the whole list reads as a real table, not stacked cards.

private enum UserCol {
    static let contact: CGFloat = 240
    static let roles: CGFloat = 220
    static let status: CGFloat = 120
    static let lastActive: CGFloat = 120
    static let actions: CGFloat = 132
}

private struct UserHeaderRow: View {
    var body: some View {
        HStack(spacing: 14) {
            head("User").frame(maxWidth: .infinity, alignment: .leading)
            head("Email / Phone").frame(width: UserCol.contact, alignment: .leading)
            head("Roles").frame(width: UserCol.roles, alignment: .leading)
            head("Status").frame(width: UserCol.status, alignment: .leading)
            head("Last active").frame(width: UserCol.lastActive, alignment: .leading)
            head("").frame(width: UserCol.actions, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .background(Nuru.surface)
    }
    private func head(_ t: String) -> some View {
        Text(t.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.ink600)
    }
}

private struct UserTableRow: View {
    let user: SystemUser
    let index: Int
    let roles: [SystemRole]
    let onEdit: () -> Void
    let onToggleSuspend: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            // User — monogram + name
            HStack(spacing: 11) {
                Monogram(name: user.fullName, size: 36, gradient: Self.avatarGradients[index % Self.avatarGradients.count])
                Text(user.fullName).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Email / Phone
            HStack(spacing: 5) {
                Image(systemName: user.email?.isEmpty == false ? "envelope" : "phone")
                    .font(.system(size: 10)).foregroundStyle(Nuru.ink400)
                Text(displayContact).font(.inter(12.5)).foregroundStyle(Nuru.ink600).lineLimit(1)
            }
            .frame(width: UserCol.contact, alignment: .leading)

            // Roles
            roleChips.frame(width: UserCol.roles, alignment: .leading)

            // Status pill (always shows a label)
            statusPill.frame(width: UserCol.status, alignment: .leading)

            // Last active
            Text(lastActive).font(.inter(12)).foregroundStyle(Nuru.ink600)
                .frame(width: UserCol.lastActive, alignment: .leading)

            // Actions — fixed trailing width
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                IconAction(icon: "pencil", tint: Nuru.navy, action: onEdit)
                IconAction(
                    icon: user.accountStatus == "suspended" ? "checkmark.circle" : "nosign",
                    tint: user.accountStatus == "suspended" ? Color(hex: 0x16A34A) : Color(hex: 0xC2410C),
                    action: onToggleSuspend
                )
                IconAction(icon: "trash", tint: Color(hex: 0xDC2626), action: onDelete)
            }
            .frame(width: UserCol.actions, alignment: .trailing)
        }
        .padding(.horizontal, 18).padding(.vertical, 10)
        .frame(minHeight: 52)
    }

    private var displayContact: String {
        if let e = user.email, !e.isEmpty { return e }
        return user.phoneNumber.isEmpty ? "—" : user.phoneNumber
    }

    @ViewBuilder
    private var roleChips: some View {
        if user.roleKeys.isEmpty {
            Text("No role").font(.nMicro).foregroundStyle(Nuru.ink400)
        } else {
            HStack(spacing: 6) {
                ForEach(user.roleKeys.prefix(2), id: \.self) { key in
                    let tone = roleTone(key)
                    Text(roleName(key))
                        .font(.inter(11, .semibold))
                        .foregroundStyle(tone.fg)
                        .lineLimit(1)
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(tone.bg)
                        .clipShape(Capsule())
                }
                if user.roleKeys.count > 2 {
                    Text("+\(user.roleKeys.count - 2)")
                        .font(.inter(11, .semibold))
                        .foregroundStyle(Nuru.ink600)
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(Nuru.inputBg)
                        .clipShape(Capsule())
                }
            }
        }
    }

    private var statusPill: some View {
        let s = statusStyle
        return HStack(spacing: 5) {
            Circle().fill(s.fg).frame(width: 6, height: 6)
            Text(s.label).font(.inter(11, .semibold)).foregroundStyle(s.fg)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(s.bg)
        .clipShape(Capsule())
    }

    private var lastActive: String { Fmt.date(user.lastActive, style: .dateTime.month(.abbreviated).day()) }

    private func roleName(_ key: String) -> String { roles.first { $0.roleKey == key }?.name ?? key }
    private func roleType(_ key: String) -> String { roles.first { $0.roleKey == key }?.roleType ?? "field" }
    private func roleTone(_ key: String) -> (bg: Color, fg: Color) {
        switch roleType(key) {
        case "system": return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F))
        case "staff":  return (Color(hex: 0xEEF1F8), Color(hex: 0x1F3A6B))
        default:       return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33))
        }
    }

    private var statusStyle: (bg: Color, fg: Color, label: String) {
        switch user.accountStatus {
        case "active":    return (Color(hex: 0xE8F6EE), Color(hex: 0x0F6B33), "Active")
        case "invited":   return (Color(hex: 0xFDF5E5), Color(hex: 0x8A6B1F), "Invited")
        case "suspended": return (Color(hex: 0xFDECEC), Color(hex: 0xA8281F), "Suspended")
        default:          return (Nuru.inputBg, Nuru.ink600, user.accountStatus.capitalized)
        }
    }

    static let avatarGradients: [LinearGradient] = [
        grad(0x0B1F33, 0x1E4068), grad(0xC89B3C, 0x8B6914), grad(0x16A34A, 0x065F46),
        grad(0x7C3AED, 0x4C1D95), grad(0x0EA5E9, 0x075985), grad(0xDC2626, 0x7F1D1D),
    ]
    private static func grad(_ a: UInt32, _ b: UInt32) -> LinearGradient {
        LinearGradient(colors: [Color(hex: a), Color(hex: b)], startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Compact icon action button (fixed footprint for the actions column)

private struct IconAction: View {
    let icon: String
    let tint: Color
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 34, height: 30)
                .background(tint.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Filter pill (cycles its value on tap — web Pill with ChevronDown)

private struct FilterPill: View {
    let label: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink400)
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add / Edit user form (web UserFormModal — create + edit)

private struct UserForm: View {
    enum Target: Identifiable {
        case create(roles: [SystemRole], countries: [Country], languages: [Language])
        case edit(SystemUser, roles: [SystemRole], countries: [Country], languages: [Language])
        var id: String {
            switch self {
            case .create: return "create"
            case .edit(let u, _, _, _): return "edit-\(u.userId)"
            }
        }
        var roles: [SystemRole] { switch self { case .create(let r, _, _), .edit(_, let r, _, _): return r } }
        var countries: [Country] { switch self { case .create(_, let c, _), .edit(_, _, let c, _): return c } }
        var languages: [Language] { switch self { case .create(_, _, let l), .edit(_, _, _, let l): return l } }
    }

    let target: Target
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var isEdit: Bool { if case .edit = target { return true }; return false }
    private var existing: SystemUser? { if case .edit(let u, _, _, _) = target { return u }; return nil }

    @State private var fullName = ""
    @State private var email = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var showPw = false
    @State private var countryCode = ""
    @State private var locale = "en"
    @State private var status = "active"
    @State private var roleKeys: [String] = []
    @State private var require2fa = false
    @State private var disciplerMessage = ""
    @State private var avatarUrl = ""
    @State private var loadedExtras = false
    @State private var saving = false
    @State private var error: String?

    private var isDiscipler: Bool { roleKeys.contains("discipler") || roleKeys.contains("mentor") }

    var body: some View {
        NavigationStack {
            Form {
                if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                identitySection
                accessSection
                rolesSection
                if isDiscipler { disciplerSection }
                securitySection
            }
            .navigationTitle(isEdit ? "Edit user" : "Create user")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEdit ? "Save" : "Create") { Task { await submit() } }.disabled(saving)
                }
            }
            .task { await setup() }
        }
    }

    // MARK: Sections

    @ViewBuilder private var identitySection: some View {
        SwiftUI.Section("Identity") {
            labeled("Full name", required: true) { TextField("Grace Wanjiru", text: $fullName) }
            labeled("Email", required: !isEdit) {
                TextField("name@nuru.org", text: $email)
                    .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .disabled(isEdit)
                    .foregroundStyle(isEdit ? Nuru.ink400 : Nuru.ink)
            }
            labeled("Phone") { TextField("+254 700 000 000", text: $phone).keyboardType(.phonePad) }
        }
    }

    @ViewBuilder private var accessSection: some View {
        SwiftUI.Section("Access") {
            Picker("Status", selection: $status) {
                Text("Active").tag("active"); Text("Invited").tag("invited"); Text("Suspended").tag("suspended")
            }
            Picker("Country", selection: $countryCode) {
                Text("—").tag("")
                ForEach(target.countries) { c in Text("\(c.flag ?? "") \(c.name)").tag(c.code) }
            }
            Picker("Language", selection: $locale) {
                if target.languages.isEmpty { Text(locale).tag(locale) }
                ForEach(target.languages) { l in Text(l.name).tag(l.code) }
            }
        }
    }

    @ViewBuilder private var rolesSection: some View {
        SwiftUI.Section {
            ForEach(target.roles) { r in
                Button {
                    if roleKeys.contains(r.roleKey) { roleKeys.removeAll { $0 == r.roleKey } }
                    else { roleKeys.append(r.roleKey) }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: roleKeys.contains(r.roleKey) ? "checkmark.square.fill" : "square")
                            .font(.system(size: 18))
                            .foregroundStyle(roleKeys.contains(r.roleKey) ? Nuru.gold : Nuru.ink400)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.name).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                            Text(r.roleType.capitalized).font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                        Spacer(minLength: 0)
                    }
                }
                .buttonStyle(.plain)
            }
        } header: {
            Text("Roles *")
        } footer: {
            Text("Assign at least one role. Disciplers also get a profile shown in the mobile carousel.")
        }
    }

    @ViewBuilder private var disciplerSection: some View {
        SwiftUI.Section("Discipler profile") {
            VStack(alignment: .leading, spacing: 6) {
                Text("Message shown in the mobile \"Meet your discipler\" carousel.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600)
                TextEditor(text: $disciplerMessage)
                    .frame(minHeight: 88)
                    .font(.inter(14)).foregroundStyle(Nuru.ink)
                ImageUploadField(label: "Profile photo", folder: "disciplers", url: $avatarUrl)
            }
        }
    }

    @ViewBuilder private var securitySection: some View {
        SwiftUI.Section {
            labeled(isEdit ? "Password" : "Password", required: !isEdit) {
                Group {
                    if showPw { TextField(isEdit ? "Leave blank to keep" : "Min. 8 characters", text: $password) }
                    else { SecureField(isEdit ? "Leave blank to keep" : "Min. 8 characters", text: $password) }
                }
                .textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if !password.isEmpty || !isEdit {
                labeled("Confirm", required: !isEdit) {
                    Group {
                        if showPw { TextField("Re-enter password", text: $confirm) }
                        else { SecureField("Re-enter password", text: $confirm) }
                    }
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            }
            Toggle("Show password", isOn: $showPw)
            Toggle("Require 2FA on next login", isOn: $require2fa)
        } header: {
            Text("Security")
        } footer: {
            Text(isEdit ? "Leave the password blank to keep the current one." : "Set a sign-in password before going live.")
        }
    }

    @ViewBuilder private func labeled<C: View>(_ label: String, required: Bool = false, @ViewBuilder _ field: () -> C) -> some View {
        HStack {
            Text(label + (required ? " *" : "")).foregroundStyle(Nuru.ink600).frame(width: 96, alignment: .leading)
            field()
        }
    }

    // MARK: Setup (prefill from the existing user + on-demand extra fields)

    private func setup() async {
        if locale == "en", let first = target.languages.first(where: { $0.isDefault }) ?? target.languages.first {
            locale = first.code
        }
        guard let u = existing else { loadedExtras = true; return }
        fullName = u.fullName
        email = u.email ?? ""
        phone = u.phoneNumber
        status = u.accountStatus
        roleKeys = u.roleKeys
        // Pull country/locale/2fa/discipler message the shared model drops.
        if let extra = try? await APIClient.shared.get("/admin/users", as: UserExtra.self),
           let row = extra.data.first(where: { $0.userId == u.userId }) {
            countryCode = row.countryCode ?? ""
            if let l = row.locale, !l.isEmpty { locale = l }
            require2fa = row.require2fa
            disciplerMessage = row.disciplerMessage ?? ""
            avatarUrl = row.avatarUrl ?? ""
        }
        loadedExtras = true
    }

    // MARK: Submit (web UserFormModal.submit)

    private func submit() async {
        let name = fullName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { error = "Please enter the full name."; return }
        if !isEdit {
            let e = email.trimmingCharacters(in: .whitespaces)
            guard e.contains("@"), e.contains(".") else { error = "Please enter a valid email address."; return }
        }
        if !isEdit || !password.isEmpty {
            guard password.count >= 8 else { error = "Password must be at least 8 characters."; return }
            guard password == confirm else { error = "Passwords do not match."; return }
        }
        guard !roleKeys.isEmpty else { error = "Assign at least one role."; return }

        saving = true; error = nil
        var body: [String: JSONBodyValue] = [
            "full_name": .scalar(.string(name)),
            "phone_number": .scalar(.string(phone.trimmingCharacters(in: .whitespaces))),
            "country_code": .scalar(countryCode.isEmpty ? .null : .string(countryCode)),
            "locale": .scalar(.string(locale)),
            "account_status": .scalar(.string(status)),
            "require_2fa": .scalar(.bool(require2fa)),
            "role_keys": .strings(roleKeys),
            "discipler_message": .scalar(disciplerMessage.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(disciplerMessage.trimmingCharacters(in: .whitespaces))),
            "avatar_url": .scalar(avatarUrl.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(avatarUrl.trimmingCharacters(in: .whitespaces))),
        ]
        if !password.isEmpty { body["password"] = .scalar(.string(password)) }

        do {
            if let u = existing {
                try await UsersAPI.update(u.userId, body)
            } else {
                body["email"] = .scalar(.string(email.trimmingCharacters(in: .whitespaces)))
                try await UsersAPI.create(body)
            }
            saving = false
            onSaved()
            dismiss()
        } catch {
            saving = false
            self.error = (error as? APIError)?.errorDescription ?? "Save failed."
        }
    }
}
