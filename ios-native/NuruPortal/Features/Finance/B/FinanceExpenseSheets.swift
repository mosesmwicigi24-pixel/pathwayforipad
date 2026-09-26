// Finance → Expenses — the sheets: one expense with its whole trail (recorded
// → edited → approved → voided, who and when) and the actions this person may
// take — Edit (recorded only, finance:manage), Approve (finance:approve; never
// by a maker unless SuperAdmin — maker-checker, spec §2) and Void
// (finance:manage, with a reason) — plus the record / edit form. Approving and
// voiding state their consequence first, including what it does to the fund:
// "<Fund> balance: A → B after this" in the expense's currency, from GET
// /admin/finance/funds; an approval may overdraw a fund (the money already
// left), so that is a warning, never a block. Wording mirrors the web portal
// (admin-web finance/b/logic.ts + ExpenseDrawer.tsx). See FinanceExpensesView.swift.
import SwiftUI

// MARK: - The fund's balance for a posting

enum FinBFundBalance: Equatable {
    case loading
    case loaded(FinBMath.FundImpact)
    /// The balance could not be read — the action still goes through.
    case unavailable

    /// GET /admin/finance/funds → the fund's balance in the expense's currency,
    /// then what approving (−) or voiding an approved expense (+) makes it.
    static func load(for e: FinExpense, approving: Bool) async -> FinBFundBalance {
        do {
            let page = try await FinanceERPAPI.funds(period: nil)
            guard let row = page.data.first(where: { $0.code == e.fund.code }) else { return .unavailable }
            let balance = row.balances.first { $0.currency.uppercased() == e.currency.uppercased() }?.balanceMinor ?? 0
            return .loaded(FinBMath.fundImpact(fundName: e.fund.name, currency: e.currency, balanceMinor: balance,
                                               amountMinor: e.amountMinor, approving: approving))
        } catch {
            return .unavailable
        }
    }

    /// The sentence(s) the confirmation shows.
    func lines(fundName: String) -> (sentence: String, warning: String?) {
        switch self {
        case .loading: ("Reading \(fundName)'s balance…", nil)
        case .unavailable: ("Could not read \(fundName)'s balance just now — this still goes through.", nil)
        case .loaded(let i): (i.sentence, i.warning)
        }
    }
}

/// The balance line of a confirmation, with the overdrawn warning under it.
struct FinBFundImpactView: View {
    let state: FinBFundBalance
    let fundName: String
    var body: some View {
        let l = state.lines(fundName: fundName)
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                if state == .loading { ProgressView().controlSize(.small) }
                Text(l.sentence).font(.nMono(12.5)).foregroundStyle(state == .unavailable ? Nuru.ink600 : Nuru.navy)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let w = l.warning { FinanceNoticeBar(notice: .warn(w)) }
        }
    }
}

/// What approving / voiding does — the web's sentences (logic.ts).
enum FinBExpenseWords {
    /// "Posts KES 1,500.00 out of General Fund via Cash on 26 Sep 2026. The fund's balance drops by that amount."
    static func approve(_ e: FinExpense) -> String {
        "Posts \(FinanceMoney.format(e.amountMinor, e.currency)) out of \(e.fund.name) via \(FinWords.channel(e.channel)) on \(FinanceDates.display(e.spentOn)). The fund's balance drops by that amount."
    }
    static func void(_ e: FinExpense) -> String {
        e.status == "approved"
            ? "Posts the reversing entry — \(e.fund.name) gets \(FinanceMoney.format(e.amountMinor, e.currency)) back. The expense stays on the register as void, with your reason."
            : "Nothing was posted yet, so nothing is reversed. The expense stays on the register as void, with your reason."
    }
}

// MARK: - Detail

struct FinanceExpenseDetailSheet: View {
    @ObservedObject var model: FinanceExpensesModel
    @EnvironmentObject private var auth: AuthStore
    @Environment(\.dismiss) private var dismiss
    @State private var expense: FinExpense
    @State private var loadError: String?
    /// The audit's "expense.updated" rows for this expense — each editor is one of its makers.
    @State private var edits: [FinAuditRow] = []
    @State private var editsMore = false
    @State private var editsError = false
    /// The server said SAME_PERSON — a maker the page could not see.
    @State private var samePerson = false
    @State private var sub: Sub?

    enum Sub: String, Identifiable { case edit, approve, void; var id: String { rawValue } }

    init(expense: FinExpense, model: FinanceExpensesModel) {
        _expense = State(initialValue: expense)
        self.model = model
    }

    private var editors: Set<String> {
        var s = Set(edits.compactMap(\.actorId))
        if model.editedByMe(expense.id), let me = auth.financeCaps.userId { s.insert(me) }
        return s
    }

