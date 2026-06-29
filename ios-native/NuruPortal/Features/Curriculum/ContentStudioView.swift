// Content Studio — the growth library members read in the mobile app, ported
// line-by-line from the web admin portal's GrowthContent.tsx (the "Final Pathway
// Portal" make: navy hero with eyebrow + stats + accent chips, a tabbed section
// switcher with per-section accent + live counts, and accent-bar cards for each
// section). Tailored for the iPad canvas with adaptive multi-column grids.
//
// Sections ported (per assignment): Devotionals, Memory Verses, Reading Plans,
// Resources, Daily Verses. This is now a FULL CRUD surface mirroring the web
// EditModal + forms (GrowthAdminApi.*): the hero "New" button opens a per-type
// form sheet, every card carries Edit + Delete (confirm) + an active/publish
// toggle, and the active section's list refreshes after each write. Daily
// verses are edit-only (the fixed 365-day plan) — no New, no Delete — matching
// the web. Endpoints (all under /admin/growth):
//   devotionals   POST/PUT/DELETE  /devotionals(/{id})
//   memory-verses POST/PUT/DELETE  /memory-verses(/{id})
//   plans         POST/PUT/DELETE  /plans(/{id})   (GET /plans/{id} for days)
//   resources     POST/PUT/DELETE  /resources(/{id})
//   daily-verses  PUT              /daily-verses/{dayIndex}
import SwiftUI

struct ContentStudioView: View {

    // ── Section model (mirrors web `TABS`) ──────────────────────────────────
    enum Tab: String, CaseIterable, Identifiable {
        case devotionals, verses, dailyverses, plans, resources
        var id: String { rawValue }

        var label: String {
            switch self {
            case .devotionals: return "Devotionals"
            case .verses:      return "Memory Verses"
            case .dailyverses: return "Daily Verses"
            case .plans:       return "Reading Plans"
            case .resources:   return "Resources"
            }
        }
        var singular: String {
            switch self {
            case .devotionals: return "devotional"
            case .verses:      return "memory verse"
            case .dailyverses: return "daily verse"
            case .plans:       return "reading plan"
            case .resources:   return "resource"
            }
        }
        var icon: String {
            switch self {
            case .devotionals: return "book"
            case .verses:      return "quote.bubble"
            case .dailyverses: return "calendar"
            case .plans:       return "calendar.badge.clock"
            case .resources:   return "books.vertical"
            }
        }
        // Per-section accent — ONLY the two main brand colors: dark navy and golden
        // yellow. Sections alternate navy/gold so each has its own identity while the
        // whole page reads as one cohesive navy+gold palette (no green/amber/blue).
        var accent: Color {
            switch self {
            case .devotionals: return Nuru.navy    // navy
            case .verses:      return Nuru.gold    // gold
            case .dailyverses: return Nuru.navy    // navy
            case .plans:       return Nuru.gold    // gold
            case .resources:   return Nuru.navy    // navy
            }
        }
        // web: dailyverses has no New button (fixed-schedule, edit-only).
        var canCreate: Bool { self != .dailyverses }
    }

    @State private var tab: Tab = .devotionals
    @State private var query = ""

    // Counts for the tab badges — captured from each section's loaded rows.
    @State private var counts: [Tab: Int] = [:]

    // Per-tab reload token: bumping it re-mounts that section's AsyncView (via
    // `.id`), which re-runs its fetch — the native analogue of the web's
    // reloadTab(tab) after a write.
    @State private var reload: [Tab: Int] = [:]

    // Sheet routing: which editor is open (a fresh "New" or an existing row).
    @State private var editor: Editor?

