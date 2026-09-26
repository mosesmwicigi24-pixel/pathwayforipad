// Finance → Campaigns (pathway docs/FINANCE_ERP.md §5) — giving appeals: raised
// against the goal, the match, and how far each invitation really reached
// (GET /admin/campaigns, finance:view). With finance:manage: create and edit
// (always saved as a draft first), put live, end. Raised = every succeeded
// gift to the campaign's fund from its start through its end date (EAT) —
// gifts to that fund for any reason count — so two campaigns on one fund are
// never added together here.
import SwiftUI

@MainActor
final class FinanceCampaignsModel: ObservableObject {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    @Published private(set) var campaigns: [FinCampaign] = []
    @Published private(set) var phase: Phase = .loading
    @Published private(set) var refreshing = false
    @Published var status = ""                      // "" = all · draft · live · ended
    @Published var notice: FinanceNotice?
    let lookups = FinBLookups()
    private var relayToken: Any?
    private var seq = 0

    init() { relayToken = finbRelay(lookups) }

    func load() async {
        seq += 1
        let mine = seq
        if campaigns.isEmpty { phase = .loading } else { refreshing = true }
        async let funds: Void = lookups.loadFunds()
        do {
            let list = try await FinanceERPAPI.campaigns()
            guard mine == seq else { _ = await funds; return }
            campaigns = list
            phase = .loaded
        } catch {
            guard mine == seq else { _ = await funds; return }
            let message = FinBError.message(error, fallback: "Could not load the campaigns.")
            if campaigns.isEmpty { phase = .failed(message) } else { notice = .error("Couldn't refresh — \(message)") }
        }
        _ = await funds
        if mine == seq { refreshing = false }
    }

    var shown: [FinCampaign] { status.isEmpty ? campaigns : campaigns.filter { $0.status == status } }
    func count(_ s: String) -> Int { campaigns.filter { $0.status == s }.count }

    func goLive(_ c: FinCampaign) async throws {
        _ = try await FinanceERPAPI.goLive(c.campaignId)
        notice = .ok("“\(c.title)” is live — members can be invited from now")
        await load()
    }

    func end(_ c: FinCampaign) async throws {
        _ = try await FinanceERPAPI.endCampaign(c.campaignId)
        notice = .ok("“\(c.title)” has ended")
        await load()
    }

    func saved(_ title: String, created: Bool) async {
        notice = .ok(created ? "Created “\(title)” as a draft — nothing reaches members until you put it live" : "Saved “\(title)”")
        await load()
    }

    var live: [FinCampaign] { campaigns.filter { $0.status == "live" } }

    /// Per currency over the LIVE campaigns: goal and raised (web parity).
    var liveTotals: [FinBCurrencyFigures.Row] {
        var goal: [String: Int] = [:], raised: [String: Int] = [:], n: [String: Int] = [:]
        for c in live {
            goal[c.currency, default: 0] += c.goalMinor
            raised[c.currency, default: 0] += c.raisedMinor
            n[c.currency, default: 0] += 1
        }
        return goal.keys.map { cur in
            FinBCurrencyFigures.Row(currency: cur, figures: [
                .init(label: "Goal", minor: goal[cur] ?? 0),
                .init(label: "Raised", minor: raised[cur] ?? 0, tint: Nuru.success),
            ], note: "\((n[cur] ?? 0)) live \((n[cur] ?? 0) == 1 ? "campaign" : "campaigns")")
        }
    }

    /// Live campaigns that share a fund in one currency count the same gifts —
    /// the live "raised" sum then counts them twice; say so.
    var sharedFundWarning: String? {
        let groups = Dictionary(grouping: live.filter { $0.fund != nil }) { "\($0.fund ?? "")|\($0.currency)" }
        guard let shared = groups.values.first(where: { $0.count > 1 }), let fund = shared.first?.fund else { return nil }
        return "\(shared.count) live campaigns share \(lookups.fundName(fund)) — the same gifts count toward each, so the live Raised above counts them more than once."
    }

