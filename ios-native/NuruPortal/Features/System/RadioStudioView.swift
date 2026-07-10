// Radio Broadcast Studio — a native SwiftUI port of the web portal's RadioStudio
// page, at parity and wired to the frozen admin API (docs/RADIO_STUDIO_CONTRACT.md).
//
// This screen is deliberately DARK — a live broadcast console, distinct from the
// light admin portal. It reuses the shared data-loading pattern (@State + reload
// token, direct APIClient mutations) but paints its own dark studio chrome via the
// `Rs` palette (mirrored in MixerStudioView).
//
// REAL, server-authoritative bits (wired to the API):
//   • programs list + create/select        GET/POST /admin/radio/programs
//   • broadcast lifecycle                   POST …/go-live · …/end
//   • live stream health (polled ~3s)       GET  …/health  (409 until live)
//   • stream key + rotate                   POST …/rotate-key
//   • listener comments                     GET  …/comments
// CLIENT-ONLY telemetry (never leaves the device): L/R output meters, waveform,
// reaction tallies, countdown — Timer-driven simulations with STABLE layouts (fixed
// frames, no `.frame(maxHeight:.infinity)` in the ticking subtrees) so the meters
// animate without the LazyVGrid flicker pattern.
// REAL hardware: the "Audio source" card senses actual AVAudioSession inputs (a
// RØDE USB mic is auto-preferred), meters the live input via an engine tap, and can
// broadcast the mic into the station's liquidsoap mix — see MicBroadcaster (Icecast
// SOURCE handshake into the harbor at :8005/mic, password = program stream key).
import SwiftUI
import Charts
import AVKit
import AVFoundation

/// Put the app's audio session into `.playback` so studio audio (session player /
/// playlist preview) keeps playing when the iPad locks or the app backgrounds.
/// Pairs with `UIBackgroundModes: audio` in Info.plist. Idempotent + cheap.
@inline(__always) func enableBackgroundPlayback() {
    let session = AVAudioSession.sharedInstance()
    // Don't downgrade a live mic session — .playAndRecord already permits playback.
    if session.category != .playAndRecord {
        try? session.setCategory(.playback, mode: .default)
    }
    try? session.setActive(true)
}
import UniformTypeIdentifiers

// MARK: - ===================== Dark studio palette (contract) =====================
// Shared verbatim with MixerStudioView. BG #0A1120, panel gradient, gold/red/green,
// bright text + dim. Kept file-private but identical across the two studio screens.

enum Rs {
    static let bg        = Color(hex: 0x0A1120)
    static let panelTop  = Color(hex: 0x131E33)
    static let panelBot  = Color(hex: 0x0F1829)
    static let border    = Color.white.opacity(0.08)
    static let borderHi  = Color.white.opacity(0.14)
    static let gold      = Color(hex: 0xE6C66E)
    static let goldDeep  = Color(hex: 0xC89B3C)
    static let red       = Color(hex: 0xEF4444)
    static let green     = Color(hex: 0x22C55E)
    static let text      = Color(hex: 0xE8EEF7)
    static let dim       = Color(hex: 0xE8EEF7).opacity(0.55)
    static let faint     = Color(hex: 0xE8EEF7).opacity(0.32)

    static let panel = LinearGradient(colors: [panelTop, panelBot], startPoint: .top, endPoint: .bottom)
    static let liveGlow = LinearGradient(colors: [red.opacity(0.9), Color(hex: 0xB91C1C)], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let goldFill = LinearGradient(colors: [gold, goldDeep], startPoint: .top, endPoint: .bottom)

    // Serif titles / mono numerics — the web portal's DM Serif Display (via the
    // theme's display face) + bundled DM Mono for durations/bitrates/levels.
    static func serif(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .fraunces(s, w) }
    static func mono(_ s: CGFloat, _ w: Font.Weight = .medium) -> Font { .nMono(s, w) }
}

/// A dark studio panel — the equivalent of the light portal's `Card`. Shared with
/// MixerStudioView, so kept internal (not file-private).
struct StudioPanel<C: View>: View {
    var padding: CGFloat = 18
    var glow: Bool = false
    @ViewBuilder var content: C
    var body: some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Rs.panel)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(glow ? Rs.gold.opacity(0.35) : Rs.border, lineWidth: 1))
    }
}

struct StudioHeader: View {
    let icon: String, title: String
    var caption: String = ""
    var tint: Color = Rs.gold
    var body: some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(tint.opacity(0.16))
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
            }.frame(width: 30, height: 30)
            Text(title).font(.inter(14, .bold)).foregroundStyle(Rs.text).lineLimit(1).minimumScaleFactor(0.85)
            Spacer(minLength: 8)
            if !caption.isEmpty {
                Text(caption).font(.inter(11, .medium)).foregroundStyle(Rs.dim).lineLimit(1).fixedSize()
            }
        }
    }
}

// MARK: - ===================== Broadcast state machine =====================

private enum Broadcast: Equatable {
    case idle, countdown(Int), live, paused
    var isLiveOrPaused: Bool { self == .live || self == .paused }
}

// MARK: - ===================== View model (lifecycle + polling) =====================

@MainActor
private final class RadioModel: ObservableObject {
    @Published var programs: [RadioProgram] = []
    @Published var selectedId: String?
    @Published var loaded = false
    @Published var error: String?

    @Published var broadcast: Broadcast = .idle
    @Published var health: StreamHealth?
    @Published var comments: [RadioComment] = []
    // Live listener presence (REAL) — the roster of members heartbeating from the
    // mobile player, plus the server-authoritative count. Polled with health.
    @Published var listeners: [RadioListener] = []
    @Published var listenerRosterCount = 0
    @Published var actionError: String?
    @Published var busy = false

    /// Prefer the real presence count; fall back to the health poll, then the
    /// program's peak — mirrors the web portal's listenerCount derivation.
    var displayListeners: Int {
        listenerRosterCount > 0 ? listenerRosterCount : (health?.listeners ?? selected?.peakListeners ?? 0)
    }

    // Client-only reaction tallies (member reactions arrive via the member API; the
    // admin console shows local applause it accumulates while live).
    @Published var hearts = 0
    @Published var amens = 0
    @Published var fires = 0

    private var pollTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?

    var selected: RadioProgram? { programs.first { $0.id == selectedId } }

    func load() async {
        do {
            let list = try await PortalAPI.radioPrograms()
            programs = list
            if selectedId == nil || !list.contains(where: { $0.id == selectedId }) {
                // Prefer a live program, else the first.
                selectedId = list.first(where: { $0.isLive })?.id ?? list.first?.id
            }
            syncBroadcastToSelected()
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load radio programs."
        }
        loaded = true
    }

    func select(_ id: String) {
        guard id != selectedId else { return }
        stopPolling(); countdownTask?.cancel()
        selectedId = id
        health = nil; comments = []; listeners = []; listenerRosterCount = 0; hearts = 0; amens = 0; fires = 0
        syncBroadcastToSelected()
    }

    private func syncBroadcastToSelected() {
        if let p = selected, p.isLive { broadcast = .live; startLiveWork(p.id) }
        else { broadcast = .idle; stopPolling() }
    }

    // Broadcast controls: idle → countdown(3-2-1) → live; live → paused → live; → end.
    func startCountdown() {
        guard broadcast == .idle, let id = selectedId else { return }
        broadcast = .countdown(3)
        countdownTask?.cancel()
        countdownTask = Task { [weak self] in
            for n in stride(from: 3, through: 1, by: -1) {
                await MainActor.run { self?.broadcast = .countdown(n) }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
            }
            await self?.goLive(id)
        }
    }

    func cancelCountdown() {
        countdownTask?.cancel()
        broadcast = .idle
    }

    func togglePause() {
        if broadcast == .live { broadcast = .paused }
        else if broadcast == .paused { broadcast = .live }
    }

    private func goLive(_ id: String) async {
        busy = true; actionError = nil
        do {
            let updated = try await PortalAPI.radioGoLive(id)
            merge(updated)
            broadcast = .live
            startLiveWork(id)
        } catch {
            actionError = (error as? APIError)?.errorDescription ?? "Could not go live."
            broadcast = .idle
        }
        busy = false
    }

    func endBroadcast() {
        guard let id = selectedId, broadcast.isLiveOrPaused else { return }
        stopPolling()
        Task {
            busy = true; actionError = nil
            do {
                let updated = try await PortalAPI.radioEnd(id)
                merge(updated)
                broadcast = .idle
                health = nil
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not end broadcast."
            }
            busy = false
        }
    }

    func rotateKey() {
        guard let id = selectedId else { return }
        Task {
            busy = true; actionError = nil
            do {
                // POST returns just the new key; re-fetch the program so the model
                // (decode-only RadioProgram) stays authoritative with the fresh key.
                _ = try await PortalAPI.radioRotateKey(id)
                if let i = programs.firstIndex(where: { $0.id == id }),
                   let fresh = try? await PortalAPI.radioProgram(id) { programs[i] = fresh }
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not rotate the stream key."
            }
            busy = false
        }
    }

    /// Upload a picked audio file, then PATCH the selected program with its url so the
    /// session carries a broadcast recording. Reloads the program on success.
    func attachAudio(_ fileURL: URL) {
        guard let id = selectedId else { return }
        Task {
            busy = true; actionError = nil
            let scoped = fileURL.startAccessingSecurityScopedResource()
            defer { if scoped { fileURL.stopAccessingSecurityScopedResource() } }
            do {
                let data = try Data(contentsOf: fileURL)
                if let msg = AudioUploadRules.validate(filename: fileURL.lastPathComponent, byteCount: data.count) {
                    actionError = msg
                    busy = false
                    return
                }
                let up = try await PortalAPI.uploadRadioAudio(data: data, filename: fileURL.lastPathComponent)
                var body: [String: RadioJSON] = ["audio_url": .string(up.url)]
                if let d = up.durationSec { body["audio_duration_sec"] = .int(d) }
                let updated = try await PortalAPI.updateRadioProgram(id, body)
                merge(updated)
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not attach audio."
            }
            busy = false
        }
    }

    // Auto-air freshness: while the studio is open, silently re-pull the program
    // list every ~30s so a session the backend worker flips live (or defers/ends)
    // lights up the picker strip + LIVE console without leaving the page.
    func startAutoRefresh() {
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                if Task.isCancelled { return }
                await self?.refreshPrograms()
            }
        }
    }

    /// One silent refresh pass — server truth wins, but it never interrupts a local
    /// countdown or an in-flight action. Edit sheets hold value copies of the
    /// program (RadioProgramForm prefills once), so swapping `programs` here can
    /// never clobber an open form.
    private func refreshPrograms() async {
        guard let list = try? await PortalAPI.radioPrograms() else { return }
        programs = list
        if selectedId == nil || !list.contains(where: { $0.id == selectedId }) {
            selectedId = list.first(where: { $0.isLive })?.id ?? list.first?.id
        }
        guard !busy else { return }
        if case .countdown = broadcast { return }
        guard let p = selected else { return }
        if p.isLive, !broadcast.isLiveOrPaused {
            // The worker auto-aired the selected session — light up the console.
            broadcast = .live
            startLiveWork(p.id)
        } else if !p.isLive, broadcast.isLiveOrPaused {
            // Ended from elsewhere (web console / worker) — drop back to idle.
            broadcast = .idle
            stopPolling()
            health = nil
        }
    }

    // Poll health every ~3s + refresh comments while live.
    private func startLiveWork(_ id: String) {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                if let h = try? await PortalAPI.radioHealth(id) { await MainActor.run { self?.health = h } }
                if let c = try? await PortalAPI.radioComments(id) { await MainActor.run { self?.comments = c } }
                if let r = try? await PortalAPI.radioListeners(id) {
                    await MainActor.run { self?.listeners = r.roster; self?.listenerRosterCount = r.count }
                }
                try? await Task.sleep(nanoseconds: 3_000_000_000)
            }
        }
    }

    private func stopPolling() { pollTask?.cancel(); pollTask = nil }

    func loadComments() {
        guard let id = selectedId else { return }
        Task { if let c = try? await PortalAPI.radioComments(id) { comments = c } }
    }

    private func merge(_ p: RadioProgram) {
        if let i = programs.firstIndex(where: { $0.id == p.id }) { programs[i] = p }
        else { programs.append(p) }
        selectedId = p.id
    }

    func react(_ kind: String) {
        switch kind { case "heart": hearts += 1; case "amen": amens += 1; default: fires += 1 }
    }

    func teardown() {
        stopPolling()
        countdownTask?.cancel()
        refreshTask?.cancel(); refreshTask = nil
    }
}

// MARK: - ===================== RadioStudioView =====================

struct RadioStudioView: View {
    @StateObject private var m = RadioModel()
    @State private var showCreate = false
    @State private var editProgram: RadioProgram?