    enum Editor: Identifiable {
        case devotional(DevotionalFull?)
        case verse(VerseFull?)
        case dailyVerse(DailyVerseFull)
        case plan(PlanListItem?)        // edit loads days lazily by id
        case resource(ResourceFull?)
        var id: String {
            switch self {
            case .devotional(let r): return "dev:\(r?.devotionalId ?? "new")"
            case .verse(let r):      return "ver:\(r?.memoryVerseId ?? "new")"
            case .dailyVerse(let r): return "day:\(r.dayIndex)"
            case .plan(let r):       return "plan:\(r?.planId ?? "new")"
            case .resource(let r):   return "res:\(r?.resourceId ?? "new")"
            }
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero
                switcher
                Divider().background(Nuru.border)
                searchBar
                bodySection
            }
        }
        .background(Nuru.paper)
        .portalPage("Content Studio")
        .sheet(item: $editor) { ed in
            switch ed {
            case .devotional(let r): DevotionalForm(row: r) { bump(.devotionals) }
            case .verse(let r):      VerseForm(row: r) { bump(.verses) }
            case .dailyVerse(let r): DailyVerseForm(row: r) { bump(.dailyverses) }
            case .plan(let r):       PlanForm(row: r) { bump(.plans) }
            case .resource(let r):   ResourceForm(row: r) { bump(.resources) }
            }
        }
    }

    private func bump(_ t: Tab) { reload[t, default: 0] += 1 }

    // ── Body — one AsyncView per active section, re-mounted on reload token ──
    @ViewBuilder private var bodySection: some View {
        Group {
            switch tab {
            case .devotionals:
                AsyncView(GrowthAPI.devotionals) { rows in
                    section(filterDevotionals(rows), count: .devotionals, total: rows.count) { r in
                        DevotionalRowView(d: r,
                                      onEdit: { editor = .devotional(r) },
                                      onDelete: { confirmDelete(.devotional(r)) },
                                      onAdd: { openNew() },
                                      onToggle: { Task { await toggleDevotional(r) } })
                    }
                }.id(reload[.devotionals, default: 0])
            case .verses:
                AsyncView(GrowthAPI.verses) { rows in
                    section(filterVerses(rows), count: .verses, total: rows.count) { r in
                        VerseRowView(v: r,
                                 onEdit: { editor = .verse(r) },
                                 onDelete: { confirmDelete(.verse(r)) },
                                 onAdd: { openNew() },
                                 onToggle: { Task { await toggleVerse(r) } })
                    }
                }.id(reload[.verses, default: 0])
            case .dailyverses:
                AsyncView(GrowthAPI.dailyVerses) { rows in
                    section(filterDaily(rows), count: .dailyverses, total: rows.count) { r in
                        DailyVerseRow(d: r, onEdit: { editor = .dailyVerse(r) })
                    }
                }.id(reload[.dailyverses, default: 0])
            case .plans:
                AsyncView(GrowthAPI.plans) { rows in
                    section(filterPlans(rows), count: .plans, total: rows.count) { r in
                        PlanRowView(p: r,
                                onEdit: { editor = .plan(r) },
                                onDelete: { confirmDelete(.plan(r)) },
                                onAdd: { openNew() },
                                onToggle: { Task { await togglePlan(r) } })
                    }
                }.id(reload[.plans, default: 0])
            case .resources:
                AsyncView(GrowthAPI.resources) { rows in
                    section(filterResources(rows), count: .resources, total: rows.count) { r in
                        ResourceRow(r: r,
                                    onEdit: { editor = .resource(r) },
                                    onDelete: { confirmDelete(.resource(r)) },
                                    onAdd: { openNew() },
                                    onToggle: { Task { await toggleResource(r) } })
                    }
                }.id(reload[.resources, default: 0])
            }
        }
        .alert("Delete this item?", isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })) {
            Button("Cancel", role: .cancel) { pendingDelete = nil }
            Button("Delete", role: .destructive) { performDelete() }
        } message: { Text("This cannot be undone.") }
    }

    // ── Hero (web: navy banner, breadcrumb, eyebrow, title, subtitle, New) ──
    private var hero: some View {
        PortalHero(
            breadcrumb: ["Curriculum", "Content Studio"],
            eyebrow: "Discipleship content",
            title: "Content Studio",
            subtitle: "Author the devotionals, verses, plans, resources and daily verses that members read in the mobile app.",
            stats: heroStats
        ) {
            HStack(spacing: 8) {
                // Section identity is a NON-interactive label (the previous build made
                // this a tappable HeroChip with an empty action, so tapping it did
                // nothing — that "dead button" next to the real New button is what read
                // as a mess). Only the gold "New" below is tappable.
                HeroTagLabel(label: tab.label, icon: tab.icon)
                if tab.canCreate {
                    // Top-Add opens the SAME clean create sheet as the row ⋯ "Add":
                    // both call openNew(), which sets `editor` to the current section's
                    // `nil` (= create) case. No intermediate/confusing state.
                    HeroChip(label: "New \(tab.singular)", icon: "plus", style: .gold, action: { openNew() })
                }
            }
        }
    }

    private var heroStats: [HeroStat] {
        [
            HeroStat(label: "Devotionals", value: count(.devotionals), hint: "daily readings"),
            HeroStat(label: "Memory verses", value: count(.verses), hint: "to memorise"),
            HeroStat(label: "Reading plans", value: count(.plans), hint: "guided journeys"),
            HeroStat(label: "Resources", value: count(.resources), hint: "library items"),
        ]
    }
    private func count(_ t: Tab) -> String { counts[t].map(String.init) ?? "—" }

    private func openNew() {
        switch tab {
        case .devotionals: editor = .devotional(nil)
        case .verses:      editor = .verse(nil)
        case .plans:       editor = .plan(nil)
        case .resources:   editor = .resource(nil)
        case .dailyverses: break   // no create
        }
    }

    // ── Section switcher — capsule segmented buttons (web: tabbed bar). Each
    // segment is a styled capsule; the selected one fills with its section's brand
    // accent (white text + matching count badge), the rest are quiet outlined chips.
    private var switcher: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Tab.allCases) { t in
                    let on = t == tab
                    // On a gold fill, dark navy ink reads better than white; on a navy
                    // fill, white reads best. Keep both selected states on-brand.
                    let onText: Color = (t.accent == Nuru.gold) ? Nuru.navy : .white
                    Button { tab = t; query = "" } label: {
                        HStack(spacing: 7) {
                            Image(systemName: t.icon).font(.system(size: 12.5, weight: .medium))
                            Text(t.label).font(.inter(13, on ? .semibold : .medium))
                            Text(counts[t].map(String.init) ?? "·")
                                .font(.inter(10.5, .semibold))
                                .foregroundStyle(on ? AnyShapeStyle(onText) : AnyShapeStyle(t.accent))
                                .padding(.horizontal, 6.5).padding(.vertical, 1.5)
                                .background(on ? AnyShapeStyle(onText.opacity(0.18))
                                              : AnyShapeStyle(t.accent.opacity(0.12)))
                                .clipShape(Capsule())
                        }
                        .foregroundStyle(on ? AnyShapeStyle(onText) : AnyShapeStyle(Nuru.ink600))
                        .padding(.horizontal, 14).frame(height: 38)
                        .background(on ? AnyShapeStyle(t.accent) : AnyShapeStyle(Nuru.white))
                        .clipShape(Capsule())
                        .overlay(
                            Capsule().stroke(on ? Color.clear : Nuru.border, lineWidth: 1)
                        )
                        .shadow(color: on ? t.accent.opacity(0.28) : .clear, radius: 6, y: 2)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 14)
        }
        .background(Nuru.paper)
    }

    // ── Search bar (web: search input + result count) ──
    private var searchBar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.ink600)
                TextField("Search \(tab.label.lowercased())…", text: $query)
                    .font(.inter(13)).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            .padding(.horizontal, 12).frame(height: 40)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        .padding(.horizontal, 20).padding(.top, 16)
    }

    // ── Generic section: a single white table card of full-width ROWS, hairline
    // dividers between them (like the other list/table pages), + empty state +
    // count capture. Each item is ONE compact row (icon → title → meta → status →
    // ⋯ menu), columns aligned across rows, everything truncating to fit portrait.
    private func section<T: Identifiable, C: View>(
        _ rows: [T], count tab: Tab, total: Int, @ViewBuilder _ row: @escaping (T) -> C
    ) -> some View {
        Group {
            if rows.isEmpty {
                EmptyStateView(tab: self.tab, canCreate: self.tab.canCreate, onNew: { openNew() })
                    .padding(20)
            } else {
                Card(padding: 0) {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { i, item in
                            row(item)
                            if i < rows.count - 1 {
                                Divider().background(Nuru.border).padding(.leading, 16)
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        // Badge count reflects the full list (web counts come from the unfiltered
        // lists, not the search-filtered view).
        .onAppear { counts[tab] = total }
    }

    // ── Search filtering (web `filtered` per tab) ──
    private func q() -> String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private func match(_ s: String) -> Bool { let k = q(); return k.isEmpty || s.lowercased().contains(k) }
    private func filterDevotionals(_ r: [DevotionalFull]) -> [DevotionalFull] {
        r.filter { match("\($0.title) \($0.series ?? "") \($0.scriptureRef ?? "")") }
    }
    private func filterVerses(_ r: [VerseFull]) -> [VerseFull] {
        r.filter { match("\($0.reference) \($0.verseText)") }
    }
    private func filterDaily(_ r: [DailyVerseFull]) -> [DailyVerseFull] {
        r.filter { match("\($0.reference) \($0.theme ?? "") \($0.verseText) \($0.dayDate) day \($0.dayIndex)") }
    }
    private func filterPlans(_ r: [PlanListItem]) -> [PlanListItem] {
        r.filter { match("\($0.title) \($0.subtitle ?? "") \($0.code) \($0.category ?? "")") }
    }
    private func filterResources(_ r: [ResourceFull]) -> [ResourceFull] {
        r.filter { match("\($0.title) \($0.author ?? "") \($0.kind)") }
    }

    // ── Delete (web `remove`): confirm via alert, then DELETE + reload tab ──
    enum DeleteTarget: Identifiable {
        case devotional(DevotionalFull), verse(VerseFull), plan(PlanListItem), resource(ResourceFull)
        var id: String {
            switch self {
            case .devotional(let r): return r.devotionalId
            case .verse(let r):      return r.memoryVerseId
            case .plan(let r):       return r.planId
            case .resource(let r):   return r.resourceId
            }
        }
    }
    @State private var pendingDelete: DeleteTarget?

    private func confirmDelete(_ t: DeleteTarget) { pendingDelete = t }
    private func performDelete() {
        guard let t = pendingDelete else { return }
        pendingDelete = nil
        Task {
            do {
                switch t {
                case .devotional(let r): try await GrowthAPI.deleteDevotional(r.devotionalId); bump(.devotionals)
                case .verse(let r):      try await GrowthAPI.deleteVerse(r.memoryVerseId); bump(.verses)
                case .plan(let r):       try await GrowthAPI.deletePlan(r.planId); bump(.plans)
                case .resource(let r):   try await GrowthAPI.deleteResource(r.resourceId); bump(.resources)
                }
            } catch { /* surfaced on next load; deletes are idempotent server-side */ }
        }
    }

    // ── Inline active/publish toggles (web StatusPill is read-only, but the
    // forms toggle is the source of truth; we add a quick card toggle that PUTs
    // the same is_active/is_published flag and reloads). ──
    private func toggleDevotional(_ r: DevotionalFull) async {
        try? await GrowthAPI.updateDevotional(r.devotionalId, DevotionalBody(from: r, isPublished: !r.isPublished))
        bump(.devotionals)
    }
    private func toggleVerse(_ r: VerseFull) async {
        try? await GrowthAPI.updateVerse(r.memoryVerseId, VerseBody(from: r, isActive: !r.isActive))
        bump(.verses)
    }
    private func togglePlan(_ r: PlanListItem) async {
        try? await GrowthAPI.updatePlan(r.planId, PlanBody(from: r, isActive: !r.isActive))
        bump(.plans)
    }
    private func toggleResource(_ r: ResourceFull) async {
        try? await GrowthAPI.updateResource(r.resourceId, ResourceBody(from: r, isActive: !r.isActive))
        bump(.resources)
    }
}

// MARK: - Full list response models (extra fields the edit forms need)
//
// The shared Models.swift rows are intentionally lean (cards only). The edit
// forms need every editable field, so Content Studio decodes its own tolerant
// row models here. All optional or @Default* so a stray null never breaks a load.

struct DevotionalFull: Codable, Identifiable {
    @DefaultEmpty var devotionalId: String
    @DefaultZero var dayNumber: Int
    let series: String?
    @DefaultEmpty var title: String
    let scriptureRef: String?
    let scriptureText: String?
    @DefaultEmpty var body: String
    let reflectionPrompt: String?
    let audioUrl: String?
    let videoUrl: String?
    @DefaultFalse var isPublished: Bool
    var id: String { devotionalId }
}

struct VerseFull: Codable, Identifiable {
    @DefaultEmpty var memoryVerseId: String
    @DefaultEmpty var reference: String
    @DefaultEmpty var verseText: String
    @DefaultEmpty var version: String
    let weekNumber: Int?
    let releaseDate: String?
    let sort: Int?
    @DefaultFalse var isActive: Bool
    var id: String { memoryVerseId }
}

struct DailyVerseFull: Codable, Identifiable {
    @DefaultZero var dayIndex: Int
    @DefaultEmpty var dayDate: String       // YYYY-MM-DD
    let theme: String?
    @DefaultEmpty var reference: String
    @DefaultEmpty var version: String
    @DefaultEmpty var verseText: String
    var id: Int { dayIndex }
}

struct PlanListItem: Codable, Identifiable {
    @DefaultEmpty var planId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var title: String
    let subtitle: String?
    let description: String?
    let category: String?
    let imageUrl: String?
    @DefaultZero var dayCount: Int
    let sort: Int?
    @DefaultFalse var isActive: Bool
    var id: String { planId }
}

// Plan detail (GET /plans/{id}) — list item + its days & segments.
struct PlanDetail: Codable {
    @DefaultEmpty var planId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var title: String
    let subtitle: String?
    let description: String?
    let category: String?
    let imageUrl: String?
    let sort: Int?
    @DefaultFalse var isActive: Bool
    var days: [PlanDayFull]?
}
struct PlanDayFull: Codable, Identifiable {
    @DefaultZero var dayNumber: Int
    @DefaultEmpty var reference: String
    let title: String?
    let content: String?
    var segments: [PlanSegmentFull]?
    var id: Int { dayNumber }
}
struct PlanSegmentFull: Codable, Identifiable {
    let sort: Int?
    @DefaultEmpty var kind: String
    @DefaultEmpty var title: String
    let reference: String?
    let content: String?
    let videoUrl: String?
    var id: String { "\(sort ?? 0)-\(kind)-\(title)" }
}

struct ResourceFull: Codable, Identifiable {
    @DefaultEmpty var resourceId: String
    @DefaultEmpty var title: String
    let author: String?
    @DefaultEmpty var kind: String
    let durationLabel: String?
    let url: String?
    let sort: Int?
    @DefaultFalse var isActive: Bool
    var id: String { resourceId }
}

// MARK: - JSON body helper (conditional keys, mirrors web's object spread)

/// Encodable value that can be omitted: nil keys are dropped from the body.
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v):    try c.encode(v)
        case .bool(let v):   try c.encode(v)
        case .null:          try c.encodeNil()
        }
    }
}