    var body: some View {
        let caps = auth.financeCaps
        let e = expense
        let state = FinBMakerChecker.state(caps: caps, status: e.status, recordedBy: e.recordedBy, editors: editors)
        let blocked: String? = samePerson && caps.approve && e.status == "recorded" ? FinBMakerChecker.sentence : state.sentence
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(e.payee).font(.inter(18, .bold)).foregroundStyle(Nuru.navy)
                            Text("\(FinanceMoney.format(e.amountMinor, e.currency)) · \(e.category.name) · spent \(FinanceDates.display(e.spentOn))")
                                .font(.nCaption).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                        FinanceStatusChip(status: e.status, label: e.status == "recorded" ? "Awaiting approval" : nil)
                    }
                    FinBAmount(minor: e.amountMinor, currency: e.currency, size: 22, color: e.status == "void" ? Nuru.ink400 : Nuru.navy)
                        .strikethrough(e.status == "void", color: Nuru.ink400)
                    if let blocked { FinanceNoticeBar(notice: .warn(blocked)) }
                    if let loadError { FinanceNoticeBar(notice: .error(loadError)) }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
                        FinBKeyValue("Paid from", e.fund.name)
                        FinBKeyValue("Category", e.category.name)
                        FinBKeyValue("Paid by", FinWords.channel(e.channel))
                        FinBKeyValue("Reference", e.reference ?? "—", mono: true)
                        FinBKeyValue("Spent on", FinanceDates.display(e.spentOn))
                        FinBKeyValue("Amount", FinanceMoney.format(e.amountMinor, e.currency))
                    }
                    if let d = e.description, !d.isEmpty {
                        Text(d).font(.nBody).foregroundStyle(Nuru.navy).fixedSize(horizontal: false, vertical: true)
                    }
                    trail(e)
                    actions(e, caps: caps, state: state)
                    if e.journalId != nil || e.voidJournalId != nil {
                        Text([e.journalId.map { "Journal \($0.prefix(8))" }, e.voidJournalId.map { "reversal \($0.prefix(8))" }]
                                .compactMap { $0 }.joined(separator: " · "))
                            .font(.nMono(11.5)).foregroundStyle(Nuru.ink400).textSelection(.enabled)
                    }
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
        .task(id: model.version) { await refresh() }
        .sheet(item: $sub) { s in
            switch s {
            case .edit:
                FinanceExpenseFormSheet(existing: expense, lookups: model.lookups) { _, patch in
                    if let patch { expense = try await model.update(expense.expenseId, patch) }
                }
            case .approve:
                FinanceExpenseApproveSheet(expense: expense) {
                    do {
                        expense = try await model.approve(expense)
                    } catch let error where error.apiCode == "SAME_PERSON" {
                        // The server knows a maker the page did not (an edit it could not see).
                        samePerson = true
                        throw error
                    }
                }
            case .void:
                FinanceExpenseVoidSheet(expense: expense) { reason in expense = try await model.void(expense, reason: reason) }
            }
        }
    }

    /// The fresh expense and its edits (the register row shows at once).
    private func refresh() async {
        do {
            expense = try await FinanceERPAPI.expense(expense.expenseId)
            loadError = nil
        } catch {
            loadError = FinBError.message(error, fallback: "Could not load this expense.")
        }
        do {
            let from = FinBTime.ymd(expense.recordedAt) ?? FinanceDates.todayOffset(-366)
            let page = try await FinanceERPAPI.audit(FinAuditFilter(period: .custom(from: from, to: FinanceDates.today()),
                                                                     actionPrefix: "expense.updated"), limit: 200)
            edits = page.data.filter { $0.entityId == expense.expenseId }.sorted { $0.occurredAt < $1.occurredAt }
            editsMore = page.nextCursor != nil
            editsError = false
        } catch {
            editsError = true
        }
    }

    private func trail(_ e: FinExpense) -> some View {
        let amount = FinanceMoney.format(e.amountMinor, e.currency)
        return FinBCard(title: "Trail",
                        caption: editsMore ? "Older edits may not be listed — see Audit" : editsError ? "Edits could not be read" : nil,
                        icon: "clock.arrow.circlepath") {
            VStack(alignment: .leading, spacing: 12) {
                step(icon: "square.and.pencil", tint: FinanceStatus.navy.fg, title: "Recorded", who: e.recordedByName ?? "someone",
                     when: FinBTime.stamp(e.recordedAt), note: "Spent \(FinanceDates.display(e.spentOn)) — recording posts nothing.")
                ForEach(edits) { r in
                    step(icon: "pencil", tint: FinanceStatus.navy.fg, title: "Edited", who: r.actorName ?? "someone",
                         when: FinBTime.stamp(r.occurredAt), note: "An editor is one of its makers — they cannot approve it.")
                }
                if e.approvedAt != nil {
                    step(icon: "checkmark.seal", tint: Nuru.success, title: "Approved", who: e.approvedByName ?? "someone",
                         when: FinBTime.stamp(e.approvedAt),
                         note: "Posted \(amount) out of \(e.fund.name) via \(FinWords.channel(e.channel)), dated \(FinanceDates.display(e.spentOn)).")
                }
                if e.voidedAt != nil {
                    step(icon: "xmark.octagon", tint: FinanceStatus.grey.fg, title: "Voided", who: e.voidedByName ?? "someone",
                         when: FinBTime.stamp(e.voidedAt),
                         note: "“\(e.voidReason ?? "")”" + (e.voidJournalId != nil ? " — reversing entry posted: \(e.fund.name) got \(amount) back." : " — nothing had been posted."))
                }
                if e.status == "recorded" {
                    step(icon: "hourglass", tint: FinanceStatus.amber.fg, title: "Waiting for approval", who: nil, when: nil,
                         note: "Another person with finance:approve approves it; that posts it.")
                }
            }
        }
    }

    private func step(icon: String, tint: Color, title: String, who: String?, when: String?, note: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 26, height: 26).background(tint.opacity(0.12)).clipShape(Circle())
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
                    if let who { Text("· \(who)").font(.inter(13, .medium)).foregroundStyle(Nuru.ink) }
                    if let when { Text(when).font(.nMicro).foregroundStyle(Nuru.ink400) }
                }
                Text(note).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private func actions(_ e: FinExpense, caps: FinanceCaps, state: FinBMakerChecker.State) -> some View {
        let canEdit = caps.manage && e.status == "recorded"
        let canVoid = caps.manage && e.status != "void"
        let showApprove = state == .approve && !samePerson
        if canEdit || canVoid || showApprove {
            HStack(spacing: 10) {
                if canEdit { FinanceButton(title: "Edit", icon: "pencil") { sub = .edit } }
                if canVoid { FinanceButton(title: "Void", icon: "nosign", style: .danger) { sub = .void } }
                Spacer(minLength: 0)
                if showApprove { FinanceButton(title: "Approve", icon: "checkmark.circle", style: .primary) { sub = .approve } }
            }
        }
    }
}