    // Live mic hardware (REAL): input sensing, level metering, Icecast mic uplink.
    // App-wide singleton — a live broadcast must survive navigating away (Mixer,
    // Dashboard, lock screen), so this view only OBSERVES the mic, never owns it.
    @ObservedObject private var mic = MicBroadcaster.shared
    @State private var showAttachImporter = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Mac collapses the iPad's three stacked bands (hero header,
                // program picker strip, LIVE status bar) into ONE compact
                // console strip — the desk lanes start one row down.
                if MacDesign.isMac { consoleStrip } else { header }
                if let error = m.error, m.programs.isEmpty {
                    DarkError(message: error) { Task { await m.load() } }
                } else if !m.loaded {
                    DarkSkeleton()
                } else if MacDesign.isMac {
                    macBody(program: m.selected)
                } else {
                    body(program: m.selected)
                }
            }
            // iPad keeps its exact 18pt frame; the Mac desk is a WORKSPACE page —
            // it fills the window (page margins only, ultra-wide cap at 1900pt).
            .padding(.horizontal, MacDesign.isMac ? 0 : 18)
            .padding(.vertical, 18)
            .padding(.bottom, MacDesign.isMac ? 30 : 48)
            .macContentColumn(MacDesign.workspaceMaxWidth)
        }
        .background(Rs.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task {
            if !m.loaded { await m.load() }
            // Restarted on every appear (teardown cancels it on disappear) so
            // auto-aired sessions light up while the studio is on screen.
            m.startAutoRefresh()
        }
        // Leaving the studio stops the level-meter monitoring only — a live mic
        // broadcast keeps running (MicBroadcaster is an app-wide singleton; the
        // top bar's ON MIC pill stays visible until the operator stops it).
        .onDisappear { m.teardown(); mic.stopMonitorIfIdle() }
        .sheet(isPresented: $showCreate) { RadioProgramForm { Task { await m.load() } } }
        .sheet(item: $editProgram) { p in
            RadioProgramForm(existing: p) { Task { await m.load() } }
        }
        .fileImporter(isPresented: $showAttachImporter,
                      allowedContentTypes: AudioUploadRules.allowedContentTypes) { result in
            if case .success(let url) = result { m.attachAudio(url) }
            else if case .failure(let err) = result { m.actionError = err.localizedDescription }
        }
        .alert("Something went wrong", isPresented: Binding(get: { m.actionError != nil }, set: { if !$0 { m.actionError = nil } })) {
            Button("OK", role: .cancel) { m.actionError = nil }
        } message: { Text(m.actionError ?? "") }
    }

    // MARK: Header (dark studio hero — iPad/iPhone only; the Mac uses consoleStrip)

    private var header: some View {
        StudioPanel(padding: 20, glow: m.broadcast.isLiveOrPaused) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("OPERATIONS").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.dim)
                    Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(Rs.faint)
                    Text("Radio Studio").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.text)
                    Spacer(minLength: 8)
                    liveBadge
                        // Same spring as the countdown digits — the badge eases between
                        // idle → cueing → live → paused instead of snapping.
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: m.broadcast)
                }
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("LIVE BROADCAST CONSOLE").font(.inter(10.5, .bold)).tracking(1.8).foregroundStyle(Rs.gold)
                        Text("Radio Studio").font(Rs.serif(30)).foregroundStyle(Rs.text)
                        Text("Provision a program, cue the audio source, and take it live to the congregation.")
                            .font(.inter(13)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    newProgramButton
                }
            }
        }
    }

    /// Gold "+ New program" CTA — shared by the iPad hero and the Mac console strip.
    private var newProgramButton: some View {
        Button { showCreate = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                Text("New program").font(.inter(12, .bold))
            }
            .foregroundStyle(Color(hex: 0x0A1120))
            .padding(.horizontal, 14).frame(height: 34)
            .background(Rs.goldFill).clipShape(Capsule())
        }.pressable().hoverEffect(.highlight)
    }

    // MARK: Mac console strip (Catalyst only)
    //
    // ONE compact bordered Rs row spanning the workspace width, replacing the
    // three full-width bands the iPad stacks (hero header, program picker
    // strip, LIVE status bar). Four columns split by vertical hairlines:
    // identity · sessions (flex, the same picker chips) · live stats (or a dim
    // off-air tag) · actions (ON AIR chip + New program). ≤ ~92pt tall so the
    // desk lanes start almost at the top of the window.
    private var consoleStrip: some View {
        StudioPanel(padding: 0, glow: m.broadcast.isLiveOrPaused) {
            HStack(spacing: 0) {
                // 1 — identity (the breadcrumb + subtitle are dropped on Mac).
                VStack(alignment: .leading, spacing: 3) {
                    Text("LIVE BROADCAST CONSOLE").font(.inter(9, .bold)).tracking(1.6).foregroundStyle(Rs.gold)
                    Text("Radio Studio").font(Rs.serif(22)).foregroundStyle(Rs.text)
                }
                .padding(.horizontal, 16)
                .fixedSize()

                stripHairline

                // 2 — sessions (flex): the exact picker chips, inline; the
                // ProgramPickerStrip already horizontal-scrolls on overflow.
                Group {
                    if m.programs.isEmpty {
                        Text("No sessions yet").font(.inter(11.5)).foregroundStyle(Rs.faint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        ProgramPickerStrip(programs: m.programs, selectedId: m.selectedId) { m.select($0) }
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 14)

                stripHairline

                // 3 — live stats while live/paused; otherwise a dim off-air tag.
                Group {
                    if m.broadcast.isLiveOrPaused, let p = m.selected {
                        StripLiveStats(program: p, paused: m.broadcast == .paused,
                                       health: m.health, listeners: m.displayListeners)
                    } else {
                        Text("Off air").font(.inter(10.5, .bold)).tracking(0.8).foregroundStyle(Rs.faint)
                            .padding(.horizontal, 12).frame(height: 26)
                            .background(Color.white.opacity(0.04)).clipShape(Capsule())
                    }
                }
                .padding(.horizontal, 16)

                stripHairline

                // 4 — actions.
                HStack(spacing: 10) {
                    liveBadge
                        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: m.broadcast)
                    newProgramButton
                }
                .padding(.horizontal, 16)
                .fixedSize()
            }
            .frame(height: 88)
        }
    }

    private var stripHairline: some View {
        Rectangle().fill(Rs.border).frame(width: 1).frame(maxHeight: .infinity)
    }

    @ViewBuilder private var liveBadge: some View {
        switch m.broadcast {
        case .live:
            HStack(spacing: 6) {
                Circle().fill(Rs.red).frame(width: 7, height: 7)
                Text("ON AIR").font(.inter(10.5, .bold)).tracking(1.0).foregroundStyle(Rs.text)
            }
            .padding(.horizontal, 10).frame(height: 26).background(Rs.red.opacity(0.18)).clipShape(Capsule())
            .overlay(Capsule().stroke(Rs.red.opacity(0.5), lineWidth: 1))
        case .paused:
            statusTag("PAUSED", Rs.gold)
        case .countdown:
            statusTag("CUEING", Rs.gold)
        case .idle:
            statusTag("OFF AIR", Rs.faint)
        }
    }
    private func statusTag(_ s: String, _ c: Color) -> some View {
        Text(s).font(.inter(10.5, .bold)).tracking(1.0).foregroundStyle(c)
            .padding(.horizontal, 10).frame(height: 26).background(c.opacity(0.14)).clipShape(Capsule())
    }

    // MARK: Body

    @ViewBuilder private func body(program: RadioProgram?) -> some View {
        // Program picker strip (horizontal) — select the program to broadcast.
        ProgramPickerStrip(programs: m.programs, selectedId: m.selectedId) { m.select($0) }

        // Broadcaster-first ordering: output meters & waveform lead, then the
        // transport, then the Audio source (mic, monitor, GO ON MIC) — mirrors
        // the Mac desk's OPERATE lane. The rest scrolls below. Session
        // playlists + the audio library live on the Uploads & Sessions page,
        // not here.
        if let p = program {
            // LIVE status bar (only while live/paused) — duration/listeners/bitrate/health.
            if m.broadcast.isLiveOrPaused {
                LiveStatusBar(program: p, broadcast: m.broadcast, health: m.health, listeners: m.displayListeners)
            }

            MeterAndWaveformPanel(active: m.broadcast == .live)

            BroadcastControlsPanel(
                broadcast: m.broadcast, busy: m.busy,
                onGoLive: { m.startCountdown() },
                onCancel: { m.cancelCountdown() },
                onPause: { m.togglePause() },
                onEnd: { m.endBroadcast() }
            )

            AudioSourcePanel(mic: mic, program: p)
        }

        // — everything below here is the scroll-down zone —
        if let p = program {
            ProgramCard(program: p, onEdit: { editProgram = p })

            // Uploaded session audio — inline player when set, otherwise an attach CTA.
            SessionAudioPanel(program: p, busy: m.busy, onAttach: { showAttachImporter = true })

            IngestPanel(program: p, onRotate: { m.rotateKey() }, busy: m.busy)

            LiveListenersPanel(listeners: m.listeners, count: m.displayListeners, live: m.broadcast.isLiveOrPaused)

            ReactionsPanel(hearts: m.hearts, amens: m.amens, fires: m.fires, comments: m.comments,
                           onReact: { m.react($0) }, onRefresh: { m.loadComments() })

            if m.broadcast.isLiveOrPaused, let h = m.health {
                StreamHealthPanel(health: h)
            }

            SchedulePanel(program: p)
            DeviceManagerPanel()
            EmergencyPanel(onEnd: { m.endBroadcast() }, canEnd: m.broadcast.isLiveOrPaused)
        } else {
            noProgramsPanel
        }
    }

    /// Shared "no programs" empty state (same view tree the stacked body always used).
    private var noProgramsPanel: some View {
        StudioPanel {
            VStack(spacing: 10) {
                Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 30)).foregroundStyle(Rs.faint)
                Text("No programs yet").font(.inter(15, .semibold)).foregroundStyle(Rs.text)
                Text("Create a broadcast program to begin.").font(.inter(12)).foregroundStyle(Rs.dim)
                Button { showCreate = true } label: {
                    Text("New program").font(.inter(12, .bold)).foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 16).frame(height: 34).background(Rs.goldFill).clipShape(Capsule())
                }.pressable().hoverEffect(.highlight).padding(.top, 4)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 32)
        }
    }

    // MARK: Mac desk (Catalyst only — iPad/iPhone never reach this branch)
    //
    // Composed like a broadcast console across the FULL workspace width. The
    // program picker and the live stats live in the console strip at the top
    // of the page (see `consoleStrip`); the desk itself is three top-aligned
    // lanes —
    //   OPERATE  (~36%)  what the broadcaster touches while on air: output
    //                    meters & waveform on top → transport (broadcast
    //                    controls) → audio source (mic sensing / monitor
    //                    playback / mic boost / GO ON MIC).
    //   PROGRAM  (~36%)  what airs: program card (Edit) → session audio (attach)
    //                    → schedule (promoted from the rail so the center lane
    //                    stays balanced).
    //   CONTEXT  (~28%)  reference rail: live listeners → interactions → stream
    //                    health (live) → utility tail (ingest collapsed →
    //                    devices → emergency last).
    // Sessions AND the audio library moved OFF this page entirely — playlist +
    // upload management lives only on the Uploads & Sessions page (both
    // platforms). The lanes split the width via flexible frames (the rail caps
    // at 520pt, so at full desk the split lands ≈36/36/28; mins only guard tiny
    // windows). Every panel is the exact same component the iPad stacks
    // vertically.
    @ViewBuilder private func macBody(program: RadioProgram?) -> some View {
        if let p = program {
            HStack(alignment: .top, spacing: MacDesign.gutter) {
                // OPERATE — meters on top, then transport, then the source.
                VStack(alignment: .leading, spacing: 16) {
                    MeterAndWaveformPanel(active: m.broadcast == .live)
                    BroadcastControlsPanel(
                        broadcast: m.broadcast, busy: m.busy,
                        onGoLive: { m.startCountdown() },
                        onCancel: { m.cancelCountdown() },
                        onPause: { m.togglePause() },
                        onEnd: { m.endBroadcast() }
                    )
                    AudioSourcePanel(mic: mic, program: p)
                }
                .frame(minWidth: 300, maxWidth: .infinity)

                // PROGRAM — the program itself, its audio, then its schedule.
                VStack(alignment: .leading, spacing: 16) {
                    ProgramCard(program: p, onEdit: { editProgram = p })
                    SessionAudioPanel(program: p, busy: m.busy, onAttach: { showAttachImporter = true })
                    SchedulePanel(program: p)
                }
                .frame(minWidth: 320, maxWidth: .infinity)

                // CONTEXT — reference rail; audience first, emergency last.
                VStack(alignment: .leading, spacing: 16) {
                    LiveListenersPanel(listeners: m.listeners, count: m.displayListeners, live: m.broadcast.isLiveOrPaused)
                    ReactionsPanel(hearts: m.hearts, amens: m.amens, fires: m.fires, comments: m.comments,
                                   onReact: { m.react($0) }, onRefresh: { m.loadComments() })
                    if m.broadcast.isLiveOrPaused, let h = m.health {
                        StreamHealthPanel(health: h)
                    }
                    IngestPanel(program: p, onRotate: { m.rotateKey() }, busy: m.busy)   // collapsed by default
                    DeviceManagerPanel()
                    EmergencyPanel(onEnd: { m.endBroadcast() }, canEnd: m.broadcast.isLiveOrPaused)
                }
                .frame(minWidth: 280, maxWidth: 520)
            }
        } else {
            // No programs yet — the CTA leads; session/library building lives on
            // the Uploads & Sessions page now.
            noProgramsPanel
        }
    }
}

// MARK: - Program picker strip

private struct ProgramPickerStrip: View {
    let programs: [RadioProgram]
    let selectedId: String?
    let onSelect: (String) -> Void
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(programs) { p in
                    let on = p.id == selectedId
                    Button { onSelect(p.id) } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(spacing: 6) {
                                if p.isLive { Circle().fill(Rs.red).frame(width: 6, height: 6) }
                                Text(p.title.isEmpty ? "Untitled" : p.title)
                                    .font(.inter(12.5, .semibold)).foregroundStyle(on ? Rs.text : Rs.dim)
                                    .lineLimit(1)
                            }
                            Text(statusLabel(p.status)).font(.inter(9.5, .bold)).tracking(0.6).foregroundStyle(statusColor(p.status))
                        }
                        .frame(width: 168, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(on ? Rs.gold.opacity(0.12) : Color.white.opacity(0.03))
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(on ? Rs.gold.opacity(0.5) : Rs.border, lineWidth: 1))
                    }.pressable().hoverEffect(.highlight)
                }
            }
        }
    }
}

private func statusLabel(_ s: String) -> String {
    switch s { case "live": return "ON AIR"; case "scheduled": return "SCHEDULED"; case "ended": return "ENDED"; default: return "DRAFT" }
}
private func statusColor(_ s: String) -> Color {
    switch s { case "live": return Rs.red; case "scheduled": return Rs.gold; case "ended": return Rs.faint; default: return Rs.dim }
}

// MARK: - Program card (artwork / title / meta / category)

private struct ProgramCard: View {
    let program: RadioProgram
    let onEdit: () -> Void
    var body: some View {
        StudioPanel {
            HStack(alignment: .top, spacing: 16) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Rs.goldFill.opacity(0.9))
                    Image(systemName: "waveform").font(.system(size: 30, weight: .semibold)).foregroundStyle(Color(hex: 0x0A1120))
                }.frame(width: 84, height: 84)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(program.category.isEmpty ? "Program" : program.category)
                            .font(.inter(10, .bold)).tracking(0.8).foregroundStyle(Rs.gold)
                            .padding(.horizontal, 8).padding(.vertical, 3).background(Rs.gold.opacity(0.14)).clipShape(Capsule())
                        if program.recordBroadcast {
                            HStack(spacing: 4) {
                                Image(systemName: "record.circle").font(.system(size: 9))
                                Text("REC \((program.recordTarget ?? "cloud").uppercased())").font(.inter(9, .bold)).tracking(0.6)
                            }.foregroundStyle(Rs.red).padding(.horizontal, 7).padding(.vertical, 3).background(Rs.red.opacity(0.14)).clipShape(Capsule())
                        }
                    }
                    Text(program.title.isEmpty ? "Untitled program" : program.title)
                        .font(Rs.serif(21)).foregroundStyle(Rs.text).lineLimit(2)
                    if let d = program.description, !d.isEmpty {
                        Text(d).font(.inter(12.5)).foregroundStyle(Rs.dim).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                    HStack(spacing: 14) {
                        if let s = program.speaker, !s.isEmpty { metaItem("mic", s) }
                        if let l = program.location, !l.isEmpty { metaItem("mappin.and.ellipse", l) }
                        metaItem("eye", program.visibility.isEmpty ? "public" : program.visibility)
                    }.padding(.top, 2)
                }
                Spacer(minLength: 8)
                Button(action: onEdit) {
                    HStack(spacing: 6) {
                        Image(systemName: "pencil").font(.system(size: 11, weight: .bold))
                        Text("Edit").font(.inter(12, .bold))
                    }
                    .foregroundStyle(Rs.gold)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
                    .overlay(Capsule().stroke(Rs.gold.opacity(0.35), lineWidth: 1))
                }.pressable().hoverEffect(.highlight)
            }
        }
    }
    private func metaItem(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10)).foregroundStyle(Rs.faint)
            Text(text).font(.inter(11.5, .medium)).foregroundStyle(Rs.dim).lineLimit(1)
        }
    }
}

// MARK: - Session audio (uploaded recording) — inline player or attach CTA
// The header row is also a deep link into Uploads & Sessions (console sheet).

private struct SessionAudioPanel: View {
    let program: RadioProgram
    let busy: Bool
    let onAttach: () -> Void

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                // The header row doubles as a deep link: press → the Uploads &
                // Sessions page with THIS session's console sheet open (RootView
                // routes the notification; the page consumes the program id).
                // Attach below keeps its inline behavior — this is additional.
                Button(action: openInUploads) {
                    HStack(spacing: 8) {
                        StudioHeader(icon: "waveform.badge.mic", title: "Session audio",
                                     caption: program.audioUrl == nil ? "no recording" : "uploaded")
                        openLinkAffordance
                    }
                    .contentShape(Rectangle())
                }
                .pressable().hoverEffect(.highlight)
                .accessibilityLabel("Session audio — open in Uploads and Sessions")
                .accessibilityHint("Opens this session's console on the Uploads & Sessions page")
                if let s = program.audioUrl, let url = URL(string: s) {
                    AudioPlayerBar(url: url, durationSec: program.audioDurationSec)
                    Text("This recording broadcasts to listeners when the session goes live.")
                        .font(.inter(11)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                } else {
                    Text("Attach a pre-recorded broadcast so this session can air its audio when it goes live.")
                        .font(.inter(11.5)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    Button(action: onAttach) {
                        HStack(spacing: 7) {
                            if busy { ProgressView().tint(Rs.gold) }
                            else { Image(systemName: "arrow.up.circle.fill").font(.system(size: 13, weight: .semibold)) }
                            Text("Attach audio").font(.inter(12.5, .semibold))
                        }
                        .foregroundStyle(Rs.gold)
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
                        .overlay(Capsule().stroke(Rs.gold.opacity(0.35), lineWidth: 1))
                    }.pressable().hoverEffect(.highlight).disabled(busy)
                }
            }
        }
    }

    /// Trailing gold chevron affordance — full label where the lane is wide
    /// enough, degrading to a short label, then a bare chevron in tight lanes.
    private var openLinkAffordance: some View {
        ViewThatFits(in: .horizontal) {
            openLinkLabel("Open in Uploads & Sessions")
            openLinkLabel("Uploads & Sessions")
            openLinkLabel(nil)
        }
    }
    private func openLinkLabel(_ text: String?) -> some View {
        HStack(spacing: 4) {
            if let text { Text(text).font(.inter(11, .semibold)) }
            Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold))
        }
        .foregroundStyle(Rs.gold)
        .lineLimit(1).fixedSize()
    }

    /// Post the app-internal deep link; RootView switches to Uploads & Sessions
    /// and that page opens this session's console once its data is in.
    private func openInUploads() {
        NotificationCenter.default.post(name: .nuruOpenUploadsSession, object: nil,
                                        userInfo: ["programId": program.id])
    }
}

/// A compact AVPlayer transport: play/pause + a scrubber + time labels. Loads the
/// remote audio lazily and cleans up its time observer on disappear.
private struct AudioPlayerBar: View {
    let url: URL
    let durationSec: Int?

    @State private var player: AVPlayer?
    @State private var playing = false
    @State private var current: Double = 0
    @State private var duration: Double = 0
    @State private var scrubbing = false
    @State private var observer: Any?

    var body: some View {
        HStack(spacing: 12) {
            Button { toggle() } label: {
                ZStack {
                    Circle().fill(Rs.goldFill).frame(width: 42, height: 42)
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.system(size: 16, weight: .bold)).foregroundStyle(Color(hex: 0x0A1120))
                }
            }.pressable().hoverEffect(.highlight)

            VStack(alignment: .leading, spacing: 4) {
                Slider(value: $current, in: 0...max(duration, 1)) { editing in
                    scrubbing = editing
                    if !editing { seek(to: current) }
                }.tint(Rs.gold)
                HStack {
                    Text(timeLabel(current)).font(Rs.mono(10.5)).foregroundStyle(Rs.dim)
                    Spacer()
                    Text(timeLabel(duration)).font(Rs.mono(10.5)).foregroundStyle(Rs.dim)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 12)
        .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
        .onAppear { setup() }
        .onDisappear { teardown() }
    }

    private func setup() {
        guard player == nil else { return }
        enableBackgroundPlayback()
        let p = AVPlayer(url: url)
        player = p
        if let d = durationSec, d > 0 { duration = Double(d) }
        observer = p.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { t in
            if !scrubbing { current = t.seconds.isFinite ? t.seconds : 0 }
            if let item = p.currentItem {
                let d = item.duration.seconds
                if d.isFinite, d > 0 { duration = d }
            }
            if p.timeControlStatus == .paused, playing, p.currentItem?.currentTime() == p.currentItem?.duration {
                playing = false; p.seek(to: .zero); current = 0
            }
        }
    }

    private func teardown() {
        if let observer { player?.removeTimeObserver(observer) }
        observer = nil
        player?.pause(); player = nil; playing = false
    }

    private func toggle() {
        guard let player else { return }
        if playing { player.pause() } else { player.play() }
        playing.toggle()
    }

    private func seek(to seconds: Double) {
        player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
    }

    private func timeLabel(_ s: Double) -> String {
        guard s.isFinite, s >= 0 else { return "0:00" }
        let total = Int(s); let m = total / 60; let sec = total % 60
        return String(format: "%d:%02d", m, sec)
    }
}

// MARK: - LIVE status bar (duration / listeners / bitrate / health)

/// Live-stat formatting — ONE implementation feeding both the iPad's full-width
/// LiveStatusBar and the Mac console strip's stats column, so the two surfaces
/// can never drift.
private enum LiveStat {
    static func duration(startISO: String?, now: Date) -> String {
        guard let iso = startISO, let start = parseISO(iso) else { return "00:00:00" }
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return String(format: "%02d:%02d:%02d", h, m, s)
    }
    static func bitrate(_ health: StreamHealth?) -> String {
        health.map { "\(Int($0.bitrate)) kbps" } ?? "—"
    }
    /// Icy now-playing metadata — only when the health poll reports it.
    static func nowPlaying(_ health: StreamHealth?) -> String? {
        guard let np = health?.nowPlaying?.trimmingCharacters(in: .whitespacesAndNewlines), !np.isEmpty else { return nil }
        return np
    }
    static func healthLabel(_ health: StreamHealth?, paused: Bool) -> String {
        guard let st = health?.stability else { return paused ? "Paused" : "—" }
        if st >= 95 { return "Excellent" }; if st >= 85 { return "Good" }; if st >= 70 { return "Fair" }; return "Poor"
    }
    static func healthColor(_ health: StreamHealth?) -> Color {
        guard let st = health?.stability else { return Rs.dim }
        if st >= 85 { return Rs.green }; if st >= 70 { return Rs.gold }; return Rs.red
    }
}

/// The Mac console strip's live-stats column: duration (gold mono) with the
/// ♪ now-playing line in micro type beneath, then listeners / bitrate / health
/// as tight labeled columns. Every value comes from the same `LiveStat` helpers
/// the iPad's LiveStatusBar renders.
private struct StripLiveStats: View {
    let program: RadioProgram
    let paused: Bool
    let health: StreamHealth?
    let listeners: Int