// MARK: - Request bodies (snake_cased by APIClient encoder)

private struct OkResponse: Codable {}

/// Devotional create/update body (web: trimmed required + optional spread).
private struct DevotionalBody: Encodable {
    var body: [String: JSONValue]
    init(dayNumber: Int, title: String, body bodyText: String, isPublished: Bool,
         series: String, scriptureRef: String, scriptureText: String,
         reflectionPrompt: String, audioUrl: String, videoUrl: String) {
        var b: [String: JSONValue] = [
            "day_number": .int(dayNumber),
            "title": .string(title),
            "body": .string(bodyText),
            "is_published": .bool(isPublished),
        ]
        if !series.isEmpty { b["series"] = .string(series) }
        if !scriptureRef.isEmpty { b["scripture_ref"] = .string(scriptureRef) }
        if !scriptureText.isEmpty { b["scripture_text"] = .string(scriptureText) }
        if !reflectionPrompt.isEmpty { b["reflection_prompt"] = .string(reflectionPrompt) }
        if !audioUrl.isEmpty { b["audio_url"] = .string(audioUrl) }
        if !videoUrl.isEmpty { b["video_url"] = .string(videoUrl) }
        self.body = b
    }
    // Quick toggle: re-send full known state with flipped publish flag.
    init(from r: DevotionalFull, isPublished: Bool) {
        self.init(dayNumber: r.dayNumber, title: r.title, body: r.body, isPublished: isPublished,
                  series: r.series ?? "", scriptureRef: r.scriptureRef ?? "", scriptureText: r.scriptureText ?? "",
                  reflectionPrompt: r.reflectionPrompt ?? "", audioUrl: r.audioUrl ?? "", videoUrl: r.videoUrl ?? "")
    }
    func encode(to encoder: Encoder) throws { try body.encode(to: encoder) }
}

private struct VerseBody: Encodable {
    var body: [String: JSONValue]
    init(reference: String, version: String, verseText: String, isActive: Bool,
         weekNumber: Int?, releaseDate: String, sort: Int?) {
        var b: [String: JSONValue] = [
            "reference": .string(reference),
            "version": .string(version.isEmpty ? "WEB" : version),
            "verse_text": .string(verseText),
            "is_active": .bool(isActive),
        ]
        if let w = weekNumber { b["week_number"] = .int(w) }
        if !releaseDate.isEmpty { b["release_date"] = .string(releaseDate) }
        if let s = sort { b["sort"] = .int(s) }
        self.body = b
    }
    init(from r: VerseFull, isActive: Bool) {
        self.init(reference: r.reference, version: r.version, verseText: r.verseText, isActive: isActive,
                  weekNumber: r.weekNumber, releaseDate: r.releaseDate ?? "", sort: r.sort)
    }
    func encode(to encoder: Encoder) throws { try body.encode(to: encoder) }
}

private struct DailyVerseBody: Encodable {
    var body: [String: JSONValue]
    init(theme: String, reference: String, version: String, verseText: String, dayDate: String) {
        var b: [String: JSONValue] = [:]
        if !theme.isEmpty { b["theme"] = .string(theme) }
        if !reference.isEmpty { b["reference"] = .string(reference) }
        if !version.isEmpty { b["version"] = .string(version) }
        if !verseText.isEmpty { b["verse_text"] = .string(verseText) }
        if !dayDate.isEmpty { b["day_date"] = .string(dayDate) }
        self.body = b
    }
    func encode(to encoder: Encoder) throws { try body.encode(to: encoder) }
}

private struct ResourceBody: Encodable {
    var body: [String: JSONValue]
    init(title: String, kind: String, isActive: Bool, author: String,
         durationLabel: String, url: String, sort: Int?) {
        var b: [String: JSONValue] = [
            "title": .string(title),
            "kind": .string(kind.isEmpty ? "book" : kind),
            "is_active": .bool(isActive),
        ]
        if !author.isEmpty { b["author"] = .string(author) }
        if !durationLabel.isEmpty { b["duration_label"] = .string(durationLabel) }
        if !url.isEmpty { b["url"] = .string(url) }
        if let s = sort { b["sort"] = .int(s) }
        self.body = b
    }
    init(from r: ResourceFull, isActive: Bool) {
        self.init(title: r.title, kind: r.kind, isActive: isActive, author: r.author ?? "",
                  durationLabel: r.durationLabel ?? "", url: r.url ?? "", sort: r.sort)
    }
    func encode(to encoder: Encoder) throws { try body.encode(to: encoder) }
}

