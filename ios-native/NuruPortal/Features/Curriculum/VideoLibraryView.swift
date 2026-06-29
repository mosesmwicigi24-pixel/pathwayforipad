// Video Library — a native SwiftUI port of the WEB admin portal's VideoLibrary.tsx
// (packages/admin-web/src/components/pages/VideoLibrary.tsx), matched section-for-
// section: navy hero (4 stats + chips), the amber "module-gated" banner, 4 pastel
// KPI cards, the Upload dropzone + Register-external cards (presentation), the
// Processing queue, and the Video Assets list/grid with Status/Source/Level/Attached
// filters and per-asset cards. Wired to PortalAPI's live media list. Access stays
// module-gated (§1.9).
import SwiftUI

// MARK: - View model (computes the 4 summary counts off the /admin/media payload)

@MainActor
final class VideoLibraryVM: ObservableObject {
    @Published var assets: [MediaAssetRow] = []
    @Published var stuck = 0
    @Published var total = 0
    @Published var loading = true
    @Published var error: String?

    func load() async {
        loading = true
        do {
            let r = try await APIClient.shared.get("/admin/media", as: MediaListResponse.self)
            assets = r.data
            stuck = r.stuck
            total = r.total > 0 ? r.total : r.data.count
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }

    // The 4 summary counts come straight from the list payload (mirrors the web).
    var totalCount: Int { assets.count }
    var ready: Int { assets.filter { $0.status == "ready" }.count }
    var processing: Int { assets.filter { $0.status == "transcoding" || $0.status == "uploading" }.count }
    var failed: Int { assets.filter { $0.status == "failed" }.count }
}

// MARK: - Status / source helpers (port of web's uiStatus + providerMeta)

private enum UiStatus: String {
    case ready = "Ready", uploading = "Uploading", transcoding = "Transcoding"
    case failed = "Failed", stuck = "Stuck", unattached = "Unattached"

    var bg: Color { switch self {
        case .ready:       return Color(hex: 0xE8F6EC)
        case .uploading:   return Color(hex: 0xE0F2FE)
        case .transcoding: return Color(hex: 0xF3E8FF)
        case .failed:      return Color(hex: 0xFEF2F2)
        case .stuck:       return Color(hex: 0xFEF3C7)
        case .unattached:  return Color(hex: 0xF3F4F6)
    } }
    var fg: Color { switch self {
        case .ready:       return Color(hex: 0x16A34A)
        case .uploading:   return Color(hex: 0x0369A1)
        case .transcoding: return Color(hex: 0x7E22CE)
        case .failed:      return Color(hex: 0xDC2626)
        case .stuck:       return Color(hex: 0x92400E)
        case .unattached:  return Color(hex: 0x6B7280)
    } }
}

private func uiStatus(_ a: MediaAssetRow) -> UiStatus {
    switch a.status {
    case "failed":      return .failed
    case "uploading":   return .uploading
    case "transcoding": return .transcoding
    case "stuck":       return .stuck
    default:            return a.attachedModuleTitle != nil ? .ready : .unattached
    }
}

private struct ProviderMeta { let label: String; let bg: Color; let fg: Color; let icon: String }
private func providerMeta(_ source: String) -> ProviderMeta {
    switch source {
    case "cloudinary": return .init(label: "Hosted",  bg: Color(hex: 0xEAF2FB), fg: Color(hex: 0x1F3A6B), icon: "film")
    case "youtube":    return .init(label: "YouTube", bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xC4302B), icon: "tv")
    case "vimeo":      return .init(label: "Vimeo",   bg: Color(hex: 0xE6F4FB), fg: Color(hex: 0x1295C4), icon: "link")
    case "private":    return .init(label: "Private", bg: Color(hex: 0xE6F7EF), fg: Color(hex: 0x0F766E), icon: "checkmark.shield")
    default:           return .init(label: "Link",    bg: Color(hex: 0xEEF1F8), fg: Color(hex: 0x1F3A6B), icon: "link")
    }
}
private let EXTERNAL: Set<String> = ["youtube", "vimeo", "direct", "private"]

