// Flock Brief — the native port of the web portal's FlockBrief.tsx (Shepherd's
// Pulse): the leader's weekly composed brief on stationery paper + the live
// care-signals feed. Instructor+ see THEIR flock (cells they lead + direct
// disciples, §5.4); Admin/SuperAdmin see all signals and can run the scan /
// brief batch now. Signals carry a one-line summary and coarse tone only —
// never full text; the reflection itself stays in the Reflection Queue.
// Wire (PortalAPI Flock Brief section): GET /admin/intelligence/flock-brief ·
// GET /admin/intelligence/signals?since_days=14 · POST …/signals/{id}/ack ·
// POST …/signals/scan · POST …/flock-brief/run.
// Mac: workspace width, two lanes — brief reading column | signals table.
import SwiftUI

// MARK: - Severity / kind styling (the web's SEV + KIND_ICON maps)

private enum FB {
    static func severity(_ s: String) -> (label: String, fg: Color, bg: Color, border: Color) {
        switch s {
        case "urgent": return ("URGENT", Color(hex: 0xB91C1C), Color(hex: 0xFEE2E2), Color(hex: 0xFECACA))
        case "watch":  return ("WATCH", Color(hex: 0x92400E), Color(hex: 0xFEF3C7), Color(hex: 0xFDE68A))
        default:       return ("NOTE", Color(hex: 0x047857), Color(hex: 0xECFDF5), Color(hex: 0xA7F3D0))
        }
    }
    static func kind(_ k: String) -> (icon: String, tint: Color) {
        switch k {
        case "crisis":     return ("exclamationmark.triangle.fill", Color(hex: 0xDC2626))
        case "drift_risk": return ("cloud.drizzle.fill", Color(hex: 0xD97706))
        default:           return ("face.smiling", Color(hex: 0x059669))   // emotion
        }
    }
    // Stationery paper palette (the web's brief card).
    static let paperTop = Color(hex: 0xFFFDF6)
    static let paperBottom = Color(hex: 0xF8F3E6)
    static let paperBorder = Color(hex: 0xF2E2BD)
    static let paperEyebrow = Color(hex: 0xA8861C)
    static let paperInk = Color(hex: 0x2A3441)
}

// MARK: - View

struct FlockBriefView: View {
    @EnvironmentObject private var auth: AuthStore
    @State private var brief: FlockBrief?
    @State private var signals: [PulseSignal] = []
    @State private var loaded = false
    @State private var error: String?
    @State private var running: RunKind?
    @State private var ackBusy: Set<String> = []
    @State private var toast: ToastData?

    private enum RunKind { case scan, briefs }

