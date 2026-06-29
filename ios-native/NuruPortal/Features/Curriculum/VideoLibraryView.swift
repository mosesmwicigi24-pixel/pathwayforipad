// Video Library — a native SwiftUI port of the WEB admin portal's VideoLibrary.tsx
// (packages/admin-web/src/components/pages/VideoLibrary.tsx), matched section-for-
// section AND wired action-for-action to the same live media API the web hits:
//   • Register external video   POST   /admin/media/external          (MediaApi.registerExternal)
//   • Refresh processing queue  GET    /admin/media                   (MediaApi.list)
//   • Set / clear homepage      POST / DELETE /admin/media/:id/homepage
//   • Archive / delete asset    DELETE /admin/media/:id               (MediaApi.archive)
//   • Hosted upload             PUT /admin/media/videos/chunk + POST …/videos/finalize
//   • Caption / level edit      PATCH  /admin/media/:id               (MediaApi.patchAsset)
// Filters (Status/Source/Level/Attached) + table/grid toggle stay client-side, as on
// the web. Every write refetches the list. Access stays module-gated (§1.9).
//
// The shared MediaAssetRow (Models.swift) lacks is_homepage / external_video_id /
// attached_module_id, which several of these actions need, so this file decodes a
// page-local richer model (MediaAssetFull) instead — Models.swift is not edited.
import SwiftUI
import UniformTypeIdentifiers

// MARK: - Page-local rich media model (superset of the shared MediaAssetRow)

/// Tolerant decode of /admin/media rows including the homepage / external-id / module
/// fields the shared row omits. All optionals so partial server projections still decode.
struct MediaAssetFull: Codable, Identifiable {
    @DefaultEmpty var mediaAssetId: String
    @DefaultEmpty var kind: String
    @DefaultEmpty var status: String
    @DefaultEmpty var videoSource: String
    let externalUrl: String?
    let externalVideoId: String?
    let caption: String?
    let levelNumber: Int?
    let thumbnailUrl: String?
    let durationSec: Int?
    @DefaultEmpty var createdAt: String
    let attachedModuleId: String?
    let attachedModuleTitle: String?
    let views: Int?
    let completion: Double?
    @DefaultFalse var isHomepage: Bool
    let errorDetail: String?
    var id: String { mediaAssetId }
}
private struct MediaListFullResponse: Codable {
    let data: [MediaAssetFull]
    @DefaultZero var stuck: Int
    @DefaultZero var total: Int
}

// MARK: - View model (live media list + writes; computes the 4 summary counts)

@MainActor
final class VideoLibraryVM: ObservableObject {
    @Published var assets: [MediaAssetFull] = []
    @Published var stuck = 0
    @Published var total = 0
    @Published var loading = true
    @Published var error: String?
    @Published var notice: String?
    @Published var working = false

    func load() async {
        loading = true
        do {
            let r = try await APIClient.shared.get("/admin/media", as: MediaListFullResponse.self)
            assets = r.data
            stuck = r.stuck
            total = r.total > 0 ? r.total : r.data.count
            error = nil
        } catch {
            self.error = Self.message(error)
        }
        loading = false
    }

    static func message(_ error: Error) -> String {
        (error as? APIError)?.errorDescription ?? error.localizedDescription
    }

    // ── Writes (each refetches the list afterwards, mirroring the web) ──

    /// POST /admin/media/external — register a YouTube/Vimeo/direct/private URL.
    func registerExternal(_ input: RegisterExternalBody) async -> Bool {
        working = true; defer { working = false }
        do {
            _ = try await APIClient.shared.post("/admin/media/external", body: input, as: WriteAck.self)
            await load()
            notice = "External video registered."
            error = nil
            return true
        } catch { self.error = Self.message(error); return false }
    }

    /// POST / DELETE /admin/media/:id/homepage — the single mobile-app welcome video.
    func toggleHomepage(_ a: MediaAssetFull) async {
        working = true; defer { working = false }
        do {
            if a.isHomepage {
                _ = try await APIClient.shared.delete("/admin/media/\(a.mediaAssetId)/homepage", as: WriteAck.self)
                notice = "Removed from the homepage."
            } else {
                _ = try await APIClient.shared.postEmpty("/admin/media/\(a.mediaAssetId)/homepage", as: WriteAck.self)
                notice = "“\(assetTitle(a))” is now the single mobile-app welcome video."
            }
            await load(); error = nil
        } catch { self.error = Self.message(error) }
    }

