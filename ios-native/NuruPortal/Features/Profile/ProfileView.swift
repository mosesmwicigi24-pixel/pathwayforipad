// My Profile — the signed-in admin's account settings, ported from the web make
// (admin-web/src/components/pages/Profile.tsx). Header identity card + a
// sidebar/panel layout with Profile, Password, 2FA, Sessions, Preferences and
// My Activity tabs. Password (POST /me/password) and Activity (GET /me/activity)
// are wired to the real endpoints; 2FA/Sessions/Preferences are honest
// client-side surfaces, exactly as the web is.
import SwiftUI

// MARK: - Page-local models (full /me shape: require_2fa, created_at, row_version)

private struct MeFullProfile: Codable {
    var userId = ""
    var email: String?
    var fullName = ""
    var phoneNumber = ""
    var role = ""
    var locale: String?
    var createdAt: String?
    var accountStatus = ""
    var require2fa = false
    var roleKeys: [String] = []
    var rowVersion = 0

    private enum CodingKeys: String, CodingKey {
        case userId, email, fullName, phoneNumber, role, locale, createdAt, accountStatus, require2fa, roleKeys, rowVersion
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        userId = (try? c.decode(String.self, forKey: .userId)) ?? ""
        email = try? c.decodeIfPresent(String.self, forKey: .email)
        fullName = (try? c.decode(String.self, forKey: .fullName)) ?? ""
        phoneNumber = (try? c.decode(String.self, forKey: .phoneNumber)) ?? ""
        role = (try? c.decode(String.self, forKey: .role)) ?? ""
        locale = try? c.decodeIfPresent(String.self, forKey: .locale)
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
        accountStatus = (try? c.decode(String.self, forKey: .accountStatus)) ?? ""
        require2fa = (try? c.decode(Bool.self, forKey: .require2fa)) ?? false
        roleKeys = (try? c.decode([String].self, forKey: .roleKeys)) ?? []
        rowVersion = (try? c.decode(Int.self, forKey: .rowVersion)) ?? 0
    }
}
private struct MeFullResponse: Codable { let profile: MeFullProfile }

private struct ActivityRow: Codable, Identifiable {
    var auditId = 0
    var action = ""
    var entity: String?
    var occurredAt = ""
    var id: Int { auditId }
    private enum CodingKeys: String, CodingKey { case auditId, action, entity, occurredAt }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        auditId = (try? c.decode(Int.self, forKey: .auditId)) ?? 0
        action = (try? c.decode(String.self, forKey: .action)) ?? ""
        entity = try? c.decodeIfPresent(String.self, forKey: .entity)
        occurredAt = (try? c.decode(String.self, forKey: .occurredAt)) ?? ""
    }
}
private struct ActivityResponse: Codable { let data: [ActivityRow] }

// MARK: - Store

@MainActor
private final class ProfileStore: ObservableObject {
    @Published var profile: MeFullProfile?
    @Published var error: String?
    @Published var flash: String?
    private let api = APIClient.shared

    func load() async {
        do { profile = try await api.get("/me", as: MeFullResponse.self).profile; error = nil }
        catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
    }

    struct PwResult: Codable { let changed: Bool? }
    func changePassword(_ current: String, _ next: String) async throws {
        struct Body: Encodable { let currentPassword: String; let newPassword: String }
        _ = try await api.post("/me/password", body: Body(currentPassword: current, newPassword: next), as: PwResult.self)
    }

    func activity() async throws -> [ActivityRow] {
        try await api.get("/me/activity", as: ActivityResponse.self).data
    }

    func showFlash(_ s: String) {
        flash = s
        Task { try? await Task.sleep(nanoseconds: 3_500_000_000); if flash == s { flash = nil } }
    }
}

// MARK: - Helpers

