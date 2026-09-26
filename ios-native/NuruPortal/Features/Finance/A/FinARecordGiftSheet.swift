// Finance → Transactions → Record a gift (finance:manage; POST
// /admin/finance/gifts — docs/FINANCE_ERP.md §2, §4). The office books money it
// received by hand: a member (search-as-you-type), a walk-in or an anonymous
// loose offering; amount + currency; the channel and its reference; the day it
// was received (EAT, within the last 366 days); optionally a pledge or a
// department need, which then decide the fund. One idempotency key per form,
// reused on every retry — a retry never books twice or takes a second receipt.
import SwiftUI

@MainActor
final class FinARecordGiftModel: ObservableObject {
    enum Giver: String, CaseIterable, Identifiable {
        case member, walkIn, anonymous
        var id: String { rawValue }
        var label: String {
            switch self { case .member: "Member"; case .walkIn: "Walk-in"; case .anonymous: "Anonymous" }
        }
        var icon: String {
            switch self { case .member: "person.crop.circle"; case .walkIn: "figure.walk"; case .anonymous: "questionmark.circle" }
        }
    }
    /// Where the money is booked — the server's rule (pledge > need's department fund > chosen fund).
    enum FundDecision: Equatable {
        case pledge(String)
        case need(String)
        case choose
    }
    struct Failure: Equatable {
        let text: String
        var existingTransactionId: String? = nil
    }

    let today: String

    @Published var giver: Giver = .member
    @Published var query = ""
    @Published private(set) var results: [FinGiver] = []
    @Published private(set) var searching = false
    @Published private(set) var searchError: String?
    @Published var member: FinGiver? {
        didSet { if member?.userId != oldValue?.userId { pledgeId = "" } }
    }
    @Published var walkInName = ""
    @Published var walkInPhone = ""
    @Published var amountText = ""
    @Published var currency = FinanceMoney.homeCurrency {
        didSet {
            if let p = selectedPledge, p.currency != currency { pledgeId = "" }
            if let n = selectedNeed, n.currency != currency { needId = "" }
        }
    }
    @Published var channel: FinOfficeChannel = .onhand
    @Published var reference = ""
    @Published var receivedOn: String
    @Published var fund = ""
    @Published var pledgeId = ""
    @Published var needId = ""
    @Published var note = ""

    @Published private(set) var funds: [FundOption] = []
    @Published private(set) var fundsError: String?
    @Published private(set) var needs: [FinNeedRow] = []
    @Published private(set) var needsError: String?

    @Published private(set) var busy = false
    @Published var failure: Failure?
    /// Payments of this member still in flight — non-empty shows the "count it twice?" question.
    @Published var inFlight: [FinTransactionRow] = []
    @Published private(set) var inFlightCheckFailed = false
    @Published private(set) var result: FinGiftResult?
    @Published var showProblems = false

    /// ONE key per recording; reused on every retry of it.
    private(set) var idempotencyKey = UUID().uuidString
    private var inFlightAcknowledged = false

    init(today: String = FinanceDates.today()) {
        self.today = today
        self.receivedOn = today
    }

    // MARK: Choices

    func loadChoices() async {
        if funds.isEmpty {
            do { funds = try await FinanceERPAPI.config().funds; fundsError = nil }
            catch { if !Task.isCancelled { fundsError = FinanceARules.message(error) } }
        }
        if needs.isEmpty {
            do { needs = try await FinanceERPAPI.needs(status: "approved", limit: 100).data; needsError = nil }
            catch { if !Task.isCancelled { needsError = FinanceARules.message(error) } }
        }
    }

    /// Search-as-you-type (the view debounces 300 ms); 2+ characters.
    func search() async {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { results = []; searchError = nil; return }
        searching = true
        defer { searching = false }
        do {
            let found = try await FinanceERPAPI.givers(q: q)
            if query.trimmingCharacters(in: .whitespacesAndNewlines) == q { results = found; searchError = nil }
        } catch {
            if !Task.isCancelled { searchError = FinanceARules.message(error) }
        }
    }

    /// The member was picked from the results.
    func choose(_ g: FinGiver) {
        member = g
        results = []
    }

