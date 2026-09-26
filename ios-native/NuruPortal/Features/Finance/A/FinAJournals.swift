// Finance → Ledger: journals — one journal in full (GET /admin/finance/
// journals/{id}) and the Reverse flow for transfers and opening balances
// (finance:approve; POST …/{id}/reverse): a reason (5–300), the consequence in
// words, and — when the reversal would take the debited fund below zero (422
// details.reason NEGATIVE_BALANCE) — the numbers and a second confirmation
// before it is posted with allow_negative.
import SwiftUI

/// A reversal the server refused for NEGATIVE_BALANCE, waiting for "anyway".
struct FinAPendingReversal: Identifiable {
    let journal: FinJournal
    let reason: String
    let balance: Int?
    let after: Int?
    var id: String { journal.journalId }

    func message(fundNames: [String: String]) -> String {
        let credit = journal.legs.first { $0.side == "credit" }
        let fund = credit.map { FinanceARules.accountLabel($0.account, fundNames: fundNames) } ?? "The fund"
        let currency = journal.totals.first?.currency ?? credit?.currency ?? ""
        let now = balance.map { FinanceMoney.format($0, currency) } ?? "less than this"
        let then = after.map { " and would be \(FinanceMoney.format($0, currency)) after" } ?? ""
        return "\(fund) holds \(now)\(then). Nothing was posted. Reverse anyway and let it show a negative balance until money comes in?"
    }
}

/// The Reverse flow as a modifier, so the Journals tab and the journal sheet
/// share it: set `target` to a journal to start.
private struct FinAJournalReversal: ViewModifier {
    @Binding var target: FinJournal?
    let fundNames: [String: String]
    let onDone: () -> Void
    @State private var pending: FinAPendingReversal?
    @State private var confirm = false
    @State private var toast: ToastData?

    init(target: Binding<FinJournal?>, fundNames: [String: String], onDone: @escaping () -> Void) {
        _target = target
        self.fundNames = fundNames
        self.onDone = onDone
    }

    func body(content: Content) -> some View {
        content
            .sheet(item: $target, onDismiss: { if pending != nil { confirm = true } }) { j in
                FinanceReasonSheet(title: j.kind == "opening" ? "Reverse this opening balance" : "Reverse this transfer",
                                   message: FinanceARules.journalReversalConsequence(j, fundNames: fundNames),
                                   confirmLabel: "Reverse") { reason in
                    do {
                        _ = try await FinanceERPAPI.reverseJournal(j.journalId, reason: reason)
                        toast = .success("Reversed — the mirror journal is posted")
                        onDone()
                    } catch let e where e.apiDetail("reason") == "NEGATIVE_BALANCE" {
                        pending = FinAPendingReversal(journal: j, reason: reason,
                                                      balance: Int(e.apiDetail("balance_minor") ?? ""),
                                                      after: Int(e.apiDetail("balance_after_minor") ?? ""))
                    } catch {
                        throw FinAJournalReversal.plain(error)
                    }
                }
            }
            .alert("Take the fund below zero?", isPresented: $confirm, presenting: pending) { p in
                Button("Reverse anyway", role: .destructive) { Task { await reverseAnyway(p) } }
                Button("Cancel", role: .cancel) { pending = nil }
            } message: { p in
                Text(p.message(fundNames: fundNames))
            }
            .toast($toast)
    }

    private func reverseAnyway(_ p: FinAPendingReversal) async {
        do {
            _ = try await FinanceERPAPI.reverseJournal(p.journal.journalId, reason: p.reason, allowNegative: true)
            toast = .success("Reversed — the fund now shows a negative balance")
            onDone()
        } catch {
            toast = .error(FinanceARules.message(FinAJournalReversal.plain(error)))
        }
        pending = nil
    }

    /// The named refusals in plain words (the reason sheet shows them inline).
    static func plain(_ error: Error) -> Error {
        let text: String?
        switch error.apiCode {
        case "ALREADY_REVERSED": text = "This journal was reversed already — a journal is reversed once."
        case "USE_EXPENSE_VOID": text = "An expense journal is undone by voiding the expense (Expenses → Void)."
        case "NOT_REVERSIBLE": text = "A reversal can't itself be reversed — post the right journal instead."
        case "FORBIDDEN_SCOPE": text = "Reversing journals needs the finance:approve permission."
        default: text = nil
        }
        guard let text else { return error }
        return APIError.http(status: error.apiStatus ?? 422, message: text, info: nil)
    }
}

extension View {
    /// Present the Reverse flow for `target` (a transfer or opening journal).
    func finAJournalReversal(target: Binding<FinJournal?>, fundNames: [String: String], onDone: @escaping () -> Void) -> some View {
        modifier(FinAJournalReversal(target: target, fundNames: fundNames, onDone: onDone))
    }
}