private enum PFmt {
    static func date(_ s: String?) -> String {
        guard let s, !s.isEmpty else { return "—" }
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let g = ISO8601DateFormatter()
        guard let d = f.date(from: s) ?? g.date(from: s) else { return "—" }
        return d.formatted(.dateTime.day().month(.abbreviated).year())
    }
    static func timeAgo(_ s: String) -> String {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let g = ISO8601DateFormatter()
        guard let d = (f.date(from: s) ?? g.date(from: s)) else { return "—" }
        let sec = Int(Date().timeIntervalSince(d))
        if sec < 45 { return "Just now" }
        let m = sec / 60; if m < 60 { return "\(m) min ago" }
        let h = m / 60; if h < 24 { return "\(h)h ago" }
        let day = h / 24; if day < 7 { return "\(day)d ago" }
        return d.formatted(.dateTime.day().month().year())
    }
}

private enum ProfileTab: String, CaseIterable, Identifiable {
    case profile, password, twofa, sessions, preferences, activity
    var id: String { rawValue }
    var label: String {
        switch self { case .profile: "Profile"; case .password: "Password"; case .twofa: "2FA Security"
        case .sessions: "Sessions"; case .preferences: "Preferences"; case .activity: "My Activity" }
    }
    var icon: String {
        switch self { case .profile: "person"; case .password: "lock"; case .twofa: "shield"
        case .sessions: "desktopcomputer"; case .preferences: "slider.horizontal.3"; case .activity: "waveform.path.ecg" }
    }
}

// MARK: - View

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var store = ProfileStore()
    @State private var tab: ProfileTab = .profile

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 18) {
                    if let f = store.flash {
                        flashBanner(f, color: Nuru.success, bg: Nuru.successBg)
                    }
                    if let e = store.error, store.profile == nil {
                        flashBanner(e, color: Nuru.danger, bg: Color(hex: 0xFDECEC))
                    }
                    headerCard
                    tabbedCard
                    signOutButton
                }
                .padding(.horizontal, Nuru.S.lg)
                .padding(.top, 18)
                .padding(.bottom, 40)
                .frame(maxWidth: 1080, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Nuru.paper)
        .portalPage("My Profile")
        .task { await store.load(); await auth.loadProfile() }
    }

    private var hero: some View {
        PortalHero(breadcrumb: ["Settings", "Profile"], eyebrow: "Account", title: "My Profile",
                   subtitle: "Manage your identity, password and recent activity.")
    }

    // Identity card — monogram, name, email, role + status chips, member-since.
    private var headerCard: some View {
        let p = store.profile
        let fullName = p?.fullName ?? auth.profile?.fullName ?? "—"
        let email = p?.email ?? auth.profile?.email
        let roleChip = p?.roleKeys.first ?? auth.profile?.roleKeys.first ?? (p?.role ?? auth.profile?.role ?? "").lowercased()
        let status = p?.accountStatus ?? auth.profile?.accountStatus ?? "—"
        return Card(padding: 20) {
            HStack(alignment: .center, spacing: 16) {
                Monogram(name: fullName, size: 64, gradient: Nuru.navyGradient)
                VStack(alignment: .leading, spacing: 4) {
                    Text(fullName).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                    Text(email ?? "—").font(.inter(12.5)).foregroundStyle(Nuru.muted)
                    HStack(spacing: 8) {
                        Text(roleChip).font(.inter(10.5, .bold)).foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 9).padding(.vertical, 2)
                            .background(Nuru.gold.opacity(0.14)).clipShape(Capsule())
                        HStack(spacing: 4) {
                            Circle().fill(Nuru.successText).frame(width: 6, height: 6)
                            Text(status.capitalized).font(.inter(10.5, .bold)).foregroundStyle(Nuru.successText)
                        }
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Nuru.successBg).clipShape(Capsule())
                    }
                    .padding(.top, 4)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("Member since").font(.inter(11)).foregroundStyle(Nuru.muted)
                    Text(PFmt.date(p?.createdAt)).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                }
            }
        }
    }

    // Sidebar tab rail + active panel.
    private var tabbedCard: some View {
        HStack(alignment: .top, spacing: 0) {
            VStack(spacing: 2) {
                ForEach(ProfileTab.allCases) { t in
                    let active = tab == t
                    Button { tab = t } label: {
                        HStack(spacing: 10) {
                            Image(systemName: t.icon).font(.system(size: 14, weight: .semibold)).frame(width: 16)
                            Text(t.label).font(.inter(12.5, active ? .bold : .medium))
                            Spacer(minLength: 0)
                        }
                        .foregroundStyle(active ? Nuru.gold : Nuru.muted)
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(active ? AnyShapeStyle(Nuru.gold.opacity(0.12)) : AnyShapeStyle(Color.clear))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }
            .frame(width: 200)
            .padding(12)

            Rectangle().fill(Nuru.border).frame(width: 1)

            VStack(alignment: .leading, spacing: 0) {
                panel
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(24)
        }
        .background(Nuru.white)
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .nuruShadow()
    }

    @ViewBuilder private var panel: some View {
        switch tab {
        case .profile:     ProfilePanel(store: store)
        case .password:    PasswordPanel(store: store)
        case .twofa:       TwoFactorPanel(enabled: store.profile?.require2fa ?? false)
        case .sessions:    SessionsPanel()
        case .preferences: PreferencesPanel()
        case .activity:    ActivityPanel(store: store)
        }
    }

    private var signOutButton: some View {
        Button(role: .destructive) { auth.signOut() } label: {
            Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(Nuru.danger.opacity(0.1))
                .foregroundStyle(Nuru.danger)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }

    private func flashBanner(_ text: String, color: Color, bg: Color) -> some View {
        Text(text).font(.inter(13, .semibold)).foregroundStyle(color)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(bg).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

// MARK: - Panels

private struct PSectionTitle: View {
    let text: String
    var body: some View { Text(text).font(.inter(14, .bold)).foregroundStyle(Nuru.navy) }
}

private struct PField: View {
    let label: String
    var required = false
    @Binding var value: String
    var disabled = false
    var secure = false
    var helper: String?
    var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label).font(.inter(11.5, .semibold)).foregroundStyle(Nuru.muted)
                if required { Text("*").foregroundStyle(Nuru.danger) }
            }
            Group {
                if secure { SecureField("", text: $value) } else { TextField("", text: $value) }
            }
            .font(.inter(13)).foregroundStyle(disabled ? Nuru.muted : Nuru.foreground)
            .disabled(disabled).textInputAutocapitalization(.never).autocorrectionDisabled()
            .padding(.horizontal, 12).frame(height: 40)
            .background(disabled ? Nuru.inputBg : Nuru.white)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(error != nil ? Nuru.danger : Nuru.border, lineWidth: 1.5))
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            if let error { Text(error).font(.inter(11)).foregroundStyle(Nuru.danger) }
            else if let helper { Text(helper).font(.inter(11)).foregroundStyle(Nuru.muted) }
        }
    }
}