    /// DELETE /admin/media/:id — archive (soft delete).
    func archive(_ a: MediaAssetFull) async {
        working = true; defer { working = false }
        do {
            _ = try await APIClient.shared.delete("/admin/media/\(a.mediaAssetId)", as: WriteAck.self)
            await load()
            notice = "Video archived."; error = nil
        } catch { self.error = Self.message(error) }
    }

    /// PATCH /admin/media/:id — caption / level edits.
    func patch(_ a: MediaAssetFull, caption: String?, levelNumber: Int?) async {
        working = true; defer { working = false }
        do {
            _ = try await APIClient.shared.patch("/admin/media/\(a.mediaAssetId)",
                                                 body: PatchAssetBody(caption: caption, levelNumber: levelNumber),
                                                 as: WriteAck.self)
            await load()
            notice = "Saved."; error = nil
        } catch { self.error = Self.message(error) }
    }

    // The 4 summary counts come straight from the list payload (mirrors the web).
    var totalCount: Int { assets.count }
    var ready: Int { assets.filter { $0.status == "ready" }.count }
    var processing: Int { assets.filter { $0.status == "transcoding" || $0.status == "uploading" }.count }
    var failed: Int { assets.filter { $0.status == "failed" }.count }
}

// MARK: - Request bodies + tolerant write acks (encoded via convertToSnakeCase)

struct RegisterExternalBody: Encodable {
    let videoSource: String
    let url: String
    let title: String?
    let caption: String?
    let levelNumber: Int?
}
private struct PatchAssetBody: Encodable {
    let caption: String?
    let levelNumber: Int?  // nil = leave; the web sends null to clear — see encode below
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        if let caption { try c.encode(caption, forKey: .caption) }
        // Always send level_number (incl. null) so clearing it works, matching the web.
        try c.encode(levelNumber, forKey: .levelNumber)
    }
    enum CodingKeys: String, CodingKey { case caption, levelNumber }
}
/// Writes return small/varied JSON (e.g. { archived: true }, { is_homepage: true },
/// or the patched row). We don't read the body, so decode permissively.
private struct WriteAck: Decodable {
    init(from decoder: Decoder) throws {}
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

private func uiStatus(_ a: MediaAssetFull) -> UiStatus {
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

private func assetTitle(_ a: MediaAssetFull) -> String {
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
    @State private var selected: MediaAssetFull?
    @State private var deleteFor: MediaAssetFull?

    // Register-external + upload UI state.
    @State private var showRegister = false
    @State private var showFileImporter = false
    @StateObject private var uploader = ChunkUploader()

    private enum ViewMode { case table, grid }

    private let grid = [GridItem(.adaptive(minimum: 260), spacing: 20)]

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 20) {
                    if let n = vm.notice {
                        Text(n).font(.nCaption).foregroundStyle(Color(hex: 0x0F6B33))
                    }
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
        // Preview sheet — wired with the same per-asset actions as the web drawer.
        .sheet(item: $selected) { a in
            PreviewSheet(
                asset: a,
                working: vm.working,
                onToggleHomepage: { Task { await vm.toggleHomepage(a); selected = nil } },
                onDelete: { selected = nil; deleteFor = a },
                onSaveMeta: { caption, level in Task { await vm.patch(a, caption: caption, levelNumber: level) } }
            )
        }
        // Register-external sheet (POST /admin/media/external).
        .sheet(isPresented: $showRegister) {
            RegisterExternalSheet(working: vm.working) { body in
                let ok = await vm.registerExternal(body)
                if ok { showRegister = false }
                return ok
            }
        }
        // Hosted upload — basic native file picker → chunked PUT + finalize.
        .fileImporter(isPresented: $showFileImporter,
                      allowedContentTypes: [.movie, .mpeg4Movie, .quickTimeMovie, .video],
                      allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls):
                if let url = urls.first {
                    Task {
                        await uploader.upload(url)
                        if uploader.error == nil { await vm.load() }
                    }
                }
            case .failure(let err):
                uploader.error = err.localizedDescription
            }
        }
        // Confirm archive/delete (web requires typing DELETE; native uses a destructive alert).
        .alert("Delete video asset?", isPresented: Binding(get: { deleteFor != nil }, set: { if !$0 { deleteFor = nil } })) {
            Button("Cancel", role: .cancel) { deleteFor = nil }
            Button("Delete video", role: .destructive) {
                if let a = deleteFor { Task { await vm.archive(a) } }
                deleteFor = nil
            }
        } message: {
            if let a = deleteFor {
                Text("This archives “\(assetTitle(a))”." + (a.attachedModuleTitle != nil ? " It is attached to \(a.attachedModuleTitle!) — members will no longer see it there." : ""))
            }
        }
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
                HeroChip(label: "Register external", icon: "link", style: .ghost,
                         action: { showRegister = true })
                HeroChip(label: uploader.busy ? "Uploading…" : "Upload video", icon: "plus", style: .gold,
                         action: { if !uploader.busy { showFileImporter = true } })
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

