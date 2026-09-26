// Finance → Funds: the fund sheets — detail (balances, activity, recent
// postings on fund:<code>), New / Edit fund (finance:manage; the code is
// permanent; deactivating a fund money still routes to asks twice — 409
// FUND_IN_USE → force), Transfer between funds (finance:approve; 422
// NEGATIVE_BALANCE → "Post anyway" → allow_negative) and Opening balance
// (finance:approve; what was already in the bank / cash box).
import SwiftUI

// MARK: - Detail

struct FinAFundDetailSheet: View {
    let fund: FinFundRow
    let caps: FinanceCaps
    var fundNames: [String: String] = [:]
    var onEdit: () -> Void = {}
    var onTransfer: () -> Void = {}
    var onOpening: () -> Void = {}
    var onOpenLedger: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var postings: [FinLedgerRow] = []
    @State private var loading = true
    @State private var error: String?

    init(fund: FinFundRow, caps: FinanceCaps, fundNames: [String: String] = [:], onEdit: @escaping () -> Void = {},
         onTransfer: @escaping () -> Void = {}, onOpening: @escaping () -> Void = {}, onOpenLedger: @escaping () -> Void = {}) {
        self.fund = fund
        self.caps = caps
        self.fundNames = fundNames
        self.onEdit = onEdit
        self.onTransfer = onTransfer
        self.onOpening = onOpening
        self.onOpenLedger = onOpenLedger
    }

    private var cols: [FinanceColumn] { [
        FinanceColumn("Posted", width: 88),
        FinanceColumn("From / to", minWidth: 170),
        FinanceColumn("Out (debit)", width: 116, align: .trailing),
        FinanceColumn("In (credit)", width: 116, align: .trailing),
    ] }

    var body: some View {
        FinAFormSheet(title: fund.name) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(fund.name).font(.inter(20, .bold)).foregroundStyle(Nuru.navy)
                        FinanceStatusChip(status: fund.isActive ? "active" : "inactive", label: fund.isActive ? "Active" : "Inactive")
                    }
                    Text("fund:\(fund.code)").font(.nMono(13)).foregroundStyle(Nuru.ink600).textSelection(.enabled)
                    if let d = fund.description, !d.isEmpty { Text(d).font(.nBody).foregroundStyle(Nuru.ink600) }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 8) {
                    if caps.manage { FinanceButton(title: "Edit", icon: "pencil") { onEdit() } }
                    if caps.approve {
                        FinanceButton(title: "Transfer out", icon: "arrow.left.arrow.right") { onTransfer() }
                        FinanceButton(title: "Opening balance", icon: "tray.and.arrow.down") { onOpening() }
                    }
                }
            }
            FinACard(icon: "banknote", title: "Where it stands") {
                FinAFacts(facts: [
                    FinAFact("Balance (all time)", FinanceMoney.lines(fund.balances.map { ($0.currency, $0.balanceMinor) }).joined(separator: "\n")),
                    FinAFact("Income this period", FinanceMoney.lines(fund.income.map { ($0.currency, $0.periodMinor) }).joined(separator: "\n")),
                    FinAFact("Income year to date", FinanceMoney.lines(fund.income.map { ($0.currency, $0.ytdMinor) }).joined(separator: "\n")),
                    FinAFact("Expenses year to date", FinanceMoney.lines(fund.expensesYtd.map { ($0.currency, $0.amountMinor) }).joined(separator: "\n")),
                    FinAFact("Transfers in (YTD)", FinanceMoney.lines(fund.transfersInYtd.map { ($0.currency, $0.amountMinor) }).joined(separator: "\n")),
                    FinAFact("Transfers out (YTD)", FinanceMoney.lines(fund.transfersOutYtd.map { ($0.currency, $0.amountMinor) }).joined(separator: "\n")),
                    FinAFact("Last activity", fund.lastActivityAt.map { FinanceATime.dayTime($0) }),
                    FinAFact("Swahili name", fund.nameSw),
                ], minimum: 180)
                FinAExplain("Balance = credits − debits on fund:\(fund.code) over every posting: gifts in, approved expenses and transfers out. Income nets reversals on the gift's own date.")
            }
            VStack(alignment: .leading, spacing: 8) {
                FinASectionTitle(icon: "book.closed", title: "Recent postings", caption: "newest first") {
                    Button {
                        dismiss()
                        onOpenLedger()
                    } label: {
                        Text("Open in Ledger").font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
                    }
                    .buttonStyle(.plain)
                }
                if loading && postings.isEmpty {
                    SkeletonTable(rows: 4)
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    let cols = self.cols
                    FinanceTable(rows: postings, columns: cols, emptyIcon: "book.closed", emptyMessage: "Nothing has been posted to this fund yet.") { p in
                        Text(FinanceDates.display(p.postedOn)).font(.inter(12.5)).foregroundStyle(Nuru.ink600).financeCell(cols[0])
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.kind == "journal" ? FinWords.journalKind(p.journalKind) : (p.receiptCode ?? "Gift"))
                                .font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                            Text(p.kind == "journal" ? (p.memo ?? "") : (p.memberName ?? ""))
                                .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                        }
                        .financeCell(cols[1])
                        Text(p.side == "debit" ? FinanceMoney.format(p.amountMinor, p.currency) : "").font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                        Text(p.side == "credit" ? FinanceMoney.format(p.amountMinor, p.currency) : "").font(.nMono(12.5)).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                    }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            postings = try await FinanceERPAPI.ledger(FinLedgerFilter(period: nil, account: "fund:\(fund.code)"), limit: 25).data
            error = nil
        } catch {
            if !Task.isCancelled { self.error = FinanceARules.message(error) }
        }
    }
}

