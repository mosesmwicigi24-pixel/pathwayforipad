// Finance → Transactions: one transaction in full (GET /admin/finance/
// transactions/{id}) — every field the office needs, the office record, the
// reversal block and EVERY ledger leg it owns — and the Reverse action for
// office gifts and confirmed claims (finance:manage; POST …/{id}/reverse).
// Also opened from the Ledger (a transaction posting) and deep links (tx=<id>).
import SwiftUI

struct FinATransactionSheet: View {
    let transactionId: String
    let caps: FinanceCaps
    var fundNames: [String: String] = [:]
    /// The list behind should refresh (a reversal changed this row).
    var onChanged: () -> Void = {}
    /// Open the member's profile (the sheet dismisses first).
    var onOpenMember: ((String, String) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var detail: FinTransactionDetail?
    @State private var error: String?
    @State private var reversing = false
    @State private var toast: ToastData?

    init(transactionId: String, caps: FinanceCaps, fundNames: [String: String] = [:],
         onChanged: @escaping () -> Void = {}, onOpenMember: ((String, String) -> Void)? = nil) {
        self.transactionId = transactionId
        self.caps = caps
        self.fundNames = fundNames
        self.onChanged = onChanged
        self.onOpenMember = onOpenMember
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let d = detail {
                        content(d)
                    } else if let error {
                        ErrorBanner(message: error) { Task { await load() } }
                    } else {
                        SkeletonTable(rows: 6)
                    }
                }
                .padding(24)
                .frame(maxWidth: 860, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle(detail?.transaction.receiptCode ?? "Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
        .presentationDetents([.large])
        .task(id: transactionId) { await load() }
        .sheet(isPresented: $reversing) {
            if let d = detail {
                FinanceReasonSheet(title: "Reverse this gift",
                                   message: reverseMessage(d),
                                   confirmLabel: "Reverse gift") { reason in
                    _ = try await FinanceERPAPI.reverseTransaction(d.transaction.transactionId, reason: reason)
                    toast = .success("Reversed — \(d.transaction.receiptCode ?? "the receipt number") stays on the record")
                    onChanged()
                    await load()
                }
            }
        }
        .toast($toast)
    }

    private func load() async {
        do {
            detail = try await FinanceERPAPI.transaction(transactionId)
            error = nil
        } catch {
            if !Task.isCancelled { self.error = FinanceARules.message(error) }
        }
    }

    private func reverseMessage(_ d: FinTransactionDetail) -> String {
        let t = d.transaction
        let consequence = FinanceARules.reversalConsequence(amountMinor: t.amountMinor, currency: t.currency,
                                                            fundName: t.fundName ?? t.fund, memberName: t.fullName,
                                                            pledged: t.pledgeId != nil)
        return consequence + " The mirror entries are dated \(FinanceATime.day(t.createdAt)), the day of the gift, so that day's takings are restated. The receipt number \(t.receiptCode ?? "") stays on the record, marked reversed — it is never reused."
    }

    // MARK: Content

    @ViewBuilder private func content(_ d: FinTransactionDetail) -> some View {
        let t = d.transaction
        header(d)
        if t.reversedAt != nil { reversalBlock(d) }
        FinACard(icon: "gift", title: "The gift") {
            FinAFacts(facts: [
                FinAFact("Amount", FinanceMoney.format(t.amountMinor, t.currency)),
                FinAFact("Fund", [t.fundName, t.fund.map { "(\($0))" }].compactMap { $0 }.joined(separator: " ")),
                FinAFact("Received (EAT)", FinanceATime.dayTime(t.createdAt)),
                FinAFact("Settled (EAT)", t.settledAt.map { FinanceATime.dayTime($0) }),
                FinAFact("Channel", FinWords.channel(t.channel)),
                FinAFact("Source", FinWords.source(t.source)),
                FinAFact("Provider", t.provider),
                FinAFact("Receipt", t.receiptCode, mono: true),
                FinAFact("Provider reference", t.providerRef ?? t.stripePaymentIntent, mono: true),
                FinAFact("Receipt note", t.accountName),
            ])
        }
        FinACard(icon: "person", title: "Giver") {
            FinAFacts(facts: [
                FinAFact("Shown as", t.giverLabel),
                FinAFact("Member", t.fullName),
                FinAFact("Member phone", t.memberPhone),
                FinAFact("Giver name", t.giverName),
                FinAFact("Giver phone", t.giverPhone),
                FinAFact("Giver email", t.giverEmail),
                FinAFact("Pledge", t.pledgeTitle),
                FinAFact("Department need", t.needTitle),
                FinAFact("Recurring gift", t.scheduleId == nil ? nil : "Yes — from a recurring schedule"),
            ])
        }
        if t.isOffice || t.officeChannel != nil || t.recordedBy != nil {
            FinACard(icon: "building.columns", title: "Office record") {
                FinAFacts(facts: [
                    FinAFact("Office channel", t.officeChannel.map { FinWords.channel($0) }),
                    FinAFact(t.officeChannel == "mpesa" ? "M-Pesa code" : "Office reference", t.officeReference, mono: true),
                    FinAFact("Recorded by", t.recordedByName),
                    FinAFact("Form key", t.idempotencyKey, mono: true),
                ])
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(icon: "book.closed", title: "Ledger postings", caption: "\(d.ledgerEntries.count) legs, oldest first")
            FinALegsTable(legs: d.ledgerEntries, fundNames: fundNames, isReversal: \.isReversal)
            FinAExplain("Each posting debits one account and credits another by the same amount. A reversal posts the mirror pair on the gift's own date.")
        }
    }

    private func header(_ d: FinTransactionDetail) -> some View {
        let t = d.transaction
        return HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    FinanceStatusChip(status: t.reversedAt != nil ? "reversed" : t.status)
                    if let r = t.receiptCode { Text(r).font(.nMono(13, .medium)).foregroundStyle(Nuru.ink600).textSelection(.enabled) }
                }
                Text(FinanceMoney.format(t.amountMinor, t.currency))
                    .font(.inter(28, .bold)).foregroundStyle(t.reversedAt != nil ? Nuru.ink400 : Nuru.navy)
                    .strikethrough(t.reversedAt != nil, color: Nuru.ink400)
                    .monospacedDigit()
                Text("\(t.giverLabel) · \(t.fundName ?? t.fund ?? "no fund") · \(FinanceATime.day(t.createdAt))")
                    .font(.nBody).foregroundStyle(Nuru.ink600)
            }
            Spacer(minLength: 12)
            VStack(alignment: .trailing, spacing: 8) {
                if caps.manage && t.looksReversible {
                    FinanceButton(title: "Reverse…", icon: "arrow.uturn.backward", style: .danger) { reversing = true }
                }
                if let userId = t.userId, let name = t.fullName, let open = onOpenMember {
                    FinanceButton(title: "Member profile", icon: "person.crop.circle") {
                        dismiss()
                        open(userId, name)
                    }
                }
            }
        }
        .padding(16)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func reversalBlock(_ d: FinTransactionDetail) -> some View {
        let t = d.transaction
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.uturn.backward.circle.fill").foregroundStyle(FinanceStatus.violet.fg)
                Text("Reversed").font(.inter(14, .bold)).foregroundStyle(FinanceStatus.violet.fg)
            }
            Text("Reversed \(FinanceATime.dayTime(t.reversedAt)) by \(t.reversedByName ?? "—"). The money left \(t.fundName ?? "the fund") on the gift's own date; the receipt number stays on the record.")
                .font(.nCaption).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
            if let reason = t.reversalReason, !reason.isEmpty {
                Text("“\(reason)”").font(.inter(13.5, .medium)).foregroundStyle(Nuru.ink).textSelection(.enabled)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FinanceStatus.violet.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
    }
}
