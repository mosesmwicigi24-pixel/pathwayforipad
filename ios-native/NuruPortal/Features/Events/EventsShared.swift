// Shared kit for the Events & Announcements console family: category palette,
// occurrence view-model, status badges, QR rendering (real tokens only — the
// fake client-generated code died with the old EventsView), date helpers, and
// the small form primitives every sheet reuses.
import SwiftUI
import CoreImage.CIFilterBuiltins

// MARK: - Category palette (real `category` column first, title inference fallback)

enum EvCategory: CaseIterable {
    case worship, klass, cell, leadership, youth, special
    var label: String {
        switch self {
        case .worship: "Worship"; case .klass: "Class"; case .cell: "Cell"
        case .leadership: "Leadership"; case .youth: "Youth"; case .special: "Special"
        }
    }
    var apiKey: String {
        switch self {
        case .worship: "worship"; case .klass: "class"; case .cell: "cell"
        case .leadership: "leadership"; case .youth: "youth"; case .special: "special"
        }
    }
    var color: Color {
        switch self {
        case .worship: Color(hex: 0xC89B3C); case .klass: Color(hex: 0x0B1F33)
        case .cell: Color(hex: 0x16A34A); case .leadership: Color(hex: 0x6366F1)
        case .youth: Color(hex: 0x2563EB); case .special: Color(hex: 0xF97316)
        }
    }
    var soft: Color {
        switch self {
        case .worship: Color(hex: 0xFBF1DA); case .klass: Color(hex: 0xE1E6ED)
        case .cell: Color(hex: 0xDCF7E4); case .leadership: Color(hex: 0xE4E5FB)
        case .youth: Color(hex: 0xDBE7FE); case .special: Color(hex: 0xFFE6D2)
        }
    }

    /// Wire `category` string → palette; falls back to title/cell inference for
    /// series created before the category column carried data.
    static func resolve(wire: String?, title: String, cellGroupId: String?) -> EvCategory {
        if let wire, let c = allCases.first(where: { $0.apiKey == wire.lowercased() }) { return c }
        let t = title.lowercased()
        func has(_ words: [String]) -> Bool { words.contains { t.contains($0) } }
        if has(["worship", "service", "prayer"]) { return .worship }
        if has(["class", "discipleship", "pathway", "lesson", "study"]) { return .klass }
        if has(["leader", "training", "sync"]) { return .leadership }
        if has(["youth", "teen", "ablaze", "fellowship"]) { return .youth }
        if has(["cell", "home group"]) || (cellGroupId?.isEmpty == false) { return .cell }
        return .special
    }
}

// MARK: - Dates

enum EvDate {
    static let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    static let iso = ISO8601DateFormatter()

    static func parse(_ s: String?) -> Date? {
        guard let s, !s.isEmpty else { return nil }
        return isoFrac.date(from: s) ?? iso.date(from: s)
    }
    static func dayKey(_ d: Date?) -> String {
        guard let d else { return "" }
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
    /// "yyyy-MM" cache key for one calendar month.
    static func monthKey(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.year, .month], from: d)
        return String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
    }
    static func firstOfMonth(_ d: Date) -> Date {
        let cal = Calendar.current
        return cal.date(from: cal.dateComponents([.year, .month], from: d)) ?? d
    }
    static func short(_ s: String?) -> String {
        parse(s).map { $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated)) } ?? "—"
    }
    static func time(_ s: String?) -> String {
        parse(s).map { $0.formatted(.dateTime.hour().minute()) } ?? "—"
    }
    static func long(_ s: String?) -> String {
        parse(s).map { $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year().hour().minute()) } ?? "—"
    }
}

// MARK: - View-model occurrence (parsed dates + display strings)

struct EvOcc: Identifiable, Hashable {
    let id: String
    let seriesId: String
    let title: String
    let category: EvCategory
    let date: Date?
    let endDate: Date?
    let location: String
    let visibility: String
    let status: String          // draft | active
    let rescheduled: Bool
    let going: Int
    let imageUrl: String?
    let startAt: String
    let originalStartAt: String