                // While a chunked upload is in flight, the dropzone shows live progress;
                // otherwise it's a tappable affordance that opens the OS file picker.
                if uploader.busy || uploader.stage == .done {
                    uploadProgress
                        .padding(.top, 16)
                } else {
                    Button { showFileImporter = true } label: {
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
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 16)
                }

                if let e = uploader.error {
                    Text(e).font(.nMicro).foregroundStyle(Nuru.danger).padding(.top, 8)
                }

                HStack(spacing: 8) {
                    Image(systemName: "checkmark.shield").font(.system(size: 13)).foregroundStyle(Color(hex: 0x16A34A))
                    Text("Stored securely in your media library and attachable to any module.")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                }.padding(.top, 16)
            }
        }
    }

    private var uploadProgress: some View {
        let done = uploader.stage == .done
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(done ? Color(hex: 0xDCFCE7) : Color(hex: 0xDBEAFE))
                    if done {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 20)).foregroundStyle(Color(hex: 0x16A34A))
                    } else {
                        ProgressView().tint(Color(hex: 0x0369A1))
                    }
                }.frame(width: 40, height: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(uploader.name ?? "Video").font(.inter(13, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(done ? "Upload complete — listed below"
                         : uploader.stage == .finalizing ? "Finalizing — registering in the library…"
                         : "Uploading… \(fmtBytes(uploader.loaded)) / \(fmtBytes(uploader.totalBytes))")
                        .font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                }
                Spacer(minLength: 0)
                Text(done ? "100%" : "\(uploader.pct)%")
                    .font(.inter(15, .bold)).foregroundStyle(done ? Color(hex: 0x16A34A) : Nuru.navy)
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color(hex: 0xE2E8F0))
                    Capsule().fill(done ? Color(hex: 0x16A34A) : Nuru.gold)
                        .frame(width: geo.size.width * Double(done ? 100 : uploader.pct) / 100)
                }
            }.frame(height: 8)
        }
        .padding(18)
        .background(LinearGradient(colors: [Color(hex: 0xF8FAFC), Color(hex: 0xEFF6FF)], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .strokeBorder(Color(hex: 0x93C5FD), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
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

                Button { showRegister = true } label: {
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
                            Image(systemName: "plus.circle").font(.system(size: 16)).foregroundStyle(Nuru.gold)
                            Text("Tap to paste a link — we auto-detect the host (YouTube, Vimeo, direct, private).")
                                .font(.inter(12.5)).foregroundStyle(Nuru.ink600).multilineTextAlignment(.leading)
                            Spacer(minLength: 0)
                        }
                    }
                    .padding(20)
                    .background(LinearGradient(colors: [Color(hex: 0xFBFCFE), Color(hex: 0xF5F8FC)], startPoint: .top, endPoint: .bottom))
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color(hex: 0xCBD5E1), style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
                }
                .buttonStyle(.plain)
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
                                HStack {
                                    Text(Fmt.relative(q.createdAt)).font(.nMicro).foregroundStyle(Nuru.ink600)
                                    Spacer()
                                    if q.status == "failed" {
                                        Text(q.errorDetail ?? "Failed").font(.inter(11, .semibold)).foregroundStyle(Nuru.danger).lineLimit(1)
                                    }
                                }
                            }
                        }
                        .padding(.horizontal, 20).padding(.vertical, 12)
                    }
                }
            }
        }
    }

    // ────── Video Assets library (filters + table / grid) ──────

    private var filtered: [MediaAssetFull] {
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
                        AssetRow(asset: a, working: vm.working,
                                 onView: { selected = a },
                                 onToggleHomepage: { Task { await vm.toggleHomepage(a) } },
                                 onCopyURL: { copyURL(a) },
                                 onDelete: { deleteFor = a })
                    }
                } else {
                    LazyVGrid(columns: grid, spacing: 20) {
                        ForEach(filtered) { a in
                            AssetGridCard(asset: a, working: vm.working,
                                          onView: { selected = a },
                                          onToggleHomepage: { Task { await vm.toggleHomepage(a) } },
                                          onCopyURL: { copyURL(a) },
                                          onDelete: { deleteFor = a })
                        }
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

    /// Copy a video's shareable delivery URL to the pasteboard (web's copyUrl).
    private func copyURL(_ a: MediaAssetFull) {
        guard let url = a.externalUrl, !url.isEmpty else {
            vm.error = "This asset has no shareable URL to copy."; return
        }
        UIPasteboard.general.string = url
        vm.error = nil
        vm.notice = "✓ Video URL copied to the clipboard."
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
    let asset: MediaAssetFull
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
    let asset: MediaAssetFull
    let working: Bool
    let onView: () -> Void
    let onToggleHomepage: () -> Void
    let onCopyURL: () -> Void
    let onDelete: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Thumb(asset: asset, size: .md)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(assetTitle(asset)).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                    ProviderBadge(source: asset.videoSource)
                    if asset.isHomepage { HomepageBadge() }
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
            // Per-asset actions (web's row buttons: View · URL · Attach▾/homepage · trash).
            AssetActionMenu(asset: asset, working: working,
                            onView: onView, onToggleHomepage: onToggleHomepage,
                            onCopyURL: onCopyURL, onDelete: onDelete)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture(perform: onView)
    }
}

/// Homepage chip (web's amber "Homepage" tag).
private struct HomepageBadge: View {
    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: "sparkles").font(.system(size: 9))
            Text("Homepage").font(.inter(10, .bold))
        }
        .foregroundStyle(Color(hex: 0x8B6914))
        .padding(.horizontal, 8).padding(.vertical, 2)
        .background(Color(hex: 0xC89B3C).opacity(0.16)).clipShape(Capsule())
    }
}

