// Observable session state for the app — the native counterpart of authSlice.ts.
// Holds the signed-in flag, the /me profile, and drives Login ↔ Shell.
import SwiftUI

@MainActor
final class AuthStore: ObservableObject {
    @Published var isAuthenticated = false
    @Published var profile: MeProfile?
    @Published var booting = true

    init() {
        Task { await bootstrap() }
    }

    /// On launch: if a token survived in the Keychain, treat the session as live
    /// (a stale access token is refreshed on the first request) and load /me.
    func bootstrap() async {
        await APIClient.shared.setOnSessionExpired { [weak self] in
            Task { @MainActor in self?.signOut() }
        }
        if await APIClient.shared.hasSession {
            isAuthenticated = true
            await loadProfile()
        }
        booting = false
    }

    func onAuthenticated(_ session: Session) async {
        await APIClient.shared.setSession(access: session.accessToken, refresh: session.refreshToken)
        isAuthenticated = true
        await loadProfile()
    }

    func loadProfile() async {
        profile = try? await PortalAPI.me()
    }

    func signOut() {
        Task { await APIClient.shared.clearSession() }
        profile = nil
        isAuthenticated = false
    }
}