private struct PPrimaryButton: View {
    let title: String
    var disabled = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.inter(13, .semibold)).foregroundStyle(.white)
                .padding(.horizontal, 16).frame(height: 38)
                .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }.buttonStyle(.plain).disabled(disabled).opacity(disabled ? 0.5 : 1)
    }
}

private struct PDetailRow: View {
    let label: String; let value: String
    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text(label).font(.inter(12.5)).foregroundStyle(Nuru.muted)
                Spacer()
                Text(value).font(.inter(12.5, .medium)).foregroundStyle(Nuru.foreground)
            }.padding(.vertical, 11)
            Rectangle().fill(Nuru.border).frame(height: 1)
        }
    }
}

private struct ProfilePanel: View {
    @ObservedObject var store: ProfileStore
    @State private var first = ""
    @State private var last = ""
    @State private var phone = ""
    @State private var primed = false

    var body: some View {
        let p = store.profile
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 16) {
                PSectionTitle(text: "Personal Information")
                HStack(spacing: 20) {
                    PField(label: "First Name", required: true, value: $first)
                    PField(label: "Last Name", required: true, value: $last)
                }
                PField(label: "Email Address", value: .constant(p?.email ?? ""), disabled: true,
                       helper: "Contact an administrator to change your email address.")
                PField(label: "Phone Number", value: $phone)
            }
            VStack(alignment: .leading, spacing: 16) {
                Rectangle().fill(Nuru.border).frame(height: 1)
                PSectionTitle(text: "Account Details")
                VStack(spacing: 0) {
                    PDetailRow(label: "Account ID", value: p?.userId ?? "—")
                    PDetailRow(label: "Member since", value: PFmt.date(p?.createdAt))
                    PDetailRow(label: "Status", value: (p?.accountStatus ?? "—").capitalized)
                    PDetailRow(label: "Roles", value: (p?.roleKeys.isEmpty == false ? p!.roleKeys.joined(separator: ", ") : (p?.role ?? "—")))
                }
            }
            HStack {
                Text("Editing your name and phone is available in the web portal.")
                    .font(.inter(11)).foregroundStyle(Nuru.muted)
                Spacer()
                PPrimaryButton(title: "Save Profile", disabled: true) {}
            }
        }
        .onAppear {
            guard !primed, let p = store.profile else { return }
            let parts = p.fullName.split(separator: " ", maxSplits: 1).map(String.init)
            first = parts.first ?? ""
            last = parts.count > 1 ? parts[1] : ""
            phone = p.phoneNumber
            primed = true
        }
        .onChange(of: store.profile?.userId) { _, _ in
            guard let p = store.profile else { return }
            let parts = p.fullName.split(separator: " ", maxSplits: 1).map(String.init)
            first = parts.first ?? ""; last = parts.count > 1 ? parts[1] : ""; phone = p.phoneNumber; primed = true
        }
    }
}