    var body: some View {
        // TimelineView ticks the duration once a second (pauses off-screen).
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            HStack(alignment: .center, spacing: 16) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(LiveStat.duration(startISO: program.liveStartedAt, now: ctx.date))
                        .font(Rs.mono(17, .semibold)).foregroundStyle(Rs.gold)
                    if let np = LiveStat.nowPlaying(health) {
                        Text("♪ \(np)")
                            .font(.inter(9, .semibold)).foregroundStyle(Rs.gold.opacity(0.8))
                            .lineLimit(1).truncationMode(.tail)
                            .frame(maxWidth: 170, alignment: .leading)
                    }
                }
                statColumn("LISTENERS", "\(listeners)", Rs.green)
                statColumn("BITRATE", LiveStat.bitrate(health), Rs.text)
                statColumn("HEALTH", LiveStat.healthLabel(health, paused: paused), LiveStat.healthColor(health))
            }
        }
    }

    private func statColumn(_ label: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label).font(.inter(8.5, .bold)).tracking(0.7).foregroundStyle(Rs.dim)
            Text(value).font(Rs.mono(13, .semibold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

private struct LiveStatusBar: View {
    let program: RadioProgram
    let broadcast: Broadcast
    let health: StreamHealth?
    /// Real presence count (roster) with health/peak fallback — from the view model.
    let listeners: Int
    // Duration ticks locally from live_started_at; a light 1s timer so it counts up.
    // The clock pauses while the view is off-screen or the scene is inactive.
    @State private var now = Date()
    @State private var clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        StudioPanel(padding: 14, glow: true) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 0) {
                    stat("DURATION", LiveStat.duration(startISO: program.liveStartedAt, now: now), Rs.gold, "clock")
                    divider
                    stat("LISTENERS", "\(listeners)", Rs.green, "person.2.fill")
                    divider
                    stat("BITRATE", LiveStat.bitrate(health), Rs.text, "waveform")
                    divider
                    stat("HEALTH", LiveStat.healthLabel(health, paused: broadcast == .paused), LiveStat.healthColor(health), "heart.text.square")
                }
                // Now playing (icy metadata) — only when the health poll reports it.
                if let np = LiveStat.nowPlaying(health) {
                    Text("♪ \(np)")
                        .font(.inter(11.5, .semibold)).foregroundStyle(Rs.gold)
                        .lineLimit(1).truncationMode(.tail)
                        .padding(.horizontal, 12)
                }
            }
        }
        .onReceive(clock) { now = $0 }
        .onAppear { startClock() }
        .onDisappear { stopClock() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { startClock() } else { stopClock() }
        }
    }

    private func startClock() {
        stopClock()
        now = Date()                       // catch up immediately after a pause
        clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()
    }
    private func stopClock() { clock.upstream.connect().cancel() }

    private var divider: some View { Rectangle().fill(Rs.border).frame(width: 1, height: 34) }

    private func stat(_ label: String, _ value: String, _ color: Color, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                Image(systemName: icon).font(.system(size: 10)).foregroundStyle(color.opacity(0.8))
                Text(label).font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
            }
            Text(value).font(Rs.mono(16, .semibold)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
    }

}

// MARK: - Live listeners roster (REAL presence — members heartbeating from the app)

/// The named roster of who is actually listening right now — mirrors the web
/// portal's "Live listeners" panel. Names + avatars come from real presence rows
/// (`/radio/programs/:id/listeners`), so this is server-authoritative, not chrome.
private struct LiveListenersPanel: View {
    let listeners: [RadioListener]
    let count: Int
    let live: Bool

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "person.2.wave.2.fill", title: "Live listeners",
                             caption: live ? "\(count) on air" : "Off air")
                if listeners.isEmpty {
                    Text(live ? "No one listening yet." : "Off air — no listeners.")
                        .font(.inter(12)).foregroundStyle(Rs.dim)
                        .padding(.vertical, 6)
                } else {
                    // Cap the rendered rows so a big audience never blows out the
                    // scroll; the header count stays authoritative (can reach thousands).
                    ForEach(listeners.prefix(60)) { p in listenerRow(p) }
                    if listeners.count > 60 {
                        Text("+ \(count - 60) more listening")
                            .font(.inter(11, .semibold)).foregroundStyle(Rs.gold)
                            .padding(.top, 2)
                    }
                }
            }
        }
    }

    private func listenerRow(_ p: RadioListener) -> some View {
        HStack(spacing: 11) {
            avatar(p)
            Text(p.name.isEmpty ? "Member" : p.name)
                .font(.inter(12.5, .semibold)).foregroundStyle(Rs.text)
                .lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 5) {
                Circle().fill(Rs.green).frame(width: 6, height: 6)
                Text("Listening").font(.inter(9.5, .bold)).tracking(0.4).foregroundStyle(Rs.green)
            }.fixedSize()
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }

    @ViewBuilder private func avatar(_ p: RadioListener) -> some View {
        if let s = p.avatarUrl, let url = URL(string: s), !s.isEmpty {
            AsyncImage(url: url) { img in
                img.resizable().scaledToFill()
            } placeholder: { Rs.gold.opacity(0.15) }
            .frame(width: 30, height: 30).clipShape(Circle())
        } else {
            ZStack {
                Circle().fill(Rs.goldFill)
                Text(p.initials).font(.inter(10.5, .heavy)).foregroundStyle(Color(hex: 0x0A1120))
            }.frame(width: 30, height: 30)
        }
    }
}

// MARK: - Audio source (REAL hardware — AVAudioSession inputs + live mic uplink)
// No fake signal bars: the rows are AVAudioSession.availableInputs, the meter is a
// real RMS tap, and GO ON MIC pushes AAC/ADTS into the station's harbor (:8005/mic).

private struct AudioSourcePanel: View {
    @ObservedObject var mic: MicBroadcaster
    let program: RadioProgram?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "square.stack.3d.up.fill", title: "Audio source", caption: mic.currentInputDisplayName)

                // Selectable input rows — real hardware only.
                if mic.availableInputs.isEmpty {
                    HStack(spacing: 9) {
                        Image(systemName: "mic.slash").font(.system(size: 13)).foregroundStyle(Rs.faint)
                        Text("No audio inputs detected — plug the RØDE USB mic into the iPad.")
                            .font(.inter(11.5)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.03))
                    .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Rs.border, lineWidth: 1))
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 190), spacing: 10, alignment: .top)], spacing: 10) {
                        ForEach(mic.availableInputs) { input in
                            inputRow(input)
                        }
                    }
                }

                // Live input level — real RMS while monitoring or on mic.
                HStack(spacing: 12) {
                    Button {
                        if mic.monitoring { mic.stopMonitoring() } else { mic.startMonitoring() }
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: mic.monitoring ? "waveform.circle.fill" : "waveform.circle")
                                .font(.system(size: 13, weight: .semibold))
                            Text(mic.monitoring ? "Monitoring" : "Monitor").font(.inter(11.5, .semibold))
                        }
                        .foregroundStyle(mic.monitoring ? Rs.gold : Rs.dim)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background((mic.monitoring ? Rs.gold : Rs.faint).opacity(0.12)).clipShape(Capsule())
                        .overlay(Capsule().stroke((mic.monitoring ? Rs.gold : Rs.faint).opacity(0.3), lineWidth: 1))
                    }.pressable().hoverEffect(.highlight)

                    InputLevelMeter(level: mic.level, active: mic.monitoring || mic.isBroadcasting)

                    Text("INPUT").font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim).fixedSize()
                }

                // Mic boost — software gain applied on the audio thread BEFORE the
                // meter and the encoder, so the meter above reads the boosted signal.
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("MIC BOOST").font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
                        Spacer(minLength: 8)
                        Text(String(format: "%+.0f dB", mic.boostDb))
                            .font(Rs.mono(12, .semibold)).foregroundStyle(Rs.gold)
                    }
                    Slider(value: $mic.boostDb, in: 0...18, step: 1)
                        .tint(Rs.gold)
                        .accessibilityLabel("Mic boost")
                        .accessibilityValue("\(Int(mic.boostDb)) decibels")
                    Text("Boost if your mic sounds quiet — watch the meter; red means clipping.")
                        .font(.inter(10.5)).foregroundStyle(Rs.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color.white.opacity(0.03))
                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Rs.border, lineWidth: 1))

                monitorPlaybackRow

                goOnMicButton

                statusCaptions
            }
        }
    }

    // MARK: rows

    private func inputRow(_ input: MicBroadcaster.InputSource) -> some View {
        let active = input.uid == mic.activeInputUID
        return Button { mic.select(input) } label: {
            HStack(spacing: 9) {
                Image(systemName: portIcon(input.portType))
                    .font(.system(size: 14)).foregroundStyle(active ? Rs.gold : Rs.text).frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text(input.displayName).font(.inter(12, .semibold)).foregroundStyle(Rs.text).lineLimit(1)
                    Text(portLabel(input.portType)).font(.inter(9, .bold)).tracking(0.6)
                        .foregroundStyle(active ? Rs.gold.opacity(0.85) : Rs.dim)
                }
                Spacer(minLength: 0)
                if active && input.isUSB {
                    Text("DETECTED").font(.inter(8, .bold)).tracking(0.7)
                        .foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 6).padding(.vertical, 2.5)
                        .background(Rs.goldFill).clipShape(Capsule())
                } else if active {
                    Circle().fill(Rs.green).frame(width: 7, height: 7)
                }
            }
            .padding(.horizontal, 11).padding(.vertical, 10)
            .background(active ? Rs.gold.opacity(0.10) : Color.white.opacity(0.03))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(active ? Rs.gold.opacity(0.45) : Rs.border, lineWidth: 1))
        }.pressable().hoverEffect(.highlight)
    }

    private func portIcon(_ type: AVAudioSession.Port) -> String {
        switch type {
        case .usbAudio:                                        return "cable.connector"
        case .builtInMic:                                      return "mic.fill"
        case .bluetoothHFP, .bluetoothLE, .bluetoothA2DP,
             .headsetMic:                                      return "headphones"
        default:                                               return "mic"
        }
    }
    private func portLabel(_ type: AVAudioSession.Port) -> String {
        switch type {
        case .usbAudio:                                        return "USB AUDIO"
        case .builtInMic:                                      return "BUILT-IN"
        case .bluetoothHFP, .bluetoothLE, .bluetoothA2DP:      return "BLUETOOTH"
        case .headsetMic:                                      return "HEADSET"
        default:                                               return type.rawValue.uppercased()
        }
    }

    // MARK: Monitor playback (in-ear feed — NO mic)

    /// The engine publishes TWO monitor feeds per live program — on-air (`mon_`,
    /// the broadcast chain minus the mic) and cue (`cue_`, pre-fader bed, music
    /// always full). Derivation lives in MicBroadcaster.monitorFeedURL; this
    /// respects the current mode and is only meaningful while the selected
    /// session is actually live.
    private var monitorURL: URL? {
        guard let p = program, p.isLive else { return nil }
        return MicBroadcaster.monitorFeedURL(baseHlsUrl: p.hlsUrl, mode: mic.monitorMode)
    }

    private var monitorPlaybackRow: some View {
        let url = monitorURL
        let available = url != nil || mic.monitorPlaying
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "headphones")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(mic.monitorPlaying ? Rs.gold : Rs.dim)
                    .frame(width: 20)
                VStack(alignment: .leading, spacing: 2) {
                    Text("MONITOR PLAYBACK").font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
                    Text(available
                         ? "Hear the live music in your headphones — pick your feed below"
                         : "Select a live session first")
                        .font(.inter(10.5)).foregroundStyle(Rs.faint)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Toggle("Monitor playback", isOn: Binding(
                    get: { mic.monitorPlaying },
                    set: { on in
                        if on { if let hls = program?.hlsUrl { mic.toggleMonitor(baseHlsUrl: hls) } }
                        else { mic.stopMonitor() }
                    }
                ))
                .labelsHidden()
                .tint(Rs.gold)
                .disabled(!available)
            }
            if available { monitorModeSwitch }
            if let note = mic.monitorNote {
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 10)).foregroundStyle(Rs.red)
                    Text(note).font(.inter(11, .medium)).foregroundStyle(Rs.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }

    /// Compact ON-AIR / CUE selector. Switching while the monitor is playing
    /// swaps the live feed in place (MicBroadcaster.setMonitorMode).
    private var monitorModeSwitch: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                monitorModeSegment(.onAir, label: "ON-AIR")
                monitorModeSegment(.cue, label: "CUE")
                Spacer(minLength: 0)
            }
            Text(mic.monitorMode == .onAir
                 ? "Hear it exactly as broadcast (ducks with presets)"
                 : "Music always full — DJ cue, ignores ducking")
                .font(.inter(10)).foregroundStyle(Rs.faint)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 30)      // align under the text column (icon 20 + spacing 10)
    }

    private func monitorModeSegment(_ mode: MicBroadcaster.MonitorMode, label: String) -> some View {
        let active = mic.monitorMode == mode
        return Button { mic.setMonitorMode(mode) } label: {
            Text(label).font(.inter(9.5, .bold)).tracking(0.7)
                .foregroundStyle(active ? Color(hex: 0x0A1120) : Rs.dim)
                .padding(.horizontal, 13).frame(height: 26)
                .background(Capsule().fill(active ? AnyShapeStyle(Rs.goldFill)
                                                  : AnyShapeStyle(Color.white.opacity(0.04))))
                .overlay(Capsule().stroke(active ? Rs.gold.opacity(0.5) : Rs.border, lineWidth: 1))
        }
        .pressable().hoverEffect(.highlight)
        .accessibilityLabel(mode == .onAir ? "On-air monitor feed" : "Cue monitor feed")
        .accessibilityAddTraits(active ? .isSelected : [])
    }

    // MARK: GO ON MIC

    private var streamKey: String? {
        guard let key = program?.streamKey, !key.isEmpty else { return nil }
        return key
    }
    /// Honesty: if we can't broadcast, the button is disabled and this says why.
    private var blockedReason: String? {
        if mic.permissionDenied { return "Microphone access denied — enable it in Settings." }
        if program == nil { return "Select a program above to go on mic." }
        if streamKey == nil { return "This program has no stream key — rotate one in Ingest & stream key." }
        return nil
    }

    @ViewBuilder private var goOnMicButton: some View {
        switch mic.state {
        case .onAir:
            Button { mic.stop() } label: {
                HStack(spacing: 9) {
                    Circle().fill(.white).frame(width: 8, height: 8)
                        .opacity(!reduceMotion && pulse ? 0.25 : 1)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
                    Text("ON MIC — tap to stop").font(.inter(14, .bold)).tracking(0.4)
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity).frame(height: 48)
                .background(Rs.liveGlow)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }.pressable().hoverEffect(.highlight)
            .onAppear { pulse = true }
            .onDisappear { pulse = false }
        case .connecting:
            Button { mic.stop() } label: {
                HStack(spacing: 9) {
                    ProgressView().tint(Color(hex: 0x0A1120))
                    Text("CONNECTING…").font(.inter(14, .bold)).tracking(0.6)
                }
                .foregroundStyle(Color(hex: 0x0A1120))
                .frame(maxWidth: .infinity).frame(height: 48)
                .background(Rs.goldFill)
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
            }.pressable()
        case .idle, .error:
            Button { goOnMic() } label: {
                HStack(spacing: 8) {
                    Image(systemName: "mic.fill").font(.system(size: 14, weight: .bold))
                    Text("GO ON MIC").font(.inter(14, .bold)).tracking(0.6)
                }
                .foregroundStyle(blockedReason == nil ? Color(hex: 0x0A1120) : Rs.faint)
                .frame(maxWidth: .infinity).frame(height: 48)
                .background(blockedReason == nil ? AnyShapeStyle(Rs.goldFill) : AnyShapeStyle(Color.white.opacity(0.05)))
                .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .stroke(blockedReason == nil ? Color.clear : Rs.border, lineWidth: 1))
            }.pressable().hoverEffect(.highlight).disabled(blockedReason != nil)
        }
    }

    @ViewBuilder private var statusCaptions: some View {
        if case .error(let message) = mic.state {
            HStack(alignment: .top, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 10)).foregroundStyle(Rs.red)
                Text(message).font(.inter(11, .medium)).foregroundStyle(Rs.red)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        if let reason = blockedReason, !mic.isBroadcasting {
            Text(reason).font(.inter(11)).foregroundStyle(Rs.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
        Text("Your mic mixes over the music bed — control levels in Audio Mixer.")
            .font(.inter(11)).foregroundStyle(Rs.faint)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func goOnMic() {
        guard let key = streamKey else { return }
        // Prefer the program's ingest host; fall back to the station host.
        let host = program?.ingestUrl.flatMap { URL(string: $0)?.host } ?? "pathway.nuruplace.org"
        mic.start(host: host, port: 8005, mount: "/mic", password: key)
    }
}

/// Horizontal input meter in the studio's segmented-meter language (green→gold→red).
private struct InputLevelMeter: View {
    let level: Double       // 0…1 RMS from the engine tap
    let active: Bool
    private let segs = 28
    var body: some View {
        HStack(spacing: 2.5) {
            ForEach(0..<segs, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(active && Double(i) < level * Double(segs) ? segColor(i) : Rs.faint.opacity(0.18))
                    .frame(maxWidth: .infinity)
                    .frame(height: 14)
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: 14)     // fixed height → no re-measure flicker while ticking
    }
    private func segColor(_ i: Int) -> Color {
        let f = Double(i) / Double(segs)
        if f > 0.85 { return Rs.red }
        if f > 0.62 { return Rs.gold }
        return Rs.green
    }
}

// MARK: - L/R meters + waveform (client-simulated, STABLE fixed-height layouts)

private struct MeterAndWaveformPanel: View {
    let active: Bool
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "waveform.path.ecg", title: "Output meters & waveform", caption: active ? "live" : "standby")
                HStack(alignment: .top, spacing: 16) {
                    ChannelMeter(label: "L", active: active)
                    ChannelMeter(label: "R", active: active)
                    Waveform(active: active).frame(maxWidth: .infinity)
                }
                .frame(height: 132)      // fixed row height → no re-measure flicker while ticking
            }
        }
    }
}

/// A single vertical channel meter. Drives a segment count off a Timer at a fixed
/// height, so the LazyVGrid flicker pattern can't occur (no maxHeight:.infinity here).
private struct ChannelMeter: View {
    let label: String
    let active: Bool
    @State private var level: CGFloat = 0.2
    // Timer lives in @State so it can be cancelled off-screen / when the scene is
    // inactive, and skipped entirely under Reduce Motion (static bars instead).
    @State private var tick = Timer.publish(every: 0.12, on: .main, in: .common).autoconnect()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let segs = 16
    var body: some View {
        VStack(spacing: 6) {
            VStack(spacing: 3) {
                ForEach((0..<segs).reversed(), id: \.self) { i in
                    let lit = CGFloat(i) < level * CGFloat(segs)
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(lit ? segColor(i) : Rs.faint.opacity(0.18))
                        .frame(width: 12, height: 5)
                }
            }
            Text(label).font(Rs.mono(10, .bold)).foregroundStyle(Rs.dim)
        }
        .frame(height: 132, alignment: .bottom)
        .onReceive(tick) { _ in
            guard active else { level = 0.12; return }
            let target = CGFloat.random(in: 0.35...0.98)
            level = level * 0.5 + target * 0.5
        }
        .onAppear { startTick() }
        .onDisappear { stopTick() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { startTick() } else { stopTick() }
        }
        .onChange(of: active) { _, _ in if reduceMotion { level = staticLevel } }
    }

