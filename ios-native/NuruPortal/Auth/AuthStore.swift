// Observable session state for the app — the native counterpart of authSlice.ts.
// Holds the signed-in flag, the /me profile, drives Login ↔ Shell, and arms the
// Face ID / Touch ID app lock (BiometricAuth) over the persisted session.
import SwiftUI

@MainActor
final class AuthStore: ObservableObject {
    @Published var isAuthenticated = false
    @Published var profile: MeProfile?
    @Published var booting = true

    // MARK: Biometric app lock

    /// The gate is up: a signed-in session exists but Face ID / Touch ID hasn't
    /// cleared it yet. RootView renders blurred underneath BiometricLockView.
    @Published var isLocked = false
    /// Tokens survive on this device (drives LoginView's biometric fast path
    /// after a "Use password instead" bail-out).
    @Published var hasPersistedSession = false
    /// One-time "Sign in with Face ID next time?" offer after a password login.
    @Published var biometricEnrollPrompt = false
    /// Gentle LoginView banner ("Session expired — sign in once…") set when the
    /// server rejects the restored session; biometrics can't mint a new one.
    @Published var sessionNote: String?

    /// The opt-in ("auth.biometricLock"). A device preference, not a credential —
    /// the password itself is never stored anywhere.
    @Published var biometricLockEnabled = UserDefaults.standard.bool(forKey: AuthStore.lockPrefKey) {
        didSet { UserDefaults.standard.set(biometricLockEnabled, forKey: Self.lockPrefKey) }
    }

    private static let lockPrefKey = "auth.biometricLock"
    private static let offeredKey = "auth.biometricOffered"
    /// A quick app-switch shorter than this doesn't re-prompt.
    static let relockGrace: TimeInterval = 30

    init() {
        Task { await bootstrap() }
    }

    /// On launch: if a token survived in the Keychain, treat the session as live
    /// (a stale access token is refreshed on the first request) and load /me.
    func bootstrap() async {
        await APIClient.shared.setOnSessionExpired { [weak self] in
            Task { @MainActor in self?.signOut(expired: true) }
        }
        #if DEBUG
        // Headless smoke-testing hook (Debug builds only): if a session token is
        // injected via the launch environment (see scripts/run-authed-sim.sh),
        // start signed in. Compiled out of Release entirely; a no-op when unset.
        // Deliberately skips the biometric gate — simulators drive it manually.
        let env = ProcessInfo.processInfo.environment
        if let access = env["NURU_ACCESS_TOKEN"], !access.isEmpty {
            await APIClient.shared.setSession(access: access, refresh: env["NURU_REFRESH_TOKEN"])
            isAuthenticated = true
            hasPersistedSession = true
            await loadProfile()
            booting = false
            return
        }
        #endif
        if await APIClient.shared.hasSession {
            hasPersistedSession = true
            isAuthenticated = true
            // Arm the gate before first paint. If authentication became
            // impossible since it was armed, don't trap the admin outside.
            if biometricLockEnabled, BiometricAuth.isAvailable { isLocked = true }
            await loadProfile()
        }
        booting = false
    }

    func onAuthenticated(_ session: Session) async {
        await APIClient.shared.setSession(access: session.accessToken, refresh: session.refreshToken)
        hasPersistedSession = true
        sessionNote = nil
        isAuthenticated = true
        isLocked = false
        await loadProfile()
        offerBiometricsIfFresh()
    }

    func loadProfile() async {
        profile = try? await PortalAPI.me()
    }

    func signOut(expired: Bool = false) {
        Task { await APIClient.shared.clearSession() }
        profile = nil
        hasPersistedSession = false
        isAuthenticated = false
        isLocked = false
        sessionNote = expired ? "Session expired — sign in once with your password." : nil
    }

    // MARK: Biometric gate transitions

    /// BiometricLockView reports a successful system authentication.
    func unlock() {
        isLocked = false
    }

    /// "Use password instead" from the lock screen: back to LoginView WITHOUT
    /// clearing the tokens, so the fast-path button can still restore them.
    func fallBackToPasswordLogin() {
        isLocked = false
        isAuthenticated = false
    }

    /// LoginView's "Sign in with Face ID" fast path: authenticate, then reveal
    /// the persisted session. If the server has since rejected it, the
    /// onSessionExpired handler drops back to LoginView with the gentle note.
    func restoreViaBiometrics() async -> Bool {
        guard case .success = await BiometricAuth.authenticate(reason: "Sign in to Nuru Portal.") else {
            return false
        }
        sessionNote = nil
        isAuthenticated = true
        isLocked = false
        await loadProfile()
        return true
    }

    /// Called when the scene returns to .active after > relockGrace in the
    /// background — a quick app-switch never re-prompts.
    func relockIfNeeded() {
        guard biometricLockEnabled, isAuthenticated, BiometricAuth.isAvailable else { return }
        isLocked = true
    }

    /// After a successful PASSWORD login on biometric hardware, offer the lock
    /// once. "Not now" is remembered; the Profile page keeps the toggle.
    private func offerBiometricsIfFresh() {
        let d = UserDefaults.standard
        guard !biometricLockEnabled, !d.bool(forKey: Self.offeredKey), BiometricAuth.hasBiometrics else { return }
        biometricEnrollPrompt = true
    }

    func answerBiometricOffer(enable: Bool) {
        UserDefaults.standard.set(true, forKey: Self.offeredKey)
        biometricEnrollPrompt = false
        if enable { biometricLockEnabled = true }
    }
}
