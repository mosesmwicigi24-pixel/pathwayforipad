// Face ID / Touch ID app lock — a LocalAuthentication gate over the persisted
// session. The device unlocks the app; the server session it reveals is the one
// minted by the last password login (biometrics never mint credentials, and the
// password itself is never stored anywhere). On Mac Catalyst LAContext reports
// Touch ID where available; on Macs without it the .deviceOwnerAuthentication
// policy falls back to the login password and the UI says "Unlock" generically.
import SwiftUI
import LocalAuthentication

enum BiometricAuth {
    enum Outcome {
        case success
        /// User dismissed the system prompt — stay quiet, keep the gate up.
        case cancelled
        /// No biometry enrolled and no passcode/password to fall back to.
        case unavailable
        case failed(String)
    }

    /// Can the gate authenticate at all? Biometric OR device passcode/password
    /// (.deviceOwnerAuthentication) — on a Mac without Touch ID this is still
    /// true via the login password.
    static var isAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// True only when Face ID / Touch ID is enrolled and ready — the bar for
    /// offering the opt-in after a password login.
    static var hasBiometrics: Bool {
        let ctx = LAContext()
        return ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
            && ctx.biometryType != .none
    }

    /// "Face ID" / "Touch ID" — nil when there's no biometric (generic unlock).
    static var label: String? {
        let ctx = LAContext()
        // biometryType is only meaningful after canEvaluatePolicy has run.
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil) else { return nil }
        switch ctx.biometryType {
        case .faceID:  return "Face ID"
        case .touchID: return "Touch ID"
        default:       return nil
        }
    }

    /// SF Symbol matching the current biometry (lock.shield when generic).
    static var icon: String {
        switch label {
        case "Face ID":  return "faceid"
        case "Touch ID": return "touchid"
        default:         return "lock.shield"
        }
    }

    /// One system authentication pass. `.deviceOwnerAuthentication` = biometric
    /// first with the device passcode / Mac password as the built-in fallback,
    /// so biometryLockout resolves itself inside the system sheet.
    static func authenticate(reason: String) async -> Outcome {
        let ctx = LAContext()
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) else { return .unavailable }
        do {
            let ok = try await ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return ok ? .success : .failed("Authentication didn't complete.")
        } catch let err as LAError {
            switch err.code {
            case .userCancel, .systemCancel, .appCancel:
                return .cancelled
            case .biometryNotEnrolled, .biometryNotAvailable, .passcodeNotSet:
                return .unavailable
            default:
                return .failed(err.localizedDescription)
            }
        } catch {
            return .failed(error.localizedDescription)
        }
    }
}

// MARK: - Lock overlay

/// The quiet gate shown over the (blurred) signed-in app when the biometric
/// lock is armed — brand mark on the navy stage, one unlock action that fires
/// itself on appear, and a password escape hatch back to LoginView.
struct BiometricLockView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var busy = false
    @State private var note: String?

    private var unlockTitle: String {
        BiometricAuth.label.map { "Unlock with \($0)" } ?? "Unlock"
    }

    var body: some View {
        ZStack {
            Nuru.navyGradient.opacity(0.97).ignoresSafeArea()
            // the login stage's ambient gold glow, dimmed for the lock state
            Circle().fill(Nuru.gold.opacity(0.16)).frame(width: 360, height: 360)
                .blur(radius: 120).offset(x: -120, y: -220)
            Circle().fill(Nuru.gold.opacity(0.09)).frame(width: 320, height: 320)
                .blur(radius: 120).offset(x: 160, y: 280)

            VStack(spacing: 26) {
                VStack(spacing: 14) {
                    BrandMark(size: 72)
                    VStack(spacing: 3) {
                        Text("Nuru Portal").font(.nuruDisplay(28)).foregroundStyle(.white)
                        Text(BiometricAuth.label.map { "Locked — \($0) to continue" } ?? "Locked")
                            .font(.nBody).foregroundStyle(.white.opacity(0.55))
                    }
                }

                if let note {
                    Text(note)
                        .font(.nCaption).foregroundStyle(.white.opacity(0.75))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(.white.opacity(0.08))
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }

                VStack(spacing: 14) {
                    Button(action: { Task { await attempt() } }) {
                        HStack(spacing: 9) {
                            if busy { ProgressView().tint(.white) }
                            else { Image(systemName: BiometricAuth.icon).font(.system(size: 16, weight: .semibold)) }
                            Text(unlockTitle).fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity).padding(.vertical, 15)
                        .background(Nuru.goldGradient)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        .nuruShadow(0.6)
                    }
                    .disabled(busy)

                    // Escape hatch: back to the password form. The persisted
                    // session stays put, so LoginView still offers the fast path.
                    Button("Use password instead") { auth.fallBackToPasswordLogin() }
                        .font(.nCaption).foregroundStyle(.white.opacity(0.55))
                }
                .frame(maxWidth: 320)
            }
            .padding(24)
        }
        .task { await attempt() }   // auto-prompt the moment the gate appears
    }

    private func attempt() async {
        guard !busy else { return }
        busy = true; note = nil
        switch await BiometricAuth.authenticate(reason: "Unlock your Nuru Portal session.") {
        case .success:
            auth.unlock()
        case .cancelled:
            break   // silent — the gate stays, the button is the retry
        case .unavailable:
            // Biometry/passcode vanished since the lock was armed — don't trap
            // the admin behind a gate that can never open.
            auth.unlock()
        case .failed(let message):
            note = message
        }
        busy = false
    }
}
