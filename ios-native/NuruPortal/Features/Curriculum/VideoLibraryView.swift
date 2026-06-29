// Video Library — media assets from /admin/media, as a native thumbnail grid.
import SwiftUI

struct VideoLibraryView: View {
    private let cols = [GridItem(.adaptive(minimum: 260), spacing: 16)]
    var body: some View {
        AsyncView(PortalAPI.media) { assets in
            if assets.isEmpty {
                ContentUnavailableView("No media", systemImage: "play.rectangle",
                                       description: Text("No video assets have been added yet."))
            } else {
                ScrollView {
                    LazyVGrid(columns: cols, spacing: 16) {
                        ForEach(assets) { a in MediaCard(asset: a) }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Video Library")
    }
}

private struct MediaCard: View {
    let asset: MediaAssetRow
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Nuru.navy.opacity(0.08))
                    if let t = asset.thumbnailUrl, let url = URL(string: t) {
                        AsyncImage(url: url) { img in
                            img.resizable().aspectRatio(contentMode: .fill)
                        } placeholder: { ProgressView() }
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        Image(systemName: "play.rectangle").font(.fraunces(30, .semibold)).foregroundStyle(Nuru.muted)
                    }
                    if let d = asset.durationSec {
                        Text(duration(d)).font(.inter(11.5, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(.black.opacity(0.6)).clipShape(Capsule())
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                            .padding(8)
                    }
                }
                .frame(height: 150).clipped()

                Text(asset.caption ?? "Untitled").font(.inter(15, .semibold))
                    .foregroundStyle(Nuru.navy).lineLimit(2)
                if let mod = asset.attachedModuleTitle {
                    Label(mod, systemImage: "link").font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                HStack(spacing: 6) {
                    Pill(text: asset.status.capitalized, color: asset.status == "ready" ? Nuru.success : Nuru.warning)
                    Pill(text: asset.videoSource.uppercased(), color: Nuru.navy)
                    Spacer()
                    if let v = asset.views { Text("\(v) views").font(.nMicro).foregroundStyle(Nuru.muted) }
                }
            }
        }
    }
    private func duration(_ s: Int) -> String { String(format: "%d:%02d", s / 60, s % 60) }
}
