// Native Nuru Portal — SwiftUI app entry. Replaces the Capacitor web wrapper with
// a true native iPad app (NavigationSplitView shell, Magic Keyboard / Split View
// friendly) talking to the same prod backend.
import SwiftUI

@main
struct NuruPortalApp: App {
    @StateObject private var auth = AuthStore()

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
}

private struct SplashView: View {
    var body: some View {
        ZStack {
            Nuru.navy.ignoresSafeArea()
            VStack(spacing: 16) {
                BrandMark(size: 64)
                ProgressView().tint(.white)
            }
        }
    }
}

/// The gold "N" badge used across the app (logo).
struct BrandMark: View {
    var size: CGFloat = 36
    var body: some View {
        RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
            .fill(Nuru.gold)
            .frame(width: size, height: size)
            .overlay(
                Text("N")
                    .font(.nuruDisplay(size * 0.56))
                    .foregroundStyle(.white)
            )
    }
}
