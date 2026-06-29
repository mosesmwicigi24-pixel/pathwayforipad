// Cell Engagement — native port of the web CellEngagement.tsx: a navy hero with a
// 4-stat strip and action chips, the "Cell roster" grid of cell cards (each a
// NavigationLink into CellDetailView), an engagement leaderboard, and an at-risk
// watch list. Wired to PortalAPI.engagement() → EngagementReport.cells.
import SwiftUI

// Tone palette mirrors the web (TONES) — deterministic per cell id so a cell keeps
// the same accent colour across the roster, leaderboard and watch list.
private let cellTones: [Color] = [
    Color(hex: 0x16A34A), Color(hex: 0x0B84E8), Color(hex: 0x7C3AED),
    Color(hex: 0xC89B3C), Color(hex: 0xDC2626), Color(hex: 0x0D9488),
]
private func toneOf(_ id: String) -> Color {
    var h = 0
    for ch in id.unicodeScalars { h = (h &* 31 &+ Int(ch.value)) % cellTones.count }
    return cellTones[((h % cellTones.count) + cellTones.count) % cellTones.count]
}
private func cellInitials(_ name: String) -> String {
    let cleaned = name.replacingOccurrences(
        of: #"^(pastor|rev|dr|mr|mrs|ms)\.?\s+"#, with: "",
        options: [.regularExpression, .caseInsensitive])
    let parts = cleaned.split(separator: " ").prefix(2).compactMap { $0.first }
    return parts.isEmpty ? "C" : String(parts).uppercased()
}
private func engPct(_ v: Double) -> Int { Int((v).rounded()) }

// MARK: - Page state (mirrors CellEngagement.tsx's load/handleCreate/handleUpdate/
// toggleFeatured). Refetches the engagement report after every write so the derived
// metrics + single-featured invariant reflect server truth.
@MainActor
private final class CellEngagementViewModel: ObservableObject {
    @Published var cells: [EngagementCellRow] = []
    @Published var loading = true
    @Published var error: String?
    // EngagementCellRow (shared model) lacks is_featured, so we track which cell is
    // featured locally, keyed by cell_group_id, refreshed from each homepage write.
    @Published var featuredId: String?
    @Published var featuringId: String?

