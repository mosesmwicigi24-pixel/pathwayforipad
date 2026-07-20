// Create a radio broadcast program — a dark-studio sheet matching RadioStudioView.
// POSTs /admin/radio/programs with the frozen create body (title/category required;
// description/speaker/location/tags/artwork/visibility + schedule + recording
// optional). The backend provisions the ingest provider + stream key on create, so
// the caller just refreshes the list afterward.
import SwiftUI
import UIKit
import PhotosUI
import UniformTypeIdentifiers

// A conditional JSON body value so we omit keys the server should default (mirrors
// the web spread and UsersView's JSONBodyValue, kept file-local here).
enum RadioJSON: Encodable {
    case string(String), int(Int), bool(Bool), strings([String]), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        case .strings(let a):
            var u = encoder.unkeyedContainer()
            for s in a { try u.encode(s) }
        }
    }
}

struct RadioProgramForm: View {
    /// When non-nil the sheet is in EDIT mode: fields prefill from this program and
    /// Save issues a PATCH instead of a create. When nil it's the original create flow.
    var existing: RadioProgram? = nil
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

    private var isEdit: Bool { existing != nil }

    @State private var didPrefill = false

    @State private var title = ""
    @State private var category = "Sermon"
    @State private var description = ""
    @State private var speaker = ""
    @State private var location = ""
    @State private var tagsText = ""
    @State private var artworkUrl = ""
    @State private var visibility = "public"
    @State private var scheduled = false
    @State private var scheduledAt = Date().addingTimeInterval(3600)
    @State private var durationMin = 60
    @State private var repeatRule = "none"
    @State private var autoGoLive = true
    @State private var recordBroadcast = true
    @State private var recordTarget = "cloud"

    // Uploaded session audio (ADDENDUM).
    @State private var audioUrl = ""
    @State private var audioDurationSec: Int?
    @State private var audioFilename = ""
    @State private var audioUploading = false
    @State private var audioError: String?
    @State private var showAudioImporter = false

    @State private var saving = false
    @State private var error: String?

    // Schedule-overlap warning (GET /admin/radio/schedule/conflicts). Debounced
    // ~0.5s after every date/duration edit; the token guards against a slow older
    // response landing after a newer one and painting stale conflicts.
    @State private var conflicts: [PortalAPI.ScheduleConflict] = []
    @State private var conflictTask: Task<Void, Never>?
    @State private var conflictToken = 0

    @State private var artworkItem: PhotosPickerItem?
    @State private var artworkUploading = false
    @State private var artworkError: String?

