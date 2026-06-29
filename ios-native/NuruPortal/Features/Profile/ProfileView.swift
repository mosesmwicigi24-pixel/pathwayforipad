// My Profile — the signed-in user's identity + sign-out, from AuthStore (/me).
import SwiftUI

struct ProfileView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                if let p = auth.profile {
                    Card {
                        VStack(spacing: 12) {
                            Monogram(name: p.fullName, size: 72, gradient: Nuru.goldGradient)
                            Text(p.fullName).font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                            Pill(text: p.role.uppercased(), color: Nuru.gold)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    Card {
                        VStack(alignment: .leading, spacing: 12) {
                            SectionTitle(text: "Account")
                            row("Email", p.email ?? "—")
                            row("Phone", p.phoneNumber)
                            row("Status", p.accountStatus.capitalized)
                            if !p.roleKeys.isEmpty { row("Roles", p.roleKeys.joined(separator: ", ")) }
                        }
                    }
                } else {
                    ProgressView().padding(.top, 60)
                }

                Button(role: .destructive) { auth.signOut() } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                        .frame(maxWidth: .infinity).padding(.vertical, 14)
                        .background(Nuru.danger.opacity(0.1))
                        .foregroundStyle(Nuru.danger)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
            .padding(20)
        }
        .portalPage("My Profile")
        .task { await auth.loadProfile() }
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.nBody).foregroundStyle(Nuru.muted)
            Spacer()
            Text(value).font(.inter(15, .medium)).foregroundStyle(Nuru.navy)
        }
    }
}