    func load() async {
        loading = true
        do {
            cells = try await PortalAPI.engagement().cells
            error = nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }

    // Toggle the homepage-featured cell ("This week at Nuru"). The server keeps the
    // single-featured invariant; we reflect it locally (POST sets, DELETE clears).
    func toggleFeatured(_ cell: EngagementCellRow) async {
        guard featuringId == nil else { return }
        featuringId = cell.cellGroupId
        error = nil
        do {
            if featuredId == cell.cellGroupId {
                _ = try await APIClient.shared.delete("/admin/cells/\(cell.cellGroupId)/homepage", as: FeaturedResult.self)
                featuredId = nil
            } else {
                _ = try await APIClient.shared.postEmpty("/admin/cells/\(cell.cellGroupId)/homepage", as: FeaturedResult.self)
                featuredId = cell.cellGroupId
            }
        } catch {
            self.error = "Could not update the homepage-featured cell. " + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
        featuringId = nil
    }
}

/// Tolerant response for the homepage feature endpoints ({ is_featured: bool }).
private struct FeaturedResult: Decodable { @DefaultFalse var isFeatured: Bool }

struct CellEngagementView: View {
    @StateObject private var vm = CellEngagementViewModel()
    @EnvironmentObject private var router: NavRouter
    @State private var addOpen = false
    @State private var editCell: EngagementCellRow?
    private let grid = [GridItem(.adaptive(minimum: 280), spacing: 16)]

    var body: some View {
        Group {
            if vm.loading && vm.cells.isEmpty {
                ScrollView { SkeletonList(rows: 6).padding(Nuru.S.screen) }
            } else if let error = vm.error, vm.cells.isEmpty {
                ScrollView { ErrorBanner(message: error) { Task { await vm.load() } }.padding(Nuru.S.screen) }
            } else {
                content
            }
        }
        .background(Nuru.paper)
        .portalPage("Cell Engagement")
        .task { if vm.cells.isEmpty { await vm.load() } }
        .refreshable { await vm.load() }
        .sheet(isPresented: $addOpen) {
            CellModalSheet(cell: nil) { await vm.load() }
        }
        .sheet(item: $editCell) { cell in
            CellModalSheet(cell: cell) { await vm.load() }
        }
    }

    private var content: some View {
        let cells = vm.cells
        let totalMembers = cells.reduce(0) { $0 + $1.members }
        let totalAtRisk = cells.reduce(0) { $0 + $1.atRisk }
        let overallAvg = totalMembers > 0
            ? Int((cells.reduce(0.0) { $0 + $1.avgEngagement * Double($1.members) } / Double(totalMembers)).rounded())
            : 0
        let ranked = cells.sorted { $0.avgEngagement > $1.avgEngagement }
        let byRisk = cells.sorted { $0.atRisk > $1.atRisk }

        return ScrollView {
            VStack(spacing: 18) {
                PortalHero(
                    breadcrumb: ["Nuru Pathway", "Operations", "Cell Engagement"],
                    eyebrow: "Cells & disciplers",
                    title: "Cell Engagement",
                    subtitle: "A high-level read on how every cell is doing. Open a cell to see its members, progress and activity in detail.",
                    stats: [
                        HeroStat(label: "Active cells", value: "\(cells.count)", hint: "with members"),
                        HeroStat(label: "Disciples", value: "\(totalMembers)", hint: "across all cells"),
                        HeroStat(label: "At-risk", value: "\(totalAtRisk)", hint: "need pastoral call"),
                        HeroStat(label: "Avg engagement", value: "\(overallAvg)%", hint: "all cells"),
                    ]
                ) {
                    HStack(spacing: 8) {
                        // "Pastoral overview" has no destination in the web (static tag) — leave inert.
                        HeroChip(label: "Pastoral overview", icon: "sparkles", style: .tag)
                        // Web: navigate("/reflection-queue").
                        HeroChip(label: "Action queue", icon: "arrow.up.right", style: .ghost) { router.go(.reflectionQueue) }
                        // Web: setAddOpen(true) → CellModal (create).
                        HeroChip(label: "New Cell", icon: "plus", style: .gold) { addOpen = true }
                    }
                }

                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .bottom) {
                        SectionHeader(overline: "Cell roster", title: "Cells & their disciplers")
                        // Web: second "New cell" button next to the section heading.
                        Button { addOpen = true } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "plus").font(.system(size: 12, weight: .bold))
                                Text("New cell").font(.inter(12.5, .bold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 12).frame(height: 34)
                            .background(Nuru.gold)
                            .clipShape(Capsule())
                        }
                        .buttonStyle(.plain)
                        .fixedSize()
                    }

                    if cells.isEmpty {
                        Text("No cells with engagement data yet.")
                            .font(.nCaption).foregroundStyle(Nuru.muted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        LazyVGrid(columns: grid, spacing: 16) {
                            ForEach(cells) { cell in
                                CellCard(
                                    cell: cell,
                                    isFeatured: vm.featuredId == cell.cellGroupId,
                                    isFeaturing: vm.featuringId == cell.cellGroupId,
                                    onEdit: { editCell = cell },
                                    onToggleFeatured: { Task { await vm.toggleFeatured(cell) } }
                                )
                            }
                        }
                    }

                    if !cells.isEmpty {
                        leaderboard(ranked)
                        atRiskList(byRisk)
                    }
                }
                .padding(.horizontal, 20)
            }
            .padding(.bottom, 40)
        }
        .background(Nuru.paper)
    }

