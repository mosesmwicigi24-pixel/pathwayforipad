// Create a radio broadcast program — a dark-studio sheet matching RadioStudioView.
// POSTs /admin/radio/programs with the frozen create body (title/category required;
// description/speaker/location/tags/artwork/visibility + schedule + recording
// optional). The backend provisions the ingest provider + stream key on create, so
// the caller just refreshes the list afterward.
import SwiftUI
import PhotosUI

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
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss

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
    @State private var recordBroadcast = true
    @State private var recordTarget = "cloud"

    @State private var saving = false
    @State private var error: String?

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
                        picker("Visibility", $visibility, visibilities)
                    }
                    section("Schedule") {
                        Toggle(isOn: $scheduled) { Text("Schedule for later").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text) }.tint(Rs.gold)
                        if scheduled {
                            DatePicker("", selection: $scheduledAt).labelsHidden().datePickerStyle(.compact).tint(Rs.gold)
                                .environment(\.colorScheme, .dark)
                        }
                        Stepper(value: $durationMin, in: 5...480, step: 5) {
                            Text("Duration: \(durationMin) min").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text)
                        }
                        picker("Repeat", $repeatRule, repeats)
                    }
                    section("Recording") {
                        Toggle(isOn: $recordBroadcast) { Text("Record this broadcast").font(.inter(13.5, .semibold)).foregroundStyle(Rs.text) }.tint(Rs.red)
                        if recordBroadcast { picker("Store to", $recordTarget, targets) }
                    }
                }
                .padding(18)
            }
            .background(Rs.bg.ignoresSafeArea())
            .navigationTitle("New program")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.foregroundStyle(Rs.dim) }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await submit() } } label: {
                        if saving { ProgressView().tint(Rs.gold) } else { Text("Create").font(.inter(15, .bold)).foregroundStyle(Rs.gold) }
                    }.disabled(saving)
                }
            }
        }
        .preferredColorScheme(.dark)
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
            "duration_min": .int(durationMin),
            "repeat": .string(repeatRule),
            "timezone": .string(TimeZone.current.identifier),
            "record_broadcast": .bool(recordBroadcast),
            "record_target": recordBroadcast ? .string(recordTarget) : .null,
        ]
        if scheduled {
            let f = ISO8601DateFormatter()
            body["scheduled_at"] = .string(f.string(from: scheduledAt))
        }

        do {
            _ = try await APIClient.shared.post("/admin/radio/programs", body: body, as: RadioProgram.self)
            saving = false
            onSaved()
            dismiss()
        } catch {
            saving = false
            self.error = (error as? APIError)?.errorDescription ?? "Could not create the program."
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