    /// "12 days left" / "ends today" / "starts in 5 days" / "end date passed 3 days ago" / "ended".
    nonisolated static func timing(_ c: FinCampaign, today: String = FinanceDates.today()) -> String {
        if c.status == "ended" { return "ended" }
        if today < c.startsOn, let d = FinBTime.days(from: today, to: c.startsOn) { return "starts in \(d) \(d == 1 ? "day" : "days")" }
        guard let left = FinBTime.days(from: today, to: c.endsOn) else { return "" }
        if left > 0 { return "\(left) \(left == 1 ? "day" : "days") left" }
        if left == 0 { return "ends today" }
        return "end date passed \(-left) \(-left == 1 ? "day" : "days") ago"
    }
}

/// What a campaign action sheet is for.
enum FinanceCampaignAction: Identifiable {
    case create, edit(FinCampaign), goLive(FinCampaign), end(FinCampaign), reach(FinCampaign)
    var id: String {
        switch self {
        case .create: "create"
        case .edit(let c): "edit:\(c.id)"
        case .goLive(let c): "live:\(c.id)"
        case .end(let c): "end:\(c.id)"
        case .reach(let c): "reach:\(c.id)"
        }
    }
}

struct FinanceCampaignsView: View {
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var vm = FinanceCampaignsModel()
    @State private var action: FinanceCampaignAction?