extension FinanceARules {
    /// The Reverse sheet's consequence for a journal: a transfer goes back the
    /// way it came; an opening balance comes back out of the fund and the cash
    /// account — both dated on the original's day.
    static func journalReversalConsequence(_ j: FinJournal, fundNames: [String: String] = [:]) -> String {
        let debit = j.legs.first { $0.side == "debit" }
        let credit = j.legs.first { $0.side == "credit" }
        let amount = j.totals.first.map { FinanceMoney.format($0.amountMinor, $0.currency) } ?? "its amount"
        let day = FinanceDates.display(j.occurredOn)
        func name(_ leg: FinBooksLeg?) -> String { leg.map { accountLabel($0.account, fundNames: fundNames) } ?? "the other account" }
        switch j.kind {
        case "transfer":
            return "Posts the mirror of this transfer, dated \(day): \(amount) goes back from \(name(credit)) to \(name(debit)). The transfer stays on the record, marked reversed; a journal is reversed once."
        case "opening":
            return "Takes this opening balance back out, dated \(day): debits \(name(credit)) and credits \(name(debit)) by \(amount). Then post the right one from Funds → Opening balance."
        default:
            return "Posts the mirror of this journal, dated \(day)."
        }
    }
}

// MARK: - One journal

struct FinAJournalSheet: View {
    let caps: FinanceCaps
    var fundNames: [String: String] = [:]
    var onChanged: () -> Void = {}

    @State private var currentId: String
    @State private var journal: FinJournal?
    @State private var error: String?
    @State private var reverseTarget: FinJournal?

    init(journalId: String, caps: FinanceCaps, fundNames: [String: String] = [:], onChanged: @escaping () -> Void = {}) {
        self.caps = caps
        self.fundNames = fundNames
        self.onChanged = onChanged
        _currentId = State(initialValue: journalId)
    }

    var body: some View {
        FinAFormSheet(title: journal.map { FinWords.journalKind($0.kind) } ?? "Journal") {
            if let j = journal {
                FinAJournalDetail(journal: j, caps: caps, fundNames: fundNames,
                                  onReverse: { reverseTarget = j },
                                  onOpen: { id in currentId = id })
            } else if let error {
                ErrorBanner(message: error) { Task { await load() } }
            } else {
                SkeletonTable(rows: 4)
            }
        }
        .task(id: currentId) { await load() }
        .finAJournalReversal(target: $reverseTarget, fundNames: fundNames) {
            onChanged()
            Task { await load() }
        }
    }

    private func load() async {
        do {
            journal = try await FinanceERPAPI.journal(currentId)
            error = nil
        } catch {
            if !Task.isCancelled { self.error = FinanceARules.message(error) }
        }
    }
}

/// A journal's facts, legs and actions — the sheet and the Journals tab's
/// expanded row both show this.
struct FinAJournalDetail: View {
    let journal: FinJournal
    let caps: FinanceCaps
    var fundNames: [String: String] = [:]
    var onReverse: () -> Void = {}
    /// Open another journal (the original / the reversal).
    var onOpen: ((String) -> Void)? = nil

    var body: some View {
        let j = journal
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        FinATag(text: FinWords.journalKind(j.kind), tone: FinAJournalDetail.tone(j.kind))
                        if j.reversedByJournalId != nil { FinATag(text: "Reversed", tone: FinanceStatus.violet, icon: "arrow.uturn.backward") }
                        if j.reversalOf != nil { FinATag(text: "Reversal", tone: FinanceStatus.violet) }
                    }
                    Text(j.memo?.isEmpty == false ? (j.memo ?? "") : "No memo").font(.inter(14, .semibold))
                        .foregroundStyle(j.memo?.isEmpty == false ? Nuru.navy : Nuru.ink400)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if caps.approve && j.looksReversible {
                    FinanceButton(title: "Reverse…", icon: "arrow.uturn.backward", style: .danger, action: onReverse)
                }
            }
            FinAFacts(facts: [
                FinAFact("Dated", FinanceDates.display(j.occurredOn)),
                FinAFact("Amount", FinanceMoney.lines(j.totals.map { ($0.currency, $0.amountMinor) }).joined(separator: " · ")),
                FinAFact("Entered", FinanceATime.dayTime(j.createdAt)),
                FinAFact("Entered by", j.createdByName),
                FinAFact("Journal", j.journalId, mono: true),
                FinAFact("Refers to", j.refId, mono: true),
            ], minimum: 170)
            if let open = onOpen {
                HStack(spacing: 8) {
                    if let original = j.reversalOf {
                        FinanceButton(title: "Open the original", icon: "arrow.uturn.left") { open(original) }
                    }
                    if let reversal = j.reversedByJournalId {
                        FinanceButton(title: "Open the reversal", icon: "arrow.uturn.right") { open(reversal) }
                    }
                }
            }
            FinALegsTable(legs: j.legs, fundNames: fundNames)
            if j.kind == "expense" || j.kind == "expense_void" {
                FinAExplain("Expense journals are undone by voiding the expense (Expenses → Void), not here.")
            }
        }
    }

    static func tone(_ kind: String) -> (fg: Color, bg: Color) {
        switch kind {
        case "expense": FinanceStatus.amberStrong
        case "expense_void", "reversal": FinanceStatus.violet
        case "transfer": FinanceStatus.navy
        case "opening": FinanceStatus.green
        default: FinanceStatus.grey
        }
    }
}
