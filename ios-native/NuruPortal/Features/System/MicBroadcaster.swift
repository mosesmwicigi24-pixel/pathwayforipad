// MicBroadcaster — REAL microphone sensing + live Icecast uplink for the Radio Studio.
//
// Senses the iPad's audio inputs via AVAudioSession (a RØDE USB mic shows up as
// `.usbAudio` and is auto-preferred), meters the live input with an AVAudioEngine
// tap, and broadcasts the mic into the station's liquidsoap mix engine by pushing
// an AAC/ADTS stream into its Icecast-protocol harbor (host:8005 /mic, user
// "source", password = the program's stream key).
//
// Split in two:
//   • MicBroadcaster  — @MainActor ObservableObject the UI binds to (inputs, level,
//     state machine idle → connecting → onAir | error). Owns the AVAudioSession
//     category dance (.playAndRecord while capturing, restore .playback after).
//     App-wide SINGLETON (`.shared`) so a live broadcast survives navigation; it
//     also owns the persisted mic-boost gain (dB → linear, applied in the tap).
//   • MicUplink       — plain class doing the realtime work off the main actor:
//     inputNode tap → AVAudioConverter (AAC-LC 44.1 kHz stereo ~128 kbps) → 7-byte
//     ADTS framing → NWConnection over TCP (Network framework — deliberately NOT
//     URLSession, so no ATS exception is needed for the raw source socket).
//
// Resilience: permission denial, missing stream key, refused handshakes, and mid-
// broadcast network drops all land in `.error(String)` — never a crash. The user
// can simply retry.
import Foundation
import AVFoundation
import Accelerate
import Network
import os

// MARK: - ===================== MicBroadcaster (UI-facing) =====================

@MainActor
final class MicBroadcaster: ObservableObject {

    /// App-wide singleton — the mic must outlive whichever screen started it.
    /// RadioStudioView only OBSERVES this; it never owns it, so a live broadcast
    /// survives navigating to the Mixer (or anywhere else) and the shell's top
    /// bar can show a global ON MIC pill wherever the operator is.
    static let shared = MicBroadcaster()

    enum State: Equatable {
        case idle
        case connecting
        case onAir
        case error(String)
    }

    /// One selectable hardware input, derived from AVAudioSession.availableInputs.
    struct InputSource: Identifiable, Equatable {
        let uid: String
        let name: String
        let portType: AVAudioSession.Port
        var id: String { uid }
        var isUSB: Bool { portType == .usbAudio }
        /// Friendly, brand-aware label for the UI (e.g. "RØDE Wireless GO II"
        /// instead of a terse USB product string). Falls back to `name` when the
        /// device isn't a known mic — routing/isUSB never depend on this.
        var displayName: String { MicProfiles.friendlyName(for: name) }
    }

    // Published surface the Audio source card binds to.
    @Published private(set) var availableInputs: [InputSource] = []
    @Published private(set) var activeInputUID: String?
    @Published private(set) var currentInputName: String = "No input detected"
    /// Brand-friendly version of `currentInputName` for the header caption — maps a
    /// known USB mic's raw port string to its market name (e.g. "Shure MV7"), and
    /// passes anything unrecognised (including "No input detected") through as-is.
    var currentInputDisplayName: String { MicProfiles.friendlyName(for: currentInputName) }
    @Published private(set) var level: Double = 0          // 0…1 RMS meter
    @Published private(set) var state: State = .idle
    @Published private(set) var monitoring = false
    @Published private(set) var permissionDenied = false

    // In-ear monitor playback (NO mic — the presenter's own voice arrives via
    // the mic's hardware sidetone). Plays one of the engine's two monitor
    // mounts with a ~1 s buffer, far under the listener stream's 4–6 s.
    @Published private(set) var monitorPlaying = false
    @Published private(set) var monitorNote: String?

    /// Which of the engine's TWO monitor feeds the operator hears. Both derive
    /// from the program's playback URL (".../listen/s_<hash>.mp3"):
    ///   .onAir → `mon_` — the broadcast chain minus the mic (ducks with Voice
    ///            Over Music, follows faders/EQ) — hear it as listeners do.
    ///   .cue   → `cue_` — pre-fader bed + jingles, music always full and clear
    ///            (classic DJ cue). Choice persists across launches.
    enum MonitorMode: String { case onAir, cue }
    @Published private(set) var monitorMode: MonitorMode = .onAir
    private static let monitorModeDefaultsKey = "radio.monitorMode"