    static let statusOptions: [FinanceFilterOption] = [.all("All"), .init("live", "Live"), .init("draft", "Drafts"), .init("ended", "Ended")]

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeCampaigns.title,
                            subtitle: "Appeals members can be invited to: goal against raised, any match (always with who pledged it), and how far the invitation actually travelled.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            if caps.manage {
                HeroChip(label: "New campaign", icon: "plus", style: .gold) { action = .create }
            }
        } content: {
            if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
            HStack(spacing: 10) {
                FinBChoiceChips(options: Self.statusOptions, selection: $vm.status)
                Spacer(minLength: 0)
            }
            if !vm.liveTotals.isEmpty {
                FinBCurrencyFigures(title: "Live campaigns", rows: vm.liveTotals, noun: ("campaign", "campaigns"),
                                    caption: "Each campaign counts gifts to its own fund inside its own dates.")
                if let w = vm.sharedFundWarning { FinanceNoticeBar(notice: .warn(w)) }
            }
            FinBExplain(text: "Raised = succeeded gifts to the campaign's fund from its start date through its end date (East Africa Time). A new campaign is always a draft — it reaches nobody until it is put live — and ending is final: an ended campaign is never reopened.")
            switch vm.phase {
            case .loading:
                SkeletonGrid(tiles: 4, columns: 2)
            case .failed(let message):
                ErrorBanner(message: message) { Task { await vm.load() } }
            case .loaded:
                if vm.shown.isEmpty {
                    EmptyState(icon: "flag", title: vm.campaigns.isEmpty ? "No campaigns yet" : "None here",
                               message: vm.campaigns.isEmpty ? "A campaign is an appeal with a goal, a fund and an end date." : "No campaign has this status.",
                               actionTitle: vm.campaigns.isEmpty && caps.manage ? "New campaign" : nil,
                               action: vm.campaigns.isEmpty && caps.manage ? { action = .create } : nil)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 330), spacing: 14, alignment: .top)], alignment: .leading, spacing: 14) {
                        ForEach(vm.shown) { c in card(c, caps: caps) }
                    }
                    .opacity(vm.refreshing ? 0.6 : 1)
                }
            }
        }
        .task { await vm.load() }
        .onFinanceLink(.financeCampaigns) { p in
            if let s = p["status"], Self.statusOptions.contains(where: { $0.value == s }) { vm.status = s }
        }
        .sheet(item: $action) { a in sheet(a) }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        let asked = vm.live.reduce(0) { $0 + $1.peopleAsked }
        let gave = vm.live.reduce(0) { $0 + $1.gave }
        return [
            HeroStat(label: "Live", value: String(vm.count("live")), hint: "members can be invited"),
            HeroStat(label: "Drafts", value: String(vm.count("draft")), hint: "reach nobody yet"),
            HeroStat(label: "People asked — live", value: String(asked), hint: "\(gave) gave"),
        ]
    }

    private func card(_ c: FinCampaign, caps: FinanceCaps) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.title).font(.inter(15.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(2)
                    Text("\(vm.lookups.fundName(c.fund)) · \(FinanceDates.displayRange(from: c.startsOn, to: c.endsOn))")
                        .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 3) {
                    FinanceStatusChip(status: c.status)
                    Text(FinanceCampaignsModel.timing(c)).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
            }
            if !c.blurb.isEmpty {
                Text(c.blurb).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(2)
            }
            FinBProgress(raised: c.raisedMinor, target: c.goalMinor, currency: c.currency)
            if let match = c.matchMinor, match > 0 {
                HStack(spacing: 5) {
                    Image(systemName: "equal.circle").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
                    Text("Match \(FinanceMoney.format(match, c.currency)), pledged by \(c.matchPledger ?? "—")")
                        .font(.nMicro).foregroundStyle(Nuru.goldChipText).lineLimit(2)
                }
            }
            HStack(spacing: 10) {
                reachFigure("Asked", c.peopleAsked)
                reachFigure("Gave", c.gave, tint: Nuru.success)
                reachFigure("Declined", c.declined, tint: c.declined > 0 ? FinanceStatus.amber.fg : nil)
                Spacer(minLength: 0)
                Button { action = .reach(c) } label: {
                    Label("Reach", systemImage: "chart.bar").font(.inter(12, .semibold)).foregroundStyle(Nuru.navy)
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityHint("Shows how far the invitation travelled")
            }
            if caps.manage, c.status != "ended" {
                HStack(spacing: 8) {
                    FinanceButton(title: "Edit", icon: "pencil") { action = .edit(c) }
                    if c.status == "draft" {
                        FinanceButton(title: "Go live", icon: "play.fill", style: .primary) { action = .goLive(c) }
                    }
                    FinanceButton(title: "End", icon: "stop.fill", style: .danger) { action = .end(c) }
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous)
            .stroke(c.status == "live" ? Nuru.success.opacity(0.35) : Nuru.border, lineWidth: 1))
    }

    private func reachFigure(_ label: String, _ n: Int, tint: Color? = nil) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(String(n)).font(.inter(13, .semibold)).foregroundStyle(tint ?? Nuru.navy).monospacedDigit()
            Text(label.lowercased()).font(.nMicro).foregroundStyle(Nuru.ink600)
        }
    }

    @ViewBuilder private func sheet(_ a: FinanceCampaignAction) -> some View {
        switch a {
        case .create:
            FinanceCampaignFormSheet(existing: nil, lookups: vm.lookups) { title in Task { await vm.saved(title, created: true) } }
        case .edit(let c):
            FinanceCampaignFormSheet(existing: c, lookups: vm.lookups) { title in Task { await vm.saved(title, created: false) } }
        case .goLive(let c):
            FinBConfirmSheet(title: "Put “\(c.title)” live?",
                             consequence: ["From now on members can be invited to give toward it — within the invitation's own restraint (never a minor, at most three showings, a fortnight between waves, quiet hours).",
                                           "Gifts to \(vm.lookups.fundName(c.fund)) from \(FinanceDates.display(c.startsOn)) to \(FinanceDates.display(c.endsOn)) count as raised."],
                             confirmLabel: "Go live",
                             onConfirm: { try await vm.goLive(c) },
                             errorText: { FinBError.message($0, fallback: "Could not put the campaign live.") })
        case .end(let c):
            FinBConfirmSheet(title: "End “\(c.title)”?",
                             consequence: ["Members stop being invited. Ending is final — an ended campaign is never reopened; to appeal again, create a new one.",
                                           "What it raised stays on record."],
                             confirmLabel: "End campaign", destructive: true,
                             onConfirm: { try await vm.end(c) },
                             errorText: { FinBError.message($0, fallback: "Could not end the campaign.") })
        case .reach(let c):
            FinanceCampaignReachSheet(campaign: c)
        }
    }
}

// MARK: - Create / edit

struct FinanceCampaignFormSheet: View {
    let existing: FinCampaign?
    @ObservedObject var lookups: FinBLookups
    let onSaved: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var title = ""
    @State private var blurb = ""
    @State private var imageUrl = ""
    @State private var fund = ""
    @State private var goal = ""
    @State private var currency = "KES"
    @State private var startsOn = FinanceDates.today()
    @State private var endsOn = FinanceDates.todayOffset(30)
    @State private var hasMatch = false
    @State private var match = ""
    @State private var pledger = ""
    @State private var busy = false
    @State private var error: String?
    @State private var tried = false

