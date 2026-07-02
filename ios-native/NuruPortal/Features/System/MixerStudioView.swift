// Virtual Audio Mixer — a native SwiftUI port of the web portal's MixerStudio page,
// dark studio theme (shares the `Rs` palette + `StudioPanel` from RadioStudioView).
//
// REAL, persisted bits (wired to the frozen admin API):
//   • scene presets           GET/POST /admin/radio/mixer/scenes  (+ seed 4 defaults)
//   • jingle soundboard        GET/POST/DELETE /admin/radio/mixer/jingles
// CLIENT-ONLY: the live channel strips (level/pan/mute/solo) + master fader and the
// music-bed player are local state — a saved scene captures the current strips and
// POSTs them; loading a scene applies its channels back onto the strips.
import SwiftUI

// MARK: - JSON body for scene / jingle writes (omit-null, mirrors RadioJSON).

private enum MixJSON: Encodable {
    case string(String), int(Int), bool(Bool), double(Double), null
    case channels([LocalChannel])
    func encode(to encoder: Encoder) throws {
        switch self {
        case .channels(let ch):
            var u = encoder.unkeyedContainer()
            for c in ch { try u.encode(c) }
        default:
            var c = encoder.singleValueContainer()
            switch self {
            case .string(let v): try c.encode(v)
            case .int(let v): try c.encode(v)
            case .bool(let v): try c.encode(v)
            case .double(let v): try c.encode(v)
            case .null: try c.encodeNil()
            case .channels: break
            }
        }
    }
}

// Local, editable channel (encodes to the scene channels[] shape).
struct LocalChannel: Identifiable, Encodable, Equatable {
    var id: String
    var name: String
    var sub: String
    var color: String
    var level: Double     // 0..100
    var pan: Double        // -100..100
    var muted: Bool
    var solo: Bool

    init(from c: MixerChannel) {
        id = c.id.isEmpty ? UUID().uuidString : c.id
        name = c.name; sub = c.sub ?? ""; color = c.color ?? "#E6C66E"
        level = c.level; pan = c.pan; muted = c.muted; solo = c.solo
    }
    init(id: String = UUID().uuidString, name: String, sub: String, color: String, level: Double) {
        self.id = id; self.name = name; self.sub = sub; self.color = color
        self.level = level; pan = 0; muted = false; solo = false
    }
}

private func chColor(_ hex: String) -> Color {
    var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    return Color(hex: UInt32(s, radix: 16) ?? 0xE6C66E)
}

// MARK: - View model

@MainActor
private final class MixerModel: ObservableObject {
    @Published var channels: [LocalChannel] = MixerModel.defaultStrips()
    @Published var master: Double = 80
    @Published var scenes: [MixerScene] = []
    @Published var jingles: [MixerJingle] = []
    @Published var activeSceneId: String?
    @Published var loaded = false
    @Published var error: String?
    @Published var actionError: String?
    @Published var busy = false

    static func defaultStrips() -> [LocalChannel] {
        [
            .init(name: "Preacher", sub: "Lav mic", color: "#E6C66E", level: 82),
            .init(name: "Worship", sub: "Stereo bus", color: "#22C55E", level: 68),
            .init(name: "Choir", sub: "Overheads", color: "#7DD3FC", level: 60),
            .init(name: "Keys", sub: "DI", color: "#C4B5FD", level: 55),
            .init(name: "Congregation", sub: "Room", color: "#F9A8D4", level: 40),
            .init(name: "Music bed", sub: "Playback", color: "#FDBA74", level: 30),
        ]
    }

    func load() async {
        do {
            async let s = PortalAPI.mixerScenes()
            async let j = PortalAPI.mixerJingles()
            var loadedScenes = try await s
            jingles = try await j
            if loadedScenes.isEmpty { loadedScenes = await seedDefaultScenes() }
            scenes = loadedScenes
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load the mixer."
        }
        loaded = true
    }

