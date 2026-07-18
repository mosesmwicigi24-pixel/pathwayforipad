// Announcements Studio — composer + detail for the §5 first-class lifecycle
// (EVENTS_ARCHITECTURE.md): EDIT support (PUT — was missing natively), real
// audience pickers (cells multi-select, level — not stubbed to "all"), a real
// schedule input (scheduled_at is live server-side), the event/series/standalone
// attachment selector, an HONEST channel picker (SMS/WhatsApp greyed "awaiting
// provider" — no fictional sends), duplicate / archive / restore, and per-channel
// stats with suppress reasons. Sent announcements are immutable history — the
// composer refuses them and offers Duplicate instead.
import SwiftUI

// MARK: - Composer (create + edit)

struct AnnouncementComposerView: View {
    var editing: AnnouncementRow? = nil
    var seriesOptions: [AdminSeriesRow] = []
    var occurrenceOptions: [EvOcc] = []
    var prefillSeriesId: String? = nil
    var onSaved: (String) -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private var isEdit: Bool { editing != nil }

    @State private var title = ""
    @State private var message = ""
    @State private var channels: Set<String> = ["push", "banner"]
    @State private var audienceKind = "all"
    @State private var selectedCells: Set<String> = []
    @State private var levelNumber = 1
    @State private var cellOptions: [EngagementCellRow] = []
    @State private var cellsLoadFailed = false

    // Schedule
    @State private var scheduleEnabled = false
    @State private var scheduleAt = Calendar.current.date(byAdding: .hour, value: 1, to: Date()) ?? Date()
    @State private var bannerExpiryEnabled = false
    @State private var bannerExpiresAt = Calendar.current.date(byAdding: .day, value: 7, to: Date()) ?? Date()

    // Attachment (§5 three modes)
    @State private var attachment = "standalone"   // standalone | event | series
    @State private var attachedOccurrenceId = ""
    @State private var attachedSeriesId = ""

    @State private var primaryImageUrl = ""
    @State private var featured = false
    @State private var busy = false
    @State private var err: String?
    @State private var didPrefill = false