    private var staticLevel: CGFloat { active ? 0.55 : 0.12 }
    private func startTick() {
        stopTick()
        guard !reduceMotion else { level = staticLevel; return }   // frozen bars
        tick = Timer.publish(every: 0.12, on: .main, in: .common).autoconnect()
    }
    private func stopTick() { tick.upstream.connect().cancel() }
    private func segColor(_ i: Int) -> Color {
        let f = CGFloat(i) / CGFloat(segs)
        if f > 0.85 { return Rs.red }; if f > 0.65 { return Rs.gold }; return Rs.green
    }
}

/// Scrolling bar waveform, fixed frame, Timer-driven sample buffer.
private struct Waveform: View {
    let active: Bool
    @State private var samples: [CGFloat] = Array(repeating: 0.1, count: 48)
    // Timer lives in @State so it can be cancelled off-screen / when the scene is
    // inactive, and skipped entirely under Reduce Motion (static bars instead).
    @State private var tick = Timer.publish(every: 0.09, on: .main, in: .common).autoconnect()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { geo in
            HStack(alignment: .center, spacing: 2) {
                ForEach(Array(samples.enumerated()), id: \.offset) { _, s in
                    Capsule().fill(active ? Rs.gold.opacity(0.85) : Rs.faint.opacity(0.4))
                        .frame(maxWidth: .infinity)
                        .frame(height: max(3, s * geo.size.height))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(height: 132)
        .padding(.horizontal, 4)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onReceive(tick) { _ in
            var next = samples
            next.removeFirst()
            next.append(active ? CGFloat.random(in: 0.2...1.0) : CGFloat.random(in: 0.05...0.14))
            samples = next
        }
        .onAppear { startTick() }
        .onDisappear { stopTick() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { startTick() } else { stopTick() }
        }
        .onChange(of: active) { _, _ in if reduceMotion { samples = staticSamples } }
    }

    /// Deterministic mid-height bars shown instead of the animated sweep under Reduce Motion.
    private var staticSamples: [CGFloat] {
        (0..<48).map { i in active ? 0.25 + 0.45 * abs(sin(CGFloat(i) / 4)) : 0.08 }
    }
    private func startTick() {
        stopTick()
        guard !reduceMotion else { samples = staticSamples; return }   // frozen bars
        tick = Timer.publish(every: 0.09, on: .main, in: .common).autoconnect()
    }
    private func stopTick() { tick.upstream.connect().cancel() }
}

// MARK: - Broadcast controls (idle → countdown → live → paused)

private struct BroadcastControlsPanel: View {
    let broadcast: Broadcast
    let busy: Bool
    let onGoLive: () -> Void
    let onCancel: () -> Void
    let onPause: () -> Void
    let onEnd: () -> Void

    var body: some View {
        StudioPanel {
            VStack(spacing: 14) {
                StudioHeader(icon: "antenna.radiowaves.left.and.right", title: "Broadcast controls",
                             caption: caption)
                content
            }
            // Same spring the countdown digits use — the idle → countdown → live →
            // paused control swaps ease in instead of snapping.
            .animation(.spring(response: 0.3, dampingFraction: 0.75), value: broadcast)
        }
    }

    private var caption: String {
        switch broadcast {
        case .idle: return "ready"
        case .countdown: return "cueing"
        case .live: return "on air"
        case .paused: return "paused"
        }
    }

    @ViewBuilder private var content: some View {
        switch broadcast {
        case .idle:
            bigButton("Take live now", icon: "dot.radiowaves.left.and.right", fill: Rs.liveGlow, fg: .white, action: onGoLive)
        case .countdown(let n):
            VStack(spacing: 10) {
                ZStack {
                    Circle().stroke(Rs.red.opacity(0.35), lineWidth: 4).frame(width: 96, height: 96)
                    Text("\(n)").font(Rs.serif(48, .bold)).foregroundStyle(Rs.red)
                        .id(n).transition(.scale.combined(with: .opacity))
                }
                .animation(.spring(response: 0.3, dampingFraction: 0.6), value: n)
                Text("Going live…").font(.inter(12.5, .semibold)).foregroundStyle(Rs.dim)
                Button("Cancel", action: onCancel).font(.inter(12, .semibold)).foregroundStyle(Rs.dim)
            }.frame(maxWidth: .infinity).padding(.vertical, 6)
        case .live:
            HStack(spacing: 12) {
                bigButton("Pause", icon: "pause.fill", fill: LinearGradient(colors: [Rs.gold, Rs.goldDeep], startPoint: .top, endPoint: .bottom), fg: Color(hex: 0x0A1120), action: onPause)
                bigButton("End broadcast", icon: "stop.fill", fill: LinearGradient(colors: [Color.white.opacity(0.08), Color.white.opacity(0.05)], startPoint: .top, endPoint: .bottom), fg: Rs.red, border: Rs.red.opacity(0.4), action: onEnd)
            }
        case .paused:
            HStack(spacing: 12) {
                bigButton("Resume", icon: "play.fill", fill: Rs.liveGlow, fg: .white, action: onPause)
                bigButton("End broadcast", icon: "stop.fill", fill: LinearGradient(colors: [Color.white.opacity(0.08), Color.white.opacity(0.05)], startPoint: .top, endPoint: .bottom), fg: Rs.red, border: Rs.red.opacity(0.4), action: onEnd)
            }
        }
    }

    private func bigButton(_ title: String, icon: String, fill: LinearGradient, fg: Color, border: Color = .clear, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if busy { ProgressView().tint(fg) }
                else { Image(systemName: icon).font(.system(size: 15, weight: .bold)) }
                Text(title).font(.inter(15, .bold))
            }
            .foregroundStyle(fg)
            .frame(maxWidth: .infinity).frame(height: 52)
            .background(fill)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(border, lineWidth: 1))
        }.pressable().hoverEffect(.highlight).disabled(busy)
    }
}

// MARK: - Ingest / stream key panel (copy + rotate)

private struct IngestPanel: View {
    let program: RadioProgram
    let onRotate: () -> Void
    let busy: Bool
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                Button {
                    if reduceMotion {
                        ingestExpanded.toggle()
                    } else {
                        withAnimation(.easeInOut(duration: 0.22)) { ingestExpanded.toggle() }
                    }
                } label: {
                    HStack(spacing: 8) {
                        StudioHeader(icon: "key.fill", title: "Ingest & stream key", caption: program.ingestProvider ?? "provider")
                        Image(systemName: "chevron.right")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(Rs.dim)
                            .rotationEffect(.degrees(ingestExpanded ? 90 : 0))
                    }
                    .contentShape(Rectangle())
                }
                .pressable().hoverEffect(.highlight)
                .accessibilityLabel("Ingest & stream key")
                .accessibilityValue(ingestExpanded ? "expanded" : "collapsed")
                if ingestExpanded {
                    Text("Live-mic streaming (advanced) — not needed for uploaded-audio sessions.")
                        .font(.inter(11)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    keyRow("Ingest URL", program.ingestUrl ?? "—", secret: false)
                    keyRow("Stream key", program.streamKey ?? "—", secret: true)
                    keyRow("HLS output", program.hlsUrl ?? "—", secret: false)
                    Button(action: onRotate) {
                        HStack(spacing: 7) {
                            if busy { ProgressView().tint(Rs.gold) } else { Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 12, weight: .semibold)) }
                            Text("Rotate stream key").font(.inter(12.5, .semibold))
                        }
                        .foregroundStyle(Rs.gold)
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
                        .overlay(Capsule().stroke(Rs.gold.opacity(0.35), lineWidth: 1))
                    }.pressable().hoverEffect(.highlight).disabled(busy).padding(.top, 2)
                }
            }
        }
    }
    @State private var ingestExpanded = false
    @State private var revealKey = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private func keyRow(_ label: String, _ value: String, secret: Bool) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label.uppercased()).font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
            HStack(spacing: 8) {
                Text(secret && !revealKey ? String(repeating: "•", count: max(8, min(value.count, 24))) : value)
                    .font(Rs.mono(11.5)).foregroundStyle(Rs.text).lineLimit(1).truncationMode(.middle)
                Spacer(minLength: 8)
                if secret {
                    Button { revealKey.toggle() } label: {
                        Image(systemName: revealKey ? "eye.slash" : "eye").font(.system(size: 12)).foregroundStyle(Rs.dim)
                    }.pressable().hoverEffect(.highlight)
                }
                Button { UIPasteboard.general.string = value } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 12)).foregroundStyle(Rs.dim)
                }.pressable().hoverEffect(.highlight).disabled(value == "—")
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
        }
    }
}

// MARK: - Listener reactions + comments

private struct ReactionsPanel: View {
    let hearts: Int, amens: Int, fires: Int
    let comments: [RadioComment]
    let onReact: (String) -> Void
    let onRefresh: () -> Void
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    StudioHeader(icon: "bubble.left.and.bubble.right.fill", title: "Listener interactions", tint: Rs.green)
                    Button(action: onRefresh) { Image(systemName: "arrow.clockwise").font(.system(size: 12)).foregroundStyle(Rs.dim) }.pressable().hoverEffect(.highlight)
                }
                HStack(spacing: 10) {
                    reactionButton("heart.fill", hearts, Rs.red) { onReact("heart") }
                    reactionButton("hands.clap.fill", amens, Rs.gold) { onReact("amen") }
                    reactionButton("flame.fill", fires, Color(hex: 0xF97316)) { onReact("fire") }
                }
                Divider().overlay(Rs.border)
                if comments.isEmpty {
                    Text("No comments yet.").font(.inter(12)).foregroundStyle(Rs.dim).padding(.vertical, 6)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(comments.prefix(8)) { c in
                            HStack(alignment: .top, spacing: 10) {
                                Circle().fill(Rs.goldFill).frame(width: 26, height: 26)
                                    .overlay(Text(initials(c.memberName ?? "?")).font(.inter(10, .bold)).foregroundStyle(Color(hex: 0x0A1120)))
                                VStack(alignment: .leading, spacing: 2) {
                                    HStack(spacing: 6) {
                                        Text(c.memberName ?? "Listener").font(.inter(11.5, .semibold)).foregroundStyle(c.hidden ? Rs.faint : Rs.text)
                                        if c.hidden { Text("HIDDEN").font(.inter(8, .bold)).foregroundStyle(Rs.faint).padding(.horizontal, 5).padding(.vertical, 1).background(Rs.faint.opacity(0.2)).clipShape(Capsule()) }
                                    }
                                    Text(c.body).font(.inter(12)).foregroundStyle(c.hidden ? Rs.faint : Rs.dim).fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                            }
                        }
                    }
                }
            }
        }
    }
    private func reactionButton(_ icon: String, _ count: Int, _ color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(color)
                Text("\(count)").font(Rs.mono(13, .semibold)).foregroundStyle(Rs.text)
            }
            .frame(maxWidth: .infinity).frame(height: 44)
            .background(color.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.3), lineWidth: 1))
        }.pressable().hoverEffect(.highlight)
    }
    private func initials(_ n: String) -> String {
        let p = n.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
}

// MARK: - Stream-health dashboard (bars, live only)

private struct StreamHealthPanel: View {
    let health: StreamHealth
    private struct Metric: Identifiable { let name: String; let value: Double; let max: Double; let unit: String; let color: Color; var id: String { name } }
    private var metrics: [Metric] {
        [
            .init(name: "CPU", value: health.cpu, max: 100, unit: "%", color: barColor(health.cpu, warn: 75, bad: 90)),
            .init(name: "Memory", value: health.memory, max: 100, unit: "%", color: barColor(health.memory, warn: 75, bad: 90)),
            .init(name: "Bitrate", value: health.bitrate, max: 320, unit: "kbps", color: Rs.green),
            .init(name: "Latency", value: health.latency, max: 500, unit: "ms", color: barColor(health.latency, warn: 200, bad: 350)),
            .init(name: "Stability", value: health.stability, max: 100, unit: "%", color: health.stability >= 85 ? Rs.green : (health.stability >= 70 ? Rs.gold : Rs.red)),
        ]
    }
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "gauge.with.dots.needle.67percent", title: "Stream health", caption: "\(health.dropped) dropped frames")
                VStack(spacing: 11) {
                    ForEach(metrics) { met in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(met.name).font(.inter(11.5, .semibold)).foregroundStyle(Rs.dim)
                                Spacer()
                                Text("\(fmt(met.value)) \(met.unit)").font(Rs.mono(11.5, .semibold)).foregroundStyle(met.color)
                            }
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    Capsule().fill(Color.white.opacity(0.06))
                                    Capsule().fill(met.color).frame(width: geo.size.width * min(1, max(0, met.value / met.max)))
                                }
                            }.frame(height: 7)
                        }
                    }
                }
            }
        }
    }
    private func fmt(_ v: Double) -> String { v == v.rounded() ? "\(Int(v))" : String(format: "%.1f", v) }
    private func barColor(_ v: Double, warn: Double, bad: Double) -> Color { v >= bad ? Rs.red : (v >= warn ? Rs.gold : Rs.green) }
}

// MARK: - Schedule (read of program schedule fields)

private struct SchedulePanel: View {
    let program: RadioProgram
    private var isScheduled: Bool { (program.scheduledAt?.isEmpty == false) && program.status != "ended" }
    private var whenText: String {
        program.scheduledAt.map { Fmt.date($0, style: .dateTime.month(.abbreviated).day().hour().minute()) } ?? "Unscheduled"
    }
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    StudioHeader(icon: "calendar", title: "Schedule", caption: program.timezone ?? "")
                    autoAirChip
                }
                HStack(spacing: 0) {
                    schedItem("WHEN", whenText)
                    schedDivider
                    schedItem("DURATION", program.durationMin.map { "\($0) min" } ?? "—")
                    schedDivider
                    schedItem("REPEAT", (program.repeatRule ?? "none").capitalized)
                }
                if isScheduled && program.autoGoLive {
                    HStack(spacing: 6) {
                        Image(systemName: "bolt.horizontal.circle.fill").font(.system(size: 11)).foregroundStyle(Rs.gold)
                        Text("Airs automatically at \(whenText)").font(.inter(11.5, .medium)).foregroundStyle(Rs.dim)
                    }
                }
            }
        }
    }
    private var autoAirChip: some View {
        HStack(spacing: 5) {
            Image(systemName: program.autoGoLive ? "bolt.fill" : "bolt.slash.fill").font(.system(size: 9))
            Text(program.autoGoLive ? "AUTO-AIR ON" : "AUTO-AIR OFF").font(.inter(9, .bold)).tracking(0.6)
        }
        .foregroundStyle(program.autoGoLive ? Rs.gold : Rs.faint)
        .padding(.horizontal, 8).frame(height: 22)
        .background((program.autoGoLive ? Rs.gold : Rs.faint).opacity(0.14)).clipShape(Capsule())
    }
    private var schedDivider: some View { Rectangle().fill(Rs.border).frame(width: 1, height: 32) }
    private func schedItem(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
            Text(value).font(.inter(13, .semibold)).foregroundStyle(Rs.text).lineLimit(1).minimumScaleFactor(0.7)
        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12)
    }
}

// MARK: - Device manager (client-only)

private struct DeviceManagerPanel: View {
    private struct Device: Identifiable { let name: String; let kind: String; let online: Bool; var id: String { name } }
    private let devices: [Device] = [
        .init(name: "Focusrite Scarlett 2i2", kind: "USB interface", online: true),
        .init(name: "Shure SM7B", kind: "Dynamic mic", online: true),
        .init(name: "Studio monitors", kind: "Output", online: true),
        .init(name: "Backup encoder", kind: "Failover", online: false),
    ]
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "hifispeaker.and.appletv", title: "Device manager", caption: "\(devices.filter { $0.online }.count)/\(devices.count) online")
                VStack(spacing: 8) {
                    ForEach(devices) { d in
                        HStack(spacing: 10) {
                            Circle().fill(d.online ? Rs.green : Rs.faint).frame(width: 7, height: 7)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(d.name).font(.inter(12.5, .semibold)).foregroundStyle(d.online ? Rs.text : Rs.faint)
                                Text(d.kind).font(.inter(10.5)).foregroundStyle(Rs.dim)
                            }
                            Spacer(minLength: 0)
                            Text(d.online ? "Connected" : "Offline").font(.inter(10, .semibold)).foregroundStyle(d.online ? Rs.green : Rs.faint)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                }
            }
        }
    }
}

// MARK: - Emergency controls

private struct EmergencyPanel: View {
    let onEnd: () -> Void
    let canEnd: Bool
    @State private var confirm = false
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "exclamationmark.octagon.fill", title: "Emergency controls", tint: Rs.red)
                Text("Cut the broadcast immediately and drop all listeners. Use only if audio must stop at once.")
                    .font(.inter(11.5)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                Button { confirm = true } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "stop.circle.fill").font(.system(size: 14, weight: .bold))
                        Text("Kill broadcast").font(.inter(13, .bold))
                    }
                    .foregroundStyle(canEnd ? .white : Rs.faint)
                    .frame(maxWidth: .infinity).frame(height: 46)
                    .background(canEnd ? AnyShapeStyle(Rs.liveGlow) : AnyShapeStyle(Color.white.opacity(0.05)))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }.pressable().hoverEffect(.highlight).disabled(!canEnd)
            }
        }
        .alert("Kill broadcast?", isPresented: $confirm) {
            Button("Cancel", role: .cancel) {}
            Button("Kill now", role: .destructive) { onEnd() }
        } message: { Text("This ends the live stream and disconnects every listener immediately.") }
    }
}

// MARK: - Dark loading / error states

struct DarkSkeleton: View {
    var body: some View {
        VStack(spacing: 14) {
            ForEach(0..<4, id: \.self) { _ in
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(Rs.panel)
                    .frame(height: 90).overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Rs.border, lineWidth: 1))
                    .shimmer()
            }
        }
    }
}

struct DarkError: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        StudioPanel {
            VStack(spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 26)).foregroundStyle(Rs.red)
                Text("Something went wrong").font(.inter(15, .semibold)).foregroundStyle(Rs.text)
                Text(message).font(.inter(12)).foregroundStyle(Rs.dim).multilineTextAlignment(.center)
                Button("Try again", action: retry).font(.inter(12.5, .semibold)).foregroundStyle(Rs.gold)
                    .padding(.horizontal, 16).frame(height: 34).background(Rs.gold.opacity(0.12)).clipShape(Capsule()).padding(.top, 2)
            }.frame(maxWidth: .infinity).padding(.vertical, 20)
        }
    }
}

