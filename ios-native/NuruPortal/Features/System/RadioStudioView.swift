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
// CLIENT-ONLY hardware/telemetry (never leaves the device): audio-source select,
// L/R meters, waveform, reaction tallies, countdown — all Timer-driven simulations
// with STABLE layouts (fixed frames, no `.frame(maxHeight:.infinity)` in the ticking
// subtrees) so the meters animate without the LazyVGrid flicker pattern.
import SwiftUI
import Charts

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

    // Serif titles / mono numerics (contract asks DM Serif / DM Mono; we use the
    // bundled Fraunces serif + a monospaced-digit system face to stay on-brand).
    static func serif(_ s: CGFloat, _ w: Font.Weight = .semibold) -> Font { .fraunces(s, w) }
    static func mono(_ s: CGFloat, _ w: Font.Weight = .medium) -> Font { .system(size: s, weight: w, design: .monospaced) }
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
    @Published var actionError: String?
    @Published var busy = false

    // Client-only reaction tallies (member reactions arrive via the member API; the
    // admin console shows local applause it accumulates while live).
    @Published var hearts = 0
    @Published var amens = 0
    @Published var fires = 0

    private var pollTask: Task<Void, Never>?
    private var countdownTask: Task<Void, Never>?

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
        health = nil; comments = []; hearts = 0; amens = 0; fires = 0
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

    // Poll health every ~3s + refresh comments while live.
    private func startLiveWork(_ id: String) {
        stopPolling()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                if let h = try? await PortalAPI.radioHealth(id) { await MainActor.run { self?.health = h } }
                if let c = try? await PortalAPI.radioComments(id) { await MainActor.run { self?.comments = c } }
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

    func teardown() { stopPolling(); countdownTask?.cancel() }
}

// MARK: - ===================== RadioStudioView =====================

struct RadioStudioView: View {
    @StateObject private var m = RadioModel()
    @State private var showCreate = false

    // Client-only console state (hardware bits — never server-originated).
    @State private var source = "Main mic"
    @State private var micGain: Double = 72

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let error = m.error, m.programs.isEmpty {
                    DarkError(message: error) { Task { await m.load() } }
                } else if !m.loaded {
                    DarkSkeleton()
                } else {
                    body(program: m.selected)
                }
            }
            .padding(18)
            .padding(.bottom, 48)
        }
        .background(Rs.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { if !m.loaded { await m.load() } }
        .onDisappear { m.teardown() }
        .sheet(isPresented: $showCreate) { RadioProgramForm { Task { await m.load() } } }
        .alert("Something went wrong", isPresented: Binding(get: { m.actionError != nil }, set: { if !$0 { m.actionError = nil } })) {
            Button("OK", role: .cancel) { m.actionError = nil }
        } message: { Text(m.actionError ?? "") }
    }

    // MARK: Header (dark studio hero)

    private var header: some View {
        StudioPanel(padding: 20, glow: m.broadcast.isLiveOrPaused) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("OPERATIONS").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.dim)
                    Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(Rs.faint)
                    Text("Radio Studio").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.text)
                    Spacer(minLength: 8)
                    liveBadge
                }
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("LIVE BROADCAST CONSOLE").font(.inter(10.5, .bold)).tracking(1.8).foregroundStyle(Rs.gold)
                        Text("Radio Studio").font(Rs.serif(30)).foregroundStyle(Rs.text)
                        Text("Provision a program, cue the audio source, and take it live to the congregation.")
                            .font(.inter(13)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    Button { showCreate = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "plus").font(.system(size: 11, weight: .bold))
                            Text("New program").font(.inter(12, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 14).frame(height: 34)
                        .background(Rs.goldFill).clipShape(Capsule())
                    }.buttonStyle(.plain)
                }
            }
        }
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

        if let p = program {
            // LIVE status bar (only while live/paused) — duration/listeners/bitrate/health.
            if m.broadcast.isLiveOrPaused {
                LiveStatusBar(program: p, broadcast: m.broadcast, health: m.health)
            }

            ProgramCard(program: p)

            // Two console columns collapse to a stack in portrait — fixed, stable rows.
            AudioSourcePanel(source: $source, micGain: $micGain)

            MeterAndWaveformPanel(active: m.broadcast == .live)

            BroadcastControlsPanel(
                broadcast: m.broadcast, busy: m.busy,
                onGoLive: { m.startCountdown() },
                onCancel: { m.cancelCountdown() },
                onPause: { m.togglePause() },
                onEnd: { m.endBroadcast() }
            )

            IngestPanel(program: p, onRotate: { m.rotateKey() }, busy: m.busy)

            ReactionsPanel(hearts: m.hearts, amens: m.amens, fires: m.fires, comments: m.comments,
                           onReact: { m.react($0) }, onRefresh: { m.loadComments() })

            if m.broadcast.isLiveOrPaused, let h = m.health {
                StreamHealthPanel(health: h)
            }

            SchedulePanel(program: p)
            DeviceManagerPanel()
            EmergencyPanel(onEnd: { m.endBroadcast() }, canEnd: m.broadcast.isLiveOrPaused)
        } else {
            StudioPanel {
                VStack(spacing: 10) {
                    Image(systemName: "dot.radiowaves.left.and.right").font(.system(size: 30)).foregroundStyle(Rs.faint)
                    Text("No programs yet").font(.inter(15, .semibold)).foregroundStyle(Rs.text)
                    Text("Create a broadcast program to begin.").font(.inter(12)).foregroundStyle(Rs.dim)
                    Button { showCreate = true } label: {
                        Text("New program").font(.inter(12, .bold)).foregroundStyle(Color(hex: 0x0A1120))
                            .padding(.horizontal, 16).frame(height: 34).background(Rs.goldFill).clipShape(Capsule())
                    }.buttonStyle(.plain).padding(.top, 4)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 32)
            }
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
                    }.buttonStyle(.plain)
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
                Spacer(minLength: 0)
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