    static func == (l: EvOcc, r: EvOcc) -> Bool { l.id == r.id && l.startAt == r.startAt }
    func hash(into hasher: inout Hasher) { hasher.combine(id) }

    var dayKey: String { EvDate.dayKey(date) }
    var timeShort: String { date.map { $0.formatted(.dateTime.hour().minute()) } ?? "—" }
    var timeHourOnly: String { date.map { $0.formatted(.dateTime.hour()) } ?? "" }
    var dateLong: String { date.map { $0.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year()) } ?? "—" }
    var endTime: String { endDate.map { $0.formatted(.dateTime.hour().minute()) } ?? "—" }
    var duration: String {
        guard let s = date, let e = endDate else { return "—" }
        let mins = Int(e.timeIntervalSince(s) / 60)
        guard mins > 0 else { return "—" }
        return "\(mins / 60)h \(String(format: "%02d", mins % 60))m"
    }

    static func from(_ o: AdminOcc) -> EvOcc {
        EvOcc(id: o.occurrenceId,
              seriesId: o.seriesId,
              title: o.title,
              category: .resolve(wire: o.category, title: o.title, cellGroupId: o.cellGroupId),
              date: EvDate.parse(o.startAt),
              endDate: EvDate.parse(o.endAt),
              location: (o.location?.isEmpty == false ? o.location! : "Location TBC"),
              visibility: o.visibility.isEmpty ? "congregation" : o.visibility,
              status: o.status ?? "active",
              rescheduled: o.rescheduled,
              going: o.going,
              imageUrl: o.primaryImageUrl,
              startAt: o.startAt,
              originalStartAt: o.originalStartAt.isEmpty ? o.startAt : o.originalStartAt)
    }
}

// MARK: - Status badge

func evStatusColors(_ status: String) -> (bg: Color, fg: Color) {
    switch status.lowercased() {
    case "scheduled": return (Color(hex: 0xE1E6ED), Color(hex: 0x0B1F33))
    case "live", "completed", "sent", "verified", "active": return (Color(hex: 0xDCF7E4), Color(hex: 0x15803D))
    case "cancelled", "failed": return (Color(hex: 0xFEE2E2), Color(hex: 0xB91C1C))
    case "rescheduled", "late", "paused": return (Color(hex: 0xFFE6D2), Color(hex: 0x9A3412))
    case "manual", "draft": return (Color(hex: 0xFBF1DA), Color(hex: 0xA87616))
    case "guest": return (Color(hex: 0xDBE7FE), Color(hex: 0x1D4ED8))
    case "archived": return (Color(hex: 0xEEF0F3), Color(hex: 0x6B7280))
    default: return (Color(hex: 0xEEF0F3), Color(hex: 0x6B7280))
    }
}

struct EvStatusBadge: View {
    let status: String
    var body: some View {
        let c = evStatusColors(status)
        Text(status.uppercased()).font(.inter(10, .bold)).tracking(0.4)
            .foregroundStyle(c.fg)
            .padding(.horizontal, 8).padding(.vertical, 2)
            .background(c.bg).clipShape(Capsule())
    }
}

func evAnnouncementStatusLabel(_ a: AnnouncementRow) -> String {
    if a.isArchived { return "Archived" }
    switch a.status {
    case "scheduled": return "Scheduled"
    case "sent": return "Sent"
    case "cancelled": return "Cancelled"
    default: return "Draft"
    }
}
func evAudienceLabel(_ a: AnnouncementRow) -> String {
    switch a.audienceKind {
    case "cells": return a.audienceCells.count == 1 ? "1 cell" : "\(a.audienceCells.count) cells"
    case "level": return "Level \(a.audienceLevel.map(String.init) ?? "—")"
    default: return "All members"
    }
}

// MARK: - QR rendering (encodes ONLY server-issued tokens)

/// Scannable QR from a server payload string via CIQRCodeGenerator, navy-on-white.
struct EvQrCode: View {
    let value: String
    var size: CGFloat = 240

    private static let ciContext = CIContext()

