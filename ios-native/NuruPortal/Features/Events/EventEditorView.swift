// Event editor — grouped sections (General · Schedule & Recurrence ·
// Registration & Attendance · Media · Automations · Publishing) with the
// Google-style edit-scope chooser (EVENTS_ARCHITECTURE.md §9):
//   · Only this occurrence → the exceptions path (schedule-only, honest UI),
//   · This and following  → POST /admin/events/series/{id}/split at the pivot,
//   · Entire series       → PUT /admin/events/series/{id}.
// Recurrence supports FREQ + INTERVAL + end conditions (never / until / count).
// Every control maps to a real wire field — no cosmetic toggles. Fields the
// deployed server does not persist yet (video_url, automation, ops toggles on
// update) are sent in the §3 shape so they light up as the backend lands.
import SwiftUI

struct EventEditorView: View {
    enum Scope: String, CaseIterable {
        case onlyThis = "Only this"
        case thisAndFollowing = "This & following"
        case entireSeries = "Entire series"
    }
    enum Mode {
        case create
        case edit(series: AdminSeriesRow, scope: Scope, pivot: String?)
    }

    let mode: Mode
    var onSaved: (String) -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    // General
    @State private var title = ""
    @State private var descriptionText = ""
    @State private var category: EvCategory = .worship
    @State private var location = ""
    @State private var visibility = "congregation"

    // Schedule & recurrence
    @State private var startDate = Date()
    @State private var startTime = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var durationMin = 90
    @State private var freq = "NONE"          // NONE | DAILY | WEEKLY | MONTHLY
    @State private var interval = 1
    @State private var byDays: Set<Int> = [0] // 0 = Sunday
    @State private var endKind = "never"      // never | until | count
    @State private var endUntil = Calendar.current.date(byAdding: .month, value: 6, to: Date()) ?? Date()
    @State private var endCount = 12

    // Registration & attendance
    @State private var rsvpEnabled = true
    @State private var qrEnabled = true
    @State private var manualEnabled = true
    @State private var remindersEnabled = true
    @State private var checkinOpensEnabled = false
    @State private var checkinOpensMin = 30

    // Media
    @State private var primaryImageUrl = ""
    @State private var videoUrl = ""

    // Automations (§7)
    @State private var reminderOffsets: Set<Int> = [1440, 60]
    @State private var autoArchiveEnabled = false
    @State private var autoArchiveDays = 7
    @State private var lowRsvpEnabled = false
    @State private var lowRsvpThreshold = 5
    @State private var qrAutoReady = false

    // Publishing
    @State private var statusDraft = false
    @State private var showOnHome = false
    @State private var featured = false

    // Scope + note (only-this)
    @State private var scope: Scope = .entireSeries
    @State private var occurrenceNote = ""

    @State private var busy = false
    @State private var err: String?
    @State private var didPrefill = false

    private var isEdit: Bool { if case .edit = mode { return true }; return false }
    private var editSeries: AdminSeriesRow? { if case .edit(let s, _, _) = mode { return s }; return nil }
    private var pivot: String? { if case .edit(_, _, let p) = mode { return p }; return nil }
    /// Scope chooser only makes sense on a recurring series with a pivot occurrence.
    private var scopeAvailable: Bool {
        guard let s = editSeries else { return false }
        return !(s.rrule ?? "").isEmpty && pivot != nil
    }

