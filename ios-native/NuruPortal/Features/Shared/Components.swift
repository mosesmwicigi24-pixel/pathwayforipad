// Shared UI kit — a Swift port of the mobile app's primitives
// (packages/mobile/src/theme/components.tsx), so the iPad app reads with the same
// warm, card-based feel: white cards floating on one soft shadow, overline
// section headers, gold-on-restraint, Inter body + Fraunces display.
import SwiftUI
import UIKit

// MARK: - Async loading

enum Loadable<T> { case idle, loading, loaded(T), failed(String) }

@MainActor
final class Loader<T>: ObservableObject {
    @Published var state: Loadable<T> = .idle
    private let fetch: () async throws -> T
    init(_ fetch: @escaping () async throws -> T) { self.fetch = fetch }
    /// Initial load shows the skeleton; a re-load (refresh) keeps the old value
    /// on screen and swaps in the new payload on success (keep-old-payload,
    /// mirroring PeopleIntelligenceView). A failed background refresh keeps the
    /// old content instead of dropping to the error state.
    func load() async {
        var previous: T? = nil
        if case .loaded(let v) = state { previous = v }
        if previous == nil { state = .loading }
        do {
            let value = try await fetch()
            set(.loaded(value), animated: previous == nil)
        } catch {
            let message = (error as? APIError)?.errorDescription ?? error.localizedDescription
            if let previous { state = .loaded(previous) }       // background refresh failed — keep content
            else { set(.failed(message), animated: true) }
        }
    }
    /// Gentle crossfade on the initial skeleton→content swap (skipped under Reduce Motion).
    private func set(_ new: Loadable<T>, animated: Bool) {
        if animated && !UIAccessibility.isReduceMotionEnabled {
            withAnimation(.easeOut(duration: 0.25)) { state = new }
        } else {
            state = new
        }
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
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }.transition(.opacity)
            case .loaded(let v):
                content(v).transition(.opacity)
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await loader.load() } }.padding(Nuru.S.screen) }
                    .transition(.opacity)
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

// MARK: - Interaction (press feel)

/// Shared press state for every tappable element: a quick scale-down + slight
/// dim with a snappy spring. Under Reduce Motion the scale is dropped and only
/// the opacity dip remains.
struct PressableButtonStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? 0.97 : 1))
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.spring(response: 0.28, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

extension View {
    /// `.buttonStyle(PressableButtonStyle())` — the kit's default press feel.
    func pressable() -> some View { buttonStyle(PressableButtonStyle()) }
}

// MARK: - Shimmer skeletons

struct Shimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var x: CGFloat = -1
    @ViewBuilder
    func body(content: Content) -> some View {
        if reduceMotion {
            // Reduce Motion: a static highlight instead of the moving sweep.
            content.overlay(Color.white.opacity(0.28).mask(content))
        } else {
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

/// Skeleton for KPI-tile grids (tinted-tile shape) — wave-2 screens adopt this.
struct SkeletonGrid: View {
    var tiles = 4
    var columns = 4
    var body: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: Nuru.S.md), count: max(columns, 1)),
                  spacing: Nuru.S.md) {
            ForEach(0..<tiles, id: \.self) { _ in
                HStack(spacing: Nuru.S.md) {
                    Skeleton(height: 44, width: 44, radius: 11)
                    VStack(alignment: .leading, spacing: Nuru.S.sm) {
                        Skeleton(height: 10, width: 88)
                        Skeleton(height: 16, width: 56)
                    }
                    Spacer(minLength: 0)
                }
                .padding(Nuru.S.base)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            }
        }
    }
}