// MARK: - ===================== Audio library + Sessions =====================
// Two dark panels wired to the frozen library/playlist contract. A single store
// owns the library tracks + every session's playlist and drives a lightweight
// AVQueuePlayer preview that honours the session's loopMode.
// The store + the two sections are internal (not file-private) but render ONLY
// on the Uploads & Sessions page (UploadsSessionsView.swift, both platforms) —
// the Radio Studio dropped its inline copies; they just live in this file
// because they share the Rs chrome and the radio API surface.

enum TrackKind: String, CaseIterable, Identifiable {
    case music, preaching, audio
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
    var color: Color {
        switch self {
        case .music:     return Rs.green
        case .preaching: return Rs.gold
        case .audio:     return Color(hex: 0x3B82F6)   // blue
        }
    }
}

enum LoopMode: String, CaseIterable {
    case none, loop_all, repeat_one
    var label: String {
        switch self {
        case .none:       return "Off"
        case .loop_all:   return "Loop all"
        case .repeat_one: return "Repeat one"
        }
    }
    var icon: String {
        switch self {
        case .none:       return "arrow.forward.to.line"
        case .loop_all:   return "repeat"
        case .repeat_one: return "repeat.1"
        }
    }
    var next: LoopMode {
        switch self {
        case .none:       return .loop_all
        case .loop_all:   return .repeat_one
        case .repeat_one: return .none
        }
    }
    static func from(_ s: String) -> LoopMode { LoopMode(rawValue: s) ?? .none }
}

/// One visible entry in the upload queue — filename, size, live progress, then a
/// ✓ done (auto-clears after ~4s) or a retry-able error. The kind is captured at
/// enqueue time so a mid-queue filter switch doesn't re-file earlier picks.
struct UploadJob: Identifiable, Equatable {
    enum Phase: Equatable {
        case queued
        case uploading
        case done
        case failed(String)
    }
    let id = UUID()
    let url: URL                 // security-scoped picker URL (read when the job runs)
    let filename: String
    let kind: String             // library kind at pick time (music|preaching|audio)
    var totalBytes: Int64        // file size at enqueue; refined to the multipart total mid-flight
    var sentBytes: Int64 = 0
    var phase: Phase = .queued
    /// Validation failures (bad extension / over the cap) re-fail identically, so
    /// their rows offer dismiss only — transport/server errors keep the Retry.
    var canRetry = true

    var fraction: Double {
        totalBytes > 0 ? min(1, Double(sentBytes) / Double(totalBytes)) : 0
    }
}

@MainActor
final class AudioLibraryStore: ObservableObject {
    // Library
    @Published var tracks: [RadioTrack] = []
    @Published var kind: TrackKind = .music
    @Published var loaded = false
    @Published var error: String?
    @Published var busy = false
    @Published var uploading = false

    // Upload queue (multi-file picker) — rows render above the library list.
    // Jobs run SEQUENTIALLY through one worker; each completed file registers its
    // track and refreshes the list, so the library grows as the queue drains.
    @Published var uploads: [UploadJob] = []
    private var uploadWorkerRunning = false

    // Checkbox multi-select over the CURRENT kind filter (ids of library tracks).
    @Published var selectedTrackIds: Set<String> = []

    // Sessions + their playlists (keyed by program id)
    @Published var sessions: [RadioProgram] = []
    @Published var playlists: [String: [RadioPlaylistItem]] = [:]
    @Published var newSessionName = ""

    // Client-side preview (AVQueuePlayer honouring loopMode)
    @Published var previewSessionId: String?
    @Published var previewTitle: String?
    @Published var previewItemId: String?     // playlist item currently in the player
    private var player: AVQueuePlayer?
    private var previewItems: [RadioPlaylistItem] = []
    private var previewIndex = 0
    private var previewLoop: LoopMode = .none
    private var endObserver: NSObjectProtocol?

    func load() async {
        async let t = (try? await PortalAPI.radioTracks(kind: kind.rawValue)) ?? []
        async let s = (try? await PortalAPI.radioPrograms()) ?? []
        tracks = await t
        sessions = await s
        await reloadAllPlaylists()
        loaded = true
    }

    func reloadTracks() async {
        do {
            tracks = try await PortalAPI.radioTracks(kind: kind.rawValue); error = nil
            // Prune selection to tracks that still exist in the current filter.
            selectedTrackIds.formIntersection(tracks.map(\.id))
        }
        catch { self.error = (error as? APIError)?.errorDescription ?? "Could not load the audio library." }
    }

    func selectKind(_ k: TrackKind) {
        guard k != kind else { return }
        kind = k
        selectedTrackIds = []          // selection is per-filter
        Task { await reloadTracks() }
    }

    private func reloadAllPlaylists() async {
        var next: [String: [RadioPlaylistItem]] = [:]
        for s in sessions {
            if let items = try? await PortalAPI.radioPlaylist(s.id) { next[s.id] = items }
        }
        playlists = next
    }

    func reloadSession(_ id: String) async {
        if let items = try? await PortalAPI.radioPlaylist(id) { playlists[id] = items }
    }

    // MARK: Library mutations — multi-file upload queue

    /// Enqueue every picked file as a visible upload row and kick the worker.
    /// Client-side pre-checks (extension + 110 MB cap) run immediately on the
    /// stat'd size so an invalid pick fails fast without a wasted transfer.
    func enqueueUploads(_ urls: [URL]) {
        for url in urls {
            var size: Int64 = 0
            let scoped = url.startAccessingSecurityScopedResource()
            if let s = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize { size = Int64(s) }
            if scoped { url.stopAccessingSecurityScopedResource() }

            var job = UploadJob(url: url, filename: url.lastPathComponent,
                                kind: kind.rawValue, totalBytes: size)
            if let msg = AudioUploadRules.validate(filename: job.filename, byteCount: Int(size)) {
                job.phase = .failed(msg)
                job.canRetry = false           // re-running can't fix a bad file
            }
            uploads.append(job)
        }
        pumpUploads()
    }

    /// Re-queue a failed job (transport/server errors only) and restart the worker.
    func retryUpload(_ id: UUID) {
        guard let i = uploads.firstIndex(where: { $0.id == id }),
              case .failed = uploads[i].phase, uploads[i].canRetry else { return }
        uploads[i].phase = .queued
        uploads[i].sentBytes = 0
        pumpUploads()
    }

    /// Remove a finished/failed row from the queue display.
    func dismissUpload(_ id: UUID) {
        uploads.removeAll { $0.id == id }
    }

    /// Single sequential worker: drains `.queued` jobs one at a time. `uploading`
    /// mirrors "worker active" so the Upload button can show a spinner (it stays
    /// tappable — more files just join the queue).
    private func pumpUploads() {
        guard !uploadWorkerRunning else { return }
        uploadWorkerRunning = true
        uploading = true
        Task {
            while let next = uploads.first(where: { $0.phase == .queued }) {
                await runUpload(next.id)
            }
            uploadWorkerRunning = false
            uploading = false
        }
    }

    private func runUpload(_ id: UUID) async {
        guard let i = uploads.firstIndex(where: { $0.id == id }) else { return }
        uploads[i].phase = .uploading
        let job = uploads[i]

        let scoped = job.url.startAccessingSecurityScopedResource()
        defer { if scoped { job.url.stopAccessingSecurityScopedResource() } }
        do {
            let data = try Data(contentsOf: job.url)
            if let msg = AudioUploadRules.validate(filename: job.filename, byteCount: data.count) {
                fail(id, msg, canRetry: false)
                return
            }
            update(id) { $0.totalBytes = Int64(data.count) }
            let up = try await PortalAPI.uploadRadioAudioWithProgress(
                data: data, filename: job.filename,
                onProgress: { [weak self] sent, total in
                    Task { @MainActor in
                        self?.update(id) { j in
                            j.sentBytes = sent
                            if total > 0 { j.totalBytes = total }
                        }
                    }
                })
            let title = (job.filename as NSString).deletingPathExtension
            var body: [String: RadioJSON] = [
                "title": .string(title.isEmpty ? "Untitled" : title),
                "kind": .string(job.kind),
                "audio_url": .string(up.url),
                "size_bytes": .int(data.count),
            ]
            if let d = up.durationSec { body["duration_sec"] = .int(d) }
            _ = try await PortalAPI.createRadioTrack(body)
            update(id) { j in j.phase = .done; j.sentBytes = j.totalBytes }
            await reloadTracks()
            scheduleDoneClear(id)
        } catch {
            fail(id, (error as? APIError)?.errorDescription ?? "Could not upload the audio file.")
        }
    }

    private func update(_ id: UUID, _ mutate: (inout UploadJob) -> Void) {
        guard let i = uploads.firstIndex(where: { $0.id == id }) else { return }
        mutate(&uploads[i])
    }

    private func fail(_ id: UUID, _ message: String, canRetry: Bool = true) {
        update(id) { j in j.phase = .failed(message); j.canRetry = canRetry }
    }

    /// Green ✓ rows tidy themselves away after ~4s.
    private func scheduleDoneClear(_ id: UUID) {
        Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            uploads.removeAll { $0.id == id && $0.phase == .done }
        }
    }

    func deleteTrack(_ id: String) {
        Task {
            busy = true; error = nil
            do { try await PortalAPI.deleteRadioTrack(id); await reloadTracks() }
            catch { self.error = (error as? APIError)?.errorDescription ?? "Could not delete the track." }
            busy = false
        }
    }

    // MARK: Library multi-select + bulk actions

    enum SelectionState { case none, some, all }

    /// Ids of the CURRENTLY LISTED tracks (kind filter applied) that are selected,
    /// in library order — bulk actions run in the order the user sees.
    var orderedSelection: [String] {
        tracks.map(\.id).filter { selectedTrackIds.contains($0) }
    }
    var selectedCount: Int { orderedSelection.count }

    var selectionState: SelectionState {
        let n = selectedCount
        if n == 0 { return .none }
        return n == tracks.count ? .all : .some
    }

    func toggleSelect(_ trackId: String) {
        if selectedTrackIds.contains(trackId) { selectedTrackIds.remove(trackId) }
        else { selectedTrackIds.insert(trackId) }
    }

    /// Tri-state header checkbox: all-selected clears; anything else selects the
    /// whole current filter.
    func toggleSelectAll() {
        if selectionState == .all { selectedTrackIds = [] }
        else { selectedTrackIds = Set(tracks.map(\.id)) }
    }

    func clearSelection() { selectedTrackIds = [] }

    /// Append every selected track to a session — sequentially, via the same
    /// endpoint the single add uses — then reconcile and clear the selection.
    func addSelected(to sessionId: String) {
        let ids = orderedSelection
        guard !ids.isEmpty else { return }
        Task {
            busy = true; error = nil
            do {
                for id in ids { _ = try await PortalAPI.addToRadioPlaylist(sessionId, trackId: id) }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not add the selected tracks."
            }
            await reloadSession(sessionId)
            selectedTrackIds = []
            busy = false
        }
    }

    /// Delete every selected track (the caller confirms ONCE before invoking).
    func deleteSelected() {
        let ids = orderedSelection
        guard !ids.isEmpty else { return }
        Task {
            busy = true; error = nil
            do {
                for id in ids { try await PortalAPI.deleteRadioTrack(id) }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not delete the selected tracks."
            }
            await reloadTracks()
            selectedTrackIds = []
            busy = false
        }
    }

    // MARK: Session mutations

    func createSession() {
        let name = newSessionName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        Task {
            busy = true; error = nil
            do {
                let p = try await PortalAPI.createRadioProgramTitle(name)
                newSessionName = ""
                sessions.insert(p, at: 0)
                playlists[p.id] = []
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not create the session."
            }
            busy = false
        }
    }

    func deleteSession(_ id: String) {
        if previewSessionId == id { stopPreview() }
        Task {
            busy = true; error = nil
            do {
                try await PortalAPI.deleteRadioProgram(id)
                sessions.removeAll { $0.id == id }
                playlists[id] = nil
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not delete the session."
            }
            busy = false
        }
    }

    func addTrack(_ trackId: String, to sessionId: String) {
        Task {
            busy = true; error = nil
            do { _ = try await PortalAPI.addToRadioPlaylist(sessionId, trackId: trackId); await reloadSession(sessionId) }
            catch { self.error = (error as? APIError)?.errorDescription ?? "Could not add the track." }
            busy = false
        }
    }

    func removeItem(_ itemId: String, from sessionId: String) {
        Task {
            busy = true; error = nil
            do { try await PortalAPI.removeFromRadioPlaylist(sessionId, itemId: itemId); await reloadSession(sessionId) }
            catch { self.error = (error as? APIError)?.errorDescription ?? "Could not remove the track." }
            busy = false
        }
    }

    /// Move the item at `index` by `delta` (±1) and PUT the recomputed id order.
    func move(_ sessionId: String, index: Int, by delta: Int) {
        guard var items = playlists[sessionId] else { return }
        let dest = index + delta
        guard items.indices.contains(index), items.indices.contains(dest) else { return }
        items.swapAt(index, dest)
        playlists[sessionId] = items                    // optimistic
        persistOrder(sessionId, items)
    }

    /// Drag-to-reorder: lift the item at `from` and drop it at `to`, then persist
    /// through the SAME path as the arrow moves (PUT the full id order; the server
    /// response reconciles the optimistic local state).
    func move(_ sessionId: String, from: Int, to: Int) {
        guard var items = playlists[sessionId], from != to,
              items.indices.contains(from), items.indices.contains(to) else { return }
        let it = items.remove(at: from)
        items.insert(it, at: to)
        playlists[sessionId] = items                    // optimistic
        persistOrder(sessionId, items)
    }

    /// One persist path for BOTH reorder gestures (arrows + drag): PUT the id
    /// order, adopt the server's echo, reload on failure.
    private func persistOrder(_ sessionId: String, _ items: [RadioPlaylistItem]) {
        let order = items.map { $0.id }
        Task {
            busy = true; error = nil
            do { let fresh = try await PortalAPI.reorderRadioPlaylist(sessionId, itemIds: order); playlists[sessionId] = fresh }
            catch { self.error = (error as? APIError)?.errorDescription ?? "Could not reorder."; await reloadSession(sessionId) }
            busy = false
        }
    }

    func setLoop(_ sessionId: String, _ mode: LoopMode) {
        Task {
            do {
                let updated = try await PortalAPI.setRadioLoopMode(sessionId, mode.rawValue)
                if let i = sessions.firstIndex(where: { $0.id == sessionId }) { sessions[i] = updated }
                if previewSessionId == sessionId { previewLoop = mode }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? "Could not set loop mode."
            }
        }
    }

    func loopMode(for sessionId: String) -> LoopMode {
        LoopMode.from(sessions.first { $0.id == sessionId }?.loopMode ?? "none")
    }

    // MARK: Play live (go-live + client preview honouring loopMode)

    func playLive(_ sessionId: String) {
        guard let items = playlists[sessionId], !items.isEmpty else {
            error = "This session has no tracks to play."
            return
        }
        Task { _ = try? await PortalAPI.radioGoLive(sessionId) }   // server-authoritative go-live
        startPreview(sessionId: sessionId, items: items, loop: loopMode(for: sessionId))
    }

    private func startPreview(sessionId: String, items: [RadioPlaylistItem], loop: LoopMode) {
        stopPreview()
        enableBackgroundPlayback()
        previewItems = items
        previewLoop = loop
        previewIndex = 0
        previewSessionId = sessionId
        let q = AVQueuePlayer()
        player = q
        observeItemEnds()
        playCurrent()
    }

    private func playCurrent() {
        guard previewItems.indices.contains(previewIndex),
              let url = URL(string: previewItems[previewIndex].track.audioUrl) else { stopPreview(); return }
        let item = AVPlayerItem(url: url)
        player?.removeAllItems()
        player?.insert(item, after: nil)
        previewTitle = previewItems[previewIndex].track.title
        previewItemId = previewItems[previewIndex].id
        player?.play()
    }

    private func observeItemEnds() {
        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.advance() }
        }
    }

    private func advance() {
        switch previewLoop {
        case .repeat_one:
            playCurrent()                                     // replay current
        case .loop_all:
            previewIndex = (previewIndex + 1) % max(previewItems.count, 1)
            playCurrent()                                     // wrap
        case .none:
            previewIndex += 1
            if previewItems.indices.contains(previewIndex) { playCurrent() }
            else { stopPreview() }                            // stop at end
        }
    }

    func stopPreview() {
        player?.pause()
        player?.removeAllItems()
        player = nil
        if let o = endObserver { NotificationCenter.default.removeObserver(o); endObserver = nil }
        previewSessionId = nil
        previewTitle = nil
        previewItemId = nil
        previewItems = []
        previewIndex = 0
    }

    func teardown() { stopPreview() }
}

// MARK: - Byte / duration formatting

private func fmtBytes(_ bytes: Int?) -> String? {
    guard let b = bytes, b > 0 else { return nil }
    let mb = Double(b) / 1_048_576
    if mb >= 1 { return String(format: "%.1f MB", mb) }
    let kb = Double(b) / 1024
    return String(format: "%.0f KB", kb)
}
private func fmtDuration(_ sec: Int?) -> String? {
    guard let s = sec, s > 0 else { return nil }
    let h = s / 3600, m = (s % 3600) / 60, ss = s % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, ss) : String(format: "%d:%02d", m, ss)
}

// MARK: - Audio library section

struct AudioLibrarySection: View {
    @ObservedObject var store: AudioLibraryStore
    @State private var showImporter = false
    /// Mac only — full-library sheet (never set on iPad).
    @State private var showFullLibrary = false