private func assetTitle(_ a: MediaAssetRow) -> String {
    if let m = a.attachedModuleTitle, !m.isEmpty { return m }
    if let c = a.caption, !c.isEmpty { return c }
    let k = a.kind.replacingOccurrences(of: "_", with: " ")
    return "\(k) · \(String(a.mediaAssetId.prefix(8)))"
}
private func durText(_ s: Int?) -> String {
    guard let s, s > 0 else { return "—" }
    return String(format: "%d:%02d", s / 60, s % 60)
}
private func hueOf(_ id: String) -> Double {
    var h = 0
    for c in id.unicodeScalars { h = (h &* 31 &+ Int(c.value)) % 360 }
    return Double(h)
}

// MARK: - Root

struct VideoLibraryView: View {
    @StateObject private var vm = VideoLibraryVM()

    // Local UI filters (web's statusFilter/sourceFilter/levelFilter/attachedFilter + view).
    @State private var view: ViewMode = .table
    @State private var query = ""
    @State private var statusFilter = "All"
    @State private var sourceFilter = "All"
    @State private var levelFilter = "All"
    @State private var attachedFilter = "All"
    @State private var selected: MediaAssetRow?

    private enum ViewMode { case table, grid }

    private let grid = [GridItem(.adaptive(minimum: 260), spacing: 20)]

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 20) {
                    if let e = vm.error {
                        Text(e).font(.nCaption).foregroundStyle(Nuru.danger)
                    }
                    gatedBanner
                    kpiCards
                    uploadAndQueue
                    assetsLibrary
                }
                .padding(.horizontal, 22)
                .padding(.top, 24)
                .padding(.bottom, 48)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if vm.assets.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .sheet(item: $selected) { a in PreviewSheet(asset: a) }
    }

    // ────── HERO ──────
    private var hero: some View {
        PortalHero(
            breadcrumb: ["Nuru Pathway", "Curriculum", "Video Library"],
            title: "Video Library",
            stats: [
                HeroStat(label: "Total assets", value: "\(vm.totalCount)", hint: "in the library"),
                HeroStat(label: "Ready",        value: "\(vm.ready)",
                         hint: vm.totalCount > 0 ? "\(Int((Double(vm.ready) / Double(vm.totalCount) * 100).rounded()))% of library" : "—"),
                HeroStat(label: "Processing",   value: "\(vm.processing)", hint: "uploading / transcoding"),
                HeroStat(label: "Failed",       value: "\(vm.failed + vm.stuck)", hint: "failed / stuck"),
            ]
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "Self-hosted · your storage", icon: "sparkles", style: .tag)
                HeroChip(label: "Curriculum", icon: "gearshape", style: .ghost)
                HeroChip(label: "Register external", icon: "link", style: .ghost)
                HeroChip(label: "Upload video", icon: "plus", style: .gold)
            }
        }
    }

    // ────── Amber module-gated banner ──────
    private var gatedBanner: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Nuru.gold.opacity(0.18))
                Image(systemName: "lock.fill").font(.system(size: 14)).foregroundStyle(Color(hex: 0x7A5410))
            }.frame(width: 32, height: 32)
            (Text("Video access is module-gated. ").font(.inter(13, .bold))
             + Text("Members watch a video only when its attached module is unlocked for them.").font(.inter(13)))
                .foregroundStyle(Color(hex: 0x7A5410))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Color(hex: 0xFDF5E5))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Color(hex: 0xF2E2BD), lineWidth: 1))
    }

    // ────── 4 pastel KPI cards ──────
    private var kpiCards: some View {
        let pct = vm.totalCount > 0 ? "\(Int((Double(vm.ready) / Double(vm.totalCount) * 100).rounded()))% of library" : "—"
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], spacing: 16) {
            kpiCard("Total video assets", vm.totalCount, "film", "in the library", tint: 1)
            kpiCard("Ready for members",  vm.ready, "checkmark.circle.fill", pct, tint: 2)
            kpiCard("Processing",         vm.processing, "arrow.triangle.2.circlepath", "uploading / transcoding", tint: 1)
            kpiCard("Failed",             vm.failed + vm.stuck, "exclamationmark.triangle.fill", "review and retry", tint: 4)
        }
    }
    private func kpiCard(_ label: String, _ value: Int, _ icon: String, _ sub: String, tint: Int) -> some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 8) {
                TintedIcon(systemName: icon, color: Nuru.tint(tint).fg, size: 34)
                Text(label.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                Text("\(value)").font(.fraunces(26, .semibold)).foregroundStyle(Nuru.navy)
                Text(sub).font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
    }

    // ────── Upload dropzone + Register external + Processing queue ──────
    private var uploadAndQueue: some View {
        VStack(spacing: 20) {
            uploadCard
            registerExternalCard
            processingQueueCard
        }
    }

    private var uploadCard: some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Upload a video").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
                Text("Choose a video — it uploads straight to your own storage (not Cloudinary) and is ready to attach.")
                    .font(.inter(12)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)

                VStack(spacing: 8) {
                    ZStack {
                        Circle().fill(Color(hex: 0xDBEAFE))
                        Image(systemName: "arrow.up").font(.system(size: 20, weight: .semibold)).foregroundStyle(Color(hex: 0x0369A1))
                    }.frame(width: 44, height: 44)
                    Text("Choose a video to upload").font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                    Text("MP4, MOV, WebM · up to 500 MB · stored on your own server")
                        .font(.inter(12)).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 26).padding(.horizontal, 16)
                .background(LinearGradient(colors: [Color(hex: 0xF8FAFC), Color(hex: 0xEFF6FF)], startPoint: .top, endPoint: .bottom))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color(hex: 0x93C5FD), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                .padding(.top, 16)

                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield").font(.system(size: 13)).foregroundStyle(Color(hex: 0x16A34A))
                    Text("Stored securely in your media library and attachable to any module.")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                }.padding(.top, 16)
            }
        }
    }

    private var registerExternalCard: some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Register an external video").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
                        Text("Paste a YouTube, Vimeo, direct or private (signed) URL — no transcode, ready instantly.")
                            .font(.inter(12)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Image(systemName: "link").font(.system(size: 16)).foregroundStyle(Nuru.gold)
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Image(systemName: "link").font(.system(size: 15)).foregroundStyle(Nuru.ink600)
                        Text("https://youtu.be/…  ·  vimeo.com/…  ·  Cloudflare/Bunny/Mux URL")
                            .font(.inter(13)).foregroundStyle(Nuru.ink400).lineLimit(1)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))

                    HStack(spacing: 8) {
                        Image(systemName: "play.rectangle").font(.system(size: 16)).foregroundStyle(Nuru.ink600)
                        Text("Paste a link above. We auto-detect the host (YouTube, Vimeo, direct, private).")
                            .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                    }
                }
                .padding(20)
                .background(LinearGradient(colors: [Color(hex: 0xFBFCFE), Color(hex: 0xF5F8FC)], startPoint: .top, endPoint: .bottom))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color(hex: 0xCBD5E1), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
            }
        }
    }

    private var processingQueueCard: some View {
        let queue = vm.assets.filter { $0.status != "ready" }
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Processing queue").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
                        Text("\(queue.count) in flight").font(.inter(12)).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                    Button { Task { await vm.load() } } label: {
                        Text("Refresh →").font(.inter(12, .semibold)).foregroundStyle(Nuru.gold)
                    }.buttonStyle(.plain)
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
                Divider().overlay(Nuru.border)

                if queue.isEmpty {
                    Text("Nothing processing — all assets are ready.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity).padding(.horizontal, 20).padding(.vertical, 24)
                } else {
                    ForEach(Array(queue.prefix(6).enumerated()), id: \.element.id) { i, q in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        HStack(spacing: 12) {
                            Thumb(asset: q, size: .sm)
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(assetTitle(q)).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                                    Spacer()
                                    StatusPill(status: uiStatus(q))
                                }
                                Text(Fmt.relative(q.createdAt)).font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                        }
                        .padding(.horizontal, 20).padding(.vertical, 12)
                    }
                }
            }
        }
    }

    // ────── Video Assets library (filters + table / grid) ──────

    private var filtered: [MediaAssetRow] {
        vm.assets.filter { a in
            // Failed/stuck live only in the queue + the Failed filter (web parity).
            if statusFilter != "Failed" && (a.status == "failed" || a.status == "stuck") { return false }
            if statusFilter == "Ready" && uiStatus(a) != .ready { return false }
            if statusFilter == "Unattached" && uiStatus(a) != .unattached { return false }
            if statusFilter == "Uploading" && a.status != "uploading" { return false }
            if statusFilter == "Transcoding" && a.status != "transcoding" { return false }
            if statusFilter == "Failed" && a.status != "failed" { return false }
            if sourceFilter != "All" && a.videoSource != sourceFilter { return false }
            if levelFilter != "All" && a.levelNumber.map(String.init) != levelFilter { return false }
            if attachedFilter == "Attached" && a.attachedModuleTitle == nil { return false }
            if attachedFilter == "Unattached" && a.attachedModuleTitle != nil { return false }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty {
                let q = query.lowercased()
                let hay = [assetTitle(a), a.caption ?? "", a.attachedModuleTitle ?? ""].joined(separator: " ").lowercased()
                if !hay.contains(q) { return false }
            }
            return true
        }
    }

    private var assetsLibrary: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // Header: title + search + filters + view toggle
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Video Assets").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
                            Text(vm.loading ? "Loading…" : "\(filtered.count) of \(vm.totalCount) assets")
                                .font(.inter(12)).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                        viewToggle
                    }
                    searchField
                    filterRow
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
                Divider().overlay(Nuru.border)

                if !vm.loading && filtered.isEmpty {
                    Text("No assets match.").font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity).padding(.vertical, 28)
                } else if view == .table {
                    ForEach(Array(filtered.enumerated()), id: \.element.id) { i, a in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        AssetRow(asset: a) { selected = a }
                    }
                } else {
                    LazyVGrid(columns: grid, spacing: 20) {
                        ForEach(filtered) { a in AssetGridCard(asset: a) { selected = a } }
                    }
                    .padding(20)
                }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink600)
            TextField("Search title, module, or caption", text: $query)
                .font(.inter(12)).textFieldStyle(.plain)
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var filterRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                FilterMenu(label: "Status", value: $statusFilter, icon: "line.3.horizontal.decrease",
                           options: ["All", "Ready", "Uploading", "Transcoding", "Failed", "Unattached"])
                FilterMenu(label: "Source", value: $sourceFilter,
                           options: ["All", "cloudinary", "youtube", "vimeo", "direct", "private"])
                FilterMenu(label: "Level", value: $levelFilter,
                           options: ["All", "1", "2", "3", "4", "5", "6"])
                FilterMenu(label: "Attached", value: $attachedFilter,
                           options: ["All", "Attached", "Unattached"])
            }
        }
    }

    private var viewToggle: some View {
        HStack(spacing: 0) {
            toggleButton("Table", "list.bullet", isOn: view == .table) { view = .table }
            toggleButton("Grid", "square.grid.2x2", isOn: view == .grid) { view = .grid }
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
    private func toggleButton(_ label: String, _ icon: String, isOn: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 4) {
                Image(systemName: icon).font(.system(size: 12))
                Text(label).font(.inter(12, .semibold))
            }
            .foregroundStyle(isOn ? .white : Nuru.ink)
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(isOn ? AnyShapeStyle(Nuru.navy) : AnyShapeStyle(Color.clear))
        }.buttonStyle(.plain)
    }
}

