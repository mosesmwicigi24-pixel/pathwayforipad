// Finance → Transactions → Record a gift (finance:manage; POST
// /admin/finance/gifts — docs/FINANCE_ERP.md §2, §4). The office books money it
// received: a member (search-as-you-type), a walk-in or an anonymous loose
// offering; amount + currency; the channel and its reference; the day it was
// received (EAT, within the last 366 days); optionally a pledge — or, without
// one, a department need — which then decides the fund. ONE idempotency key
// per form, reused on every retry (a retry never books twice or takes a second
// receipt); "Record another" renews it. Same rules and words as the web's
// RecordGiftDrawer.
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
    /// Who decides the fund — the server's order: pledge → need's department fund → the picker.
    enum FundDecision: Equatable {
        case pledge(code: String?, name: String?)
        case need(code: String, name: String)
        case choose
    }
    struct Failure: Equatable {
        let text: String
        var existingTransactionId: String? = nil
    }
    enum PendingCheck { case idle, checking, failed }

    let today: String

    @Published var giver: Giver = .member { didSet { if giver != .member { pledgeId = "" }; failure = nil } }
    @Published var query = ""
    @Published private(set) var results: [FinGiver] = []
    @Published private(set) var searching = false
    @Published private(set) var searchError: String?
    @Published var member: FinGiver? { didSet { if member?.userId != oldValue?.userId { pledgeId = "" } } }
    @Published var walkInName = ""
    @Published var walkInPhone = ""
    @Published var amountText = ""
    @Published var currency = FinanceMoney.homeCurrency {
        didSet { if currency != oldValue { pledgeId = ""; needId = "" } }
    }
    @Published var channel: FinOfficeChannel = .onhand {
        didSet { reference = FinanceARules.normalizeReferenceInput(reference, channel: channel) }
    }
    @Published var reference = ""
    @Published var receivedOn: String
    @Published var fund = ""
    @Published var pledgeId = ""
    @Published var needId = ""
    @Published var note = ""

    @Published private(set) var funds: [FundOption] = []
    @Published private(set) var fundsLoading = true
    @Published private(set) var fundsError: String?
    @Published private(set) var needs: [FinNeedRow] = []
    @Published private(set) var needsError: String?

    /// The chosen member's own payments still in flight (newest first).
    @Published private(set) var pending: [FinTransactionRow] = []
    @Published private(set) var pendingCheck: PendingCheck = .idle

    @Published private(set) var busy = false
    @Published var failure: Failure?
    @Published private(set) var result: FinGiftResult?
    @Published var attempted = false

    /// ONE key per recording; reused on every retry of it.
    private(set) var idempotencyKey = UUID().uuidString

    init(today: String = FinanceDates.today()) {
        self.today = today
        self.receivedOn = today
    }

    // MARK: Choices

    func loadChoices() async {
        if funds.isEmpty {
            fundsLoading = true
            do { funds = try await FinanceERPAPI.config().funds; fundsError = nil }
            catch { if !Task.isCancelled { fundsError = FinanceARules.message(error) } }
            fundsLoading = false
        }
        if needs.isEmpty {
            do { needs = try await FinanceERPAPI.needs(status: "approved", limit: 200).data; needsError = nil }
            catch {
                if !Task.isCancelled {
                    needsError = FinanceARules.message(error, fallback: "Could not load the department needs — a gift can still be recorded without one.")
                }
            }
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
            if !Task.isCancelled { searchError = FinanceARules.message(error, fallback: "Could not search members.") }
        }
    }

    /// The member was picked from the results.
    func choose(_ g: FinGiver) {
        member = g
        results = []
    }

    /// Is one of this member's own payments still in flight? The office may be
    /// about to record the same M-Pesa payment by hand. The register has no
    /// member filter (user_id) over the last three EAT days and keeps their
    /// processing / awaiting rows of 48 h.
    func checkPending(now: Date = Date()) async {
        guard giver == .member, let m = member else { pending = []; pendingCheck = .idle; return }
        pendingCheck = .checking
        let today = FinanceDates.today(now: now)
        var f = FinTransactionFilter(period: .custom(from: FinanceARules.day(today, minus: 2) ?? today, to: today))
        f.userId = m.userId   // exact (pathway 491a5fb) — a phone or name search could catch a namesake
        do {
            let rows = try await FinanceERPAPI.transactions(f, limit: 50).data
            guard member?.userId == m.userId else { return }
            pending = rows
                .filter { $0.userId == m.userId && FinanceARules.isRecentInFlight(status: $0.status, createdAt: $0.createdAt, now: now) }
                .sorted { $0.createdAt > $1.createdAt }
            pendingCheck = .idle
        } catch {
            guard member?.userId == m.userId, !Task.isCancelled else { return }
            pending = []
            pendingCheck = .failed
        }
    }

    var activeFunds: [FundOption] { funds.filter(\.isActive) }
    func fundName(_ code: String) -> String? { funds.first { $0.code == code }?.name }
    var memberPledges: [FinGiverPledge] { giver == .member ? member?.openPledges ?? [] : [] }
    /// The member's open pledges in the gift's currency.
    var pledgesHere: [FinGiverPledge] { memberPledges.filter { $0.currency == currency } }
    var pledgesElsewhere: [FinGiverPledge] { memberPledges.filter { $0.currency != currency } }
    var selectedPledge: FinGiverPledge? { pledgesHere.first { $0.pledgeId == pledgeId } }
    /// Approved needs in the gift's currency.
    var needsHere: [FinNeedRow] { needs.filter { $0.currency == currency } }
    /// A pledge goes where the pledge goes, so a need only counts without one.
    var selectedNeed: FinNeedRow? { selectedPledge == nil ? needsHere.first { $0.needId == needId } : nil }

    var fundDecision: FundDecision {
        if let p = selectedPledge { return .pledge(code: p.paysTo?.code, name: p.paysTo?.name) }
        if let n = selectedNeed, let code = n.fundCode, !code.isEmpty { return .need(code: code, name: fundName(code) ?? code) }
        return .choose
    }

    var fundDecisionText: String? {
        switch fundDecision {
        case .pledge(_, let name): FinanceARules.fundDecisionText(byPledge: true, name: name)
        case .need(_, let name): FinanceARules.fundDecisionText(byPledge: false, name: name)
        case .choose: nil
        }
    }

    // MARK: Validation

    var amountMinor: Int? {
        if case .success(let m) = FinanceMoney.parseMajor(amountText) { return m }
        return nil
    }

    /// Field → why it can't be sent (empty = ready). The web's validateGift.
    var problems: [String: String] {
        var p: [String: String] = [:]
        switch giver {
        case .member:
            if member == nil { p["giver"] = "Choose the member who gave, or switch to Walk-in or Anonymous." }
        case .walkIn:
            if let e = FinanceARules.walkInNameProblem(walkInName) { p["name"] = e }
            if let e = FinanceARules.phoneProblem(walkInPhone) { p["phone"] = e }
        case .anonymous:
            break
        }
        if amountMinor == nil { p["amount"] = "Enter the amount received." }
        if let e = FinanceARules.referenceProblem(reference, channel: channel) { p["reference"] = e }
        if let e = FinanceARules.dayProblem(receivedOn, today: today, daysBack: 366, what: "day the money was received") { p["date"] = e }
        if fundDecision == .choose, !activeFunds.contains(where: { $0.code == fund }) { p["fund"] = "Choose the fund this gift goes to." }
        if let e = FinanceARules.noteProblem(note) { p["note"] = e }
        return p
    }

    func problem(_ field: String) -> String? { attempted ? problems[field] : nil }

    /// The POST /gifts body (the web's buildGiftInput): exactly one giver
    /// mode; the fund is the decided one when a pledge or need decides it.
    func body() -> FinGiftInput? {
        guard let minor = amountMinor, problems.isEmpty else { return nil }
        var input = FinGiftInput(idempotencyKey: idempotencyKey, amountMinor: minor, currency: currency,
                                 channel: channel, receivedOn: receivedOn)
        switch fundDecision {
        case .pledge(let code, _): input.fund = code
        case .need(let code, _): input.fund = code
        case .choose: input.fund = fund.isEmpty ? nil : fund
        }
        let ref = reference.trimmingCharacters(in: .whitespacesAndNewlines)
        input.reference = ref.isEmpty ? nil : (channel == .mpesa ? ref.uppercased() : ref)
        let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
        input.note = n.isEmpty ? nil : n
        switch giver {
        case .member:
            input.userId = member?.userId
            if let p = selectedPledge { input.pledgeId = p.pledgeId }
        case .walkIn:
            input.giverName = walkInName.trimmingCharacters(in: .whitespacesAndNewlines)
            let phone = walkInPhone.trimmingCharacters(in: .whitespacesAndNewlines)
            input.giverPhone = phone.isEmpty ? nil : phone
        case .anonymous:
            input.anonymous = true
        }
        if let need = selectedNeed { input.needId = need.needId }
        return input
    }

    /// "On Record: KES 1,500.00 from Mary Wanjiku is posted to Tithe as received …"
    var summary: String? {
        guard let minor = amountMinor else { return nil }
        let who: String
        switch giver {
        case .member: who = member?.fullName ?? "the member"
        case .walkIn:
            let n = walkInName.trimmingCharacters(in: .whitespacesAndNewlines)
            who = n.isEmpty ? "the walk-in giver" : n
        case .anonymous: who = "an anonymous giver"
        }
        let to: String
        switch fundDecision {
        case .pledge(_, let name): to = name ?? "the fund"
        case .need(_, let name): to = name
        case .choose: to = fund.isEmpty ? "the fund" : (fundName(fund) ?? fund)
        }
        let cash = FinanceARules.accountLabel(FinanceARules.cashAccount(for: channel))
        return "On Record: \(FinanceMoney.format(minor, currency)) from \(who) is posted to \(to) as received \(FinanceDates.display(receivedOn)) — debit \(cash), credit the fund — and takes the next office receipt number (OR-\(receivedOn.prefix(4))-…). Corrections are reversals, never deletions."
    }

    // MARK: Submit

    func submit() async {
        attempted = true
        guard !busy, let input = body() else { return }
        busy = true
        failure = nil
        defer { busy = false }
        do {
            result = try await FinanceERPAPI.recordGift(input)
        } catch {
            failure = describe(error)
        }
    }

    /// A fresh form for the next envelope: a NEW key; channel, date, currency
    /// and giver mode stay.
    func recordAnother() {
        idempotencyKey = UUID().uuidString
        result = nil
        failure = nil
        attempted = false
        member = nil
        query = ""
        results = []
        pending = []
        pendingCheck = .idle
        walkInName = ""
        walkInPhone = ""
        amountText = ""
        reference = ""
        pledgeId = ""
        needId = ""
        fund = ""
        note = ""
    }

    /// A failed POST /gifts as plain sentences (the web's giftErrorView).
    func describe(_ error: Error) -> Failure {
        switch error.apiCode {
        case "DUPLICATE_RECEIPT":
            return Failure(text: "That M-Pesa code is already in the books — the payment also arrived online, or the office recorded it before. Open the existing entry before recording anything.",
                           existingTransactionId: error.apiDetail("transaction_id"))
        case "INVALID_DATE":
            return Failure(text: "The received date must be today or within the last 366 days.")
        case "INVALID_REFERENCE":
            return Failure(text: "That is not an M-Pesa code — it is 8–12 letters and digits, like SJK4H7T2QX.")
        case "CURRENCY_MISMATCH":
            return Failure(text: "The gift must be in the same currency as the pledge or need it pays toward.")
        case "UNPROCESSABLE":
            return Failure(text: FinanceARules.message(error, fallback: "Something in this gift can't be used — check the member, the fund, and the pledge or need."))
        case "CONFLICT":
            idempotencyKey = UUID().uuidString
            return Failure(text: "This form's key belongs to another payment, so it was given a fresh one. Press Record again.")
        default:
            if error.apiStatus == nil {
                // Nothing came back: the gift may or may not be booked. The same
                // key makes a retry safe — a replay returns the booked entry.
                return Failure(text: "\(FinanceARules.message(error)) This form never records the same gift twice, so pressing Record again is safe.")
            }
            return Failure(text: FinanceARules.message(error, fallback: "The gift was not recorded — try again."))
        }
    }
}