/// View + an overflow menu with the per-asset writes that have live endpoints:
/// set/clear homepage, copy URL, delete (archive). Attach-to-module is preview-only.
private struct AssetActionMenu: View {
    let asset: MediaAssetFull
    let working: Bool
    let onView: () -> Void
    let onToggleHomepage: () -> Void
    let onCopyURL: () -> Void
    let onDelete: () -> Void
    var body: some View {
        HStack(spacing: 6) {
            Button(action: onView) {
                Text("View").font(.inter(11, .semibold)).foregroundStyle(Nuru.ink)
                    .padding(.horizontal, 10).padding(.vertical, 6)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain)
            Menu {
                if asset.externalUrl != nil {
                    Button { onCopyURL() } label: { Label("Copy video URL", systemImage: "doc.on.doc") }
                }
                if asset.status != "failed" {
                    Button { onToggleHomepage() } label: {
                        Label(asset.isHomepage ? "Remove from homepage" : "Set as homepage video",
                              systemImage: asset.isHomepage ? "house.slash" : "house")
                    }
                }
                Button(role: .destructive) { onDelete() } label: { Label("Delete", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.ink600)
                    .frame(width: 30, height: 28)
                    .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(working)
        }
    }
}

// MARK: - Grid card (web grid mode)

private struct AssetGridCard: View {
    let asset: MediaAssetFull
    let working: Bool
    let onView: () -> Void
    let onToggleHomepage: () -> Void
    let onCopyURL: () -> Void
    let onDelete: () -> Void
    var body: some View {
        let status = uiStatus(asset)
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                ZStack(alignment: .top) {
                    Thumb(asset: asset, size: .lg)
                    HStack {
                        StatusPill(status: status)
                        Spacer()
                        if asset.isHomepage { HomepageBadge() }
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
                    HStack(spacing: 8) {
                        Button(action: onView) {
                            Text("View").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                .frame(maxWidth: .infinity).padding(.vertical, 8)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }.buttonStyle(.plain)
                        Menu {
                            if asset.externalUrl != nil {
                                Button { onCopyURL() } label: { Label("Copy video URL", systemImage: "doc.on.doc") }
                            }
                            if asset.status != "failed" {
                                Button { onToggleHomepage() } label: {
                                    Label(asset.isHomepage ? "Remove from homepage" : "Set as homepage video",
                                          systemImage: asset.isHomepage ? "house.slash" : "house")
                                }
                            }
                            Button(role: .destructive) { onDelete() } label: { Label("Delete", systemImage: "trash") }
                        } label: {
                            Image(systemName: "ellipsis").font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.ink600)
                                .frame(width: 36, height: 32)
                                .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        }.buttonStyle(.plain).disabled(working)
                    }.padding(.top, 10)
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
    let asset: MediaAssetFull
    let working: Bool
    let onToggleHomepage: () -> Void
    let onDelete: () -> Void
    let onSaveMeta: (_ caption: String?, _ levelNumber: Int?) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var caption: String = ""
    @State private var level: String = ""   // "" = none

    private var captionDirty: Bool { caption.trimmingCharacters(in: .whitespaces) != (asset.caption ?? "") }
    private var levelDirty: Bool { (level.isEmpty ? nil : Int(level)) != asset.levelNumber }

    var body: some View {
        let us = uiStatus(asset)
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Thumb(asset: asset, size: .lg).frame(height: 200)

                    HStack(spacing: 6) {
                        StatusPill(status: us)
                        ProviderBadge(source: asset.videoSource)
                        if asset.isHomepage { HomepageBadge() }
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
                            Button { UIPasteboard.general.string = url } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "doc.on.doc").font(.system(size: 11))
                                    Text("Copy").font(.inter(11, .bold))
                                }
                                .foregroundStyle(.white)
                                .padding(.horizontal, 8).padding(.vertical, 5)
                                .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }.buttonStyle(.plain)
                        }
                        .padding(10).background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }

                    // Edit metadata (PATCH /admin/media/:id — caption + level)
                    editMetadata

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

                    // Homepage welcome video toggle (POST/DELETE …/homepage)
                    homepageToggle(us)

                    // Delete (DELETE /admin/media/:id — archives)
                    Button(role: .destructive, action: onDelete) {
                        HStack(spacing: 6) {
                            Image(systemName: "trash").font(.system(size: 12))
                            Text("Delete").font(.inter(12, .semibold))
                        }
                        .foregroundStyle(Nuru.danger)
                        .frame(maxWidth: .infinity).padding(.vertical, 10)
                        .background(Color(hex: 0xFEF2F2)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Color(hex: 0xFCA5A5), lineWidth: 1))
                    }.buttonStyle(.plain).disabled(working)
                }
                .padding(20)
            }
            .background(Nuru.paper)
            .navigationTitle("Video")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .onAppear {
                caption = asset.caption ?? ""
                level = asset.levelNumber.map(String.init) ?? ""
            }
        }
    }

    // ── Editable caption + level (PATCH) ──
    @ViewBuilder private var editMetadata: some View {
        SurfaceTile {
            VStack(alignment: .leading, spacing: 10) {
                Text("EDIT METADATA").font(.inter(12, .bold)).tracking(0.5).foregroundStyle(Nuru.ink)
                TextField("Caption — a short line shown with the video", text: $caption)
                    .font(.inter(12.5)).textFieldStyle(.plain)
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                HStack(spacing: 8) {
                    Text("LEVEL").font(.inter(11, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    Menu {
                        Button("None") { level = "" }
                        ForEach(1...6, id: \.self) { n in Button("Level \(n)") { level = String(n) } }
                    } label: {
                        HStack(spacing: 6) {
                            Text(level.isEmpty ? "None" : "Level \(level)").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink)
                            Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(Nuru.ink600)
                        }
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }.buttonStyle(.plain)
                    Spacer()
                }
                Button {
                    onSaveMeta(caption.trimmingCharacters(in: .whitespaces), level.isEmpty ? nil : Int(level))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.system(size: 11))
                        Text("Save changes").font(.inter(12, .bold))
                    }
                    .foregroundStyle((captionDirty || levelDirty) ? .white : Nuru.ink600)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background((captionDirty || levelDirty) ? AnyShapeStyle(Nuru.navy) : AnyShapeStyle(Nuru.inputBg))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }.buttonStyle(.plain).disabled((!captionDirty && !levelDirty) || working)
            }
        }
    }

    // ── Homepage welcome video toggle ──
    @ViewBuilder private func homepageToggle(_ us: UiStatus) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(asset.isHomepage ? Nuru.gold : Nuru.inputBg)
                Image(systemName: "sparkles").font(.system(size: 15)).foregroundStyle(asset.isHomepage ? .white : Nuru.ink600)
            }.frame(width: 32, height: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text("Mobile homepage welcome video").font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                Text("The single mobile-app welcome video — setting this clears any other.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Toggle("", isOn: Binding(get: { asset.isHomepage }, set: { _ in onToggleHomepage() }))
                .labelsHidden().tint(Nuru.gold)
                .disabled(us != .ready || working)
        }
        .padding(12)
        .background(asset.isHomepage ? Nuru.gold.opacity(0.1) : Nuru.inputBg)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous)
            .stroke(asset.isHomepage ? Nuru.gold.opacity(0.35) : Nuru.border, lineWidth: 1))
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