    // Seed the 4 canonical scenes if the church has none yet.
    private func seedDefaultScenes() async -> [MixerScene] {
        let presets: [(String, String, [LocalChannel])] = [
            ("Preaching", "Voice forward, beds low", tuned(preacher: 88, worship: 35, choir: 20, keys: 30, room: 45, bed: 18)),
            ("Worship", "Band + choir up", tuned(preacher: 55, worship: 82, choir: 74, keys: 70, room: 50, bed: 30)),
            ("Prayer", "Intimate, soft bed", tuned(preacher: 70, worship: 40, choir: 25, keys: 45, room: 35, bed: 42)),
            ("Interview", "Two voices, minimal music", tuned(preacher: 80, worship: 25, choir: 15, keys: 20, room: 55, bed: 12)),
        ]
        var created: [MixerScene] = []
        for (i, p) in presets.enumerated() {
            if let scene = try? await createScene(name: p.0, hint: p.1, channels: p.2, isDefault: i == 0) {
                created.append(scene)
            }
        }
        return created
    }

    private func tuned(preacher: Double, worship: Double, choir: Double, keys: Double, room: Double, bed: Double) -> [LocalChannel] {
        var s = MixerModel.defaultStrips()
        let vals = [preacher, worship, choir, keys, room, bed]
        for i in s.indices where i < vals.count { s[i].level = vals[i] }
        return s
    }

    func createScene(name: String, hint: String, channels: [LocalChannel], isDefault: Bool) async throws -> MixerScene {
        let body: [String: MixJSON] = [
            "name": .string(name),
            "hint": hint.isEmpty ? .null : .string(hint),
            "channels": .channels(channels),
            "is_default": .bool(isDefault),
        ]
        return try await APIClient.shared.post("/admin/radio/mixer/scenes", body: body, as: MixerScene.self)
    }

    func applyScene(_ scene: MixerScene) {
        activeSceneId = scene.id
        guard !scene.channels.isEmpty else { return }
        // Match saved channels onto local strips by name; apply level/pan/mute/solo.
        for saved in scene.channels {
            if let i = channels.firstIndex(where: { $0.name == saved.name }) {
                channels[i].level = saved.level
                channels[i].pan = saved.pan
                channels[i].muted = saved.muted
                channels[i].solo = saved.solo
            }
        }
    }

    func saveCurrentAsScene(name: String, hint: String) {
        Task {
            busy = true; actionError = nil
            do {
                let scene = try await createScene(name: name, hint: hint, channels: channels, isDefault: false)
                scenes.append(scene)
                activeSceneId = scene.id
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not save the scene."
            }
            busy = false
        }
    }

    func addJingle(label: String) {
        Task {
            busy = true; actionError = nil
            do {
                let body: [String: MixJSON] = [
                    "label": .string(label),
                    "color": .string("#E6C66E"),
                    // audioUrl placeholder — real upload wired when the media pipeline lands.
                    "audio_url": .string("https://audio.local/jingles/\(UUID().uuidString).mp3"),
                    "sort": .int(jingles.count),
                ]
                let j = try await APIClient.shared.post("/admin/radio/mixer/jingles", body: body, as: MixerJingle.self)
                jingles.append(j)
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not add the jingle."
            }
            busy = false
        }
    }

    func deleteJingle(_ id: String) {
        Task {
            do {
                _ = try await APIClient.shared.delete("/admin/radio/mixer/jingles/\(id)", as: EmptyOk.self)
                jingles.removeAll { $0.id == id }
            } catch {
                actionError = (error as? APIError)?.errorDescription ?? "Could not delete the jingle."
            }
        }
    }

    struct EmptyOk: Codable {}
}

// MARK: - MixerStudioView