private struct PasswordPanel: View {
    @ObservedObject var store: ProfileStore
    @State private var current = ""
    @State private var next = ""
    @State private var confirm = ""
    @State private var errCurrent: String?
    @State private var errNext: String?
    @State private var errConfirm: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PSectionTitle(text: "Change Password")
            Text("After changing your password, all other active sessions are terminated and you'll need to sign in again on those devices.")
                .font(.inter(12.5)).foregroundStyle(Nuru.muted).lineSpacing(3)
                .frame(maxWidth: 520, alignment: .leading).padding(.top, 8).padding(.bottom, 22)
            VStack(alignment: .leading, spacing: 20) {
                PField(label: "Current Password", required: true, value: $current, secure: true, error: errCurrent)
                PField(label: "New Password", required: true, value: $next, secure: true, helper: "Minimum 8 characters", error: errNext)
                PField(label: "Confirm New Password", required: true, value: $confirm, secure: true, error: errConfirm)
            }
            .frame(maxWidth: 520)
            HStack {
                Spacer()
                PPrimaryButton(title: "Change Password", disabled: busy) { Task { await submit() } }
            }
            .frame(maxWidth: 520).padding(.top, 24)
        }
    }

    private func submit() async {
        errCurrent = current.isEmpty ? "Enter your current password." : nil
        errNext = next.count < 8 ? "Minimum 8 characters." : (next == current && !next.isEmpty ? "New password must differ from current." : nil)
        errConfirm = confirm != next ? "Passwords do not match." : nil
        if errCurrent != nil || errNext != nil || errConfirm != nil { return }
        busy = true
        do {
            try await store.changePassword(current, next)
            current = ""; next = ""; confirm = ""
            store.showFlash("Password changed. Other sessions were signed out.")
        } catch {
            store.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        busy = false
    }
}

private struct TwoFactorPanel: View {
    let enabled: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PSectionTitle(text: "Two-Factor Authentication")
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill((enabled ? Nuru.success : Nuru.warning).opacity(0.15))
                    Image(systemName: "shield").font(.system(size: 17)).foregroundStyle(enabled ? Nuru.success : Nuru.warning)
                }.frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 2) {
                    Text(enabled ? "2FA is required on this account" : "2FA is not required")
                        .font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                    Text("Two-factor enrollment is completed at sign-in. An administrator sets whether 2FA is required for your account on the Users screen.")
                        .font(.inter(12)).foregroundStyle(Nuru.muted).lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(16)
            .background(enabled ? Nuru.successBg : Nuru.urgentBg)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke((enabled ? Nuru.success : Nuru.warning).opacity(0.25), lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.top, 16)
        }
    }
}