    /// Channels with a real provider today. SMS/WhatsApp have none (§5 "channel
    /// honesty") — they render greyed and unselectable, never fake-delivered.
    private static let liveChannels: [(String, String, String)] = [
        ("push", "App push", "iphone"),
        ("email", "Email", "envelope"),
        ("banner", "Banner", "megaphone"),
    ]
    private static let deadChannels: [(String, String, String)] = [
        ("sms", "SMS", "phone"),
        ("whatsapp", "WhatsApp", "message"),
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let e = editing, e.status == "sent" || e.status == "cancelled" {
                        immutableNotice(e)
                    } else {
                        messageSection
                        channelsSection
                        audienceSection
                        scheduleSection
                        attachmentSection
                        mediaSection
                        preview
                        if let err { Text(err).font(.nCaption).foregroundStyle(Nuru.danger) }
                    }
                }
                .padding(24)
                .frame(maxWidth: 820)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .scrollContentBackground(.hidden)
            .navigationTitle(isEdit ? "Edit announcement" : "New announcement")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { prefillIfNeeded() }
            .task { await loadCells() }
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if editing?.status != "sent" && editing?.status != "cancelled" {
                        Button { Task { await submit() } } label: {
                            Group { if busy { ProgressView() } else { Text("Save").bold() } }
                                .font(.inter(14, .semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 14).padding(.vertical, 8)
                                .background(busy ? AnyShapeStyle(Nuru.muted) : AnyShapeStyle(Nuru.goldGradient))
                                .clipShape(Capsule())
                        }.disabled(busy)
                    }
                }
            }
        }
        .presentationDetents([.large])
    }

    private func immutableNotice(_ e: AnnouncementRow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "lock.fill").foregroundStyle(Nuru.muted)
                Text("Sent announcements are immutable history").font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
            }
            Text("\"\(e.title)\" was already \(e.status). Duplicate it to send an updated version.")
                .font(.nCaption).foregroundStyle(Nuru.muted)
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    // MARK: Sections

    @ViewBuilder private var messageSection: some View {
        evSectionLabel("Message")
        evFormField("Title") {
            TextField("Sunday Service Reminder", text: $title).textFieldStyle(.plain).font(.inter(13, .regular))
        }
        evFormField("Body") {
            TextField("Tomorrow we gather for worship at 9:00 AM…", text: $message, axis: .vertical)
                .lineLimit(3...8).textFieldStyle(.plain).font(.inter(13, .regular))
        }
    }

    @ViewBuilder private var channelsSection: some View {
        evSectionLabel("Channels")
        EvFlexRow(spacing: 8) {
            ForEach(Self.liveChannels, id: \.0) { key, label, icon in
                let on = channels.contains(key)
                Button {
                    if on { channels.remove(key) } else { channels.insert(key) }
                } label: {
                    Label(label, systemImage: icon).font(.inter(12, on ? .bold : .medium))
                        .foregroundStyle(on ? .white : Nuru.ink)
                        .padding(.horizontal, 12).padding(.vertical, 8)
                        .background(on ? Nuru.navy : Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                }.pressable()
            }
            ForEach(Self.deadChannels, id: \.0) { _, label, icon in
                HStack(spacing: 6) {
                    Label(label, systemImage: icon).font(.inter(12, .medium))
                    Text("AWAITING PROVIDER").font(.system(size: 8, weight: .bold)).tracking(0.4)
                        .padding(.horizontal, 5).padding(.vertical, 2)
                        .background(Nuru.inputBg).clipShape(Capsule())
                }
                .foregroundStyle(Nuru.ink400)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(Nuru.inputBg.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous)
                    .stroke(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
        }
        Text("SMS and WhatsApp have no delivery provider yet, so they can't be selected — nothing is fake-sent.")
            .font(.nMicro).foregroundStyle(Nuru.muted)
    }

    @ViewBuilder private var audienceSection: some View {
        evSectionLabel("Audience")
        Picker("", selection: $audienceKind) {
            Text("All members").tag("all")
            Text("Specific cells").tag("cells")
            Text("Specific level").tag("level")
        }.pickerStyle(.segmented)
        if audienceKind == "cells" {
            if cellOptions.isEmpty && cellsLoadFailed {
                Text("Couldn't load the cell list — pull to retry or pick another audience.")
                    .font(.nCaption).foregroundStyle(Nuru.warning)
            } else if cellOptions.isEmpty {
                HStack { ProgressView().controlSize(.small); Text("Loading cells…").font(.nCaption).foregroundStyle(Nuru.muted) }
            } else {
                EvFlexRow(spacing: 6) {
                    ForEach(cellOptions) { cell in
                        let on = selectedCells.contains(cell.cellGroupId)
                        Button {
                            if on { selectedCells.remove(cell.cellGroupId) } else { selectedCells.insert(cell.cellGroupId) }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                                    .font(.system(size: 11, weight: .semibold))
                                Text(cell.name).font(.inter(12, on ? .bold : .medium))
                            }
                            .foregroundStyle(on ? .white : Nuru.ink)
                            .padding(.horizontal, 11).padding(.vertical, 7)
                            .background(on ? Nuru.gold : Nuru.inputBg)
                            .clipShape(Capsule())
                        }.pressable()
                    }
                }
                Text("\(selectedCells.count) selected").font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
            }
        } else if audienceKind == "level" {
            evFormField("Level") {
                Stepper(value: $levelNumber, in: 1...10) {
                    Text("Level \(levelNumber)").font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                }
            }
        }
    }

    @ViewBuilder private var scheduleSection: some View {
        evSectionLabel("Schedule")
        Toggle(isOn: $scheduleEnabled) {
            Label("Schedule for later", systemImage: "calendar.badge.clock")
                .font(.inter(14, .medium)).foregroundStyle(Nuru.ink)
        }.tint(Nuru.lumGreen)
        if scheduleEnabled {
            evFormField("Send at") {
                DatePicker("", selection: $scheduleAt, in: Date()..., displayedComponents: [.date, .hourAndMinute]).labelsHidden()
            }
            Text("The worker dispatches it at this time; saving without a schedule keeps it a draft until \"Send now\".")
                .font(.nMicro).foregroundStyle(Nuru.muted)
        }
        if channels.contains("banner") {
            Toggle(isOn: $bannerExpiryEnabled) {
                Label("Banner expires", systemImage: "hourglass")
                    .font(.inter(14, .medium)).foregroundStyle(Nuru.ink)
            }.tint(Nuru.lumGreen)
            if bannerExpiryEnabled {
                evFormField("Banner shows until") {
                    DatePicker("", selection: $bannerExpiresAt, in: Date()..., displayedComponents: [.date, .hourAndMinute]).labelsHidden()
                }
            }
        }
    }

    @ViewBuilder private var attachmentSection: some View {
        evSectionLabel("Attachment")
        Picker("", selection: $attachment) {
            Text("Standalone").tag("standalone")
            Text("An occurrence").tag("event")
            Text("A series").tag("series")
        }.pickerStyle(.segmented)
        if attachment == "event" {
            if occurrenceOptions.isEmpty {
                Text("No upcoming occurrences loaded to attach to.").font(.nCaption).foregroundStyle(Nuru.muted)
            } else {
                evFormField("Occurrence") {
                    Picker("", selection: $attachedOccurrenceId) {
                        Text("Choose…").tag("")
                        ForEach(occurrenceOptions) { o in
                            Text("\(o.title) · \(o.dateLong)").tag(o.id)
                        }
                    }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
                }
            }
        } else if attachment == "series" {
            if seriesOptions.isEmpty {
                Text("No series loaded to attach to.").font(.nCaption).foregroundStyle(Nuru.muted)
            } else {
                evFormField("Series") {
                    Picker("", selection: $attachedSeriesId) {
                        Text("Choose…").tag("")
                        ForEach(seriesOptions) { s in
                            Text(s.title).tag(s.seriesId)
                        }
                    }.pickerStyle(.menu).labelsHidden().tint(Nuru.ink)
                }
            }
        }
        if attachment != "standalone" {
            Text("Attached announcements surface in that event's command center. Sending is unchanged.")
                .font(.nMicro).foregroundStyle(Nuru.muted)
        }
    }

    @ViewBuilder private var mediaSection: some View {
        evSectionLabel("Image")
        ImageUploadField(label: "Primary image", folder: "announcements", url: $primaryImageUrl)
        Toggle(isOn: $featured) {
            Label("Feature on the mobile homepage", systemImage: "star").font(.inter(13, .regular))
        }.tint(Nuru.gold)
    }

    private var preview: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("NURU CHURCH · PUSH NOTIFICATION").font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.onNavyDim)
            Text(title.isEmpty ? "Announcement title" : title).font(.inter(14, .bold)).foregroundStyle(.white)
            Text(message.isEmpty ? "Your message preview appears here." : message).font(.nCaption).foregroundStyle(Nuru.onNavyDim).lineLimit(4)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(16)
        .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    // MARK: Data

    private func loadCells() async {
        guard cellOptions.isEmpty else { return }
        do {
            cellOptions = try await PortalAPI.engagement().cells
            cellsLoadFailed = false
        } catch {
            cellsLoadFailed = true
        }
    }

    private func prefillIfNeeded() {
        guard !didPrefill else { return }
        didPrefill = true
        if let s = prefillSeriesId, !s.isEmpty {
            attachment = "series"
            attachedSeriesId = s
        }
        guard let e = editing else { return }
        title = e.title
        message = e.body
        channels = Set(e.channels).intersection(["push", "email", "banner"])
        if channels.isEmpty { channels = ["push", "banner"] }
        audienceKind = e.audienceKind
        selectedCells = Set(e.audienceCells)
        if let l = e.audienceLevel { levelNumber = l }
        if let sch = EvDate.parse(e.scheduledAt), e.status == "scheduled" {
            scheduleEnabled = true; scheduleAt = sch
        }
        if let exp = EvDate.parse(e.bannerExpiresAt) {
            bannerExpiryEnabled = true; bannerExpiresAt = exp
        }
        primaryImageUrl = e.primaryImageUrl ?? ""
        featured = e.isFeatured
        if let occ = e.eventOccurrenceId, !occ.isEmpty { attachment = "event"; attachedOccurrenceId = occ }
        else if let ser = e.seriesId, !ser.isEmpty { attachment = "series"; attachedSeriesId = ser }
    }

    // MARK: Submit

    private func audiencePayload() -> EJSON {
        switch audienceKind {
        case "cells":
            return .object(["kind": .string("cells"),
                            "cell_group_ids": .array(selectedCells.sorted().map { .string($0) })])
        case "level":
            return .object(["kind": .string("level"), "level_number": .int(levelNumber)])
        default:
            return .object(["kind": .string("all")])
        }
    }

    private func submit() async {
        err = nil
        guard !title.trimmingCharacters(in: .whitespaces).isEmpty,
              !message.trimmingCharacters(in: .whitespaces).isEmpty else {
            err = "Announcement title and body are required."; return
        }
        guard !channels.isEmpty else { err = "Pick at least one channel."; return }
        if audienceKind == "cells" && selectedCells.isEmpty { err = "Pick at least one cell."; return }

        var payload: [String: EJSON] = [
            "title": .string(title.trimmingCharacters(in: .whitespaces)),
            "body": .string(message.trimmingCharacters(in: .whitespacesAndNewlines)),
            "channels": .array(channels.sorted().map { .string($0) }),
            "audience": audiencePayload(),
        ]
        if scheduleEnabled { payload["scheduled_at"] = .string(EvDate.iso.string(from: scheduleAt)) }
        if bannerExpiryEnabled && channels.contains("banner") {
            payload["banner_expires_at"] = .string(EvDate.iso.string(from: bannerExpiresAt))
        }
        let img = primaryImageUrl.trimmingCharacters(in: .whitespaces)
        if !img.isEmpty { payload["primary_image_url"] = .string(img) }
        // §5 attachment keys — sent only when a mode is chosen; on a server
        // without the columns the strict schema rejects them, so the error
        // surfaces honestly instead of silently dropping the link.
        if attachment == "event", !attachedOccurrenceId.isEmpty {
            payload["event_occurrence_id"] = .string(attachedOccurrenceId)
        } else if attachment == "series", !attachedSeriesId.isEmpty {
            payload["series_id"] = .string(attachedSeriesId)
        }

        busy = true; defer { busy = false }
        do {
            if let e = editing {
                try await PortalAPI.updateAnnouncement(e.announcementId, payload)
                if featured != e.isFeatured { try? await PortalAPI.setAnnouncementFeatured(e.announcementId, featured) }
                onSaved(scheduleEnabled ? "Announcement rescheduled." : "Announcement updated.")
            } else {
                let created = try await PortalAPI.createAnnouncement(payload)
                if featured, !created.announcementId.isEmpty {
                    try? await PortalAPI.setAnnouncementFeatured(created.announcementId, true)
                }
                onSaved(scheduleEnabled ? "Announcement scheduled." : "Announcement saved as draft.")
            }
        } catch {
            let msg = (error as? APIError)?.errorDescription ?? "Could not save announcement."
            err = msg; onError(msg)
        }
    }
}