// Plan body uses a custom encoder so `days` (an array of nested objects) can be
// embedded alongside the scalar fields. Days are encoded only when present.
private struct PlanBody: Encodable {
    var scalars: [String: JSONValue]
    var days: [PlanDayPayload]?

    init(code: String, title: String, isActive: Bool, category: String, subtitle: String,
         description: String, imageUrl: String, sort: Int?, days: [PlanDayPayload]?) {
        var b: [String: JSONValue] = [
            "code": .string(code),
            "title": .string(title),
            "is_active": .bool(isActive),
        ]
        if !category.isEmpty { b["category"] = .string(category) }
        if !subtitle.isEmpty { b["subtitle"] = .string(subtitle) }
        if !description.isEmpty { b["description"] = .string(description) }
        if !imageUrl.isEmpty { b["image_url"] = .string(imageUrl) }
        if let s = sort { b["sort"] = .int(s) }
        self.scalars = b
        self.days = days
    }
    init(from r: PlanListItem, isActive: Bool) {
        self.init(code: r.code, title: r.title, isActive: isActive, category: r.category ?? "",
                  subtitle: r.subtitle ?? "", description: r.description ?? "", imageUrl: r.imageUrl ?? "",
                  sort: r.sort, days: nil)
    }

    struct DynKey: CodingKey {
        var stringValue: String; var intValue: Int?
        init?(stringValue: String) { self.stringValue = stringValue; self.intValue = nil }
        init?(intValue: Int) { self.stringValue = String(intValue); self.intValue = intValue }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: DynKey.self)
        for (k, v) in scalars { try c.encode(v, forKey: DynKey(stringValue: k)!) }
        if let days { try c.encode(days, forKey: DynKey(stringValue: "days")!) }
    }
}
// Plain Codable payloads (snake_cased by the shared encoder).
struct PlanDayPayload: Encodable {
    let dayNumber: Int
    let reference: String
    let title: String?
    let content: String?
    let segments: [PlanSegmentPayload]
}
struct PlanSegmentPayload: Encodable {
    let sort: Int
    let kind: String
    let title: String
    let reference: String?
    let content: String?
    let videoUrl: String?
}

// MARK: - API surface (mirrors api/client.ts GrowthAdminApi)

private enum GrowthAPI {
    private static let G = "/admin/growth"

    static func devotionals() async throws -> [DevotionalFull] {
        try await APIClient.shared.get("\(G)/devotionals", as: DataList<DevotionalFull>.self).data
    }
    static func createDevotional(_ b: DevotionalBody) async throws {
        _ = try await APIClient.shared.post("\(G)/devotionals", body: b, as: OkResponse.self)
    }
    static func updateDevotional(_ id: String, _ b: DevotionalBody) async throws {
        _ = try await APIClient.shared.put("\(G)/devotionals/\(id)", body: b, as: OkResponse.self)
    }
    static func deleteDevotional(_ id: String) async throws {
        _ = try await APIClient.shared.delete("\(G)/devotionals/\(id)", as: OkResponse.self)
    }

    static func verses() async throws -> [VerseFull] {
        try await APIClient.shared.get("\(G)/memory-verses", as: DataList<VerseFull>.self).data
    }
    static func createVerse(_ b: VerseBody) async throws {
        _ = try await APIClient.shared.post("\(G)/memory-verses", body: b, as: OkResponse.self)
    }
    static func updateVerse(_ id: String, _ b: VerseBody) async throws {
        _ = try await APIClient.shared.put("\(G)/memory-verses/\(id)", body: b, as: OkResponse.self)
    }
    static func deleteVerse(_ id: String) async throws {
        _ = try await APIClient.shared.delete("\(G)/memory-verses/\(id)", as: OkResponse.self)
    }

    static func plans() async throws -> [PlanListItem] {
        try await APIClient.shared.get("\(G)/plans", as: DataList<PlanListItem>.self).data
    }
    static func plan(_ id: String) async throws -> PlanDetail {
        try await APIClient.shared.get("\(G)/plans/\(id)", as: PlanDetail.self)
    }
    static func createPlan(_ b: PlanBody) async throws {
        _ = try await APIClient.shared.post("\(G)/plans", body: b, as: OkResponse.self)
    }
    static func updatePlan(_ id: String, _ b: PlanBody) async throws {
        _ = try await APIClient.shared.put("\(G)/plans/\(id)", body: b, as: OkResponse.self)
    }
    static func deletePlan(_ id: String) async throws {
        _ = try await APIClient.shared.delete("\(G)/plans/\(id)", as: OkResponse.self)
    }

    static func resources() async throws -> [ResourceFull] {
        try await APIClient.shared.get("\(G)/resources", as: DataList<ResourceFull>.self).data
    }
    static func createResource(_ b: ResourceBody) async throws {
        _ = try await APIClient.shared.post("\(G)/resources", body: b, as: OkResponse.self)
    }
    static func updateResource(_ id: String, _ b: ResourceBody) async throws {
        _ = try await APIClient.shared.put("\(G)/resources/\(id)", body: b, as: OkResponse.self)
    }
    static func deleteResource(_ id: String) async throws {
        _ = try await APIClient.shared.delete("\(G)/resources/\(id)", as: OkResponse.self)
    }

    static func dailyVerses() async throws -> [DailyVerseFull] {
        try await APIClient.shared.get("\(G)/daily-verses", as: DataList<DailyVerseFull>.self).data
    }
    static func updateDailyVerse(_ dayIndex: Int, _ b: DailyVerseBody) async throws {
        _ = try await APIClient.shared.put("\(G)/daily-verses/\(dayIndex)", body: b, as: OkResponse.self)
    }
}

// Picker option lists (web VERSIONS / PLAN_CATEGORIES / RESOURCE_KINDS).
private let VERSIONS = ["WEB", "NIV", "ESV", "KJV", "NLT", "MSG"]
private let PLAN_CATEGORIES = ["Foundations", "Growth", "Prayer", "Devotion", "Topical"]
private let RESOURCE_KINDS = ["book", "audio", "video", "article"]
private let SEGMENT_KINDS = ["devotional", "scripture", "video", "talk", "reading"]

// MARK: - Row shell
//
// Rebuilt for the ROWS redesign (Pass v4 → Content Studio): every item is a single
// FULL-WIDTH ROW laid out left-to-right — a tinted icon chip, the title + subtitle,
// the section's meta chips, an optional one-line body preview, the status pill, and
// a trailing ⋯ menu (Edit / Delete / Add). Rows live inside one white `Card(padding:0)`
// with hairline dividers between them, like the other list/table pages. Rows stay
// compact (~56–64pt), columns align across rows, and everything truncates so the
// whole row fits portrait (~740pt). Cohesive with the shared kit (Card, Pill,
// TintedIcon, Nuru tokens) — navy + gold accents only; status pills stay semantic.

// The trailing ⋯ row menu: Edit, Delete (destructive; omitted where onDelete is
// nil — e.g. the edit-only daily-verses section), and Add (new item in this
// section, same create path as the top "New …" button). Styled as a subtle navy
// control on a light rounded hit area.
private struct RowMenu: View {
    var onEdit: () -> Void
    var onDelete: (() -> Void)? = nil
    var onAdd: (() -> Void)? = nil
    var body: some View {
        Menu {
            Button { onEdit() } label: { Label("Edit", systemImage: "pencil") }
            if let onAdd {
                Button { onAdd() } label: { Label("Add", systemImage: "plus") }
            }
            if let onDelete {
                Divider()
                Button(role: .destructive) { onDelete() } label: { Label("Delete", systemImage: "trash") }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Nuru.navy)
                .frame(width: 34, height: 34)
                .background(Nuru.navy.opacity(0.06))
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }
}

// Non-interactive hero identity label for the current section (gold-tinted, like
// HeroChip's `.tag` style but NOT a button — so it can't read as a dead control
// next to the real "New" button).
private struct HeroTagLabel: View {
    let label: String
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 6) {
            if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
            Text(label).font(.inter(11.5, .bold)).textCase(.uppercase)
        }
        .padding(.horizontal, 12).frame(height: 32)
        .foregroundStyle(Nuru.goldGlow)
        .background(Nuru.gold.opacity(0.14))
        .overlay(Capsule().stroke(Nuru.gold.opacity(0.25), lineWidth: 1))
        .clipShape(Capsule())
    }
}

