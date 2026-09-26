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
        notice = .ok("“\(c.title)” is live — the app can invite members to it now.")
        await load()
    }

    func end(_ c: FinCampaign) async throws {
        _ = try await FinanceERPAPI.endCampaign(c.campaignId)
        notice = .ok("“\(c.title)” has ended. It cannot be reopened.")
        await load()
    }

    func saved(_ title: String, created: Bool) async {
        notice = .ok(created ? "“\(title)” saved as a draft — nobody is invited until you put it live." : "“\(title)” saved.")
        await load()
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
                            subtitle: "Appeals — money raised against each goal, the match, and how far each invitation really reached.",
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
            FinBExplain(text: "Raised counts every succeeded gift to the campaign's fund from its start date through its end date (East Africa Time) — gifts to that fund for any reason — so campaigns sharing a fund are never added together. A new campaign is always a draft; nobody is invited until it is put live, and an ended campaign is never reopened.")
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
        .sheet(item: $action) { a in sheet(a) }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        return [
            HeroStat(label: "Live", value: String(vm.count("live")), hint: "inviting members now"),
            HeroStat(label: "Drafts", value: String(vm.count("draft")), hint: "not yet live"),
            HeroStat(label: "Ended", value: String(vm.count("ended")), hint: "closed for good"),
        ]
    }

    private func card(_ c: FinCampaign, caps: FinanceCaps) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.title).font(.inter(15.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(2)
                    Text("\(FinanceDates.displayRange(from: c.startsOn, to: c.endsOn)) · to \(vm.lookups.fundName(c.fund))")
                        .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                Spacer(minLength: 6)
                FinanceStatusChip(status: c.status)
            }
            if !c.blurb.isEmpty {
                Text(c.blurb).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(2)
            }
            FinBProgress(raised: c.raisedMinor, target: c.goalMinor, currency: c.currency)
            if let match = c.matchMinor, match > 0 {
                HStack(spacing: 5) {
                    Image(systemName: "equal.circle").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.goldLo)
                    Text("Matched up to \(FinanceMoney.format(match, c.currency)) by \(c.matchPledger ?? "a pledger")")
                        .font(.nMicro).foregroundStyle(Nuru.goldChipText).lineLimit(2)
                }
            }
            HStack(spacing: 10) {
                reachFigure("Asked", c.peopleAsked)
                reachFigure("Gave", c.gave, tint: Nuru.success)
                reachFigure("Declined", c.declined, tint: c.declined > 0 ? FinanceStatus.rose.fg : nil)
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
                        FinanceButton(title: "Go live", icon: "dot.radiowaves.left.and.right", style: .gold) { action = .goLive(c) }
                    }
                    if c.status == "live" {
                        FinanceButton(title: "End", icon: "stop.circle", style: .danger) { action = .end(c) }
                    }
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
            FinBConfirmSheet(title: "Put this campaign live",
                             consequence: ["Puts “\(c.title)” live — from now on the app may invite members to give to it.",
                                           "The app keeps its restraint rules (never partners or minors, at most three showings, a fortnight between waves). Raised counts every gift to \(vm.lookups.fundName(c.fund)) from \(FinanceDates.display(c.startsOn)) through \(FinanceDates.display(c.endsOn))."],
                             confirmLabel: "Go live") { try await vm.goLive(c) }
        case .end(let c):
            FinBConfirmSheet(title: "End this campaign",
                             consequence: ["Ends “\(c.title)” for good — members stop being invited, and it can never be reopened (start a new campaign instead).",
                                           "Its raised figure still counts gifts to \(vm.lookups.fundName(c.fund)) through \(FinanceDates.display(c.endsOn)), its end date."],
                             confirmLabel: "End campaign", destructive: true) { try await vm.end(c) }
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
        blurb.trimmingCharacters(in: .whitespacesAndNewlines).count < 10 ? "At least 10 characters — what the money is for, in the church's words." : nil
    }
    private var fundProblem: String? { fund.isEmpty ? "Choose the fund the gifts go to." : nil }
    private var goalMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(goal) }
    private var matchMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(match) }
    private var datesProblem: String? {
        FinanceDates.date(fromYMD: startsOn) == nil || FinanceDates.date(fromYMD: endsOn) == nil ? "Choose both dates."
            : endsOn < startsOn ? "A campaign cannot end before it starts." : nil
    }
    private var pledgerProblem: String? {
        guard hasMatch else { return nil }
        let n = pledger.trimmingCharacters(in: .whitespacesAndNewlines).count
        return n < 2 ? "A match needs someone who pledged it — name the pledger (2–120 characters), or remove the match."
            : n > 120 ? "At most 120 characters." : nil
    }
    private var valid: Bool {
        guard titleProblem == nil, blurbProblem == nil, fundProblem == nil, datesProblem == nil, pledgerProblem == nil,
              case .success = goalMinor else { return false }
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
            FinanceNoticeBar(notice: existing == nil
                             ? .warn("Saved as a draft — nobody is invited until you put it live.")
                             : existing?.status == "live" ? .warn("This campaign is live — changes show to members straight away.")
                             : .ok("Still a draft — nobody sees it until it is put live."))
            FinBField(label: "Title", hint: "3–120 characters", error: tried ? titleProblem : nil) {
                TextField("e.g. Sanctuary roof", text: $title).finbInput(invalid: tried && titleProblem != nil)
            }
            FinBField(label: "What it is for", hint: "Shown to members in the invitation", error: tried ? blurbProblem : nil) {
                TextField("A sentence or two, in the church's words", text: $blurb, axis: .vertical)
                    .lineLimit(3...6).finbInput(invalid: tried && blurbProblem != nil)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Fund", hint: "Where its gifts are booked", error: tried ? (fundProblem ?? lookups.fundsError) : lookups.fundsError) {
                    FinBPickerField(placeholder: "Choose a fund", selection: $fund, options: fundOptions, invalid: tried && fundProblem != nil)
                }
                FinanceMoneyField(label: "Goal", text: $goal, currency: $currency)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Starts on", error: nil) { FinBDayPicker(label: "Starts on", ymd: $startsOn) }
                FinBField(label: "Ends on", hint: "Every campaign has an end", error: tried ? datesProblem : nil) {
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
            imageUrl: existing?.imageUrl,          // PUT replaces the whole campaign — keep its image
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
                self.error = FinBError.message(error, fallback: "Could not save the campaign.")
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
                            tile("Asked", r.peopleAsked, "members the app chose to invite")
                            tile("Times shown", r.timesShown, "invitations actually on screen")
                            tile("Opened", r.opened, "looked at the campaign")
                            tile("Gave", r.gave, "gave after being invited")
                            tile("Dismissed", r.dismissed, "not now — may be asked again")
                            tile("Declined", r.declined, "asked never to be asked again")
                        }
                        FinBExplain(text: "Reach tells a campaign nobody saw apart from one people saw and declined — they look the same in the money alone. Counts are people, except Times shown.")
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