    // Cell engagement leaderboard — ranked by average engagement.
    private func leaderboard(_ ranked: [EngagementCellRow]) -> some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: "chart.line.uptrend.xyaxis", color: Nuru.success, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("PERFORMANCE").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.goldLo)
                        Text("Cell engagement leaderboard").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
                VStack(spacing: 16) {
                    ForEach(Array(ranked.enumerated()), id: \.element.id) { idx, cell in
                        let avg = engPct(cell.avgEngagement)
                        NavigationLink {
                            CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                HStack {
                                    HStack(spacing: 8) {
                                        ZStack {
                                            Circle().fill(Nuru.navy)
                                            Text("\(idx + 1)").font(.inter(11, .bold)).foregroundStyle(.white)
                                        }.frame(width: 24, height: 24)
                                        Text(cell.name).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                                    }
                                    Spacer()
                                    Text("\(avg)%").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                                }
                                ProgressBar(pct: Double(avg), fill: toneOf(cell.cellGroupId), height: 10)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Ranked by average engagement. Tap a cell to drill in.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }

    // At-risk by cell — prioritise pastoral calls where the count is highest.
    private func atRiskList(_ byRisk: [EngagementCellRow]) -> some View {
        Card(padding: 24) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 10) {
                    TintedIcon(systemName: "exclamationmark.circle", color: Nuru.danger, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("NEEDS ATTENTION").font(.nOverline).tracking(1.4).foregroundStyle(Nuru.goldLo)
                        Text("At-risk by cell").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
                VStack(spacing: 12) {
                    ForEach(byRisk) { cell in
                        let tone = toneOf(cell.cellGroupId)
                        NavigationLink {
                            CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 11, style: .continuous).fill(tone.opacity(0.12))
                                    Text(cellInitials(cell.name)).font(.inter(11, .bold)).foregroundStyle(tone)
                                }.frame(width: 36, height: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(cell.name).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                    Text("\(cell.members) members").font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                if cell.atRisk > 0 {
                                    Pill(text: "\(cell.atRisk) at-risk", color: Nuru.danger)
                                } else {
                                    Pill(text: "Healthy", color: Nuru.success)
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 12)
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }
                Text("Prioritise pastoral calls where the at-risk count is highest.")
                    .font(.nMicro).foregroundStyle(Nuru.muted)
            }
        }
    }
}

// MARK: - Cell roster card

private struct CellCard: View {
    let cell: EngagementCellRow
    let isFeatured: Bool
    let isFeaturing: Bool
    let onEdit: () -> Void
    let onToggleFeatured: () -> Void
    var body: some View {
        let tone = toneOf(cell.cellGroupId)
        let avg = engPct(cell.avgEngagement)
        return Card(padding: 20) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(tone.opacity(0.12))
                        Text(cellInitials(cell.name)).font(.inter(15, .bold)).foregroundStyle(tone)
                    }.frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cell.name).font(.inter(16, .bold)).foregroundStyle(Nuru.navy).lineLimit(2)
                        Text("\(cell.members) members").font(.inter(11.5, .semibold)).foregroundStyle(Nuru.muted)
                    }
                    Spacer(minLength: 0)
                    HStack(spacing: 6) {
                        // Edit cell → CellModal (PATCH /admin/cells/{id}).
                        Button(action: onEdit) {
                            HStack(spacing: 3) {
                                Image(systemName: "pencil").font(.system(size: 9, weight: .bold))
                                Text("Edit").font(.inter(11, .bold))
                            }
                            .foregroundStyle(Nuru.navy)
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                        // View → CellDetailView.
                        NavigationLink {
                            CellDetailView(cellGroupId: cell.cellGroupId, name: cell.name)
                        } label: {
                            HStack(spacing: 3) {
                                Text("View").font(.inter(11, .bold)).foregroundStyle(Nuru.navy)
                                Image(systemName: "chevron.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.navy)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 5)
                            .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                        }
                        .buttonStyle(.plain)
                    }
                }

                // "Feature on homepage" toggle (POST/DELETE /admin/cells/{id}/homepage).
                Button(action: onToggleFeatured) {
                    HStack(spacing: 6) {
                        Image(systemName: isFeatured ? "star.fill" : "star").font(.system(size: 10))
                        Text(isFeatured ? "Homepage · This week" : "Feature on homepage").font(.inter(11, .bold))
                    }
                    .foregroundStyle(isFeatured ? .white : Nuru.muted)
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .background(isFeatured ? Nuru.gold : Color.black.opacity(0.03))
                    .overlay(Capsule().stroke(isFeatured ? Nuru.gold : Nuru.border, lineWidth: 1))
                    .clipShape(Capsule())
                    .opacity(isFeaturing ? 0.6 : 1)
                }
                .buttonStyle(.plain)
                .disabled(isFeaturing)

                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("AVG ENGAGEMENT").font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
                        Text("\(avg)%").font(.fraunces(32, .semibold)).foregroundStyle(Nuru.navy)
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 6) {
                        HStack(spacing: 4) {
                            Image(systemName: "person.2.fill").font(.system(size: 11)).foregroundStyle(tone)
                            Text("\(cell.members) members").font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                        }
                        if cell.atRisk > 0 {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.circle.fill").font(.system(size: 10))
                                Text("\(cell.atRisk) at-risk").font(.inter(11, .bold))
                            }
                            .foregroundStyle(Nuru.danger)
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Nuru.danger.opacity(0.08))
                            .clipShape(Capsule())
                        } else {
                            Text("All on track").font(.inter(11, .semibold)).foregroundStyle(Nuru.success)
                        }
                    }
                }

                ProgressBar(pct: Double(avg), fill: tone, height: 8)
            }
        }
    }
}