// MARK: - New / edit

struct FinAFundEditorSheet: View {
    /// nil = a new fund.
    let fund: FinFundRow?
    var onSaved: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var code = ""
    @State private var codeEdited = false
    @State private var nameSw = ""
    @State private var description = ""
    @State private var sortText = "0"
    @State private var active = true
    @State private var busy = false
    @State private var error: String?
    @State private var inUse: String?
    @State private var confirmForce = false
    @State private var showProblems = false

    init(fund: FinFundRow?, onSaved: @escaping () -> Void = {}) {
        self.fund = fund
        self.onSaved = onSaved
        _name = State(initialValue: fund?.name ?? "")
        _code = State(initialValue: fund?.code ?? "")
        _nameSw = State(initialValue: fund?.nameSw ?? "")
        _description = State(initialValue: fund?.description ?? "")
        _sortText = State(initialValue: String(fund?.sort ?? 0))
        _active = State(initialValue: fund?.isActive ?? true)
    }

    private var isNew: Bool { fund == nil }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedSw: String { nameSw.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedDescription: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var problems: [String: String] {
        var p: [String: String] = [:]
        if let e = FinanceARules.lengthProblem(name, min: 2, max: 150, what: "The name") { p["name"] = e }
        if isNew, let e = FinanceARules.slugProblem(code) { p["code"] = e }
        if !trimmedSw.isEmpty, let e = FinanceARules.lengthProblem(nameSw, min: 2, max: 150, what: "The Swahili name") { p["sw"] = e }
        if trimmedDescription.utf16.count > 500 { p["description"] = "Keep the description to 500 characters." }
        if Int(sortText.trimmingCharacters(in: .whitespaces)) == nil { p["sort"] = "The order is a whole number, e.g. 10." }
        return p
    }

    private var patch: FinFundPatch {
        var p = FinFundPatch()
        guard let f = fund else { return p }
        if trimmedName != f.name { p.name = trimmedName }
        if trimmedSw != (f.nameSw ?? "") { p.nameSw = trimmedSw.isEmpty ? .clear : .set(trimmedSw) }
        if trimmedDescription != (f.description ?? "") { p.description = trimmedDescription.isEmpty ? .clear : .set(trimmedDescription) }
        if let s = Int(sortText.trimmingCharacters(in: .whitespaces)), s != f.sort { p.sort = s }
        if active != f.isActive { p.isActive = active }
        return p
    }

    var body: some View {
        FinAFormSheet(title: isNew ? "New fund" : "Edit \(fund?.name ?? "fund")",
                      subtitle: isNew ? "A fund is where giving is booked and spending comes from — Tithe, Building, Missions. Funds are never deleted; deactivate one you no longer use." : nil,
                      confirmTitle: isNew ? "Create" : "Save",
                      confirmEnabled: isNew || !patch.isEmpty,
                      busy: busy,
                      onConfirm: { Task { await save(force: false) } }) {
            if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
            if let inUse {
                VStack(alignment: .leading, spacing: 10) {
                    FinanceNoticeBar(notice: .warn(inUse))
                    HStack(spacing: 10) {
                        FinanceButton(title: "Deactivate anyway", icon: "exclamationmark.triangle", style: .danger, busy: busy) { confirmForce = true }
                        FinanceButton(title: "Keep it active") { active = true; self.inUse = nil }
                    }
                }
            }
            FinAFieldRow {
                FinAFormField(label: "Name", error: showProblems ? problems["name"] : nil) {
                    TextField("e.g. Building fund", text: $name).finAInput(error: showProblems && problems["name"] != nil)
                        .onChange(of: name) { _, v in if isNew && !codeEdited { code = FinanceARules.suggestedSlug(from: v) } }
                }
                FinAFormField(label: "Code", hint: isNew ? "Permanent — it names the ledger account fund:\(code.isEmpty ? "<code>" : code) and every report. Lowercase letters, digits and hyphens; starts with a letter; 2–40 characters." : "The code never changes — it names the ledger account fund:\(code).",
                              error: showProblems ? problems["code"] : nil) {
                    if isNew {
                        TextField("building", text: Binding(get: { code }, set: { code = $0.lowercased(); codeEdited = true }))
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(.nMono(15)).finAInput(error: showProblems && problems["code"] != nil)
                    } else {
                        Text(code).font(.nMono(15)).foregroundStyle(Nuru.ink600)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 12)
                            .background(Nuru.inputBg)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                    }
                }
            }
            FinAFieldRow {
                FinAFormField(label: "Swahili name (optional)", error: showProblems ? problems["sw"] : nil) {
                    TextField("e.g. Mfuko wa Ujenzi", text: $nameSw).finAInput(error: showProblems && problems["sw"] != nil)
                }
                FinAFormField(label: "Order", hint: "Lower numbers list first.", error: showProblems ? problems["sort"] : nil) {
                    TextField("0", text: $sortText).keyboardType(.numberPad).finAInput(error: showProblems && problems["sort"] != nil)
                }
            }
            FinAFormField(label: "Description (optional)", hint: "\(trimmedDescription.utf16.count)/500 — what this fund is for.", error: showProblems ? problems["description"] : nil) {
                TextField("What money in this fund is for", text: $description, axis: .vertical)
                    .lineLimit(2...5).padding(.vertical, 10).finAInput(error: showProblems && problems["description"] != nil)
            }
            if !isNew {
                Toggle(isOn: $active) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Active").font(.inter(15, .semibold)).foregroundStyle(Nuru.ink)
                        Text(active ? "Gifts and pledges can be booked to it." : "No new gifts can be booked to it; its history and balance stay.")
                            .font(.nCaption).foregroundStyle(Nuru.ink600)
                    }
                }
                .tint(Nuru.gold)
                .padding(14)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            }
        }
        .alert("Deactivate \(fund?.name ?? "this fund") anyway?", isPresented: $confirmForce) {
            Button("Deactivate", role: .destructive) { Task { await save(force: true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Payments that still route to it will fail until it is active again. You can reactivate it any time.")
        }
    }

    private func save(force: Bool) async {
        showProblems = true
        guard problems.isEmpty else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            if let f = fund {
                let p = patch
                guard !p.isEmpty else { dismiss(); return }
                if force {
                    _ = try await FinanceERPAPI.updateFund(code: f.code, p, force: true)
                } else {
                    _ = try await FinanceERPAPI.updateFund(code: f.code, p)
                }
            } else {
                let sw = trimmedSw, d = trimmedDescription
                _ = try await FinanceERPAPI.createFund(FinFundInput(code: code, name: trimmedName,
                                                                    nameSw: sw.isEmpty ? nil : sw,
                                                                    description: d.isEmpty ? nil : d,
                                                                    sort: Int(sortText.trimmingCharacters(in: .whitespaces)) ?? 0,
                                                                    isActive: true))
            }
            inUse = nil
            onSaved()
            dismiss()
        } catch let e where e.apiCode == "FUND_IN_USE" {
            func n(_ key: String) -> Int { Int(e.apiDetail(key) ?? "") ?? 0 }
            inUse = FinanceARules.fundInUseSentence(fund: fund?.name ?? "this fund", pledges: n("active_pledges"),
                                                    schedules: n("active_schedules"), departments: n("departments"),
                                                    campaigns: n("live_campaigns"))
        } catch let e where e.apiCode == "CONFLICT" {
            error = "A fund with the code “\(code)” already exists — choose another code."
        } catch {
            self.error = FinanceARules.message(error)
        }
    }
}

