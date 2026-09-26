// Finance → Funds: the fund sheets, as the web's drawers (admin-web
// components/finance/a/FundDetailDrawer, FundFormDrawer, TransferDrawer,
// OpeningBalanceDrawer) — the same fields, rules and words:
//  • detail — what the fund holds per currency, what moved through it, its
//    latest postings (ledger account=fund:<code>); Edit / Transfer / Opening
//    balance only with the capability;
//  • New / Edit fund (finance:manage) — the code is permanent; deactivating a
//    fund money still routes to answers 409 FUND_IN_USE with the counts, and
//    "Deactivate anyway" asks once more and resends with force: true;
//  • Transfer between funds (finance:approve) — 422 NEGATIVE_BALANCE shows the
//    balance and offers "Post anyway", which asks once more and resends with
//    allow_negative: true under the SAME idempotency key;
//  • Opening balance (finance:approve) — what was already in the bank / cash box.
// A successful write closes the sheet; the page reloads and says what happened.
import SwiftUI

extension FinanceARules {
    /// A posting's owner in words: "Transfer — Board seed", "OR-2026-00012 · Grace Wanjiru", "Gift".
    static func postingSource(kind: String, receiptCode: String?, memberName: String?, journalKind: String?, memo: String?) -> String {
        if kind == "journal" {
            let jk = journalKind ?? ""
            let label = jk.isEmpty ? "Journal" : FinWords.journalKind(jk)
            if let m = memo, !m.isEmpty { return "\(label) — \(m)" }
            return label
        }
        let parts = [receiptCode, memberName].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? "Gift" : parts.joined(separator: " · ")
    }

    /// "1 Sep – 26 Sep 2026" / "26 Sep 2026" / "15 Dec 2025 – 3 Jan 2026" — the web's fmtRange.
    static func fmtRange(from: String, to: String) -> String {
        guard FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil else { return "—" }
        if from == to { return FinanceDates.display(from) }
        let full = FinanceDates.display(from)
        let start = from.prefix(4) == to.prefix(4) ? full.split(separator: " ").prefix(2).joined(separator: " ") : full
        return "\(start) – \(FinanceDates.display(to))"
    }

    /// Money per currency on one line each ("—" when none).
    static func moneyText(_ amounts: [(currency: String, minor: Int)], separator: String = "\n") -> String {
        let l = FinanceMoney.lines(amounts)
        return l.isEmpty ? "—" : l.joined(separator: separator)
    }
}

// MARK: - Detail

struct FinAFundDetailSheet: View {
    let fund: FinFundRow
    let period: FinancePeriod
    let caps: FinanceCaps
    var onEdit: () -> Void
    var onTransfer: () -> Void
    var onOpening: () -> Void
    var onOpenLedger: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var postings: [FinLedgerRow] = []
    @State private var loading = true
    @State private var error: String?
    static let recent = 15

    init(fund: FinFundRow, period: FinancePeriod, caps: FinanceCaps, onEdit: @escaping () -> Void = {},
         onTransfer: @escaping () -> Void = {}, onOpening: @escaping () -> Void = {}, onOpenLedger: @escaping () -> Void = {}) {
        self.fund = fund
        self.period = period
        self.caps = caps
        self.onEdit = onEdit
        self.onTransfer = onTransfer
        self.onOpening = onOpening
        self.onOpenLedger = onOpenLedger
    }

    private var account: String { "fund:\(fund.code)" }

    private var cols: [FinanceColumn] { [
        FinanceColumn("Posted on", width: 96),
        FinanceColumn("Source", minWidth: 150),
        FinanceColumn("Debit", width: 112, align: .trailing),
        FinanceColumn("Credit", width: 112, align: .trailing),
    ] }

