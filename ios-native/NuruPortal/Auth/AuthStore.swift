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
        #if DEBUG
        // Headless smoke-testing hook (Debug builds only): if a session token is
        // injected via the launch environment (see scripts/run-authed-sim.sh),
        // start signed in. Compiled out of Release entirely; a no-op when unset.
        let env = ProcessInfo.processInfo.environment
        if let access = env["NURU_ACCESS_TOKEN"], !access.isEmpty {
            await APIClient.shared.setSession(access: access, refresh: env["NURU_REFRESH_TOKEN"])
            isAuthenticated = true
            await loadProfile()
            booting = false
            return
        }
        #endif
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