// MARK: - Transfer between funds

struct FinATransferSheet: View {
    let funds: [FinFundRow]
    var onPosted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var from: String
    @State private var to = ""
    @State private var amountText = ""
    @State private var currency = FinanceMoney.homeCurrency
    @State private var occurredOn = FinanceDates.today()
    @State private var memo = ""
    @State private var key = UUID().uuidString
    @State private var busy = false
    @State private var error: String?
    @State private var negative: (balance: Int?, after: Int?)?
    @State private var confirmNegative = false
    @State private var result: FinTransfer?
    @State private var showProblems = false
    private let today = FinanceDates.today()

    init(funds: [FinFundRow], from: String? = nil, onPosted: @escaping () -> Void = {}) {
        self.funds = funds
        self.onPosted = onPosted
        _from = State(initialValue: from ?? "")
    }

    private var fromFund: FinFundRow? { funds.first { $0.code == from } }
    private var toFund: FinFundRow? { funds.first { $0.code == to } }
    private var amountMinor: Int? { if case .success(let m) = FinanceMoney.parseMajor(amountText) { return m }; return nil }
    private var balance: Int { fromFund?.balances.first { $0.currency == currency }?.balanceMinor ?? 0 }

    private var problems: [String: String] {
        var p: [String: String] = [:]
        if fromFund == nil { p["from"] = "Choose the fund the money leaves." }
        if toFund == nil { p["to"] = "Choose the fund the money goes to." }
        else if to == from { p["to"] = "Choose a different fund." }
        else if toFund?.isActive == false { p["to"] = "That fund is inactive — money can't be moved into it." }
        if case .failure(let e) = FinanceMoney.parseMajor(amountText) { p["amount"] = e.message }
        if let e = FinanceARules.lengthProblem(memo, min: 3, max: 300, what: "The reason") { p["memo"] = e }
        if let r = FinanceARules.allowedDays(today: today, daysBack: 366), !r.contains(occurredOn) {
            p["date"] = FinanceARules.dateRangeSentence("The date", today: today, daysBack: 366)
        }
        return p
    }

