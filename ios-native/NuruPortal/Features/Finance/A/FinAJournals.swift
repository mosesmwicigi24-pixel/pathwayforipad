// Finance → Ledger: journals — one journal in full (GET /admin/finance/
// journals/{id}; the web's JournalDrawer) and the Reverse flow for transfers
// and opening balances (finance:approve; POST …/{id}/reverse): the consequence
// first, a reason (5–300), and — when the reversal would take the debited fund
// below zero (422 details.reason NEGATIVE_BALANCE) — "Reverse anyway?" before
// it is resent with allow_negative. Same words as the web's Journals panel.
import SwiftUI

/// A reversal the server refused for NEGATIVE_BALANCE, waiting for "anyway".
struct FinAPendingReversal: Identifiable {
    let journal: FinJournal
    let reason: String
    let after: Int?
    var id: String { journal.journalId }

    /// "Reversing takes the fund it debits below zero — to KES -3,000.00. The fund shows a negative balance until money comes in."
    var message: String {
        let currency = journal.totals.first?.currency
        let to = (after != nil && currency != nil) ? " — to \(FinanceMoney.format(after ?? 0, currency ?? ""))" : ""
        return "Reversing takes the fund it debits below zero\(to). The fund shows a negative balance until money comes in."
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
                FinanceReasonSheet(title: "Reverse this \(FinWords.journalKind(j.kind).lowercased())?",
                                   message: FinanceARules.journalReversalConsequence(j, fundNames: fundNames),
                                   confirmLabel: "Reverse",
                                   placeholder: "e.g. Posted to the wrong fund") { reason in
                    do {
                        let r = try await FinanceERPAPI.reverseJournal(j.journalId, reason: reason)
                        toast = .success(Self.done(j, r))
                        onDone()
                    } catch let e where e.apiDetail("reason") == "NEGATIVE_BALANCE" {
                        pending = FinAPendingReversal(journal: j, reason: reason, after: Int(e.apiDetail("balance_after_minor") ?? ""))
                    } catch {
                        throw Self.plain(error)
                    }
                }
            }
            .alert("Reverse anyway?", isPresented: $confirm, presenting: pending) { p in
                Button("Reverse anyway", role: .destructive) { Task { await reverseAnyway(p) } }
                Button("Cancel", role: .cancel) { pending = nil }
            } message: { p in
                Text(p.message)
            }
            .toast($toast)
    }

    private func reverseAnyway(_ p: FinAPendingReversal) async {
        do {
            let r = try await FinanceERPAPI.reverseJournal(p.journal.journalId, reason: p.reason, allowNegative: true)
            toast = .success(Self.done(p.journal, r))
            onDone()
        } catch {
            toast = .error(FinanceARules.message(error, fallback: "The journal was not reversed."))
        }
        pending = nil
    }

    /// "Transfer reversed — KES 50,000.00 posted back."
    static func done(_ j: FinJournal, _ r: FinJournal) -> String {
        let money = r.totals.map { FinanceMoney.format($0.amountMinor, $0.currency) }.joined(separator: " + ")
        return "\(FinWords.journalKind(j.kind)) reversed — \(money) posted back."
    }

    /// The reason sheet shows the error as the web does: the server's sentence, else the fallback.
    static func plain(_ error: Error) -> Error {
        APIError.http(status: error.apiStatus ?? 0, message: FinanceARules.message(error, fallback: "The journal was not reversed."), info: nil)
    }
}

extension View {
    /// Present the Reverse flow for `target` (a transfer or opening journal).
    func finAJournalReversal(target: Binding<FinJournal?>, fundNames: [String: String], onDone: @escaping () -> Void) -> some View {
        modifier(FinAJournalReversal(target: target, fundNames: fundNames, onDone: onDone))
    }
}

extension FinanceARules {
    /// What reversing a transfer or an opening balance does, in the treasurer's
    /// words (the web's journalReversalConsequence).
    static func journalReversalConsequence(_ j: FinJournal, fundNames: [String: String] = [:]) -> String {
        let debit = j.legs.first { $0.side == "debit" }
        let credit = j.legs.first { $0.side == "credit" }
        let money = j.totals.isEmpty ? "the amount" : j.totals.map { FinanceMoney.format($0.amountMinor, $0.currency) }.joined(separator: " + ")
        let when = FinanceDates.display(j.occurredOn)
        func label(_ leg: FinBooksLeg) -> String { accountLabel(leg.account, fundNames: fundNames) }
        if j.kind == "transfer", let debit, let credit {
            return "Moves \(money) back from \(label(credit)) to \(label(debit)), dated \(when) like the original. The transfer stays in the ledger, marked reversed; a reversal can't itself be undone."
        }
        if j.kind == "opening", let debit, let credit {
            return "Takes the \(money) opening balance back out of \(label(credit)) and \(label(debit)), dated \(when). Post the correct opening balance afterwards; this can't be undone."
        }
        return "Posts the mirror of this journal (\(money)), dated \(when). This can't be undone."
    }