    init(existing: FinCampaign?, lookups: FinBLookups, onSaved: @escaping (String) -> Void) {
        self.existing = existing
        self.lookups = lookups
        self.onSaved = onSaved
        if let c = existing {
            _title = State(initialValue: c.title)
            _blurb = State(initialValue: c.blurb)
            _imageUrl = State(initialValue: c.imageUrl ?? "")
            _fund = State(initialValue: c.fund ?? "")
            _goal = State(initialValue: FinanceMoney.majorString(c.goalMinor))
            _currency = State(initialValue: c.currency.isEmpty ? "KES" : c.currency)
            _startsOn = State(initialValue: c.startsOn)
            _endsOn = State(initialValue: c.endsOn)
            _hasMatch = State(initialValue: (c.matchMinor ?? 0) > 0)
            _match = State(initialValue: c.matchMinor.map(FinanceMoney.majorString) ?? "")
            _pledger = State(initialValue: c.matchPledger ?? "")
        }
    }

    private var titleProblem: String? {
        let n = title.trimmingCharacters(in: .whitespacesAndNewlines).count
        return n < 3 ? "At least 3 characters." : n > 120 ? "At most 120 characters." : nil
    }
    private var blurbProblem: String? {
        blurb.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 ? "Say what the campaign is for — at least 10 characters." : nil
    }
    private var imageProblem: String? {
        let s = imageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        let ok = (s.lowercased().hasPrefix("https://") || s.lowercased().hasPrefix("http://")) && !s.contains(" ") && URL(string: s) != nil
        return ok ? nil : "A full web address starting with https://"
    }
    private var fundProblem: String? { fund.isEmpty ? "Choose the fund gifts go to." : nil }
    private var goalMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(goal) }
    private var matchMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(match) }
    private var datesProblem: String? {
        FinanceDates.date(fromYMD: startsOn) == nil || FinanceDates.date(fromYMD: endsOn) == nil ? "Choose both dates."
            : endsOn < startsOn ? "A campaign cannot end before it starts." : nil
    }
    private var pledgerProblem: String? {
        guard hasMatch else { return nil }
        let n = pledger.trimmingCharacters(in: .whitespacesAndNewlines).count
        return n < 2 ? "Name who pledged the match — a match nobody offered is never claimed."
            : n > 120 ? "At most 120 characters." : nil
    }
    private var valid: Bool {
        guard titleProblem == nil, blurbProblem == nil, imageProblem == nil, fundProblem == nil, datesProblem == nil,
              pledgerProblem == nil, case .success = goalMinor else { return false }
        if hasMatch, case .failure = matchMinor { return false }
        return true
    }

    /// Active funds, plus the campaign's own fund if it has since been deactivated.
    private var fundOptions: [FinanceFilterOption] {
        var list = lookups.activeFunds.map { FinanceFilterOption($0.code, $0.name) }
        if !fund.isEmpty, !list.contains(where: { $0.value == fund }) {
            list.insert(FinanceFilterOption(fund, "\(lookups.fundName(fund)) (inactive)"), at: 0)
        }
        return list
    }

    var body: some View {
        FinBFormSheet(title: existing == nil ? "New campaign" : "Edit campaign",
                      confirmLabel: existing == nil ? "Save draft" : "Save",
                      canConfirm: true, busy: busy, error: error, onConfirm: save) {
            FinanceNoticeBar(notice: existing?.status == "live"
                             ? .warn("This campaign is live — members being invited see the changes at once.")
                             : .ok("Starts as a draft — putting it live is a separate step."))
            FinBField(label: "Title", hint: "3–120 characters", error: tried ? titleProblem : nil) {
                TextField("e.g. Sanctuary roof", text: $title).finbInput(invalid: tried && titleProblem != nil)
            }
            FinBField(label: "What it is for", hint: "What members read when they are invited — a sentence or two.", error: tried ? blurbProblem : nil) {
                TextField("A sentence or two, in the church's words", text: $blurb, axis: .vertical)
                    .lineLimit(3...6).finbInput(invalid: tried && blurbProblem != nil)
            }
            FinBField(label: "Image", hint: "Optional — a picture for the invitation (https://…)", error: tried ? imageProblem : nil) {
                TextField("https://", text: $imageUrl)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .finbInput(invalid: tried && imageProblem != nil)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Fund", hint: "Money raised = succeeded gifts to this fund between the start and end dates.",
                          error: tried ? (fundProblem ?? lookups.fundsError) : lookups.fundsError) {
                    FinBPickerField(placeholder: "Choose a fund", selection: $fund, options: fundOptions, invalid: tried && fundProblem != nil)
                }
                FinanceMoneyField(label: "Goal", text: $goal, currency: $currency)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Starts on", error: nil) { FinBDayPicker(label: "Starts on", ymd: $startsOn) }
                FinBField(label: "Ends on", hint: "A campaign always ends — gifts after this day do not count toward it.", error: tried ? datesProblem : nil) {
                    FinBDayPicker(label: "Ends on", ymd: $endsOn, earliest: startsOn)
                }
            }
            Toggle(isOn: $hasMatch.animation()) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("A pledger matches gifts").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    Text("Both halves, or neither: the amount AND who pledged it.").font(.nCaption).foregroundStyle(Nuru.ink600)
                }
            }
            .tint(Nuru.gold)
            if hasMatch {
                HStack(alignment: .top, spacing: 14) {
                    FinanceMoneyField(label: "Match up to", text: $match, currency: $currency, currencies: [currency])
                    FinBField(label: "Pledged by", error: tried ? pledgerProblem : nil) {
                        TextField("Name of the pledger", text: $pledger).finbInput(invalid: tried && pledgerProblem != nil)
                    }
                }
            }
        }
        .task { await lookups.loadFunds() }
    }

    private func save() {
        tried = true
        guard valid, case .success(let goalValue) = goalMinor else {
            error = "Check the highlighted fields."
            return
        }
        var matchValue: Int? = nil
        if hasMatch, case .success(let m) = matchMinor { matchValue = m }
        let input = FinCampaignInput(
            title: title.trimmingCharacters(in: .whitespacesAndNewlines),
            blurb: blurb.trimmingCharacters(in: .whitespacesAndNewlines),
            imageUrl: imageUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : imageUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            fund: fund, goalMinor: goalValue, currency: currency,
            startsOn: startsOn, endsOn: endsOn,
            matchMinor: matchValue,
            matchPledger: hasMatch ? pledger.trimmingCharacters(in: .whitespacesAndNewlines) : nil)
        busy = true
        error = nil
        Task { @MainActor in
            do {
                if let c = existing { _ = try await FinanceERPAPI.updateCampaign(c.campaignId, input) }
                else { _ = try await FinanceERPAPI.createCampaign(input) }
                busy = false
                onSaved(input.title)
                dismiss()
            } catch {
                busy = false
                self.error = FinBError.message(error, fallback: existing == nil ? "Could not create the campaign." : "Could not save the campaign.")
            }
        }
    }
}