struct MixerStudioView: View {
    @StateObject private var m = MixerModel()
    @State private var showSaveScene = false
    @State private var showAddJingle = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if let error = m.error, m.scenes.isEmpty, !m.loaded {
                    DarkError(message: error) { Task { await m.load() } }
                } else {
                    scenePresets
                    channelStrips
                    musicBed
                    jingleBoard
                }
            }
            .padding(18).padding(.bottom, 48)
        }
        .background(Rs.bg.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.hidden, for: .navigationBar)
        .task { if !m.loaded { await m.load() } }
        .sheet(isPresented: $showSaveScene) {
            NameSheet(title: "Save scene", placeholder: "Scene name", hintPlaceholder: "Hint (optional)") { name, hint in
                m.saveCurrentAsScene(name: name, hint: hint)
            }
        }
        .sheet(isPresented: $showAddJingle) {
            NameSheet(title: "Add jingle", placeholder: "Jingle label", hintPlaceholder: nil) { label, _ in
                m.addJingle(label: label)
            }
        }
        .alert("Something went wrong", isPresented: Binding(get: { m.actionError != nil }, set: { if !$0 { m.actionError = nil } })) {
            Button("OK", role: .cancel) { m.actionError = nil }
        } message: { Text(m.actionError ?? "") }
    }

    private var header: some View {
        StudioPanel(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 8) {
                    Text("OPERATIONS").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.dim)
                    Image(systemName: "chevron.right").font(.system(size: 7)).foregroundStyle(Rs.faint)
                    Text("Mixer Studio").font(.inter(10.5, .bold)).tracking(1.4).foregroundStyle(Rs.text)
                    Spacer()
                }
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("VIRTUAL AUDIO MIXER").font(.inter(10.5, .bold)).tracking(1.8).foregroundStyle(Rs.gold)
                        Text("Mixer Studio").font(Rs.serif(30)).foregroundStyle(Rs.text)
                        Text("Balance every source, recall a scene, and drop jingles between segments.")
                            .font(.inter(13)).foregroundStyle(Rs.dim).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    Button { showSaveScene = true } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "square.and.arrow.down").font(.system(size: 11, weight: .bold))
                            Text("Save scene").font(.inter(12, .bold))
                        }
                        .foregroundStyle(Color(hex: 0x0A1120))
                        .padding(.horizontal, 14).frame(height: 34).background(Rs.goldFill).clipShape(Capsule())
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: Scene presets

    private var scenePresets: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "rectangle.stack.fill", title: "Scene presets", caption: "\(m.scenes.count) saved")
                if m.scenes.isEmpty {
                    Text(m.loaded ? "No scenes yet — save the current mix to create one." : "Loading scenes…")
                        .font(.inter(12)).foregroundStyle(Rs.dim).padding(.vertical, 6)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10, alignment: .top)], spacing: 10) {
                        ForEach(m.scenes) { s in
                            let on = s.id == m.activeSceneId
                            Button { m.applyScene(s) } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "slider.horizontal.3").font(.system(size: 12)).foregroundStyle(on ? Rs.gold : Rs.dim)
                                        Text(s.name.isEmpty ? "Scene" : s.name).font(.inter(13, .bold)).foregroundStyle(on ? Rs.text : Rs.dim).lineLimit(1)
                                        if s.isDefault { Image(systemName: "star.fill").font(.system(size: 8)).foregroundStyle(Rs.gold) }
                                    }
                                    Text(s.hint ?? "\(s.channels.count) channels").font(.inter(10.5)).foregroundStyle(Rs.dim).lineLimit(1)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 12).padding(.vertical, 11)
                                .background(on ? Rs.gold.opacity(0.10) : Color.white.opacity(0.03))
                                .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 11, style: .continuous).stroke(on ? Rs.gold.opacity(0.45) : Rs.border, lineWidth: 1))
                            }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: Channel strips + master (client-only, interactive)

    private var channelStrips: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                StudioHeader(icon: "slider.vertical.3", title: "Channel strips", caption: "\(m.channels.count) + master")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 12) {
                        ForEach($m.channels) { $ch in
                            ChannelStrip(channel: $ch, soloActive: m.channels.contains { $0.solo })
                        }
                        MasterStrip(level: $m.master)
                    }
                    .padding(.vertical, 2)
                }
            }
        }
    }

    // MARK: Music bed (client-only player)

    private var musicBed: some View {
        MusicBedPanel()
    }

    // MARK: Jingle soundboard

    private var jingleBoard: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    StudioHeader(icon: "music.note.list", title: "Jingle soundboard", tint: Rs.green)
                    Button { showAddJingle = true } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "plus").font(.system(size: 10, weight: .bold))
                            Text("Add").font(.inter(11.5, .semibold))
                        }.foregroundStyle(Rs.gold).padding(.horizontal, 11).frame(height: 30)
                        .background(Rs.gold.opacity(0.12)).clipShape(Capsule()).overlay(Capsule().stroke(Rs.gold.opacity(0.3), lineWidth: 1))
                    }.buttonStyle(.plain)
                }
                if m.jingles.isEmpty {
                    Text(m.loaded ? "No jingles yet — add one to build the soundboard." : "Loading…")
                        .font(.inter(12)).foregroundStyle(Rs.dim).padding(.vertical, 6)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .top)], spacing: 10) {
                        ForEach(m.jingles) { j in JinglePad(jingle: j) { m.deleteJingle(j.id) } }
                    }
                }
            }
        }
    }
}