// MARK: - Filter menu (Status / Source / Level / Attached)

private struct FilterMenu: View {
    let label: String
    @Binding var value: String
    var icon: String? = nil
    let options: [String]
    private func cap(_ s: String) -> String { s == "All" ? "All" : s.prefix(1).uppercased() + s.dropFirst() }
    var body: some View {
        Menu {
            ForEach(options, id: \.self) { o in
                Button(cap(o)) { value = o }
            }
        } label: {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 11)) }
                Text(label.uppercased()).font(.inter(11, .medium)).tracking(0.5).foregroundStyle(Nuru.ink600)
                Text(cap(value)).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(Nuru.ink600)
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Nuru.ink600)
    }
}

// MARK: - Status pill + provider badge (port of web Pill / ProviderBadge)

private struct StatusPill: View {
    let status: UiStatus
    var body: some View {
        HStack(spacing: 4) {
            Circle().fill(status.fg).frame(width: 6, height: 6)
            Text(status.rawValue).font(.inter(11, .bold)).foregroundStyle(status.fg)
        }
        .padding(.horizontal, 10).padding(.vertical, 3)
        .background(status.bg).clipShape(Capsule())
    }
}

private struct ProviderBadge: View {
    let source: String
    var body: some View {
        let m = providerMeta(source)
        return HStack(spacing: 4) {
            Image(systemName: m.icon).font(.system(size: 9, weight: .semibold))
            Text(m.label).font(.inter(10.5, .bold))
        }
        .foregroundStyle(m.fg)
        .padding(.horizontal, 8).padding(.vertical, 2)
        .background(m.bg).clipShape(Capsule())
    }
}