struct FinARecordGiftSheet: View {
    /// Open a transaction (the result, one in flight, or the one a duplicate code belongs to).
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
        FinAFormSheet(title: vm.result == nil ? "Record a gift" : "Gift recorded",
                      subtitle: vm.result == nil
                        ? "Money the office received — cash, bank, cheque, or an M-Pesa payment to the till. It posts at once and takes the next office receipt number."
                        : "Posted to the books and numbered.",
                      confirmTitle: vm.result == nil ? "Record" : nil,
                      confirmEnabled: !vm.busy,
                      busy: vm.busy,
                      alertKey: vm.failure?.text ?? (vm.attempted && !vm.problems.isEmpty ? "problems:\(vm.problems.count)" : nil),
                      onConfirm: { Task { await vm.submit() } }) {
            if let r = vm.result {
                success(r)
            } else {
                form
            }
        }
        .task {
            await vm.loadChoices()
            #if DEBUG
            await debugPrefill()
            #endif
        }
        .task(id: vm.query) {
            try? await Task.sleep(nanoseconds: 300_000_000)
            if !Task.isCancelled { await vm.search() }
        }
        .task(id: "\(vm.giver.rawValue)|\(vm.member?.userId ?? "")") { await vm.checkPending() }
        .onChange(of: vm.result?.transactionId) { _, id in if id != nil { onRecorded() } }
    }

    #if DEBUG
    /// DEBUG: NURU_FINANCE_FORM="q=Mary&amount=1500&channel=mpesa&reference=QJK4ABC123&fund=tithe&submit=1"
    /// fills (and optionally submits) the form — headless checks of its paths.
    private func debugPrefill() async {
        guard let p = FinanceAFixtures.formValues() else { return }
        if p["giver"] == "walkin" { vm.giver = .walkIn; vm.walkInName = p["name"] ?? "" }
        if p["giver"] == "anonymous" { vm.giver = .anonymous }
        if let q = p["q"] {
            vm.query = q
            await vm.search()
            if let g = vm.results.first { vm.choose(g) }
            await vm.checkPending()
        }
        if let c = p["currency"] { vm.currency = c }
        if let a = p["amount"] { vm.amountText = a }
        if let ch = p["channel"], let c = FinOfficeChannel(rawValue: ch) { vm.channel = c }
        if let r = p["reference"] { vm.reference = FinanceARules.normalizeReferenceInput(r, channel: vm.channel) }
        if let f = p["fund"] { vm.fund = f }
        if let pl = p["pledge"] { vm.pledgeId = pl }
        if let n = p["need"] { vm.needId = n }
        if let n = p["note"] { vm.note = n }
        if p["submit"] == "1" { await vm.submit() }
    }
    #endif

    // MARK: Form

    @ViewBuilder private var form: some View {
        section("Who gave") {
            FinAChoiceChips(options: FinARecordGiftModel.Giver.allCases, selection: $vm.giver, label: \.label, icon: { $0.icon })
            switch vm.giver {
            case .member: memberPicker
            case .walkIn:
                FinAFieldRow {
                    FinAFormField(label: "Name", error: vm.problem("name")) {
                        TextField("As they gave it", text: $vm.walkInName).textContentType(.name).finAInput(error: vm.problem("name") != nil)
                    }
                    FinAFormField(label: "Phone", hint: "Optional — printed nowhere; helps find the gift later.", error: vm.problem("phone")) {
                        TextField("+2547…", text: $vm.walkInPhone).keyboardType(.phonePad).font(.nMono(15)).finAInput(error: vm.problem("phone") != nil)
                    }
                }
            case .anonymous:
                FinAExplain("A loose offering — no name, no phone. It is in the books and the fund, but on no one's statement.")
            }
            pendingNotice
        }
        section("The money") {
            FinAFieldRow {
                VStack(alignment: .leading, spacing: 4) {
                    FinanceMoneyField(label: "Amount", text: $vm.amountText, currency: $vm.currency)
                    if let e = vm.problem("amount"), vm.amountText.trimmingCharacters(in: .whitespaces).isEmpty {
                        Text(e).font(.nCaption).foregroundStyle(Nuru.danger)
                    }
                }
                FinAFormField(label: "Received on", hint: "Today or up to 366 days back (East Africa Time).", error: vm.problem("date")) {
                    FinADayField(ymd: $vm.receivedOn, range: FinanceARules.allowedDays(today: vm.today, daysBack: 366) ?? vm.today...vm.today)
                        .finAInput()
                }
            }
            FinAFormField(label: "Channel") {
                FinAChoiceChips(options: FinOfficeChannel.allCases, selection: $vm.channel, label: FinanceARules.giftChannelLabel)
            }
            let rule = FinanceARules.referenceRule(vm.channel)
            FinAFormField(label: rule.label + (rule.required ? "" : " (optional)"), hint: rule.hint, error: vm.problem("reference")) {
                TextField(rule.placeholder, text: Binding(
                    get: { vm.reference },
                    set: { vm.reference = FinanceARules.normalizeReferenceInput($0, channel: vm.channel) }
                ))
                .textInputAutocapitalization(vm.channel == .mpesa ? .characters : .never)
                .autocorrectionDisabled()
                .font(.nMono(15))
                .finAInput(error: vm.problem("reference") != nil)
            }
        }
        section("Where it goes") { destination }
        VStack(alignment: .leading, spacing: 12) {
            if let f = vm.failure { failureBar(f).id(FinAFormAnchor.alert) }
            if vm.attempted, !vm.problems.isEmpty, vm.failure == nil {
                FinanceNoticeBar(notice: .warn("Check the highlighted fields — \(vm.problems.count == 1 ? "one thing is" : "\(vm.problems.count) things are") missing."))
                    .id(FinAFormAnchor.alert)
            }
            if let s = vm.summary {
                Text(s).font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            HStack {
                Spacer()
                FinanceButton(title: vm.busy ? "Recording…" : (vm.amountMinor.map { "Record \(FinanceMoney.format($0, vm.currency))" } ?? "Record gift"),
                              icon: "checkmark", style: .gold, busy: vm.busy) {
                    Task { await vm.submit() }
                }
            }
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
                    let contact = [m.phone, m.email, m.congregationName].compactMap { $0 }.filter { !$0.isEmpty }
                    Text(contact.isEmpty ? "No contact details" : contact.joined(separator: " · "))
                        .font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(1)
                }
                Spacer(minLength: 8)
                FinanceButton(title: "Change", icon: "arrow.left.arrow.right") { vm.member = nil }
            }
            .padding(12)
            .background(Nuru.surface)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        } else {
            FinAFormField(label: "Member", hint: "Type at least two letters of a name, a phone number or an email.", error: vm.problem("giver")) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Nuru.ink400)
                    TextField("Search members…", text: $vm.query)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                    if vm.searching { ProgressView().controlSize(.small) }
                }
                .finAInput(error: vm.problem("giver") != nil)
            }
            if let e = vm.searchError {
                FinanceNoticeBar(notice: .error(e))
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
                                    Text(FinanceARules.plural(g.openPledges.count, "open pledge"))
                                        .font(.inter(11, .bold)).foregroundStyle(FinanceStatus.amber.fg).lineLimit(1)
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

    /// One of the member's own payments may still land — say so before Record.
    @ViewBuilder private var pendingNotice: some View {
        if vm.giver == .member, let m = vm.member {
            if let first = vm.pending.first {
                VStack(alignment: .leading, spacing: 8) {
                    FinanceNoticeBar(notice: .warn(FinanceARules.pendingNotice(first)
                        + (vm.pending.count > 1 ? " (\(FinanceARules.plural(vm.pending.count - 1, "other")) too.)" : "")))
                    FinanceButton(title: "Open", icon: "arrow.up.right.square") { onOpenTransaction(first.transactionId) }
                }
            } else if vm.pendingCheck == .failed {
                FinAExplain("Couldn't check whether one of \(m.fullName)'s payments is still processing — look at Transactions before recording an M-Pesa payment.")
            }
        }
    }

    // MARK: Destination (pledge · need · fund · note)

    @ViewBuilder private var destination: some View {
        if vm.giver == .member, let m = vm.member {
            FinAFormField(label: "Pledge", hint: pledgeHint(m)) {
                FinAMenuField(placeholder: "No pledge", selection: $vm.pledgeId,
                              options: [FinanceFilterOption("", "No pledge")] + vm.pledgesHere.map { p in FinanceFilterOption(p.pledgeId, pledgeLabel(p)) })
                    .disabled(vm.pledgesHere.isEmpty)
            }
        }
        if vm.selectedPledge != nil {
            FinAExplain("A gift toward a pledge goes where the pledge goes, so no department need is asked for.")
        } else {
            FinAFormField(label: "Department need", hint: needHint) {
                FinAMenuField(placeholder: "No department need", selection: $vm.needId,
                              options: [FinanceFilterOption("", "No department need")] + vm.needsHere.map { n in
                                  FinanceFilterOption(n.needId, "\(n.title) · \(n.departmentName)")
                              })
                    .disabled(vm.needsHere.isEmpty)
            }
        }
        if let text = vm.fundDecisionText {
            Text(text).font(.inter(13.5, .medium)).foregroundStyle(Nuru.navy)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.surface)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        } else {
            FinAFormField(label: "Fund", hint: vm.fundsLoading ? "Loading funds…" : "Active funds only.",
                          error: vm.problem("fund") ?? ((vm.fundsError != nil && vm.funds.isEmpty) ? "\(vm.fundsError ?? "") Close and reopen the form to try again." : nil)) {
                FinAMenuField(placeholder: "Choose a fund…", selection: $vm.fund,
                              options: vm.activeFunds.map { FinanceFilterOption($0.code, $0.name) },
                              error: vm.problem("fund") != nil)
            }
        }
        FinAFormField(label: "Note",
                      hint: "Optional — printed on the receipt as the gift's name. \(vm.note.trimmingCharacters(in: .whitespacesAndNewlines).count) / 60",
                      error: vm.problem("note")) {
            TextField("e.g. Thanksgiving — Kamau family", text: $vm.note).finAInput(error: vm.problem("note") != nil)
        }
    }

    private func pledgeHint(_ m: FinGiver) -> String {
        let elsewhere = vm.pledgesElsewhere
        var elsewhereText: String?
        if !elsewhere.isEmpty {
            let currencies = Array(Set(elsewhere.map(\.currency))).sorted(by: FinanceMoney.currencyPrecedes).joined(separator: ", ")
            elsewhereText = "\(FinanceARules.plural(elsewhere.count, "open pledge")) in \(currencies) — switch the currency to pay toward \(elsewhere.count == 1 ? "it" : "them")."
        }
        if !vm.pledgesHere.isEmpty {
            return "Optional — the gift then counts toward the pledge's instalments." + (elsewhereText.map { " Also \($0)" } ?? "")
        }
        return elsewhereText ?? "\(m.fullName) has no open pledge."
    }

    private var needHint: String {
        if let e = vm.needsError { return e }
        if let n = vm.selectedNeed, n.fundCode == nil { return "This department has no fund of its own — the gift goes to the fund you choose below." }
        if vm.needsHere.isEmpty { return "No approved need in \(vm.currency)." }
        return "Optional — counts toward the need's target."
    }

    private func pledgeLabel(_ p: FinGiverPledge) -> String {
        if p.shape == "monthly" { return "\(p.title) — \(FinanceMoney.format(p.amountMinor ?? 0, p.currency)) a month" }
        return "\(p.title) — target \(FinanceMoney.format(p.targetMinor ?? 0, p.currency))"
    }

    // MARK: Failure + success

    private func failureBar(_ f: FinARecordGiftModel.Failure) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            FinanceNoticeBar(notice: .error(f.text)) { vm.failure = nil }
            if let id = f.existingTransactionId, !id.isEmpty {
                FinanceButton(title: "Open the existing entry", icon: "arrow.up.right.square") { onOpenTransaction(id) }
            }
        }
    }

    private func success(_ r: FinGiftResult) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: "checkmark.circle.fill").font(.system(size: 22)).foregroundStyle(FinanceStatus.green.fg)
                VStack(alignment: .leading, spacing: 2) {
                    Text("OFFICE RECEIPT").font(.inter(12, .bold)).tracking(0.6).foregroundStyle(FinanceStatus.green.fg)
                    Text(r.receiptCode ?? "—").font(.nMono(22, .medium)).foregroundStyle(Nuru.navy).textSelection(.enabled)
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xE8F6EC))
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Color(hex: 0xBFE3CB), lineWidth: 1))
            if r.reused {
                FinanceNoticeBar(notice: .warn("This gift had already been recorded — the same form reached the server twice. Nothing new was posted; this is the entry as it was booked."))
            }
            FinAFacts(facts: [
                FinAFact("Amount", FinanceMoney.format(r.amountMinor, r.currency)),
                FinAFact("From", r.memberName ?? r.giverName ?? r.giverPhone ?? "Anonymous"),
                FinAFact("Fund", r.fund?.name),
                FinAFact("Received", FinanceDates.display(r.receivedOn) + (r.channel.map { " · \(FinWords.channel($0))" } ?? "") + (r.reference.map { " \($0)" } ?? "")),
            ] + (r.pledge.map { [FinAFact("Pledge", $0.title)] } ?? [])
              + (r.need.map { [FinAFact("Department need", $0.title)] } ?? [])
              + (r.note.map { [FinAFact("On the receipt", $0)] } ?? []))
            FinAExplain((r.userId != nil ? "The member's usual giving receipt has been queued. " : "") + "A mistake is corrected by reversing this entry — its receipt number is never reused.")
            HStack(spacing: 10) {
                FinanceButton(title: "Close") { dismiss() }
                FinanceButton(title: "View", icon: "arrow.up.right.square") { onOpenTransaction(r.transactionId) }
                Spacer()
                FinanceButton(title: "Record another", icon: "plus", style: .gold) { vm.recordAnother() }
            }
        }
    }
}