    /// Mac lanes show a stable 5-row preview; the full list lives in the sheet.
    private var visibleTracks: [RadioTrack] {
        MacDesign.isMac ? Array(store.tracks.prefix(macLanePreviewCap)) : store.tracks
    }

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    StudioHeader(icon: "music.note.list", title: "Audio library",
                                 caption: "\(store.tracks.count) track\(store.tracks.count == 1 ? "" : "s")", tint: Rs.green)
                    if MacDesign.isMac {
                        ViewChipButton { showFullLibrary = true }
                    }
                }
                // Kind picker + Upload
                HStack(spacing: 10) {
                    KindSegmented(selection: store.kind) { store.selectKind($0) }
                    Spacer(minLength: 8)
                    UploadMusicButton(uploading: store.uploading) { showImporter = true }
                }

                // In-flight uploads render ABOVE the list (also in the sheet).
                UploadQueueList(store: store)

                if store.tracks.isEmpty {
                    LibraryEmptyState(kind: store.kind)
                } else {
                    LibrarySelectionBar(store: store)
                    VStack(spacing: 8) {
                        ForEach(visibleTracks) { t in
                            TrackRow(track: t, sessions: store.sessions,
                                     isSelected: store.selectedTrackIds.contains(t.id),
                                     onToggleSelect: { store.toggleSelect(t.id) },
                                     onAddToSession: { store.addTrack(t.id, to: $0) },
                                     onDelete: { store.deleteTrack(t.id) })
                        }
                        if MacDesign.isMac, store.tracks.count > macLanePreviewCap {
                            MoreTracksLine(count: store.tracks.count - macLanePreviewCap)
                        }
                    }
                }
                if let e = store.error {
                    Text(e).font(.inter(11)).foregroundStyle(Rs.red).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .fileImporter(isPresented: $showImporter,
                      allowedContentTypes: AudioUploadRules.allowedContentTypes,
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { store.enqueueUploads(urls) }
            else if case .failure(let err) = result { store.error = err.localizedDescription }
        }
        // Mac only — the View chip sets `showFullLibrary` (iPad shows the full
        // list inline); presents as a big CENTERED studio modal.
        .studioModal(isPresented: $showFullLibrary) { AudioLibrarySheet(store: store) }
    }
}

/// Shared library empty state (lane card + full-library sheet).
private struct LibraryEmptyState: View {
    let kind: TrackKind
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "music.note").font(.system(size: 24)).foregroundStyle(Rs.faint)
            Text("No \(kind.label.lowercased()) tracks yet").font(.inter(12.5, .semibold)).foregroundStyle(Rs.text)
            Text("Upload audio to build a reusable library.").font(.inter(11)).foregroundStyle(Rs.dim)
        }.frame(maxWidth: .infinity).padding(.vertical, 22)
    }
}

/// The gold "Upload music" pill (lane card + full-library sheet) — same view
/// tree the section always rendered, extracted so the sheet reuses it verbatim.
/// Stays TAPPABLE while the queue drains — new picks simply join the queue; the
/// spinner just signals that uploads are in flight.
private struct UploadMusicButton: View {
    let uploading: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if uploading { ProgressView().tint(Color(hex: 0x0A1120)) }
                else { Image(systemName: "arrow.up.circle.fill").font(.system(size: 12, weight: .bold)) }
                Text("Upload music").font(.inter(12, .bold))
            }
            .foregroundStyle(Color(hex: 0x0A1120))
            .padding(.horizontal, 14).frame(height: 34)
            .background(Rs.goldFill).clipShape(Capsule())
        }.pressable().hoverEffect(.highlight)
    }
}

// MARK: - Upload queue (multi-file, per-file progress)

/// The visible upload queue — one row per picked file, rendered above the
/// library list in BOTH the lane card and the full-library sheet. Empty queue
/// renders nothing (EmptyView keeps the surrounding VStack spacing clean).
private struct UploadQueueList: View {
    @ObservedObject var store: AudioLibraryStore
    var body: some View {
        if !store.uploads.isEmpty {
            VStack(spacing: 6) {
                ForEach(store.uploads) { job in
                    UploadJobRow(job: job,
                                 onRetry: { store.retryUpload(job.id) },
                                 onDismiss: { store.dismissUpload(job.id) })
                }
            }
        }
    }
}

/// One upload row: filename + size, then a determinate Rs-gold progress bar with
/// percent and uploaded/total MB while transferring; a green ✓ done state (the
/// store auto-clears it after ~4s); or a red error with Retry (transport/server
/// failures) and a dismiss ×.
private struct UploadJobRow: View {
    let job: UploadJob
    let onRetry: () -> Void
    let onDismiss: () -> Void

    private var mb: (sent: Double, total: Double) {
        (Double(job.sentBytes) / 1_048_576, Double(job.totalBytes) / 1_048_576)
    }

    var body: some View {
        HStack(spacing: 11) {
            statusIcon
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 8) {
                    Text(job.filename)
                        .font(.inter(12, .semibold)).foregroundStyle(Rs.text)
                        .lineLimit(1).truncationMode(.middle)
                    Spacer(minLength: 6)
                    trailing
                }
                detail
            }
        }
        .padding(.horizontal, 11).padding(.vertical, 9)
        .background(rowTint.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(rowTint.opacity(0.3), lineWidth: 1))
    }

    private var rowTint: Color {
        switch job.phase {
        case .done:   return Rs.green
        case .failed: return Rs.red
        default:      return Rs.gold
        }
    }

    @ViewBuilder private var statusIcon: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 9, style: .continuous).fill(rowTint.opacity(0.16))
            switch job.phase {
            case .done:
                Image(systemName: "checkmark").font(.system(size: 13, weight: .bold)).foregroundStyle(Rs.green)
            case .failed:
                Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12, weight: .bold)).foregroundStyle(Rs.red)
            case .uploading:
                Image(systemName: "arrow.up").font(.system(size: 12, weight: .bold)).foregroundStyle(Rs.gold)
            case .queued:
                Image(systemName: "clock").font(.system(size: 12, weight: .semibold)).foregroundStyle(Rs.dim)
            }
        }.frame(width: 34, height: 34)
    }

    @ViewBuilder private var trailing: some View {
        switch job.phase {
        case .uploading:
            Text("\(Int(job.fraction * 100))%").font(Rs.mono(10.5, .semibold)).foregroundStyle(Rs.gold).fixedSize()
        case .queued:
            Text("QUEUED").font(.inter(8.5, .bold)).tracking(0.7).foregroundStyle(Rs.dim)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Color.white.opacity(0.06)).clipShape(Capsule())
        case .done:
            Text("UPLOADED").font(.inter(8.5, .bold)).tracking(0.7).foregroundStyle(Rs.green)
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Rs.green.opacity(0.16)).clipShape(Capsule())
        case .failed:
            HStack(spacing: 6) {
                if job.canRetry {
                    Button(action: onRetry) {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.clockwise").font(.system(size: 9, weight: .bold))
                            Text("Retry").font(.inter(10.5, .bold))
                        }
                        .foregroundStyle(Rs.red)
                        .padding(.horizontal, 9).frame(height: 24)
                        .background(Rs.red.opacity(0.14)).clipShape(Capsule())
                        .overlay(Capsule().stroke(Rs.red.opacity(0.35), lineWidth: 1))
                    }.pressable().hoverEffect(.highlight)
                }
                Button(action: onDismiss) {
                    Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Rs.dim).frame(width: 24, height: 24)
                }.pressable().hoverEffect(.highlight)
                .accessibilityLabel("Dismiss failed upload")
            }
        }
    }

    @ViewBuilder private var detail: some View {
        switch job.phase {
        case .uploading:
            VStack(alignment: .leading, spacing: 4) {
                RsProgressBar(fraction: job.fraction)
                Text(String(format: "%.1f / %.1f MB", mb.sent, mb.total))
                    .font(Rs.mono(9.5)).foregroundStyle(Rs.dim)
            }
        case .queued:
            Text(fmtBytes(Int(job.totalBytes)) ?? "Waiting…")
                .font(Rs.mono(9.5)).foregroundStyle(Rs.faint)
        case .done:
            Text("\(fmtBytes(Int(job.totalBytes)) ?? "") · added to the library")
                .font(.inter(10)).foregroundStyle(Rs.dim)
        case .failed(let msg):
            Text(msg).font(.inter(10)).foregroundStyle(Rs.red)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// Determinate Rs-gold progress bar (capsule track + goldFill).
private struct RsProgressBar: View {
    let fraction: Double
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.white.opacity(0.07))
                Capsule().fill(Rs.goldFill)
                    .frame(width: max(6, geo.size.width * min(1, max(0, fraction))))
            }
        }
        .frame(height: 6)
        .animation(.linear(duration: 0.2), value: fraction)
    }
}

// MARK: - Library multi-select (checkboxes + bulk actions)

/// Rs-themed square checkbox for a single track row.
private struct SelectCheckbox: View {
    let isOn: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isOn ? AnyShapeStyle(Rs.goldFill) : AnyShapeStyle(Color.white.opacity(0.04)))
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(isOn ? Rs.goldDeep : Rs.borderHi, lineWidth: 1)
                if isOn {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x0A1120))
                }
            }
            .frame(width: 20, height: 20)
            .contentShape(Rectangle())
        }.pressable().hoverEffect(.highlight)
        .accessibilityLabel(isOn ? "Deselect track" : "Select track")
    }
}

/// Header select-all checkbox — tri-state (none / some / all over the current
/// kind filter), plus the "N selected" label and, when ≥1 is selected, the bulk
/// actions: "Add N to session ▾" (session picker) and "Delete N" (confirm once).
private struct LibrarySelectionBar: View {
    @ObservedObject var store: AudioLibraryStore
    @State private var confirmDelete = false

    private var n: Int { store.selectedCount }

    var body: some View {
        HStack(spacing: 10) {
            triState
            Text(n == 0 ? "Select all" : "\(n) selected")
                .font(.inter(11.5, n == 0 ? .medium : .bold))
                .foregroundStyle(n == 0 ? Rs.dim : Rs.gold)
                .fixedSize()
            Spacer(minLength: 6)
            if n > 0 {
                addMenu
                deleteButton
            }
        }
        .padding(.horizontal, 11).frame(minHeight: 40)
        .background((n > 0 ? Rs.gold : Color.white).opacity(n > 0 ? 0.07 : 0.03))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(n > 0 ? Rs.gold.opacity(0.3) : Rs.border, lineWidth: 1))
        .alert("Delete \(n) track\(n == 1 ? "" : "s")?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { store.deleteSelected() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the selected tracks from the station library. Sessions using them lose those playlist entries.")
        }
    }

    /// none → empty square · some → gold minus square · all → gold check square.
    private var triState: some View {
        Button { store.toggleSelectAll() } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(store.selectionState == .none
                          ? AnyShapeStyle(Color.white.opacity(0.04))
                          : AnyShapeStyle(Rs.goldFill))
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(store.selectionState == .none ? Rs.borderHi : Rs.goldDeep, lineWidth: 1)
                switch store.selectionState {
                case .none: EmptyView()
                case .some:
                    Image(systemName: "minus").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x0A1120))
                case .all:
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color(hex: 0x0A1120))
                }
            }
            .frame(width: 20, height: 20)
            .contentShape(Rectangle())
        }.pressable().hoverEffect(.highlight)
        .accessibilityLabel(store.selectionState == .all ? "Deselect all tracks" : "Select all tracks")
    }

    @ViewBuilder private var addMenu: some View {
        if store.sessions.isEmpty {
            Text("No sessions").font(.inter(10)).foregroundStyle(Rs.faint)
        } else {
            Menu {
                ForEach(store.sessions) { s in
                    Button(s.title.isEmpty ? "Untitled" : s.title) { store.addSelected(to: s.id) }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                    Text("Add \(n) to session").font(.inter(11, .semibold))
                    Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                }
                .foregroundStyle(Rs.gold)
                .padding(.horizontal, 10).frame(height: 28)
                .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
                .overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
            }
        }
    }

    private var deleteButton: some View {
        Button { confirmDelete = true } label: {
            HStack(spacing: 4) {
                Image(systemName: "trash").font(.system(size: 10, weight: .bold))
                Text("Delete \(n)").font(.inter(11, .semibold))
            }
            .foregroundStyle(Rs.red)
            .padding(.horizontal, 10).frame(height: 28)
            .background(Rs.red.opacity(0.12)).clipShape(Capsule())
            .overlay(Capsule().stroke(Rs.red.opacity(0.3), lineWidth: 1))
        }.pressable().hoverEffect(.highlight)
    }
}

/// Music / Preaching / Audio segmented picker (dark).
private struct KindSegmented: View {
    let selection: TrackKind
    let onSelect: (TrackKind) -> Void
    var body: some View {
        HStack(spacing: 3) {
            ForEach(TrackKind.allCases) { k in
                let on = k == selection
                Button { onSelect(k) } label: {
                    Text(k.label).font(.inter(11.5, .semibold))
                        .foregroundStyle(on ? Color(hex: 0x0A1120) : Rs.dim)
                        .padding(.horizontal, 12).frame(height: 28)
                        .background(on ? AnyShapeStyle(k.color) : AnyShapeStyle(Color.clear))
                        .clipShape(Capsule())
                }.pressable().hoverEffect(.highlight)
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.04)).clipShape(Capsule())
        .overlay(Capsule().stroke(Rs.border, lineWidth: 1))
    }
}

private struct TrackRow: View {
    let track: RadioTrack
    let sessions: [RadioProgram]
    /// Full-library sheet passes the row index for zebra striping; nil (lane
    /// cards) keeps the uniform card background.
    var zebraIndex: Int? = nil
    /// Multi-select checkbox (Uploads & Sessions page + library sheet). nil on
    /// any context that shouldn't offer selection — the checkbox simply doesn't
    /// render there.
    var isSelected: Bool? = nil
    var onToggleSelect: (() -> Void)? = nil
    let onAddToSession: (String) -> Void
    let onDelete: () -> Void

    private var kind: TrackKind { TrackKind(rawValue: track.kind) ?? .audio }
    private var bgOpacity: Double {
        guard let i = zebraIndex else { return 0.03 }
        return i.isMultiple(of: 2) ? 0.045 : 0.02
    }
    private var selected: Bool { isSelected == true }

    var body: some View {
        HStack(spacing: 11) {
            if let isSelected, let onToggleSelect {
                SelectCheckbox(isOn: isSelected, action: onToggleSelect)
            }
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(kind.color.opacity(0.16))
                Image(systemName: "music.note").font(.system(size: 13, weight: .semibold)).foregroundStyle(kind.color)
            }.frame(width: 34, height: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(track.title.isEmpty ? "Untitled" : track.title)
                    .font(.inter(12.5, .semibold)).foregroundStyle(Rs.text).lineLimit(1)
                HStack(spacing: 8) {
                    Text(kind.label.uppercased()).font(.inter(8.5, .bold)).tracking(0.5)
                        .foregroundStyle(kind.color)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(kind.color.opacity(0.16)).clipShape(Capsule())
                    if let d = fmtDuration(track.durationSec) {
                        Text(d).font(Rs.mono(10)).foregroundStyle(Rs.dim)
                    }
                    if let s = fmtBytes(track.sizeBytes) {
                        Text(s).font(Rs.mono(9.5)).foregroundStyle(Rs.faint)
                    }
                }
            }
            Spacer(minLength: 6)

            // + Session menu
            if sessions.isEmpty {
                Text("No sessions").font(.inter(10)).foregroundStyle(Rs.faint)
            } else {
                Menu {
                    ForEach(sessions) { s in
                        Button(s.title.isEmpty ? "Untitled" : s.title) { onAddToSession(s.id) }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                        Text("Session").font(.inter(11, .semibold))
                    }
                    .foregroundStyle(Rs.gold)
                    .padding(.horizontal, 10).frame(height: 28)
                    .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
                    .overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
                }
            }

            Menu {
                Button("Delete track", role: .destructive) { onDelete() }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Rs.dim).frame(width: 28, height: 28)
            }
        }
        .padding(.horizontal, 11).padding(.vertical, 8)
        .background(selected ? Rs.gold.opacity(0.07) : Color.white.opacity(bgOpacity))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous)
            .stroke(selected ? Rs.gold.opacity(0.4) : Rs.border, lineWidth: 1))
    }
}

// MARK: - Sessions section

struct SessionsSection: View {
    @ObservedObject var store: AudioLibraryStore
    /// Id of the program currently on air (nil when off air) + the icy `now_playing`
    /// title from the ~3s health poll — used to badge the airing playlist row.
    var liveProgramId: String? = nil
    var nowPlaying: String? = nil
    /// Deep-link hand-off (Radio Studio's Session-audio card → this page): when
    /// the bound id is set, open that session's console sheet and clear it.
    var openSessionId: Binding<String?> = .constant(nil)
    /// The session whose full console sheet is open — iPad presents a native
    /// page sheet, the Mac a centered studio modal (see `studioModal`).
    @State private var viewSession: SessionSheetTarget?

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "square.stack.3d.down.right.fill", title: "Sessions",
                             caption: "\(store.sessions.count) session\(store.sessions.count == 1 ? "" : "s")")

                // Create a session
                HStack(spacing: 10) {
                    TextField("", text: Binding(get: { store.newSessionName }, set: { store.newSessionName = $0 }),
                              prompt: Text("New session name…").foregroundColor(Rs.faint))
                        .font(.inter(12.5)).foregroundStyle(Rs.text)
                        .padding(.horizontal, 12).frame(height: 36)
                        .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
                        .submitLabel(.done)
                        .onSubmit { store.createSession() }
                    Button { store.createSession() } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                            Text("Create").font(.inter(12, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 14).frame(height: 36)
                        .background(Rs.goldFill).clipShape(Capsule())
                    }.pressable().hoverEffect(.highlight)
                    .disabled(store.newSessionName.trimmingCharacters(in: .whitespaces).isEmpty)
                }

                // Now previewing line
                if let title = store.previewTitle {
                    HStack(spacing: 7) {
                        Image(systemName: "waveform").font(.system(size: 11)).foregroundStyle(Rs.gold)
                        Text("Now previewing: \(title)").font(.inter(11.5, .semibold)).foregroundStyle(Rs.gold)
                        Spacer(minLength: 6)
                        Button { store.stopPreview() } label: {
                            Text("Stop").font(.inter(11, .semibold)).foregroundStyle(Rs.dim)
                        }.pressable().hoverEffect(.highlight)
                    }
                    .padding(.horizontal, 12).frame(height: 34)
                    .background(Rs.gold.opacity(0.10)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.gold.opacity(0.3), lineWidth: 1))
                }

                if store.sessions.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "square.stack.3d.down.right").font(.system(size: 24)).foregroundStyle(Rs.faint)
                        Text("No sessions yet").font(.inter(12.5, .semibold)).foregroundStyle(Rs.text)
                        Text("Name a session above to build a playlist.")
                            .font(.inter(11)).foregroundStyle(Rs.dim)
                    }.frame(maxWidth: .infinity).padding(.vertical, 22)
                } else {
                    VStack(spacing: 12) {
                        ForEach(store.sessions) { s in
                            SessionCard(
                                session: s,
                                items: store.playlists[s.id] ?? [],
                                loop: store.loopMode(for: s.id),
                                tracks: store.tracks,
                                nowPlaying: s.id == liveProgramId ? nowPlaying : nil,
                                previewItemId: store.previewSessionId == s.id ? store.previewItemId : nil,
                                previewLimit: macLanePreviewCap,
                                onView: { viewSession = SessionSheetTarget(id: s.id) },
                                onSetLoop: { store.setLoop(s.id, $0) },
                                onPlay: { store.playLive(s.id) },
                                onDeleteSession: { store.deleteSession(s.id) },
                                onMove: { idx, delta in store.move(s.id, index: idx, by: delta) },
                                onReorder: { from, to in store.move(s.id, from: from, to: to) },
                                onRemove: { store.removeItem($0, from: s.id) },
                                onAddTrack: { store.addTrack($0, to: s.id) }
                            )
                        }
                    }
                }
            }
        }
        // The View chip opens the full session console — native page sheet on
        // iPad, big centered studio modal on the Mac.
        .studioModal(item: $viewSession) { target in
            SessionConsoleSheet(store: store,
                                sessionId: target.id,
                                liveProgramId: liveProgramId,
                                nowPlaying: nowPlaying)
        }
        // Deep link: the id may be set before this section mounts (fresh page
        // load) or after (page already on screen) — cover both.
        .onAppear { openFromDeepLink() }
        .onChange(of: openSessionId.wrappedValue) { _, _ in openFromDeepLink() }
    }

    private func openFromDeepLink() {
        guard let id = openSessionId.wrappedValue else { return }
        openSessionId.wrappedValue = nil
        viewSession = SessionSheetTarget(id: id)
    }
}