    /// Software mic gain in dB (0…+18, default +6), persisted across launches.
    /// Applied on the audio thread BEFORE metering + encoding (MicUplink), so the
    /// input meter shows the boosted, on-air signal.
    @Published var boostDb: Double {
        didSet {
            UserDefaults.standard.set(boostDb, forKey: Self.boostDefaultsKey)
            uplink.setBoost(factor: Float(boostFactor))
        }
    }
    /// Linear gain for the current boostDb (+6 dB ≈ ×2).
    var boostFactor: Double { pow(10, boostDb / 20) }
    private static let boostDefaultsKey = "radio.micBoostDb"

    var isBroadcasting: Bool { state == .connecting || state == .onAir }

    private let session = AVAudioSession.sharedInstance()
    private let uplink = MicUplink()
    private var routeObserver: NSObjectProtocol?
    /// Set when the operator taps a specific row; suppresses USB auto-preference
    /// until that device disappears (so a manual choice is never fought).
    private var manualSelectionUID: String?

    // Monitor playback internals — a DEDICATED player, fully separate from the mic
    // engine and from any other studio audio, so tearing it down never disturbs a
    // live broadcast.
    private var monitorPlayer: AVPlayer?
    private var monitorURL: URL?
    /// The program's base playback URL the current monitor session derived its
    /// feed from — kept so a mode switch can re-derive the sibling feed.
    private var monitorBaseHls: String?
    private var monitorItemObservers: [NSObjectProtocol] = []
    private var monitorStatusObservation: NSKeyValueObservation?
    /// Operator INTENT — stays true across retry gaps so a mid-retry route change
    /// or manual stop cancels any pending reconnect.
    private var monitorWantsPlay = false
    private var monitorFailures = 0