    var body: some View {
        FinAFormSheet(title: fund.name) {
            HStack(spacing: 8) {
                Text(account).font(.nMono(13)).foregroundStyle(Nuru.ink600).textSelection(.enabled)
                FinanceStatusChip(status: fund.isActive ? "active" : "inactive", label: fund.isActive ? "Active" : "Inactive")
            }
            FinanceFlowLayout(spacing: 8, rowSpacing: 8) {
                if caps.manage { FinanceButton(title: "Edit", icon: "pencil") { onEdit() } }
                if caps.approve { FinanceButton(title: "Transfer from this fund", icon: "arrow.left.arrow.right") { onTransfer() } }
                if caps.approve && fund.isActive { FinanceButton(title: "Opening balance", icon: "tray.and.arrow.down") { onOpening() } }
                FinanceButton(title: "Open in Ledger", icon: "book", style: .primary) {
                    dismiss()
                    onOpenLedger()
                }
            }
            balanceBox
            FinAFacts(facts: facts, minimum: 200)
            postingsSection
        }
        .task { await load() }
    }

    private var balanceBox: some View {
        let balances = fund.balances.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
        return VStack(alignment: .leading, spacing: 6) {
            Text("BALANCE").font(.inter(10.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
            if balances.isEmpty {
                Text("Nothing yet").font(.inter(20, .semibold)).foregroundStyle(Nuru.ink400)
            } else {
                ForEach(balances, id: \.currency) { b in
                    Text(FinanceMoney.format(b.balanceMinor, b.currency)).font(.inter(22, .semibold)).monospacedDigit()
                        .foregroundStyle(b.balanceMinor < 0 ? FinanceStatus.red.fg : Nuru.navy)
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
            }
            FinAExplain("Everything credited to the fund (gifts, transfers in, opening balances) less everything taken out (approved expenses, transfers out, reversals), all time.")
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private var facts: [FinAFact] {
        let transfersIn = FinanceARules.moneyText(fund.transfersInYtd.map { ($0.currency, $0.amountMinor) }, separator: " · ")
        let transfersOut = FinanceARules.moneyText(fund.transfersOutYtd.map { ($0.currency, -$0.amountMinor) }, separator: " · ")
        var out = [
            FinAFact("Income, \(FinanceARules.fmtRange(from: period.from, to: period.to))",
                     FinanceARules.moneyText(fund.income.map { ($0.currency, $0.periodMinor) })),
            FinAFact("Income this year", FinanceARules.moneyText(fund.income.map { ($0.currency, $0.ytdMinor) })),
            FinAFact("Expenses this year", FinanceARules.moneyText(fund.expensesYtd.map { ($0.currency, $0.amountMinor) })),
            FinAFact("Transfers in / out", "\(transfersIn) / \(transfersOut)"),
            FinAFact("Last activity", fund.lastActivityAt.map { FinanceATime.dayTime($0) } ?? "No postings yet"),
        ]
        if let sw = fund.nameSw, !sw.isEmpty { out.append(FinAFact("Swahili name", sw)) }
        out.append(FinAFact("Sort order", String(fund.sort), mono: true))
        if let d = fund.description, !d.isEmpty { out.append(FinAFact("Description", d)) }
        return out
    }

    private var postingsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Latest postings").font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            FinAExplain("The \(Self.recent) most recent, by the date they count on. Credits are money in; debits money out.")
            if let error {
                ErrorBanner(message: error) { Task { await load() } }
            } else if loading && postings.isEmpty {
                SkeletonTable(rows: 3)
            } else if postings.isEmpty {
                Text("No postings on \(account) yet.").font(.nCaption).foregroundStyle(Nuru.ink400)
            } else {
                let cols = self.cols
                FinanceTable(rows: postings, columns: cols, emptyIcon: "book.closed", emptyMessage: "") { p in
                    Text(FinanceDates.display(p.postedOn)).font(.nMono(12)).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[0])
                    Text(FinanceARules.postingSource(kind: p.kind, receiptCode: p.receiptCode, memberName: p.memberName,
                                                      journalKind: p.journalKind, memo: p.memo))
                        .font(.inter(13)).foregroundStyle(Nuru.ink).lineLimit(2).financeCell(cols[1])
                    Text(p.side == "debit" ? FinanceMoney.format(p.amountMinor, p.currency) : "").font(.nMono(12.5))
                        .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[2])
                    Text(p.side == "credit" ? FinanceMoney.format(p.amountMinor, p.currency) : "").font(.nMono(12.5))
                        .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[3])
                }
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            postings = try await FinanceERPAPI.ledger(FinLedgerFilter(period: nil, account: account), limit: Self.recent).data
            error = nil
        } catch {
            if !Task.isCancelled { self.error = FinanceARules.message(error, fallback: "Could not load the fund's postings.") }
        }
    }
}

// MARK: - New / edit

struct FinAFundEditorSheet: View {
    /// nil = a new fund.
    let fund: FinFundRow?
    /// The saved fund and whether it was created (false = updated).
    var onSaved: (FinFund, Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var code: String
    @State private var codeTouched = false
    @State private var nameSw: String
    @State private var description: String
    @State private var sortText: String
    @State private var active: Bool
    @State private var attempted = false
    @State private var busy = false
    @State private var error: String?
    @State private var inUse: String?
    @State private var forceAsk = false

    init(fund: FinFundRow?, onSaved: @escaping (FinFund, Bool) -> Void = { _, _ in }) {
        self.fund = fund
        self.onSaved = onSaved
        _name = State(initialValue: fund?.name ?? "")
        _code = State(initialValue: fund?.code ?? "")
        _nameSw = State(initialValue: fund?.nameSw ?? "")
        _description = State(initialValue: fund?.description ?? "")
        _sortText = State(initialValue: String(fund?.sort ?? 0))
        _active = State(initialValue: fund?.isActive ?? true)
    }

    private var creating: Bool { fund == nil }
    private var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedSw: String { nameSw.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedDescription: String { description.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// A whole number of at most six digits (the web's /^-?\d{1,6}$/).
    private var sort: Int? {
        let t = sortText.trimmingCharacters(in: .whitespaces)
        let digits = t.hasPrefix("-") ? String(t.dropFirst()) : t
        guard (1...6).contains(digits.count), digits.allSatisfy({ $0.isASCII && $0.isNumber }) else { return nil }
        return Int(t)
    }
    private var fundLabel: String { trimmedName.isEmpty ? (fund?.name ?? "this fund") : trimmedName }

    private var errors: [String: String] {
        var e: [String: String] = [:]
        e["name"] = FinanceARules.lengthProblem(name, min: 2, max: 150, what: "a name")
        if !trimmedSw.isEmpty { e["sw"] = FinanceARules.lengthProblem(nameSw, min: 2, max: 150, what: "the Swahili name") }
        if creating { e["code"] = FinanceARules.slugProblem(code) }
        e["description"] = FinanceARules.lengthProblem(description, min: 0, max: 500, what: "a description")
        if sort == nil { e["sort"] = "A whole number — lower numbers list first." }
        return e
    }
    /// Before the first save: the name waits, the code shows once typed in.
    private func shown(_ key: String) -> String? {
        if attempted { return errors[key] }
        switch key {
        case "name": return nil
        case "code": return codeTouched ? errors["code"] : nil
        default: return errors[key]
        }
    }

    /// The fields that changed, as a PATCH body (the web's fundPatch).
    private var patch: FinFundPatch {
        var p = FinFundPatch()
        guard let f = fund else { return p }
        if trimmedName != f.name { p.name = trimmedName }
        let sw: String? = trimmedSw.isEmpty ? nil : trimmedSw
        if sw != f.nameSw {
            if let sw { p.nameSw = .set(sw) } else { p.nameSw = .clear }
        }
        let desc: String? = trimmedDescription.isEmpty ? nil : trimmedDescription
        if desc != f.description {
            if let desc { p.description = .set(desc) } else { p.description = .clear }
        }
        if let s = sort, s != f.sort { p.sort = s }
        if active != f.isActive { p.isActive = active }
        return p
    }
    private var nothingChanged: Bool { !creating && patch.isEmpty }

    var body: some View {
        FinAFormSheet(title: creating ? "New fund" : "Edit \(fund?.name ?? "fund")",
                      subtitle: creating ? "A place money is given to and spent from — e.g. Tithe, Building, Missions." : "fund:\(fund?.code ?? "")",
                      confirmTitle: creating ? "Create fund" : (nothingChanged ? "Nothing to save" : "Save changes"),
                      confirmEnabled: !nothingChanged && inUse == nil,
                      busy: busy,
                      alertKey: inUse ?? error,
                      onConfirm: { Task { await save(force: false) } }) {
            if inUse != nil || error != nil {
                VStack(alignment: .leading, spacing: 10) {
                    if let inUse {
                        FinanceNoticeBar(notice: .warn(inUse))
                        HStack(spacing: 10) {
                            FinanceButton(title: "Cancel") { self.inUse = nil; active = true }
                            FinanceButton(title: "Deactivate anyway", icon: "exclamationmark.triangle", style: .danger, busy: busy) { forceAsk = true }
                        }
                    }
                    if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
                }
                .id(FinAFormAnchor.alert)
            }
            FinAFormField(label: "Name", error: shown("name")) {
                TextField("e.g. Building Fund", text: Binding(get: { name }, set: { v in
                    name = String(v.prefix(150))
                    if creating && !codeTouched { code = FinanceARules.suggestedSlug(from: name) }
                }))
                .finAInput(error: shown("name") != nil)
            }
            FinAFormField(label: "Name in Swahili", hint: "Optional — shown to members who use the app in Swahili.", error: shown("sw")) {
                TextField("e.g. Mfuko wa Ujenzi", text: Binding(get: { nameSw }, set: { nameSw = String($0.prefix(150)) }))
                    .finAInput(error: shown("sw") != nil)
            }
            FinAFormField(label: "Code",
                          hint: creating
                            ? "Permanent: lowercase letters, digits and hyphens, starting with a letter (2–40). The ledger account becomes fund:<code>, so it can never change."
                            : "Permanent — the ledger account fund:<code> carries every posting ever made to this fund, so the code never changes. Rename it instead.",
                          error: shown("code")) {
                if creating {
                    TextField("", text: Binding(get: { code }, set: { codeTouched = true; code = String($0.lowercased().prefix(40)) }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(.nMono(15)).finAInput(error: shown("code") != nil)
                } else {
                    Text(code).font(.nMono(15)).foregroundStyle(Nuru.ink600)
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        .padding(.horizontal, 12)
                        .background(Nuru.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                        .accessibilityLabel("Code \(code), read only")
                }
            }
            FinAFormField(label: "Description", hint: "Optional — what the fund is for. \(trimmedDescription.utf16.count) / 500", error: shown("description")) {
                TextField("", text: Binding(get: { description }, set: { description = String($0.prefix(500)) }), axis: .vertical)
                    .lineLimit(2...6).padding(.vertical, 10).finAInput(error: shown("description") != nil)
            }
            FinAFormField(label: "Sort order", hint: "Lower numbers list first in pickers and on the Funds page.", error: shown("sort")) {
                TextField("0", text: $sortText).keyboardType(.numbersAndPunctuation).font(.nMono(15))
                    .finAInput(error: shown("sort") != nil).frame(maxWidth: 140)
            }
            Toggle(isOn: Binding(get: { active }, set: { active = $0; inUse = nil })) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Active").font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    FinAExplain("An inactive fund is hidden from new gifts and can't receive transfers; everything already in it — history and balance — stays. Money can still be moved out of it.")
                }
            }
            .tint(Nuru.gold)
            .padding(14)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
        #if DEBUG
        .task {
            guard let p = FinanceAFixtures.formValues() else { return }
            if let v = p["name"] { name = v }
            if let v = p["code"] { code = v; codeTouched = true }
            if let v = p["active"] { active = v == "1" }
            if p["submit"] == "1" { await save(force: false) }
        }
        #endif
        .alert("Deactivate \(fundLabel) anyway?", isPresented: $forceAsk) {
            Button("Deactivate anyway", role: .destructive) {
                inUse = nil
                Task { await save(force: true) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(inUse ?? "") Nothing already given is touched; the fund can be made active again at any time.")
        }
    }

    private func save(force: Bool) async {
        attempted = true
        guard errors.isEmpty, !busy, !nothingChanged else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            if let f = fund {
                let saved = try await FinanceERPAPI.updateFund(code: f.code, patch, force: force)
                onSaved(saved, false)
            } else {
                let created = try await FinanceERPAPI.createFund(FinFundInput(
                    code: code, name: trimmedName,
                    nameSw: trimmedSw.isEmpty ? nil : trimmedSw,
                    description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                    sort: sort ?? 0, isActive: active))
                onSaved(created, true)
            }
            dismiss()
        } catch let e where e.apiCode == "FUND_IN_USE" {
            func n(_ key: String) -> Int { max(0, Int(e.apiDetail(key) ?? "") ?? Int(Double(e.apiDetail(key) ?? "") ?? 0)) }
            inUse = FinanceARules.fundInUseSentence(fund: fundLabel, pledges: n("active_pledges"), schedules: n("active_schedules"),
                                                    departments: n("departments"), campaigns: n("live_campaigns"),
                                                    serverMessage: FinanceARules.message(e, fallback: ""))
        } catch let e where e.apiCode == "CONFLICT" && creating {
            error = "A fund with the code “\(code)” already exists — codes are permanent, so pick another."
        } catch {
            self.error = FinanceARules.message(error, fallback: creating ? "The fund was not created." : "The fund was not saved.")
        }
    }
}

// MARK: - Transfer between funds

struct FinATransferSheet: View {
    /// Every fund (a retired fund can still be emptied); "To" offers active ones only.
    let funds: [FinFundRow]
    var onPosted: (FinTransfer) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var from: String
    @State private var to = ""
    @State private var amountText = ""
    @State private var currency = FinanceMoney.homeCurrency
    @State private var occurredOn = FinanceDates.today()
    @State private var memo = ""
    /// One key per opening of this sheet — a retry or "Post anyway" is the same transfer.
    @State private var key = UUID().uuidString
    @State private var attempted = false
    @State private var busy = false
    @State private var error: String?
    @State private var negative: (balance: Int?, after: Int?)?
    @State private var askAnyway = false
    private let today = FinanceDates.today()

    init(funds: [FinFundRow], from: String? = nil, onPosted: @escaping (FinTransfer) -> Void = { _ in }) {
        self.funds = funds
        self.onPosted = onPosted
        _from = State(initialValue: from ?? "")
    }

    private var fromFund: FinFundRow? { funds.first { $0.code == from } }
    private var toFund: FinFundRow? { funds.first { $0.code == to } }
    private var amountMinor: Int? { if case .success(let m) = FinanceMoney.parseMajor(amountText) { return m }; return nil }
    private var fromBalance: Int? { fromFund.map { f in f.balances.first { $0.currency == currency }?.balanceMinor ?? 0 } }
    private var afterMinor: Int? {
        guard let b = fromBalance, let a = amountMinor else { return nil }
        return b - a
    }
    private var fromName: String { fromFund?.name ?? "the from-fund" }

    private var errors: [String: String] {
        var e: [String: String] = [:]
        if from.isEmpty { e["from"] = "Choose the fund the money leaves." }
        if to.isEmpty { e["to"] = "Choose the fund the money goes to." } else if to == from { e["to"] = "Pick two different funds." }
        if amountMinor == nil { e["amount"] = "Enter the amount to move." }
        e["date"] = FinanceARules.dayProblem(occurredOn, today: today, daysBack: 366, what: "date of the transfer")
        e["memo"] = FinanceARules.lengthProblem(memo, min: 3, max: 300, what: "a memo")
        return e
    }
    private func shown(_ key: String) -> String? { attempted ? errors[key] : nil }

    var body: some View {
        FinAFormSheet(title: "Transfer between funds",
                      subtitle: "Moves money from one fund to another inside the books — no cash moves. Posted as a journal on the date you give.",
                      confirmTitle: amountMinor.map { "Post \(FinanceMoney.format($0, currency))" } ?? "Post transfer",
                      confirmEnabled: negative == nil,
                      busy: busy,
                      alertKey: negative != nil ? "negative" : error,
                      onConfirm: { Task { await post(allowNegative: false) } }) {
            if negative != nil || error != nil {
                VStack(alignment: .leading, spacing: 10) {
                    if negative != nil {
                        FinanceNoticeBar(notice: .warn(negativeText))
                        HStack(spacing: 10) {
                            FinanceButton(title: "Cancel") { negative = nil }
                            FinanceButton(title: "Post anyway", icon: "exclamationmark.triangle", style: .danger, busy: busy) { askAnyway = true }
                        }
                    }
                    if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
                }
                .id(FinAFormAnchor.alert)
            }
            FinAFieldRow {
                FinAFormField(label: "From", error: shown("from")) {
                    FinAMenuField(placeholder: "Choose…", selection: Binding(get: { from }, set: { from = $0; negative = nil }),
                                  options: funds.map { FinanceFilterOption($0.code, $0.isActive ? $0.name : "\($0.name) (inactive)") },
                                  error: shown("from") != nil)
                }
                FinAFormField(label: "To", error: shown("to")) {
                    FinAMenuField(placeholder: "Choose…", selection: $to,
                                  options: funds.filter { $0.isActive && $0.code != from }.map { FinanceFilterOption($0.code, $0.name) },
                                  error: shown("to") != nil)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                FinAMoneyInput(label: "Amount", text: $amountText, currency: $currency)
                if let e = shown("amount"), amountText.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text(e).font(.nCaption).foregroundStyle(Nuru.danger)
                }
            }
            .onChange(of: amountText) { _, _ in negative = nil }
            .onChange(of: currency) { _, _ in negative = nil }
            if let f = fromFund {
                fromBalanceLine(f)
            }
            FinAFormField(label: "Date", hint: "The day the move takes effect in the books (East Africa Time).", error: shown("date")) {
                FinADayField(ymd: $occurredOn, range: FinanceARules.allowedDays(today: today, daysBack: 366) ?? today...today).finAInput()
            }
            FinAFormField(label: "Memo", hint: "Why the money moves — kept on the journal. \(memo.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count) / 300",
                          error: shown("memo")) {
                TextField("e.g. Board resolution 14/2026 — seed the Missions fund",
                          text: Binding(get: { memo }, set: { memo = String($0.prefix(300)) }), axis: .vertical)
                    .lineLimit(2...5).padding(.vertical, 10).finAInput(error: shown("memo") != nil)
            }
            if let a = amountMinor, let f = fromFund, let t = toFund {
                Divider()
                FinAExplain("On Post: \(FinanceMoney.format(a, currency)) leaves \(f.name) and arrives in \(t.name), dated \(FinanceDates.display(occurredOn)) (debit fund:\(f.code), credit fund:\(t.code)). A wrong transfer is corrected by reversing it from the Ledger.")
            }
        }
        #if DEBUG
        .task {
            guard let p = FinanceAFixtures.formValues() else { return }
            if let v = p["from"] { from = v }
            if let v = p["to"] { to = v }
            if let v = p["currency"] { currency = v }
            if let v = p["amount"] { amountText = v }
            if let v = p["memo"] { memo = v }
            if p["submit"] == "1" {
                try? await Task.sleep(for: .milliseconds(200))
                await post(allowNegative: false)
            }
        }
        #endif
        .alert("Post the transfer anyway?", isPresented: $askAnyway) {
            Button("Post anyway", role: .destructive) {
                negative = nil
                Task { await post(allowNegative: true) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("\(fromName) will show a negative balance\(negAfter.map { " of \(FinanceMoney.format($0, currency))" } ?? "") until money comes in. The transfer is recorded exactly as entered and can be reversed later from the Ledger.")
        }
    }

    private var negBefore: Int? { negative?.balance ?? fromBalance }
    private var negAfter: Int? { negative?.after ?? afterMinor }

    private var negativeText: String {
        "\(fromName) has \(negBefore.map { FinanceMoney.format($0, currency) } ?? "too little") in \(currency); this transfer would leave it at \(negAfter.map { FinanceMoney.format($0, currency) } ?? "below zero")."
    }

    private func fromBalanceLine(_ f: FinFundRow) -> some View {
        let below = (afterMinor ?? 0) < 0 && negative == nil
        var line = "\(f.name) holds \(FinanceMoney.format(fromBalance ?? 0, currency)) in \(currency)"
        if let after = afterMinor { line += " — after this transfer: \(FinanceMoney.format(after, currency))" }
        line += "."
        return (Text(line).foregroundStyle(Nuru.navy)
                + Text(below ? " That is below zero; the books will ask you to confirm." : "").foregroundStyle(FinanceStatus.amber.fg))
            .font(.inter(12.5))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12).padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    private func post(allowNegative: Bool) async {
        attempted = true
        guard errors.isEmpty, !busy, let minor = amountMinor else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let t = try await FinanceERPAPI.transfer(FinTransferInput(
                fromFund: from, toFund: to, amountMinor: minor, currency: currency, occurredOn: occurredOn,
                memo: memo.trimmingCharacters(in: .whitespacesAndNewlines), allowNegative: allowNegative, idempotencyKey: key))
            onPosted(t)
            dismiss()
        } catch let e where e.apiDetail("reason") == "NEGATIVE_BALANCE" {
            negative = (Int(e.apiDetail("balance_minor") ?? ""), Int(e.apiDetail("balance_after_minor") ?? ""))
        } catch let e where e.apiCode == "INVALID_DATE" {
            error = "The date must be today or within the last 366 days."
        } catch {
            self.error = FinanceARules.message(error, fallback: "The transfer was not posted.")
        }
    }
}

// MARK: - Opening balance

struct FinAOpeningBalanceSheet: View {
    /// Active funds.
    let funds: [FinFundRow]
    var onPosted: (FinJournalResult) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var channel: FinOfficeChannel = .bank
    @State private var fund: String
    @State private var amountText = ""
    @State private var currency = FinanceMoney.homeCurrency
    @State private var asOf = FinanceDates.today()
    @State private var memo = ""
    /// One key per opening of this sheet.
    @State private var key = UUID().uuidString
    @State private var attempted = false
    @State private var busy = false
    @State private var error: String?
    private let today = FinanceDates.today()
    static let maxMinor = 1_000_000_000_000

    init(funds: [FinFundRow], fund: String? = nil, onPosted: @escaping (FinJournalResult) -> Void = { _ in }) {
        self.funds = funds
        self.onPosted = onPosted
        let preset = fund.flatMap { code in funds.contains { $0.code == code } ? code : nil }
        _fund = State(initialValue: preset ?? "")
    }

    private var amountMinor: Int? {
        if case .success(let m) = FinanceARules.parseMajor(amountText, maxMinor: Self.maxMinor) { return m }
        return nil
    }
    private var fundName: String? { funds.first { $0.code == fund }?.name }

    private var errors: [String: String] {
        var e: [String: String] = [:]
        if fund.isEmpty { e["fund"] = "Choose the fund the money belongs to." }
        if amountMinor == nil { e["amount"] = "Enter the balance." }
        e["date"] = FinanceARules.dayProblem(asOf, today: today, daysBack: 3660, what: "balance date")
        e["memo"] = FinanceARules.lengthProblem(memo, min: 3, max: 300, what: "a memo")
        return e
    }
    private func shown(_ key: String) -> String? { attempted ? errors[key] : nil }

    var body: some View {
        FinAFormSheet(title: "Opening balance",
                      subtitle: "What was already in the bank or cash box when you started using Pathway.",
                      confirmTitle: amountMinor.map { "Post \(FinanceMoney.format($0, currency))" } ?? "Post opening balance",
                      busy: busy,
                      alertKey: error,
                      onConfirm: { Task { await post() } }) {
            if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil }.id(FinAFormAnchor.alert) }
            FinAExplain("Without opening balances every fund starts at zero and the first expenses drive it negative. Post one entry per place the money sits, per fund and currency — e.g. the bank account's building money, then the cash box's tithe. A wrong opening balance is reversed from the Ledger (Journals) and posted again.")
            FinAFormField(label: "Where the money sits") {
                FinAMenuField(placeholder: "Choose…", selection: Binding(get: { channel.rawValue }, set: { channel = FinOfficeChannel(rawValue: $0) ?? .bank }),
                              options: FinOfficeChannel.allCases.map { FinanceFilterOption($0.rawValue, FinanceARules.holdingChannelLabel($0)) })
            }
            FinAFormField(label: "Fund", hint: "Active funds only.", error: shown("fund")) {
                FinAMenuField(placeholder: "Choose a fund…", selection: $fund,
                              options: funds.map { FinanceFilterOption($0.code, $0.name) }, error: shown("fund") != nil)
            }
            VStack(alignment: .leading, spacing: 4) {
                FinAMoneyInput(label: "Balance", text: $amountText, currency: $currency, maxMinor: Self.maxMinor)
                if let e = shown("amount"), amountText.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text(e).font(.nCaption).foregroundStyle(Nuru.danger)
                }
            }
            FinAFormField(label: "As of", hint: "The day this balance was true (East Africa Time) — usually the day before your first entries.", error: shown("date")) {
                FinADayField(ymd: $asOf, range: FinanceARules.allowedDays(today: today, daysBack: 3660) ?? today...today).finAInput()
            }
            FinAFormField(label: "Memo", hint: "Where the figure comes from. \(memo.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count) / 300",
                          error: shown("memo")) {
                TextField("e.g. Bank statement balance at 31 Aug 2026",
                          text: Binding(get: { memo }, set: { memo = String($0.prefix(300)) }), axis: .vertical)
                    .lineLimit(2...5).padding(.vertical, 10).finAInput(error: shown("memo") != nil)
            }
            if let a = amountMinor, let name = fundName {
                let cash = FinanceARules.cashAccount(for: channel)
                Divider()
                FinAExplain("On Post: \(FinanceMoney.format(a, currency)) is brought into \(name), held in \(FinanceARules.accountLabel(cash)), as of \(FinanceDates.display(asOf)) (debit \(cash), credit fund:\(fund)). It is not income — Reports leave opening balances out.")
            }
        }
        #if DEBUG
        .task { await debugPrefill() }
        #endif
    }

    #if DEBUG
    fileprivate func debugPrefill() async {
        guard let p = FinanceAFixtures.formValues() else { return }
        if let v = p["fund"] { fund = v }
        if let v = p["channel"], let c = FinOfficeChannel(rawValue: v) { channel = c }
        if let v = p["currency"] { currency = v }
        if let v = p["amount"] { amountText = v }
        if let v = p["memo"] { memo = v }
        if p["submit"] == "1" { await post() }
    }
    #endif

    private func post() async {
        attempted = true
        guard errors.isEmpty, !busy, let minor = amountMinor else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            let j = try await FinanceERPAPI.postOpeningBalance(FinOpeningBalanceInput(
                idempotencyKey: key, channel: channel, fund: fund, amountMinor: minor, currency: currency,
                asOf: asOf, memo: memo.trimmingCharacters(in: .whitespacesAndNewlines)))
            onPosted(j)
            dismiss()
        } catch let e where e.apiCode == "INVALID_DATE" {
            error = "The balance date must be today or within the last ten years."
        } catch {
            self.error = FinanceARules.message(error, fallback: "The opening balance was not posted.")
        }
    }
}
