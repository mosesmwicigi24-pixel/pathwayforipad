// Finance → Claims (pathway docs/FINANCE_ERP.md §5) — "I paid another way".
// A member says they paid a pledge outside the app (cash at church, a bank
// transfer…); nothing counts until the office decides. Confirm records the
// amount as a succeeded office gift toward the pledge — dated the day they say
// they paid, booked to the fund the pledge pays to, posted to the books, with
// a receipt to the member. Reject records nothing; the member is told. Oldest
// first (GET /admin/partners/claims, finance:view; decisions finance:manage).
//
// Contract note: a claim carries amount, currency, paid_on and the member's
// own note — no method or reference field — so "how they paid" is their note.
import SwiftUI

@MainActor
final class FinanceClaimsModel: ObservableObject {
    enum Phase: Equatable { case loading, loaded, failed(String) }

    @Published private(set) var claims: [PledgeClaimRow] = []
    @Published private(set) var phase: Phase = .loading
    @Published private(set) var refreshing = false
    @Published var notice: FinanceNotice?
    /// pledge id → where its money is booked (the member's partner detail).
    @Published private(set) var paysTo: [String: FinFundRef] = [:]
    /// pledge ids whose destination could not be read.
    @Published private(set) var paysToFailed: Set<String> = []
    private var seq = 0

    func load() async {
        seq += 1
        let mine = seq
        if claims.isEmpty { phase = .loading } else { refreshing = true }
        do {
            let rows = try await FinanceERPAPI.claims()
            guard mine == seq else { return }
            claims = rows
            phase = .loaded
        } catch {
            guard mine == seq else { return }
            let message = FinBError.message(error, fallback: "Could not load the claims.")
            if claims.isEmpty { phase = .failed(message) } else { notice = .error("Couldn't refresh — \(message)") }
        }
        if mine == seq { refreshing = false }
    }

    /// Where a confirmed claim's money goes — PledgePaysTo from the member's
    /// partner detail (the claims list does not carry it). Read once per pledge.
    func resolvePaysTo(_ c: PledgeClaimRow) async {
        guard paysTo[c.pledgeId] == nil, !c.userId.isEmpty else { return }
        do {
            let detail = try await PartnersAPI.detail(c.userId)
            for p in detail.pledges { if let f = p.paysTo { paysTo[p.pledgeId] = f } }
            if paysTo[c.pledgeId] == nil { paysToFailed.insert(c.pledgeId) }
        } catch {
            paysToFailed.insert(c.pledgeId)
        }
    }

    /// Confirm or reject. A 422 / 404 means someone decided it meanwhile — the
    /// queue is reloaded instead of retried. Throws for the sheet to show.
    func decide(_ c: PledgeClaimRow, confirm: Bool) async throws {
        do {
            if confirm { try await FinanceERPAPI.confirmClaim(c.claimId) } else { try await FinanceERPAPI.rejectClaim(c.claimId) }
            claims.removeAll { $0.claimId == c.claimId }
            let amount = FinanceMoney.format(c.amountMinor, c.currency)
            notice = confirm
                ? .ok("Recorded \(amount) toward “\(c.pledgeTitle)” — \(c.fullName) gets a receipt.")
                : .ok("Rejected \(c.fullName)'s claim of \(amount) — they are told.")
        } catch {
            if let status = error.apiStatus, status == 422 || status == 404 {
                notice = .warn("\(FinBError.message(error, fallback: "Already decided")) — someone decided this claim meanwhile, so the queue was reloaded.")
                await load()
                return
            }
            throw error
        }
    }

    /// Pending money per currency — a sum of the rows on screen (the whole
    /// queue; it is never paged).
    var totalsRows: [FinBCurrencyFigures.Row] {
        var amount: [String: Int] = [:], count: [String: Int] = [:]
        for c in claims {
            amount[c.currency, default: 0] += c.amountMinor
            count[c.currency, default: 0] += 1
        }
        return amount.keys.map { cur in
            FinBCurrencyFigures.Row(currency: cur, figures: [.init(label: "Claimed", minor: amount[cur] ?? 0)], count: count[cur])
        }
    }

    var oldestWait: String? { claims.first.map { FinBTime.waiting(since: $0.createdAt) } }
}

/// A decision waiting for its confirmation sheet.
struct FinanceClaimDecision: Identifiable {
    let claim: PledgeClaimRow
    let confirm: Bool
    var id: String { "\(claim.claimId):\(confirm)" }
}