    var activeFunds: [FundOption] { funds.filter(\.isActive) }
    func fundName(_ code: String) -> String { funds.first { $0.code == code }?.name ?? code }
    var selectedPledge: FinGiverPledge? { giver == .member ? member?.openPledges.first { $0.pledgeId == pledgeId } : nil }
    var selectedNeed: FinNeedRow? { needs.first { $0.needId == needId } }
    /// The member's open pledges in the gift's currency.
    var pledgeChoices: [FinGiverPledge] { member?.openPledges.filter { $0.currency == currency } ?? [] }
    /// The member's open pledges in OTHER currencies (hinted, not offered).
    var otherCurrencyPledges: Int { (member?.openPledges.count ?? 0) - pledgeChoices.count }
    /// Approved needs in the gift's currency.
    var needChoices: [FinNeedRow] { needs.filter { $0.currency == currency && $0.status == "approved" } }

    var fundDecision: FundDecision {
        if let p = selectedPledge { return .pledge(p.paysTo?.name ?? "the pledge's fund") }
        if let n = selectedNeed, let code = n.fundCode, !code.isEmpty { return .need(fundName(code)) }
        return .choose
    }

    // MARK: Validation

    var amountMinor: Int? {
        if case .success(let m) = FinanceMoney.parseMajor(amountText) { return m }
        return nil
    }

    /// Field → why it can't be sent (empty = ready).
    var problems: [String: String] {
        var p: [String: String] = [:]
        switch giver {
        case .member:
            if member == nil { p["giver"] = "Choose the member who gave." }
        case .walkIn:
            if let e = FinanceARules.walkInNameProblem(walkInName) { p["name"] = e }
            if let e = FinanceARules.phoneProblem(walkInPhone) { p["phone"] = e }
        case .anonymous:
            break
        }
        if case .failure(let e) = FinanceMoney.parseMajor(amountText) { p["amount"] = e.message }
        if fundDecision == .choose, !activeFunds.contains(where: { $0.code == fund }) { p["fund"] = "Choose the fund this gift goes to." }
        if let e = FinanceARules.referenceProblem(reference, channel: channel) { p["reference"] = e }
        if let e = FinanceARules.noteProblem(note) { p["note"] = e }
        if let r = FinanceARules.allowedDays(today: today, daysBack: 366), !r.contains(receivedOn) {
            p["date"] = FinanceARules.dateRangeSentence("The received date", today: today, daysBack: 366)
        }
        return p
    }

    func problem(_ field: String) -> String? { showProblems ? problems[field] : nil }

    /// The request body, or nil while something is missing.
    func body() -> FinGiftInput? {
        guard let minor = amountMinor, problems.isEmpty else { return nil }
        var input = FinGiftInput(idempotencyKey: idempotencyKey, amountMinor: minor, currency: currency,
                                 channel: channel, receivedOn: receivedOn)
        switch giver {
        case .member: input.userId = member?.userId
        case .walkIn:
            input.giverName = walkInName.trimmingCharacters(in: .whitespacesAndNewlines)
            let phone = walkInPhone.trimmingCharacters(in: .whitespacesAndNewlines)
            input.giverPhone = phone.isEmpty ? nil : phone
        case .anonymous: input.anonymous = true
        }
        if fundDecision == .choose { input.fund = fund }
        input.reference = FinanceARules.normalizedReference(reference, channel: channel)
        if selectedPledge != nil { input.pledgeId = pledgeId }
        if selectedNeed != nil { input.needId = needId }
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        input.note = n.isEmpty ? nil : n
        return input
    }

    /// "Records KES 1,500.00 from Mary Wanjiku to Tithe, received 26 Sep 2026, cash on hand."
    var summary: String? {
        guard let minor = amountMinor else { return nil }
        let who: String
        switch giver {
        case .member: who = member?.fullName ?? "the member"
        case .walkIn: who = walkInName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "a walk-in" : walkInName.trimmingCharacters(in: .whitespacesAndNewlines)
        case .anonymous: who = "an anonymous giver"
        }
        let to: String
        switch fundDecision {
        case .pledge(let name): to = name
        case .need(let name): to = name
        case .choose: to = fund.isEmpty ? "the fund you choose" : fundName(fund)
        }
        var s = "Records \(FinanceMoney.format(minor, currency)) from \(who) to \(to), received \(FinanceDates.display(receivedOn)), \(FinanceARules.giftChannelLabel(channel).lowercased())"
        if let ref = FinanceARules.normalizedReference(reference, channel: channel) { s += " \(ref)" }
        return s + ". The receipt is the next office number (OR-…)."
    }