// A small inline meta chip (icon + value, tinted) used along the row.
private struct MetricChip: View {
    let icon: String
    let text: String
    var color: Color = Nuru.ink600
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: icon).font(.system(size: 10.5, weight: .semibold))
            Text(text).font(.inter(11.5, .medium)).lineLimit(1)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 9).padding(.vertical, 5)
        .background(color.opacity(0.10))
        .clipShape(Capsule())
        .fixedSize()
    }
}

// A status pill: Active/Published (success) vs Inactive/Draft (muted). Tappable
// so it doubles as the quick active/publish toggle the web exposes in its form.
private struct StatusPill: View {
    let on: Bool
    var onLabel = "Active"
    var offLabel = "Inactive"
    var onTap: (() -> Void)?
    var body: some View {
        let pill = Pill(text: on ? onLabel : offLabel, color: on ? Nuru.success : Nuru.ink600)
        if let onTap {
            Button(action: onTap) { pill }.buttonStyle(.plain)
        } else { pill }
    }
}

// The generic full-width row: icon chip → (title + subtitle) → meta chips →
// optional body preview → status pill → ⋯ menu. One row per item.
private struct ContentRow<Meta: View>: View {
    let accent: Color
    let icon: String
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var meta: Meta
    var preview: String? = nil
    var status: (on: Bool, onLabel: String, offLabel: String, onTap: () -> Void)?
    var onEdit: () -> Void
    var onDelete: (() -> Void)? = nil
    var onAdd: (() -> Void)? = nil

    var body: some View {
        HStack(spacing: 12) {
            TintedIcon(systemName: icon, color: accent, size: 40)

            // Title + subtitle column (fixed-ish left identity block).
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.85)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.85)
                }
            }
            .frame(minWidth: 120, idealWidth: 180, maxWidth: 220, alignment: .leading)

            // Meta chips, aligned across rows.
            HStack(spacing: 6) { meta }
                .layoutPriority(0.5)

            // One-line body preview when space allows.
            if let preview, !preview.isEmpty {
                Text(preview)
                    .font(.inter(11.5)).foregroundStyle(Nuru.ink600)
                    .lineLimit(1).truncationMode(.tail)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Spacer(minLength: 0)
            }

            // Status pill (semantic).
            if let status {
                StatusPill(on: status.on, onLabel: status.onLabel,
                           offLabel: status.offLabel, onTap: status.onTap)
                    .fixedSize()
            }

            // Trailing ⋯ menu.
            RowMenu(onEdit: onEdit, onDelete: onDelete, onAdd: onAdd)
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 60)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

// MARK: - Section rows

private struct DevotionalRowView: View {
    let d: DevotionalFull
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onAdd: () -> Void
    var onToggle: () -> Void
    private let accent = Nuru.navy     // devotionals = navy (brand)
    var body: some View {
        ContentRow(
            accent: accent, icon: "book.fill",
            title: d.title.isEmpty ? "Untitled devotional" : d.title,
            subtitle: d.series,
            meta: {
                MetricChip(icon: "calendar", text: "Day \(d.dayNumber)", color: accent)
                if let r = d.scriptureRef, !r.isEmpty {
                    MetricChip(icon: "text.quote", text: r, color: Nuru.gold)
                }
            },
            preview: d.body,
            status: (d.isPublished, "Published", "Draft", onToggle),
            onEdit: onEdit, onDelete: onDelete, onAdd: onAdd)
    }
}

private struct VerseRowView: View {
    let v: VerseFull
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onAdd: () -> Void
    var onToggle: () -> Void
    private let accent = Nuru.gold
    var body: some View {
        ContentRow(
            accent: accent, icon: "quote.bubble.fill",
            title: v.reference.isEmpty ? "Untitled verse" : v.reference,
            subtitle: v.version.isEmpty ? "Memory verse" : "\(v.version) · to memorise",
            meta: {
                if !v.version.isEmpty { MetricChip(icon: "book.closed", text: v.version, color: accent) }
                if let w = v.weekNumber { MetricChip(icon: "calendar", text: "Week \(w)", color: Nuru.ink600) }
            },
            preview: v.verseText.isEmpty ? nil : "“\(v.verseText)”",
            status: (v.isActive, "Active", "Inactive", onToggle),
            onEdit: onEdit, onDelete: onDelete, onAdd: onAdd)
    }
}

private struct DailyVerseRow: View {
    let d: DailyVerseFull
    var onEdit: () -> Void
    private var dateLabel: String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let date = f.date(from: d.dayDate) else { return d.dayDate }
        return date.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).year())
    }
    private let accent = Nuru.navy
    var body: some View {
        // Daily verses are edit-only (no delete, no add) — onEdit only.
        ContentRow(
            accent: accent, icon: "calendar",
            title: d.reference.isEmpty ? "Day \(d.dayIndex)" : d.reference,
            subtitle: d.dayDate.isEmpty ? "Day \(d.dayIndex)" : "Day \(d.dayIndex) · \(dateLabel)",
            meta: {
                if !d.version.isEmpty { MetricChip(icon: "book.closed", text: d.version, color: accent) }
                if let t = d.theme, !t.isEmpty { MetricChip(icon: "sparkles", text: t, color: Nuru.ink600) }
            },
            preview: d.verseText.isEmpty ? nil : "“\(d.verseText)”",
            status: nil,
            onEdit: onEdit)
    }
}

private struct PlanRowView: View {
    let p: PlanListItem
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onAdd: () -> Void
    var onToggle: () -> Void
    private let accent = Nuru.gold     // reading plans = gold (brand)
    var body: some View {
        ContentRow(
            accent: accent, icon: "calendar.badge.clock",
            title: p.title.isEmpty ? "Untitled plan" : p.title,
            subtitle: p.subtitle,
            meta: {
                MetricChip(icon: "list.bullet.rectangle",
                           text: "\(p.dayCount) day\(p.dayCount == 1 ? "" : "s")", color: accent)
                if let c = p.category, !c.isEmpty {
                    MetricChip(icon: "folder", text: c, color: Nuru.navy)
                }
                if !p.code.isEmpty {
                    MetricChip(icon: "number", text: p.code, color: Nuru.ink600)
                }
            },
            preview: p.description,
            status: (p.isActive, "Active", "Inactive", onToggle),
            onEdit: onEdit, onDelete: onDelete, onAdd: onAdd)
    }
}

private struct ResourceRow: View {
    let r: ResourceFull
    var onEdit: () -> Void
    var onDelete: () -> Void
    var onAdd: () -> Void
    var onToggle: () -> Void
    private var icon: String {
        switch r.kind {
        case "book":    return "book"
        case "audio":   return "music.note"
        case "video":   return "video"
        case "article": return "doc.text"
        default:        return "doc.text"
        }
    }
    private let accent = Nuru.navy     // resources = navy (brand)
    var body: some View {
        ContentRow(
            accent: accent, icon: icon,
            title: r.title.isEmpty ? "Untitled resource" : r.title,
            subtitle: (r.author?.isEmpty == false ? r.author : r.kind.capitalized),
            meta: {
                MetricChip(icon: icon, text: r.kind.capitalized, color: accent)
                if let dur = r.durationLabel, !dur.isEmpty {
                    MetricChip(icon: "clock", text: dur, color: Nuru.ink600)
                }
                if r.url?.isEmpty == false {
                    MetricChip(icon: "link", text: "Link", color: Nuru.gold)
                }
            },
            status: (r.isActive, "Active", "Inactive", onToggle),
            onEdit: onEdit, onDelete: onDelete, onAdd: onAdd)
    }
}