struct FinanceClaimsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceClaimsModel()
    @State private var deciding: FinanceClaimDecision?

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeClaims.title,
                            subtitle: "“I paid another way” — nothing counts toward a pledge until the office confirms it.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            content(caps)
        }
        .task { await vm.load() }
        .onFinanceLink(.financeClaims) { _ in Task { await vm.load() } }
        .sheet(item: $deciding) { d in
            FinBConfirmSheet(title: d.confirm ? "Confirm this claim" : "Reject this claim",
                             consequence: consequence(d),
                             confirmLabel: d.confirm ? "Confirm and record" : "Reject claim",
                             destructive: !d.confirm) {
                try await vm.decide(d.claim, confirm: d.confirm)
            }
            .task { if d.confirm { await vm.resolvePaysTo(d.claim) } }
        }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        return [
            HeroStat(label: "Waiting", value: String(vm.claims.count), hint: vm.claims.count == 1 ? "claim to decide" : "claims to decide"),
            HeroStat(label: "Oldest", value: vm.oldestWait ?? "—", hint: "since it was submitted"),
        ]
    }

    @ViewBuilder private func content(_ caps: FinanceCaps) -> some View {
        if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
        FinBCurrencyFigures(title: "Waiting for a decision", rows: vm.totalsRows, noun: ("claim", "claims"),
                            caption: "per currency — never added together", loading: vm.phase == .loading)
        FinBExplain(text: "Confirm records the amount as an office gift toward the pledge — dated the day the member says they paid, booked to the fund the pledge pays to, posted to the books, with a receipt to the member. Reject records nothing; the member is told. A confirmation made in error is corrected by reversing that gift in Transactions.")
        switch vm.phase {
        case .loading:
            SkeletonList(rows: 3)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded:
            if vm.claims.isEmpty {
                EmptyState(icon: "checkmark.seal", title: "Nothing to decide",
                           message: "Every “I paid another way” claim has been confirmed or rejected.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(vm.claims.enumerated()), id: \.element.id) { i, c in
                        claimRow(c, caps: caps)
                            .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                .opacity(vm.refreshing ? 0.6 : 1)
            }
        }
    }

    private func claimRow(_ c: PledgeClaimRow, caps: FinanceCaps) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Monogram(name: c.fullName, size: 38)
            VStack(alignment: .leading, spacing: 5) {
                Button { router.openFinance(.partners, ["member": c.userId]) } label: {
                    HStack(spacing: 4) {
                        Text(c.fullName.isEmpty ? "A member" : c.fullName).font(.inter(14, .bold)).foregroundStyle(Nuru.navy)
                        Image(systemName: "arrow.up.right").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.ink400)
                    }
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityHint("Opens this member in Partners")
                Text("Toward “\(c.pledgeTitle.isEmpty ? "a pledge" : c.pledgeTitle)”").font(.nCaption).foregroundStyle(Nuru.ink)
                    .lineLimit(1)
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "text.quote").font(.system(size: 10, weight: .semibold)).foregroundStyle(Nuru.ink400).padding(.top, 2)
                    if let note = c.note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                        Text(note).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(3)
                            .accessibilityLabel("How they paid: \(note)")
                    } else {
                        Text("No note — ask the member how they paid before confirming.").font(.nCaption).italic().foregroundStyle(Nuru.ink400)
                    }
                }
                FinanceFlowLayout(spacing: 12, rowSpacing: 3) {
                    label("calendar", "Paid on \(FinanceDates.display(c.paidOn))")
                    label("tray.and.arrow.down", "Submitted \(FinBTime.stamp(c.createdAt))")
                    label("hourglass", "Waiting \(FinBTime.waiting(since: c.createdAt))")
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 10) {
                FinBAmount(minor: c.amountMinor, currency: c.currency, size: 15)
                if caps.manage {
                    HStack(spacing: 8) {
                        FinanceButton(title: "Reject", icon: "nosign", style: .danger) { deciding = FinanceClaimDecision(claim: c, confirm: false) }
                        FinanceButton(title: "Confirm", icon: "checkmark", style: .primary) { deciding = FinanceClaimDecision(claim: c, confirm: true) }
                    }
                }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
    }

    private func label(_ icon: String, _ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon).font(.system(size: 10, weight: .semibold))
            Text(text)
        }
        .font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize()
    }

    /// What confirming / rejecting will do, in plain words.
    private func consequence(_ d: FinanceClaimDecision) -> [String] {
        let c = d.claim
        let amount = FinanceMoney.format(c.amountMinor, c.currency)
        let who = c.fullName.isEmpty ? "The member" : c.fullName
        let pledge = c.pledgeTitle.isEmpty ? "the pledge" : "“\(c.pledgeTitle)”"
        guard d.confirm else {
            return ["Rejects \(who)'s claim of \(amount) toward \(pledge).",
                    "Nothing is recorded and the pledge does not move. \(who) is told."]
        }
        let fund: String
        if let f = vm.paysTo[c.pledgeId] { fund = f.name.isEmpty ? f.code : f.name }
        else if vm.paysToFailed.contains(c.pledgeId) { fund = "the fund this pledge pays to" }
        else { fund = "the pledge's fund (finding it…)" }
        return ["Records \(amount) to \(fund) and counts it toward \(pledge).",
                "The gift is dated \(FinanceDates.display(c.paidOn)) — the day \(who) says they paid — posts to the books, and \(who) gets a receipt.",
                "Confirm only if the money has really arrived. A wrong confirmation is corrected by reversing the gift in Transactions."]
    }
}