// MARK: - Channel strip

private struct ChannelStrip: View {
    @Binding var channel: LocalChannel
    let soloActive: Bool
    var body: some View {
        let color = chColor(channel.color)
        let dimmed = soloActive && !channel.solo
        return VStack(spacing: 8) {
            VStack(spacing: 1) {
                Text(channel.name).font(.inter(11.5, .bold)).foregroundStyle(Rs.text).lineLimit(1)
                Text(channel.sub).font(.inter(9)).foregroundStyle(Rs.dim).lineLimit(1)
            }.frame(height: 30)

            // Vertical level fader (rotated Slider is finicky; use a tap/drag track).
            VerticalFader(value: $channel.level, color: channel.muted ? Rs.faint : color)
                .frame(width: 44, height: 150)

            Text("\(Int(channel.level))").font(Rs.mono(10, .semibold)).foregroundStyle(Rs.dim)

            // Pan
            VStack(spacing: 3) {
                Text("PAN").font(.inter(7.5, .bold)).tracking(0.6).foregroundStyle(Rs.faint)
                Slider(value: $channel.pan, in: -100...100).tint(color).frame(width: 52)
            }

            HStack(spacing: 5) {
                toggle("M", on: channel.muted, color: Rs.red) { channel.muted.toggle() }
                toggle("S", on: channel.solo, color: Rs.gold) { channel.solo.toggle() }
            }
        }
        .frame(width: 74)
        .padding(.horizontal, 8).padding(.vertical, 12)
        .background(Color.white.opacity(0.03)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
        .opacity(dimmed ? 0.5 : 1)
    }
    private func toggle(_ s: String, on: Bool, color: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(s).font(.inter(11, .bold)).foregroundStyle(on ? Color(hex: 0x0A1120) : Rs.dim)
                .frame(width: 26, height: 26)
                .background(on ? color : Color.white.opacity(0.05)).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        }.buttonStyle(.plain)
    }
}

private struct MasterStrip: View {
    @Binding var level: Double
    var body: some View {
        VStack(spacing: 8) {
            VStack(spacing: 1) {
                Text("MASTER").font(.inter(11.5, .bold)).foregroundStyle(Rs.gold)
                Text("Main out").font(.inter(9)).foregroundStyle(Rs.dim)
            }.frame(height: 30)
            VerticalFader(value: $level, color: Rs.gold).frame(width: 44, height: 150)
            Text("\(Int(level))").font(Rs.mono(10, .semibold)).foregroundStyle(Rs.gold)
            Spacer(minLength: 0).frame(height: 22)
            Image(systemName: "speaker.wave.3.fill").font(.system(size: 12)).foregroundStyle(Rs.gold).frame(height: 26)
        }
        .frame(width: 74)
        .padding(.horizontal, 8).padding(.vertical, 12)
        .background(Rs.gold.opacity(0.08)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.gold.opacity(0.3), lineWidth: 1))
    }
}

/// A vertical fader — a drag-controlled track (stable, fixed frame).
private struct VerticalFader: View {
    @Binding var value: Double     // 0..100
    var color: Color
    var body: some View {
        GeometryReader { geo in
            let h = geo.size.height
            let fill = h * CGFloat(value / 100)
            ZStack(alignment: .bottom) {
                Capsule().fill(Color.white.opacity(0.06)).frame(width: 8)
                Capsule().fill(color).frame(width: 8, height: fill)
                // Knob
                Circle().fill(Rs.text).frame(width: 20, height: 20)
                    .overlay(Circle().stroke(color, lineWidth: 2))
                    .offset(y: -(fill - 10).clamped(to: 0...(h - 20)))
                    .shadow(color: .black.opacity(0.4), radius: 3, y: 1)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { g in
                    let v = Double((h - g.location.y) / h) * 100
                    value = min(100, max(0, v))
                }
            )
        }
    }
}