    // MARK: Submit

    func submit() async {
        showProblems = true
        failure = nil
        guard let input = body() else { return }
        busy = true
        defer { busy = false }
        if giver == .member, let m = member, !inFlightAcknowledged {
            switch await Self.recentInFlight(for: m) {
            case .success(let rows) where !rows.isEmpty:
                inFlight = rows
                return
            case .failure:
                inFlightCheckFailed = true
            default:
                break
            }
        }
        do {
            result = try await FinanceERPAPI.recordGift(input)
        } catch {
            failure = describe(error)
        }
    }

    /// The "count it twice?" question was answered: record anyway.
    func recordAnyway() async {
        inFlightAcknowledged = true
        inFlight = []
        await submit()
    }

    /// A new recording: a NEW key; keeps the giver mode, channel, date, currency and fund.
    func recordAnother() {
        idempotencyKey = UUID().uuidString
        result = nil
        failure = nil
        showProblems = false
        inFlight = []
        inFlightAcknowledged = false
        inFlightCheckFailed = false
        member = nil
        query = ""
        results = []
        walkInName = ""
        walkInPhone = ""
        amountText = ""
        reference = ""
        note = ""
        pledgeId = ""
        needId = ""
    }

    /// Plain sentences per error code (the books contract's named codes).
    func describe(_ error: Error) -> Failure {
        let message = FinanceARules.message(error)
        switch error.apiCode {
        case "DUPLICATE_RECEIPT":
            let code = FinanceARules.normalizedReference(reference, channel: channel) ?? "This M-Pesa code"
            return Failure(text: "\(code) is already in the books — it is the receipt of a payment that settled, or of another office entry. Nothing was recorded.",
                           existingTransactionId: error.apiDetail("transaction_id"))
        case "INVALID_DATE":
            return Failure(text: FinanceARules.dateRangeSentence("The received date", today: today, daysBack: 366) + " Nothing was recorded.")
        case "INVALID_REFERENCE":
            return Failure(text: "That M-Pesa code isn't valid — an M-Pesa code is 8–12 letters and digits, like QJK4ABC123. Nothing was recorded.")
        case "CURRENCY_MISMATCH":
            let want = selectedPledge?.currency ?? selectedNeed?.currency
            return Failure(text: "A gift toward a pledge or a department need must be in that pledge's or need's currency\(want.map { " (\($0))" } ?? ""). Change the currency or the choice. Nothing was recorded.")
        case "UNPROCESSABLE":
            return Failure(text: "This gift can't be booked as it stands: \(message) Check the member, fund, pledge and need, then try again.")
        case "CONFLICT":
            idempotencyKey = UUID().uuidString
            return Failure(text: "This form's key belongs to another payment, so it was given a fresh one. Press Record gift again.")
        case "FORBIDDEN_SCOPE":
            return Failure(text: "Recording gifts needs the finance:manage permission. Nothing was recorded.")
        default:
            if error.apiStatus == nil {
                return Failure(text: "Couldn't confirm with the server (\(message)). The gift may or may not be booked — press Record gift again: this form never records the same gift twice.")
            }
            return Failure(text: message)
        }
    }

    /// This member's payments still processing / awaiting action in the last
    /// 48 h. The register has no member filter, so it searches by their phone
    /// (else name) over the last three EAT days and keeps their own rows.
    static func recentInFlight(for m: FinGiver, now: Date = Date()) async -> Result<[FinTransactionRow], Error> {
        let today = FinanceDates.today(now: now)
        guard let from = FinanceARules.day(today, minus: 2) else { return .success([]) }
        let phone = m.phone?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let term = phone.isEmpty ? m.fullName : phone
        var rows: [FinTransactionRow] = []
        do {
            for status in ["processing", "requires_action"] {
                var f = FinTransactionFilter(period: .custom(from: from, to: today))
                f.status = status
                f.q = term
                rows += try await FinanceERPAPI.transactions(f, limit: 20).data
            }
        } catch {
            return .failure(error)
        }
        return .success(rows.filter { $0.userId == m.userId && FinanceARules.isRecentInFlight(status: $0.status, createdAt: $0.createdAt, now: now) })
    }
}

struct FinARecordGiftSheet: View {
    /// Open a transaction (the result, or the one a duplicate code belongs to).
    var onOpenTransaction: (String) -> Void = { _ in }
    /// A gift was booked — refresh the register.
    var onRecorded: () -> Void = {}

