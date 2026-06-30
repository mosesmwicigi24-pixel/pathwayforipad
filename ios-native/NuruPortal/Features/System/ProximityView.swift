// Proximity — "Nearby & pairing" (#4 Proximity, Phase 3). An admin-only System
// page that surfaces members who live near each other so a discipler can pair
// them into the same cell, and no one is discipled in isolation.
//
// PRIVACY-FIRST — this view consumes GET /admin/members/proximity?radius_km= which
// returns COARSE clusters only: an area label, a member count, an approximate
// radius, and the members in each cluster. The endpoint NEVER returns precise
// coordinates; this view neither receives nor renders any. Everything here is a
// SUGGESTION the admin approves — clustering never auto-creates or auto-assigns.
//
// Look: matches the People Intelligence / Finance pages — navy ceremony hero, white
// cards on warm paper, pastel TintedIcon chips, Monogram member rows, brand palette
// only (navy + gold + bright lumGreen), no off-brand blue. Resilient/additive
// decoding: every field defaults if missing so a partial payload still renders.
import SwiftUI

// MARK: - ===================== Payload (resilient decoders) =====================
// APIClient uses convertFromSnakeCase, so snake_case keys map to camelCase here.

private struct ProxMember: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @DefaultFalse var isMinor: Bool
    let cellGroupId: String?
    var id: String { userId.isEmpty ? fullName : userId }
}

private struct ProxCluster: Codable, Identifiable {
    @DefaultEmpty var area: String
    @DefaultZero var memberCount: Int
    @DefaultZeroD var approxRadiusKm: Double
    private let membersRaw: [ProxMember]?
    var members: [ProxMember] { membersRaw ?? [] }
    // Stable id from the area + count so SwiftUI can diff clusters across reloads.
    var id: String { "\(area)#\(memberCount)" }
    enum CodingKeys: String, CodingKey {
        case area, memberCount, approxRadiusKm, membersRaw = "members"
    }
}

private struct ProxPayload: Codable {
    private let clustersRaw: [ProxCluster]?
    var clusters: [ProxCluster] { clustersRaw ?? [] }
    enum CodingKeys: String, CodingKey { case clustersRaw = "clusters" }
}

// Conditional JSON body for the member-assignment PATCH (mirrors the web object literal).
private enum JSONValue: Encodable {
    case string(String), int(Int), bool(Bool), null
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .int(let v): try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
}
private struct OkResponse: Decodable {}

// MARK: - API

private enum ProximityAPI {
    static func clusters(radiusKm: Double) async throws -> ProxPayload {
        try await APIClient.shared.get("/admin/members/proximity",
                                       query: ["radius_km": Self.radiusParam(radiusKm)],
                                       as: ProxPayload.self)
    }
    /// Create a cell (reuses the same POST /admin/cells the Cell Engagement page uses).
    static func createCell(name: String, disciplerName: String) async throws -> EngagementCellRow {
        let body = CellCreateBody(name: name, disciplerName: disciplerName,
                                  disciplerRole: "Lead discipler",
                                  levelLabel: "Level 1 · New Life", tone: "amber")
        return try await APIClient.shared.post("/admin/cells", body: body, as: EngagementCellRow.self)
    }
    /// Assign a member to a cell via the member-edit path (PATCH /admin/members/{id}).
    static func assign(_ userId: String, to cellGroupId: String) async throws {
        _ = try await APIClient.shared.patch("/admin/members/\(userId)",
                                             body: ["cell_group_id": JSONValue.string(cellGroupId)],
                                             as: OkResponse.self)
    }
    private static func radiusParam(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v.rounded())) : String(format: "%.1f", v)
    }
}

/// Minimal create body — only what POST /admin/cells requires (snake_cased on encode).
private struct CellCreateBody: Encodable {
    let name: String
    let disciplerName: String
    let disciplerRole: String
    let levelLabel: String
    let tone: String
}

// MARK: - ===================== ProximityView =====================

struct ProximityView: View {
    @State private var payload: ProxPayload?
    @State private var loaded = false
    @State private var error: String?
    @State private var forbidden = false
    @State private var radiusKm: Double = 3        // default 3 km

