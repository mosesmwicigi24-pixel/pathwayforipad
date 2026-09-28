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
// Giving Cycle 7: a claim in another currency than its pledge
// (currency_mismatch, pledge_currency) can only be rejected — Confirm is
// disabled and "Pledge is in KES" shows under the amount; a CURRENCY_MISMATCH
// on confirm stays in the sheet in the server's words, never read as
// "already decided".
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

    /// Where a confirmed claim's money goes — the pledge's pays_to (else its
    /// own fund) from the member's partner detail; the claims list does not
    /// carry it. Read once per pledge (web parity: Claims.tsx askConfirm).
    func resolvePaysTo(_ c: PledgeClaimRow) async {
        guard paysTo[c.pledgeId] == nil, !c.userId.isEmpty else { return }
        do {
            let detail = try await PartnersAPI.detail(c.userId)
            for p in detail.pledges {
                if let f = p.paysTo { paysTo[p.pledgeId] = f }
                else if let f = p.fund, let name = f.name { paysTo[p.pledgeId] = FinFundRef(code: f.code, name: name) }
            }
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
                ? .ok("Recorded \(amount) from \(c.fullName) — receipt on its way")
                : .ok("Rejected \(c.fullName)'s claim of \(amount)")
            await load()
        } catch {
            // Someone decided it first — nothing to retry; the queue catches up.
            if Self.isAlreadyDecided(error) {
                notice = .warn(FinBError.message(error, fallback: "That claim was already decided."))
                await load()
                return
            }
            throw error
        }
    }

    /// "Already decided" is the server's UNPROCESSABLE 422. A CURRENCY_MISMATCH
    /// is a 422 too, but it is not: the claim is still pending and its own
    /// words stay in the sheet (Giving Cycle 7; web Claims.tsx isAlreadyDecided).
    nonisolated static func isAlreadyDecided(_ error: Error) -> Bool {
        error.apiStatus == 422 && error.apiCode != "CURRENCY_MISMATCH"
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

    /// The longest-waiting claim's submission time.
    var oldest: String? { claims.compactMap(\.createdAt).min() }
}