// MARK: - LIVE status bar (duration / listeners / bitrate / health)

private struct LiveStatusBar: View {
    let program: RadioProgram
    let broadcast: Broadcast
    let health: StreamHealth?
    // Duration ticks locally from live_started_at; a light 1s timer so it counts up.
    @State private var now = Date()
    private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        StudioPanel(padding: 14, glow: true) {
            HStack(spacing: 0) {
                stat("DURATION", duration, Rs.gold, "clock")
                divider
                stat("LISTENERS", "\(health?.listeners ?? program.peakListeners)", Rs.green, "person.2.fill")
                divider
                stat("BITRATE", health.map { "\(Int($0.bitrate)) kbps" } ?? "—", Rs.text, "waveform")
                divider
                stat("HEALTH", healthLabel, healthColor, "heart.text.square")
            }
        }
        .onReceive(clock) { now = $0 }
    }

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

    private var duration: String {
        guard let startISO = program.liveStartedAt, let start = parseISO(startISO) else { return "00:00:00" }
        let secs = max(0, Int(now.timeIntervalSince(start)))
        let h = secs / 3600, m = (secs % 3600) / 60, s = secs % 60
        return String(format: "%02d:%02d:%02d", h, m, s)
    }
    private var healthLabel: String {
        guard let st = health?.stability else { return broadcast == .paused ? "Paused" : "—" }
        if st >= 95 { return "Excellent" }; if st >= 85 { return "Good" }; if st >= 70 { return "Fair" }; return "Poor"
    }
    private var healthColor: Color {
        guard let st = health?.stability else { return Rs.dim }
        if st >= 85 { return Rs.green }; if st >= 70 { return Rs.gold }; return Rs.red
    }
}

// MARK: - Audio source selector + mic gain (client-only hardware)

private struct AudioSourcePanel: View {
    @Binding var source: String
    @Binding var micGain: Double