    private let radiusOptions: [Double] = [1, 3, 5, 10, 25]
    @State private var createTarget: ProxCluster?

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                hero
                VStack(spacing: 18) {
                    radiusControl
                    if forbidden {
                        permissionState
                    } else if let error, payload == nil {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if !loaded && payload == nil {
                        SkeletonList(rows: 4)
                    } else if let p = payload {
                        let clusters = p.clusters
                            .filter { !$0.members.isEmpty || $0.memberCount > 0 }
                            .sorted { $0.memberCount > $1.memberCount }
                        if clusters.isEmpty {
                            emptyState
                        } else {
                            ForEach(clusters) { c in
                                ClusterCard(cluster: c) { createTarget = c }
                            }
                            privacyFootnote
                        }
                    }
                }
                .padding(.horizontal, Nuru.S.lg)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, 48)
            }
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load() } }
        .refreshable { await load() }
        .sheet(item: $createTarget) { cluster in
            CreateCellFromClusterSheet(cluster: cluster) { await load() }
        }
    }

    private func load() async {
        do {
            payload = try await ProximityAPI.clusters(radiusKm: radiusKm)
            error = nil; forbidden = false
        } catch {
            let apiError = error as? APIError
            if case .http(let status, _)? = apiError, status == 403 {
                forbidden = true
            } else {
                self.error = apiError?.errorDescription ?? "Could not load nearby groups."
            }
        }
        loaded = true
    }

    // MARK: hero

    private var hero: some View {
        let clusterCount = payload?.clusters.count ?? 0
        let nearbyMembers = payload?.clusters.reduce(0) { $0 + $1.memberCount } ?? 0
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 6) {
                Text("System").font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                Image(systemName: "chevron.right").font(.system(size: 8)).foregroundStyle(Nuru.onNavyFaint)
                Text("Nearby & pairing").font(.nMicro).foregroundStyle(.white)
                Spacer(minLength: 8)
                HeroChip(label: "Admin only", icon: "lock.fill", style: .tag)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("PROXIMITY & PAIRING").font(.nOverline).tracking(1.8).foregroundStyle(Nuru.goldGlow)
                Text("Nearby & pairing").font(.nDisplay).foregroundStyle(.white)
                Text("Members who opted in to location sharing, grouped into coarse nearby clusters so you can pair them into the same cell. Suggestions only — no precise location is ever shown, and nothing is assigned without your approval.")
                    .font(.nBody).foregroundStyle(Nuru.onNavyDim).fixedSize(horizontal: false, vertical: true)
            }
            if !forbidden { heroStatStrip(clusters: clusterCount, members: nearbyMembers) }
        }
        .padding(.horizontal, Nuru.S.lg).padding(.top, 22).padding(.bottom, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.navyCeremony)
    }

    private func heroStatStrip(clusters: Int, members: Int) -> some View {
        let items: [(label: String, value: String, hint: String)] = [
            ("Nearby groups", "\(clusters)", "within \(radiusLabel)"),
            ("Members nearby", "\(members)", "opted in to sharing"),
            ("Radius", radiusLabel, "coarse area only"),
        ]
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 1)], spacing: 1) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.label.uppercased()).font(.nOverline).tracking(1.0)
                        .foregroundStyle(Nuru.onNavyDim).lineLimit(1).minimumScaleFactor(0.85)
                    Text(item.value).font(.inter(15, .semibold)).foregroundStyle(.white)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text(item.hint).font(.nMicro).foregroundStyle(Nuru.onNavyFaint)
                        .lineLimit(1).minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
                .padding(.horizontal, 12).padding(.vertical, 10)
                .background(Color.white.opacity(0.04))
            }
        }
        .background(Color.white.opacity(0.06))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
    }

    private var radiusLabel: String {
        radiusKm == radiusKm.rounded() ? "\(Int(radiusKm)) km" : String(format: "%.1f km", radiusKm)
    }

    // MARK: radius control

    private var radiusControl: some View {
        Card(padding: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    TintedIcon(systemName: "scope", color: Nuru.navy, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Search radius").font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        Text("How close members must be to be grouped together").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 0)
                    Text(radiusLabel).font(.fraunces(18, .semibold)).foregroundStyle(Nuru.navy)
                }
                HStack(spacing: 8) {
                    ForEach(radiusOptions, id: \.self) { km in
                        let selected = km == radiusKm
                        Button {
                            guard !selected else { return }
                            radiusKm = km
                            Task { await load() }
                        } label: {
                            Text(km == km.rounded() ? "\(Int(km)) km" : String(format: "%.1f km", km))
                                .font(.inter(13, selected ? .bold : .medium))
                                .foregroundStyle(selected ? .white : Nuru.ink600)
                                .frame(maxWidth: .infinity).frame(height: 38)
                                .background(selected ? AnyShapeStyle(Nuru.goldGradient) : AnyShapeStyle(Nuru.surface))
                                .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous)
                                    .stroke(selected ? Color.clear : Nuru.border, lineWidth: 1))
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: empty / permission states

    private var emptyState: some View {
        Card(padding: 28) {
            VStack(spacing: 14) {
                TintedIcon(systemName: "person.2.wave.2", color: Color(hex: 0x0F6B33), size: 56)
                Text("No nearby groups yet").font(.fraunces(20, .semibold)).foregroundStyle(Nuru.navy)
                Text("No nearby groups yet — members appear here once they opt in to location sharing.")
                    .font(.inter(13)).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
    }

    private var permissionState: some View {
        Card(padding: 28) {
            VStack(spacing: 14) {
                TintedIcon(systemName: "lock.shield", color: Nuru.gold, size: 56)
                Text("You don't have access to this").font(.fraunces(20, .semibold)).foregroundStyle(Nuru.navy)
                Text("Proximity matching is limited to your assigned scope. Ask an administrator if you need to see nearby groups beyond the cells you lead.")
                    .font(.inter(13)).foregroundStyle(Nuru.ink600).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                Button { Task { await load() } } label: {
                    Text("Try again").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                        .padding(.horizontal, 20).padding(.vertical, 11)
                        .background(Nuru.white)
                        .overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                        .clipShape(Capsule())
                }
            }
            .frame(maxWidth: 440)
            .frame(maxWidth: .infinity)
        }
    }

    private var privacyFootnote: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: "hand.raised.fill").font(.system(size: 10)).foregroundStyle(Nuru.ink400).padding(.top, 1)
            Text("Privacy-first: only coarse area labels and approximate radii are shown — never precise coordinates. Pairing a cell is always a suggestion you approve.")
                .font(.inter(11)).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.top, 2)
    }
}

// MARK: - ===================== Cluster card =====================

private struct ClusterCard: View {
    let cluster: ProxCluster
    let onCreate: () -> Void

    private var radiusText: String {
        let r = cluster.approxRadiusKm
        if r <= 0 { return "approx. area" }
        return r == r.rounded() ? "~\(Int(r)) km across" : String(format: "~%.1f km across", r)
    }
    private var unassignedCount: Int { cluster.members.filter { ($0.cellGroupId ?? "").isEmpty }.count }

    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                // Header — coarse area label + count + approx radius
                HStack(spacing: 12) {
                    TintedIcon(systemName: "mappin.and.ellipse", color: Color(hex: 0x1D4E86), size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(cluster.area.isEmpty ? "Nearby area" : cluster.area)
                            .font(.inter(15, .bold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.8)
                        HStack(spacing: 8) {
                            Label("\(cluster.memberCount) nearby", systemImage: "person.2.fill")
                                .font(.nMicro).foregroundStyle(Nuru.ink600).labelStyle(.titleAndIcon)
                            Text("·").foregroundStyle(Nuru.ink300)
                            Text(radiusText).font(.nMicro).foregroundStyle(Nuru.ink600)
                        }
                    }
                    Spacer(minLength: 8)
                    if unassignedCount > 0 {
                        Pill(text: "\(unassignedCount) unassigned", color: Color(hex: 0x0F6B33))
                    }
                }
                .padding(.horizontal, 16).padding(.top, 16).padding(.bottom, 12)
                Divider().overlay(Nuru.border)

                // Member list — Monogram + name, subtle minor marker, current cell if present
                if cluster.members.isEmpty {
                    Text("Members are grouped here but not individually listed.")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                } else {
                    ForEach(Array(cluster.members.enumerated()), id: \.element.id) { i, m in
                        memberRow(m, zebra: i % 2 == 1)
                        if i < cluster.members.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                    }
                }

                Divider().overlay(Nuru.border)
                // Create-a-cell action (human-in-the-loop — opens an approval sheet)
                Button(action: onCreate) {
                    HStack(spacing: 8) {
                        Image(systemName: "plus.circle.fill").font(.system(size: 15, weight: .semibold))
                        Text("Create a cell from this group").font(.inter(14, .bold))
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
                    }
                    .foregroundStyle(Nuru.navy)
                    .padding(.horizontal, 16).padding(.vertical, 14)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func memberRow(_ m: ProxMember, zebra: Bool) -> some View {
        let name = m.fullName.isEmpty ? "Member" : m.fullName
        let hasCell = !(m.cellGroupId ?? "").isEmpty
        return HStack(spacing: 12) {
            Monogram(name: name, size: 34, gradient: Nuru.navyGradient)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.85)
                    if m.isMinor {
                        // Subtle minor marker — guardian consent gates pairing.
                        HStack(spacing: 3) {
                            Image(systemName: "figure.child").font(.system(size: 8, weight: .bold))
                            Text("Minor").font(.system(size: 9, weight: .bold))
                        }
                        .foregroundStyle(Nuru.gold)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Nuru.gold.opacity(0.12)).clipShape(Capsule())
                    }
                }
                if hasCell {
                    HStack(spacing: 4) {
                        Image(systemName: "person.3.fill").font(.system(size: 8)).foregroundStyle(Nuru.ink400)
                        Text("Currently in a cell").font(.nMicro).foregroundStyle(Nuru.ink400)
                    }
                } else {
                    Text("Unassigned").font(.nMicro).foregroundStyle(Color(hex: 0x0F6B33))
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16).frame(minHeight: 52)
        .background(zebra ? Nuru.surface.opacity(0.45) : Color.clear)
    }
}

// MARK: - ===================== Create-cell-from-cluster sheet =====================
// Human-in-the-loop: the admin names the cell + discipler, reviews which members
// to include (each toggleable, minors flagged), then confirms. We then create the
// cell (POST /admin/cells) and assign each selected member to it via the member-edit
// path (PATCH /admin/members/{id} { cell_group_id }). Suggestion → approve, never
// automatic. Members who can't be assigned are surfaced so the admin can follow up.

private struct CreateCellFromClusterSheet: View {
    let cluster: ProxCluster
    let onDone: () async -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var cellName: String
    @State private var discipler = ""
    @State private var included: Set<String>
    @State private var saving = false
    @State private var error: String?
    @State private var resultNote: String?

    init(cluster: ProxCluster, onDone: @escaping () async -> Void) {
        self.cluster = cluster
        self.onDone = onDone
        _cellName = State(initialValue: cluster.area.isEmpty ? "" : "\(cluster.area) Cell")
        // Pre-select members who aren't already in a cell.
        _included = State(initialValue: Set(cluster.members
            .filter { ($0.cellGroupId ?? "").isEmpty }
            .map { $0.id }))
    }

    private var selectedMembers: [ProxMember] { cluster.members.filter { included.contains($0.id) } }
    private var minorSelected: Bool { selectedMembers.contains { $0.isMinor } }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let error {
                        banner(error, color: Nuru.danger, icon: "exclamationmark.triangle.fill")
                    }
                    if let resultNote {
                        banner(resultNote, color: Color(hex: 0x0F6B33), icon: "checkmark.circle.fill")
                    }

                    // Coarse-area context (no coordinates).
                    Card(padding: 16) {
                        HStack(spacing: 12) {
                            TintedIcon(systemName: "mappin.and.ellipse", color: Color(hex: 0x1D4E86), size: 38)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(cluster.area.isEmpty ? "Nearby area" : cluster.area)
                                    .font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
                                Text("\(cluster.memberCount) members nearby · suggestion only")
                                    .font(.nMicro).foregroundStyle(Nuru.ink600)
                            }
                            Spacer(minLength: 0)
                        }
                    }

                    section("New cell") {
                        VStack(spacing: 12) {
                            field("Cell name", required: true) {
                                TextField("e.g. Lakeview Cell", text: $cellName).textFieldStyle(.plain)
                            }
                            field("Discipler", required: true) {
                                TextField("e.g. Mary Wanjiru", text: $discipler).textFieldStyle(.plain)
                            }
                        }
                    }

                    section("Members to add (\(selectedMembers.count) of \(cluster.members.count))") {
                        VStack(spacing: 0) {
                            ForEach(Array(cluster.members.enumerated()), id: \.element.id) { i, m in
                                memberToggle(m)
                                if i < cluster.members.count - 1 { Divider().overlay(Nuru.border.opacity(0.6)) }
                            }
                        }
                    }

                    if minorSelected {
                        banner("One or more selected members are minors. Confirm guardian consent before pairing them into a cell.",
                               color: Nuru.gold, icon: "figure.child")
                    }
                }
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 24).padding(.vertical, 22)
            }
            .scrollContentBackground(.hidden)
            .background(Nuru.paper)
            .navigationTitle("Create a cell")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.tint(Nuru.ink600)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Creating…" : "Create & pair") { Task { await submit() } }
                        .font(.inter(14, .bold)).tint(Nuru.gold).disabled(saving)
                }
            }
        }
    }

    private func memberToggle(_ m: ProxMember) -> some View {
        let name = m.fullName.isEmpty ? "Member" : m.fullName
        let hasCell = !(m.cellGroupId ?? "").isEmpty
        let on = included.contains(m.id)
        return Button {
            if on { included.remove(m.id) } else { included.insert(m.id) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 20)).foregroundStyle(on ? Nuru.lumGreen : Nuru.ink300)
                Monogram(name: name, size: 32, gradient: Nuru.navyGradient)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(name).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        if m.isMinor { Pill(text: "Minor", color: Nuru.gold) }
                    }
                    Text(hasCell ? "Currently in a cell — pairing will move them" : "Unassigned")
                        .font(.nMicro).foregroundStyle(hasCell ? Nuru.warning : Color(hex: 0x0F6B33))
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 14).frame(minHeight: 54)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func submit() async {
        let name = cellName.trimmingCharacters(in: .whitespaces)
        let lead = discipler.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { error = "A cell name is required."; return }
        guard !lead.isEmpty else { error = "A discipler is required."; return }
        guard !selectedMembers.isEmpty else { error = "Select at least one member to pair."; return }
        saving = true; error = nil; resultNote = nil
        do {
            let created = try await ProximityAPI.createCell(name: name, disciplerName: lead)
            guard !created.cellGroupId.isEmpty else {
                error = "The cell was created but no id came back, so members weren't paired automatically. Add them from the Members page."
                saving = false; return
            }
            var failed: [String] = []
            for m in selectedMembers {
                guard !m.userId.isEmpty else { failed.append(m.fullName.isEmpty ? "a member" : m.fullName); continue }
                do { try await ProximityAPI.assign(m.userId, to: created.cellGroupId) }
                catch { failed.append(m.fullName.isEmpty ? "a member" : m.fullName) }
            }
            await onDone()
            if failed.isEmpty {
                dismiss()
            } else {
                // Cell created, but some assignments didn't take — surface them.
                resultNote = "Cell created. Couldn't pair: \(failed.joined(separator: ", ")). Add them from the Members page."
                saving = false
            }
        } catch {
            self.error = "Could not create the cell. "
                + ((error as? APIError)?.errorDescription ?? error.localizedDescription)
            saving = false
        }
    }

    // Small form primitives (local — don't touch the shared kit).
    private func section<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title.uppercased()).font(.nOverline).tracking(1.2).foregroundStyle(Nuru.ink600)
            Card(padding: 14) { content() }
        }
    }
    private func field<C: View>(_ label: String, required: Bool = false, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 3) {
                Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink600)
                if required { Text("*").font(.inter(12, .bold)).foregroundStyle(Nuru.danger) }
            }
            content()
                .font(.inter(15)).foregroundStyle(Nuru.ink)
                .padding(.horizontal, 12).frame(height: 44)
                .background(Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
    private func banner(_ text: String, color: Color, icon: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(color).padding(.top, 1)
            Text(text).font(.inter(13, .medium)).foregroundStyle(color).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12).frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