extension PledgeClaimRow {
    /// Giving Cycle 7: a claim in another currency than its pledge cannot be
    /// confirmed — the pledge is counted in its own currency (the server
    /// refuses, 422 CURRENCY_MISMATCH). Reject stays.
    var canConfirm: Bool { !currencyMismatch }
    /// "Pledge is in KES" under such a claim's amount; nil when they agree.
    var currencyMismatchNote: String? {
        guard currencyMismatch else { return nil }
        let pledge = pledgeCurrency?.trimmingCharacters(in: .whitespaces) ?? ""
        return pledge.isEmpty ? "Pledge is in another currency" : "Pledge is in \(pledge)"
    }
    static let currencyMismatchWhy = "The pledge is counted in its own currency; this claim can only be rejected."
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
                            subtitle: "“I paid another way” — members who paid a pledge outside the app. Confirming records the gift toward their pledge (ledger + receipt); rejecting tells them the office could not confirm it.",
                            stats: stats,
                            onRefresh: { await vm.load() }) {
            content(caps)
        }
        .task { await vm.load() }
        .onFinanceLink(.financeClaims) { _ in Task { await vm.load() } }
        .sheet(item: $deciding) { d in
            FinBConfirmSheet(title: d.confirm ? "Confirm this claim?" : "Reject this claim?",
                             consequence: consequence(d),
                             confirmLabel: d.confirm ? "Confirm \(FinanceMoney.format(d.claim.amountMinor, d.claim.currency))" : "Reject claim",
                             destructive: !d.confirm,
                             onConfirm: { try await vm.decide(d.claim, confirm: d.confirm) },
                             errorText: { FinBError.message($0, fallback: d.confirm ? "Could not confirm the claim." : "Could not reject the claim.") })
            .task { if d.confirm { await vm.resolvePaysTo(d.claim) } }
        }
    }

    private var stats: [HeroStat] {
        guard vm.phase == .loaded else { return [] }
        return [
            HeroStat(label: "Waiting", value: String(vm.claims.count), hint: "claims to decide",
                     tint: vm.claims.isEmpty ? nil : Color(hex: 0xF5C77E)),
            HeroStat(label: "Oldest", value: vm.oldest.map { FinBTime.age(since: $0) } ?? "—",
                     hint: vm.oldest.map { "claimed \(FinBTime.stamp($0))" } ?? "nothing waiting"),
        ]
    }

    @ViewBuilder private func content(_ caps: FinanceCaps) -> some View {
        if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
        FinBCurrencyFigures(title: "Amount claimed", rows: vm.totalsRows, noun: ("claim", "claims"),
                            caption: "per currency — never added", loading: vm.phase == .loading)
        FinBExplain(text: caps.manage
                    ? "Oldest first. Check the note against the bank statement, till or cash book before confirming. Confirming records the gift toward the pledge — dated the day they say they paid, booked to the fund the pledge pays to — with a receipt; rejecting tells them the office could not confirm it."
                    : "Oldest first. Deciding a claim needs finance:manage.")
        switch vm.phase {
        case .loading:
            SkeletonList(rows: 3)
        case .failed(let message):
            ErrorBanner(message: message) { Task { await vm.load() } }
        case .loaded:
            if vm.claims.isEmpty {
                EmptyState(icon: "checkmark.seal", title: "No claims waiting",
                           message: "When a member pays a pledge outside the app — cash at the office, a bank transfer, an M-Pesa payment to the till — they can say so from their pledge (“I paid another way”). The claim waits here until the office checks it: confirming records it as a gift toward the pledge with a receipt; rejecting tells them it could not be confirmed.")
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
                        (Text("How they paid: ").foregroundColor(Nuru.ink400) + Text(note).foregroundColor(Nuru.ink600))
                            .font(.nCaption).lineLimit(3)
                    } else {
                        Text("How they paid: — no note").font(.nCaption).foregroundStyle(Nuru.ink400)
                    }
                }
                FinanceFlowLayout(spacing: 12, rowSpacing: 3) {
                    label("calendar", "Paid on \(FinanceDates.display(c.paidOn))")
                    label("tray.and.arrow.down", "Claimed \(FinBTime.stamp(c.createdAt))")
                    label("hourglass", "\(FinBTime.age(since: c.createdAt)) waiting")
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 10) {
                VStack(alignment: .trailing, spacing: 2) {
                    FinBAmount(minor: c.amountMinor, currency: c.currency, size: 15)
                    // Another currency than its pledge: it can only be rejected.
                    if let note = c.currencyMismatchNote {
                        Text(note).font(.nMicro).foregroundStyle(FinanceStatus.rose.fg).lineLimit(1)
                            .accessibilityHint(PledgeClaimRow.currencyMismatchWhy)
                    }
                }
                if caps.manage {
                    HStack(spacing: 8) {
                        FinanceButton(title: "Reject", icon: "nosign", style: .danger) { deciding = FinanceClaimDecision(claim: c, confirm: false) }
                        FinanceButton(title: "Confirm", icon: "checkmark", style: .primary) { deciding = FinanceClaimDecision(claim: c, confirm: true) }
                            .disabled(!c.canConfirm)
                            .opacity(c.canConfirm ? 1 : 0.5)
                            .accessibilityHint(c.canConfirm ? "" : PledgeClaimRow.currencyMismatchWhy)
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

    /// What confirming / rejecting will do — the web's own sentences
    /// (logic.ts claimConfirmConsequence / claimRejectConsequence).
    private func consequence(_ d: FinanceClaimDecision) -> [String] {
        let c = d.claim
        let amount = FinanceMoney.format(c.amountMinor, c.currency)
        guard d.confirm else {
            return ["Rejects \(c.fullName)’s claim of \(amount).",
                    "Nothing is recorded, and they are told the office could not confirm it."]
        }
        let fund: String
        if let f = vm.paysTo[c.pledgeId] { fund = f.name.isEmpty ? f.code : f.name }
        else if vm.paysToFailed.contains(c.pledgeId) { fund = "the fund the pledge pays to" }
        else { fund = "the fund the pledge pays to (looking it up…)" }
        return ["Records \(amount) to \(fund) and counts it toward “\(c.pledgeTitle)”.",
                "\(c.fullName) gets a receipt. A mistake is corrected later by reversing the gift in Transactions."]
    }
}