// MARK: - Empty state (web EmptyState — now with a New button)

private struct EmptyStateView: View {
    let tab: ContentStudioView.Tab
    var canCreate: Bool = true
    var onNew: (() -> Void)?
    var body: some View {
        VStack(spacing: 8) {
            TintedIcon(systemName: tab.icon, color: tab.accent, size: 56)
                .padding(.bottom, 6)
            Text("No \(tab.label.lowercased()) yet").font(.inter(16, .bold)).foregroundStyle(Nuru.navy)
            Text("Create your first \(tab.singular) to publish it to the mobile app.")
                .font(.nCaption).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center).frame(maxWidth: 340)
            if canCreate, let onNew {
                Button(action: onNew) {
                    Label("New \(tab.singular)", systemImage: "plus")
                        .font(.inter(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 16).frame(height: 38)
                        .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain).padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 56).padding(.horizontal, 24)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous)
            .strokeBorder(Nuru.border, style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
    }
}

// MARK: - Bright form kit (Pass v6 — roomy, readable editor sheets)
//
// Shared styling so the Content Studio editor sheets read like the bright web forms:
// warm cream behind a hidden Form chrome, white field rows with visible borders, dark
// readable labels, navy section headers, gold Save, and paired fields in two columns
// to cut scrolling. Navy + gold scheme. Layout/typography only — no binding changes.

private extension View {
    func csFormSheet() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .tint(Nuru.gold)
            .presentationDetents([.large])
    }
}

private struct CSSectionHeader: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.inter(12, .bold)).tracking(0.8).foregroundStyle(Nuru.navy).padding(.bottom, 2)
    }
}

/// Bright white labelled field cell — dark-ink overline + a bordered white control.
private struct CSFieldCell<Content: View>: View {
    let label: String
    var required = false
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11, .bold)).foregroundStyle(Nuru.gold) }
            }
            content
                .font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12).frame(minHeight: 40)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}

private struct CSFieldPair<L: View, R: View>: View {
    @ViewBuilder var left: L
    @ViewBuilder var right: R
    var body: some View { HStack(alignment: .top, spacing: 14) { left; right } }
}

/// Multi-line bright editor cell (TextField axis:.vertical) with label + border.
private struct CSTextAreaCell: View {
    let label: String
    var required = false
    var placeholder: String
    @Binding var text: String
    var lines: ClosedRange<Int> = 3...6
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 3) {
                Text(label.uppercased()).font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(11, .bold)).foregroundStyle(Nuru.gold) }
            }
            TextField(placeholder, text: $text, axis: .vertical).lineLimit(lines)
                .font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}

private struct CSControlTile<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        content
            .padding(.horizontal, 12).frame(minHeight: 44)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}

// MARK: - Edit / create forms (web EditModal per type)

// Devotional form — web DevotionalForm. Required: day_number, title, body.
private struct DevotionalForm: View {
    let row: DevotionalFull?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var dayNumber = "1"
    @State private var series = ""
    @State private var title = ""
    @State private var scriptureRef = ""
    @State private var reflectionPrompt = ""
    @State private var scriptureText = ""
    @State private var bodyText = ""
    @State private var audioUrl = ""
    @State private var videoUrl = ""
    @State private var isPublished = false
    @State private var saving = false
    @State private var error: String?

    private var isEdit: Bool { row != nil }
    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty &&
        !bodyText.trimmingCharacters(in: .whitespaces).isEmpty &&
        Int(dayNumber.trimmingCharacters(in: .whitespaces)) != nil
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
                }
                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Day number", required: true) { TextField("1", text: $dayNumber).keyboardType(.numberPad) }
                    } right: {
                        CSFieldCell(label: "Series") { TextField("Foundations of Faith", text: $series) }
                    }
                    CSFieldCell(label: "Title", required: true) { TextField("A New Creation", text: $title) }
                    CSFieldPair {
                        CSFieldCell(label: "Scripture ref") { TextField("2 Corinthians 5:17", text: $scriptureRef) }
                    } right: {
                        CSFieldCell(label: "Reflection") { TextField("Where have you seen…", text: $reflectionPrompt) }
                    }
                } header: { CSSectionHeader(text: "Devotional") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSTextAreaCell(label: "Scripture text", placeholder: "Therefore, if anyone is in Christ…", text: $scriptureText, lines: 2...4)
                    CSTextAreaCell(label: "Body", required: true, placeholder: "Write the devotional…", text: $bodyText, lines: 4...10)
                } header: { CSSectionHeader(text: "Content") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Audio URL") { TextField("https://", text: $audioUrl).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    } right: {
                        CSFieldCell(label: "Video URL") { TextField("https://", text: $videoUrl).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    }
                } header: { CSSectionHeader(text: "Media") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSControlTile { Toggle("Published to members", isOn: $isPublished).tint(Nuru.gold) }
                }
                .listRowBackground(Color.clear)
            }
            .csFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit devotional" : "New devotional")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.font(.inter(15, .semibold)).disabled(!canSave || saving)
                }
            }
            .onAppear(perform: prime)
        }
    }

    private func prime() {
        guard let r = row else { return }
        dayNumber = String(r.dayNumber); series = r.series ?? ""; title = r.title
        scriptureRef = r.scriptureRef ?? ""; reflectionPrompt = r.reflectionPrompt ?? ""
        scriptureText = r.scriptureText ?? ""; bodyText = r.body
        audioUrl = r.audioUrl ?? ""; videoUrl = r.videoUrl ?? ""; isPublished = r.isPublished
    }
    private func save() async {
        saving = true; error = nil
        let b = DevotionalBody(
            dayNumber: Int(dayNumber.trimmingCharacters(in: .whitespaces)) ?? 1,
            title: title.trimmingCharacters(in: .whitespaces),
            body: bodyText.trimmingCharacters(in: .whitespaces),
            isPublished: isPublished,
            series: series.trimmingCharacters(in: .whitespaces),
            scriptureRef: scriptureRef.trimmingCharacters(in: .whitespaces),
            scriptureText: scriptureText.trimmingCharacters(in: .whitespaces),
            reflectionPrompt: reflectionPrompt.trimmingCharacters(in: .whitespaces),
            audioUrl: audioUrl.trimmingCharacters(in: .whitespaces),
            videoUrl: videoUrl.trimmingCharacters(in: .whitespaces))
        do {
            if let r = row { try await GrowthAPI.updateDevotional(r.devotionalId, b) }
            else { try await GrowthAPI.createDevotional(b) }
            saving = false; onDone(); dismiss()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false }
    }
}

// Memory verse form — web VerseForm. Required: reference, verse_text.
private struct VerseForm: View {
    let row: VerseFull?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var reference = ""
    @State private var version = "WEB"
    @State private var verseText = ""
    @State private var weekNumber = ""
    @State private var releaseDate = ""   // YYYY-MM-DD
    @State private var hasDate = false
    @State private var date = Date()
    @State private var sort = ""
    @State private var isActive = true
    @State private var saving = false
    @State private var error: String?