    private var isAdmin: Bool {
        let role = auth.profile?.role ?? ""
        return role == "Admin" || role == "SuperAdmin"
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                heroBlock
                VStack(spacing: 18) {
                    if let error, !loadedAnything {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if !loaded {
                        SkeletonList(rows: 6)
                    } else {
                        lanes
                    }
                }
                .padding(.horizontal, MacDesign.isMac ? 0 : Nuru.S.lg)
                .padding(.top, Nuru.S.lg)
                .padding(.bottom, 48)
            }
            // Workspace page on the Mac: fill the window (margins only) — the
            // two-lane brief/signals composition takes the width.
            .macContentColumn(MacDesign.workspaceMaxWidth)
        }
        .background(Nuru.paper)
        .navigationBarTitleDisplayMode(.inline)
        .task { if !loaded { await load() } }
        .refreshable { await load() }
        .toast($toast)
    }

    private var loadedAnything: Bool { brief != nil || !signals.isEmpty }

    // MARK: load / actions

    /// Both reads run concurrently and fail independently (mirrors the web's
    /// per-call .catch): only when BOTH fail on a cold screen do we show the
    /// retryable error state.
    private func load() async {
        let briefTask = Task { try await PortalAPI.flockBrief() }
        let signalsTask = Task { try await PortalAPI.pulseSignals(sinceDays: 14) }
        var firstError: String?
        var failures = 0
        do { brief = try await briefTask.value } catch {
            failures += 1
            firstError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        do { signals = try await signalsTask.value } catch {
            failures += 1
            if firstError == nil { firstError = (error as? APIError)?.errorDescription ?? error.localizedDescription }
        }
        error = failures == 2 ? (firstError ?? "Could not load the flock brief.") : nil
        loaded = true
    }

    private func ack(_ s: PulseSignal) {
        guard !ackBusy.contains(s.signalId) else { return }
        ackBusy.insert(s.signalId)
        Task {
            do {
                try await PortalAPI.ackPulseSignal(s.signalId)
                if let i = signals.firstIndex(where: { $0.signalId == s.signalId }) {
                    withAnimation(.easeOut(duration: 0.2)) {
                        signals[i].acknowledgedAt = ISO8601DateFormatter().string(from: Date())
                    }
                }
            } catch {
                toast = .error((error as? APIError)?.errorDescription ?? "Could not acknowledge that signal.")
            }
            ackBusy.remove(s.signalId)
        }
    }

    private func run(_ which: RunKind) {
        guard running == nil else { return }
        running = which
        Task {
            do {
                switch which {
                case .scan:
                    let r = try await PortalAPI.runPulseScan()
                    toast = .success("Scan done — \(r.flagged) flagged, \(r.crises) crises, \(r.drift) drifting.")
                case .briefs:
                    let r = try await PortalAPI.runFlockBriefs()
                    toast = .success("Briefs composed — \(r.written) written, \(r.skipped) skipped.")
                }
                await load()
            } catch {
                toast = .error((error as? APIError)?.errorDescription ?? "Could not run that right now.")
            }
            running = nil
        }
    }

    // MARK: hero

    /// Full-bleed navy on iPad; floats with card corners inside the Mac column.
    @ViewBuilder private var heroBlock: some View {
        if MacDesign.isMac {
            hero
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
                .padding(.top, MacDesign.gutter)
        } else {
            hero
        }
    }

    private var hero: some View {
        let open = signals.filter { $0.acknowledgedAt == nil }.count
        return PortalHero(
            breadcrumb: ["System", "Flock Brief"],
            eyebrow: "Shepherd's Pulse",
            title: "Flock Brief",
            subtitle: "Your people this week — who to celebrate, who to watch, who to reach out to first."
        ) {
            HStack(spacing: 8) {
                if loaded { HeroChip(label: "\(open) open", icon: "heart.fill", style: .tag) }
                if isAdmin {
                    HeroChip(label: running == .scan ? "Scanning…" : "Run scan",
                             icon: "arrow.clockwise", style: .ghost) { run(.scan) }
                        .disabled(running != nil)
                        .opacity(running != nil && running != .scan ? 0.5 : 1)
                    HeroChip(label: running == .briefs ? "Composing…" : "Compose briefs",
                             icon: "scroll", style: .gold) { run(.briefs) }
                        .disabled(running != nil)
                        .opacity(running != nil && running != .briefs ? 0.5 : 1)
                }
            }
        }
    }

    // MARK: lanes

    /// Mac: brief reading column (left) | signals table (right). The minWidth on
    /// the reading lane makes ViewThatFits fall back to the stacked layout at
    /// narrow Mac windows. iPhone/iPad: stacked.
    @ViewBuilder private var lanes: some View {
        if MacDesign.isMac {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: MacDesign.gutter) {
                    VStack(spacing: MacDesign.gutter) {
                        briefCard
                        footnote
                    }
                    .frame(minWidth: 440, maxWidth: 620)
                    signalsCard.frame(maxWidth: .infinity)
                }
                stackedLanes
            }
        } else {
            stackedLanes
        }
    }

    private var stackedLanes: some View {
        VStack(spacing: 18) {
            briefCard
            signalsCard
            footnote
        }
    }

    // MARK: the brief — stationery paper

    private var briefCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(brief.map { "WEEK OF \($0.weekOf)" } ?? "THIS WEEK'S BRIEF")
                    .font(.nOverline).tracking(1.6).foregroundStyle(FB.paperEyebrow)
                Spacer(minLength: 8)
                if brief != nil {
                    Text("Composed for you").font(.nMicro).foregroundStyle(Nuru.ink600)
                }
            }
            if let brief {
                Text(brief.body)
                    .font(.fraunces(15.5, .regular)).foregroundStyle(FB.paperInk)
                    .lineSpacing(7)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Text("No brief yet — it composes every Saturday evening once you shepherd a cell or disciples."
                     + (isAdmin ? " Use “Compose briefs” to write this week's." : ""))
                    .font(.nBody).foregroundStyle(Nuru.ink600)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Nuru.S.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [FB.paperTop, FB.paperBottom], startPoint: .top, endPoint: .bottom))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.card, style: .continuous).stroke(FB.paperBorder, lineWidth: 1))
        .nuruShadow()
    }

    // MARK: live signals

    private var signalsCard: some View {
        let open = signals.filter { $0.acknowledgedAt == nil }
        let acked = signals.filter { $0.acknowledgedAt != nil }
        return Card(padding: 0) {
            VStack(spacing: 0) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Care signals · last 14 days").font(.fraunces(16, .medium)).foregroundStyle(Nuru.navy)
                    Spacer(minLength: 8)
                    Text("\(open.count) open · \(acked.count) acknowledged")
                        .font(.nMicro).foregroundStyle(Nuru.ink600)
                }
                .padding(.horizontal, 18).padding(.vertical, 14)
                Divider().overlay(Nuru.border)
                if signals.isEmpty {
                    EmptyState.compact(icon: "leaf", message: "No signals — your flock is steady.")
                } else {
                    ForEach(Array((open + acked).enumerated()), id: \.element.id) { i, s in
                        signalRow(s)
                        if i < open.count + acked.count - 1 {
                            Divider().overlay(Nuru.border).padding(.leading, 52)
                        }
                    }
                }
            }
        }
    }

    private func signalRow(_ s: PulseSignal) -> some View {
        let sev = FB.severity(s.severity)
        let kind = FB.kind(s.kind)
        let acked = s.acknowledgedAt != nil
        return HStack(alignment: .top, spacing: 12) {
            TintedIcon(systemName: kind.icon, color: kind.tint, size: 32)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(s.memberName).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    severityPill(sev)
                }
                Text(s.summary).font(.nCaption).foregroundStyle(Nuru.ink600)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(Fmt.date(s.createdAt, style: .dateTime.month(.abbreviated).day())) · \(s.source ?? "rhythm")")
                    .font(.nMicro).foregroundStyle(Nuru.ink400)
            }
            Spacer(minLength: 8)
            if !acked {
                Button { ack(s) } label: {
                    HStack(spacing: 5) {
                        if ackBusy.contains(s.signalId) {
                            ProgressView().controlSize(.mini)
                        } else {
                            Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                        }
                        Text("Ack").font(.inter(11.5, .semibold))
                    }
                    .foregroundStyle(Nuru.foreground)
                    .padding(.horizontal, 11).frame(height: 30)
                    .background(Nuru.white)
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .pressable()
                .hoverEffect(.highlight)
                .disabled(ackBusy.contains(s.signalId))
                .accessibilityLabel("Acknowledge signal for \(s.memberName)")
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .opacity(acked ? 0.55 : 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(sev.label) signal. \(s.memberName). \(s.summary).\(acked ? " Acknowledged." : "")")
    }

    private func severityPill(_ sev: (label: String, fg: Color, bg: Color, border: Color)) -> some View {
        Text(sev.label)
            .font(.inter(9.5, .bold)).tracking(0.6)
            .foregroundStyle(sev.fg)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(sev.bg)
            .overlay(Capsule().stroke(sev.border, lineWidth: 1))
            .clipShape(Capsule())
    }

    // MARK: footnote

    private var footnote: some View {
        Text("Signals carry a one-line summary only — the member's full words stay in the Reflection Queue, exactly as before. Crisis signals also push a care flag to the member's leaders the moment they are detected.")
            .font(.nMicro).foregroundStyle(Nuru.ink400)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}
