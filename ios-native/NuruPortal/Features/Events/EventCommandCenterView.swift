// Event Command Center — one series (and a focus occurrence) in full, replacing
// the old cramped detail sheet (EVENTS_ARCHITECTURE.md §9): hero with cover /
// status / venue (Maps link), the attendance block, a REAL QR panel driven by
// GET /admin/events/{id}/qr (members can actually scan it — the fake
// client-generated NURU token is gone), linked announcements, the audit
// timeline, and quick actions: edit (scoped), reschedule occurrence (the
// exceptions new_start_at path), cancel occurrence, split "this and following",
// pause/resume, delete, CSV export via the share sheet.
import SwiftUI

struct EventCommandCenterView: View {
    let seed: AdminSeriesRow
    let focus: EvOcc?
    var onChanged: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var detail: AdminSeriesDetail?
    @State private var detailFailed = false
    @State private var timeline: [EvTimelineEntry]?
    @State private var timelineFailed = false
    @State private var roster: EvRoster?
    @State private var rsvps: EvRsvpRoster?
    @State private var toast: ToastData?

    // QR
    @State private var qr: EventQr?
    @State private var qrFailed: String?
    @State private var qrLoading = false

    // Presentation
    @State private var showEditor = false
    @State private var editorScope: EventEditorView.Scope = .entireSeries
    @State private var showReschedule = false
    @State private var showRsvps = false
    @State private var showRoster = false
    @State private var showManualCheckin = false
    @State private var showComposer = false
    @State private var confirmCancelOcc = false
    @State private var confirmDelete = false
    @State private var busyAction: String?
    @State private var csvDoc: EvCsvDoc?

    // Local state the actions mutate optimistically.
    @State private var isPaused: Bool
    @State private var showOnHome: Bool
    @State private var isFeatured: Bool

    init(seed: AdminSeriesRow, focus: EvOcc?, onChanged: @escaping () -> Void) {
        self.seed = seed
        self.focus = focus
        self.onChanged = onChanged
        _isPaused = State(initialValue: seed.isPaused)
        _showOnHome = State(initialValue: seed.showOnHome)
        _isFeatured = State(initialValue: seed.isFeatured)
    }