    private var isEdit: Bool { row != nil }
    private var canSave: Bool {
        !reference.trimmingCharacters(in: .whitespaces).isEmpty &&
        !verseText.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
                }
                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Reference", required: true) { TextField("John 15:5", text: $reference) }
                    } right: {
                        CSFieldCell(label: "Version") {
                            Picker("", selection: $version) { ForEach(VERSIONS, id: \.self) { Text($0).tag($0) } }
                                .labelsHidden().pickerStyle(.menu).tint(Nuru.navy).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    CSTextAreaCell(label: "Verse text", required: true, placeholder: "I am the vine…", text: $verseText, lines: 3...6)
                } header: { CSSectionHeader(text: "Memory verse") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Week number") { TextField("1", text: $weekNumber).keyboardType(.numberPad) }
                    } right: {
                        CSFieldCell(label: "Sort") { TextField("1", text: $sort).keyboardType(.numberPad) }
                    }
                    CSControlTile { Toggle("Set release date", isOn: $hasDate).tint(Nuru.gold) }
                    if hasDate {
                        CSControlTile { DatePicker("Date", selection: $date, displayedComponents: .date).tint(Nuru.gold) }
                    }
                } header: { CSSectionHeader(text: "Scheduling") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSControlTile { Toggle("Active", isOn: $isActive).tint(Nuru.gold) }
                }
                .listRowBackground(Color.clear)
            }
            .csFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit verse" : "New verse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.font(.inter(15, .semibold)).disabled(!canSave || saving)
                }
            }
            .onAppear(perform: prime)
        }
    }

    private func prime() {
        guard let r = row else { return }
        reference = r.reference; version = r.version.isEmpty ? "WEB" : r.version; verseText = r.verseText
        weekNumber = r.weekNumber.map(String.init) ?? ""
        sort = r.sort.map(String.init) ?? ""; isActive = r.isActive
        if let rd = r.releaseDate, !rd.isEmpty {
            releaseDate = rd; hasDate = true
            let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
            if let parsed = f.date(from: String(rd.prefix(10))) { date = parsed }
        }
    }
    private func save() async {
        saving = true; error = nil
        var rd = ""
        if hasDate { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; rd = f.string(from: date) }
        let b = VerseBody(
            reference: reference.trimmingCharacters(in: .whitespaces),
            version: version,
            verseText: verseText.trimmingCharacters(in: .whitespaces),
            isActive: isActive,
            weekNumber: Int(weekNumber.trimmingCharacters(in: .whitespaces)),
            releaseDate: rd,
            sort: Int(sort.trimmingCharacters(in: .whitespaces)))
        do {
            if let r = row { try await GrowthAPI.updateVerse(r.memoryVerseId, b) }
            else { try await GrowthAPI.createVerse(b) }
            saving = false; onDone(); dismiss()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false }
    }
}

// Daily verse form — web DailyVerseForm (edit-only; PUT /daily-verses/{dayIndex}).
private struct DailyVerseForm: View {
    let row: DailyVerseFull
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var theme = ""
    @State private var version = "WEB"
    @State private var reference = ""
    @State private var verseText = ""
    @State private var saving = false
    @State private var error: String?

    private var dayLabel: String {
        guard !row.dayDate.isEmpty else { return "Day \(row.dayIndex)" }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        guard let d = f.date(from: row.dayDate) else { return "Day \(row.dayIndex)" }
        return "Day \(row.dayIndex) · " + d.formatted(.dateTime.weekday().day().month(.wide).year())
    }
    private var canSave: Bool {
        !reference.trimmingCharacters(in: .whitespaces).isEmpty &&
        !verseText.trimmingCharacters(in: .whitespaces).isEmpty &&
        !version.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
                }
                SwiftUI.Section {
                    CSControlTile {
                        HStack(spacing: 8) {
                            Image(systemName: "calendar").font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.gold)
                            Text(dayLabel).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        }
                    }
                } header: { CSSectionHeader(text: "Day") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Theme") { TextField("JOY & HAPPINESS", text: $theme) }
                    } right: {
                        CSFieldCell(label: "Version") {
                            Picker("", selection: $version) { ForEach(VERSIONS, id: \.self) { Text($0).tag($0) } }
                                .labelsHidden().pickerStyle(.menu).tint(Nuru.navy).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    CSFieldCell(label: "Reference", required: true) { TextField("Nehemiah 8:10", text: $reference) }
                    CSTextAreaCell(label: "Verse text", required: true, placeholder: "Do not grieve, for the joy of the LORD…", text: $verseText, lines: 3...6)
                } header: { CSSectionHeader(text: "Daily verse") }
                .listRowBackground(Color.clear)
            }
            .csFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle("Edit daily verse")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.font(.inter(15, .semibold)).disabled(!canSave || saving)
                }
            }
            .onAppear(perform: prime)
        }
    }

    private func prime() {
        theme = row.theme ?? ""; version = row.version.isEmpty ? "WEB" : row.version
        reference = row.reference; verseText = row.verseText
    }
    private func save() async {
        saving = true; error = nil
        let b = DailyVerseBody(
            theme: theme.trimmingCharacters(in: .whitespaces),
            reference: reference.trimmingCharacters(in: .whitespaces),
            version: version,
            verseText: verseText.trimmingCharacters(in: .whitespaces),
            dayDate: row.dayDate)
        do {
            try await GrowthAPI.updateDailyVerse(row.dayIndex, b)
            saving = false; onDone(); dismiss()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false }
    }
}

// Resource form — web ResourceForm. Required: title.
private struct ResourceForm: View {
    let row: ResourceFull?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var author = ""
    @State private var kind = "book"
    @State private var durationLabel = ""
    @State private var sort = ""
    @State private var url = ""
    @State private var isActive = true
    @State private var saving = false
    @State private var error: String?

    private var isEdit: Bool { row != nil }
    private var canSave: Bool { !title.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
                }
                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Title", required: true) { TextField("Mere Christianity", text: $title) }
                    } right: {
                        CSFieldCell(label: "Author") { TextField("C. S. Lewis", text: $author) }
                    }
                    CSFieldPair {
                        CSFieldCell(label: "Kind") {
                            Picker("", selection: $kind) { ForEach(RESOURCE_KINDS, id: \.self) { Text($0.capitalized).tag($0) } }
                                .labelsHidden().pickerStyle(.menu).tint(Nuru.navy).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    } right: {
                        CSFieldCell(label: "Duration") { TextField("12 min", text: $durationLabel) }
                    }
                    CSFieldPair {
                        CSFieldCell(label: "Sort") { TextField("1", text: $sort).keyboardType(.numberPad) }
                    } right: {
                        CSFieldCell(label: "URL") { TextField("https://", text: $url).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    }
                } header: { CSSectionHeader(text: "Resource") }
                .listRowBackground(Color.clear)

                SwiftUI.Section {
                    CSControlTile { Toggle("Active", isOn: $isActive).tint(Nuru.gold) }
                }
                .listRowBackground(Color.clear)
            }
            .csFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit resource" : "New resource")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.font(.inter(15, .semibold)).disabled(!canSave || saving)
                }
            }
            .onAppear(perform: prime)
        }
    }

    private func prime() {
        guard let r = row else { return }
        title = r.title; author = r.author ?? ""; kind = r.kind.isEmpty ? "book" : r.kind
        durationLabel = r.durationLabel ?? ""; sort = r.sort.map(String.init) ?? ""
        url = r.url ?? ""; isActive = r.isActive
    }
    private func save() async {
        saving = true; error = nil
        let b = ResourceBody(
            title: title.trimmingCharacters(in: .whitespaces),
            kind: kind, isActive: isActive,
            author: author.trimmingCharacters(in: .whitespaces),
            durationLabel: durationLabel.trimmingCharacters(in: .whitespaces),
            url: url.trimmingCharacters(in: .whitespaces),
            sort: Int(sort.trimmingCharacters(in: .whitespaces)))
        do {
            if let r = row { try await GrowthAPI.updateResource(r.resourceId, b) }
            else { try await GrowthAPI.createResource(b) }
            saving = false; onDone(); dismiss()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false }
    }
}

// Reading plan form — web PlanForm (scalar fields + nested days & segments).
// Required: code, title. On edit, days load lazily from GET /plans/{id}.
private struct PlanForm: View {
    let row: PlanListItem?
    let onDone: () -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var code = ""
    @State private var category = "Foundations"
    @State private var title = ""
    @State private var subtitle = ""
    @State private var description = ""
    @State private var imageUrl = ""
    @State private var sort = ""
    @State private var isActive = true
    @State private var days: [DayDraft] = []
    @State private var loadedDays = false
    @State private var saving = false
    @State private var error: String?