    private static let weekdayRrule = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if scopeAvailable { scopeChooser }
                    if scope == .onlyThis && isEdit {
                        onlyThisSection
                    } else {
                        generalSection
                        scheduleSection
                        registrationSection
                        mediaSection
                        automationsSection
                        publishingSection
                    }
                    if let err { Text(err).font(.nCaption).foregroundStyle(Nuru.danger) }
                }
                .padding(24)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .scrollContentBackground(.hidden)
            .navigationTitle(navTitle).navigationBarTitleDisplayMode(.inline)
            .onAppear { prefillIfNeeded() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) { saveButton }
            }
        }
        .presentationDetents([.large])
    }

    private var navTitle: String {
        if !isEdit { return "New event" }
        switch scope {
        case .onlyThis: return "Edit occurrence"
        case .thisAndFollowing: return "Edit — this & following"
        case .entireSeries: return "Edit series"
        }
    }

    private var saveButton: some View {
        Button { Task { await submit() } } label: {
            Group {
                if busy { ProgressView() }
                else { Text(isEdit ? "Save" : "Create").bold() }
            }
            .font(.inter(14, .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 8)
            .background(busy ? AnyShapeStyle(Nuru.muted) : AnyShapeStyle(Nuru.goldGradient))
            .clipShape(Capsule())
        }.disabled(busy)
    }

    // MARK: Scope chooser

    private var scopeChooser: some View {
        VStack(alignment: .leading, spacing: 8) {
            evSectionLabel("What should this change apply to?")
            Picker("", selection: $scope) {
                ForEach(Scope.allCases, id: \.self) { Text($0.rawValue).tag($0) }
            }.pickerStyle(.segmented)
            Text(scopeHint).font(.nMicro).foregroundStyle(Nuru.muted)
        }
    }
    private var scopeHint: String {
        switch scope {
        case .onlyThis: return "Rides the exceptions path — just this date moves; the series is untouched."
        case .thisAndFollowing: return "Splits the series at this occurrence: earlier dates keep the old settings, this date onward gets the new ones."
        case .entireSeries: return "Updates every occurrence, past pattern and future."
        }
    }

    // MARK: Only-this (exception) section

    @ViewBuilder private var onlyThisSection: some View {
        evSectionLabel("Reschedule this occurrence")
        Text("Only the date, time, and a note can change for a single occurrence — everything else belongs to the series (switch scope above to edit it).")
            .font(.nCaption).foregroundStyle(Nuru.muted)
        HStack(spacing: 12) {
            evFormField("New date") { DatePicker("", selection: $startDate, displayedComponents: .date).labelsHidden() }
            evFormField("New time") { DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden() }
        }
        evFormField("Duration") { durationPicker }
        evFormField("Note (optional)") {
            TextField("e.g. Venue unavailable", text: $occurrenceNote).textFieldStyle(.plain).font(.inter(13, .regular))
        }
    }

    // MARK: General

    @ViewBuilder private var generalSection: some View {
        evSectionLabel("General")
        evFormField("Event title") {
            TextField("Sunday Worship Service", text: $title).textFieldStyle(.plain).font(.inter(13, .regular))
        }
        HStack(spacing: 12) {
            evFormField("Category") {
                Picker("", selection: $category) {
                    ForEach(EvCategory.allCases, id: \.self) { Text($0.label).tag($0) }
                }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
            }
            evFormField("Location") {
                TextField("Main Sanctuary", text: $location).textFieldStyle(.plain).font(.inter(13, .regular))
            }
        }
        evFormField("Description (optional)") {
            TextField("What members should know…", text: $descriptionText, axis: .vertical)
                .lineLimit(2...4).textFieldStyle(.plain).font(.inter(13, .regular))
        }
        evFormField("Visibility") {
            Picker("", selection: $visibility) {
                Text("All members").tag("congregation")
                Text("Cell members").tag("cell")
                Text("Leaders only").tag("leaders")
            }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
        }
    }

    // MARK: Schedule & Recurrence

    @ViewBuilder private var scheduleSection: some View {
        evSectionLabel("Schedule & Recurrence")
        HStack(spacing: 12) {
            evFormField("Start date") { DatePicker("", selection: $startDate, displayedComponents: .date).labelsHidden() }
            evFormField("Start time") { DatePicker("", selection: $startTime, displayedComponents: .hourAndMinute).labelsHidden() }
        }
        evFormField("Duration") { durationPicker }
        Text("Events are scheduled in East Africa Time.").font(.nMicro).foregroundStyle(Nuru.muted)

        evFormField("Repeats") {
            Picker("", selection: $freq) {
                Text("Does not repeat").tag("NONE")
                Text("Daily").tag("DAILY")
                Text("Weekly").tag("WEEKLY")
                Text("Monthly").tag("MONTHLY")
            }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
        }
        if freq != "NONE" {
            evFormField("Every") {
                Stepper(value: $interval, in: 1...12) {
                    Text("\(interval) \(intervalUnit)\(interval > 1 ? "s" : "")")
                        .font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                }
            }
            if freq == "WEEKLY" {
                HStack(spacing: 6) {
                    ForEach(0..<7, id: \.self) { i in
                        let active = byDays.contains(i)
                        Button {
                            if byDays.contains(i) { byDays.remove(i) } else { byDays.insert(i) }
                        } label: {
                            Text(["S","M","T","W","T","F","S"][i]).font(.inter(12, .bold))
                                .foregroundStyle(active ? .white : Nuru.ink)
                                .frame(maxWidth: .infinity).padding(.vertical, 9)
                                .background(active ? Nuru.gold : Nuru.inputBg)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                        }.pressable()
                    }
                }
            }
            evFormField("Ends") {
                Picker("", selection: $endKind) {
                    Text("Never").tag("never")
                    Text("On a date").tag("until")
                    Text("After N times").tag("count")
                }.pickerStyle(.segmented)
            }
            if endKind == "until" {
                evFormField("Last date") { DatePicker("", selection: $endUntil, displayedComponents: .date).labelsHidden() }
            } else if endKind == "count" {
                evFormField("Occurrences") {
                    Stepper(value: $endCount, in: 1...200) {
                        Text("\(endCount) occurrences").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                    }
                }
            } else {
                Text("Open-ended series are supported; the server projects them by window.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }

    private var intervalUnit: String {
        switch freq { case "DAILY": "day"; case "WEEKLY": "week"; case "MONTHLY": "month"; default: "time" }
    }

    private var durationPicker: some View {
        Picker("", selection: $durationMin) {
            ForEach(durationOptions, id: \.self) { m in
                Text(m % 60 == 0 ? "\(m / 60) hour\(m > 60 ? "s" : "")" : "\(m / 60)h \(String(format: "%02d", m % 60))m").tag(m)
            }
        }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
    }
    private var durationOptions: [Int] {
        var base = [30, 45, 60, 90, 120, 150, 180, 240, 300]
        if !base.contains(durationMin) { base.append(durationMin); base.sort() }
        return base
    }

    // MARK: Registration & Attendance

    @ViewBuilder private var registrationSection: some View {
        evSectionLabel("Registration & Attendance")
        Toggle(isOn: $rsvpEnabled) { Label("Enable RSVP", systemImage: "person.2").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Toggle(isOn: $qrEnabled) { Label("Enable QR check-in", systemImage: "qrcode").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Toggle(isOn: $manualEnabled) { Label("Allow manual check-in", systemImage: "checkmark.circle").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Toggle(isOn: $remindersEnabled) { Label("Send RSVP reminders", systemImage: "bell").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Toggle(isOn: $checkinOpensEnabled) { Label("Open check-in before start", systemImage: "clock.badge.checkmark").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        if checkinOpensEnabled {
            evFormField("Check-in opens") {
                Stepper(value: $checkinOpensMin, in: 5...240, step: 5) {
                    Text("\(checkinOpensMin) min before start").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                }
            }
        }
    }

    // MARK: Media

    @ViewBuilder private var mediaSection: some View {
        evSectionLabel("Media")
        ImageUploadField(label: "Primary image", folder: "events", url: $primaryImageUrl)
        evFormField("Video URL (optional)") {
            TextField("https://…", text: $videoUrl).textFieldStyle(.plain).font(.inter(13, .regular))
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
        }
    }

    // MARK: Automations (§7 — per-series automation JSONB)

    @ViewBuilder private var automationsSection: some View {
        evSectionLabel("Automations")
        evFormField("Reminder offsets") {
            EvFlexRow(spacing: 6) {
                ForEach([(2880, "2 days"), (1440, "24 h"), (120, "2 h"), (60, "1 h"), (30, "30 min")], id: \.0) { min, label in
                    let on = reminderOffsets.contains(min)
                    Button {
                        if on { reminderOffsets.remove(min) } else { reminderOffsets.insert(min) }
                    } label: {
                        Text(label).font(.inter(12, on ? .bold : .medium))
                            .foregroundStyle(on ? .white : Nuru.ink)
                            .padding(.horizontal, 11).padding(.vertical, 6)
                            .background(on ? Nuru.navy : Nuru.inputBg)
                            .clipShape(Capsule())
                    }.pressable()
                }
            }
        }
        Toggle(isOn: $autoArchiveEnabled) { Label("Auto-archive after the event", systemImage: "archivebox").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        if autoArchiveEnabled {
            evFormField("Archive after") {
                Stepper(value: $autoArchiveDays, in: 1...60) {
                    Text("\(autoArchiveDays) day\(autoArchiveDays > 1 ? "s" : "")").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                }
            }
        }
        Toggle(isOn: $lowRsvpEnabled) { Label("Low-RSVP alert (T-48h)", systemImage: "exclamationmark.bubble").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        if lowRsvpEnabled {
            evFormField("Alert when going under") {
                Stepper(value: $lowRsvpThreshold, in: 1...100) {
                    Text("\(lowRsvpThreshold) going").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                }
            }
        }
        Toggle(isOn: $qrAutoReady) { Label("Arm the QR panel automatically", systemImage: "qrcode.viewfinder").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Text("Automations run on the server (reminders, archiving, alerts). They activate as the automation worker ships — settings are stored with the series.")
            .font(.nMicro).foregroundStyle(Nuru.muted)
    }

    // MARK: Publishing

    @ViewBuilder private var publishingSection: some View {
        evSectionLabel("Publishing")
        Toggle(isOn: $statusDraft) { Label("Keep as draft (hidden from members)", systemImage: "eye.slash").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.warning)
        Toggle(isOn: $showOnHome) { Label("Show on the member Home list", systemImage: "house").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.gold)
        Toggle(isOn: $featured) { Label("Feature on the mobile homepage", systemImage: "star").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.gold)
    }

    // MARK: Prefill

    private func prefillIfNeeded() {
        guard !didPrefill else { return }
        didPrefill = true
        if case .edit(let s, let initialScope, let p) = mode {
            scope = scopeAvailable ? initialScope : .entireSeries
            title = s.title
            descriptionText = s.description ?? ""
            category = .resolve(wire: s.category, title: s.title, cellGroupId: s.cellGroupId)
            location = s.location ?? ""
            visibility = s.visibility ?? "congregation"
            durationMin = s.durationMin ?? 90
            rsvpEnabled = s.rsvpEnabled
            qrEnabled = s.qrEnabled
            manualEnabled = s.manualCheckinEnabled
            remindersEnabled = s.remindersEnabled
            if let m = s.checkinOpensMinBefore, m > 0 { checkinOpensEnabled = true; checkinOpensMin = m }
            primaryImageUrl = s.primaryImageUrl ?? ""
            videoUrl = s.videoUrl ?? ""
            statusDraft = s.status == "draft"
            showOnHome = s.showOnHome
            featured = s.isFeatured
            if let auto = s.automation {
                reminderOffsets = Set(auto.reminderOffsetsMin)
                if let d = auto.autoArchiveDays { autoArchiveEnabled = true; autoArchiveDays = d }
                if let t = auto.lowRsvpThreshold { lowRsvpEnabled = true; lowRsvpThreshold = t }
                qrAutoReady = auto.qrAutoReady
            }
            // Schedule: pivot occurrence (scoped edits) beats the series anchor.
            let anchor = EvDate.parse(p) ?? parseWallClock(s.dtstartLocal)
            if let d = anchor { startDate = d; startTime = d }
            parseRrule(s.rrule)
        }
    }

    private func parseWallClock(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        f.locale = Locale(identifier: "en_US_POSIX")
        return f.date(from: s) ?? EvDate.parse(s)
    }

    private func parseRrule(_ rrule: String?) {
        guard let rrule, !rrule.isEmpty else { freq = "NONE"; return }
        let up = rrule.uppercased()
        func capture(_ pattern: String) -> String? {
            guard let r = up.range(of: pattern, options: .regularExpression) else { return nil }
            return String(up[r]).components(separatedBy: "=").last
        }
        freq = capture("FREQ=[A-Z]+") ?? "WEEKLY"
        if !["DAILY", "WEEKLY", "MONTHLY"].contains(freq) { freq = "WEEKLY" }
        interval = capture("INTERVAL=[0-9]+").flatMap(Int.init) ?? 1
        if let byday = capture("BYDAY=[A-Z,]+") {
            let days = byday.components(separatedBy: ",")
            byDays = Set(days.compactMap { Self.weekdayRrule.firstIndex(of: $0) })
            if byDays.isEmpty { byDays = [0] }
        }
        if let count = capture("COUNT=[0-9]+").flatMap(Int.init) {
            endKind = "count"; endCount = count
        } else if let until = capture("UNTIL=[0-9TZ]+") {
            endKind = "until"
            let f = DateFormatter()
            f.dateFormat = "yyyyMMdd'T'HHmmss'Z'"
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "UTC")
            if let d = f.date(from: until) { endUntil = d }
        } else {
            endKind = "never"
        }
    }

    // MARK: Wire assembly

    private func builtRrule() -> String? {
        guard freq != "NONE" else { return nil }
        var parts = ["FREQ=\(freq)"]
        if interval > 1 { parts.append("INTERVAL=\(interval)") }
        if freq == "WEEKLY" {
            let sel = byDays.sorted().map { Self.weekdayRrule[$0] }
            if !sel.isEmpty { parts.append("BYDAY=\(sel.joined(separator: ","))") }
        }
        switch endKind {
        case "count": parts.append("COUNT=\(endCount)")
        case "until":
            let f = DateFormatter()
            f.dateFormat = "yyyyMMdd'T'235959'Z'"
            f.locale = Locale(identifier: "en_US_POSIX")
            f.timeZone = TimeZone(identifier: "UTC")
            parts.append("UNTIL=\(f.string(from: endUntil))")
        default: break
        }
        return parts.joined(separator: ";")
    }

    private var combinedStart: Date {
        var c = Calendar.current.dateComponents([.year, .month, .day], from: startDate)
        let t = Calendar.current.dateComponents([.hour, .minute], from: startTime)
        c.hour = t.hour; c.minute = t.minute; c.second = 0
        return Calendar.current.date(from: c) ?? startDate
    }
    private var startDateStr: String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: startDate)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    private var startTimeStr: String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: startTime)
        return String(format: "%02d:%02d", c.hour ?? 9, c.minute ?? 0)
    }

    private func seriesBody() -> [String: EJSON] {
        var auto = EvAutomation()
        auto.reminderOffsetsMin = reminderOffsets.sorted(by: >)
        auto.autoArchiveDays = autoArchiveEnabled ? autoArchiveDays : nil
        auto.lowRsvpThreshold = lowRsvpEnabled ? lowRsvpThreshold : nil
        auto.qrAutoReady = qrAutoReady

        var body: [String: EJSON] = [
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "category": .string(category.apiKey),
            "timezone": .string("Africa/Nairobi"),
            "start_date": .string(startDateStr),
            "start_time": .string(startTimeStr),
            "starts_at": .string(EvDate.iso.string(from: combinedStart)),
            "duration_min": .int(durationMin),
            "visibility": .string(visibility),
            "rsvp_enabled": .bool(rsvpEnabled),
            "qr_enabled": .bool(qrEnabled),
            "manual_checkin_enabled": .bool(manualEnabled),
            "reminders_enabled": .bool(remindersEnabled),
            "status": .string(statusDraft ? "draft" : "active"),
            "automation": auto.body,
        ]
        body["checkin_opens_min_before"] = checkinOpensEnabled ? .int(checkinOpensMin) : .null
        let desc = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        if !desc.isEmpty { body["description"] = .string(desc) }
        let loc = location.trimmingCharacters(in: .whitespaces)
        if !loc.isEmpty { body["location"] = .string(loc) }
        let img = primaryImageUrl.trimmingCharacters(in: .whitespaces)
        if !img.isEmpty { body["primary_image_url"] = .string(img) }
        let vid = videoUrl.trimmingCharacters(in: .whitespaces)
        if !vid.isEmpty { body["video_url"] = .string(vid) }
        if let r = builtRrule() { body["rrule"] = .string(r) }
        return body
    }

    // MARK: Submit

    private func submit() async {
        err = nil
        if scope == .onlyThis, isEdit { await submitException(); return }
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty else { err = "Event title is required."; return }
        busy = true; defer { busy = false }
        let body = seriesBody()
        do {
            switch mode {
            case .create:
                let created = try await PortalAPI.createEventSeries(body)
                await applyPublishFlags(seriesId: created.seriesId, oldHome: false, oldFeatured: false)
                onSaved(statusDraft ? "Event saved as draft." : "Event created.")
            case .edit(let s, _, let p):
                if scope == .thisAndFollowing, let pivot = p {
                    try await PortalAPI.splitEventSeries(s.seriesId, pivotStartAt: pivot, changes: body)
                    await applyPublishFlags(seriesId: s.seriesId, oldHome: s.showOnHome, oldFeatured: s.isFeatured)
                    onSaved("Series split — changes apply from this occurrence onward.")
                } else {
                    try await PortalAPI.updateEventSeries(s.seriesId, body)
                    await applyPublishFlags(seriesId: s.seriesId, oldHome: s.showOnHome, oldFeatured: s.isFeatured)
                    onSaved("Event updated.")
                }
            }
        } catch {
            let msg = (error as? APIError)?.errorDescription ?? (isEdit ? "Could not update event." : "Could not create event.")
            err = msg; onError(msg)
        }
    }

    private func submitException() async {
        guard let s = editSeries, let pivot else { return }
        busy = true; defer { busy = false }
        let start = combinedStart
        let end = start.addingTimeInterval(TimeInterval(durationMin * 60))
        var body: [String: EJSON] = [
            "original_start_at": .string(pivot),
            "is_cancelled": .bool(false),
            "new_start_at": .string(EvDate.iso.string(from: start)),
            "new_end_at": .string(EvDate.iso.string(from: end)),
        ]
        let n = occurrenceNote.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty { body["note"] = .string(n) }
        do {
            try await PortalAPI.addSeriesException(s.seriesId, body)
            onSaved("Occurrence rescheduled — RSVP'd members are notified.")
        } catch {
            let msg = (error as? APIError)?.errorDescription ?? "Could not reschedule the occurrence."
            err = msg; onError(msg)
        }
    }

    /// Show-on-home / featured are separate endpoints — apply only deltas.
    private func applyPublishFlags(seriesId: String, oldHome: Bool, oldFeatured: Bool) async {
        guard !seriesId.isEmpty else { return }
        if showOnHome != oldHome { try? await PortalAPI.setSeriesShowOnHome(seriesId, showOnHome) }
        if featured != oldFeatured { try? await PortalAPI.setSeriesFeatured(seriesId, featured) }
    }
}