// MARK: - Thumbnail (port of web Thumb — hue gradient + AsyncImage poster + play badge)

private struct Thumb: View {
    let asset: MediaAssetRow
    enum Size { case sm, md, lg }
    var size: Size = .md

    private var dims: (w: CGFloat?, h: CGFloat) {
        switch size { case .sm: return (64, 40); case .lg: return (nil, 180); case .md: return (96, 60) }
    }
    var body: some View {
        let hue = hueOf(asset.mediaAssetId)
        let status = uiStatus(asset)
        ZStack {
            LinearGradient(colors: [Color(hue: hue / 360, saturation: 0.35, brightness: 0.28),
                                    Color(hue: hue / 360, saturation: 0.25, brightness: 0.18)],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
            if let t = asset.thumbnailUrl, let url = URL(string: t), status != .failed {
                AsyncImage(url: url) { img in img.resizable().aspectRatio(contentMode: .fill) }
                    placeholder: { Color.clear }
            }
            ZStack {
                Circle().fill(.black.opacity(0.45))
                Image(systemName: status == .failed ? "exclamationmark.triangle.fill" : "play.fill")
                    .font(.system(size: size == .sm ? 10 : 13)).foregroundStyle(.white)
            }.frame(width: size == .sm ? 20 : 32, height: size == .sm ? 20 : 32)

            if durText(asset.durationSec) != "—" && size != .sm {
                Text(durText(asset.durationSec))
                    .font(.inter(10, .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(.black.opacity(0.65)).clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                    .padding(6)
            }
        }
        .frame(width: dims.w, height: dims.h)
        .frame(maxWidth: size == .lg ? .infinity : nil)
        .clipShape(RoundedRectangle(cornerRadius: size == .lg ? 12 : 8, style: .continuous))
    }
}

// MARK: - Table row (web table mode, condensed for the native list)

private struct AssetRow: View {
    let asset: MediaAssetRow
    let onView: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Thumb(asset: asset, size: .md)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(assetTitle(asset)).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                    ProviderBadge(source: asset.videoSource)
                }
                HStack(spacing: 6) {
                    Text(asset.attachedModuleTitle ?? "Not attached")
                        .font(.inter(12))
                        .foregroundStyle(asset.attachedModuleTitle != nil ? Nuru.ink : Nuru.ink600)
                        .italic(asset.attachedModuleTitle == nil)
                        .lineLimit(1)
                    if let lvl = asset.levelNumber {
                        Text("· Level \(lvl)").font(.inter(12)).foregroundStyle(Nuru.ink600)
                    }
                }
                HStack(spacing: 8) {
                    StatusPill(status: uiStatus(asset))
                    Text(durText(asset.durationSec)).font(.inter(11, .medium)).foregroundStyle(Nuru.ink600)
                    Text("· \(Fmt.relative(asset.createdAt))").font(.inter(11)).foregroundStyle(Nuru.ink600)
                }
            }
            Spacer(minLength: 0)
            Button(action: onView) {
                Text("View").font(.inter(11, .semibold)).foregroundStyle(Nuru.ink)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture(perform: onView)
    }
}

// MARK: - Grid card (web grid mode)

private struct AssetGridCard: View {
    let asset: MediaAssetRow
    let onView: () -> Void
    var body: some View {
        let status = uiStatus(asset)
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .top) {
                    Thumb(asset: asset, size: .lg)
                    HStack {
                        StatusPill(status: status)
                        Spacer()
                        ProviderBadge(source: asset.videoSource)
                    }
                    .padding(8)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(assetTitle(asset)).font(.inter(14, .bold)).foregroundStyle(Nuru.ink).lineLimit(2)
                    Text(asset.attachedModuleTitle ?? "Not attached to a module")
                        .font(.inter(12))
                        .foregroundStyle(asset.attachedModuleTitle != nil ? Nuru.ink : Nuru.ink600)
                        .italic(asset.attachedModuleTitle == nil)
                        .lineLimit(1)
                    HStack(spacing: 6) {
                        Text(durText(asset.durationSec)).font(.inter(11, .medium))
                        Text("·"); Text(providerMeta(asset.videoSource).label).font(.inter(11, .medium))
                        Text("·"); Text(Fmt.relative(asset.createdAt)).font(.inter(11))
                    }
                    .foregroundStyle(Nuru.ink600).padding(.top, 2)

                    Group {
                        if status == .ready {
                            CompletionBar(value: asset.completion ?? 0, views: asset.views ?? 0)
                        } else {
                            Text(status == .failed ? "Re-link to track engagement" : "Not released to members yet")
                                .font(.inter(10.5, .semibold)).foregroundStyle(Nuru.ink600)
                        }
                    }.padding(.top, 6)

                    Divider().overlay(Nuru.border).padding(.top, 10)
                    Button(action: onView) {
                        Text("View").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                            .frame(maxWidth: .infinity).padding(.vertical, 8)
                            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain).padding(.top, 10)
                }
                .padding(16)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: onView)
    }
}

