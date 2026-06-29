// Shared UI kit — a Swift port of the mobile app's primitives
// (packages/mobile/src/theme/components.tsx), so the iPad app reads with the same
// warm, card-based feel: white cards floating on one soft shadow, overline
// section headers, gold-on-restraint, Inter body + Fraunces display.
import SwiftUI

// MARK: - Async loading

enum Loadable<T> { case idle, loading, loaded(T), failed(String) }

@MainActor
final class Loader<T>: ObservableObject {
    @Published var state: Loadable<T> = .idle
    private let fetch: () async throws -> T
    init(_ fetch: @escaping () async throws -> T) { self.fetch = fetch }
    func load() async {
        if case .loaded = state {} else { state = .loading }
        do { state = .loaded(try await fetch()) }
        catch { state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription) }
    }
}

/// Drives a screen: skeleton → content → retryable error.
struct AsyncView<T, Content: View>: View {
    @StateObject private var loader: Loader<T>
    private let content: (T) -> Content
    init(_ fetch: @escaping () async throws -> T, @ViewBuilder content: @escaping (T) -> Content) {
        _loader = StateObject(wrappedValue: Loader(fetch))
        self.content = content
    }
    var body: some View {
        Group {
            switch loader.state {
            case .idle, .loading:
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            case .loaded(let v):
                content(v)
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await loader.load() } }.padding(Nuru.S.screen) }
            }
        }
        .background(Nuru.paper)
        .task { if case .idle = loader.state { await loader.load() } }
        .refreshable { await loader.load() }
    }
}

struct LoadingState: View {
    var body: some View { SkeletonList(rows: 5).padding(Nuru.S.screen) }
}

// MARK: - Shimmer skeletons

struct Shimmer: ViewModifier {
    @State private var x: CGFloat = -1
    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { geo in
                LinearGradient(colors: [.clear, .white.opacity(0.55), .clear], startPoint: .leading, endPoint: .trailing)
                    .frame(width: geo.size.width * 0.6)
                    .offset(x: x * geo.size.width)
                    .animation(.linear(duration: 1.2).repeatForever(autoreverses: false), value: x)
            }
            .mask(content)
        )
        .onAppear { x = 1.6 }
    }
}
extension View { func shimmer() -> some View { modifier(Shimmer()) } }

struct Skeleton: View {
    var height: CGFloat = 16
    var width: CGFloat? = nil
    var radius: CGFloat = Nuru.R.control
    var body: some View {
        RoundedRectangle(cornerRadius: radius, style: .continuous)
            .fill(Nuru.mutedBg)
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .shimmer()
    }
}

struct SkeletonList: View {
    var rows = 3
    var body: some View {
        VStack(spacing: Nuru.S.md) {
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: Nuru.S.md) {
                    Skeleton(height: 44, width: 44)
                    VStack(alignment: .leading, spacing: Nuru.S.sm) {
                        Skeleton(height: 14, width: 200)
                        Skeleton(height: 10, width: 120)
                    }
                    Spacer()
                }
                .padding(Nuru.S.base)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            }
        }
    }
}

// MARK: - Surfaces

/// White rounded card with one soft shadow + hairline border (mobile Card).
struct Card<Content: View>: View {
    var padding: CGFloat = Nuru.S.base
    var accent = false
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
                .stroke(accent ? Nuru.gold.opacity(0.5) : Nuru.border, lineWidth: 1))
            .nuruShadow()
    }
}

/// Inset tile inside a card (mobile `surface`).
struct SurfaceTile<Content: View>: View {
    var padding: CGFloat = Nuru.S.md
    @ViewBuilder var content: Content
    var body: some View {
        content.padding(padding).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
    }
}

/// Soft gold glow orb for navy headers.
struct Glow: View {
    var size: CGFloat = 220
    var color: Color = Nuru.gold.opacity(0.18)
    var body: some View { Circle().fill(color).frame(width: size, height: size).blur(radius: 60) }
}

// MARK: - Pieces

struct TintedIcon: View {
    let systemName: String
    var color: Color = Nuru.gold
    var size: CGFloat = 44
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.3, style: .continuous).fill(color.opacity(0.14))
            Image(systemName: systemName).font(.system(size: size * 0.42, weight: .semibold)).foregroundStyle(color)
        }
        .frame(width: size, height: size)
    }
}

struct Pill: View {
    let text: String
    var color: Color = Nuru.ink600
    var filled = false
    var body: some View {
        Text(text).font(.nMicro)
            .foregroundStyle(filled ? .white : color)
            .padding(.horizontal, 11).padding(.vertical, 5)
            .background(filled ? AnyShapeStyle(color) : AnyShapeStyle(color.opacity(0.12)))
            .clipShape(Capsule())
    }
}

