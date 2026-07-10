// Uploads & Sessions — the media workbench (feat/macbook-version).
//
// The Radio Studio (Mac desk AND iPad) keeps the LIVE workflow only; session
// playlist + upload management lives HERE, on both platforms: upload music into
// the station's audio library and curate the session playlists that feed the
// desk. This page reuses the exact SessionsSection + AudioLibrarySection
// components from RadioStudioView.swift (same module — no forks) over a
// page-owned AudioLibraryStore, painted in the same dark Rs studio chrome.
// On the Mac the two lanes sit side by side and the View consoles open as big
// CENTERED studio modals; on iPad the lanes stack and the consoles present as
// native page sheets.
//
// Media-workbench affordances (both platforms, all inside the shared sections):
//   • MULTI-FILE uploads — the picker takes several audio files at once; each
//     shows a queued row with a live Rs-gold progress bar (percent + MB), a ✓
//     done state that self-clears, or a retry-able error. Real byte progress
//     streams from APIClient.uploadFileWithProgress (URLSession upload task
//     delegate); the store drains the queue sequentially.
//   • CHECKBOX MULTI-SELECT in the library (page + library sheet only) — tri-
//     state select-all over the current kind filter, then bulk "Add N to
//     session" / "Delete N" (one confirm).
//   • DRAG-TO-REORDER on session playlists (lane cards + console sheets) —
//     mouse on the Mac, long-press drag on iPad, gold insertion line, persisted
//     through the same PUT …/tracks/order path as the ↑/↓ arrows (which remain
//     for accessibility). The library list stays undraggable — it has no
//     server-side order.
//
// Treated as ephemeral like Radio/Mixer, so the store's preview player and the
// live poll tear down cleanly on leave.
import SwiftUI

struct UploadsSessionsView: View {
    @StateObject private var library = AudioLibraryStore()

    // Live context for the session cards' ON AIR indicators: a coarse ~30s poll
    // of /admin/radio/programs finds the live program, and its health poll
    // supplies the icy now-playing title. Both degrade gracefully to nil —
    // the indicators simply stay off. (The fine-grained ~3s polling belongs to
    // the Radio Studio desk; this page only curates.)
    @State private var liveProgramId: String?
    @State private var nowPlaying: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if !library.loaded {
                    DarkSkeleton()
                } else {
                    // Two top-aligned lanes sharing the workspace width:
                    // SESSIONS (playlist curation) · AUDIO LIBRARY (uploads).
                    if MacDesign.isMac {
                        HStack(alignment: .top, spacing: MacDesign.gutter) {
                            SessionsSection(store: library,
                                            liveProgramId: liveProgramId,
                                            nowPlaying: nowPlaying)
                                .frame(minWidth: 360, maxWidth: .infinity)
                            AudioLibrarySection(store: library)
                                .frame(minWidth: 360, maxWidth: .infinity)
                        }
                    } else {
                        // iPad: the lanes stack — portrait can't hold two 360pt lanes.
                        SessionsSection(store: library,
                                        liveProgramId: liveProgramId,
                                        nowPlaying: nowPlaying)
                        AudioLibrarySection(store: library)
                    }
                }
            }
            // Workspace page — fills the window (page margins only, ultra-wide
            // cap), exactly like the Radio/Mixer desks.
            .padding(.horizontal, MacDesign.isMac ? 0 : 18)
            .padding(.vertical, 18)
            .padding(.bottom, MacDesign.isMac ? 30 : 48)
            .macContentColumn(MacDesign.workspaceMaxWidth)
        }
        .background(Rs.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if !library.loaded { await library.load() }
            while !Task.isCancelled {
                await refreshLive()
                try? await Task.sleep(nanoseconds: 30_000_000_000)
            }
        }
        .onDisappear { library.teardown() }
    }

    /// One coarse pass: find the live program; if there is one, fetch its
    /// health for the now-playing title. Failures leave the indicators off.
    private func refreshLive() async {
        guard let list = try? await PortalAPI.radioPrograms() else { return }
        let live = list.first(where: { $0.isLive })
        liveProgramId = live?.id
        if let live, let h = try? await PortalAPI.radioHealth(live.id) {
            nowPlaying = h.nowPlaying
        } else {
            nowPlaying = nil
        }
    }

    // MARK: Header (dark studio hero — mirrors the Radio Studio's)

    private var header: some View {
        StudioPanel(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("MEDIA").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.dim)
                    Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(Rs.faint)
                    Text("Uploads & Sessions").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.text)
                    Spacer(minLength: 8)
                    if liveProgramId != nil { onAirChip }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("MUSIC LIBRARY & SESSION PLAYLISTS")
                        .font(.inter(10.5, .bold)).tracking(1.8).foregroundStyle(Rs.gold)
                    Text("Uploads & Sessions").font(Rs.serif(30)).foregroundStyle(Rs.text)
                    Text("Upload music into the station library and curate the session playlists that feed the radio desk.")
                        .font(.inter(13)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Small ON AIR chip — a session is live right now (curate with care).
    private var onAirChip: some View {
        HStack(spacing: 6) {
            Circle().fill(Rs.red).frame(width: 7, height: 7)
            Text("ON AIR").font(.inter(10.5, .bold)).tracking(1.0).foregroundStyle(Rs.text)
        }
        .padding(.horizontal, 10).frame(height: 26).background(Rs.red.opacity(0.18)).clipShape(Capsule())
        .overlay(Capsule().stroke(Rs.red.opacity(0.5), lineWidth: 1))
    }
}