    var body: some View {
        FinAFormSheet(title: "Transfer between funds",
                      subtitle: result == nil ? "Moves money from one fund to another — a journal that debits the fund it leaves and credits the fund it joins. Cash does not move." : nil,
                      confirmTitle: result == nil ? "Post transfer" : nil,
                      busy: busy,
                      onConfirm: { Task { await post(allowNegative: false) } }) {
            if let r = result {
                done(r)
            } else {
                form
            }
        }
        .alert("Take \(fromFund?.name ?? "the fund") below zero?", isPresented: $confirmNegative) {
            Button("Post anyway", role: .destructive) { Task { await post(allowNegative: true) } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The transfer will be posted and \(fromFund?.name ?? "the fund") will show a negative \(currency) balance until money comes in.")
        }
    }

    @ViewBuilder private var form: some View {
        if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
        if let n = negative {
            VStack(alignment: .leading, spacing: 10) {
                FinanceNoticeBar(notice: .warn(negativeText(n)))
                FinanceButton(title: "Post anyway…", icon: "exclamationmark.triangle", style: .danger, busy: busy) { confirmNegative = true }
            }
        }
        FinAFieldRow {
            FinAFormField(label: "From fund", error: showProblems ? problems["from"] : nil) {
                FinAMenuField(placeholder: "Choose a fund", selection: $from,
                              options: funds.map { FinanceFilterOption($0.code, $0.isActive ? $0.name : "\($0.name) (inactive)") },
                              error: showProblems && problems["from"] != nil)
            }
            FinAFormField(label: "To fund", error: showProblems ? problems["to"] : nil) {
                FinAMenuField(placeholder: "Choose a fund", selection: $to,
                              options: funds.filter { $0.isActive && $0.code != from }.map { FinanceFilterOption($0.code, $0.name) },
                              error: showProblems && problems["to"] != nil)
            }
        }
        FinAFieldRow {
            FinanceMoneyField(label: "Amount", text: $amountText, currency: $currency)
            FinAFormField(label: "Date", hint: "The day the transfer takes effect (EAT) — up to 366 days back.", error: showProblems ? problems["date"] : nil) {
                FinADayField(ymd: $occurredOn, range: FinanceARules.allowedDays(today: today, daysBack: 366) ?? today...today).finAInput()
            }
        }
        if let f = fromFund {
            let after = balance - (amountMinor ?? 0)
            HStack(spacing: 8) {
                Image(systemName: after < 0 ? "exclamationmark.triangle.fill" : "info.circle")
                    .foregroundStyle(after < 0 ? FinanceStatus.amber.fg : Nuru.ink400)
                Text("\(f.name) holds \(FinanceMoney.format(balance, currency))." + (amountMinor != nil ? " After this transfer: \(FinanceMoney.format(after, currency))." : ""))
                    .font(.nCaption).foregroundStyle(after < 0 ? FinanceStatus.amber.fg : Nuru.ink600)
            }
        }
        FinAFormField(label: "Reason", hint: "3–300 characters — kept on the journal and in the audit trail.", error: showProblems ? problems["memo"] : nil) {
            TextField("e.g. Board decision 14 Sep: seed the building fund", text: $memo, axis: .vertical)
                .lineLimit(2...4).padding(.vertical, 10).finAInput(error: showProblems && problems["memo"] != nil)
        }
        if let f = fromFund, let t = toFund, let a = amountMinor {
            FinAExplain("Posts a journal on \(FinanceDates.display(occurredOn)): debit fund:\(f.code) and credit fund:\(t.code), \(FinanceMoney.format(a, currency)) each. It can be reversed once from Ledger → Journals.")
        }
    }

    private func negativeText(_ n: (balance: Int?, after: Int?)) -> String {
        let name = fromFund?.name ?? "The fund"
        let bal = n.balance.map { FinanceMoney.format($0, currency) } ?? "less than this"
        let after = n.after.map { " — this transfer would leave it at \(FinanceMoney.format($0, currency))" } ?? ""
        return "\(name) has \(bal) in \(currency)\(after). Nothing was posted."
    }

    private func done(_ r: FinTransfer) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 30)).foregroundStyle(Nuru.lumGreen)
                Text(r.reused ? "Already posted" : "Transfer posted").font(.inter(20, .bold)).foregroundStyle(Nuru.navy)
            }
            if r.reused { FinanceNoticeBar(notice: .warn("This form had already posted the transfer — nothing new was posted.")) }
            Text("\(FinanceMoney.format(r.amountMinor, r.currency)) moved from \(r.fromFund.name) to \(r.toFund.name) on \(FinanceDates.display(r.occurredOn)). \(r.fromFund.name) now holds \(FinanceMoney.format(r.fromBalanceAfterMinor, r.currency)).")
                .font(.nBody).foregroundStyle(Nuru.ink)
            FinALegsTable(legs: r.ledger)
            HStack {
                FinanceButton(title: "Another transfer", icon: "plus") {
                    key = UUID().uuidString
                    result = nil; amountText = ""; memo = ""; negative = nil; showProblems = false
                }
                Spacer()
                FinanceButton(title: "Done", style: .primary) { dismiss() }
            }
        }
    }

    private func post(allowNegative: Bool) async {
        showProblems = true
        guard problems.isEmpty, let minor = amountMinor else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let r = try await FinanceERPAPI.transfer(FinTransferInput(
                fromFund: from, toFund: to, amountMinor: minor, currency: currency, occurredOn: occurredOn,
                memo: memo.trimmingCharacters(in: .whitespacesAndNewlines), allowNegative: allowNegative, idempotencyKey: key))
            negative = nil
            result = r
            onPosted()
        } catch let e where e.apiDetail("reason") == "NEGATIVE_BALANCE" {
            negative = (Int(e.apiDetail("balance_minor") ?? ""), Int(e.apiDetail("balance_after_minor") ?? ""))
        } catch let e where e.apiCode == "INVALID_DATE" {
            error = FinanceARules.dateRangeSentence("The date", today: today, daysBack: 366) + " Nothing was posted."
        } catch let e where e.apiStatus == 403 {
            error = "Transfers need the finance:approve permission. Nothing was posted."
        } catch {
            self.error = FinanceARules.message(error)
        }
    }
}

