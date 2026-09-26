// Finance → Expenses — the sheets: the detail with its full trail and the
// actions (edit · approve · void), the record / edit form, and the two money
// confirmations. Every confirmation states its consequence on the fund:
// approving takes the amount OUT of the fund (which may go below zero — real
// money has already left), voiding an approved expense puts it BACK; both show
// "<Fund> balance: before → after this" in the expense's currency, from GET
// /admin/finance/funds (finance:view). See FinanceExpensesView.swift.
import SwiftUI

// MARK: - A fund's balance, before and after a posting

enum FinBFundBalance: Equatable {
    case loading
    /// The fund's balance in the expense's currency (credits − debits, all time).
    case loaded(Int)
    case failed(String)

    /// GET /admin/finance/funds → that fund's balance in `currency` (0 when the
    /// fund holds none of it yet).
    static func load(fund code: String, currency: String) async -> FinBFundBalance {
        do {
            let page = try await FinanceERPAPI.funds(period: nil)
            guard let row = page.data.first(where: { $0.code == code }) else {
                return .failed("\(code) is not in the funds list.")
            }
            return .loaded(row.balances.first { $0.currency.uppercased() == currency.uppercased() }?.balanceMinor ?? 0)
        } catch {
            return .failed(FinBError.message(error, fallback: "Could not read the fund's balance."))
        }
    }
}

/// "<Fund> balance: KES 120,000.00 → KES 108,000.00 after this" and, when the
/// result is below zero, the overdrawn warning (the write is still allowed).
struct FinBFundBalanceLine: View {
    let fundName: String
    let currency: String
    /// Signed change to the fund: −amount on approval, +amount when an approved expense is voided.
    let deltaMinor: Int
    let state: FinBFundBalance

    var body: some View {
        switch state {
        case .loading:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Reading \(fundName)'s balance…").font(.nCaption).foregroundStyle(Nuru.ink600)
            }
        case .failed(let message):
            FinanceNoticeBar(notice: .warn("\(fundName)'s balance is unavailable (\(message)) — the posting itself is not affected."))
        case .loaded(let before):
            let after = before + deltaMinor
            VStack(alignment: .leading, spacing: 8) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(fundName) balance:").font(.inter(13.5, .medium)).foregroundStyle(Nuru.ink600)
                    Text(FinanceMoney.format(before, currency)).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
                    Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Nuru.ink400)
                    Text(FinanceMoney.format(after, currency)).font(.inter(13.5, .bold))
                        .foregroundStyle(after < 0 ? FinanceStatus.red.fg : Nuru.navy).monospacedDigit()
                    Text("after this").font(.inter(13.5, .medium)).foregroundStyle(Nuru.ink600)
                }
                .accessibilityElement(children: .combine)
                if after < 0 {
                    FinanceNoticeBar(notice: .warn("\(fundName) will be \(FinanceMoney.format(-after, currency)) overdrawn — approve only if the money has really left."))
                }
            }
        }
    }
}

// MARK: - Detail

struct FinanceExpenseDetailSheet: View {
    @ObservedObject var model: FinanceExpensesModel
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var expense: FinExpense
    @State private var sub: Sub?

    enum Sub: String, Identifiable { case edit, approve, void; var id: String { rawValue } }

    init(expense: FinExpense, model: FinanceExpensesModel) {
        _expense = State(initialValue: expense)
        self.model = model
    }