// MARK: - Cell create/edit sheet (web CellModal → POST /admin/cells, PATCH /admin/cells/{id})

private let cellRoleOptions = ["Lead discipler", "Discipler", "Assistant discipler"]
private let cellLevelOptions = [
    "Level 1 · New Life", "Level 2 · Foundations", "Level 3 · Walking in Faith",
    "Level 4 · Serving Others", "Level 5 · Multiplier Track",
]
private let cellToneOptions: [(key: String, hex: UInt32)] = [
    ("amber", 0xC89B3C), ("blue", 0x1F3A6B), ("green", 0x16A34A),
    ("violet", 0x7C3AED), ("rose", 0xDB2777), ("red", 0xDC2626),
]

/// Request body for POST/PATCH /admin/cells (snake_case via encoder.convertToSnakeCase).
/// Optional fields omitted when blank, like the web's spread builder.
private struct CellWriteBody: Encodable {
    let name: String
    let disciplerName: String
    let disciplerRole: String
    let levelLabel: String
    let tone: String
    let focus: String?
    let meets: String?
    let room: String?
    let nextSession: String?
}

private struct CellModalSheet: View {
    let cell: EngagementCellRow?          // nil → create
    let onSaved: () async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var discipler: String
    @State private var disciplerRole: String
    @State private var level: String
    @State private var focus = ""
    @State private var meets = ""
    @State private var room = ""
    @State private var nextSession = ""
    @State private var tone: String
    @State private var featureOnHomepage = false
    @State private var saving = false
    @State private var error: String?

    init(cell: EngagementCellRow?, onSaved: @escaping () async -> Void) {
        self.cell = cell
        self.onSaved = onSaved
        // Prefill what the shared EngagementCellRow carries (name, discipler, level).
        // role/focus/meets/room/next_session/tone aren't on the slim model, so they
        // start empty on edit — see NEEDS.
        _name = State(initialValue: cell?.name ?? "")
        _discipler = State(initialValue: cell?.disciplerName ?? "")
        _disciplerRole = State(initialValue: cellRoleOptions[0])
        _level = State(initialValue: cell?.levelLabel ?? cellLevelOptions[1])
        _tone = State(initialValue: "amber")
    }