private extension CGFloat { func clamped(to r: ClosedRange<CGFloat>) -> CGFloat { Swift.min(Swift.max(self, r.lowerBound), r.upperBound) } }

// MARK: - Music bed player (client-only)

private struct MusicBedPanel: View {
    @State private var playing = false
    @State private var progress: Double = 0.28
    @State private var volume: Double = 30
    private let clock = Timer.publish(every: 0.5, on: .main, in: .common).autoconnect()
    var body: some View {
        StudioPanel {
            VStack(alignment: .leading, spacing: 12) {
                StudioHeader(icon: "music.quarternote.3", title: "Music bed", caption: "under-service loop")
                HStack(spacing: 14) {
                    Button { playing.toggle() } label: {
                        Image(systemName: playing ? "pause.fill" : "play.fill").font(.system(size: 16, weight: .bold))
                            .foregroundStyle(Color(hex: 0x0A1120)).frame(width: 46, height: 46)
                            .background(Rs.goldFill).clipShape(Circle())
                    }.buttonStyle(.plain)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Ambient Pad — Loop A").font(.inter(12.5, .semibold)).foregroundStyle(Rs.text)
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color.white.opacity(0.06))
                                Capsule().fill(Rs.gold).frame(width: geo.size.width * progress)
                            }
                        }.frame(height: 5)
                    }
                    VStack(spacing: 3) {
                        Image(systemName: "speaker.wave.2.fill").font(.system(size: 10)).foregroundStyle(Rs.dim)
                        Slider(value: $volume, in: 0...100).tint(Rs.gold).frame(width: 72)
                    }
                }
            }
        }
        .onReceive(clock) { _ in if playing { progress += 0.01; if progress >= 1 { progress = 0 } } }
    }
}

// MARK: - Jingle pad

private struct JinglePad: View {
    let jingle: MixerJingle
    let onDelete: () -> Void
    @State private var pressed = false
    var body: some View {
        let color = chColor(jingle.color ?? "#E6C66E")
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "play.circle.fill").font(.system(size: 20)).foregroundStyle(color)
                Spacer()
                Button(action: onDelete) { Image(systemName: "trash").font(.system(size: 11)).foregroundStyle(Rs.dim) }.buttonStyle(.plain)
            }
            Text(jingle.label.isEmpty ? "Jingle" : jingle.label).font(.inter(12.5, .semibold)).foregroundStyle(Rs.text).lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
        .padding(12)
        .background(color.opacity(pressed ? 0.22 : 0.10)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(color.opacity(0.3), lineWidth: 1))
        .scaleEffect(pressed ? 0.97 : 1)
        .onTapGesture {
            withAnimation(.easeInOut(duration: 0.12)) { pressed = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.16) { withAnimation { pressed = false } }
        }
    }
}

// MARK: - Simple name-entry sheet (scene / jingle)

private struct NameSheet: View {
    let title: String
    let placeholder: String
    let hintPlaceholder: String?
    let onSave: (String, String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var hint = ""
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 14) {
                fieldBox(placeholder, text: $name)
                if hintPlaceholder != nil { fieldBox(hintPlaceholder!, text: $hint) }
                Spacer()
            }
            .padding(18)
            .background(Rs.bg.ignoresSafeArea())
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Rs.dim) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let n = name.trimmingCharacters(in: .whitespaces)
                        if !n.isEmpty { onSave(n, hint.trimmingCharacters(in: .whitespaces)); dismiss() }
                    }.font(.inter(15, .bold)).foregroundStyle(Rs.gold).disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
    private func fieldBox(_ ph: String, text: Binding<String>) -> some View {
        TextField("", text: text, prompt: Text(ph).foregroundColor(Rs.faint))
            .font(.inter(15)).foregroundStyle(Rs.text).tint(Rs.gold)
            .padding(.horizontal, 14).frame(height: 46)
            .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }
}