    var body: some View {
        let caps = auth.financeCaps
        let e = expense
        let maker = FinBMakerChecker.state(caps: caps, status: e.status, recordedBy: e.recordedBy, editedByMe: model.editedByMe(e.id))
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(e.payee).font(.inter(18, .bold)).foregroundStyle(Nuru.navy)
                            FinBAmount(minor: e.amountMinor, currency: e.currency, size: 22,
                                       color: e.status == "void" ? Nuru.ink400 : Nuru.navy)
                                .strikethrough(e.status == "void", color: Nuru.ink400)
                        }
                        Spacer()
                        FinanceStatusChip(status: e.status, label: e.status == "recorded" ? "Awaiting approval" : nil)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        FinBKeyValue("Spent on", FinanceDates.display(e.spentOn))
                        FinBKeyValue("Paid via", FinWords.channel(e.channel))
                        FinBKeyValue("Fund", e.fund.name.isEmpty ? e.fund.code : e.fund.name)
                        FinBKeyValue("Category", e.category.name.isEmpty ? e.category.code : e.category.name)
                        FinBKeyValue("Reference", e.reference ?? "—", mono: true)
                        FinBKeyValue("Currency", e.currency)
                    }
                    if let d = e.description, !d.isEmpty {
                        FinBKeyValue(label: "Description") {
                            Text(d).font(.nBody).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    trail(e)
                    actions(e, caps: caps, maker: maker)
                    Text("Expense \(e.expenseId)").font(.nMono(11)).foregroundStyle(Nuru.ink400).textSelection(.enabled)
                }
                .padding(24)
                .frame(maxWidth: 700)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .navigationTitle("Expense")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .presentationDetents([.large])
        .sheet(item: $sub) { s in
            switch s {
            case .edit:
                FinanceExpenseFormSheet(existing: expense, lookups: model.lookups) { _, patch in
                    if let patch { expense = try await model.update(expense.expenseId, patch) }
                }
            case .approve:
                FinanceExpenseApproveSheet(expense: expense) { expense = try await model.approve(expense) }
            case .void:
                FinanceExpenseVoidSheet(expense: expense) { reason in expense = try await model.void(expense, reason: reason) }
            }
        }
    }

    /// Who did what, and when — recorded, approved (the posting), voided (with
    /// the reason and, for an approved one, the reversing posting).
    private func trail(_ e: FinExpense) -> some View {
        FinBCard(title: "Trail", caption: "Nothing is ever deleted — every step stays on the record and in the audit log.", icon: "clock.arrow.circlepath") {
            VStack(alignment: .leading, spacing: 12) {
                step(icon: "square.and.pencil", tint: FinanceStatus.amber.fg,
                     title: "Recorded by \(e.recordedByName ?? "someone")", when: FinBTime.stamp(e.recordedAt),
                     note: "Nothing posted — waiting for a different person to approve it.")
                if e.approvedAt != nil || e.status == "approved" || e.journalId != nil {
                    step(icon: "checkmark.seal", tint: Nuru.success,
                         title: "Approved by \(e.approvedByName ?? "someone")", when: FinBTime.stamp(e.approvedAt),
                         note: "Posted \(FinanceMoney.format(e.amountMinor, e.currency)) out of \(e.fund.name) via \(FinWords.channel(e.channel)), dated \(FinanceDates.display(e.spentOn))."
                            + (e.journalId.map { " Journal \(shortId($0))." } ?? ""))
                } else if e.status == "recorded" {
                    step(icon: "hourglass", tint: Nuru.ink400, title: "Awaiting approval", when: nil,
                         note: "A different person approves it — a SuperAdmin may approve their own.")
                }
                if e.status == "void" || e.voidedAt != nil {
                    step(icon: "xmark.octagon", tint: FinanceStatus.grey.fg,
                         title: "Voided by \(e.voidedByName ?? "someone")", when: FinBTime.stamp(e.voidedAt),
                         note: (e.voidReason.map { "“\($0)”. " } ?? "")
                            + (e.voidJournalId != nil
                               ? "The reversing entry gave \(e.fund.name) \(FinanceMoney.format(e.amountMinor, e.currency)) back. Journal \(shortId(e.voidJournalId ?? ""))."
                               : "It had not been posted, so the books did not change."))
                }
            }
        }
    }

    private func step(icon: String, tint: Color, title: String, when: String?, note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 26, height: 26).background(tint.opacity(0.12)).clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(title).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
                    if let when { Text(when).font(.nMicro).foregroundStyle(Nuru.ink400) }
                }
                Text(note).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private func actions(_ e: FinExpense, caps: FinanceCaps, maker: FinBMakerChecker.State) -> some View {
        let canEdit = caps.manage && e.status == "recorded"
        let canVoid = caps.manage && e.status != "void"
        if canEdit || canVoid || maker == .approve || maker == .maker {
            VStack(alignment: .leading, spacing: 10) {
                if maker == .maker {
                    FinanceNoticeBar(notice: .warn(FinBMakerChecker.sentence))
                }
                HStack(spacing: 10) {
                    if maker == .approve {
                        FinanceButton(title: "Approve", icon: "checkmark.seal", style: .primary) { sub = .approve }
                    }
                    if canEdit {
                        FinanceButton(title: "Edit", icon: "pencil") { sub = .edit }
                    }
                    Spacer(minLength: 0)
                    if canVoid {
                        FinanceButton(title: "Void", icon: "xmark.octagon", style: .danger) { sub = .void }
                    }
                }
            }
        }
    }

    private func shortId(_ id: String) -> String { id.count > 12 ? "\(id.prefix(8))…" : id }
}