// MARK: - Completion bar (web CompletionBar)

private struct CompletionBar: View {
    let value: Double
    let views: Int
    var hideViews = false
    var body: some View {
        let v = min(max(value, 0), 100)
        let fill = v >= 70 ? Color(hex: 0x16A34A) : v >= 40 ? Nuru.gold : Color(hex: 0x94A3B8)
        HStack(spacing: 8) {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Nuru.inputBg)
                    Capsule().fill(fill).frame(width: geo.size.width * v / 100)
                }
            }.frame(height: 5)
            Text("\(Int(v))% watched" + (hideViews ? "" : " · \(views) views"))
                .font(.inter(10.5, .bold)).foregroundStyle(Nuru.ink600).fixedSize()
        }
    }
}

// MARK: - Preview sheet (port of web PreviewDrawer — read-only detail)

private struct PreviewSheet: View {
    let asset: MediaAssetRow
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let us = uiStatus(asset)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Thumb(asset: asset, size: .lg).frame(height: 200)

                    HStack(spacing: 6) {
                        StatusPill(status: us)
                        ProviderBadge(source: asset.videoSource)
                        HStack(spacing: 4) {
                            Image(systemName: "lock.fill").font(.system(size: 9))
                            Text("Contained · no click-out").font(.inter(10.5, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x1F3A6B))
                        .padding(.horizontal, 8).padding(.vertical, 2)
                        .background(Color(hex: 0xEEF1F8)).clipShape(Capsule())
                    }

                    Text(assetTitle(asset)).font(.fraunces(22, .semibold)).foregroundStyle(Nuru.ink)
                    HStack(spacing: 8) {
                        Text(durText(asset.durationSec)); Text("·")
                        Text(providerMeta(asset.videoSource).label); Text("·"); Text(us.rawValue)
                    }
                    .font(.inter(12, .medium)).foregroundStyle(Nuru.ink600)

                    LazyVGrid(columns: [GridItem(.flexible(), alignment: .leading),
                                        GridItem(.flexible(), alignment: .leading)], spacing: 12) {
                        detail("Kind", asset.kind.replacingOccurrences(of: "_", with: " "))
                        detail("Uploaded", Fmt.relative(asset.createdAt))
                        detail("Source", providerMeta(asset.videoSource).label)
                        detail("Delivery", deliveryText(us))
                        detail("Attached module", asset.attachedModuleTitle ?? "Not attached")
                        detail("Level", asset.levelNumber.map { "Level \($0)" } ?? "—")
                    }

                    if let url = asset.externalUrl {
                        HStack(spacing: 8) {
                            Image(systemName: "link").font(.system(size: 13)).foregroundStyle(Nuru.ink600)
                            Text(url).font(.inter(11.5, .medium)).foregroundStyle(Nuru.ink600).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .padding(10).background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }

                    // Member engagement
                    SurfaceTile {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("MEMBER ENGAGEMENT").font(.inter(12, .bold)).tracking(0.5).foregroundStyle(Nuru.ink)
                                Spacer()
                                Text("\(asset.views ?? 0) views").font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                            CompletionBar(value: asset.completion ?? 0, views: asset.views ?? 0, hideViews: true)
                        }
                    }

                    // Gating note
                    gatingNote
                }
                .padding(20)
            }
            .background(Nuru.paper)
            .navigationTitle("Video")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }

    private func detail(_ l: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(l.uppercased()).font(.inter(10)).tracking(0.5).foregroundStyle(Nuru.ink600)
            Text(v).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
        }
    }
    private func deliveryText(_ us: UiStatus) -> String {
        if us == .failed { return "Link broken" }
        if EXTERNAL.contains(asset.videoSource) {
            return asset.videoSource == "private" ? "Signed · expiring" : "\(providerMeta(asset.videoSource).label) embed"
        }
        return "Gated HLS"
    }
    @ViewBuilder private var gatingNote: some View {
        if EXTERNAL.contains(asset.videoSource) && asset.videoSource != "private" {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "lock.fill").font(.system(size: 13)).foregroundStyle(Color(hex: 0xA87616))
                Text("External links are best-effort gated — not hard-gated. Choose Private (signed) or hosted upload for true gating.")
                    .font(.inter(12)).foregroundStyle(Color(hex: 0x7A5410)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(12).background(Color(hex: 0xFFFBEB))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
        } else {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "checkmark.shield").font(.system(size: 13)).foregroundStyle(Color(hex: 0x0F766E))
                Text("Truly gated. Delivery is via signed, expiring URLs only for members with the module unlocked.")
                    .font(.inter(12)).foregroundStyle(Color(hex: 0x0F5132)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(12).background(Color(hex: 0xE6F7EF))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xBBE5C9), lineWidth: 1))
        }
    }
}