// MARK: - Byte formatter (web fmtBytes)

private func fmtBytes(_ n: Int) -> String {
    if n <= 0 { return "0 MB" }
    let gb = Double(n) / 1_073_741_824
    if gb >= 1 { return String(format: "%.2f GB", gb) }
    let mb = Double(n) / 1_048_576
    if mb >= 1 { return String(format: "%.1f MB", mb) }
    return "\(max(1, Int((Double(n) / 1024).rounded()))) KB"
}

// MARK: - URL → provider parser (mirrors the web's parseVideoUrl / server parser)

struct ParsedVideo { let provider: String; let videoId: String?; let url: String }

func parseVideoUrl(_ raw: String) -> ParsedVideo? {
    let url = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !url.isEmpty else { return nil }
    // YouTube (11-char id from watch/embed/shorts/live/youtu.be)
    if let id = firstMatch(url, #"(?:youtube\.com/(?:watch\?v=|embed/|shorts/|live/)|youtu\.be/)([\w-]{11})"#) {
        return ParsedVideo(provider: "youtube", videoId: id, url: url)
    }
    // Vimeo (numeric id)
    if let id = firstMatch(url, #"vimeo\.com/(?:video/)?(\d+)"#) {
        return ParsedVideo(provider: "vimeo", videoId: id, url: url)
    }
    // Private (signed) hosts → Cloudflare / Bunny / Mux / .m3u8
    if regexMatches(url, #"(cloudflarestream\.com|videodelivery\.net|b-cdn\.net|mediadelivery\.net|stream\.mux\.com|\.m3u8)"#) {
        return ParsedVideo(provider: "private", videoId: nil, url: url)
    }
    // Any other http(s) link
    if regexMatches(url, #"^https?://\S+"#) { return ParsedVideo(provider: "direct", videoId: nil, url: url) }
    return nil
}
private func firstMatch(_ s: String, _ pattern: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
          let m = re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)), m.numberOfRanges > 1,
          let r = Range(m.range(at: 1), in: s) else { return nil }
    return String(s[r])
}
private func regexMatches(_ s: String, _ pattern: String) -> Bool {
    guard let re = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return false }
    return re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}