private struct SessionCard: View {
    let session: RadioProgram
    let items: [RadioPlaylistItem]
    let loop: LoopMode
    let tracks: [RadioTrack]
    /// icy `now_playing` for THIS session (non-nil only while it is the live program).
    let nowPlaying: String?
    /// Playlist item the local AVQueuePlayer preview is on (non-nil only for the
    /// previewing session).
    let previewItemId: String?
    /// Lane preview (nil = full list): render at most this many playlist rows —
    /// the full-height list lives in the View console — followed by a fixed
    /// "+N more tracks" line so the card height stays stable while tracks change.
    /// `onView` opens the full session-console sheet (both platforms).
    var previewLimit: Int? = nil
    var onView: (() -> Void)? = nil
    let onSetLoop: (LoopMode) -> Void
    let onPlay: () -> Void
    let onDeleteSession: () -> Void
    let onMove: (Int, Int) -> Void
    /// Drag-to-reorder drop: (from, to) — persists via the same store path as
    /// the arrow moves.
    let onReorder: (Int, Int) -> Void
    let onRemove: (String) -> Void
    let onAddTrack: (String) -> Void

    /// Themed Add-track picker (replaces the old bare `Menu`, which rendered as
    /// a giant unthemed native dropdown on Catalyst).
    @State private var showAddTrack = false
    /// Drag-to-reorder state (id being dragged + insertion index shown gold).
    @State private var draggingId: String?
    @State private var dropIndex: Int?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Header row: name / count / loop / play / delete
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(session.title.isEmpty ? "Untitled" : session.title)
                        .font(.inter(13.5, .bold)).foregroundStyle(Rs.text).lineLimit(1)
                    Text("\(items.count) item\(items.count == 1 ? "" : "s")").font(.inter(10.5)).foregroundStyle(Rs.dim)
                }
                Spacer(minLength: 6)

                // Open the full session console (sheet on iPad, centered modal on Mac).
                if let onView {
                    ViewChipButton(action: onView)
                }

                // Loop control (Off / Loop all / Repeat one)
                LoopMenuChip(loop: loop, onSetLoop: onSetLoop)

                Button(action: onPlay) {
                    HStack(spacing: 5) {
                        Image(systemName: "play.fill").font(.system(size: 10, weight: .bold))
                        Text("Play live").font(.inter(11, .bold))
                    }
                    .foregroundStyle(Color(hex: 0x0A1120))
                    .padding(.horizontal, 12).frame(height: 30)
                    .background(Rs.goldFill).clipShape(Capsule())
                }.pressable().hoverEffect(.highlight).disabled(items.isEmpty)

                Button(action: onDeleteSession) {
                    Image(systemName: "xmark").font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Rs.red).frame(width: 30, height: 30)
                        .background(Rs.red.opacity(0.12)).clipShape(Circle())
                }.pressable().hoverEffect(.highlight)
            }

            // Numbered playlist
            if items.isEmpty {
                Text("No tracks yet — add one below.").font(.inter(11)).foregroundStyle(Rs.dim)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 6)
            } else {
                // Mac lane preview caps the rows (full list lives in the View
                // sheet); indices/handlers are the FULL-list ones, so reorder and
                // remove on the visible rows behave exactly like the full console.
                let visible = previewLimit.map { Array(items.prefix($0)) } ?? items
                VStack(spacing: 6) {
                    ForEach(Array(visible.enumerated()), id: \.element.id) { idx, item in
                        PlaylistItemRow(
                            index: idx,
                            item: item,
                            dotColor: dotColor(item.track.kind),
                            isOnAir: item.id == onAirItemId,
                            isPreviewing: item.id == previewItemId,
                            isFirst: idx == 0,
                            isLast: idx == items.count - 1,
                            onMoveUp: { onMove(idx, -1) },
                            onMoveDown: { onMove(idx, 1) },
                            onRemove: { onRemove(item.id) }
                        )
                        // Rows drag to reorder (indices are the FULL-list ones,
                        // so a capped lane preview still reorders correctly).
                        .playlistDraggable(
                            itemId: item.id, index: idx,
                            draggingId: $draggingId, dropIndex: $dropIndex,
                            indexOf: { id in items.firstIndex { $0.id == id } },
                            onReorder: onReorder)
                    }
                    if let cap = previewLimit, items.count > cap {
                        MoreTracksLine(count: items.count - cap)
                    }
                }
            }

            // Footer: + Add track — opens the themed library picker.
            if tracks.isEmpty {
                Text("Upload library tracks to add them here.").font(.inter(10.5)).foregroundStyle(Rs.faint)
            } else {
                Button { showAddTrack = true } label: {
                    HStack(spacing: 5) {
                        Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                        Text("Add track…").font(.inter(11.5, .semibold))
                    }
                    .foregroundStyle(Rs.gold)
                    .padding(.horizontal, 12).frame(height: 32)
                    .background(Rs.gold.opacity(0.10)).clipShape(Capsule())
                    .overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
                }.pressable().hoverEffect(.highlight)
            }
        }
        .padding(14)
        .background(Color.white.opacity(0.025)).clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Rs.border, lineWidth: 1))
        .studioModal(isPresented: $showAddTrack, maxWidth: 560, maxHeight: 680) {
            AddTrackPicker(tracks: tracks, items: items, onAdd: onAddTrack)
        }
    }

    private func dotColor(_ kind: String) -> Color {
        (TrackKind(rawValue: kind) ?? .audio).color
    }

    private var onAirItemId: String? { airingItemId(in: items, nowPlaying: nowPlaying) }
}

/// First playlist item whose track matches the icy `now_playing` string —
/// case-insensitive containment either direction on the title, falling back to
/// the audio-url basename sans extension. No match → nil (no highlight).
/// Shared by the lane SessionCard and the full SessionConsoleSheet.
private func airingItemId(in items: [RadioPlaylistItem], nowPlaying: String?) -> String? {
    guard let raw = nowPlaying?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
          !raw.isEmpty else { return nil }
    return items.first { trackMatchesNowPlaying($0.track, raw) }?.id
}
private func trackMatchesNowPlaying(_ track: RadioTrack, _ np: String) -> Bool {
    let title = track.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if !title.isEmpty, title.contains(np) || np.contains(title) { return true }
    // Fallback: liquidsoap often reports the source filename.
    if let last = URL(string: track.audioUrl)?.lastPathComponent {
        let base = ((last.removingPercentEncoding ?? last) as NSString)
            .deletingPathExtension
            .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !base.isEmpty, base.contains(np) || np.contains(base) { return true }
    }
    return false
}

/// Loop chip (Menu selecting Off / Loop all / Repeat one) — shared by the lane
/// SessionCard header and the session console's controls strip.
private struct LoopMenuChip: View {
    let loop: LoopMode
    let onSetLoop: (LoopMode) -> Void
    var body: some View {
        Menu {
            ForEach(LoopMode.allCases, id: \.rawValue) { mode in
                Button {
                    onSetLoop(mode)
                } label: {
                    Label(mode.label, systemImage: mode == loop ? "checkmark" : mode.icon)
                }
            }
        } label: {
            HStack(spacing: 5) {
                Image(systemName: loop.icon).font(.system(size: 11, weight: .semibold))
                Text(loop.label).font(.inter(11, .semibold))
            }
            .foregroundStyle(loop == .none ? Rs.dim : Rs.gold)
            .padding(.horizontal, 10).frame(height: 30)
            .background((loop == .none ? Rs.faint : Rs.gold).opacity(0.12)).clipShape(Capsule())
            .overlay(Capsule().stroke((loop == .none ? Rs.faint : Rs.gold).opacity(0.3), lineWidth: 1))
        }
    }
}

/// One numbered playlist row: kind dot, title, ON AIR / PREVIEW badge, mono
/// duration, reorder + remove controls. The ON AIR dot pulses gold (gated on
/// Reduce Motion); PREVIEW is a static green tag so the two states read apart.
private struct PlaylistItemRow: View {
    let index: Int
    let item: RadioPlaylistItem
    let dotColor: Color
    let isOnAir: Bool
    let isPreviewing: Bool
    let isFirst: Bool
    let isLast: Bool
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        HStack(spacing: 9) {
            Text("\(index + 1)").font(Rs.mono(11, .bold)).foregroundStyle(Rs.dim).frame(width: 18, alignment: .trailing)
            if isOnAir {
                Circle().fill(Rs.gold).frame(width: 8, height: 8)
                    .opacity(!reduceMotion && pulse ? 0.3 : 1)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
                    .onAppear { pulse = true }
                    .onDisappear { pulse = false }
            } else {
                Circle().fill(dotColor).frame(width: 8, height: 8)
            }
            Text(item.track.title.isEmpty ? "Untitled" : item.track.title)
                .font(isOnAir ? .inter(12, .semibold) : .inter(12))
                .foregroundStyle(isOnAir ? Rs.gold : Rs.text).lineLimit(1)
            if isOnAir {
                microTag("ON AIR", Rs.gold)
            } else if isPreviewing {
                microTag("PREVIEW", Rs.green)
            }
            Spacer(minLength: 6)
            Text(fmtDuration(item.track.durationSec) ?? "—")
                .font(Rs.mono(10.5)).foregroundStyle(Rs.dim).fixedSize()
            Button(action: onMoveUp) {
                Image(systemName: "chevron.up").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isFirst ? Rs.faint : Rs.dim).frame(width: 26, height: 26)
            }.pressable().hoverEffect(.highlight).disabled(isFirst)
            Button(action: onMoveDown) {
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(isLast ? Rs.faint : Rs.dim).frame(width: 26, height: 26)
            }.pressable().hoverEffect(.highlight).disabled(isLast)
            Button(action: onRemove) {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Rs.dim).frame(width: 26, height: 26)
            }.pressable().hoverEffect(.highlight)
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .background(isOnAir ? Rs.gold.opacity(0.08) : Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous)
            .stroke(isOnAir ? Rs.gold.opacity(0.35) : Color.clear, lineWidth: 1))
    }

    private func microTag(_ label: String, _ color: Color) -> some View {
        Text(label).font(.inter(8, .bold)).tracking(0.7).foregroundStyle(color)
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(color.opacity(0.16)).clipShape(Capsule())
    }
}

// MARK: - Playlist drag-to-reorder (lane card + session console)
//
// Playlist rows are draggable — `.onDrag` + a per-row DropDelegate, which works
// with the mouse on Catalyst and long-press-drag on iPad. While a drag hovers a
// row, a gold insertion line marks the drop position; the drop calls
// `onReorder(from, to)` → the SAME store persist path the ↑/↓ arrows use (PUT
// the full id order; the server echo reconciles). The arrows stay for
// accessibility. The LIBRARY list is deliberately NOT draggable — it has no
// server-side order to persist. Only the session playlists reorder.

private struct PlaylistRowDrag: ViewModifier {
    let itemId: String
    let index: Int
    /// Vertical offset for the insertion line (sits in the row gap on the lane
    /// card; hugs the divider in the console's zero-spacing list).
    var indicatorOffset: CGFloat = -4
    @Binding var draggingId: String?
    @Binding var dropIndex: Int?
    let indexOf: (String) -> Int?
    let onReorder: (Int, Int) -> Void

    func body(content: Content) -> some View {
        content
            .opacity(draggingId == itemId ? 0.35 : 1)
            .overlay(alignment: .top) {
                if dropIndex == index, let d = draggingId, d != itemId {
                    RoundedRectangle(cornerRadius: 1.5).fill(Rs.goldFill)
                        .frame(height: 2.5)
                        .padding(.horizontal, 4)
                        .offset(y: indicatorOffset)
                        .allowsHitTesting(false)
                }
            }
            .onDrag {
                draggingId = itemId
                return NSItemProvider(object: itemId as NSString)
            }
            .onDrop(of: [UTType.text], delegate: PlaylistReorderDropDelegate(
                itemId: itemId, index: index,
                draggingId: $draggingId, dropIndex: $dropIndex,
                indexOf: indexOf, onReorder: onReorder))
    }
}

private struct PlaylistReorderDropDelegate: DropDelegate {
    let itemId: String
    let index: Int
    @Binding var draggingId: String?
    @Binding var dropIndex: Int?
    let indexOf: (String) -> Int?
    let onReorder: (Int, Int) -> Void

    func validateDrop(info: DropInfo) -> Bool { draggingId != nil }
    func dropEntered(info: DropInfo) {
        guard let d = draggingId, d != itemId else { return }
        dropIndex = index
    }
    func dropExited(info: DropInfo) {
        if dropIndex == index { dropIndex = nil }
    }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool {
        defer { draggingId = nil; dropIndex = nil }
        guard let d = draggingId, d != itemId, let from = indexOf(d) else { return false }
        if from != index { onReorder(from, index) }
        return true
    }
}

private extension View {
    /// Wire a playlist row for drag-to-reorder (see PlaylistRowDrag).
    func playlistDraggable(
        itemId: String, index: Int, indicatorOffset: CGFloat = -4,
        draggingId: Binding<String?>, dropIndex: Binding<Int?>,
        indexOf: @escaping (String) -> Int?, onReorder: @escaping (Int, Int) -> Void
    ) -> some View {
        modifier(PlaylistRowDrag(itemId: itemId, index: index, indicatorOffset: indicatorOffset,
                                 draggingId: draggingId, dropIndex: dropIndex,
                                 indexOf: indexOf, onReorder: onReorder))
    }
}

// MARK: - Full-console sheets + centered Mac presentation
//
// The lanes keep the page scannable: session cards and the audio library render
// a stable 5-row preview + "+N more tracks", and the gold View chip opens the
// FULL console. On iPhone/iPad these present as native page sheets; Catalyst
// pins form sheets high in the window, so on the Mac `studioModal` presents a
// full-window cover instead — dimmed backdrop, Rs panel CENTERED, click outside
// (or Esc via the Done buttons) to dismiss. Every sheet is pure composition
// over the shared store, so an edit made in a sheet repaints the lane preview
// instantly.

/// Panel chrome for the Mac's centered studio modal — dim scrim, centered
/// rounded Rs panel capped at `maxWidth`/`maxHeight` (shrinks on small windows).
private struct StudioModalChrome<C: View>: View {
    let maxWidth: CGFloat
    let maxHeight: CGFloat
    let onDismiss: () -> Void
    @ViewBuilder var content: C

    var body: some View {
        ZStack {
            Color.black.opacity(0.55).ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)
            content
                .frame(maxWidth: maxWidth, maxHeight: maxHeight)
                .background(Rs.bg)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Rs.borderHi, lineWidth: 1))
                .shadow(color: .black.opacity(0.55), radius: 44, y: 18)
                .padding(28)
        }
        .presentationBackground(.clear)
    }
}

fileprivate extension View {
    /// Item-driven studio modal — Mac: centered cover · iPhone/iPad: native sheet.
    @ViewBuilder func studioModal<Item: Identifiable, C: View>(
        item: Binding<Item?>,
        maxWidth: CGFloat = 1000, maxHeight: CGFloat = 1040,
        @ViewBuilder content: @escaping (Item) -> C
    ) -> some View {
        if MacDesign.isMac {
            fullScreenCover(item: item) { it in
                StudioModalChrome(maxWidth: maxWidth, maxHeight: maxHeight,
                                  onDismiss: { item.wrappedValue = nil }) { content(it) }
            }
        } else {
            sheet(item: item, content: content)
        }
    }

    /// Bool-driven studio modal — Mac: centered cover · iPhone/iPad: native sheet.
    @ViewBuilder func studioModal<C: View>(
        isPresented: Binding<Bool>,
        maxWidth: CGFloat = 1000, maxHeight: CGFloat = 1040,
        @ViewBuilder content: @escaping () -> C
    ) -> some View {
        if MacDesign.isMac {
            fullScreenCover(isPresented: isPresented) {
                StudioModalChrome(maxWidth: maxWidth, maxHeight: maxHeight,
                                  onDismiss: { isPresented.wrappedValue = false }) { content() }
            }
        } else {
            sheet(isPresented: isPresented, content: content)
        }
    }
}

/// Gold Done capsule shared by the studio sheets — Esc (cancel action) also fires it.
private struct SheetDoneButton: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        Button { dismiss() } label: {
            Text("Done").font(.inter(12, .bold))
                .foregroundStyle(Color(hex: 0x0A1120))
                .padding(.horizontal, 16).frame(height: 32)
                .background(Rs.goldFill).clipShape(Capsule())
        }.pressable().hoverEffect(.highlight)
        .keyboardShortcut(.cancelAction)
    }
}

/// Rows a lane preview card shows before deferring to its View sheet.
private let macLanePreviewCap = 5

/// The gold "View" chip (session-card header + library header) — styled like the
/// studio's other gold chips (Edit / Attach audio).
private struct ViewChipButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 10, weight: .bold))
                Text("View").font(.inter(11, .bold))
            }
            .foregroundStyle(Rs.gold)
            .padding(.horizontal, 12).frame(height: 30)
            .background(Rs.gold.opacity(0.12)).clipShape(Capsule())
            .overlay(Capsule().stroke(Rs.gold.opacity(0.35), lineWidth: 1))
        }.pressable().hoverEffect(.highlight)
    }
}

/// Fixed-height "+N more tracks" line — constant height so the preview cards
/// never jump as the list grows/shrinks past the cap.
private struct MoreTracksLine: View {
    let count: Int
    var body: some View {
        Text("+\(count) more track\(count == 1 ? "" : "s")")
            .font(.inter(11, .semibold)).foregroundStyle(Rs.gold)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 22)
    }
}

/// `.sheet(item:)` payload for the session console (String isn't Identifiable).
private struct SessionSheetTarget: Identifiable { let id: String }