// MARK: - Approve

struct FinanceExpenseApproveSheet: View {
    let expense: FinExpense
    let onApprove: () async throws -> Void
    @State private var balance: FinBFundBalance = .loading

    var body: some View {
        let e = expense
        let fund = e.fund.name.isEmpty ? e.fund.code : e.fund.name
        FinBConfirmSheet(
            title: "Approve this expense",
            consequence: [
                "Posts \(FinanceMoney.format(e.amountMinor, e.currency)) out of \(fund) via \(FinWords.channel(e.channel)) on \(FinanceDates.display(e.spentOn)).",
                "Paid to \(e.payee) · \(e.category.name). Once approved it is in the books; a mistake is corrected by voiding it, which posts the reversing entry.",
            ],
            confirmLabel: "Approve and post",
            onConfirm: onApprove,
            errorText: { FinBError.message($0, fallback: "Could not approve the expense.") }
        ) {
            FinBFundBalanceLine(fundName: fund, currency: e.currency, deltaMinor: -e.amountMinor, state: balance)
        }
        .task { balance = await FinBFundBalance.load(fund: e.fund.code, currency: e.currency) }
    }
}

// MARK: - Void

struct FinanceExpenseVoidSheet: View {
    let expense: FinExpense
    let onVoid: (String) async throws -> Void
    @State private var balance: FinBFundBalance = .loading

    var body: some View {
        let e = expense
        let fund = e.fund.name.isEmpty ? e.fund.code : e.fund.name
        let amount = FinanceMoney.format(e.amountMinor, e.currency)
        if e.status == "approved" {
            FinanceReasonSheet(title: "Void this expense",
                               message: "Posts the reversing entry — \(fund) gets \(amount) back, dated \(FinanceDates.display(e.spentOn)) like the original. \(balanceSentence(fund: fund, before: balance, delta: e.amountMinor, currency: e.currency)) The expense stays on the record, marked void, with your reason.",
                               confirmLabel: "Void and reverse") { reason in try await onVoid(reason) }
                .task { balance = await FinBFundBalance.load(fund: e.fund.code, currency: e.currency) }
        } else {
            FinanceReasonSheet(title: "Void this expense",
                               message: "Voids it — it was never posted, so no balance changes. The expense stays on the record, marked void, with your reason.",
                               confirmLabel: "Void") { reason in try await onVoid(reason) }
        }
    }

    /// "Tithe balance: KES 108,000.00 → KES 120,000.00 after this."
    private func balanceSentence(fund: String, before: FinBFundBalance, delta: Int, currency: String) -> String {
        switch before {
        case .loading: "(Reading \(fund)'s balance…)"
        case .failed: "(\(fund)'s balance is unavailable.)"
        case .loaded(let b): "\(fund) balance: \(FinanceMoney.format(b, currency)) → \(FinanceMoney.format(b + delta, currency)) after this."
        }
    }
}