    private init() {
        // Restore the persisted boost (didSet doesn't fire in init — push manually).
        let stored = UserDefaults.standard.object(forKey: Self.boostDefaultsKey) as? Double
        boostDb = min(max(stored ?? 6, 0), 18)
        uplink.setBoost(factor: Float(pow(10, boostDb / 20)))

        // Restore the persisted monitor mode (defaults to on-air).
        if let raw = UserDefaults.standard.string(forKey: Self.monitorModeDefaultsKey),
           let mode = MonitorMode(rawValue: raw) {
            monitorMode = mode
        }

        uplink.onLevel = { [weak self] lvl in
            DispatchQueue.main.async { self?.level = lvl }
        }
        uplink.onEvent = { [weak self] event in
            DispatchQueue.main.async { self?.handle(event) }
        }
        // Live re-scan when the RØDE is plugged/unplugged (or any route change).
        // The same notification polices the monitor's feedback guard: if the
        // output falls back to the built-in speaker, kill the monitor at once.
        routeObserver = NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.rescanInputs(autoPrefer: true)
                self?.enforceMonitorRouteSafety()
            }
        }
        rescanInputs(autoPrefer: true)
    }

    deinit {
        if let routeObserver { NotificationCenter.default.removeObserver(routeObserver) }
    }

    /// Full stop — kills monitoring, monitor playback AND a live broadcast. NOT
    /// called on mere navigation any more (the singleton broadcasts across
    /// screens); reserved for an explicit shutdown such as sign-out.
    func teardown() {
        stopMonitor()
        uplink.disconnect()
        uplink.stopCapture()
        if isBroadcasting { state = .idle }
        monitoring = false
        level = 0
        restorePlaybackSession()
    }

    /// Navigation-safe wind-down for the hosting view's onDisappear: stops the
    /// level-meter monitoring, but NEVER touches a live broadcast — while on air
    /// (or connecting) capture + uplink keep running and the audio session stays
    /// `.playAndRecord`, so leaving for the Mixer can't kill the mic.
    func stopMonitorIfIdle() {
        monitoring = false
        guard !isBroadcasting else { return }    // on air — leave everything running
        uplink.stopCapture()
        restorePlaybackSession()
        level = 0
    }

    // MARK: Input sensing

    /// Re-read availableInputs; auto-prefer a USB input (the RØDE) when present.
    func rescanInputs(autoPrefer: Bool) {
        let ports = session.availableInputs ?? []
        let inputs = ports.map { InputSource(uid: $0.uid, name: $0.portName, portType: $0.portType) }
        if inputs != availableInputs { availableInputs = inputs }

        // If the manually-chosen device left, fall back to automatic preference.
        if let manual = manualSelectionUID, !ports.contains(where: { $0.uid == manual }) {
            manualSelectionUID = nil
        }
        if autoPrefer, manualSelectionUID == nil,
           let usb = ports.first(where: { $0.portType == .usbAudio }),
           session.preferredInput?.uid != usb.uid {
            try? session.setPreferredInput(usb)
        }

        let active = session.currentRoute.inputs.first.map { ($0.uid, $0.portName) }
            ?? session.preferredInput.map { ($0.uid, $0.portName) }
            ?? ports.first.map { ($0.uid, $0.portName) }
        activeInputUID = active?.0
        currentInputName = active?.1 ?? "No input detected"
    }

    /// Operator picked a row — route capture to that hardware input.
    func select(_ input: InputSource) {
        guard let port = session.availableInputs?.first(where: { $0.uid == input.uid }) else { return }
        manualSelectionUID = input.uid
        try? session.setPreferredInput(port)
        rescanInputs(autoPrefer: false)
    }

    // MARK: Monitoring (level meter without broadcasting)

    func startMonitoring() {
        guard !monitoring else { return }
        Task { [weak self] in
            guard let self else { return }
            guard await self.ensurePermission() else { return }
            do {
                try self.activateCaptureSession()
                try self.uplink.startCapture()
                self.monitoring = true
            } catch {
                self.state = .error("Could not open the microphone — \(error.localizedDescription)")
            }
        }
    }

    func stopMonitoring() {
        guard monitoring else { return }
        monitoring = false
        if !isBroadcasting {
            uplink.stopCapture()
            restorePlaybackSession()
            level = 0
        }
    }

    // MARK: Monitor playback (in-ear feed — NO mic passthrough)
    // The engine publishes TWO monitor mounts (mic excluded from both) at the
    // program's playback URL with `s_` swapped for the mode's prefix: `mon_`
    // (on-air chain) or `cue_` (pre-fader DJ cue). The presenter hears the LIVE
    // music through the RØDE's headphone jack with ~1 s of buffer; their own
    // voice arrives via the mic's hardware sidetone, so no local passthrough.

    private static let monitorFeedbackNote =
        "Plug headphones into the mic (or iPad) — monitoring over the speaker would feed back into the broadcast."

    /// True when the ONLY way out is the iPad's own speaker — the one route where
    /// monitoring is forbidden (the mic would re-capture the bed → feedback loop).
    private var speakerOnlyOutput: Bool {
        let outputs = session.currentRoute.outputs
        return !outputs.isEmpty && outputs.allSatisfy { $0.portType == .builtInSpeaker }
    }

    /// The ONE place a monitor feed URL is derived. Both feeds live at the
    /// program's playback URL with `s_` swapped for the mode's prefix:
    /// …/listen/s_abc.mp3 → …/listen/mon_abc.mp3 (on-air) or …/cue_abc.mp3 (cue).
    static func monitorFeedURL(baseHlsUrl: String?, mode: MonitorMode) -> URL? {
        guard let hls = baseHlsUrl, var url = URL(string: hls) else { return nil }
        let last = url.lastPathComponent
        guard last.hasPrefix("s_") else { return nil }
        url.deleteLastPathComponent()
        let prefix = (mode == .cue) ? "cue_" : "mon_"
        return url.appendingPathComponent(prefix + last.dropFirst(2))
    }

    func toggleMonitor(baseHlsUrl: String) {
        if monitorPlaying {
            stopMonitor()
        } else if let url = Self.monitorFeedURL(baseHlsUrl: baseHlsUrl, mode: monitorMode) {
            monitorBaseHls = baseHlsUrl
            startMonitor(url: url)
        }
    }

    /// Switch which feed the operator hears. Persisted; if the monitor is
    /// currently running (or mid-retry), the player swaps to the other feed's
    /// URL through the normal start path — the feedback guard and the retry
    /// budget behave exactly as on a fresh start.
    func setMonitorMode(_ mode: MonitorMode) {
        guard mode != monitorMode else { return }
        monitorMode = mode
        UserDefaults.standard.set(mode.rawValue, forKey: Self.monitorModeDefaultsKey)
        guard monitorWantsPlay || monitorPlaying,
              let url = Self.monitorFeedURL(baseHlsUrl: monitorBaseHls, mode: mode) else { return }
        startMonitor(url: url)
    }

    /// Stop in-ear monitoring. Deliberately touches ONLY the dedicated monitor
    /// player — never the shared audio session — so an active mic broadcast (or
    /// the studio's baseline playback session) is left exactly as it was.
    func stopMonitor() {
        monitorWantsPlay = false
        monitorFailures = 0
        monitorPlaying = false
        tearDownMonitorPlayer()
    }

    private func startMonitor(url: URL) {
        // Feedback guard FIRST — never let the bed out of the iPad speaker while
        // a mic may be hot in the same room.
        guard !speakerOnlyOutput else {
            monitorNote = Self.monitorFeedbackNote
            return
        }
        monitorWantsPlay = true
        monitorFailures = 0
        monitorURL = url
        monitorNote = nil               // clears on a successful start
        activateMonitorSession()
        playMonitorItem(url: url)
        monitorPlaying = true
    }

    /// Make sure SOME active session exists for pure-monitor use. During mic work
    /// the session is already `.playAndRecord` (+ .mixWithOthers) — never
    /// downgrade it; otherwise mirror the studio's `.playback` baseline.
    private func activateMonitorSession() {
        if session.category != .playAndRecord {
            try? session.setCategory(.playback, mode: .default)
        }
        try? session.setActive(true)
    }

    private func playMonitorItem(url: URL) {
        tearDownMonitorPlayer()
        let item = AVPlayerItem(url: url)
        item.preferredForwardBufferDuration = 1     // low-latency in-ear cue
        let player = AVPlayer(playerItem: item)     // waitsToMinimizeStalling stays default ON
        monitorPlayer = player

        // Healthy playback resets the retry budget; a failed item is a hiccup.
        monitorStatusObservation = item.observe(\.status, options: [.new]) { [weak self] item, _ in
            let status = item.status
            Task { @MainActor [weak self] in
                guard let self else { return }
                switch status {
                case .readyToPlay: self.monitorFailures = 0
                case .failed:      self.monitorHiccup()
                default:           break
                }
            }
        }
        // Ended / failed / stalled all mean the same thing for a live mount: the
        // engine dropped it (restart) — treat uniformly as a hiccup.
        let names: [Notification.Name] = [.AVPlayerItemDidPlayToEndTime,
                                          .AVPlayerItemFailedToPlayToEndTime,
                                          .AVPlayerItemPlaybackStalled]
        for name in names {
            monitorItemObservers.append(NotificationCenter.default.addObserver(
                forName: name, object: item, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.monitorHiccup() }
            })
        }
        player.play()
    }

    /// Auto-reconnect lite: retry after 2 s while the operator still wants the
    /// monitor; give up quietly after 3 consecutive failures.
    private func monitorHiccup() {
        guard monitorWantsPlay else { return }
        tearDownMonitorPlayer()
        monitorFailures += 1
        guard monitorFailures < 3 else {
            monitorWantsPlay = false
            monitorPlaying = false
            monitorNote = "Monitor stream unavailable"
            return
        }
        let attempt = monitorFailures
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            guard let self, self.monitorWantsPlay, self.monitorFailures == attempt,
                  self.monitorPlayer == nil, let url = self.monitorURL else { return }
            self.playMonitorItem(url: url)
        }
    }

    /// Route fell back to the built-in speaker mid-monitor (headphones pulled) —
    /// stop instantly and tell the operator why.
    private func enforceMonitorRouteSafety() {
        guard (monitorPlaying || monitorWantsPlay), speakerOnlyOutput else { return }
        stopMonitor()
        monitorNote = Self.monitorFeedbackNote
    }

    private func tearDownMonitorPlayer() {
        monitorStatusObservation?.invalidate()
        monitorStatusObservation = nil
        for observer in monitorItemObservers { NotificationCenter.default.removeObserver(observer) }
        monitorItemObservers.removeAll()
        monitorPlayer?.pause()
        monitorPlayer?.replaceCurrentItem(with: nil)
        monitorPlayer = nil
        // NOTE: no session category/active changes here — see stopMonitor().
    }

    // MARK: Broadcast lifecycle

    /// Push the mic into the station's live mix: Icecast source handshake on
    /// host:port + mount, then a continuous AAC/ADTS stream.
    func start(host: String, port: UInt16 = 8005, mount: String = "/mic", password: String) {
        guard !isBroadcasting else { return }
        guard !password.isEmpty else {
            state = .error("This program has no stream key — rotate one first.")
            return
        }
        state = .connecting
        Task { [weak self] in
            guard let self else { return }
            guard await self.ensurePermission() else { return }
            do {
                try self.activateCaptureSession()
                try self.uplink.startCapture()
            } catch {
                self.state = .error("Could not open the microphone — \(error.localizedDescription)")
                self.windDownCaptureIfIdle()
                return
            }
            self.uplink.connect(host: host, port: port, mount: mount, password: password)
        }
    }

    func stop() {
        uplink.disconnect()
        if isBroadcasting { state = .idle }
        windDownCaptureIfIdle()
    }

    private func handle(_ event: MicUplink.Event) {
        switch event {
        case .connected:
            guard state == .connecting else { return }
            state = .onAir
        case .refused(let statusLine):
            state = .error("Station refused the mic — \(statusLine)")
            windDownCaptureIfIdle()
        case .failed(let message):
            state = .error(message)
            windDownCaptureIfIdle()
        }
    }

    /// If neither monitoring nor broadcasting needs the tap, release the hardware
    /// and hand the audio session back to plain playback.
    private func windDownCaptureIfIdle() {
        guard !monitoring, !isBroadcasting else { return }
        uplink.stopCapture()
        restorePlaybackSession()
        level = 0
    }

    // MARK: Permission + audio session

    private func ensurePermission() async -> Bool {
        let granted: Bool
        switch AVAudioApplication.shared.recordPermission {
        case .granted:      granted = true
        case .denied:       granted = false
        default:            granted = await AVAudioApplication.requestRecordPermission()
        }
        permissionDenied = !granted
        if !granted {
            state = .error("Microphone access denied — enable it in Settings.")
        }
        return granted
    }

    private func activateCaptureSession() throws {
        try session.setCategory(.playAndRecord, mode: .default,
                                options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers])
        try session.setActive(true)
        // Max out the hardware input gain where the route allows it — the
        // software boost (boostDb) then rides on top of the loudest raw signal.
        if session.isInputGainSettable { try? session.setInputGain(1.0) }
        // Re-assert the preferred input now that the record session is live —
        // availableInputs is fully populated only for record-capable categories.
        rescanInputs(autoPrefer: true)
    }

    private func restorePlaybackSession() {
        // Back to the studio's baseline (see enableBackgroundPlayback()).
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
    }
}