// MARK: - Opening balance

struct FinAOpeningBalanceSheet: View {
    let funds: [FinFundRow]
    var onPosted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @State private var fund: String
    @State private var channel: FinOfficeChannel = .bank
    @State private var amountText = ""
    @State private var currency = FinanceMoney.homeCurrency
    @State private var asOf = FinanceDates.today()
    @State private var memo = "Opening balance"
    @State private var key = UUID().uuidString
    @State private var busy = false
    @State private var error: String?
    @State private var result: FinJournalResult?
    @State private var showProblems = false
    private let today = FinanceDates.today()
    private static let maxMinor = 1_000_000_000_000

    init(funds: [FinFundRow], fund: String? = nil, onPosted: @escaping () -> Void = {}) {
        self.funds = funds
        self.onPosted = onPosted
        _fund = State(initialValue: fund ?? "")
    }

    private var amountMinor: Int? {
        if case .success(let m) = FinanceARules.parseMajor(amountText, maxMinor: Self.maxMinor) { return m }
        return nil
    }
    private var chosen: FinFundRow? { funds.first { $0.code == fund && $0.isActive } }

    private var problems: [String: String] {
        var p: [String: String] = [:]
        if chosen == nil { p["fund"] = "Choose an active fund." }
        if case .failure(let e) = FinanceARules.parseMajor(amountText, maxMinor: Self.maxMinor) { p["amount"] = e.message }
        if let e = FinanceARules.lengthProblem(memo, min: 3, max: 300, what: "The memo") { p["memo"] = e }
        if let r = FinanceARules.allowedDays(today: today, daysBack: 3660), !r.contains(asOf) {
            p["date"] = FinanceARules.dateRangeSentence("The balance date", today: today, daysBack: 3660)
        }
        return p
    }

