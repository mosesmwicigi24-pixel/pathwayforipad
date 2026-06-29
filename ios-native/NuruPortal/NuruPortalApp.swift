// Native Nuru Portal — SwiftUI app entry. A true native iPad app (NavigationSplit
// shell, Magic Keyboard / Split View friendly) over the same prod backend.
import SwiftUI
import UIKit

@main
struct NuruPortalApp: App {
    @StateObject private var auth = AuthStore()

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
                    RootView()
                } else {
                    LoginView()
                }
            }
            .environmentObject(auth)
            .tint(Nuru.gold)
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