// MARK: - Register external video sheet (POST /admin/media/external)

private struct RegisterExternalSheet: View {
    let working: Bool
    /// Returns true once the register call succeeds (so the sheet can close).
    let onRegister: (RegisterExternalBody) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var title = ""
    @State private var caption = ""
    @State private var level = ""        // "" = none
    @State private var markPrivate = false

    private var parsed: ParsedVideo? { parseVideoUrl(url) }
    private var source: String? {
        guard let p = parsed else { return nil }
        return (p.provider == "direct" && markPrivate) ? "private" : p.provider
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Paste a YouTube, Vimeo, direct or private (signed) URL — no transcode, ready instantly.")
                        .font(.inter(12.5)).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)

                    // URL field + live provider badge
                    HStack(spacing: 8) {
                        Image(systemName: "link").font(.system(size: 15)).foregroundStyle(Nuru.ink600)
                        TextField("https://youtu.be/…  ·  vimeo.com/…  ·  signed URL", text: $url)
                            .font(.inter(13)).textFieldStyle(.plain)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                        if let s = source { ProviderBadge(source: s) }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 11)
                    .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))

                    if parsed != nil, let s = source {
                        TextField("Video title (e.g. Introduction to Discipleship)", text: $title)
                            .font(.inter(13, .semibold)).textFieldStyle(.plain)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        TextField("Caption — a short line shown with the video", text: $caption)
                            .font(.inter(12.5)).textFieldStyle(.plain)
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        HStack(spacing: 8) {
                            Text("LEVEL").font(.inter(11, .bold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                            Menu {
                                Button("None") { level = "" }
                                ForEach(1...6, id: \.self) { n in Button("Level \(n)") { level = String(n) } }
                            } label: {
                                HStack(spacing: 6) {
                                    Text(level.isEmpty ? "None" : "Level \(level)").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink)
                                    Image(systemName: "chevron.down").font(.system(size: 9)).foregroundStyle(Nuru.ink600)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }.buttonStyle(.plain)
                            Spacer()
                        }
                        if parsed?.provider == "direct" {
                            Toggle(isOn: $markPrivate) {
                                HStack(spacing: 6) {
                                    Image(systemName: "checkmark.shield").font(.system(size: 12)).foregroundStyle(Color(hex: 0x0F766E))
                                    Text("Private — deliver via signed, expiring URL").font(.inter(11.5)).foregroundStyle(Nuru.ink)
                                }
                            }.tint(Color(hex: 0x0F766E))
                        }
                        if s != "private" {
                            HStack(alignment: .top, spacing: 6) {
                                Image(systemName: "exclamationmark.triangle").font(.system(size: 12)).foregroundStyle(Color(hex: 0x7A5410))
                                Text("External links are best-effort gated, not hard-gated — choose Private (signed) for true gating.")
                                    .font(.inter(11)).foregroundStyle(Color(hex: 0x7A5410)).fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    } else {
                        HStack(spacing: 8) {
                            Image(systemName: "play.rectangle").font(.system(size: 16)).foregroundStyle(Nuru.ink600)
                            Text(url.isEmpty ? "Paste a link above. We auto-detect the host (YouTube, Vimeo, direct, private)."
                                 : "That doesn't look like a video URL yet.")
                                .font(.inter(12.5)).foregroundStyle(Nuru.ink600)
                        }
                    }
                }
                .padding(20)
            }
            .background(Nuru.paper)
            .navigationTitle("Register external video")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Register") {
                        guard let p = parsed, let s = source else { return }
                        let t = title.trimmingCharacters(in: .whitespaces)
                        let c = caption.trimmingCharacters(in: .whitespaces)
                        let body = RegisterExternalBody(
                            videoSource: s, url: p.url,
                            title: t.isEmpty ? nil : t,
                            caption: c.isEmpty ? nil : c,
                            levelNumber: level.isEmpty ? nil : Int(level))
                        Task { _ = await onRegister(body) }
                    }
                    .disabled(source == nil || working)
                    .font(.inter(15, .bold))
                }
            }
        }
    }
}