/// Skeleton for tables — full-width row bars, alternating like list rows.
struct SkeletonTable: View {
    var rows = 6
    var body: some View {
        VStack(spacing: Nuru.S.sm) {
            ForEach(0..<rows, id: \.self) { _ in
                HStack(spacing: Nuru.S.md) {
                    Skeleton(height: 12, width: 160)
                    Skeleton(height: 12)
                    Skeleton(height: 12, width: 72)
                }
                .padding(.horizontal, Nuru.S.base).padding(.vertical, 14)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
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
        .pressable()
        .hoverEffect(.lift)
    }
}

// MARK: - States

struct ErrorBanner: View {
    let message: String
    let retry: () -> Void
    @ObservedObject private var network = NetworkMonitor.shared

    // Explicit init: the private @ObservedObject would otherwise make the
    // memberwise init private, breaking the app-wide call sites.
    init(message: String, retry: @escaping () -> Void) {
        self.message = message
        self.retry = retry
    }

    var body: some View {
        VStack(spacing: Nuru.S.base) {
            ZStack {
                Circle().fill(Nuru.danger.opacity(0.1)).frame(width: 56, height: 56)
                Text("!").font(.inter(24, .bold)).foregroundStyle(Nuru.danger)
            }
            Text("Something went wrong").font(.nHeading).foregroundStyle(Nuru.ink)
            // While offline, lead with a friendlier explanation than the raw error.
            Text(network.online ? message : "You appear to be offline. Check your connection and try again.")
                .font(.nBody).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
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

/// Calm, centered empty state — dashed card, tinted icon, generous whitespace
/// (the shared version of Content Studio's hand-rolled EmptyStateView).
struct EmptyState: View {
    let icon: String
    let title: String
    var message: String? = nil
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 8) {
            TintedIcon(systemName: icon, size: 56)
                .padding(.bottom, 6)
            Text(title).font(.nTitle).foregroundStyle(Nuru.navy).multilineTextAlignment(.center)
            if let message {
                Text(message).font(.nCaption).foregroundStyle(Nuru.ink600)
                    .multilineTextAlignment(.center).frame(maxWidth: 340)
            }
            if let actionTitle, let action {
                Button(action: action) {
                    Label(actionTitle, systemImage: "plus")
                        .font(.inter(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 16).frame(height: 38)
                        .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .pressable()
                .hoverEffect(.lift)
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56).padding(.horizontal, 24)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }

    /// In-card compact variant (small icon + caption), e.g. an empty list inside a card.
    static func compact(icon: String, message: String) -> some View {
        VStack(spacing: 6) {
            TintedIcon(systemName: icon, color: Nuru.ink400, size: 34)
            Text(message).font(.nCaption).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
    }
}

// MARK: - Toast

/// Data for the floating toast capsule. `success` shows a lumGreen check,
/// `error` a danger mark.
struct ToastData: Equatable {
    enum Kind { case success, error }
    var kind: Kind = .success
    var message: String
    static func success(_ message: String) -> ToastData { ToastData(kind: .success, message: message) }
    static func error(_ message: String) -> ToastData { ToastData(kind: .error, message: message) }
}

/// Bottom-center floating capsule; slides+fades in, auto-dismisses after ~2.8s
/// (cancel-safe — a newer toast resets the clock). Reduce Motion → fade only.
/// Usage: `@State var toast: ToastData?` + `.toast($toast)`.
private struct ToastModifier: ViewModifier {
    @Binding var toast: ToastData?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dismissTask: Task<Void, Never>?

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .bottom) {
                if let toast {
                    HStack(spacing: 8) {
                        Image(systemName: toast.kind == .success ? "checkmark.circle.fill" : "exclamationmark.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(toast.kind == .success ? Nuru.lumGreen : Nuru.lumRed)
                        Text(toast.message).font(.inter(13, .semibold)).foregroundStyle(.white).lineLimit(2)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Nuru.navyDeep.opacity(0.96))
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(.white.opacity(0.12), lineWidth: 1))
                    .nuruShadow(1.4)
                    .padding(.bottom, 24)
                    .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                    .accessibilityAddTraits(.updatesFrequently)
                }
            }
            .animation(reduceMotion ? .easeOut(duration: 0.2) : .spring(response: 0.32, dampingFraction: 0.8), value: toast)
            .sensoryFeedback(trigger: toast) { _, new in
                guard let new else { return nil }
                return new.kind == .success ? .success : .error
            }
            .onChange(of: toast) { _, new in
                dismissTask?.cancel()
                guard new != nil else { return }
                dismissTask = Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 2_800_000_000)
                    if !Task.isCancelled { toast = nil }
                }
            }
    }
}

extension View {
    func toast(_ toast: Binding<ToastData?>) -> some View { modifier(ToastModifier(toast: toast)) }
}

// MARK: - Cached async image

/// App-wide in-memory image cache + a URLSession that also honours the default
/// on-disk URLCache — so avatars/thumbnails don't re-download on every appearance.
enum ImageMemoryCache {
    static let cache: NSCache<NSURL, UIImage> = {
        let c = NSCache<NSURL, UIImage>()
        c.countLimit = 300
        c.totalCostLimit = 64 * 1024 * 1024
        return c
    }()
    static let session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.requestCachePolicy = .returnCacheDataElseLoad
        cfg.urlCache = URLCache.shared
        return URLSession(configuration: cfg)
    }()
}

/// Drop-in replacement for `AsyncImage` (same content/placeholder closure shape)
/// backed by `ImageMemoryCache` — cached images render synchronously, fresh ones
/// fade in gently (no fade under Reduce Motion).
struct CachedAsyncImage<Content: View, Placeholder: View>: View {
    private let url: URL?
    private let content: (Image) -> Content
    private let placeholder: () -> Placeholder
    @State private var image: UIImage?

    init(url: URL?,
         @ViewBuilder content: @escaping (Image) -> Content,
         @ViewBuilder placeholder: @escaping () -> Placeholder) {
        self.url = url
        self.content = content
        self.placeholder = placeholder
    }

    var body: some View {
        Group {
            if let ui = image ?? cachedImage {
                content(Image(uiImage: ui))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            image = cachedImage
            guard image == nil, let url else { return }
            guard let (data, _) = try? await ImageMemoryCache.session.data(from: url),
                  let fetched = UIImage(data: data) else { return }
            ImageMemoryCache.cache.setObject(fetched, forKey: url as NSURL, cost: data.count)
            if UIAccessibility.isReduceMotionEnabled { image = fetched }
            else { withAnimation(.easeOut(duration: 0.2)) { image = fetched } }
        }
    }

    private var cachedImage: UIImage? {
        url.flatMap { ImageMemoryCache.cache.object(forKey: $0 as NSURL) }
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
                    .contentTransition(.numericText())
                    .animation(.default, value: value)
                Text(label).font(.nLabel).foregroundStyle(Nuru.ink600)
                if let caption { Text(caption).font(.nMicro).foregroundStyle(Nuru.warning) }
            }
        }
    }
}

// MARK: - Portal hero (navy banner with breadcrumb, action chips, KPI strip)

struct HeroStat: Identifiable {
    let label: String, value: String, hint: String
    /// Optional value tint for stats whose color carries meaning (e.g. member
    /// health bands: thriving green / watch amber / at-risk red). Nil = white.
    var tint: Color? = nil
    var id: String { label }
}

struct PortalHero<Actions: View>: View {
    var breadcrumb: [String] = []
    var eyebrow: String? = nil
    let title: String
    var subtitle: String? = nil
    var stats: [HeroStat] = []
    @ViewBuilder var actions: Actions

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center) {
                if !breadcrumb.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(Array(breadcrumb.enumerated()), id: \.offset) { i, crumb in
                            if i > 0 { Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint) }
                            Text(crumb).font(.nMicro)
                                .foregroundStyle(i == breadcrumb.count - 1 ? .white : Nuru.onNavyDim)
                        }
                    }
                }
                Spacer()
                actions
            }
            VStack(alignment: .leading, spacing: 6) {
                if let eyebrow { Text(eyebrow.uppercased()).font(.nOverline).tracking(1.8).foregroundStyle(Nuru.goldGlow) }
                Text(title).font(.nDisplay).foregroundStyle(.white)
                if let subtitle { Text(subtitle).font(.nBody).foregroundStyle(Nuru.onNavyDim).fixedSize(horizontal: false, vertical: true) }
            }
            if !stats.isEmpty { statStrip }
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, Nuru.S.lg).padding(.bottom, Nuru.S.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private var statStrip: some View {
        HStack(spacing: 0) {
            ForEach(Array(stats.enumerated()), id: \.element.id) { i, s in
                VStack(alignment: .leading, spacing: 5) {
                    Text(s.label.uppercased()).font(.nOverline).tracking(1.4).foregroundStyle(Nuru.onNavyDim)
                    Text(s.value).font(.fraunces(24, .medium)).foregroundStyle(s.tint ?? .white)
                        .contentTransition(.numericText())
                        .animation(.default, value: s.value)
                    Text(s.hint).font(.nMicro).foregroundStyle(Nuru.onNavyFaint)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 18).padding(.vertical, 14)
                if i < stats.count - 1 { Rectangle().fill(.white.opacity(0.08)).frame(width: 1) }
            }
        }
        .background(.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
    }
}
extension PortalHero where Actions == EmptyView {
    init(breadcrumb: [String] = [], eyebrow: String? = nil, title: String, subtitle: String? = nil, stats: [HeroStat] = []) {
        self.init(breadcrumb: breadcrumb, eyebrow: eyebrow, title: title, subtitle: subtitle, stats: stats) { EmptyView() }
    }
}

/// Hero action chip — ghost (translucent), gold (solid), or tag (gold-tinted).
struct HeroChip: View {
    enum Style { case ghost, gold, tag }
    let label: String
    var icon: String? = nil
    var trailingIcon: String? = nil
    var style: Style = .ghost
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                Text(label).font(.inter(11.5, style == .tag ? .bold : .semibold))
                    .textCase(style == .tag ? .uppercase : nil)
                if let trailingIcon { Image(systemName: trailingIcon).font(.system(size: 10, weight: .bold)) }
            }
            .padding(.horizontal, 12).frame(height: 32)
            .foregroundStyle(fg)
            .background(bg)
            .overlay(Capsule().stroke(border, lineWidth: 1))
            .clipShape(Capsule())
        }
        .pressable()
        .hoverEffect(.lift)
    }
    private var fg: Color { switch style { case .gold: .white; case .tag: Nuru.goldGlow; case .ghost: .white } }
    private var bg: Color { switch style { case .gold: Nuru.gold; case .tag: Nuru.gold.opacity(0.14); case .ghost: .white.opacity(0.08) } }
    private var border: Color { switch style { case .gold: .clear; case .tag: Nuru.gold.opacity(0.25); case .ghost: .white.opacity(0.15) } }
}