    var body: some View {
        FinAFormSheet(title: "Opening balance",
                      subtitle: result == nil ? "What was already in the bank or the cash box when you started using Pathway. Without it every fund starts at zero and the first expenses drive it negative." : nil,
                      confirmTitle: result == nil ? "Post" : nil,
                      busy: busy,
                      onConfirm: { Task { await post() } }) {
            if let r = result {
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 12) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 30)).foregroundStyle(Nuru.lumGreen)
                        Text(r.reused ? "Already posted" : "Opening balance posted").font(.inter(20, .bold)).foregroundStyle(Nuru.navy)
                    }
                    if r.reused { FinanceNoticeBar(notice: .warn("This form had already posted it — nothing new was posted.")) }
                    FinALegsTable(legs: r.legs)
                    HStack {
                        FinanceButton(title: "Post another", icon: "plus") {
                            key = UUID().uuidString
                            result = nil; amountText = ""; showProblems = false
                        }
                        Spacer()
                        FinanceButton(title: "Done", style: .primary) { dismiss() }
                    }
                }
            } else {
                if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
                FinAFieldRow {
                    FinAFormField(label: "Fund", error: showProblems ? problems["fund"] : nil) {
                        FinAMenuField(placeholder: "Choose a fund", selection: $fund,
                                      options: funds.filter(\.isActive).map { FinanceFilterOption($0.code, $0.name) },
                                      error: showProblems && problems["fund"] != nil)
                    }
                    FinAFormField(label: "As of", hint: "The day the balance was counted (EAT) — up to ten years back.", error: showProblems ? problems["date"] : nil) {
                        FinADayField(ymd: $asOf, range: FinanceARules.allowedDays(today: today, daysBack: 3660) ?? today...today).finAInput()
                    }
                }
                FinAFormField(label: "Where the money sits") {
                    FinAChoiceChips(options: FinOfficeChannel.allCases, selection: $channel, label: { c in
                        c == .mpesa ? "M-Pesa" : FinanceARules.giftChannelLabel(c)
                    })
                }
                FinAMoneyInput(label: "Amount", text: $amountText, currency: $currency, maxMinor: Self.maxMinor)
                FinAFormField(label: "Memo", hint: "3–300 characters.", error: showProblems ? problems["memo"] : nil) {
                    TextField("Opening balance", text: $memo).finAInput(error: showProblems && problems["memo"] != nil)
                }
                if let f = chosen, let a = amountMinor {
                    FinAExplain("Posts a journal on \(FinanceDates.display(asOf)): debit cash:\(channel == .other ? "manual" : channel.rawValue) and credit fund:\(f.code), \(FinanceMoney.format(a, currency)) each. Post one per fund, place and currency. A wrong one is corrected by reversing it in Ledger → Journals and posting the right one.")
                }
            }
        }
    }

    private func post() async {
        showProblems = true
        guard problems.isEmpty, let minor = amountMinor else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            result = try await FinanceERPAPI.postOpeningBalance(FinOpeningBalanceInput(
                idempotencyKey: key, channel: channel, fund: fund, amountMinor: minor, currency: currency,
                asOf: asOf, memo: memo.trimmingCharacters(in: .whitespacesAndNewlines)))
            onPosted()
        } catch let e where e.apiCode == "INVALID_DATE" {
            error = FinanceARules.dateRangeSentence("The balance date", today: today, daysBack: 3660) + " Nothing was posted."
        } catch let e where e.apiCode == "CONFLICT" {
            key = UUID().uuidString
            error = "This form's key belongs to another journal, so it was given a fresh one. Press Post again."
        } catch let e where e.apiStatus == 403 {
            error = "Opening balances need the finance:approve permission. Nothing was posted."
        } catch {
            self.error = FinanceARules.message(error)
        }
    }
}