private struct SessionsPanel: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PSectionTitle(text: "Active Sessions")
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Nuru.inputBg)
                        Image(systemName: "iphone").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                    }.frame(width: 30, height: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 8) {
                            Text("This device").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.foreground)
                            Text("CURRENT").font(.inter(9.5, .bold)).foregroundStyle(Nuru.successText)
                                .padding(.horizontal, 7).padding(.vertical, 1).background(Nuru.successBg).clipShape(Capsule())
                        }
                        Text("Signed in now").font(.inter(11)).foregroundStyle(Nuru.muted)
                    }
                    Spacer()
                }.padding(.vertical, 11)
                Rectangle().fill(Nuru.border).frame(height: 1)
            }
            .padding(.top, 16)
            Text("Changing your password signs out every other device. Per-device session management isn't available in the portal yet.")
                .font(.inter(12)).foregroundStyle(Nuru.muted).lineSpacing(3).padding(.top, 14)
        }
    }
}

private struct PreferencesPanel: View {
    @AppStorage("np_emailNotif") private var emailNotif = true
    @AppStorage("np_weeklyDigest") private var weeklyDigest = false
    @AppStorage("np_compact") private var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            PSectionTitle(text: "Preferences")
            VStack(spacing: 0) {
                prefRow("Email notifications", "Receive activity updates by email.", $emailNotif)
                prefRow("Weekly digest", "A summary of portal activity every Monday.", $weeklyDigest)
                prefRow("Compact layout", "Reduce spacing across tables and lists.", $compact)
            }.padding(.top, 16)
            Text("Preferences are saved to this device.").font(.inter(11)).foregroundStyle(Nuru.muted).padding(.top, 14)
        }
    }

    private func prefRow(_ label: String, _ desc: String, _ binding: Binding<Bool>) -> some View {
        VStack(spacing: 0) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.inter(13, .semibold)).foregroundStyle(Nuru.foreground)
                    Text(desc).font(.inter(12)).foregroundStyle(Nuru.muted)
                }
                Spacer()
                Toggle("", isOn: binding).labelsHidden().tint(Nuru.gold)
            }.padding(.vertical, 14)
            Rectangle().fill(Nuru.border).frame(height: 1)
        }
    }
}

private struct ActivityPanel: View {
    @ObservedObject var store: ProfileStore
    @State private var rows: [ActivityRow]?
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                PSectionTitle(text: "My Recent Activity")
                Spacer()
                Text("Last 20 actions on your account").font(.inter(11.5)).foregroundStyle(Nuru.muted)
            }
            if let error {
                Text(error).font(.inter(13)).foregroundStyle(Nuru.danger)
            } else if rows == nil {
                Text("Loading…").font(.inter(13)).foregroundStyle(Nuru.muted)
            } else if rows!.isEmpty {
                VStack(spacing: 10) {
                    Image(systemName: "waveform.path.ecg").font(.system(size: 26)).foregroundStyle(Nuru.muted.opacity(0.5))
                    Text("No activity recorded yet.").font(.inter(13)).foregroundStyle(Nuru.muted)
                }.frame(maxWidth: .infinity).padding(.vertical, 40)
            } else {
                VStack(spacing: 0) {
                    ForEach(rows!) { a in
                        VStack(spacing: 0) {
                            HStack(spacing: 12) {
                                ZStack {
                                    Circle().fill(Nuru.gold.opacity(0.12))
                                    Image(systemName: "waveform.path.ecg").font(.system(size: 12)).foregroundStyle(Nuru.gold)
                                }.frame(width: 28, height: 28)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(a.action.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: ".", with: " "))
                                        .font(.inter(12.5)).foregroundStyle(Nuru.foreground)
                                    Text(PFmt.timeAgo(a.occurredAt) + (a.entity.map { " · \($0)" } ?? ""))
                                        .font(.inter(11)).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                            }.padding(.vertical, 11)
                            Rectangle().fill(Nuru.border).frame(height: 1)
                        }
                    }
                }
            }
        }
        .task {
            do { rows = try await store.activity() }
            catch { self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
    }
}
