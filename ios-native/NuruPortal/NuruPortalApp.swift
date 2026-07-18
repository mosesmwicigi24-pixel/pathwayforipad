// Native Nuru Portal — SwiftUI app entry. A true native iPad app (NavigationSplit
// shell, Magic Keyboard / Split View friendly) over the same prod backend.
import SwiftUI
import UIKit

@main
struct NuruPortalApp: App {
    @StateObject private var auth = AuthStore()
    @Environment(\.scenePhase) private var scenePhase
    /// When the scene last left for the background — drives the biometric
    /// re-lock debounce (a quick app-switch under 30s never re-prompts).
    @State private var backgroundedAt: Date?

    init() {
        Nuru.registerFonts()
        Self.configureAppearance()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if auth.booting {
                    SplashView()
                } else if auth.isAuthenticated {
                    // Signed in — with the Face ID / Touch ID gate layered over
                    // the (blurred) app whenever the lock is armed.
                    ZStack {
                        RootView()
                            .blur(radius: auth.isLocked ? 24 : 0)
                            .disabled(auth.isLocked)
                            .accessibilityHidden(auth.isLocked)
                        if auth.isLocked {
                            BiometricLockView().transition(.opacity)
                        }
                    }
                    .animation(.easeInOut(duration: 0.25), value: auth.isLocked)
                } else {
                    LoginView()
                }
            }
            .environmentObject(auth)
            .tint(Nuru.gold)
            // The portal is designed entirely in warm light tones; never let the
            // device's Dark Mode bleed into system Form/sheet/picker chrome.
            .preferredColorScheme(.light)
            // One-time offer after a successful password login on biometric
            // hardware ("auth.biometricOffered" remembers either answer).
            .alert("Sign in with \(BiometricAuth.label ?? "Face ID") next time?",
                   isPresented: $auth.biometricEnrollPrompt) {
                Button("Enable") { auth.answerBiometricOffer(enable: true) }
                Button("Not now", role: .cancel) { auth.answerBiometricOffer(enable: false) }
            } message: {
                Text("Unlock Nuru Portal with \(BiometricAuth.label ?? "Face ID") instead of typing your password. You can change this any time in My Profile.")
            }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .background:
                    if backgroundedAt == nil { backgroundedAt = Date() }
                case .active:
                    if let left = backgroundedAt,
                       Date().timeIntervalSince(left) > AuthStore.relockGrace {
                        auth.relockIfNeeded()
                    }
                    backgroundedAt = nil
                default:
                    break
                }
            }
        }
    }

    /// App-wide chrome: elegant serif navigation titles in brand navy, warm
    /// translucent bars — so every page's title reads as designed, not default.
    static func configureAppearance() {
        // Fraunces display face for nav titles, falling back to a serif system
        // font if registration hasn't resolved the bundled face.
        func display(_ name: String, _ size: CGFloat, _ fallbackWeight: UIFont.Weight) -> UIFont {
            if let f = UIFont(name: name, size: size) { return f }
            let base = UIFont.systemFont(ofSize: size, weight: fallbackWeight)
            return base.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? base
        }
        let navy = UIColor(Nuru.navy)
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = UIColor(Nuru.paper)
        appearance.shadowColor = .clear
        appearance.largeTitleTextAttributes = [.foregroundColor: navy, .font: display("Inter-SemiBold", 32, .semibold)]
        appearance.titleTextAttributes = [.foregroundColor: navy, .font: display("Inter-SemiBold", 18, .semibold)]
        UINavigationBar.appearance().standardAppearance = appearance
        UINavigationBar.appearance().scrollEdgeAppearance = appearance
        UINavigationBar.appearance().compactAppearance = appearance
        UINavigationBar.appearance().tintColor = UIColor(Nuru.gold)
    }
}

private struct SplashView: View {
    var body: some View {
        ZStack {
            Nuru.navyGradient.ignoresSafeArea()
            VStack(spacing: 18) {
                BrandMark(size: 72)
                ProgressView().tint(.white)
            }
        }
    }
}

/// The gold "N" badge used across the app (logo), on a gradient with depth.
struct BrandMark: View {
    var size: CGFloat = 36
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Nuru.goldGradient)
            .frame(width: size, height: size)
            .overlay(
                Text("N")
                    .font(.nuruDisplay(size * 0.56, weight: .semibold))
                    .foregroundStyle(.white)
            )
            .overlay(
                RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                    .stroke(.white.opacity(0.25), lineWidth: 1)
            )
            .shadow(color: Nuru.gold.opacity(0.45), radius: size * 0.18, y: size * 0.08)
    }
}