// MARK: - ===================== MicUplink (realtime capture → AAC/ADTS → TCP) =====================

/// Non-isolated pipeline: AVAudioEngine tap (audio thread) → serial `net` queue
/// where the AAC converter, ADTS framing, and the NWConnection all live.
final class MicUplink {

    enum Event {
        case connected
        case refused(String)
        case failed(String)
    }

    /// 0…1 RMS level, ~20 Hz, called on the audio tap thread.
    var onLevel: ((Double) -> Void)?
    /// Uplink lifecycle events, called on the uplink queue.
    var onEvent: ((Event) -> Void)?

    private let engine = AVAudioEngine()
    /// Everything below is owned by this serial queue (the NWConnection's queue too).
    private let net = DispatchQueue(label: "org.nuruplace.mic.uplink")

    // Main-thread capture state.
    private var capturing = false
    private var configObserver: NSObjectProtocol?

    // `net`-queue uplink state.
    private var connection: NWConnection?
    private var converter: AVAudioConverter?
    private var aacFormat: AVAudioFormat?
    private var streaming = false
    private var batch = Data()
    private var batchPackets = 0

    // Audio-thread-only meter throttle.
    private var lastLevelAt: CFAbsoluteTime = 0

    /// Linear mic-boost factor (1 = unity). Written by the main thread when the
    /// operator moves the slider; read on the audio thread every tap callback.
    /// OSAllocatedUnfairLock keeps the read wait-free in practice (uncontended
    /// CAS — no allocation, no priority inversion, no @MainActor hop).
    private let boostFactor = OSAllocatedUnfairLock<Float>(initialState: 1)