// MARK: - Detail sheet (per-channel truth + lifecycle actions)

struct AnnouncementDetailSheet: View {
    let item: AnnouncementRow
    var onEdit: (AnnouncementRow) -> Void
    var onChanged: (String) -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var stats: [EvChannelStat] = []
    @State private var statsLoaded = false
    @State private var busy = false
    @State private var confirmDelete = false
    @State private var confirmSend = false

    private var canEdit: Bool { (item.status == "draft" || item.status == "scheduled") && !item.isArchived }
    private var canSend: Bool { canEdit }
    private var canCancel: Bool { item.status == "scheduled" }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    Text(item.body).font(.nBody).foregroundStyle(Nuru.ink)
                        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
                    fieldsGrid
                    deliverySection
                    actions
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Announcement").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .alert("Send announcement now?", isPresented: $confirmSend) {
                Button("Cancel", role: .cancel) {}
                Button("Send") { Task { await send() } }
            } message: { Text("This dispatches to all selected channels immediately.") }
            .alert("Delete announcement?", isPresented: $confirmDelete) {
                Button("Cancel", role: .cancel) {}
                Button("Delete", role: .destructive) { Task { await remove() } }
            } message: { Text("This cannot be undone. Archive keeps history instead.") }
            .task {
                if let d = try? await PortalAPI.announcementDetail(item.announcementId) { stats = d.stats }
                statsLoaded = true
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("ANNOUNCEMENT").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                Spacer()
                if item.isFeatured { Label("Featured", systemImage: "star.fill").font(.nMicro).foregroundStyle(Nuru.goldLo) }
                EvStatusBadge(status: evAnnouncementStatusLabel(item))
            }
            Text(item.title).font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
            if let att = item.attachmentLabel {
                Label("Attached to: \(att)", systemImage: "link").font(.nMicro).foregroundStyle(Nuru.goldChipText)
            }
        }
    }

    private var fieldsGrid: some View {
        let cols = [GridItem(.flexible()), GridItem(.flexible())]
        return LazyVGrid(columns: cols, spacing: 12) {
            detailField("Audience", evAudienceLabel(item))
            detailField("Channels", item.channels.joined(separator: ", "))
            detailField("Send time", whenText, mono: true)
            detailField("Banner expires", item.bannerExpiresAt.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated).hour().minute()) } ?? "—", mono: true)
        }
    }

    @ViewBuilder private var deliverySection: some View {
        Text("DELIVERY — PER CHANNEL").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.muted)
        if stats.isEmpty {
            Text(statsLoaded ? (item.status == "sent" ? "No delivery rows recorded." : "Delivery stats appear once the announcement is sent.")
                             : "Loading delivery stats…")
                .font(.nCaption).foregroundStyle(Nuru.muted)
        } else {
            ForEach(stats) { s in channelStatRow(s) }
            Text("Only measured numbers are shown — opened counts come from banner taps; channels without a provider record suppressions, not deliveries.")
                .font(.nMicro).foregroundStyle(Nuru.muted)
        }
    }

    private func channelStatRow(_ s: EvChannelStat) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(s.channel).font(.inter(12, .bold)).foregroundStyle(Nuru.ink)
                Spacer()
                Text("\(s.delivered)/\(s.targeted) delivered")
                    .font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
            }
            HStack(spacing: 8) {
                if s.opened > 0 {
                    statPill("\(s.opened) opened", Color(hex: 0x15803D))
                }
                if s.suppressed > 0 {
                    statPill("\(s.suppressed) suppressed", Color(hex: 0xA87616))
                }
                if s.failed > 0 {
                    statPill("\(s.failed) failed", Color(hex: 0xB91C1C))
                }
                ForEach(Array(s.suppressReasons.keys.sorted()), id: \.self) { reason in
                    statPill("\(suppressReasonLabel(reason)) ×\(s.suppressReasons[reason] ?? 0)", Nuru.ink600)
                }
                Spacer()
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    private func statPill(_ text: String, _ color: Color) -> some View {
        Text(text).font(.system(size: 10.5, weight: .bold)).foregroundStyle(color)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.12)).clipShape(Capsule())
    }

    private func suppressReasonLabel(_ reason: String) -> String {
        switch reason {
        case "no_provider": return "No provider"
        case "quiet_hours": return "Quiet hours"
        case "daily_cap": return "Daily cap"
        case "no_phone": return "No phone number"
        case "no_email": return "No email"
        default: return reason.replacingOccurrences(of: "_", with: " ")
        }
    }

    private var actions: some View {
        EvFlexRow(spacing: 8) {
            if canEdit {
                actionChip("Edit", "pencil", fg: .white, bg: Nuru.navy) { dismiss(); onEdit(item) }
            }
            if canSend {
                actionChip("Send now", "paperplane.fill", fg: .white, bg: Nuru.gold) { confirmSend = true }
            }
            if canCancel {
                actionChip("Cancel scheduled send", "xmark", fg: Color(hex: 0xB91C1C), bg: Color(hex: 0xFEE2E2)) { Task { await cancelScheduled() } }
            }
            actionChip("Duplicate", "doc.on.doc", fg: Nuru.ink, bg: Nuru.inputBg) { Task { await duplicate() } }
            if item.isArchived {
                actionChip("Restore", "arrow.uturn.backward", fg: Nuru.ink, bg: Nuru.inputBg) { Task { await restore() } }
            } else {
                actionChip("Archive", "archivebox", fg: Nuru.ink, bg: Nuru.inputBg) { Task { await archive() } }
            }
            if item.status == "sent" {
                actionChip(item.isFeatured ? "Unfeature" : "Feature", "star", fg: Nuru.goldChipText, bg: Nuru.goldChipBg) { Task { await toggleFeature() } }
            }
            actionChip("Delete", "trash", fg: Color(hex: 0xB91C1C), bg: Color(hex: 0xFEE2E2)) { confirmDelete = true }
        }
    }

    private func actionChip(_ label: String, _ icon: String, fg: Color, bg: Color, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(label, systemImage: icon).font(.inter(12, .semibold)).foregroundStyle(fg)
                .padding(.horizontal, 14).padding(.vertical, 9)
                .background(bg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        }.pressable().disabled(busy)
    }

    private var whenText: String {
        let iso = item.sentAt ?? item.scheduledAt
        return iso.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated).year().hour().minute()) } ?? "—"
    }

    private func detailField(_ label: String, _ value: String, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
            Text(value.isEmpty ? "—" : value).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).monospaced(mono)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Actions

    private func send() async {
        busy = true; defer { busy = false }
        do { try await PortalAPI.sendAnnouncement(item.announcementId); onChanged("Announcement sent.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Could not send announcement.") }
    }
    private func cancelScheduled() async {
        busy = true; defer { busy = false }
        do { try await PortalAPI.cancelAnnouncement(item.announcementId); onChanged("Scheduled send cancelled.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Could not cancel announcement.") }
    }
    private func duplicate() async {
        busy = true; defer { busy = false }
        do { _ = try await PortalAPI.duplicateAnnouncement(item.announcementId); onChanged("Draft copy created.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Duplicate needs the updated server.") }
    }
    private func archive() async {
        busy = true; defer { busy = false }
        do { try await PortalAPI.archiveAnnouncement(item.announcementId); onChanged("Archived.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Archive needs the updated server.") }
    }
    private func restore() async {
        busy = true; defer { busy = false }
        do { try await PortalAPI.restoreAnnouncement(item.announcementId); onChanged("Restored.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Restore needs the updated server.") }
    }
    private func toggleFeature() async {
        busy = true; defer { busy = false }
        do {
            try await PortalAPI.setAnnouncementFeatured(item.announcementId, !item.isFeatured)
            onChanged(item.isFeatured ? "Unfeatured." : "Featured on the mobile homepage.")
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Could not update the feature flag.")
        }
    }
    private func remove() async {
        busy = true; defer { busy = false }
        do { try await PortalAPI.deleteAnnouncement(item.announcementId); onChanged("Announcement deleted.") }
        catch { onError((error as? APIError)?.errorDescription ?? "Could not delete announcement.") }
    }
}