    /// Best current series row: server detail when loaded, else the seed.
    private var series: AdminSeriesRow { detail?.series ?? seed }
    private var category: EvCategory {
        .resolve(wire: series.category, title: series.title, cellGroupId: series.cellGroupId)
    }
    /// The occurrence the QR / roster zones operate on.
    private var focusEventId: String? {
        focus?.id ?? detail?.nextOccurrences.first?.eventId ?? series.nextOccurrenceId
    }
    private var focusStartAt: String? {
        focus?.startAt ?? detail?.nextOccurrences.first?.startAt ?? series.nextAt
    }
    private var focusOriginalStartAt: String? {
        focus?.originalStartAt ?? detail?.nextOccurrences.first?.startAt ?? series.nextAt
    }
    private var isRecurring: Bool { !(series.rrule ?? "").isEmpty }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                heroCard
                if MacDesign.isMac {
                    HStack(alignment: .top, spacing: MacDesign.gutter) {
                        VStack(spacing: 20) { attendanceCard; announcementsCard; timelineCard }
                            .frame(maxWidth: .infinity, alignment: .top)
                        VStack(spacing: 20) { qrCard; actionsCard }
                            .frame(width: 420, alignment: .top)
                    }
                } else {
                    attendanceCard
                    qrCard
                    announcementsCard
                    timelineCard
                    actionsCard
                }
            }
            .padding(24)
            .macContentColumn(MacDesign.workspaceMaxWidth)
        }
        .background(Nuru.paper)
        .navigationTitle(series.title)
        .navigationBarTitleDisplayMode(.inline)
        .toast($toast)
        .task { await loadAll() }
        .refreshable { await loadAll() }
        .sheet(isPresented: $showEditor) {
            EventEditorView(mode: .edit(series: series, scope: editorScope, pivot: focusOriginalStartAt),
                            onSaved: { msg in showEditor = false; toast = .success(msg); Task { await loadAll() }; onChanged() },
                            onError: { msg in toast = .error(msg) })
        }
        .sheet(isPresented: $showReschedule) {
            EvRescheduleSheet(seriesId: series.seriesId,
                              occurrenceTitle: series.title,
                              originalStartAt: focusOriginalStartAt ?? "",
                              currentStart: EvDate.parse(focusStartAt),
                              durationMin: series.durationMin ?? 90,
                              onDone: { showReschedule = false; toast = .success("Occurrence rescheduled — RSVP'd members are notified."); Task { await loadAll() }; onChanged() },
                              onError: { msg in toast = .error(msg) })
        }
        .sheet(isPresented: $showRsvps) { EvRsvpSheet(title: series.title, roster: rsvps) }
        .sheet(isPresented: $showRoster) {
            EvRosterSheet(title: series.title, roster: roster,
                          onManualCheckIn: { showRoster = false; showManualCheckin = true })
        }
        .sheet(isPresented: $showManualCheckin) {
            if let id = focusEventId {
                EvManualCheckinSheet(eventId: id, title: series.title,
                                     onDone: { name in showManualCheckin = false; toast = .success("\(name) checked in."); Task { await loadRoster(force: true) } },
                                     onError: { msg in toast = .error(msg) })
            }
        }
        .sheet(isPresented: $showComposer) {
            AnnouncementComposerView(editing: nil,
                                     seriesOptions: [series],
                                     occurrenceOptions: focus.map { [$0] } ?? [],
                                     prefillSeriesId: series.seriesId,
                                     onSaved: { msg in showComposer = false; toast = .success(msg); Task { await loadAll() } },
                                     onError: { msg in toast = .error(msg) })
        }
        .sheet(item: $csvDoc) { doc in EvCsvShareSheet(doc: doc) }
        .alert("Cancel this occurrence?", isPresented: $confirmCancelOcc) {
            Button("Cancel occurrence", role: .destructive) { Task { await cancelOccurrence() } }
            Button("Keep", role: .cancel) {}
        } message: { Text("Drops just this date from the series. RSVP'd members are notified.") }
        .alert("Delete this event series?", isPresented: $confirmDelete) {
            Button("Delete series", role: .destructive) { Task { await deleteSeries() } }
            Button("Keep", role: .cancel) {}
        } message: { Text("This cannot be undone. All occurrences of this series will be removed.") }
    }

    // MARK: Loading

    private func loadAll() async {
        async let d: Void = loadDetail()
        async let t: Void = loadTimeline()
        async let r: Void = loadRoster(force: true)
        async let v: Void = loadRsvps()
        _ = await (d, t, r, v)
        await loadQr()
    }
    private func loadDetail() async {
        guard !series.seriesId.isEmpty else { return }
        do {
            detail = try await PortalAPI.adminSeriesDetail(seed.seriesId)
            detailFailed = false
            if let s = detail?.series {
                isPaused = s.isPaused
                showOnHome = s.showOnHome
                isFeatured = s.isFeatured
            }
        } catch {
            detailFailed = detail == nil
        }
    }
    private func loadTimeline() async {
        do {
            timeline = try await PortalAPI.adminSeriesTimeline(seed.seriesId)
            timelineFailed = false
        } catch {
            timelineFailed = timeline == nil
        }
    }
    private func loadRoster(force: Bool) async {
        guard let id = focusEventId else { return }
        if !force, roster != nil { return }
        roster = try? await PortalAPI.eventRoster(id)
    }
    private func loadRsvps() async {
        guard let id = focusEventId else { return }
        rsvps = try? await PortalAPI.eventRsvps(id)
    }
    private func loadQr() async {
        guard let id = focusEventId else { qrFailed = "No occurrence to check in to yet."; return }
        guard series.qrEnabled else { qrFailed = nil; return }
        qrLoading = true
        defer { qrLoading = false }
        do {
            qr = try await PortalAPI.eventQr(id)
            qrFailed = nil
        } catch {
            qr = nil
            qrFailed = (error as? APIError)?.errorDescription ?? "Live QR unavailable."
        }
    }

    // MARK: Hero

    private var heroCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                if let img = series.primaryImageUrl, let url = URL(string: img) {
                    CachedAsyncImage(url: url) { i in i.resizable().scaledToFill() } placeholder: { category.soft }
                        .frame(height: 160).frame(maxWidth: .infinity)
                        .clipped()
                }
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 8) {
                        Text(category.label.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(category.color)
                        if isPaused { EvStatusBadge(status: "paused") }
                        else if series.status == "draft" { EvStatusBadge(status: "draft") }
                        else { EvStatusBadge(status: "active") }
                        if focus?.rescheduled == true { EvStatusBadge(status: "rescheduled") }
                        if series.derived {
                            Text("PARTIAL DATA").font(.system(size: 9, weight: .bold)).tracking(0.4)
                                .foregroundStyle(Nuru.ink400)
                                .padding(.horizontal, 8).padding(.vertical, 2)
                                .background(Nuru.inputBg).clipShape(Capsule())
                        }
                        Spacer()
                        if showOnHome { Label("On Home", systemImage: "house.fill").font(.nMicro).foregroundStyle(Nuru.goldLo) }
                        if isFeatured { Label("Featured", systemImage: "star.fill").font(.nMicro).foregroundStyle(Nuru.goldLo) }
                    }
                    Text(series.title).font(.fraunces(26, .medium)).foregroundStyle(Nuru.ink)
                    VStack(alignment: .leading, spacing: 6) {
                        if let f = focus {
                            Label("\(f.dateLong) · \(f.timeShort) – \(f.endTime) · \(f.duration)", systemImage: "clock")
                        } else if let next = series.nextAt {
                            Label("Next \(EvDate.short(next)) · \(EvDate.time(next))", systemImage: "clock")
                        } else {
                            Label("No upcoming occurrence in the loaded window", systemImage: "clock")
                        }
                        if let cad = series.cadence { Label(cad, systemImage: "repeat") }
                        else if isRecurring { Label("Recurring series", systemImage: "repeat") }
                        HStack(spacing: 8) {
                            Label(venue, systemImage: "mappin.and.ellipse")
                            if let mapsUrl {
                                Link(destination: mapsUrl) {
                                    Label("Maps", systemImage: "arrow.up.right.square")
                                        .font(.nMicro).foregroundStyle(Nuru.info)
                                }
                            }
                        }
                        Label("Visibility: \(series.visibility ?? "congregation")", systemImage: "eye")
                    }.font(.nCaption).foregroundStyle(Nuru.muted)

                    EvFlexRow(spacing: 8) {
                        heroAction("Edit", "pencil", gold: true) { editorScope = .entireSeries; showEditor = true }
                        heroAction(isPaused ? "Resume" : "Pause", isPaused ? "play.fill" : "pause.fill") { Task { await togglePause() } }
                        heroAction(showOnHome ? "Remove from Home" : "Show on Home", "house") { Task { await toggleShowOnHome() } }
                        heroAction(isFeatured ? "Unfeature" : "Feature", "star") { Task { await toggleFeatured() } }
                    }
                }
                .padding(20)
            }
        }
    }

    private var venue: String { series.location?.isEmpty == false ? series.location! : "Location TBC" }
    private var mapsUrl: URL? {
        guard let loc = series.location, !loc.isEmpty,
              let q = loc.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) else { return nil }
        return URL(string: "https://www.google.com/maps/search/?api=1&query=\(q)")
    }

    private func heroAction(_ label: String, _ icon: String, gold: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            Label(label, systemImage: icon).font(.inter(12, .semibold))
                .foregroundStyle(gold ? .white : Nuru.ink)
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(gold ? AnyShapeStyle(Nuru.goldGradient) : AnyShapeStyle(Nuru.inputBg))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        }.pressable().disabled(busyAction != nil)
    }

    // MARK: Attendance block

    private var attendanceCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Attendance", focus != nil ? "This occurrence" : "Next occurrence")
                let stats = detail?.stats
                let cols = Array(repeating: GridItem(.flexible(), spacing: 8), count: MacDesign.isMac ? 6 : 3)
                LazyVGrid(columns: cols, spacing: 8) {
                    metric("RSVP going", value(rsvps?.counts?.going ?? stats?.rsvpGoing), Color(hex: 0x0F6B33))
                    metric("Conversion", stats?.conversionPct.map { "\($0)%" } ?? "—", Color(hex: 0x15803D))
                    metric("Checked in", value(roster.map(\.attended) ?? stats?.checkins), Color(hex: 0x15803D))
                    metric("Guests", value(roster?.guests?.count ?? stats?.guests), Nuru.navy)
                    metric("First-timers", value(roster.map(\.firstTimers) ?? stats?.firstTimers), Color(hex: 0x1D4ED8))
                    metric("No-shows", value(roster?.rsvpNoShow?.count ?? stats?.noShows), Color(hex: 0xB91C1C))
                }
                EvFlexRow(spacing: 8) {
                    evMiniChip("View RSVPs", "person.crop.circle.badge.checkmark") { showRsvps = true }
                    evMiniChip("View roster", "person.2") { showRoster = true }
                    evMiniChip("Manual check-in", "checkmark.circle") { showManualCheckin = true }
                    evMiniChip("Export CSV", "square.and.arrow.up") { Task { await exportCsv() } }
                }
                if focusEventId == nil {
                    Text("Roster actions need an upcoming occurrence.").font(.nMicro).foregroundStyle(Nuru.muted)
                }
            }
        }
    }

    private func value(_ n: Int?) -> String { n.map(String.init) ?? "—" }

    private func metric(_ label: String, _ v: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(v).font(.fraunces(22, .medium)).foregroundStyle(color)
            Text(label.uppercased()).font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
                .lineLimit(1).minimumScaleFactor(0.7)
        }.padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
    }

    // MARK: QR panel — the real token or nothing

    private var qrCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Live check-in QR", "Server-issued token — the code members actually scan")
                if !series.qrEnabled {
                    evEmptyZone(icon: "qrcode", title: "QR check-in is off",
                                body: "Enable QR check-in in the event settings to arm this panel.")
                } else if let qr, let token = qr.scanToken, !token.isEmpty {
                    VStack(spacing: 12) {
                        EvQrCode(value: token, size: 240)
                        qrExpiryRow(qr)
                        if let url = qr.checkinUrl, !url.isEmpty {
                            Text(url).font(.system(size: 11)).monospaced().foregroundStyle(Nuru.muted)
                                .lineLimit(1).truncationMode(.middle)
                        }
                    }.frame(maxWidth: .infinity).padding(16)
                        .background(Nuru.inputBg).clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
                } else if qrLoading {
                    HStack { Spacer(); ProgressView(); Spacer() }.padding(.vertical, 40)
                } else {
                    evEmptyZone(icon: "qrcode", title: "Live QR unavailable",
                                body: qrFailed ?? "The QR endpoint isn't reachable. No placeholder code is shown — a code that members can't validate would be worse than none.")
                    Button { Task { await loadQr() } } label: {
                        Label("Retry", systemImage: "arrow.clockwise").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Nuru.inputBg).clipShape(Capsule())
                    }.pressable()
                }
            }
        }
    }

    @ViewBuilder
    private func qrExpiryRow(_ qr: EventQr) -> some View {
        if let exp = EvDate.parse(qr.expiresAt) {
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let remaining = Int(exp.timeIntervalSince(ctx.date))
                if remaining > 0 {
                    Label("Rotates in \(remaining / 60):\(String(format: "%02d", remaining % 60))",
                          systemImage: "timer")
                        .font(.nMicro).monospaced().foregroundStyle(Nuru.muted)
                } else {
                    Label("Refreshing…", systemImage: "arrow.clockwise")
                        .font(.nMicro).foregroundStyle(Nuru.muted)
                        .task { await loadQr() }   // auto-refresh at expiry
                }
            }
        } else {
            HStack(spacing: 8) {
                Label("Valid for this occurrence", systemImage: "checkmark.shield")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
                Button { Task { await loadQr() } } label: {
                    Label("Refresh", systemImage: "arrow.clockwise").font(.nMicro).foregroundStyle(Nuru.ink)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }.pressable()
            }
        }
    }

    // MARK: Linked announcements (§5 — all three modes)

    private var announcementsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top) {
                    evCardHeader("Linked announcements", "Attached to this occurrence or the whole series")
                    Spacer()
                    Button { showComposer = true } label: {
                        Label("Compose", systemImage: "plus").font(.inter(12, .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                    }.pressable()
                }
                let linked = detail?.announcements ?? []
                if linked.isEmpty {
                    evEmptyZone(icon: "bell",
                                title: detailFailed ? "Linked announcements unavailable" : "Nothing linked yet",
                                body: detailFailed
                                    ? "The series detail API isn't reachable yet — linked announcements appear once it is."
                                    : "Compose an announcement attached to this event and it appears here.")
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(linked.enumerated()), id: \.element.id) { i, a in
                            if i > 0 { Divider().overlay(Nuru.border) }
                            HStack(spacing: 10) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(a.title).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                                    HStack(spacing: 6) {
                                        Text(a.attachmentLabel ?? "Standalone")
                                        Text("·"); Text(evAnnouncementStatusLabel(a))
                                    }.font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                EvStatusBadge(status: evAnnouncementStatusLabel(a))
                            }.padding(.vertical, 10)
                        }
                    }
                }
            }
        }
    }

    // MARK: Timeline (§3 audit slice)

    private var timelineCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Timeline", "Everything that happened on this series")
                if let entries = timeline, !entries.isEmpty {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(entries.prefix(20).enumerated()), id: \.element.id) { i, e in
                            timelineRow(e, isLast: i == min(entries.count, 20) - 1)
                        }
                    }
                } else if timelineFailed {
                    evEmptyZone(icon: "clock.arrow.circlepath", title: "Timeline unavailable",
                                body: "The series timeline API isn't reachable yet. Every action is still audited server-side.")
                } else if timeline != nil {
                    evEmptyZone(icon: "clock.arrow.circlepath", title: "No activity yet",
                                body: "Edits, exceptions, check-in openings, and sends will appear here.")
                } else {
                    SkeletonList(rows: 3)
                }
            }
        }
    }

    private func timelineRow(_ e: EvTimelineEntry, isLast: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                Circle().fill(timelineTint(e.kind)).frame(width: 9, height: 9).padding(.top, 5)
                if !isLast { Rectangle().fill(Nuru.border).frame(width: 1).frame(maxHeight: .infinity) }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(e.title.isEmpty ? e.kind : e.title).font(.inter(12.5, .semibold)).foregroundStyle(Nuru.ink)
                HStack(spacing: 6) {
                    if let actor = e.actorName { Text(actor) }
                    Text(Fmt.date(e.at, style: .dateTime.day().month(.abbreviated).hour().minute())).monospaced()
                }.font(.nMicro).foregroundStyle(Nuru.muted)
                if let n = e.note, !n.isEmpty { Text(n).font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(2) }
            }
            .padding(.bottom, isLast ? 0 : 14)
            Spacer(minLength: 0)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func timelineTint(_ kind: String) -> Color {
        let k = kind.lowercased()
        if k.contains("cancel") || k.contains("delete") { return Nuru.danger }
        if k.contains("exception") || k.contains("reschedul") { return Nuru.warning }
        if k.contains("sent") || k.contains("check") { return Nuru.success }
        if k.contains("created") || k.contains("publish") { return Nuru.gold }
        return Nuru.navyMid
    }

    // MARK: Quick actions / danger zone

    private var actionsCard: some View {
        Card {
            VStack(alignment: .leading, spacing: 12) {
                evCardHeader("Quick actions", "Occurrence surgery and series lifecycle")
                VStack(spacing: 8) {
                    actionRow("Reschedule this occurrence", "calendar.badge.clock",
                              enabled: focusOriginalStartAt != nil) { showReschedule = true }
                    actionRow("Cancel this occurrence", "xmark.circle",
                              enabled: focusOriginalStartAt != nil, danger: true) { confirmCancelOcc = true }
                    if isRecurring {
                        actionRow("Edit this and following (split)", "arrow.branch",
                                  enabled: focusOriginalStartAt != nil) {
                            editorScope = .thisAndFollowing
                            showEditor = true
                        }
                    }
                    actionRow(isPaused ? "Resume series" : "Pause series", isPaused ? "play" : "pause") { Task { await togglePause() } }
                    actionRow("Export attendance CSV", "square.and.arrow.up",
                              enabled: focusEventId != nil) { Task { await exportCsv() } }
                }
                Divider().overlay(Nuru.border).padding(.top, 4)
                Text("DANGER ZONE").font(.nOverline).tracking(0.6).foregroundStyle(Color(hex: 0xB91C1C))
                actionRow("Delete series", "trash", danger: true) { confirmDelete = true }
                Text("\"Only this occurrence\" changes ride the exceptions path; \"this and following\" splits the series at this date, exactly like the web console.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }

    private func actionRow(_ label: String, _ icon: String, enabled: Bool = true, danger: Bool = false, _ run: @escaping () -> Void) -> some View {
        Button(action: run) {
            HStack {
                Label(label, systemImage: icon).font(.inter(12.5, .semibold))
                    .foregroundStyle(danger ? Color(hex: 0xB91C1C) : Nuru.ink)
                Spacer()
                if busyAction == label { ProgressView().controlSize(.mini) }
                else { Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(Nuru.ink300) }
            }
            .padding(.horizontal, 12).padding(.vertical, 11)
            .background(danger ? Color(hex: 0xFEE2E2) : Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .contentShape(Rectangle())
        }
        .pressable()
        .disabled(!enabled || busyAction != nil)
        .opacity(enabled ? 1 : 0.45)
    }

    // MARK: Actions

    private func togglePause() async {
        busyAction = isPaused ? "Resume series" : "Pause series"
        defer { busyAction = nil }
        do {
            if isPaused { try await PortalAPI.resumeEventSeries(series.seriesId) }
            else { try await PortalAPI.pauseEventSeries(series.seriesId) }
            isPaused.toggle()
            toast = .success(isPaused ? "Series paused — future occurrences hidden." : "Series resumed.")
            onChanged()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not update series.")
        }
    }

    private func toggleShowOnHome() async {
        do {
            try await PortalAPI.setSeriesShowOnHome(series.seriesId, !showOnHome)
            showOnHome.toggle()
            toast = .success(showOnHome ? "Now on the member Home list." : "Removed from the member Home list.")
            onChanged()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not update Home visibility.")
        }
    }

    private func toggleFeatured() async {
        do {
            try await PortalAPI.setSeriesFeatured(series.seriesId, !isFeatured)
            isFeatured.toggle()
            toast = .success(isFeatured ? "Featured on the member homepage." : "Unfeatured.")
            onChanged()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not update the feature flag.")
        }
    }

    private func cancelOccurrence() async {
        guard let original = focusOriginalStartAt else { return }
        do {
            try await PortalAPI.addSeriesException(series.seriesId, [
                "original_start_at": .string(original),
                "is_cancelled": .bool(true),
            ])
            toast = .success("Occurrence cancelled — RSVP'd members are notified.")
            await loadAll()
            onChanged()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not cancel occurrence.")
        }
    }

    private func deleteSeries() async {
        do {
            try await PortalAPI.deleteEventSeries(series.seriesId)
            onChanged()
            dismiss()
        } catch {
            toast = .error((error as? APIError)?.errorDescription ?? "Could not delete event series.")
        }
    }

    /// CSV export: prefer the server export (§6); fall back to composing the CSV
    /// from the loaded roster (still server truth — never invented rows).
    private func exportCsv() async {
        guard let id = focusEventId else { return }
        busyAction = "Export attendance CSV"
        defer { busyAction = nil }
        var data: Data?
        if let served = try? await PortalAPI.eventAttendanceCsv(id) { data = served }
        else if let r = await loadedRoster(id) {
            var rows = ["name,type,method,time,note"]
            func esc(_ s: String) -> String { "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" }
            for c in r.checkedIn ?? [] { rows.append("\(esc(c.fullName)),member,\(c.method),\(c.checkedInAt),\(esc(c.note ?? ""))") }
            for g in r.guests ?? [] { rows.append("\(esc(g.guestName)),guest\(g.firstTime ? " (first-time)" : ""),guest,\(g.createdAt),") }
            for n in r.rsvpNoShow ?? [] { rows.append("\(esc(n.fullName)),no-show,,,") }
            data = rows.joined(separator: "\n").data(using: .utf8)
        }
        guard let data else { toast = .error("No attendance data to export yet."); return }
        let safeTitle = series.title.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(safeTitle) — attendance.csv")
        do {
            try data.write(to: url, options: .atomic)
            csvDoc = EvCsvDoc(url: url)
        } catch {
            toast = .error("Could not write the CSV file.")
        }
    }

    private func loadedRoster(_ eventId: String) async -> EvRoster? {
        if let roster { return roster }
        return try? await PortalAPI.eventRoster(eventId)
    }
}

// MARK: - CSV share sheet

struct EvCsvDoc: Identifiable { let url: URL; var id: String { url.absoluteString } }

struct EvCsvShareSheet: View {
    let doc: EvCsvDoc
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                TintedIcon(systemName: "tablecells", size: 56)
                Text(doc.url.lastPathComponent).font(.nHeading).foregroundStyle(Nuru.ink)
                    .multilineTextAlignment(.center)
                Text("Roster, guests, and no-shows in one file.").font(.nCaption).foregroundStyle(Nuru.muted)
                ShareLink(item: doc.url, preview: SharePreview(doc.url.lastPathComponent)) {
                    Label("Share CSV", systemImage: "square.and.arrow.up")
                        .font(.inter(15, .bold)).foregroundStyle(Nuru.navyDeep)
                        .frame(maxWidth: .infinity).frame(height: 50)
                        .background(Nuru.goldGradient)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.button, style: .continuous))
                }
            }
            .padding(24)
            .frame(maxWidth: 420)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Nuru.paper)
            .navigationTitle("Export").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - Reschedule occurrence (exceptions new_start_at — parity with web)

struct EvRescheduleSheet: View {
    let seriesId: String
    let occurrenceTitle: String
    let originalStartAt: String
    let currentStart: Date?
    let durationMin: Int
    var onDone: () -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var newDate: Date = Date()
    @State private var newTime: Date = Date()
    @State private var note = ""
    @State private var busy = false
    @State private var didPrefill = false

    private var newStart: Date {
        var c = Calendar.current.dateComponents([.year, .month, .day], from: newDate)
        let t = Calendar.current.dateComponents([.hour, .minute], from: newTime)
        c.hour = t.hour; c.minute = t.minute; c.second = 0
        return Calendar.current.date(from: c) ?? newDate
    }

    private func submit() async {
        busy = true; defer { busy = false }
        let start = newStart
        let end = start.addingTimeInterval(TimeInterval(durationMin * 60))
        var body: [String: EJSON] = [
            "original_start_at": .string(originalStartAt),
            "is_cancelled": .bool(false),
            "new_start_at": .string(EvDate.iso.string(from: start)),
            "new_end_at": .string(EvDate.iso.string(from: end)),
        ]
        let n = note.trimmingCharacters(in: .whitespaces)
        if !n.isEmpty { body["note"] = .string(n) }
        do {
            try await PortalAPI.addSeriesException(seriesId, body)
            onDone()
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Could not reschedule the occurrence.")
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(occurrenceTitle).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    Text("Move just this date — the rest of the series is untouched. Members who RSVP'd get a reschedule notice.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                    evFormField("Original") {
                        Text(EvDate.long(originalStartAt)).font(.inter(13, .semibold)).monospaced()
                    }
                    HStack(spacing: 12) {
                        evFormField("New date") { DatePicker("", selection: $newDate, displayedComponents: .date).labelsHidden() }
                        evFormField("New time") { DatePicker("", selection: $newTime, displayedComponents: .hourAndMinute).labelsHidden() }
                    }
                    evFormField("Note (optional)") {
                        TextField("e.g. Venue unavailable", text: $note).textFieldStyle(.plain).font(.inter(13, .regular))
                    }
                    GoldButton(title: "Reschedule occurrence", loading: busy) { Task { await submit() } }
                }
                .padding(24)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Reschedule").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
            .onAppear {
                guard !didPrefill else { return }
                didPrefill = true
                if let d = currentStart { newDate = d; newTime = d }
            }
        }
        .presentationDetents([.large])
    }
}