// MARK: - Chunked hosted upload (PUT …/videos/chunk + POST …/videos/finalize)

/// A self-contained uploader for the basic native file picker. It mirrors the web's
/// MediaApi.uploadVideo flow (chunked PUTs + a finalize POST) but runs sequentially
/// for simplicity. It talks to the same prod surface and reuses the stored access
/// token (Keychain key "nuru.portal.at") without touching the shared APIClient actor.
@MainActor
final class ChunkUploader: ObservableObject {
    enum Stage { case idle, uploading, finalizing, done }
    @Published var stage: Stage = .idle
    @Published var name: String?
    @Published var loaded = 0
    @Published var totalBytes = 0
    @Published var error: String?

    var busy: Bool { stage == .uploading || stage == .finalizing }
    var pct: Int { totalBytes > 0 ? min(100, Int(Double(loaded) / Double(totalBytes) * 100)) : 0 }

    private let base = URL(string: "https://pathway.nuruplace.org/v1")!
    private let chunkSize = 8 * 1024 * 1024  // 8 MB, matching the web

    func upload(_ fileURL: URL) async {
        error = nil
        let scoped = fileURL.startAccessingSecurityScopedResource()
        defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }

        guard let data = try? Data(contentsOf: fileURL) else {
            error = "Could not read the selected file."; return
        }
        let size = data.count
        if size > 500 * 1024 * 1024 {
            error = "Video is larger than 500 MB. Use a smaller file or register an external link."; return
        }
        name = fileURL.lastPathComponent
        totalBytes = size; loaded = 0; stage = .uploading