    /// Thread-safe boost update — callable from any thread.
    func setBoost(factor: Float) {
        boostFactor.withLock { $0 = max(0, factor) }
    }

    private static let outSampleRate: Double = 44_100
    private static let outChannels: UInt32 = 2          // mono inputs are duplicated L/R
    private static let outBitrate = 128_000
    private static let adtsSampleFreqIndex = 4          // 44.1 kHz
    private static let packetsPerSend = 6               // ~140 ms of audio per TCP send

    init() {
        // A route change mid-capture (mic unplugged) changes the input format;
        // re-install the tap with the fresh format so capture survives.
        configObserver = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
        ) { [weak self] _ in
            self?.reinstallTapAfterConfigChange()
        }
    }

    deinit {
        if let configObserver { NotificationCenter.default.removeObserver(configObserver) }
    }

    // MARK: Capture (tap on the input node's native format)

    func startCapture() throws {
        guard !capturing else { return }
        try installTap()
        engine.prepare()
        try engine.start()
        capturing = true
    }

    func stopCapture() {
        guard capturing else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        capturing = false
        onLevel?(0)
        net.async { [weak self] in self?.converter = nil }
    }

    private func installTap() throws {
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)       // the input's native format
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw NSError(domain: "MicUplink", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "The selected input has no live audio channels."
            ])
        }
        // 2048 frames ≈ 43–46 ms per callback at 44.1/48 kHz → ~20 Hz metering.
        input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
            self?.handleTap(buffer)
        }
    }

    private func reinstallTapAfterConfigChange() {
        guard capturing else { return }
        engine.inputNode.removeTap(onBus: 0)
        // The converter's input format is stale now — rebuild on the next buffer.
        net.async { [weak self] in self?.converter = nil }
        do {
            try installTap()
            engine.prepare()
            try engine.start()
        } catch {
            net.async { [weak self] in
                self?.failIfConnected("The audio input changed and capture could not restart.")
            }
        }
    }

    /// Audio-thread: software boost (in place) → RMS meter → uplink queue.
    /// Boost runs FIRST so both the meter and the encoded stream carry it.
    private func handleTap(_ buffer: AVAudioPCMBuffer) {
        boostInPlace(buffer)
        if let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 {
            let now = CFAbsoluteTimeGetCurrent()
            if now - lastLevelAt >= 0.045 {              // ≤ ~22 Hz to the UI
                lastLevelAt = now
                var rms: Float = 0
                vDSP_rmsqv(channel, 1, &rms, vDSP_Length(buffer.frameLength))
                let db = 20 * log10(max(rms, 0.000_01))  // floor at -100 dBFS
                let norm = max(0, min(1, (db + 50) / 50)) // -50 dB → 0 … 0 dB → 1
                onLevel?(Double(norm))
            }
        }
        net.async { [weak self] in self?.encodeAndSend(buffer) }
    }

    /// Multiply every float sample by the current boost factor, then hard-clip to
    /// [-1, 1] so overdrive saturates instead of wrapping. Audio-thread only;
    /// pure vDSP, no allocation.
    private func boostInPlace(_ buffer: AVAudioPCMBuffer) {
        var factor = boostFactor.withLock { $0 }
        let frames = vDSP_Length(buffer.frameLength)
        guard frames > 0, abs(factor - 1) > .ulpOfOne,
              let channels = buffer.floatChannelData else { return }
        var lo: Float = -1, hi: Float = 1
        if buffer.format.isInterleaved {
            // Interleaved: all channels live in channels[0], frame-major.
            let n = frames * vDSP_Length(buffer.format.channelCount)
            vDSP_vsmul(channels[0], 1, &factor, channels[0], 1, n)
            vDSP_vclip(channels[0], 1, &lo, &hi, channels[0], 1, n)
        } else {
            for ch in 0..<Int(buffer.format.channelCount) {
                vDSP_vsmul(channels[ch], 1, &factor, channels[ch], 1, frames)
                vDSP_vclip(channels[ch], 1, &lo, &hi, channels[ch], 1, frames)
            }
        }
    }

    // MARK: Connect (Icecast SOURCE handshake over raw TCP)

    func connect(host: String, port: UInt16, mount: String, password: String) {
        net.async { [weak self] in
            guard let self else { return }
            self.teardownConnection()
            guard let nwPort = NWEndpoint.Port(rawValue: port) else {
                self.onEvent?(.failed("Invalid ingest port \(port)."))
                return
            }
            let conn = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
            self.connection = conn
            conn.stateUpdateHandler = { [weak self, weak conn] st in
                guard let self, let conn, self.connection === conn else { return }  // stale socket
                switch st {
                case .ready:
                    self.sendHandshake(on: conn, mount: mount, password: password)
                case .failed(let error):
                    self.failIfConnected("Connection failed — \(error.localizedDescription)")
                case .waiting(let error):
                    // No retry loop on a live console — surface it, let the user retry.
                    self.failIfConnected("Can't reach the station — \(error.localizedDescription)")
                default:
                    break
                }
            }
            conn.start(queue: self.net)
        }
    }

    func disconnect() {
        net.async { [weak self] in self?.teardownConnection() }
    }

    private func sendHandshake(on conn: NWConnection, mount: String, password: String) {
        let credentials = Data("source:\(password)".utf8).base64EncodedString()
        let handshake = "SOURCE \(mount) HTTP/1.0\r\n"
            + "Authorization: Basic \(credentials)\r\n"
            + "User-Agent: NuruPortal/1.0\r\n"
            + "Content-Type: audio/aac\r\n"
            + "Ice-Public: 0\r\n"
            + "Ice-Name: Nuru live mic\r\n"
            + "\r\n"
        conn.send(content: Data(handshake.utf8), completion: .contentProcessed { [weak self, weak conn] error in
            guard let self, let conn, self.connection === conn else { return }
            if let error { self.failIfConnected("Handshake failed — \(error.localizedDescription)"); return }
            self.readHandshakeResponse(on: conn)
        })
    }

    private func readHandshakeResponse(on conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 4096) { [weak self, weak conn] data, _, isComplete, error in
            guard let self, let conn, self.connection === conn else { return }
            if let error {
                self.failIfConnected("No reply from the station — \(error.localizedDescription)")
                return
            }
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let statusLine = text.split(separator: "\r\n", omittingEmptySubsequences: true)
                .first.map(String.init) ?? (isComplete ? "connection closed" : "empty reply")
            if statusLine.contains(" 200") {             // e.g. "HTTP/1.0 200 OK"
                self.streaming = true
                self.onEvent?(.connected)
                self.watchForDrop(on: conn)
            } else {
                self.teardownConnection()
                self.onEvent?(.refused(statusLine))
            }
        }
    }

    /// Icecast sends nothing after 200 OK — a read completing means the server
    /// hung up (key rotated, engine restarted, network died).
    private func watchForDrop(on conn: NWConnection) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 1024) { [weak self, weak conn] _, _, isComplete, error in
            guard let self, let conn, self.connection === conn, self.streaming else { return }
            if isComplete || error != nil {
                self.failIfConnected("The station closed the mic connection.")
            } else {
                self.watchForDrop(on: conn)
            }
        }
    }

    // MARK: Encode (PCM → AAC-LC packets → ADTS frames → batched sends)

    private func encodeAndSend(_ buffer: AVAudioPCMBuffer) {
        guard streaming else { return }
        if let existing = converter, existing.inputFormat != buffer.format { converter = nil }
        if converter == nil { prepareEncoder(from: buffer.format) }
        guard let converter, let aacFormat else { return }

        var fed = false
        while true {
            let out = AVAudioCompressedBuffer(format: aacFormat, packetCapacity: 8,
                                              maximumPacketSize: max(converter.maximumOutputPacketSize, 1))
            var convError: NSError?
            let status = converter.convert(to: out, error: &convError) { _, inputStatus in
                if fed { inputStatus.pointee = .noDataNow; return nil }
                fed = true
                inputStatus.pointee = .haveData
                return buffer
            }
            if status == .error {
                failIfConnected("Audio encoding failed\(convError.map { " — \($0.localizedDescription)" } ?? ".")")
                return
            }
            appendADTSFrames(out)
            if status != .haveData { break }             // ran dry — wait for the next tap buffer
        }
        flushBatch()
    }

    private func prepareEncoder(from input: AVAudioFormat) {
        var desc = AudioStreamBasicDescription(
            mSampleRate: Self.outSampleRate,
            mFormatID: kAudioFormatMPEG4AAC,
            mFormatFlags: 0,
            mBytesPerPacket: 0,
            mFramesPerPacket: 1024,
            mBytesPerFrame: 0,
            mChannelsPerFrame: Self.outChannels,
            mBitsPerChannel: 0,
            mReserved: 0)
        guard let out = AVAudioFormat(streamDescription: &desc),
              let conv = AVAudioConverter(from: input, to: out) else {
            failIfConnected("This input's audio format can't be encoded to AAC.")
            return
        }
        conv.bitRate = Self.outBitrate
        aacFormat = out
        converter = conv
    }

    private func appendADTSFrames(_ out: AVAudioCompressedBuffer) {
        let packetCount = Int(out.packetCount)
        guard packetCount > 0, let descriptions = out.packetDescriptions else { return }
        let base = UnsafeRawPointer(out.data)
        for i in 0..<packetCount {
            let d = descriptions[i]
            let size = Int(d.mDataByteSize)
            guard size > 0 else { continue }
            batch.append(Self.adtsHeader(payloadLength: size))
            batch.append(Data(bytes: base + Int(d.mStartOffset), count: size))
            batchPackets += 1
        }
    }

    /// Standard 7-byte ADTS header: MPEG-4 AAC-LC, 44.1 kHz (index 4), stereo, no CRC.
    private static func adtsHeader(payloadLength: Int) -> Data {
        let frameLength = payloadLength + 7
        let profile = 2                                  // AAC-LC → (profile - 1) in the header
        let sfIdx = adtsSampleFreqIndex
        let channels = Int(outChannels)
        var h = [UInt8](repeating: 0, count: 7)
        h[0] = 0xFF                                                            // sync
        h[1] = 0xF1                                                            // sync | MPEG-4 | no CRC
        h[2] = UInt8(((profile - 1) << 6) | (sfIdx << 2) | ((channels >> 2) & 0x1))
        h[3] = UInt8(((channels & 0x3) << 6) | ((frameLength >> 11) & 0x3))
        h[4] = UInt8((frameLength >> 3) & 0xFF)
        h[5] = UInt8(((frameLength & 0x7) << 5) | 0x1F)
        h[6] = 0xFC
        return Data(h)
    }

    private func flushBatch() {
        guard streaming, let connection, batchPackets >= Self.packetsPerSend else { return }
        let payload = batch
        batch = Data()
        batchPackets = 0
        connection.send(content: payload, completion: .contentProcessed { [weak self, weak connection] error in
            guard let self, let connection, self.connection === connection else { return }
            if let error { self.failIfConnected("Stream send failed — \(error.localizedDescription)") }
        })
    }

    // MARK: Teardown / failure (net queue)

    private func failIfConnected(_ message: String) {
        guard connection != nil else { return }
        teardownConnection()
        onEvent?(.failed(message))
    }

    private func teardownConnection() {
        streaming = false
        connection?.cancel()
        connection = nil
        converter = nil
        aacFormat = nil
        batch.removeAll()
        batchPackets = 0
    }
}