    private func qrImage() -> Image? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let coded = filter.outputImage else { return nil }
        let tint = CIFilter.falseColor()
        tint.inputImage = coded
        tint.color0 = CIColor(red: 0x0B/255.0, green: 0x1F/255.0, blue: 0x33/255.0)
        tint.color1 = CIColor(red: 1, green: 1, blue: 1)
        guard let colored = tint.outputImage else { return nil }
        let scale = max(1, (size * 3) / colored.extent.width)
        let scaled = colored.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = Self.ciContext.createCGImage(scaled, from: scaled.extent) else { return nil }
        return Image(decorative: cg, scale: 1, orientation: .up)
    }

    var body: some View {
        Group {
            if let img = qrImage() {
                img.interpolation(.none).resizable().scaledToFit()
                    .frame(width: size, height: size)
            } else {
                ZStack {
                    Color.white
                    Image(systemName: "qrcode").font(.system(size: size * 0.4)).foregroundStyle(Nuru.ink300)
                }.frame(width: size, height: size)
            }
        }
        .padding(14).background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.panel, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// MARK: - Wrapping row layout

struct EvFlexRow: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > maxW, x > 0 { x = 0; y += rowH + spacing; rowH = 0 }
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
        return CGSize(width: maxW == .infinity ? x : maxW, height: y + rowH)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, rowH: CGFloat = 0
        for v in subviews {
            let s = v.sizeThatFits(.unspecified)
            if x + s.width > bounds.maxX, x > bounds.minX { x = bounds.minX; y += rowH + spacing; rowH = 0 }
            v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
            x += s.width + spacing; rowH = max(rowH, s.height)
        }
    }
}

// MARK: - Form + card primitives

let evFieldBorder = Color(hex: 0x0A2540, alpha: 0.20)

func evSectionLabel(_ text: String) -> some View {
    Text(text).font(.fraunces(16, .medium)).foregroundStyle(Nuru.navy)
}

func evFormField<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 6) {
        Text(label.uppercased()).font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
        content()
            .font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
            .padding(.horizontal, 12).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(evFieldBorder, lineWidth: 1))
    }
}

func evCardHeader(_ title: String, _ subtitle: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.fraunces(20, .medium)).foregroundStyle(Nuru.ink)
        Text(subtitle).font(.nCaption).foregroundStyle(Nuru.muted)
    }.frame(maxWidth: .infinity, alignment: .leading)
}

func evEmptyZone(icon: String, title: String, body: String) -> some View {
    VStack(spacing: 8) {
        Image(systemName: icon).font(.system(size: 20)).foregroundStyle(Nuru.muted)
            .frame(width: 48, height: 48).background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.ink)
        Text(body).font(.nCaption).foregroundStyle(Nuru.muted).multilineTextAlignment(.center).frame(maxWidth: 300)
    }.frame(maxWidth: .infinity).padding(.vertical, 28)
}

/// Small tappable chip used across cards.
func evMiniChip(_ label: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
    Button(action: action) {
        Label(label, systemImage: icon).font(.inter(10, .semibold)).foregroundStyle(Nuru.ink)
            .padding(.horizontal, 8).padding(.vertical, 5)
            .background(Nuru.white).clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 7, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }.pressable()
}

/// Attendee row shared by the roster views.
func evAttendeeRow(_ name: String, time: String, method: String, status: String) -> some View {
    VStack(spacing: 0) {
        HStack {
            Text(name).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink).frame(maxWidth: .infinity, alignment: .leading).lineLimit(1)
            Text(Fmt.date(time, style: .dateTime.hour().minute())).font(.system(size: 11)).monospaced().foregroundStyle(Nuru.muted).frame(width: 70, alignment: .leading)
            Text(method).font(.system(size: 11)).foregroundStyle(Nuru.muted).frame(width: 70, alignment: .leading)
            HStack { EvStatusBadge(status: status); Spacer() }.frame(width: 84, alignment: .leading)
        }.padding(.vertical, 10)
        Divider().overlay(Nuru.border)
    }
}