        let token = Keychain.get("nuru.portal.at")
        let uploadId = UUID().uuidString
        let chunkCount = max(1, Int((Double(size) / Double(chunkSize)).rounded(.up)))

        do {
            for i in 0..<chunkCount {
                let start = i * chunkSize
                let end = min(start + chunkSize, size)
                let slice = data.subdata(in: start..<end)
                try await putChunk(uploadId: uploadId, index: i, body: slice, token: token)
                loaded = end
            }
            stage = .finalizing
            try await finalize(uploadId: uploadId, totalChunks: chunkCount, filename: fileURL.lastPathComponent, token: token)
            stage = .done
            // Clear the "done" banner after a moment (web does the same).
            Task { try? await Task.sleep(nanoseconds: 4_000_000_000); if stage == .done { stage = .idle } }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            stage = .idle
        }
    }

    private func putChunk(uploadId: String, index: Int, body: Data, token: String?) async throws {
        var comps = URLComponents(url: base.appendingPathComponent("admin/media/videos/chunk"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "upload_id", value: uploadId), URLQueryItem(name: "index", value: String(index))]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "PUT"
        req.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.timeoutInterval = 120
        let (respData, resp) = try await URLSession.shared.upload(for: req, from: body)
        try Self.check(resp, respData, "Chunk \(index) failed")
    }

    private func finalize(uploadId: String, totalChunks: Int, filename: String, token: String?) async throws {
        struct Body: Encodable { let uploadId: String; let totalChunks: Int; let filename: String; let title: String }
        let title = filename.replacingOccurrences(of: #"\.[^.]+$"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"[_-]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
        var req = URLRequest(url: base.appendingPathComponent("admin/media/videos/finalize"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        let enc = JSONEncoder(); enc.keyEncodingStrategy = .convertToSnakeCase
        req.httpBody = try enc.encode(Body(uploadId: uploadId, totalChunks: totalChunks, filename: filename,
                                           title: title.isEmpty ? "Uploaded video" : title))
        let (respData, resp) = try await URLSession.shared.data(for: req)
        try Self.check(resp, respData, "Finalize failed")
    }

    private static func check(_ resp: URLResponse, _ data: Data, _ fallback: String) throws {
        guard let http = resp as? HTTPURLResponse else { throw APIError.transport(fallback) }
        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONDecoder().decode([String: String].self, from: data))?["message"]
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError.http(status: http.statusCode, message: msg)
        }
    }
}