    private var editing: Bool { cell != nil }

    var body: some View {
        NavigationStack {
            Form {
                SwiftUI.Section {
                    TextField("e.g. Lakeview Cell", text: $name)
                    TextField("e.g. Mary Wanjiru", text: $discipler)
                } header: { Text("Cell name & discipler") }

                SwiftUI.Section {
                    Picker("Discipler role", selection: $disciplerRole) {
                        ForEach(cellRoleOptions, id: \.self) { Text($0).tag($0) }
                    }
                    Picker("Curriculum level", selection: $level) {
                        ForEach(cellLevelOptions, id: \.self) { Text($0).tag($0) }
                    }
                } header: { Text("Assignment") }

                SwiftUI.Section {
                    TextField("Focus — e.g. New believers", text: $focus)
                    TextField("Meets — e.g. Tue · 6:30 PM", text: $meets)
                    TextField("Room / venue — e.g. Hall B", text: $room)
                    TextField("Next session — e.g. Tue, Jun 24 · 6:30 PM", text: $nextSession)
                } header: { Text("How it meets") }

                SwiftUI.Section {
                    Picker("Card colour", selection: $tone) {
                        ForEach(cellToneOptions, id: \.key) { opt in
                            HStack {
                                Circle().fill(Color(hex: opt.hex)).frame(width: 14, height: 14)
                                Text(opt.key.capitalized)
                            }.tag(opt.key)
                        }
                    }
                } header: { Text("Appearance") }

                if !editing {
                    SwiftUI.Section {
                        Toggle(isOn: $featureOnHomepage) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Feature on homepage").font(.inter(13, .bold))
                                Text("Show this cell in “This week at Nuru” on members’ home screens.")
                                    .font(.inter(11.5)).foregroundStyle(Nuru.muted)
                            }
                        }
                    }
                }

                if let error {
                    SwiftUI.Section { Text(error).font(.inter(12)).foregroundStyle(Nuru.danger) }
                }
            }
            .navigationTitle(editing ? "Edit cell" : "Register a new cell")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? (editing ? "Saving…" : "Registering…") : (editing ? "Save" : "Register")) {
                        Task { await submit() }
                    }
                    .disabled(saving)
                }
            }
        }
    }

    private func submit() async {
        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let trimmedDiscipler = discipler.trimmingCharacters(in: .whitespaces)
        guard !trimmedName.isEmpty else { error = "Cell name is required."; return }
        guard !trimmedDiscipler.isEmpty else { error = "A discipler is required."; return }
        func nilIfBlank(_ s: String) -> String? {
            let t = s.trimmingCharacters(in: .whitespaces); return t.isEmpty ? nil : t
        }
        let body = CellWriteBody(
            name: trimmedName, disciplerName: trimmedDiscipler, disciplerRole: disciplerRole,
            levelLabel: level, tone: tone,
            focus: nilIfBlank(focus), meets: nilIfBlank(meets),
            room: nilIfBlank(room), nextSession: nilIfBlank(nextSession)
        )
        error = nil; saving = true
        do {
            if let cell {
                _ = try await APIClient.shared.patch("/admin/cells/\(cell.cellGroupId)", body: body, as: EngagementCellRow.self)
            } else {
                let created = try await APIClient.shared.post("/admin/cells", body: body, as: EngagementCellRow.self)
                if featureOnHomepage {
                    // Set the new cell featured (server keeps single-featured invariant).
                    _ = try? await APIClient.shared.postEmpty("/admin/cells/\(created.cellGroupId)/homepage", as: FeaturedResult.self)
                }
            }
            await onSaved()
            dismiss()
        } catch {
            self.error = (editing ? "Could not update the cell. " : "Could not register the cell. ")
                + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
            saving = false
        }
    }
}
