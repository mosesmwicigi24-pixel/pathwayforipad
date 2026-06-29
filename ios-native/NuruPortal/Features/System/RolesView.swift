// Roles & Permissions — System page, a SwiftUI port of the web admin portal's
// Roles.tsx (packages/admin-web/src/components/pages/Roles.tsx). Read view over
// the RBAC role API (/admin/roles): navy hero, a "Key roles in the pathway" grid
// of access tiers, a searchable table of all configured roles (name/key, type,
// permission count, users, status), and a PERMISSIONS matrix drawer (16 modules ×
// 6 capabilities) showing exactly which capabilities each role holds. The web
// page's create/edit/save mutations are out of scope here — this is the read
// surface, so the matrix is presented read-only.
//
// The shared SystemRole model does NOT carry `permissions`, so this page defines
// a page-local LocalRolesPage/LocalRole that includes them and fetches via
// APIClient.shared.get("/admin/roles", as:). The decoder is convertFromSnakeCase,
// so camelCase property names map from the snake_case wire fields.
import SwiftUI

struct RolesView: View {
    @State private var query = ""
    @State private var openRole: LocalRole?

    var body: some View {
        AsyncView({ try await APIClient.shared.get("/admin/roles", as: LocalRolesPage.self) }) { page in
            content(page.data)
        }
        .portalPage("Roles & Permissions")
        .sheet(item: $openRole) { role in
            PermissionsMatrixSheet(role: role)
        }
    }

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
                                    RoleRowCard(role: role) { openRole = role }
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

    private var hero: some View {
        PortalHero(
            breadcrumb: ["System", "Roles & Permissions"],
            eyebrow: "Access control",
            title: "Roles & Permissions",
            subtitle: "Define what each kind of user can do. Super Admin has full access; field and staff roles are scoped."
        ) {
            HeroChip(label: "Create role", icon: "plus", style: .gold)
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

// MARK: - Role row card (table row → card: name/key, type, perms, users, status)

private struct RoleRowCard: View {
    let role: LocalRole
    let onOpen: () -> Void

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

// MARK: - Permissions matrix sheet (module × capability, read-only)

private struct PermissionsMatrixSheet: View {
    let role: LocalRole

    private var locked: Bool { role.roleKey == "super_admin" }
    private var granted: Set<String> {       // "moduleId|capability"
        Set(role.permissions.map { "\($0.moduleId)|\($0.capability)" })
    }
    private var total: Int { granted.count }
    private var capacity: Int { RolePerm.modules.count * RolePerm.capabilities.count }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollView([.vertical, .horizontal]) {
                matrix.padding(.horizontal, 18).padding(.vertical, 14)
            }
            .background(Nuru.paper)
            footer
        }
        .background(Nuru.paper)
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
            // Column header row
            HStack(spacing: 0) {
                Text("MODULE").font(.inter(10.5, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    .frame(width: 190, alignment: .leading).padding(.vertical, 8)
                ForEach(RolePerm.capabilities) { cap in
                    Text(cap.label.uppercased()).font(.inter(10.5, .bold)).tracking(0.3).foregroundStyle(Nuru.navy)
                        .frame(width: 60).padding(.vertical, 8)
                }
            }

            ForEach(RolePerm.groups, id: \.self) { group in
                Text(group.uppercased())
                    .font(.inter(11.5, .semibold)).tracking(1.4).foregroundStyle(Nuru.goldLo)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 12).padding(.bottom, 5).padding(.horizontal, 0)

                ForEach(RolePerm.modules.filter { $0.group == group }) { mod in
                    HStack(spacing: 0) {
                        Text(mod.label).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                            .frame(width: 190, alignment: .leading).padding(.vertical, 8)
                        ForEach(RolePerm.capabilities) { cap in
                            MatrixBox(on: granted.contains("\(mod.id)|\(cap.key)"))
                                .frame(width: 60).padding(.vertical, 6)
                        }
                    }
                    .overlay(Rectangle().fill(Nuru.border).frame(height: 1), alignment: .top)
                }
            }
        }
    }

    // Footer: read-only port — Reset is non-functional, so present a Done-only bar
    // (the web Reset/Cancel/Save buttons drive mutations that aren't in scope).
    private var footer: some View {
        HStack {
            Text("\(total) of \(capacity) capabilities granted")
                .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink600)
            Spacer()
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