/// Pastel KPI tile (Dashboard) — tinted card, icon chip, serif value, tap-through.
struct KpiTile: View {
    let label: String, value: String, icon: String
    let tint: Nuru.Tint
    var action: () -> Void = {}
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(tint.fg.opacity(0.14))
                    Image(systemName: icon).font(.system(size: 18, weight: .semibold)).foregroundStyle(tint.fg)
                }.frame(width: 44, height: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(label).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(1)
                    Text(value).font(.fraunces(23, .semibold)).foregroundStyle(Nuru.navy)
                        .contentTransition(.numericText())
                        .animation(.default, value: value)
                }
                Spacer(minLength: 0)
                Image(systemName: "ellipsis").font(.system(size: 13)).foregroundStyle(Nuru.ink300)
                    .accessibilityHidden(true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(tint.bg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(tint.fg.opacity(0.18), lineWidth: 1))
        }
        .pressable()
        .hoverEffect(.lift)
        .accessibilityLabel(label)
        .accessibilityValue(value)
    }
}

/// Pipeline status tile (Drafts / In review / Archived / Published).
struct PipelineTile: View {
    let label: String, value: String, icon: String
    let tint: Nuru.Tint
    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(.white.opacity(0.7))
                Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(tint.fg)
            }.frame(width: 34, height: 34)
            VStack(alignment: .leading, spacing: 2) {
                Text(value).font(.fraunces(22, .semibold)).foregroundStyle(tint.fg)
                Text(label).font(.inter(11.5, .semibold)).foregroundStyle(tint.fg.opacity(0.85))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
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