// MARK: - RSVP roster sheet

struct EvRsvpSheet: View {
    let title: String
    let roster: EvRsvpRoster?
    @State private var filter = "going"
    @Environment(\.dismiss) private var dismiss

    private func bucket(_ k: String) -> [EvRsvpRow] {
        guard let b = roster?.buckets else { return [] }
        switch k { case "going": return b.going ?? []; case "maybe": return b.maybe ?? []
        case "declined": return b.declined ?? []; default: return b.noResponse ?? [] }
    }
    private func count(_ k: String) -> Int {
        guard let c = roster?.counts else { return 0 }
        switch k { case "going": return c.going; case "maybe": return c.maybe
        case "declined": return c.declined; default: return c.noResponse }
    }
    private func meta(_ k: String) -> (String, Color) {
        switch k { case "going": ("Going", Color(hex: 0x0F6B33)); case "maybe": ("Maybe", Color(hex: 0xB45309))
        case "declined": ("Not going", Color(hex: 0xB91C1C)); default: ("No response", Color(hex: 0x6B7280)) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("RSVP list · \(title)").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    if roster == nil {
                        Text("Loading RSVPs…").font(.nCaption).foregroundStyle(Nuru.muted).frame(maxWidth: .infinity).padding(.vertical, 32)
                    } else {
                        let tabs = ["going", "maybe", "declined"] + (roster?.noResponseScope == "cell" ? ["no_response"] : [])
                        EvFlexRow(spacing: 8) {
                            ForEach(tabs, id: \.self) { k in
                                let m = meta(k)
                                Button { filter = k } label: {
                                    Text("\(m.0) · \(count(k))").font(.inter(12, .bold))
                                        .foregroundStyle(filter == k ? m.1 : Nuru.muted)
                                        .padding(.horizontal, 12).padding(.vertical, 7)
                                        .background(filter == k ? m.1.opacity(0.12) : Nuru.inputBg)
                                        .clipShape(Capsule())
                                }.pressable()
                            }
                        }
                        let rows = bucket(filter)
                        if rows.isEmpty {
                            Text("No members in \"\(meta(filter).0)\".").font(.nCaption).foregroundStyle(Nuru.muted)
                                .frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else {
                            ForEach(rows) { m in
                                HStack {
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(m.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                        Text(m.cellName ?? "—").font(.nMicro).foregroundStyle(Nuru.muted)
                                    }
                                    Spacer()
                                    let mm = meta(m.response)
                                    Text(m.respondedAt.map { Fmt.date($0, style: .dateTime.day().month(.abbreviated)) } ?? mm.0)
                                        .font(.system(size: 10.5, weight: .bold)).foregroundStyle(mm.1)
                                        .padding(.horizontal, 10).padding(.vertical, 4)
                                        .background(mm.1.opacity(0.12)).clipShape(Capsule())
                                }
                                .padding(.horizontal, 12).padding(.vertical, 10)
                                .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                            }
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("RSVP responses").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

// MARK: - Attendance roster sheet

struct EvRosterSheet: View {
    let title: String
    let roster: EvRoster?
    var onManualCheckIn: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Attendance list · \(title)").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    HStack {
                        Text("\(roster?.attended ?? 0) checked in").font(.fraunces(22, .medium)).foregroundStyle(Nuru.ink)
                        Spacer()
                        Button { dismiss(); onManualCheckIn() } label: {
                            Label("Manual check-in", systemImage: "checkmark.circle").font(.inter(12, .semibold)).foregroundStyle(.white)
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .background(Nuru.navy).clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                        }.pressable()
                    }
                    HStack {
                        Text("MEMBER").frame(maxWidth: .infinity, alignment: .leading)
                        Text("TIME").frame(width: 70, alignment: .leading)
                        Text("METHOD").frame(width: 70, alignment: .leading)
                        Text("STATUS").frame(width: 84, alignment: .leading)
                    }.font(.system(size: 10, weight: .bold)).tracking(0.5).foregroundStyle(Nuru.muted)
                    Divider().overlay(Nuru.border)
                    let checkedIn = roster?.checkedIn ?? []
                    let guests = roster?.guests ?? []
                    let noShows = roster?.rsvpNoShow ?? []
                    if roster == nil {
                        Text("Loading roster…").font(.nCaption).foregroundStyle(Nuru.muted).padding(.vertical, 16)
                    } else if checkedIn.isEmpty && guests.isEmpty && noShows.isEmpty {
                        Text("No check-ins recorded yet.").font(.nCaption).foregroundStyle(Nuru.muted).padding(.vertical, 16)
                    } else {
                        ForEach(checkedIn) { c in
                            evAttendeeRow(c.fullName, time: c.checkedInAt, method: c.method,
                                          status: c.method.lowercased() == "manual" ? "Manual" : "Verified")
                        }
                        ForEach(guests) { g in
                            evAttendeeRow(g.guestName + (g.firstTime ? " · first-time" : ""), time: g.createdAt, method: "Guest", status: "Guest")
                        }
                        if !noShows.isEmpty {
                            Text("RSVP'D BUT ABSENT").font(.nOverline).tracking(0.5).foregroundStyle(Color(hex: 0xB91C1C)).padding(.top, 8)
                            ForEach(noShows) { n in
                                evAttendeeRow(n.fullName, time: "", method: "—", status: "Late")
                            }
                        }
                    }
                }.padding(24)
            }
            .background(Nuru.paper)
            .navigationTitle("Attendance").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
    }
}

// MARK: - Manual check-in sheet

struct EvManualCheckinSheet: View {
    let eventId: String
    let title: String
    var onDone: (String) -> Void
    var onError: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var tab = "member"
    @State private var query = ""
    @State private var results: [EvMemberLite] = []
    @State private var note = ""
    @State private var guestName = ""
    @State private var guestPhone = ""
    @State private var firstTime = true
    @State private var busy = false
    @State private var searchTask: Task<Void, Never>?

    private func runSearch(_ q: String) {
        searchTask?.cancel()
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { results = []; return }
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 250_000_000)
            if Task.isCancelled { return }
            if let r = try? await PortalAPI.searchMembersLite(trimmed) {
                if !Task.isCancelled { results = Array(r.prefix(8)) }
            }
        }
    }