    private var isEdit: Bool { row != nil }
    private var canSave: Bool {
        !code.trimmingCharacters(in: .whitespaces).isEmpty &&
        !title.trimmingCharacters(in: .whitespaces).isEmpty
    }

    // Editable draft mirrors web PlanDayRow / PlanSegmentRow.
    struct SegDraft: Identifiable {
        let id = UUID()
        var kind = "devotional"
        var title = ""
        var reference = ""
        var content = ""
        var videoUrl = ""
    }
    struct DayDraft: Identifiable {
        let id = UUID()
        var dayNumber = 1
        var reference = ""
        var title = ""
        var content = ""
        var segments: [SegDraft] = []
    }

    var body: some View {
        NavigationStack {
            Form {
                if let error {
                    SwiftUI.Section { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }.listRowBackground(Color.clear)
                }
                SwiftUI.Section {
                    CSFieldPair {
                        CSFieldCell(label: "Code", required: true) { TextField("NEW-BELIEVER-21", text: $code).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    } right: {
                        CSFieldCell(label: "Category") {
                            Picker("", selection: $category) { ForEach(PLAN_CATEGORIES, id: \.self) { Text($0).tag($0) } }
                                .labelsHidden().pickerStyle(.menu).tint(Nuru.navy).frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    CSFieldCell(label: "Title", required: true) { TextField("First 21 Days", text: $title) }
                    CSFieldCell(label: "Subtitle") { TextField("A gentle on-ramp for new believers", text: $subtitle) }
                    CSTextAreaCell(label: "Description", placeholder: "Describe the plan…", text: $description, lines: 2...5)
                    CSFieldPair {
                        CSFieldCell(label: "Cover image") { TextField("https://", text: $imageUrl).textInputAutocapitalization(.never).autocorrectionDisabled() }
                    } right: {
                        CSFieldCell(label: "Sort") { TextField("1", text: $sort).keyboardType(.numberPad) }
                    }
                    CSControlTile { Toggle("Active", isOn: $isActive).tint(Nuru.gold) }
                } header: { CSSectionHeader(text: "Plan") }
                .listRowBackground(Color.clear)

                daysSection
            }
            .csFormSheet()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
            .background(Nuru.paper)
            .navigationTitle(isEdit ? "Edit plan" : "New plan")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.font(.inter(15, .semibold)).disabled(!canSave || saving)
                }
            }
            .task { await prime() }
        }
    }

    @ViewBuilder private var daysSection: some View {
        SwiftUI.Section {
            ForEach($days) { $day in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("DAY").font(.inter(11, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        TextField("#", value: $day.dayNumber, format: .number).frame(width: 56).keyboardType(.numberPad)
                            .font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                        Spacer()
                        Button(role: .destructive) { days.removeAll { $0.id == day.id } } label: { Image(systemName: "trash") }
                            .buttonStyle(.plain).foregroundStyle(Nuru.danger)
                    }
                    TextField("Reference (e.g. John 3:1-16)", text: $day.reference).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                    TextField("Day title", text: $day.title).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                    ForEach($day.segments) { $seg in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Picker("Kind", selection: $seg.kind) { ForEach(SEGMENT_KINDS, id: \.self) { Text($0).tag($0) } }
                                    .labelsHidden().pickerStyle(.menu).tint(Nuru.navy)
                                Spacer()
                                Button(role: .destructive) { $day.segments.wrappedValue.removeAll { $0.id == seg.id } } label: { Image(systemName: "minus.circle") }
                                    .buttonStyle(.plain).foregroundStyle(Nuru.danger)
                            }
                            TextField("Segment title", text: $seg.title).font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                            TextField("Reference (optional)", text: $seg.reference).font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                            TextField("Video URL (optional)", text: $seg.videoUrl).textInputAutocapitalization(.never).autocorrectionDisabled().font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                            TextField("Content (markdown)", text: $seg.content, axis: .vertical).lineLimit(1...4).font(.inter(14, .regular)).foregroundStyle(Nuru.ink)
                        }
                        .padding(10)
                        .background(Nuru.surface)
                        .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 9, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                    Button { $day.segments.wrappedValue.append(SegDraft()) } label: { Label("Segment", systemImage: "plus") }
                        .font(.inter(12, .semibold)).buttonStyle(.plain).foregroundStyle(Nuru.gold)
                }
                .padding(12)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
            Button { days.append(DayDraft(dayNumber: days.count + 1)) } label: { Label("Add day", systemImage: "plus") }
                .font(.inter(14, .semibold)).buttonStyle(.plain).foregroundStyle(Nuru.navy)
        } header: { CSSectionHeader(text: "Plan days & segments") }
        .listRowBackground(Color.clear)
    }

    private func prime() async {
        guard let r = row else {
            // New plan starts with one blank day, mirroring the web default.
            if days.isEmpty { days = [DayDraft()] }
            loadedDays = true
            return
        }
        code = r.code; category = r.category ?? "Foundations"; title = r.title
        subtitle = r.subtitle ?? ""; description = r.description ?? ""; imageUrl = r.imageUrl ?? ""
        sort = r.sort.map(String.init) ?? ""; isActive = r.isActive
        if !loadedDays, let detail = try? await GrowthAPI.plan(r.planId) {
            days = (detail.days ?? []).map { d in
                DayDraft(dayNumber: d.dayNumber, reference: d.reference, title: d.title ?? "",
                         content: d.content ?? "",
                         segments: (d.segments ?? []).map { s in
                             SegDraft(kind: s.kind.isEmpty ? "devotional" : s.kind, title: s.title,
                                      reference: s.reference ?? "", content: s.content ?? "", videoUrl: s.videoUrl ?? "")
                         })
            }
            loadedDays = true
        }
    }

    private func save() async {
        saving = true; error = nil
        // Web: keep only days with a reference, only segments with a title.
        let payloadDays: [PlanDayPayload] = days.enumerated().compactMap { (di, d) in
            let ref = d.reference.trimmingCharacters(in: .whitespaces)
            guard !ref.isEmpty else { return nil }
            let segs: [PlanSegmentPayload] = d.segments.enumerated().compactMap { (si, s) in
                let st = s.title.trimmingCharacters(in: .whitespaces)
                guard !st.isEmpty else { return nil }
                return PlanSegmentPayload(
                    sort: si, kind: s.kind, title: st,
                    reference: s.reference.isEmpty ? nil : s.reference,
                    content: s.content.isEmpty ? nil : s.content,
                    videoUrl: s.videoUrl.isEmpty ? nil : s.videoUrl)
            }
            return PlanDayPayload(
                dayNumber: d.dayNumber > 0 ? d.dayNumber : di + 1, reference: ref,
                title: d.title.isEmpty ? nil : d.title,
                content: d.content.isEmpty ? nil : d.content,
                segments: segs)
        }
        // Web: edit sends days only when non-empty; create always sends days.
        let daysArg: [PlanDayPayload]? = isEdit ? (payloadDays.isEmpty ? nil : payloadDays) : payloadDays
        let b = PlanBody(
            code: code.trimmingCharacters(in: .whitespaces),
            title: title.trimmingCharacters(in: .whitespaces),
            isActive: isActive, category: category,
            subtitle: subtitle.trimmingCharacters(in: .whitespaces),
            description: description.trimmingCharacters(in: .whitespaces),
            imageUrl: imageUrl.trimmingCharacters(in: .whitespaces),
            sort: Int(sort.trimmingCharacters(in: .whitespaces)),
            days: daysArg)
        do {
            if let r = row { try await GrowthAPI.updatePlan(r.planId, b) }
            else { try await GrowthAPI.createPlan(b) }
            saving = false; onDone(); dismiss()
        } catch { self.error = (error as? APIError)?.errorDescription ?? "Could not save."; saving = false }
    }
}