// MARK: - Reach

struct FinanceCampaignReachSheet: View {
    let campaign: FinCampaign
    @Environment(\.dismiss) private var dismiss
    @State private var reach: FinCampaignReach?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(campaign.title).font(.inter(17, .bold)).foregroundStyle(Nuru.navy)
                    if let error {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else if let r = reach {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                            tile("People asked", r.peopleAsked, "shown the invitation at least once")
                            tile("Times shown", r.timesShown, "invitations actually on screen")
                            tile("Opened", r.opened, "looked at the campaign")
                            tile("Gave", r.gave, "gave after being invited")
                            tile("Dismissed", r.dismissed, "closed it for now — may be asked again")
                            tile("Declined", r.declined, "asked not to be asked again — permanent")
                        }
                        FinBExplain(text: r.peopleAsked == 0
                                    ? (campaign.status == "live"
                                       ? "Live, but nobody has been shown it yet — the invitation's restraint (quiet hours, spacing, the first week) decides when."
                                       : "Nobody has been asked — a draft or ended campaign reaches no one.")
                                    : "\(r.gave) of \(r.peopleAsked) people asked gave (\(FinBMath.percent(r.gave, of: r.peopleAsked))%). A campaign nobody saw and one people declined look the same in the totals — this tells them apart.")
                    } else {
                        SkeletonGrid(tiles: 6, columns: 3)
                    }
                }
                .padding(24)
                .frame(maxWidth: 720)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Reach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    private func load() async {
        error = nil
        do { reach = try await FinanceERPAPI.campaignReach(campaign.campaignId) }
        catch { self.error = FinBError.message(error, fallback: "Could not load the reach.") }
    }

    private func tile(_ label: String, _ n: Int, _ hint: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased()).font(.inter(10.5, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
            Text(String(n)).font(.inter(20, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
            Text(hint).font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