    private let categories = ["Sermon", "Worship", "Prayer", "Bible Study", "Conference"]
    private let visibilities = ["public", "members", "private"]
    private let repeats = ["none", "daily", "weekly", "monthly"]
    private let targets = ["cloud", "local", "both"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let error {
                        Text(error).font(.inter(12.5, .medium)).foregroundStyle(Rs.red)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Rs.red.opacity(0.12)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }
                    section("Program") {
                        field("Title", required: true) { TextField("", text: $title).dstyle() }
                        picker("Category", $category, categories)
                        field("Description") {
                            TextEditor(text: $description).frame(minHeight: 70).scrollContentBackground(.hidden)
                                .font(.inter(14)).foregroundStyle(Rs.text)
                                .padding(.horizontal, 8).padding(.vertical, 6)
                                .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
                        }
                        field("Speaker") { TextField("", text: $speaker).dstyle() }
                        field("Location") { TextField("", text: $location).dstyle() }
                        field("Tags (comma separated)") { TextField("", text: $tagsText).dstyle() }
                        field("Artwork") { artworkField }
                        field("Audio recording") { audioField }
                        picker("Visibility", $visibility, visibilities)
                    }
                    section("Schedule") {
                        Toggle(isOn: $scheduled) { Text("Schedule for later").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text) }.tint(Rs.gold)
                        if scheduled {
                            // UIKit-backed picker so the minutes snap to :00/:15/:30/:45
                            // (SwiftUI's DatePicker has no minuteInterval). Compact style
                            // opens a tap-through calendar + time wheel.
                            MinuteIntervalDatePicker(selection: $scheduledAt, minuteInterval: 15)
                                .fixedSize()
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        // Duration runs from 15 min to a full 24 hours (1440), in 15-min
                        // steps — one session can air non-stop for a day. Backend caps at 1440.
                        Stepper(value: $durationMin, in: 15...1440, step: 15) {
                            Text("Duration: \(durationMin) min · \(durationLabel(durationMin))")
                                .font(.inter(13.5, .semibold)).foregroundStyle(Rs.text)
                        }
                        picker("Repeat", $repeatRule, repeats)
                        VStack(alignment: .leading, spacing: 4) {
                            Toggle(isOn: $autoGoLive) { Text("Auto-air at scheduled time").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text) }.tint(Rs.gold)
                            Text("Goes live automatically at the scheduled time.").font(.inter(11)).foregroundStyle(Rs.dim)
                        }
                    }
                    if scheduled && !conflicts.isEmpty {
                        conflictCard
                    }
                    section("Recording") {
                        Toggle(isOn: $recordBroadcast) { Text("Record this broadcast").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text) }.tint(Rs.red)
                        if recordBroadcast { picker("Store to", $recordTarget, targets) }
                    }
                }
                .padding(18)
            }
            .background(Rs.bg.ignoresSafeArea())
            .navigationTitle(isEdit ? "Edit session" : "New program")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Rs.dim) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: {
                        if saving { ProgressView().tint(Rs.gold) }
                        else { Text(isEdit ? "Save changes" : "Create").font(.inter(15, .bold)).foregroundStyle(Rs.gold) }
                    }.disabled(saving)
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear(perform: prefillIfNeeded)
        .onChange(of: scheduled) { _, _ in scheduleConflictCheck() }
        .onChange(of: scheduledAt) { _, _ in scheduleConflictCheck() }
        .onChange(of: durationMin) { _, _ in scheduleConflictCheck() }
        .onDisappear { conflictTask?.cancel() }
    }

    // MARK: Schedule-overlap warning

    /// Debounced frequency check: cancel any in-flight probe, wait ~0.5s of quiet,
    /// then ask the backend which sessions overlap [scheduledAt, +duration). When
    /// editing, the program's own id is excluded so it never conflicts with itself.
    private func scheduleConflictCheck() {
        conflictTask?.cancel()
        conflictToken += 1
        guard scheduled else { conflicts = []; return }
        let token = conflictToken
        let when = scheduledAt
        let dur = durationMin
        let exclude = existing?.id
        conflictTask = Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            if Task.isCancelled { return }
            let found = (try? await PortalAPI.radioScheduleConflicts(
                scheduledAt: ISO8601DateFormatter().string(from: when),
                durationMin: dur, excludeId: exclude)) ?? []
            if Task.isCancelled || token != conflictToken { return }   // stale response
            conflicts = found
        }
    }

    /// Amber overlap card under the Schedule section — up to 3 conflicting sessions
    /// plus the auto-air queueing note. Rs has no amber token, so it leans on the
    /// gold/goldDeep pair (the studio's warning hue).
    @ViewBuilder private var conflictCard: some View {
        VStack(alignment: .leading, spacing: 7) {
            ForEach(conflicts.prefix(3)) { c in
                Text(conflictLine(c))
                    .font(.inter(12.5, .semibold)).foregroundStyle(Rs.gold)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("Only one session can be live; this one will start automatically when the frequency frees.")
                .font(.inter(11)).foregroundStyle(Rs.dim)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(Rs.goldDeep.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.goldDeep.opacity(0.4), lineWidth: 1))
    }

    private func conflictLine(_ c: PortalAPI.ScheduleConflict) -> String {
        let mins = c.durationMin ?? 60
        let title = c.title.isEmpty ? "Untitled" : c.title
        if c.isLive == true {
            return "⚠︎ Overlaps «\(title)» — on air now · \(mins) min"
        }
        let when = c.scheduledAt.flatMap(parseISO).map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "unscheduled"
        return "⚠︎ Overlaps «\(title)» — \(when) · \(mins) min"
    }

    // MARK: Prefill (edit mode)

    /// Populate every form field from the existing program the first time the sheet
    /// appears. Runs once (guarded by `didPrefill`) so re-renders don't clobber edits.
    private func prefillIfNeeded() {
        guard !didPrefill else { return }
        didPrefill = true
        // Create mode: snap the suggested default time to the 15-min grid.
        guard let p = existing else {
            scheduledAt = snapDateTo15(scheduledAt)
            return
        }
        title = p.title
        category = categories.contains(p.category) ? p.category : (p.category.isEmpty ? "Sermon" : p.category)
        description = p.description ?? ""
        speaker = p.speaker ?? ""
        location = p.location ?? ""
        tagsText = p.tags.joined(separator: ", ")
        artworkUrl = p.artworkUrl ?? ""
        visibility = visibilities.contains(p.visibility) ? p.visibility : "public"
        if let iso = p.scheduledAt, !iso.isEmpty, let d = parseISO(iso) {
            scheduled = true
            // Normalize a server value (e.g. 23:20) onto the 15-min grid.
            scheduledAt = snapDateTo15(d)
        } else {
            scheduled = false
        }
        durationMin = clampDuration(p.durationMin ?? 60)
        repeatRule = repeats.contains(p.repeatRule ?? "") ? (p.repeatRule ?? "none") : "none"
        autoGoLive = p.autoGoLive
        recordBroadcast = p.recordBroadcast
        recordTarget = targets.contains(p.recordTarget ?? "") ? (p.recordTarget ?? "cloud") : "cloud"
        audioUrl = p.audioUrl ?? ""
        audioDurationSec = p.audioDurationSec
        if let u = p.audioUrl, !u.isEmpty {
            audioFilename = URL(string: u)?.lastPathComponent ?? "Existing recording"
        }
        // An already-scheduled session shows its overlap state straight away.
        if scheduled { scheduleConflictCheck() }
    }

    // MARK: Building blocks

    @ViewBuilder private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased()).font(.inter(10.5, .bold)).tracking(1.2).foregroundStyle(Rs.gold)
            content()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Rs.panel).clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }

    @ViewBuilder private func field<C: View>(_ label: String, required: Bool = false, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(9, .bold)).tracking(0.8).foregroundStyle(Rs.dim)
                if required { Text("*").font(.inter(9, .bold)).foregroundStyle(Rs.red) }
            }
            content()
        }
    }

    private func picker(_ label: String, _ binding: Binding<String>, _ options: [String]) -> some View {
        field(label) {
            Menu {
                ForEach(options, id: \.self) { o in Button(o.capitalized) { binding.wrappedValue = o } }
            } label: {
                HStack {
                    Text(binding.wrappedValue.capitalized).font(.inter(13.5)).foregroundStyle(Rs.text)
                    Spacer()
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10)).foregroundStyle(Rs.dim)
                }
                .padding(.horizontal, 12).frame(height: 40)
                .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
            }
        }
    }

    // MARK: Artwork upload (dark inline control matching the studio sheet)

    @ViewBuilder private var artworkField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.04)).frame(width: 52, height: 52)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
                    if !artworkUrl.trimmingCharacters(in: .whitespaces).isEmpty,
                       let u = URL(string: artworkUrl.trimmingCharacters(in: .whitespaces)) {
                        AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { ProgressView().tint(Rs.gold) }
                            .frame(width: 52, height: 52).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        Image(systemName: "photo").font(.system(size: 18)).foregroundStyle(Rs.faint)
                    }
                }
                PhotosPicker(selection: $artworkItem, matching: .images) {
                    Label(artworkUrl.trimmingCharacters(in: .whitespaces).isEmpty ? "Upload artwork" : "Change artwork",
                          systemImage: "arrow.up.circle.fill")
                        .font(.inter(13, .semibold)).foregroundStyle(Rs.gold)
                }
                Spacer()
                if artworkUploading { ProgressView().tint(Rs.gold) }
            }
            TextField("", text: $artworkUrl, prompt: Text("…or paste a URL").foregroundStyle(Rs.faint))
                .dstyle().keyboardType(.URL).autocapitalization(.none).autocorrectionDisabled()
            if let artworkError {
                Text(artworkError).font(.inter(11, .medium)).foregroundStyle(Rs.red)
            }
        }
        .onChange(of: artworkItem) { _, newItem in
            guard let newItem else { return }
            Task {
                artworkUploading = true; artworkError = nil
                do {
                    if let data = try await newItem.loadTransferable(type: Data.self) {
                        artworkUrl = try await ImageUpload.upload(data, folder: "announcements")
                    }
                } catch {
                    artworkError = "Upload failed. Try again or paste a URL."
                }
                artworkUploading = false
            }
        }
    }

    // MARK: Audio upload — file importer → POST /admin/media/audio/upload

    @ViewBuilder private var audioField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.04)).frame(width: 52, height: 52)
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
                    Image(systemName: audioUrl.isEmpty ? "waveform" : "waveform.circle.fill")
                        .font(.system(size: 20)).foregroundStyle(audioUrl.isEmpty ? Rs.faint : Rs.gold)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Button { showAudioImporter = true } label: {
                        Label(audioUrl.isEmpty ? "Upload audio" : "Change audio", systemImage: "arrow.up.circle.fill")
                            .font(.inter(13, .semibold)).foregroundStyle(Rs.gold)
                    }.buttonStyle(.plain).disabled(audioUploading)
                    if !audioFilename.isEmpty {
                        Text(audioFilename).font(.inter(11)).foregroundStyle(Rs.dim).lineLimit(1).truncationMode(.middle)
                    } else {
                        Text("Broadcast this recording when the session airs.").font(.inter(10.5)).foregroundStyle(Rs.faint)
                    }
                }
                Spacer()
                if audioUploading { ProgressView().tint(Rs.gold) }
                else if !audioUrl.isEmpty {
                    Button { audioUrl = ""; audioFilename = ""; audioDurationSec = nil } label: {
                        Image(systemName: "xmark.circle.fill").font(.system(size: 16)).foregroundStyle(Rs.faint)
                    }.buttonStyle(.plain)
                }
            }
            if let audioError {
                Text(audioError).font(.inter(11, .medium)).foregroundStyle(Rs.red)
            }
        }
        .fileImporter(isPresented: $showAudioImporter,
                      allowedContentTypes: AudioUploadRules.allowedContentTypes) { result in
            handleAudioPick(result)
        }
    }

    private func handleAudioPick(_ result: Result<URL, Error>) {
        switch result {
        case .failure(let err):
            audioError = err.localizedDescription
        case .success(let url):
            Task {
                audioUploading = true; audioError = nil
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                do {
                    let data = try Data(contentsOf: url)
                    if let msg = AudioUploadRules.validate(filename: url.lastPathComponent, byteCount: data.count) {
                        audioError = msg
                        audioUploading = false
                        return
                    }
                    let up = try await PortalAPI.uploadRadioAudio(data: data, filename: url.lastPathComponent)
                    audioUrl = up.url
                    audioDurationSec = up.durationSec
                    audioFilename = url.lastPathComponent
                } catch {
                    audioError = (error as? APIError)?.errorDescription ?? "Audio upload failed. Try again."
                }
                audioUploading = false
            }
        }
    }

    // MARK: Schedule helpers (15-min grid + friendly duration)

    /// Round a Date to the nearest 15 minutes (:00/:15/:30/:45), zeroing seconds.
    /// A stray 23:20 lands on 23:15/23:30 so airtimes always sit on the grid.
    private func snapDateTo15(_ date: Date) -> Date {
        let cal = Calendar.current
        let comps = cal.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        guard let minute = comps.minute else { return date }
        let snapped = Int((Double(minute) / 15.0).rounded()) * 15
        var hourStart = comps
        hourStart.minute = 0
        hourStart.second = 0
        guard let base = cal.date(from: hourStart) else { return date }
        return cal.date(byAdding: .minute, value: snapped, to: base) ?? date
    }

    /// Clamp a duration into [15, 1440] minutes, rounded onto the 15-min grid.
    private func clampDuration(_ minutes: Int) -> Int {
        let snapped = Int((Double(minutes) / 15.0).rounded()) * 15
        return Swift.max(15, Swift.min(1440, snapped))
    }

    /// Friendly duration label: 1440 → "24h", 480 → "8h", 75 → "1h 15m".
    private func durationLabel(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(String(format: "%02d", m))m"
    }

    // MARK: Submit

    private func submit() async {
        let t = title.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { error = "Please enter a title."; return }
        saving = true; error = nil

        let tags = tagsText.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        var body: [String: RadioJSON] = [
            "title": .string(t),
            "category": .string(category),
            "description": description.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(description.trimmingCharacters(in: .whitespaces)),
            "speaker": speaker.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(speaker.trimmingCharacters(in: .whitespaces)),
            "location": location.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(location.trimmingCharacters(in: .whitespaces)),
            "artwork_url": artworkUrl.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(artworkUrl.trimmingCharacters(in: .whitespaces)),
            "tags": .strings(tags),
            "visibility": .string(visibility),
            "duration_min": .int(clampDuration(durationMin)),
            "repeat": .string(repeatRule),
            "timezone": .string(TimeZone.current.identifier),
            "auto_go_live": .bool(autoGoLive),
            "record_broadcast": .bool(recordBroadcast),
            "record_target": recordBroadcast ? .string(recordTarget) : .null,
            "audio_url": audioUrl.trimmingCharacters(in: .whitespaces).isEmpty ? .null : .string(audioUrl.trimmingCharacters(in: .whitespaces)),
            "audio_duration_sec": audioDurationSec.map { RadioJSON.int($0) } ?? .null,
        ]
        if scheduled {
            let f = ISO8601DateFormatter()
            // Snap to the 15-min grid before persisting, so a stray value never lands off-mark.
            body["scheduled_at"] = .string(f.string(from: snapDateTo15(scheduledAt)))
        } else if isEdit {
            // In edit mode, an unchecked schedule clears any existing scheduled_at.
            body["scheduled_at"] = .null
        }

        do {
            if let existing {
                _ = try await PortalAPI.updateRadioProgram(existing.id, body)
            } else {
                _ = try await PortalAPI.createRadioProgram(body)
            }
            saving = false
            onSaved()
            dismiss()
        } catch {
            saving = false
            self.error = (error as? APIError)?.errorDescription
                ?? (isEdit ? "Could not save changes." : "Could not create the program.")
        }
    }
}