    @StateObject private var vm = FinARecordGiftModel()
    @Environment(\.dismiss) private var dismiss

    init(onOpenTransaction: @escaping (String) -> Void = { _ in }, onRecorded: @escaping () -> Void = {}) {
        self.onOpenTransaction = onOpenTransaction
        self.onRecorded = onRecorded
    }

    var body: some View {
        FinAFormSheet(title: "Record a gift",
                      subtitle: vm.result == nil ? "Money the office received by hand — cash, bank, cheque or an M-Pesa payment made outside the app. It is booked at once and gets the next office receipt number." : nil,
                      confirmTitle: vm.result == nil ? "Record" : nil,
                      confirmEnabled: !vm.busy,
                      busy: vm.busy,
                      onConfirm: { Task { await vm.submit() } }) {
            if let r = vm.result {
                success(r)
            } else {
                form
            }
        }
        .task { await vm.loadChoices() }
        .task(id: vm.query) {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !Task.isCancelled { await vm.search() }
        }
        .onChange(of: vm.result?.transactionId) { _, id in if id != nil { onRecorded() } }
        .alert("A payment is still processing", isPresented: Binding(get: { !vm.inFlight.isEmpty }, set: { if !$0 { vm.inFlight = [] } })) {
            Button("Record anyway") { Task { await vm.recordAnyway() } }
            Button("Go back", role: .cancel) { vm.inFlight = [] }
        } message: {
            Text(inFlightMessage)
        }
    }

    private var inFlightMessage: String {
        let name = vm.member?.fullName ?? "This member"
        let lines = vm.inFlight.prefix(3).map {
            "\(FinanceMoney.format($0.amountMinor, $0.currency)) by \(FinWords.channel($0.channel)), started \(FinanceATime.dayTime($0.createdAt))"
        }
        return "\(name) has \(vm.inFlight.count == 1 ? "a payment" : "\(vm.inFlight.count) payments") that hasn't finished: \(lines.joined(separator: "; ")). If this is the same money, recording it here would count it twice."
    }

    // MARK: Form

