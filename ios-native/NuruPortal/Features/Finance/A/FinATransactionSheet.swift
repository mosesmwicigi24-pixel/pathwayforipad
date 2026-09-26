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
    /// Open the member's partner record (Partners, member=<user_id>).
    var onOpenPartner: ((String) -> Void)? = nil
    /// Open the department need (Finance → Department needs, need=<id>).
    var onOpenNeed: ((String) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var detail: FinTransactionDetail?
    @State private var error: String?
    @State private var reversing = false
    @State private var toast: ToastData?

    init(transactionId: String, caps: FinanceCaps, fundNames: [String: String] = [:],
         onChanged: @escaping () -> Void = {}, onOpenMember: ((String, String) -> Void)? = nil,
         onOpenPartner: ((String) -> Void)? = nil, onOpenNeed: ((String) -> Void)? = nil) {
        self.transactionId = transactionId
        self.caps = caps
        self.fundNames = fundNames
        self.onChanged = onChanged
        self.onOpenMember = onOpenMember
        self.onOpenPartner = onOpenPartner
        self.onOpenNeed = onOpenNeed
    }

    private static let sourceLabels = ["app": "Member app", "website": "Website", "admin": "Office"]

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
            .navigationTitle(detail.map { FinanceMoney.format($0.transaction.amountMinor, $0.transaction.currency) } ?? "Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
                if let t = detail?.transaction, caps.manage, t.looksReversible {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Reverse") { reversing = true }.tint(Nuru.danger)
                    }
                }
            }
        }
        .presentationDetents([.large])
        .task(id: transactionId) { await load() }
        .sheet(isPresented: $reversing) {
            if let d = detail {
                let t = d.transaction
                FinanceReasonSheet(title: "Reverse this gift?",
                                   message: FinanceARules.reversalConsequence(amountMinor: t.amountMinor, currency: t.currency,
                                                                              fundName: t.fundName ?? t.fund, memberName: t.userId != nil ? (t.fullName ?? t.displayName) : nil,
                                                                              pledgeTitle: t.pledgeTitle, receiptCode: t.receiptCode),
                                   confirmLabel: "Reverse gift",
                                   placeholder: "e.g. Entered twice — the same envelope") { reason in
                    _ = try await FinanceERPAPI.reverseTransaction(t.transactionId, reason: reason)
                    toast = .success("Reversed — \(FinanceMoney.format(t.amountMinor, t.currency)) taken back out of \(t.fundName ?? t.fund ?? "its fund").")
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
            if !Task.isCancelled { self.error = FinanceARules.message(error, fallback: "Could not load this transaction.") }
        }
    }

    /// Where an office row / a confirmed claim / a provider payment came from, in words.
    private func channelText(_ t: FinTransactionDetailRow) -> String {
        if let oc = t.officeChannel { return "\(FinWords.channel(oc)) — recorded by the office" }
        if t.provider == "manual" { return "Paid another way — a confirmed claim" }
        return FinWords.channel(t.channel)
    }

    // MARK: Content

    @ViewBuilder private func content(_ d: FinTransactionDetail) -> some View {
        let t = d.transaction
        let reversed = t.reversedAt != nil
        HStack(spacing: 8) {
            FinanceStatusChip(status: reversed ? "reversed" : t.status)
            if let r = t.receiptCode { Text(r).font(.nMono(13, .medium)).foregroundStyle(Nuru.navy).textSelection(.enabled) }
            Text(Self.sourceLabels[t.source] ?? t.source).font(.nCaption).foregroundStyle(Nuru.ink600)
            Spacer(minLength: 0)
        }
        Text("\(t.displayName) · \(t.source == "admin" ? FinanceATime.day(t.createdAt) : FinanceATime.dayTime(t.createdAt))")
            .font(.nBody).foregroundStyle(Nuru.ink600)
        if reversed {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.uturn.backward").font(.system(size: 12, weight: .bold))
                    Text("Reversed \(FinanceATime.dayTime(t.reversedAt))" + (t.reversedByName.map { " by \($0)" } ?? ""))
                        .font(.inter(13, .bold))
                }
                .foregroundStyle(Color(hex: 0x6D28D9))
                if let reason = t.reversalReason, !reason.isEmpty {
                    Text("“\(reason)”").font(.inter(13)).foregroundStyle(Nuru.navy).textSelection(.enabled)
                }
                Text("The mirror postings below take the money back out, dated at the gift's own day so every period nets to zero. The receipt number stays on this entry.")
                    .font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFBF7FF))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Color(hex: 0xE4D4FB), lineWidth: 1))
        }
        FinACard(icon: "doc.text", title: "The gift") {
            FinAFacts(facts: facts(t))
        }
        if t.userId != nil || t.needId != nil {
            HStack(spacing: 8) {
                if let userId = t.userId, let open = onOpenMember {
                    FinanceButton(title: "Member profile", icon: "person.crop.circle") {
                        dismiss()
                        open(userId, t.fullName ?? t.displayName)
                    }
                }
                if let userId = t.userId, let open = onOpenPartner {
                    FinanceButton(title: "Partner record", icon: "signature") {
                        dismiss()
                        open(userId)
                    }
                }
                if let needId = t.needId, let open = onOpenNeed {
                    FinanceButton(title: "Department need", icon: "target") {
                        dismiss()
                        open(needId)
                    }
                }
            }
        }
        VStack(alignment: .leading, spacing: 8) {
            FinASectionTitle(icon: "book.closed", title: "Ledger postings")
            FinAExplain("Every posting this transaction owns: the cash account it came into is debited, its fund credited — and, once reversed, the mirror pair.")
            if d.ledgerEntries.isEmpty {
                FinanceNoticeBar(notice: .warn("This transaction owns no ledger postings — no fund shows its money. If it succeeded, Reconciliation lists it; tell the developer."))
            } else {
                FinALegsTable(legs: d.ledgerEntries, fundNames: t.fund.map { [$0: t.fundName ?? $0] } ?? fundNames, isReversal: \.isReversal)
            }
        }
        if caps.manage, t.provider != "manual", t.status == "succeeded" {
            FinAExplain("A \(FinWords.channel(t.channel)) payment is refunded at the provider, not reversed here — the books follow the provider's refund.")
        }
    }

    private func facts(_ t: FinTransactionDetailRow) -> [FinAFact] {
        var giver = t.displayName
        if t.userId == nil { giver += (t.giverName != nil || t.giverPhone != nil) ? " · walk-in, no member account" : " · anonymous" }
        if let phone = t.memberPhone ?? t.giverPhone { giver += "\n\(phone)" }
        if let email = t.giverEmail { giver += "\n\(email)" }
        var out = [
            FinAFact("Giver", giver),
            FinAFact("Amount", FinanceMoney.format(t.amountMinor, t.currency)),
            FinAFact("Fund", t.fund.map { "\(t.fundName ?? $0)  fund:\($0)" } ?? "— (a media purchase)"),
            FinAFact("Channel", channelText(t)),
        ]
        if let ref = t.officeReference {
            let label = t.officeChannel == "mpesa" ? "M-Pesa code" : t.officeChannel == "cheque" ? "Cheque number" : t.officeChannel == "bank" ? "Bank reference" : "Reference"
            out.append(FinAFact(label, ref, mono: true))
        }
        if let pref = t.providerRef { out.append(FinAFact("Provider ref", pref, mono: true)) }
        out.append(t.source == "admin" ? FinAFact("Received", FinanceATime.day(t.createdAt)) : FinAFact("Started", FinanceATime.dayTime(t.createdAt)))
        if let settled = t.settledAt, t.source != "admin" { out.append(FinAFact("Settled", FinanceATime.dayTime(settled))) }
        if let p = t.pledgeTitle { out.append(FinAFact("Pledge", p)) }
        if let n = t.needTitle { out.append(FinAFact("Department need", n)) }
        if let note = t.accountName { out.append(FinAFact("Note on receipt", note)) }
        if t.recordedByName != nil || t.recordedBy != nil { out.append(FinAFact("Recorded by", t.recordedByName)) }
        if t.scheduleId != nil { out.append(FinAFact("Recurring gift", "Collected by a recurring schedule")) }
        if let pi = t.stripePaymentIntent { out.append(FinAFact("Stripe", pi, mono: true)) }
        return out
    }
}