    /// Why a journal can (or can't) be reversed here.
    static func journalReversibility(_ j: FinJournal) -> (ok: Bool, reason: String?) {
        if j.kind == "expense" || j.kind == "expense_void" { return (false, "An expense is corrected by voiding it on the Expenses page.") }
        if j.kind == "reversal" { return (false, "A reversal is never reversed — post the right journal instead.") }
        if j.reversedByJournalId != nil { return (false, "Already reversed.") }
        return (true, nil)
    }

    /// "Transfer · KES 50,000.00" — a journal's title.
    static func journalTitle(_ j: FinJournal) -> String {
        "\(FinWords.journalKind(j.kind)) · \(j.totals.map { FinanceMoney.format($0.amountMinor, $0.currency) }.joined(separator: " + "))"
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
        FinAFormSheet(title: journal.map(FinanceARules.journalTitle) ?? "Journal",
                      subtitle: journal.map { "Dated \(FinanceDates.display($0.occurredOn))" }) {
            if let j = journal {
                FinAJournalDetail(journal: j, caps: caps, fundNames: fundNames, showsMemo: true,
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
            if !Task.isCancelled { self.error = FinanceARules.message(error, fallback: "Could not load this journal.") }
        }
    }
}

/// A journal's kind, memo, meta line, legs and actions — the sheet and the
/// Journals tab's expanded row both show this (the web's JournalMeta + JournalLegs).
struct FinAJournalDetail: View {
    let journal: FinJournal
    let caps: FinanceCaps
    var fundNames: [String: String] = [:]
    /// The sheet shows the kind chips and memo; the expanded row already has them.
    var showsMemo = false
    var onReverse: () -> Void = {}
    /// Open another journal (the original / the reversal).
    var onOpen: ((String) -> Void)? = nil

    var body: some View {
        let j = journal
        let r = FinanceARules.journalReversibility(j)
        VStack(alignment: .leading, spacing: 12) {
            if showsMemo {
                HStack(spacing: 8) {
                    FinATag(text: FinWords.journalKind(j.kind), tone: Self.tone(j.kind))
                    if j.reversedByJournalId != nil { FinanceStatusChip(status: "refunded", label: "Reversed") }
                }
                if let memo = j.memo, !memo.isEmpty {
                    Text(memo).font(.inter(13.5)).foregroundStyle(Nuru.navy).fixedSize(horizontal: false, vertical: true)
                }
            }
            FinanceFlowLayout(spacing: 18, rowSpacing: 4) {
                Text("Entered \(FinanceATime.dayTime(j.createdAt))" + (j.createdByName.map { " by \($0)" } ?? ""))
                Text("journal \(j.journalId.prefix(8))").font(.nMono(12))
                if let o = j.reversalOf { Text("Mirrors journal \(o.prefix(8))") }
                if let rv = j.reversedByJournalId { Text("Reversed by journal \(rv.prefix(8))") }
            }
            .font(.inter(12)).foregroundStyle(Nuru.ink400)
            FinALegsTable(legs: j.legs, fundNames: fundNames)
            FinanceFlowLayout(spacing: 10, rowSpacing: 8) {
                if caps.approve && r.ok {
                    FinanceButton(title: showsMemo ? "Reverse" : "Reverse \(FinWords.journalKind(j.kind).lowercased())",
                                  icon: "arrow.uturn.backward", style: .danger, action: onReverse)
                }
                if caps.approve, !r.ok, let reason = r.reason {
                    Text(reason).font(.inter(12)).foregroundStyle(Nuru.ink400)
                }
                if let open = onOpen {
                    if let original = j.reversalOf {
                        FinanceButton(title: "Open the original") { open(original) }
                    }
                    if let reversal = j.reversedByJournalId {
                        FinanceButton(title: "Open its reversal") { open(reversal) }
                    }
                }
            }
        }
    }

    /// The web's KIND_TONE.
    static func tone(_ kind: String) -> (fg: Color, bg: Color) {
        switch kind {
        case "transfer": (Color(hex: 0x1E4068), Color(hex: 0xE6EDF5))
        case "opening": (Color(hex: 0x0D7E73), Color(hex: 0xE2F4F1))
        case "expense": (Color(hex: 0xA87616), Color(hex: 0xFFF4DA))
        case "expense_void": (Color(hex: 0x6B7280), Color(hex: 0xEEF0F3))
        case "reversal": (Color(hex: 0x7C3AED), Color(hex: 0xF3EAFE))
        default: FinanceStatus.grey
        }
    }
}