/// Full session console — a purpose-built layout (not the lane card): generous
/// header (title · count · total duration · ON AIR state · Done), a controls
/// strip (loop · Play live · preview stop · delete session), the FULL
/// zebra-striped reorderable track list, and an Add-track footer that opens the
/// themed library picker. Everything flows through the same store handlers the
/// lane preview uses, so edits repaint the lane instantly.
private struct SessionConsoleSheet: View {
    @ObservedObject var store: AudioLibraryStore
    let sessionId: String
    var liveProgramId: String? = nil
    var nowPlaying: String? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var showAddTrack = false
    /// Drag-to-reorder state for the full track list.
    @State private var draggingId: String?
    @State private var dropIndex: Int?

    private var session: RadioProgram? { store.sessions.first { $0.id == sessionId } }
    private var items: [RadioPlaylistItem] { store.playlists[sessionId] ?? [] }
    private var isLive: Bool { sessionId == liveProgramId }
    private var loop: LoopMode { store.loopMode(for: sessionId) }
    private var airingId: String? { isLive ? airingItemId(in: items, nowPlaying: nowPlaying) : nil }
    private var previewItemId: String? { store.previewSessionId == sessionId ? store.previewItemId : nil }
    private var title: String {
        let t = session?.title ?? ""
        return t.isEmpty ? "Untitled session" : t
    }

    var body: some View {
        VStack(spacing: 0) {
            if session != nil {
                header
                controlsStrip
                Rectangle().fill(Rs.border).frame(height: 1)
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if items.isEmpty { emptyList } else { trackList }
                        if let e = store.error {
                            Text(e).font(.inter(11)).foregroundStyle(Rs.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(20)
                }
                Rectangle().fill(Rs.border).frame(height: 1)
                footer
            } else {
                // Deleted elsewhere (auto-refresh) while the sheet was open.
                VStack(spacing: 12) {
                    Image(systemName: "square.stack.3d.down.right").font(.system(size: 26)).foregroundStyle(Rs.faint)
                    Text("This session no longer exists.")
                        .font(.inter(12.5)).foregroundStyle(Rs.dim)
                    SheetDoneButton()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Rs.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .studioModal(isPresented: $showAddTrack, maxWidth: 560, maxHeight: 680) {
            AddTrackPicker(tracks: store.tracks, items: items) { store.addTrack($0, to: sessionId) }
        }
    }

    // MARK: header

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 5) {
                Text("SESSION CONSOLE").font(.inter(10, .bold)).tracking(1.6).foregroundStyle(Rs.gold)
                Text(title).font(Rs.serif(26)).foregroundStyle(Rs.text).lineLimit(1)
                HStack(spacing: 7) {
                    Text("\(items.count) track\(items.count == 1 ? "" : "s")")
                        .font(.inter(11.5, .medium)).foregroundStyle(Rs.dim)
                    if let total = fmtDuration(items.compactMap { $0.track.durationSec }.reduce(0, +)) {
                        Text("·").font(.inter(11)).foregroundStyle(Rs.faint)
                        Text("\(total) total").font(Rs.mono(11.5)).foregroundStyle(Rs.dim)
                    }
                }
            }
            Spacer(minLength: 12)
            liveChip
            SheetDoneButton()
        }
        .padding(.horizontal, 22).padding(.top, 20).padding(.bottom, 16)
    }

    @ViewBuilder private var liveChip: some View {
        if isLive {
            HStack(spacing: 6) {
                Circle().fill(Rs.red).frame(width: 7, height: 7)
                Text("ON AIR").font(.inter(10.5, .bold)).tracking(1.0).foregroundStyle(Rs.text)
            }
            .padding(.horizontal, 10).frame(height: 26).background(Rs.red.opacity(0.18)).clipShape(Capsule())
            .overlay(Capsule().stroke(Rs.red.opacity(0.5), lineWidth: 1))
        } else {
            Text("OFF AIR").font(.inter(10.5, .bold)).tracking(1.0).foregroundStyle(Rs.faint)
                .padding(.horizontal, 10).frame(height: 26).background(Rs.faint.opacity(0.14)).clipShape(Capsule())
        }
    }

    // MARK: controls strip (loop · play live · preview · delete)

    private var controlsStrip: some View {
        HStack(spacing: 10) {
            LoopMenuChip(loop: loop, onSetLoop: { store.setLoop(sessionId, $0) })

            Button { store.playLive(sessionId) } label: {
                HStack(spacing: 5) {
                    Image(systemName: "play.fill").font(.system(size: 10, weight: .bold))
                    Text("Play live").font(.inter(11, .bold))
                }
                .foregroundStyle(Color(hex: 0x0A1120))
                .padding(.horizontal, 14).frame(height: 30)
                .background(Rs.goldFill).clipShape(Capsule())
            }.pressable().hoverEffect(.highlight).disabled(items.isEmpty)

            if store.previewSessionId == sessionId, let t = store.previewTitle {
                HStack(spacing: 7) {
                    Image(systemName: "waveform").font(.system(size: 11)).foregroundStyle(Rs.gold)
                    Text("Previewing: \(t)").font(.inter(11, .semibold)).foregroundStyle(Rs.gold).lineLimit(1)
                    Button { store.stopPreview() } label: {
                        Text("Stop").font(.inter(11, .semibold)).foregroundStyle(Rs.dim)
                    }.pressable().hoverEffect(.highlight)
                }
                .padding(.horizontal, 11).frame(height: 30)
                .background(Rs.gold.opacity(0.10)).clipShape(Capsule())
                .overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
            }

            Spacer(minLength: 8)

            Button { store.deleteSession(sessionId); dismiss() } label: {
                HStack(spacing: 5) {
                    Image(systemName: "trash").font(.system(size: 10, weight: .bold))
                    Text("Delete session").font(.inter(11, .semibold))
                }
                .foregroundStyle(Rs.red)
                .padding(.horizontal, 12).frame(height: 30)
                .background(Rs.red.opacity(0.12)).clipShape(Capsule())
                .overlay(Capsule().stroke(Rs.red.opacity(0.3), lineWidth: 1))
            }.pressable().hoverEffect(.highlight)
        }
        .padding(.horizontal, 22).padding(.bottom, 16)
    }

    // MARK: track list (zebra rows in one bordered container)

    private var trackList: some View {
        VStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.element.id) { idx, item in
                ConsoleTrackRow(
                    index: idx,
                    item: item,
                    isOnAir: item.id == airingId,
                    isPreviewing: item.id == previewItemId,
                    isFirst: idx == 0,
                    isLast: idx == items.count - 1,
                    onMoveUp: { store.move(sessionId, index: idx, by: -1) },
                    onMoveDown: { store.move(sessionId, index: idx, by: 1) },
                    onRemove: { store.removeItem(item.id, from: sessionId) }
                )
                // Drag anywhere on the row to reorder — same persist path as
                // the arrows. Zero-spacing list, so the insertion line hugs
                // the divider (offset -1).
                .playlistDraggable(
                    itemId: item.id, index: idx, indicatorOffset: -1,
                    draggingId: $draggingId, dropIndex: $dropIndex,
                    indexOf: { id in items.firstIndex { $0.id == id } },
                    onReorder: { from, to in store.move(sessionId, from: from, to: to) })
                if idx < items.count - 1 {
                    Rectangle().fill(Rs.border.opacity(0.7)).frame(height: 1)
                }
            }
        }
        .background(Color.white.opacity(0.02))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }

    private var emptyList: some View {
        VStack(spacing: 8) {
            Image(systemName: "music.note.list").font(.system(size: 26)).foregroundStyle(Rs.faint)
            Text("No tracks yet").font(.inter(13, .semibold)).foregroundStyle(Rs.text)
            Text("Add tracks from the library with the button below.")
                .font(.inter(11.5)).foregroundStyle(Rs.dim)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 44)
    }

    // MARK: footer (Add track)

    private var footer: some View {
        HStack(spacing: 12) {
            Button { showAddTrack = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                    Text("Add track").font(.inter(12, .bold))
                }
                .foregroundStyle(Color(hex: 0x0A1120))
                .padding(.horizontal, 16).frame(height: 36)
                .background(Rs.goldFill).clipShape(Capsule())
            }.pressable().hoverEffect(.highlight).disabled(store.tracks.isEmpty)
            Text(store.tracks.isEmpty
                 ? "Upload library tracks first — the picker is empty."
                 : "Appends to the end of the playlist — drag rows (or use the arrows) to reorder.")
                .font(.inter(11)).foregroundStyle(Rs.faint)
                .lineLimit(1).minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 22).padding(.vertical, 14)
    }
}

/// One full-console playlist row — roomier than the lane's PlaylistItemRow:
/// number chip (gold while airing), title + kind badge, ON AIR / PREVIEW state,
/// mono duration and comfortable 32pt reorder/remove targets. Zebra-striped by
/// row index; the airing row overrides the stripe with a gold wash.
private struct ConsoleTrackRow: View {
    let index: Int
    let item: RadioPlaylistItem
    let isOnAir: Bool
    let isPreviewing: Bool
    let isFirst: Bool
    let isLast: Bool
    let onMoveUp: () -> Void
    let onMoveDown: () -> Void
    let onRemove: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    private var kind: TrackKind { TrackKind(rawValue: item.track.kind) ?? .audio }

    var body: some View {
        HStack(spacing: 12) {
            Text("\(index + 1)")
                .font(Rs.mono(11.5, .bold))
                .foregroundStyle(isOnAir ? Color(hex: 0x0A1120) : Rs.dim)
                .frame(width: 28, height: 28)
                .background(isOnAir ? AnyShapeStyle(Rs.goldFill) : AnyShapeStyle(Color.white.opacity(0.05)))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 7) {
                    Text(item.track.title.isEmpty ? "Untitled" : item.track.title)
                        .font(.inter(13, isOnAir ? .bold : .semibold))
                        .foregroundStyle(isOnAir ? Rs.gold : Rs.text).lineLimit(1)
                    if isOnAir {
                        HStack(spacing: 4) {
                            Circle().fill(Rs.gold).frame(width: 6, height: 6)
                                .opacity(!reduceMotion && pulse ? 0.3 : 1)
                                .animation(reduceMotion ? nil : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
                                .onAppear { pulse = true }
                                .onDisappear { pulse = false }
                            Text("ON AIR").font(.inter(8.5, .bold)).tracking(0.7).foregroundStyle(Rs.gold)
                        }
                        .padding(.horizontal, 7).padding(.vertical, 2.5)
                        .background(Rs.gold.opacity(0.16)).clipShape(Capsule())
                    } else if isPreviewing {
                        Text("PREVIEW").font(.inter(8.5, .bold)).tracking(0.7).foregroundStyle(Rs.green)
                            .padding(.horizontal, 7).padding(.vertical, 2.5)
                            .background(Rs.green.opacity(0.16)).clipShape(Capsule())
                    }
                }
                Text(kind.label.uppercased()).font(.inter(8.5, .bold)).tracking(0.5)
                    .foregroundStyle(kind.color)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(kind.color.opacity(0.16)).clipShape(Capsule())
            }

            Spacer(minLength: 8)

            Text(fmtDuration(item.track.durationSec) ?? "—")
                .font(Rs.mono(11.5)).foregroundStyle(Rs.dim).fixedSize()

            HStack(spacing: 4) {
                controlButton("chevron.up", disabled: isFirst, action: onMoveUp)
                controlButton("chevron.down", disabled: isLast, action: onMoveDown)
                controlButton("xmark", tint: Rs.red, action: onRemove)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(rowBackground)
    }

    private var rowBackground: Color {
        if isOnAir { return Rs.gold.opacity(0.08) }
        return index.isMultiple(of: 2) ? Color.white.opacity(0.028) : Color.clear
    }

    private func controlButton(_ icon: String, disabled: Bool = false, tint: Color = Rs.dim, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 11, weight: .bold))
                .foregroundStyle(disabled ? Rs.faint : tint)
                .frame(width: 32, height: 32)
                .background(Color.white.opacity(0.04))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Rs.border, lineWidth: 1))
        }.pressable().hoverEffect(.highlight).disabled(disabled)
    }
}

/// Themed library picker for building a playlist — replaces the old bare `Menu`
/// (which rendered as a giant unthemed native dropdown on Catalyst listing the
/// entire library). Dark Rs panel: search at the top, scrollable themed rows
/// (kind badge · title · duration) each with a gold + that appends via the
/// store handler and KEEPS the panel open for multi-add; Done closes. A ×N chip
/// shows how many times a track already sits in this playlist.
private struct AddTrackPicker: View {
    let tracks: [RadioTrack]
    let items: [RadioPlaylistItem]
    let onAdd: (String) -> Void
    @State private var query = ""

    private var filtered: [RadioTrack] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return tracks }
        return tracks.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }
    private func timesInPlaylist(_ trackId: String) -> Int {
        items.reduce(0) { $0 + ($1.track.id == trackId ? 1 : 0) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("ADD TRACKS").font(.inter(10, .bold)).tracking(1.6).foregroundStyle(Rs.gold)
                    Text("From the library").font(Rs.serif(22)).foregroundStyle(Rs.text)
                    Text("Tap + to append — the panel stays open so you can add several.")
                        .font(.inter(11)).foregroundStyle(Rs.dim)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 12)
                SheetDoneButton()
            }
            .padding(.horizontal, 20).padding(.top, 18).padding(.bottom, 14)

            searchField
                .padding(.horizontal, 20).padding(.bottom, 14)

            Rectangle().fill(Rs.border).frame(height: 1)

            ScrollView {
                LazyVStack(spacing: 6) {
                    if filtered.isEmpty {
                        Text(tracks.isEmpty
                             ? "No library tracks yet — upload in Uploads & Sessions."
                             : "No tracks match “\(query)”.")
                            .font(.inter(11.5)).foregroundStyle(Rs.dim)
                            .frame(maxWidth: .infinity).padding(.vertical, 28)
                    } else {
                        ForEach(filtered) { t in pickerRow(t) }
                    }
                }
                .padding(14)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Rs.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .semibold)).foregroundStyle(Rs.dim)
            TextField("", text: $query, prompt: Text("Search tracks…").foregroundColor(Rs.faint))
                .font(.inter(12.5)).foregroundStyle(Rs.text)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
            if !query.isEmpty {
                Button { query = "" } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(Rs.faint)
                }.pressable().hoverEffect(.highlight)
            }
        }
        .padding(.horizontal, 12).frame(height: 38)
        .background(Color.white.opacity(0.04))
        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }

    private func pickerRow(_ t: RadioTrack) -> some View {
        let kind = TrackKind(rawValue: t.kind) ?? .audio
        let n = timesInPlaylist(t.id)
        return HStack(spacing: 11) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(kind.color.opacity(0.16))
                Image(systemName: "music.note").font(.system(size: 13, weight: .semibold)).foregroundStyle(kind.color)
            }.frame(width: 34, height: 34)

            VStack(alignment: .leading, spacing: 3) {
                Text(t.title.isEmpty ? "Untitled" : t.title)
                    .font(.inter(12.5, .semibold)).foregroundStyle(Rs.text).lineLimit(1)
                HStack(spacing: 8) {
                    Text(kind.label.uppercased()).font(.inter(8.5, .bold)).tracking(0.5)
                        .foregroundStyle(kind.color)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(kind.color.opacity(0.16)).clipShape(Capsule())
                    if let d = fmtDuration(t.durationSec) {
                        Text(d).font(Rs.mono(10)).foregroundStyle(Rs.dim)
                    }
                }
            }

            Spacer(minLength: 8)

            if n > 0 {
                Text("×\(n)").font(Rs.mono(10.5, .semibold)).foregroundStyle(Rs.gold)
                    .padding(.horizontal, 7).padding(.vertical, 3)
                    .background(Rs.gold.opacity(0.14)).clipShape(Capsule())
            }

            Button { onAdd(t.id) } label: {
                ZStack {
                    Circle().fill(Rs.goldFill)
                    Image(systemName: "plus").font(.system(size: 13, weight: .bold)).foregroundStyle(Color(hex: 0x0A1120))
                }.frame(width: 30, height: 30)
            }.pressable().hoverEffect(.highlight)
            .accessibilityLabel("Add \(t.title.isEmpty ? "untitled track" : t.title)")
        }
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(Color.white.opacity(0.03))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }
}

/// Full audio library console — generous header (eyebrow · title · count · Done),
/// a clean controls row (kind picker + upload), then the complete zebra-striped
/// track list with the per-row actions (+ Session, delete), reusing
/// KindSegmented / UploadMusicButton / TrackRow over the shared store.
private struct AudioLibrarySheet: View {
    @ObservedObject var store: AudioLibraryStore
    @State private var showImporter = false

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("AUDIO LIBRARY").font(.inter(10, .bold)).tracking(1.6).foregroundStyle(Rs.green)
                    Text("All tracks").font(Rs.serif(26)).foregroundStyle(Rs.text)
                    Text("\(store.tracks.count) track\(store.tracks.count == 1 ? "" : "s") · \(store.kind.label)")
                        .font(.inter(11.5)).foregroundStyle(Rs.dim)
                }
                Spacer(minLength: 12)
                SheetDoneButton()
            }
            .padding(.horizontal, 22).padding(.top, 20).padding(.bottom, 14)

            // Controls row: kind picker + upload.
            HStack(spacing: 10) {
                KindSegmented(selection: store.kind) { store.selectKind($0) }
                Spacer(minLength: 8)
                UploadMusicButton(uploading: store.uploading) { showImporter = true }
            }
            .padding(.horizontal, 22).padding(.bottom, 16)

            Rectangle().fill(Rs.border).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    // In-flight uploads (same queue the lane card shows).
                    UploadQueueList(store: store)
                    if store.tracks.isEmpty {
                        LibraryEmptyState(kind: store.kind)
                    } else {
                        LibrarySelectionBar(store: store)
                        ForEach(Array(store.tracks.enumerated()), id: \.element.id) { idx, t in
                            TrackRow(track: t, sessions: store.sessions,
                                     zebraIndex: idx,
                                     isSelected: store.selectedTrackIds.contains(t.id),
                                     onToggleSelect: { store.toggleSelect(t.id) },
                                     onAddToSession: { store.addTrack(t.id, to: $0) },
                                     onDelete: { store.deleteTrack(t.id) })
                        }
                    }
                    if let e = store.error {
                        Text(e).font(.inter(11)).foregroundStyle(Rs.red).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(18)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Rs.bg.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .fileImporter(isPresented: $showImporter,
                      allowedContentTypes: AudioUploadRules.allowedContentTypes,
                      allowsMultipleSelection: true) { result in
            if case .success(let urls) = result { store.enqueueUploads(urls) }
            else if case .failure(let err) = result { store.error = err.localizedDescription }
        }
    }
}

// MARK: - ISO parse helper (shared)

func parseISO(_ s: String) -> Date? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    let g = ISO8601DateFormatter(); return g.date(from: s)
}