    // 7 sources with a status + signal indicator (client-simulated).
    private struct Src: Identifiable { let name: String; let icon: String; let online: Bool; let signal: Int; var id: String { name } }
    private let sources: [Src] = [
        .init(name: "Main mic", icon: "mic.fill", online: true, signal: 5),
        .init(name: "Pulpit mic", icon: "mic", online: true, signal: 4),
        .init(name: "Line in", icon: "cable.connector", online: true, signal: 5),
        .init(name: "Playback deck", icon: "opticaldiscdrive", online: true, signal: 3),
        .init(name: "Phone bridge", icon: "phone.fill", online: false, signal: 0),
        .init(name: "Remote guest", icon: "wifi", online: true, signal: 2),
        .init(name: "Ambient room", icon: "waveform.circle", online: true, signal: 3),
    ]

    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "square.stack.3d.up.fill", title: "Audio source", caption: "hardware")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10, alignment: .top)], spacing: 10) {
                    ForEach(sources) { s in
                        let on = s.name == source
                        Button { if s.online { source = s.name } } label: {
                            HStack(spacing: 9) {
                                Image(systemName: s.icon).font(.system(size: 14)).foregroundStyle(on ? Rs.gold : (s.online ? Rs.text : Rs.faint)).frame(width: 20)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(s.name).font(.inter(12, .semibold)).foregroundStyle(s.online ? Rs.text : Rs.faint).lineLimit(1)
                                    SignalBars(level: s.signal, active: on)
                                }
                                Spacer(minLength: 0)
                            }
                            .padding(.horizontal, 11).padding(.vertical, 10)
                            .background(on ? Rs.gold.opacity(0.10) : Color.white.opacity(0.03))
                            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(on ? Rs.gold.opacity(0.45) : Rs.border, lineWidth: 1))
                            .opacity(s.online ? 1 : 0.55)
                        }.buttonStyle(.plain).disabled(!s.online)
                    }
                }
                // Mic gain (client-only)
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("MIC GAIN").font(.inter(9.5, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
                        Spacer()
                        Text("\(Int(micGain)) dB").font(Rs.mono(11, .semibold)).foregroundStyle(Rs.gold)
                    }
                    Slider(value: $micGain, in: 0...100).tint(Rs.gold)
                }.padding(.top, 2)
            }
        }
    }
}

private struct SignalBars: View {
    let level: Int      // 0..5
    var active: Bool = false
    var body: some View {
        HStack(spacing: 2) {
            ForEach(0..<5, id: \.self) { i in
                RoundedRectangle(cornerRadius: 1)
                    .fill(i < level ? (active ? Rs.gold : Rs.green) : Rs.faint.opacity(0.4))
                    .frame(width: 3, height: CGFloat(5 + i * 2))
            }
        }
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
    private let tick = Timer.publish(every: 0.12, on: .main, in: .common).autoconnect()
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
    }
    private func segColor(_ i: Int) -> Color {
        let f = CGFloat(i) / CGFloat(segs)
        if f > 0.85 { return Rs.red }; if f > 0.65 { return Rs.gold }; return Rs.green
    }
}

/// Scrolling bar waveform, fixed frame, Timer-driven sample buffer.
private struct Waveform: View {
    let active: Bool
    @State private var samples: [CGFloat] = Array(repeating: 0.1, count: 48)
    private let tick = Timer.publish(every: 0.09, on: .main, in: .common).autoconnect()
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
    }
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
            bigButton("Go live", icon: "dot.radiowaves.left.and.right", fill: Rs.liveGlow, fg: .white, action: onGoLive)
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
        }.buttonStyle(.plain).disabled(busy)
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
                StudioHeader(icon: "key.fill", title: "Ingest & stream key", caption: program.ingestProvider ?? "provider")
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
                }.buttonStyle(.plain).disabled(busy).padding(.top, 2)
            }
        }
    }
    @State private var revealKey = false
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
                    }.buttonStyle(.plain)
                }
                Button { UIPasteboard.general.string = value } label: {
                    Image(systemName: "doc.on.doc").font(.system(size: 12)).foregroundStyle(Rs.dim)
                }.buttonStyle(.plain).disabled(value == "—")
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
                    Button(action: onRefresh) { Image(systemName: "arrow.clockwise").font(.system(size: 12)).foregroundStyle(Rs.dim) }.buttonStyle(.plain)
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
        }.buttonStyle(.plain)
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
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "calendar", title: "Schedule", caption: program.timezone ?? "")
                HStack(spacing: 0) {
                    schedItem("WHEN", program.scheduledAt.map { Fmt.date($0, style: .dateTime.month(.abbreviated).day().hour().minute()) } ?? "Unscheduled")
                    schedDivider
                    schedItem("DURATION", program.durationMin.map { "\($0) min" } ?? "—")
                    schedDivider
                    schedItem("REPEAT", (program.repeatRule ?? "none").capitalized)
                }
            }
        }
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
                }.buttonStyle(.plain).disabled(!canEnd)
            }
        }
        .alert("Kill broadcast?", isPresented: $confirm) {
            Button("Cancel", role: .cancel) {}
            Button("Kill now", role: .destructive) { onEnd() }
        } message: { Text("This ends the live stream and disconnects every listener immediately.") }
    }
}

// MARK: - Dark loading / error states

private struct DarkSkeleton: View {
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

// MARK: - ISO parse helper (shared)

func parseISO(_ s: String) -> Date? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: s) { return d }
    let g = ISO8601DateFormatter(); return g.date(from: s)
}