// MARK: - Approve

struct FinanceExpenseApproveSheet: View {
    let expense: FinExpense
    let onApprove: () async throws -> Void
    @State private var balance: FinBFundBalance = .loading

    var body: some View {
        let e = expense
        FinBConfirmSheet(
            title: "Approve \(FinanceMoney.format(e.amountMinor, e.currency)) to \(e.payee)?",
            consequence: [FinBExpenseWords.approve(e)],
            confirmLabel: "Approve and post",
            onConfirm: onApprove,
            errorText: { FinBError.message($0, fallback: "Could not approve the expense.") }
        ) {
            FinBFundImpactView(state: balance, fundName: e.fund.name)
        }
        .task { balance = await FinBFundBalance.load(for: e, approving: true) }
    }
}

// MARK: - Void

struct FinanceExpenseVoidSheet: View {
    let expense: FinExpense
    let onVoid: (String) async throws -> Void
    @State private var balance: FinBFundBalance = .loading

    var body: some View {
        let e = expense
        let impact = e.status == "approved" ? balance.lines(fundName: e.fund.name) : nil
        let message = [FinBExpenseWords.void(e), impact?.sentence, impact?.warning].compactMap { $0 }.joined(separator: "\n\n")
        FinanceReasonSheet(title: e.status == "approved" ? "Void this approved expense?" : "Void this expense?",
                           message: message,
                           confirmLabel: "Void expense",
                           placeholder: "Why is it being voided? e.g. Recorded twice — the same receipt is on 12 Sep") { reason in
            try await onVoid(reason)
        }
        .task { if e.status == "approved" { balance = await FinBFundBalance.load(for: e, approving: false) } }
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
    @State private var channel = ""
    @State private var reference = ""
    @State private var details = ""
    @State private var busy = false
    @State private var error: String?
    @State private var tried = false

    /// The books' window for an office date: [today − 366 days, today] (EAT).
    private let earliest = FinanceDates.todayOffset(-366)
    private let latest = FinanceDates.today()

    /// How an expense was paid — the office channels in the office's words (web EXPENSE_CHANNELS).
    static let channels: [FinanceFilterOption] = [
        .init("onhand", "Cash"), .init("bank", "Bank"), .init("cheque", "Cheque"), .init("mpesa", "M-Pesa"), .init("other", "Other"),
    ]

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
            _channel = State(initialValue: e.channel)
            _reference = State(initialValue: e.reference ?? "")
            _details = State(initialValue: e.description ?? "")
        }
    }

    private func trimmed(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var payeeProblem: String? {
        (2...120).contains(trimmed(payee).count) ? nil : "Who was paid — 2–120 characters."
    }
    private var amountMinor: Result<Int, FinanceMoneyError> { FinanceMoney.parseMajor(amount) }
    private var amountProblem: String? { if case .failure(let e) = amountMinor { e.message } else { nil } }
    private var dateProblem: String? {
        guard FinanceDates.date(fromYMD: spentOn) != nil else { return "Pick a date." }
        if spentOn > latest { return "That date is in the future." }
        if spentOn < earliest { return "That is more than 366 days ago — the books only accept the last 366 days." }
        return nil
    }
    private var referenceProblem: String? { trimmed(reference).count > 80 ? "At most 80 characters." : nil }
    private var detailsProblem: String? { trimmed(details).count > 500 ? "At most 500 characters." : nil }
    private var fundProblem: String? { fund.isEmpty ? "Choose the fund it is paid from." : nil }
    private var categoryProblem: String? { category.isEmpty ? "Choose a category." : nil }
    private var channelProblem: String? { channel.isEmpty ? "How was it paid?" : nil }

    private var valid: Bool {
        [payeeProblem, amountProblem, dateProblem, referenceProblem, detailsProblem, fundProblem, categoryProblem, channelProblem]
            .allSatisfy { $0 == nil }
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
            FinanceNoticeBar(notice: .warn(existing == nil
                ? "Nothing is posted until another person approves it. Recording puts it in the approval queue; approving takes it out of the fund."
                : "Only a recorded expense can be corrected. Editing makes you one of its makers — another person must approve it. Nothing is posted until then."))
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Paid to", hint: "Money that has already been paid out.", error: tried ? payeeProblem : nil) {
                    TextField("e.g. Kenya Power", text: $payee).finbInput(invalid: tried && payeeProblem != nil)
                }
                FinanceMoneyField(label: "Amount", text: $amount, currency: $currency)
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Paid from fund", error: tried ? fundProblem : lookups.fundsError) {
                    FinBPickerField(placeholder: "Choose a fund", selection: $fund, options: fundOptions, invalid: tried && fundProblem != nil)
                }
                FinBField(label: "Category", error: tried ? categoryProblem : lookups.categoriesError) {
                    FinBPickerField(placeholder: "Choose a category", selection: $category, options: categoryOptions, invalid: tried && categoryProblem != nil)
                }
            }
            HStack(alignment: .top, spacing: 14) {
                FinBField(label: "Spent on",
                          hint: "The day the money left — \(FinanceDates.display(earliest)) to today. Approval posts it on this date.",
                          error: tried ? dateProblem : nil) {
                    FinBDayPicker(label: "Spent on", ymd: $spentOn, earliest: earliest, latest: latest)
                }
                FinBField(label: "Paid by", hint: "Decides the cash account the approval takes it from.", error: tried ? channelProblem : nil) {
                    FinBPickerField(placeholder: "How was it paid?", selection: $channel, options: Self.channels, invalid: tried && channelProblem != nil)
                }
            }
            FinBField(label: "Reference", hint: "Cheque number, bank reference, M-Pesa code or receipt number.", error: tried ? referenceProblem : nil) {
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

    private func save() {
        tried = true
        guard valid, case .success(let minor) = amountMinor, let office = FinOfficeChannel(rawValue: channel) else {
            error = "Check the highlighted fields."
            return
        }
        let ref = trimmed(reference), desc = trimmed(details)
        var input: FinExpenseInput? = nil
        var patch: FinExpensePatch? = nil
        if let e = existing {
            // Only what changed — PATCH sends at least one field.
            var p = FinExpensePatch()
            if fund != e.fund.code { p.fund = fund }
            if category != e.category.code { p.category = category }
            if trimmed(payee) != e.payee { p.payee = trimmed(payee) }
            if desc != (e.description ?? "") { p.description = desc.isEmpty ? .clear : .set(desc) }
            if minor != e.amountMinor { p.amountMinor = minor }
            if currency != e.currency { p.currency = currency }
            if spentOn != e.spentOn { p.spentOn = spentOn }
            if channel != e.channel { p.channel = office }
            if ref != (e.reference ?? "") { p.reference = ref.isEmpty ? .clear : .set(ref) }
            guard !p.isEmpty else {
                error = "Nothing has changed."
                return
            }
            patch = p
        } else {
            input = FinExpenseInput(fund: fund, category: category, payee: trimmed(payee),
                                    description: desc.isEmpty ? nil : desc, amountMinor: minor, currency: currency,
                                    spentOn: spentOn, channel: office, reference: ref.isEmpty ? nil : ref)
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