    @ViewBuilder private var form: some View {
        if let f = vm.failure { failureBar(f) }
        section("Who gave") {
            FinAChoiceChips(options: FinARecordGiftModel.Giver.allCases, selection: $vm.giver, label: \.label, icon: { $0.icon })
            switch vm.giver {
            case .member: memberPicker
            case .walkIn:
                FinAFieldRow {
                    FinAFormField(label: "Name", error: vm.problem("name")) {
                        TextField("Full name", text: $vm.walkInName).textContentType(.name).finAInput(error: vm.problem("name") != nil)
                    }
                    FinAFormField(label: "Phone (optional)", hint: "For the receipt SMS — leave blank if they'd rather not.", error: vm.problem("phone")) {
                        TextField("+254…", text: $vm.walkInPhone).keyboardType(.phonePad).finAInput(error: vm.problem("phone") != nil)
                    }
                }
            case .anonymous:
                FinAExplain("No name and no phone — a loose offering. It is booked to the fund and appears on no one's statement.")
            }
        }
        section("The gift") {
            FinAFieldRow {
                FinanceMoneyField(label: "Amount", text: $vm.amountText, currency: $vm.currency)
                FinAFormField(label: "Received on", hint: "East Africa Time — up to 366 days back. The books date it that day.", error: vm.problem("date")) {
                    FinADayField(ymd: $vm.receivedOn, range: FinanceARules.allowedDays(today: vm.today, daysBack: 366) ?? vm.today...vm.today)
                        .finAInput()
                }
            }
            if let e = vm.problem("amount"), vm.amountText.isEmpty { Text(e).font(.nCaption).foregroundStyle(Nuru.danger) }
            FinAFormField(label: "Channel", hint: channelHint) {
                FinAChoiceChips(options: FinOfficeChannel.allCases, selection: $vm.channel, label: FinanceARules.giftChannelLabel)
            }
            FinAFormField(label: FinanceARules.referenceLabel(vm.channel), error: vm.problem("reference")) {
                TextField(FinanceARules.referencePrompt(vm.channel), text: Binding(
                    get: { vm.reference },
                    set: { vm.reference = vm.channel == .mpesa ? $0.uppercased() : $0 }
                ))
                .textInputAutocapitalization(vm.channel == .mpesa ? .characters : .never)
                .autocorrectionDisabled()
                .font(vm.channel == .mpesa ? .nMono(15) : .inter(15))
                .finAInput(error: vm.problem("reference") != nil)
            }
        }
        section("Where it goes") { destination }
        section("Receipt") {
            FinAFormField(label: "Note (optional)", hint: "\(vm.note.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count)/60 — printed on the receipt, e.g. “Thanksgiving”.", error: vm.problem("note")) {
                TextField("A few words for the receipt", text: $vm.note).finAInput(error: vm.problem("note") != nil)
            }
        }
        VStack(alignment: .leading, spacing: 12) {
            if let s = vm.summary { Text(s).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true) }
            if vm.showProblems, !vm.problems.isEmpty {
                FinanceNoticeBar(notice: .warn("Check the highlighted fields — \(vm.problems.count == 1 ? "one thing is" : "\(vm.problems.count) things are") missing."))
            }
            HStack {
                Spacer()
                FinanceButton(title: vm.busy ? "Recording…" : "Record gift", icon: "checkmark", style: .gold, busy: vm.busy) {
                    Task { await vm.submit() }
                }
            }
        }
    }

    private var channelHint: String {
        switch vm.channel {
        case .onhand: "Physical cash counted by the office — booked to cash on hand."
        case .bank: "Deposited or transferred into the church's bank account."
        case .cheque: "A cheque received — booked to cheques until it clears."
        case .mpesa: "Paid to the church's till or paybill but not through the app — same statement as online M-Pesa."
        case .other: "Anything else — say what in the reference."
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(.inter(15, .bold)).foregroundStyle(Nuru.navy)
            content()
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: Member

    @ViewBuilder private var memberPicker: some View {
        if let m = vm.member {
            HStack(spacing: 12) {
                Monogram(name: m.fullName, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(m.fullName).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    Text([m.phone, m.congregationName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(1)
                    Text(m.openPledges.isEmpty ? "No open pledges" : "\(m.openPledges.count) open \(m.openPledges.count == 1 ? "pledge" : "pledges")")
                        .font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                Spacer(minLength: 8)
                FinanceButton(title: "Change", icon: "arrow.left.arrow.right") { vm.member = nil }
            }
            .padding(12)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        } else {
            FinAFormField(label: "Find the member", hint: "Name, phone or email — at least 2 characters.", error: vm.problem("giver")) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Nuru.ink400)
                    TextField("Search members", text: $vm.query)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if vm.searching { ProgressView().controlSize(.small) }
                }
                .finAInput(error: vm.problem("giver") != nil)
            }
            if let e = vm.searchError {
                FinanceNoticeBar(notice: .error("Couldn't search — \(e)"))
            } else if !vm.results.isEmpty {
                VStack(spacing: 0) {
                    ForEach(Array(vm.results.enumerated()), id: \.element.id) { i, g in
                        Button { vm.choose(g) } label: {
                            HStack(spacing: 10) {
                                Monogram(name: g.fullName, size: 32)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(g.fullName).font(.inter(14, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                                    Text([g.phone, g.email, g.congregationName].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(1)
                                }
                                Spacer(minLength: 8)
                                if !g.openPledges.isEmpty {
                                    FinATag(text: "\(g.openPledges.count) open \(g.openPledges.count == 1 ? "pledge" : "pledges")", tone: FinanceStatus.navy)
                                }
                            }
                            .padding(.horizontal, 12).padding(.vertical, 9)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            } else if vm.query.trimmingCharacters(in: .whitespaces).count >= 2 && !vm.searching {
                FinAExplain("No member matches “\(vm.query.trimmingCharacters(in: .whitespaces))”. Record them as a walk-in if they're not a member.")
            }
        }
    }

    // MARK: Destination (pledge · need · fund)

    @ViewBuilder private var destination: some View {
        if vm.giver == .member, let m = vm.member {
            FinAFormField(label: "Toward a pledge (optional)",
                          hint: vm.otherCurrencyPledges > 0 ? "\(m.fullName)'s pledges in other currencies show when the gift is in that currency." : (m.openPledges.isEmpty ? "\(m.fullName) has no open pledge." : "The gift counts toward this pledge's instalment.")) {
                FinAMenuField(placeholder: "No pledge", selection: $vm.pledgeId,
                              options: [FinanceFilterOption("", "No pledge")] + vm.pledgeChoices.map { p in
                                  FinanceFilterOption(p.pledgeId, pledgeLabel(p))
                              })
            }
        }
        FinAFormField(label: "Toward a department need (optional)",
                      hint: vm.needsError.map { "Couldn't load department needs (\($0)) — you can still record without one." }) {
            FinAMenuField(placeholder: "No department need", selection: $vm.needId,
                          options: [FinanceFilterOption("", "No department need")] + vm.needChoices.map { n in
                              FinanceFilterOption(n.needId, "\(n.title) — \(n.departmentName) (\(FinanceMoney.format(n.raisedMinor, n.currency)) of \(FinanceMoney.format(n.targetMinor, n.currency)))")
                          })
        }
        switch vm.fundDecision {
        case .pledge(let name):
            decided("Booked to \(name) (the pledge's fund).")
        case .need(let name):
            decided("Booked to \(name) — the department's fund.")
        case .choose:
            FinAFormField(label: "Fund",
                          hint: vm.selectedNeed != nil ? "This department has no active fund of its own — choose where the gift is booked." : nil,
                          error: vm.fundsError.map { "Couldn't load the funds — \($0)" } ?? vm.problem("fund")) {
                FinAMenuField(placeholder: "Choose a fund", selection: $vm.fund,
                              options: vm.activeFunds.map { FinanceFilterOption($0.code, $0.name) },
                              error: vm.problem("fund") != nil)
            }
        }
    }

    private func pledgeLabel(_ p: FinGiverPledge) -> String {
        let size: String
        if p.shape == "monthly", let a = p.amountMinor { size = "\(FinanceMoney.format(a, p.currency)) a month" }
        else if let t = p.targetMinor { size = "\(FinanceMoney.format(t, p.currency)) in total" }
        else { size = p.shape }
        return "\(p.title) — \(size)"
    }

    private func decided(_ text: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.turn.down.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(FinanceStatus.green.fg)
            Text(text).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(FinanceStatus.green.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    // MARK: Failure + success

    private func failureBar(_ f: FinARecordGiftModel.Failure) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            FinanceNoticeBar(notice: .error(f.text)) { vm.failure = nil }
            if let id = f.existingTransactionId, !id.isEmpty {
                FinanceButton(title: "Open the existing transaction", icon: "arrow.up.right.square") { onOpenTransaction(id) }
            }
        }
    }

    private func success(_ r: FinGiftResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 34)).foregroundStyle(Nuru.lumGreen)
                VStack(alignment: .leading, spacing: 3) {
                    Text(r.reused ? "Already recorded" : "Recorded").font(.inter(20, .bold)).foregroundStyle(Nuru.navy)
                    Text(r.receiptCode ?? "—").font(.nMono(22, .medium)).foregroundStyle(Nuru.goldLo).textSelection(.enabled)
                }
            }
            if r.reused {
                FinanceNoticeBar(notice: .warn("This form had already booked the gift — nothing new was posted and no second receipt was taken. The details below are the gift as it was booked."))
            }
            FinAFacts(facts: [
                FinAFact("Amount", FinanceMoney.format(r.amountMinor, r.currency)),
                FinAFact("Fund", r.fund.map { "\($0.name) (\($0.code))" }),
                FinAFact("Giver", r.memberName ?? r.giverName ?? (r.anonymous ? "Anonymous" : nil)),
                FinAFact("Received", FinanceDates.display(r.receivedOn)),
                FinAFact("Channel", FinWords.channel(r.channel)),
                FinAFact("Reference", r.reference, mono: true),
                FinAFact("Pledge", r.pledge?.title),
                FinAFact("Department need", r.need?.title),
            ])
            if vm.inFlightCheckFailed {
                FinanceNoticeBar(notice: .warn("Couldn't check whether a payment from this member was still processing — look at Transactions with status Processing."))
            }
            if r.userId != nil { FinAExplain("The member's receipt (email and SMS) is on its way.") }
            HStack(spacing: 10) {
                FinanceButton(title: "Record another", icon: "plus", style: .gold) { vm.recordAnother() }
                FinanceButton(title: "View", icon: "doc.text.magnifyingglass") { onOpenTransaction(r.transactionId) }
                Spacer()
                FinanceButton(title: "Done") { dismiss() }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