// MARK: - Record / edit

struct FinanceExpenseFormSheet: View {
    let existing: FinExpense?
    @ObservedObject var lookups: FinBLookups
    /// Record: (input, nil). Edit: (nil, patch). Throws to keep the sheet open.
    let onSubmit: (FinExpenseInput?, FinExpensePatch?) async throws -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var payee = ""
    @State private var amount = ""
    @State private var currency = "KES"
    @State private var fund = ""
    @State private var category = ""
    @State private var spentOn = FinanceDates.today()
    @State private var channel: FinOfficeChannel = .bank
    @State private var reference = ""
    @State private var details = ""
    @State private var busy = false
    @State private var error: String?
    @State private var tried = false

    private let earliest = FinanceDates.todayOffset(-366)
    private let latest = FinanceDates.today()

    init(existing: FinExpense?, lookups: FinBLookups,
         onSubmit: @escaping (FinExpenseInput?, FinExpensePatch?) async throws -> Void) {
        self.existing = existing
        self.lookups = lookups
        self.onSubmit = onSubmit
        if let e = existing {
            _payee = State(initialValue: e.payee)
            _amount = State(initialValue: FinanceMoney.majorString(e.amountMinor))
            _currency = State(initialValue: e.currency)
            _fund = State(initialValue: e.fund.code)
            _category = State(initialValue: e.category.code)
            _spentOn = State(initialValue: e.spentOn)
            _channel = State(initialValue: FinOfficeChannel(rawValue: e.channel) ?? .other)
            _reference = State(initialValue: e.reference ?? "")
            _details = State(initialValue: e.description ?? "")
        }
    }

    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var payeeProblem: String? {
        let n = trimmed(payee).count
        return n < 2 ? "Who was paid — at least 2 characters." : n > 120 ? "At most 120 characters." : nil
    }
    private var amountMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(amount) }
    private var dateProblem: String? {
        guard FinanceDates.date(fromYMD: spentOn) != nil else { return "Choose the day it was spent." }
        if spentOn > latest { return "It cannot be in the future." }
        if spentOn < earliest { return "At most 366 days ago." }
        return nil
    }
    private var referenceProblem: String? { trimmed(reference).count > 80 ? "At most 80 characters." : nil }
    private var detailsProblem: String? { trimmed(details).count > 500 ? "At most 500 characters." : nil }

    private var valid: Bool {
        guard payeeProblem == nil, !fund.isEmpty, !category.isEmpty, dateProblem == nil,
              referenceProblem == nil, detailsProblem == nil, case .success = amountMinor else { return false }
        return true
    }

    private var fundOptions: [FinanceFilterOption] {
        var list = lookups.activeFunds.map { FinanceFilterOption($0.code, $0.name) }
        if !fund.isEmpty, !list.contains(where: { $0.value == fund }) { list.insert(.init(fund, "\(lookups.fundName(fund)) (inactive)"), at: 0) }
        return list
    }
    private var categoryOptions: [FinanceFilterOption] {
        var list = lookups.activeCategories.map { FinanceFilterOption($0.code, $0.name) }
        if !category.isEmpty, !list.contains(where: { $0.value == category }) {
            list.insert(.init(category, "\(existing?.category.name ?? lookups.categoryName(category)) (inactive)"), at: 0)
        }
        return list
    }

    var body: some View {
        FinBFormSheet(title: existing == nil ? "Record an expense" : "Edit expense",
                      confirmLabel: existing == nil ? "Record" : "Save",
                      canConfirm: true, busy: busy, error: error, onConfirm: save) {
            FinanceNoticeBar(notice: existing == nil
                             ? .warn("Nothing is posted until another person approves it.")
                             : .warn("Saving makes you one of this expense's makers — another person must approve it."))
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Paid to", hint: "The person or business", error: tried ? payeeProblem : nil) {
                    TextField("e.g. Kenya Power", text: $payee).finbInput(invalid: tried && payeeProblem != nil)
                }
                FinanceMoneyField(label: "Amount", text: $amount, currency: $currency)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Out of fund", hint: "The fund the money leaves",
                          error: tried && fund.isEmpty ? "Choose a fund." : lookups.fundsError) {
                    FinBPickerField(placeholder: "Choose a fund", selection: $fund, options: fundOptions, invalid: tried && fund.isEmpty)
                }
                FinBField(label: "Category", error: tried && category.isEmpty ? "Choose a category." : lookups.categoriesError) {
                    FinBPickerField(placeholder: "Choose a category", selection: $category, options: categoryOptions, invalid: tried && category.isEmpty)
                }
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Spent on", hint: "Approval posts it on this day", error: tried ? dateProblem : nil) {
                    FinBDayPicker(label: "Spent on", ymd: $spentOn, earliest: earliest, latest: latest)
                }
                FinBField(label: "Paid via", hint: "Decides the cash account it leaves") {
                    FinBPickerField(placeholder: "Channel", selection: Binding(get: { channel.rawValue },
                                                                             set: { channel = FinOfficeChannel(rawValue: $0) ?? .other }),
                                    options: FinOfficeChannel.allCases.map { FinanceFilterOption($0.rawValue, $0.label) })
                }
            }
            FinBField(label: "Reference", hint: referenceHint, error: tried ? referenceProblem : nil) {
                TextField("Optional", text: $reference)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .finbInput(invalid: tried && referenceProblem != nil)
            }
            FinBField(label: "Description", hint: "Optional · at most 500 characters", error: tried ? detailsProblem : nil) {
                TextField("What it was for", text: $details, axis: .vertical)
                    .lineLimit(2...5).finbInput(invalid: tried && detailsProblem != nil)
            }
        }
        .task {
            async let a: Void = lookups.loadFunds()
            async let b: Void = lookups.loadCategories()
            _ = await (a, b)
        }
    }

    private var referenceHint: String {
        switch channel {
        case .mpesa: "The M-Pesa code — optional"
        case .cheque: "The cheque number — optional"
        case .bank: "The bank reference — optional"
        default: "A receipt or voucher number — optional"
        }
    }

    private func save() {
        tried = true
        guard valid, case .success(let minor) = amountMinor else {
            error = "Check the highlighted fields."
            return
        }
        let ref = trimmed(reference), desc = trimmed(details)
        var input: FinExpenseInput? = nil
        var patch: FinExpensePatch? = nil
        if let e = existing {
            var p = FinExpensePatch()
            if fund != e.fund.code { p.fund = fund }
            if category != e.category.code { p.category = category }
            if trimmed(payee) != e.payee { p.payee = trimmed(payee) }
            if desc != (e.description ?? "") { p.description = desc.isEmpty ? .clear : .set(desc) }
            if minor != e.amountMinor { p.amountMinor = minor }
            if currency != e.currency { p.currency = currency }
            if spentOn != e.spentOn { p.spentOn = spentOn }
            if channel.rawValue != e.channel { p.channel = channel }
            if ref != (e.reference ?? "") { p.reference = ref.isEmpty ? .clear : .set(ref) }
            guard !p.isEmpty else {
                error = "Nothing has changed."
                return
            }
            patch = p
        } else {
            input = FinExpenseInput(fund: fund, category: category, payee: trimmed(payee),
                                    description: desc.isEmpty ? nil : desc, amountMinor: minor, currency: currency,
                                    spentOn: spentOn, channel: channel, reference: ref.isEmpty ? nil : ref)
        }
        busy = true
        error = nil
        Task { @MainActor in
            do {
                try await onSubmit(input, patch)
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = FinBError.message(error, fallback: existing == nil ? "Could not record the expense." : "Could not save the expense.")
            }
        }
    }
}