struct Monogram: View {
    let name: String
    var size: CGFloat = 44
    var gradient: LinearGradient = Nuru.navyGradient
    var body: some View {
        Circle().fill(gradient).frame(width: size, height: size)
            .overlay(Text(initials(name)).font(.inter(size * 0.34, .semibold)).foregroundStyle(.white))
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

/// Overline eyebrow + serif title (mobile SectionHeader).
struct SectionHeader: View {
    let overline: String
    let title: String
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(overline.uppercased()).font(.nOverline).tracking(1.8).foregroundStyle(Nuru.ink600)
            Text(title).font(.nTitle).foregroundStyle(Nuru.ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Simple serif section title with optional trailing action (kept for call sites).
struct SectionTitle: View {
    let text: String
    var action: (() -> Void)? = nil
    var actionLabel: String? = nil
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(text).font(.nTitle).foregroundStyle(Nuru.ink)
            Spacer()
            if let action, let actionLabel {
                Button(actionLabel, action: action).font(.nLabel).tint(Nuru.goldLo)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct ProgressBar: View {
    let pct: Double
    var fill: Color = Nuru.gold
    var height: CGFloat = 8
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Nuru.track)
                Capsule().fill(fill).frame(width: geo.size.width * min(max(pct, 0), 100) / 100)
            }
        }
        .frame(height: height)
    }
}

/// Full-width gold pill button (mobile gold PButton).
struct GoldButton: View {
    let title: String
    var icon: String? = nil
    var loading = false
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if loading { ProgressView().tint(Nuru.navyDeep) }
                Text(title).font(.inter(16, .bold)).foregroundStyle(Nuru.navyDeep)
                if let icon, !loading { Image(systemName: icon).foregroundStyle(Nuru.navyDeep) }
            }
            .frame(maxWidth: .infinity).frame(height: 54)
            .background(Nuru.goldGradient)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.button, style: .continuous))
        }
    }
}

// MARK: - States

struct ErrorBanner: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: Nuru.S.base) {
            ZStack {
                Circle().fill(Nuru.danger.opacity(0.1)).frame(width: 56, height: 56)
                Text("!").font(.inter(24, .bold)).foregroundStyle(Nuru.danger)
            }
            Text("Something went wrong").font(.nHeading).foregroundStyle(Nuru.ink)
            Text(message).font(.nBody).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
            Button(action: retry) {
                Text("Try again").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    .padding(.horizontal, 20).padding(.vertical, 12)
                    .background(Nuru.white)
                    .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                    .clipShape(Capsule())
            }
            .padding(.top, 2)
        }
        .frame(maxWidth: 420)
        .padding(.vertical, Nuru.S.xl)
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Hero + stat

struct HeroHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var eyebrow: String?
    @ViewBuilder var trailing: Trailing
    var body: some View {
        ZStack(alignment: .topTrailing) {
            Glow().offset(x: 60, y: -80)
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 6) {
                    if let eyebrow {
                        Text(eyebrow.uppercased()).font(.nOverline).tracking(1.8).foregroundStyle(Nuru.goldGlow)
                    }
                    Text(title).font(.nDisplay).foregroundStyle(.white)
                    if let subtitle { Text(subtitle).font(.nBody).foregroundStyle(Nuru.onNavyDim) }
                }
                Spacer()
                trailing
            }
            .padding(Nuru.S.lg)
        }
        .background(Nuru.heroGradient)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.hero, style: .continuous))
        .nuruShadow()
    }
}
extension HeroHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, eyebrow: String? = nil) {
        self.init(title: title, subtitle: subtitle, eyebrow: eyebrow) { EmptyView() }
    }
}

struct StatCard: View {
    let label: String
    let value: String
    let icon: String
    var color: Color = Nuru.gold
    var caption: String? = nil
    var body: some View {
        Card(padding: 18) {
            VStack(alignment: .leading, spacing: 12) {
                TintedIcon(systemName: icon, color: color, size: 42)
                Text(value).font(.fraunces(30, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.6)
                Text(label).font(.nLabel).foregroundStyle(Nuru.ink600)
                if let caption { Text(caption).font(.nMicro).foregroundStyle(Nuru.warning) }
            }
        }
    }
}

// MARK: - Formatting

enum Fmt {
    static func money(minor: Int, currency: String?) -> String {
        let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = currency ?? "USD"; f.maximumFractionDigits = 2
        return f.string(from: NSNumber(value: Double(minor) / 100)) ?? "\(Double(minor) / 100)"
    }
    private static let iso: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    private static let isoPlain = ISO8601DateFormatter()
    static func date(_ s: String?, style: Date.FormatStyle = .dateTime.month().day().year()) -> String {
        guard let s else { return "—" }
        return (iso.date(from: s) ?? isoPlain.date(from: s)).map { $0.formatted(style) } ?? "—"
    }
    static func relative(_ s: String?) -> String {
        guard let s, let d = iso.date(from: s) ?? isoPlain.date(from: s) else { return "—" }
        return d.formatted(.relative(presentation: .named))
    }
}

// MARK: - Page chrome

extension View {
    func portalPage(_ title: String) -> some View {
        navigationTitle(title)
            .navigationBarTitleDisplayMode(.large)
            .background(Nuru.paper)
    }
}