// Dark text-field styling shared by the form's inputs.
private extension View {
    func dstyle() -> some View {
        self.font(.inter(14)).foregroundStyle(Rs.text).tint(Rs.gold)
            .padding(.horizontal, 12).frame(height: 40)
            .background(Color.white.opacity(0.04)).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Rs.border, lineWidth: 1))
    }
}

// A UIKit UIDatePicker wrapped for SwiftUI so the minutes snap to a fixed
// interval (:00/:15/:30/:45) — SwiftUI's DatePicker exposes no `minuteInterval`.
// `.compact` renders one obvious tappable control that opens a calendar + time
// wheel; dark-styled and gold-tinted to match the studio sheet. (UIDatePicker is
// supported under Mac Catalyst.)
private struct MinuteIntervalDatePicker: UIViewRepresentable {
    @Binding var selection: Date
    var minuteInterval: Int = 15

    func makeUIView(context: Context) -> UIDatePicker {
        let picker = UIDatePicker()
        picker.datePickerMode = .dateAndTime
        picker.minuteInterval = minuteInterval
        picker.preferredDatePickerStyle = .compact
        picker.overrideUserInterfaceStyle = .dark
        picker.tintColor = UIColor(Rs.gold)
        picker.date = selection
        picker.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .valueChanged)
        picker.setContentHuggingPriority(.required, for: .horizontal)
        picker.setContentCompressionResistancePriority(.required, for: .horizontal)
        return picker
    }

    func updateUIView(_ picker: UIDatePicker, context: Context) {
        picker.minuteInterval = minuteInterval
        // Only push external changes down; avoid fighting an in-flight user edit.
        if abs(picker.date.timeIntervalSince(selection)) > 1 {
            picker.setDate(selection, animated: false)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject {
        var parent: MinuteIntervalDatePicker
        init(_ parent: MinuteIntervalDatePicker) { self.parent = parent }
        @objc func changed(_ sender: UIDatePicker) { parent.selection = sender.date }
    }
}