    private func checkIn(_ m: EvMemberLite) async {
        busy = true; defer { busy = false }
        do {
            try await PortalAPI.manualCheckIn(eventId, userId: m.userId, note: note.trimmingCharacters(in: .whitespaces))
            onDone(m.fullName)
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Check-in failed.")
        }
    }

    private func addGuest() async {
        let name = guestName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        busy = true; defer { busy = false }
        do {
            try await PortalAPI.addEventGuest(eventId, name: name,
                                              phone: guestPhone.trimmingCharacters(in: .whitespaces), firstTime: firstTime)
            onDone(name)
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Could not add guest.")
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(title).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    Picker("", selection: $tab) {
                        Text("Member").tag("member"); Text("Guest").tag("guest")
                    }.pickerStyle(.segmented).tint(Nuru.gold)

                    if tab == "member" { memberTab } else { guestTab }
                }
                .padding(24)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .scrollContentBackground(.hidden)
            .navigationTitle("Manual check-in").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    @ViewBuilder private var memberTab: some View {
        evFormField("Search member") {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(Nuru.muted).font(.system(size: 13))
                TextField("Search member name…", text: $query)
                    .textFieldStyle(.plain).font(.inter(13, .regular))
                    .onChange(of: query) { _, v in runSearch(v) }
            }
        }
        VStack(spacing: 6) {
            ForEach(results) { m in
                Button { Task { await checkIn(m) } } label: {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(m.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                            Text("\(m.cellName ?? "—") · L\(m.currentLevel.map(String.init) ?? "—")").font(.nMicro).foregroundStyle(Nuru.muted)
                        }
                        Spacer()
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(Nuru.gold)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 10)
                    .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    .contentShape(Rectangle())
                }.pressable().hoverEffect(.highlight).disabled(busy)
            }
            if !query.trimmingCharacters(in: .whitespaces).isEmpty && results.isEmpty {
                Text("No matches.").font(.nCaption).foregroundStyle(Nuru.muted).frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        evFormField("Note (optional)") {
            TextField("e.g. QR scan failed", text: $note).textFieldStyle(.plain).font(.inter(13, .regular))
        }
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "checkmark.shield.fill").foregroundStyle(Color(hex: 0xA87616))
            Text("Manual check-ins are audited and visible in the attendance log.").font(.nMicro).foregroundStyle(Color(hex: 0x7A5410))
        }
        .padding(12).background(Color(hex: 0xFFFBEB)).clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(Color(hex: 0xF5E0A8), lineWidth: 1))
    }

    @ViewBuilder private var guestTab: some View {
        HStack(alignment: .top, spacing: 12) {
            evFormField("Guest name") {
                TextField("Visitor name", text: $guestName).textFieldStyle(.plain).font(.inter(15, .regular))
            }
            evFormField("Phone") {
                TextField("+254 …", text: $guestPhone).textFieldStyle(.plain).font(.inter(15, .regular)).keyboardType(.phonePad)
            }
        }
        Toggle(isOn: $firstTime) { Text("First-time visitor").font(.inter(14, .medium)).foregroundStyle(Nuru.ink) }.tint(Nuru.lumGreen)
        Button { Task { await addGuest() } } label: {
            Label("Add guest", systemImage: "person.badge.plus").font(.inter(13, .bold)).foregroundStyle(.white)
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(guestName.trimmingCharacters(in: .whitespaces).isEmpty ? Nuru.muted : Nuru.navy)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        }.pressable().disabled(busy || guestName.trimmingCharacters(in: .whitespaces).isEmpty)
    }
}
