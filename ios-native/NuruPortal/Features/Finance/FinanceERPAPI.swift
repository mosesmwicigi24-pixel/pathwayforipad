// Finance ERP — the typed client of pathway's /v1/admin/finance/* routes
// (docs/FINANCE_ERP.md §4). The OpenAPI contract is the source of truth:
// packages/shared/src/openapi/openapi.yaml, the "Finance ERP · books" and
// "Finance ERP · reports" sections.
//
// Decoding policy (so a page never dies on a null, and never hides a real gap):
//   • The shared decoder maps snake_case → camelCase (APIClient).
//   • Schema-REQUIRED fields are non-optional: ids strict; scalars through the
//     tolerant wrappers (@DefaultEmpty / @LooseInt / @DefaultFalse) — @LooseInt
//     also reads Postgres BIGINT sent as text; arrays and objects strict (a
//     missing list is an error to show, never a silent "nothing").
//   • Nullable or optional fields are Swift optionals (@LooseOptInt for numbers).
// Money is Int minor units + a currency String, per currency, never summed.
import Foundation

// MARK: - Shared wire shapes

/// The `{ currency, amount_minor, count }` every per-currency total carries.
protocol FinCurrencyTotaled {
    var currency: String { get }
    var amountMinor: Int { get }
    var count: Int { get }
}

/// The list envelope of spec §4: `{ data, next_cursor, totals }` — totals are
/// for the WHOLE filtered set, per currency. FinancePager pages through it.
protocol FinPaged: Decodable {
    associatedtype Row: Decodable & Identifiable
    associatedtype Total: Decodable & FinCurrencyTotaled
    var data: [Row] { get }
    var nextCursor: String? { get }
    var totals: [Total] { get }
}

/// FinanceCurrencyTotal / BooksCurrencyTotal — `{currency, amount_minor, count}`.
struct FinCurrencyTotal: Codable, Hashable, FinCurrencyTotaled {
    @DefaultEmpty var currency: String
    @LooseInt var amountMinor: Int
    @LooseInt var count: Int
}

/// An integer that may be null, a JSON number, or a numeric string (BIGINT as
/// text). Null / missing → nil; unparseable → nil. The optional twin of @LooseInt.
@propertyWrapper
struct LooseOptInt: Codable, Equatable, Hashable {
    var wrappedValue: Int?
    init(wrappedValue: Int?) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() {
            wrappedValue = nil
        } else if let i = try? c.decode(Int.self) {
            wrappedValue = i
        } else if let d = try? c.decode(Double.self), d.isFinite {
            wrappedValue = Int(d.rounded())
        } else if let s = try? c.decode(String.self) {
            let t = s.trimmingCharacters(in: .whitespaces)
            wrappedValue = Int(t) ?? Double(t).map { Int($0.rounded()) }
        } else {
            wrappedValue = nil
        }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(wrappedValue)
    }
}

extension KeyedDecodingContainer {
    /// Missing key OR explicit null → nil (never throws), like @LooseInt's 0.
    func decode(_ type: LooseOptInt.Type, forKey key: Key) throws -> LooseOptInt {
        (try? decodeIfPresent(type, forKey: key)) ?? LooseOptInt(wrappedValue: nil)
    }
}

/// Any JSON value (audit `metadata`). Object keys are kept exactly as sent.
enum FinJSON: Codable, Hashable {
    case string(String), number(Double), bool(Bool), object([String: FinJSON]), array([FinJSON]), null

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let n = try? c.decode(Double.self) { self = .number(n) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([FinJSON].self) { self = .array(a) }
        else { self = .object(try c.decode([String: FinJSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .number(let n): try c.encode(n)
        case .bool(let b): try c.encode(b)
        case .object(let o): try c.encode(o)
        case .array(let a): try c.encode(a)
        case .null: try c.encodeNil()
        }
    }

    /// A readable one-liner for the audit drawer.
    var text: String {
        switch self {
        case .string(let s): s
        case .number(let n): n.rounded() == n && abs(n) < 1e15 ? String(Int(n)) : String(n)
        case .bool(let b): b ? "true" : "false"
        case .null: "—"
        case .array(let a): a.map(\.text).joined(separator: ", ")
        case .object(let o): o.keys.sorted().map { "\($0): \(o[$0]?.text ?? "—")" }.joined(separator: " · ")
        }
    }
}

/// FinanceCurrencyAmount — `{currency, amount_minor}`.
struct FinCurrencyAmount: Codable, Hashable {
    @DefaultEmpty var currency: String
    @LooseInt var amountMinor: Int
}

/// FinanceCurrencyBalance — credits − debits on a fund account (negative = overdrawn).
struct FinCurrencyBalance: Codable, Hashable {
    @DefaultEmpty var currency: String
    @LooseInt var balanceMinor: Int
}

/// BooksFundRef — `{code, name}`.
struct FinFundRef: Codable, Hashable {
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
}

/// BooksCategoryRef — `{category_id, code, name}`.
struct FinCategoryRef: Codable, Hashable {
    @DefaultEmpty var categoryId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
}

/// A list of int64s that may arrive as numbers or as numeric strings
/// (Postgres BIGINT[]). The key is REQUIRED (missing → decode error); a single
/// unreadable element reads 0.
@propertyWrapper
struct LooseInts: Codable, Equatable, Hashable {
    var wrappedValue: [Int]
    init(wrappedValue: [Int]) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        wrappedValue = try [LooseInt](from: decoder).map(\.wrappedValue)
    }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}

/// One side of a balanced posting — the fields every leg carries.
protocol FinLeg {
    var entryId: String { get }
    var account: String { get }
    var side: String { get }          // debit | credit
    var amountMinor: Int { get }
    var currency: String { get }
    var createdAt: String { get }     // the posting's economic date (12:00 EAT for office postings)
}

/// BooksLedgerLeg — a leg as the books endpoints return it.
struct FinBooksLeg: Codable, Hashable, Identifiable, FinLeg {
    let entryId: String
    @DefaultEmpty var account: String
    @DefaultEmpty var side: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var createdAt: String
    var id: String { entryId }
}

/// FinanceLedgerLeg — a leg on the transaction detail, flagged when it reverses.
struct FinLedgerLeg: Codable, Hashable, Identifiable, FinLeg {
    let entryId: String
    @DefaultEmpty var account: String
    @DefaultEmpty var side: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var createdAt: String
    /// A debit on a non-cash account or a credit on cash:* — the reversing pair.
    @DefaultFalse var isReversal: Bool
    var id: String { entryId }
}

/// Where office money is received or paid from (gifts, expenses, opening
/// balances): cash:onhand · cash:bank · cash:cheque · cash:mpesa · other → cash:manual.
enum FinOfficeChannel: String, Codable, CaseIterable, Identifiable {
    case onhand, bank, cheque, mpesa, other
    var id: String { rawValue }
    var label: String {
        switch self {
        case .onhand: "Cash on hand"
        case .bank: "Bank"
        case .cheque: "Cheque"
        case .mpesa: "M-Pesa (offline)"
        case .other: "Other"
        }
    }
    /// A gift through these must carry its reference (the M-Pesa code — 8–12
    /// letters/digits —, the cheque number, the bank reference).
    var requiresReference: Bool { self == .mpesa || self == .cheque || self == .bank }
}

/// Display words for the wire vocabularies.
enum FinWords {
    /// FinanceChannel: card · mpesa · airtel · paypal · manual · onhand · bank · cheque · other.
    static func channel(_ raw: String?) -> String {
        switch raw ?? "" {
        case "card", "stripe": "Card"
        case "mpesa": "M-Pesa"
        case "airtel": "Airtel"
        case "paypal": "PayPal"
        case "manual": "Claim (paid another way)"
        case "onhand": "Cash"
        case "bank": "Bank"
        case "cheque": "Cheque"
        case "other": "Other"
        case "": "—"
        default: (raw ?? "").capitalized
        }
    }
    /// Transaction source: app · website · admin (the office).
    static func source(_ raw: String?) -> String {
        switch raw ?? "" {
        case "app": "App"
        case "website": "Website"
        case "admin": "Office"
        case "": "—"
        default: (raw ?? "").capitalized
        }
    }
    /// Journal kinds: expense · expense_void · transfer · opening · reversal.
    static func journalKind(_ raw: String?) -> String {
        switch raw ?? "" {
        case "expense": "Expense"
        case "expense_void": "Expense void"
        case "transfer": "Transfer"
        case "opening": "Opening balance"
        case "reversal": "Reversal"
        case "": "—"
        default: (raw ?? "").replacingOccurrences(of: "_", with: " ").capitalized
        }
    }
}

/// A PATCH field that can also be cleared: left out (`.keep`), sent as null
/// (`.clear`), or set. For the schema's nullable patch fields.
enum FinNullable<Value: Encodable> {
    case keep, clear, set(Value)
    var isKeep: Bool { if case .keep = self { true } else { false } }
}

extension KeyedEncodingContainer {
    /// `.keep` writes nothing, `.clear` writes null, `.set(v)` writes v.
    mutating func encode<V: Encodable>(_ value: FinNullable<V>, forKey key: Key) throws {
        switch value {
        case .keep: break
        case .clear: try encodeNil(forKey: key)
        case .set(let v): try encode(v, forKey: key)
        }
    }
}

// MARK: - Overview  (GET /admin/finance/overview — FinanceOverview)

struct FinOverview: Decodable {
    struct Period: Decodable {
        @DefaultEmpty var from: String
        @DefaultEmpty var to: String
        @DefaultEmpty var mtdFrom: String
        @DefaultEmpty var ytdFrom: String
        @DefaultEmpty var lastYearFrom: String
        @DefaultEmpty var lastYearTo: String
    }
    struct Income: Decodable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var periodMinor: Int
        @LooseInt var periodCount: Int
        @LooseInt var mtdMinor: Int
        @LooseInt var ytdMinor: Int
        @LooseInt var samePeriodLastYearMinor: Int
    }
    /// APPROVED expenses only, by spent_on.
    struct Expenses: Decodable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var periodMinor: Int
        @LooseInt var periodCount: Int
        @LooseInt var ytdMinor: Int
    }
    /// income − expenses, per currency.
    struct Net: Decodable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var periodMinor: Int
        @LooseInt var ytdMinor: Int
    }
    struct OutstandingPledges: Decodable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var remainingYearMinor: Int
        /// Active pledges counted.
        @LooseInt var pledges: Int
    }
    struct Partners: Decodable, Hashable {
        @LooseInt var count: Int
        @LooseInt var behind: Int
    }
    struct Counts: Decodable, Hashable {
        @LooseInt var processing: Int
        @LooseInt var failedInPeriod: Int
        @LooseInt var pendingClaims: Int
        @LooseInt var expensesAwaitingApproval: Int
        @LooseInt var failingSchedules: Int
        @LooseInt var staleProcessing: Int
        @LooseInt var integrityIssues: Int
    }
    struct FundBalance: Decodable, Hashable, Identifiable {
        @DefaultEmpty var code: String
        @DefaultEmpty var name: String
        @DefaultFalse var isActive: Bool
        let balances: [FinCurrencyBalance]
        var id: String { code }
    }
    struct SeriesMonth: Decodable, Hashable, Identifiable {
        @DefaultEmpty var month: String              // YYYY-MM
        @LooseInt var incomeMinor: Int
        @LooseInt var expensesMinor: Int
        var id: String { month }
    }
    struct Series: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        /// 12 months, oldest first, the last being `to`'s month.
        let months: [SeriesMonth]
        var id: String { currency }
    }
    struct Alert: Decodable, Hashable, Identifiable {
        /// pending_claims · expenses_awaiting_approval · failing_schedules ·
        /// stale_processing · integrity_issues · partners_behind ·
        /// collection_outage (a kind this app does not know reads in plain words)
        @DefaultEmpty var kind: String
        @LooseInt var count: Int
        /// The web route the alert opens — `FinanceLink.fromWebRoute(link)`.
        @DefaultEmpty var link: String
        /// The server's own words, when it has them (collection_outage) — shown
        /// instead of the kind's hint (FinanceARules.alertText). Optional.
        let message: String?
        var id: String { kind }
    }
    let period: Period
    /// Every currency the figures carry; KES first, then A–Z.
    let currencies: [String]
    let income: [Income]
    let expenses: [Expenses]
    let net: [Net]
    let outstandingPledges: [OutstandingPledges]
    let partners: Partners
    let counts: Counts
    /// Top 6 funds by KES balance (all time).
    let fundBalances: [FundBalance]
    /// Money received per cash account in the period, net of reversals.
    let channels: [FinChannelTotal]
    let series: [Series]
    /// Only kinds with count > 0.
    let alerts: [Alert]
}

/// FinanceChannelTotal — money received per cash account.
struct FinChannelTotal: Decodable, Hashable, Identifiable {
    /// The account without its cash: prefix (stripe = card).
    @DefaultEmpty var channel: String
    @DefaultEmpty var account: String
    @DefaultEmpty var currency: String
    @LooseInt var count: Int
    @LooseInt var receivedMinor: Int
    @LooseInt var reversedMinor: Int
    @LooseInt var netMinor: Int
    var id: String { "\(account)|\(currency)" }
}

// MARK: - Transactions  (GET /admin/finance/transactions, /transactions/{id})

/// FinanceTransactionRow — one transaction as the office sees it.
struct FinTransactionRow: Decodable, Hashable, Identifiable {
    let transactionId: String
    /// Null for a memberless gift (website, office walk-in / anonymous).
    let userId: String?
    let fullName: String?
    let memberPhone: String?
    /// member name → giver_name → giver_phone → "Anonymous" (server-computed).
    @DefaultEmpty var displayName: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    /// requires_action · processing · succeeded · failed · refunded
    @DefaultEmpty var status: String
    let fund: String?
    let fundName: String?
    let accountName: String?
    /// Legacy raw provider — prefer `channel`.
    let method: String?
    /// FinanceChannel: card · mpesa · airtel · paypal · manual · onhand · bank · cheque · other
    @DefaultEmpty var channel: String
    /// app · website · admin
    @DefaultEmpty var source: String
    @DefaultEmpty var provider: String
    let providerRef: String?
    /// Online M-Pesa code, or the office receipt OR-YYYY-NNNNN.
    let receiptCode: String?
    let giverName: String?
    let giverPhone: String?
    let pledgeId: String?
    let pledgeTitle: String?
    let needId: String?
    let needTitle: String?
    let officeChannel: String?
    /// The M-Pesa code / cheque number / bank reference of an office gift.
    let officeReference: String?
    let recordedBy: String?
    let recordedByName: String?
    let reversedAt: String?
    let reversedBy: String?
    let reversedByName: String?
    let reversalReason: String?
    @DefaultEmpty var createdAt: String
    let settledAt: String?
    var id: String { transactionId }

    /// Who gave, as the page shows it (the server's display_name, with the
    /// same precedence as a fallback).
    var giverLabel: String {
        if !displayName.isEmpty { return displayName }
        for candidate in [fullName, giverName, giverPhone] { if let c = candidate, !c.isEmpty { return c } }
        return "Anonymous"
    }
    /// Recorded by the office (source admin).
    var isOffice: Bool { source == "admin" }
    /// Only a succeeded manual transaction (an office gift or a confirmed
    /// claim) can be reversed here — the server decides (422 otherwise).
    var looksReversible: Bool { provider == "manual" && status == "succeeded" && reversedAt == nil }
}

struct FinTransactionsPage: FinPaged {
    let data: [FinTransactionRow]
    let nextCursor: String?
    /// amount_minor = Σ succeeded amounts; count = every matching row (any status).
    let totals: [FinCurrencyTotal]
}

/// The register's filters (spec §4) — `query` feeds the list AND its CSV twin.
struct FinTransactionFilter: Equatable {
    var period: FinancePeriod? = .thisMonth
    var fund = ""
    /// requires_action · processing · succeeded · failed · refunded ("" = any)
    var status = ""
    /// FinanceChannel ("" = any)
    var channel = ""
    /// app · website · admin ("" = any)
    var source = ""
    var q = ""
    /// any · yes · no
    var pledged = "any"
    /// any · yes · no
    var need = "any"
    /// One member's transactions exactly (GET /admin/finance/transactions?user_id=).
    var userId: String? = nil

    var query: [String: String] {
        var out = period?.query ?? [:]
        if !fund.isEmpty { out["fund"] = fund }
        if !status.isEmpty { out["status"] = status }
        if !channel.isEmpty { out["channel"] = channel }
        if !source.isEmpty { out["source"] = source }
        if let term = FinanceERPAPI.searchTerm(q) { out["q"] = term }
        if pledged != "any", !pledged.isEmpty { out["pledged"] = pledged }
        if need != "any", !need.isEmpty { out["need"] = need }
        if let userId, !userId.isEmpty { out["user_id"] = userId }
        return out
    }
}

/// FinanceTransactionDetail's `transaction`: the row plus four detail fields.
/// Row fields read straight through (`detail.transaction.receiptCode`).
@dynamicMemberLookup
struct FinTransactionDetailRow: Decodable {
    let row: FinTransactionRow
    let stripePaymentIntent: String?
    let idempotencyKey: String?
    let scheduleId: String?
    let giverEmail: String?

    private enum K: String, CodingKey { case stripePaymentIntent, idempotencyKey, scheduleId, giverEmail }
    init(from decoder: Decoder) throws {
        row = try FinTransactionRow(from: decoder)
        let c = try decoder.container(keyedBy: K.self)
        stripePaymentIntent = try c.decodeIfPresent(String.self, forKey: .stripePaymentIntent)
        idempotencyKey = try c.decodeIfPresent(String.self, forKey: .idempotencyKey)
        scheduleId = try c.decodeIfPresent(String.self, forKey: .scheduleId)
        giverEmail = try c.decodeIfPresent(String.self, forKey: .giverEmail)
    }
    subscript<T>(dynamicMember keyPath: KeyPath<FinTransactionRow, T>) -> T { row[keyPath: keyPath] }
}

/// FinanceTransactionDetail — the transaction and EVERY posting it owns (the
/// original pair and, once reversed, the reversing pair).
struct FinTransactionDetail: Decodable {
    let transaction: FinTransactionDetailRow
    let ledgerEntries: [FinLedgerLeg]
}

// MARK: - Office gifts + reversal  (POST /admin/finance/gifts, /transactions/{id}/reverse)

/// BooksGiftInput. Exactly one giver mode: `userId` (a member), `giverName`
/// (a walk-in; `giverPhone` optional) or `anonymous: true`. Make ONE
/// `idempotencyKey` (UUID) per recording and reuse it on every retry — a
/// replay returns the booked gift (`reused`) and never takes a second receipt.
struct FinGiftInput: Encodable {
    var idempotencyKey: String
    var userId: String? = nil
    var giverName: String? = nil
    var giverPhone: String? = nil
    var anonymous: Bool = false
    /// Fund code — required unless a pledge (its own fund) or a need (its
    /// department's fund) decides.
    var fund: String? = nil
    var amountMinor: Int
    /// KES | USD
    var currency: String
    var channel: FinOfficeChannel
    /// office_reference — required for mpesa, cheque, bank.
    var reference: String? = nil
    /// YYYY-MM-DD (EAT), within [today − 366 days, today].
    var receivedOn: String
    var pledgeId: String? = nil
    var needId: String? = nil
    /// ≤ 60 characters; printed on the receipt as the gift's name.
    var note: String? = nil
}

/// BooksTransaction — a manual transaction as the books see it.
struct FinBooksTransaction: Decodable, Identifiable {
    struct PledgeRef: Decodable, Hashable { @DefaultEmpty var pledgeId: String; @DefaultEmpty var title: String }
    struct NeedRef: Decodable, Hashable { @DefaultEmpty var needId: String; @DefaultEmpty var title: String }
    let transactionId: String
    /// succeeded when recorded; refunded once reversed.
    @DefaultEmpty var status: String
    @DefaultEmpty var provider: String
    @DefaultEmpty var source: String
    /// Office gifts: the gapless OR-<year>-<5 digits>. Confirmed claims: null.
    let receiptCode: String?
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    let fund: FinFundRef?
    let channel: String?
    /// office_reference — the M-Pesa code (upper-cased), cheque number or bank reference.
    let reference: String?
    @DefaultEmpty var receivedOn: String
    @DefaultEmpty var createdAt: String
    let settledAt: String?
    let userId: String?
    let memberName: String?
    let giverName: String?
    let giverPhone: String?
    @DefaultFalse var anonymous: Bool
    let pledge: PledgeRef?
    let need: NeedRef?
    let note: String?
    let recordedBy: String?
    let recordedByName: String?
    let reversedAt: String?
    let reversedBy: String?
    let reversedByName: String?
    let reversalReason: String?
    /// Oldest first: the original pair, then (once reversed) the mirror pair.
    let ledger: [FinBooksLeg]
    var id: String { transactionId }
}

/// BooksGiftResult — the booked transaction plus the replay flag.
@dynamicMemberLookup
struct FinGiftResult: Decodable {
    let transaction: FinBooksTransaction
    let idempotencyKey: String
    /// true = a replay of the key; nothing new was posted.
    let reused: Bool

    private enum K: String, CodingKey { case idempotencyKey, reused }
    init(from decoder: Decoder) throws {
        transaction = try FinBooksTransaction(from: decoder)
        let c = try decoder.container(keyedBy: K.self)
        idempotencyKey = (try? c.decode(String.self, forKey: .idempotencyKey)) ?? ""
        reused = (try? c.decode(Bool.self, forKey: .reused)) ?? false
    }
    subscript<T>(dynamicMember keyPath: KeyPath<FinBooksTransaction, T>) -> T { transaction[keyPath: keyPath] }
}

// MARK: - Pledges  (GET /admin/finance/pledges)

/// FinancePledgeRow — one pledge, evaluated by the instalment ledger.
struct FinPledgeRow: Decodable, Hashable, Identifiable {
    let pledgeId: String
    @DefaultEmpty var userId: String
    @DefaultEmpty var memberName: String
    let memberPhone: String?
    @DefaultEmpty var title: String
    /// monthly | total
    @DefaultEmpty var shape: String
    /// A monthly pledge's instalment.
    @LooseOptInt var amountMinor: Int?
    /// A total pledge's target.
    @LooseOptInt var targetMinor: Int?
    @DefaultEmpty var currency: String
    /// active · paused · fulfilled · cancelled
    @DefaultEmpty var status: String
    /// on_track · behind · fulfilled · paused (as of today)
    @DefaultEmpty var standing: String
    @LooseInt var year: Int
    @LooseInt var pledgedYearMinor: Int
    @LooseInt var paidYearMinor: Int
    @LooseInt var remainingYearMinor: Int
    @LooseInt var paidTotalMinor: Int
    @LooseInt var kept: Int
    @LooseInt var dueCount: Int
    let nextDue: String?
    let overdueSince: String?
    @LooseOptInt var dueDay: Int?
    let dueOn: String?
    @DefaultEmpty var createdAt: String
    let paysTo: FinFundRef?
    var id: String { pledgeId }
}

/// FinancePledgeTotal — `amount_minor` = pledged. pledged = paid_toward +
/// remaining and paid = paid_toward + paid_beyond (verification cycle 1: a
/// cancelled pledge paid this year has pledged 0, so paid alone cannot foot).
struct FinPledgeTotal: Decodable, Hashable, FinCurrencyTotaled {
    @DefaultEmpty var currency: String
    @LooseInt var amountMinor: Int
    @LooseInt var count: Int
    @LooseInt var pledgedMinor: Int
    @LooseInt var paidMinor: Int
    @LooseInt var remainingMinor: Int
    /// Σ min(paid_year, pledged_year) — paid toward this year's promises.
    @LooseInt var paidTowardMinor: Int
    /// Σ max(paid_year − pledged_year, 0) — paid beyond them (a cancelled pledge, or paid ahead).
    @LooseInt var paidBeyondMinor: Int
}

struct FinPledgesPage: FinPaged {
    @LooseInt var year: Int
    let data: [FinPledgeRow]
    let nextCursor: String?
    let totals: [FinPledgeTotal]
}

struct FinPledgeFilter: Equatable {
    /// nil = the current year (EAT).
    var year: Int? = nil
    /// active · paused · fulfilled · cancelled ("" = any)
    var status = ""
    /// on_track · behind ("" = any)
    var standing = ""
    /// monthly · total ("" = any)
    var shape = ""
    var q = ""
    /// One member's pledges exactly (GET /admin/finance/pledges?user_id=) — no namesakes.
    var userId: String? = nil

    var query: [String: String] {
        var out: [String: String] = [:]
        if let year { out["year"] = String(year) }
        if !status.isEmpty { out["status"] = status }
        if !standing.isEmpty { out["standing"] = standing }
        if !shape.isEmpty { out["shape"] = shape }
        if let term = FinanceERPAPI.searchTerm(q) { out["q"] = term }
        if let userId, !userId.isEmpty { out["user_id"] = userId }
        return out
    }
}

// MARK: - Funds  (GET /admin/finance/funds · POST / PATCH /funds · POST /transfers)

/// FinanceFundRow — a fund with its balances and movement.
struct FinFundRow: Decodable, Hashable, Identifiable {
    struct Income: Decodable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var periodMinor: Int
        @LooseInt var ytdMinor: Int
    }
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    let nameSw: String?
    @DefaultFalse var isActive: Bool
    let description: String?
    @LooseInt var sort: Int
    /// credits − debits on fund:<code>, all time, per currency.
    let balances: [FinCurrencyBalance]
    let income: [Income]
    let expensesYtd: [FinCurrencyAmount]
    let transfersInYtd: [FinCurrencyAmount]
    let transfersOutYtd: [FinCurrencyAmount]
    let lastActivityAt: String?
    var id: String { code }
}

struct FinFundsPage: FinPaged {
    struct Period: Decodable {
        @DefaultEmpty var from: String
        @DefaultEmpty var to: String
        @DefaultEmpty var ytdFrom: String
    }
    let period: Period
    let data: [FinFundRow]
    /// Funds are one page — always null.
    let nextCursor: String?
    /// Σ balances per currency; count = funds holding that currency.
    let totals: [FinCurrencyTotal]
}

/// BooksFund — what fund writes return.
struct FinFund: Decodable, Hashable, Identifiable {
    let fundId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    let nameSw: String?
    let description: String?
    @LooseInt var sort: Int
    @DefaultFalse var isActive: Bool
    var id: String { fundId }
}

/// BooksFundInput — `code` is a permanent slug `^[a-z][a-z0-9-]{1,39}$`.
struct FinFundInput: Encodable {
    var code: String
    var name: String
    var nameSw: String? = nil
    var description: String? = nil
    var sort: Int? = nil
    var isActive: Bool? = nil
}

/// BooksFundPatch — at least one field; the code never changes.
struct FinFundPatch: Encodable {
    var name: String? = nil
    var nameSw: FinNullable<String> = .keep
    var description: FinNullable<String> = .keep
    var sort: Int? = nil
    var isActive: Bool? = nil

    /// The server refuses an empty patch (400).
    var isEmpty: Bool { name == nil && nameSw.isKeep && description.isKeep && sort == nil && isActive == nil }

    private enum CodingKeys: String, CodingKey { case name, nameSw, description, sort, isActive }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(name, forKey: .name)
        try c.encode(nameSw, forKey: .nameSw)
        try c.encode(description, forKey: .description)
        try c.encodeIfPresent(sort, forKey: .sort)
        try c.encodeIfPresent(isActive, forKey: .isActive)
    }
}

/// BooksTransferInput (finance:approve). The from-fund may not go below zero
/// in that currency unless `allowNegative` (422 details.reason NEGATIVE_BALANCE).
struct FinTransferInput: Encodable {
    var fromFund: String
    var toFund: String
    var amountMinor: Int
    var currency: String
    /// YYYY-MM-DD (EAT), within [today − 366 days, today].
    var occurredOn: String
    /// 3–300 characters.
    var memo: String
    var allowNegative: Bool = false
    /// Optional; a retry with the same key is a replay, never a second transfer.
    var idempotencyKey: String? = nil
}

/// BooksTransfer.
struct FinTransfer: Decodable, Identifiable {
    let transferId: String
    @DefaultEmpty var journalId: String
    let fromFund: FinFundRef
    let toFund: FinFundRef
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var occurredOn: String
    @DefaultEmpty var memo: String
    let createdBy: String?
    @DefaultEmpty var createdAt: String
    /// The from-fund's balance right after (may be negative with allowNegative).
    @LooseInt var fromBalanceAfterMinor: Int
    let reversedByJournalId: String?
    @DefaultFalse var reused: Bool
    let ledger: [FinBooksLeg]
    var id: String { transferId }
}

// MARK: - Ledger  (GET /admin/finance/ledger · /trial-balance)

/// FinanceLedgerRow — one posting (transaction or journal) with its owner.
struct FinLedgerRow: Decodable, Hashable, Identifiable {
    let entryId: String
    /// transaction | journal
    @DefaultEmpty var kind: String
    let transactionId: String?
    let journalId: String?
    @DefaultEmpty var account: String
    /// debit | credit
    @DefaultEmpty var side: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var createdAt: String
    /// The EAT date every ledger view reads (filters, trial balance, settlement).
    @DefaultEmpty var postedOn: String
    let receiptCode: String?
    let userId: String?
    /// The transaction's display name; null on a journal posting.
    let memberName: String?
    let transactionStatus: String?
    /// expense · expense_void · transfer · opening · reversal (null on a transaction posting)
    let journalKind: String?
    let memo: String?
    var id: String { entryId }
}

/// FinanceLedgerTotal — amount_minor = debit − credit (0 over a balanced, unfiltered ledger).
struct FinLedgerTotal: Decodable, Hashable, FinCurrencyTotaled {
    @DefaultEmpty var currency: String
    @LooseInt var amountMinor: Int
    @LooseInt var count: Int
    @LooseInt var debitMinor: Int
    @LooseInt var creditMinor: Int
}

struct FinLedgerPage: FinPaged {
    let data: [FinLedgerRow]
    let nextCursor: String?
    let totals: [FinLedgerTotal]
}

struct FinLedgerFilter: Equatable {
    var period: FinancePeriod? = .thisMonth
    /// An exact account (fund:tithe) or a prefix ending in ':' (cash:).
    var account = ""
    /// transaction | journal ("" = both)
    var kind = ""

    var query: [String: String] {
        var out = period?.query ?? [:]
        let a = account.trimmingCharacters(in: .whitespaces)
        if !a.isEmpty { out["account"] = a }
        if !kind.isEmpty { out["kind"] = kind }
        return out
    }
}

/// FinanceTrialBalance.
struct FinTrialBalance: Decodable {
    struct Period: Decodable { let from: String?; let to: String? }
    struct Row: Decodable, Hashable, Identifiable {
        @DefaultEmpty var account: String
        @DefaultEmpty var currency: String
        @LooseInt var debitMinor: Int
        @LooseInt var creditMinor: Int
        /// On the account's normal side.
        @LooseInt var balanceMinor: Int
        /// debit | credit
        @DefaultEmpty var normalSide: String
        var id: String { "\(account)|\(currency)" }
    }
    struct Total: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        @LooseInt var debitMinor: Int
        @LooseInt var creditMinor: Int
        @DefaultFalse var balanced: Bool
        var id: String { currency }
    }
    let period: Period
    let data: [Row]
    let totals: [Total]
    /// Every currency balances.
    @DefaultFalse var balanced: Bool
}

// MARK: - Reconciliation  (GET /admin/finance/reconciliation)

struct FinReconciliation: Decodable {
    struct Period: Decodable { @DefaultEmpty var from: String; @DefaultEmpty var to: String }
    /// Newest day first; within a day by channel, then currency.
    struct Settlement: Decodable, Hashable, Identifiable {
        @DefaultEmpty var day: String
        @DefaultEmpty var channel: String
        @DefaultEmpty var account: String
        @DefaultEmpty var currency: String
        @LooseInt var count: Int
        @LooseInt var receivedMinor: Int
        @LooseInt var reversedCount: Int
        @LooseInt var reversedMinor: Int
        /// received − reversed.
        @LooseInt var amountMinor: Int
        var id: String { "\(day)|\(account)|\(currency)" }
    }
    struct Exception: Decodable, Hashable, Identifiable {
        /// stale_processing · failed · succeeded_without_ledger · unbalanced_transaction ·
        /// refunded_without_reversal · duplicate_receipt · unbalanced_journal
        @DefaultEmpty var kind: String
        let transactionId: String?
        let journalId: String?
        @LooseOptInt var amountMinor: Int?
        let currency: String?
        let at: String?
        @DefaultEmpty var detail: String
        var id: String { "\(kind)|\(transactionId ?? journalId ?? detail)" }
    }
    struct ExceptionCounts: Decodable, Hashable {
        @LooseInt var staleProcessing: Int
        @LooseInt var failed: Int
        @LooseInt var succeededWithoutLedger: Int
        @LooseInt var unbalancedTransaction: Int
        @LooseInt var refundedWithoutReversal: Int
        @LooseInt var duplicateReceipt: Int
        @LooseInt var unbalancedJournal: Int
    }
    struct Integrity: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        @LooseInt var debitMinor: Int
        @LooseInt var creditMinor: Int
        @DefaultFalse var balanced: Bool
        var id: String { currency }
    }
    let period: Period
    let settlement: [Settlement]
    let exceptions: [Exception]
    let exceptionCounts: ExceptionCounts
    let integrity: [Integrity]
}

// MARK: - Reports  (GET /admin/finance/reports/*)

/// FinanceReportMatrix — rows × 12 months per currency (income or expenses).
struct FinReportMatrix: Decodable {
    struct Row: Decodable, Hashable, Identifiable {
        /// fund code / channel / source / category code; `none` when absent.
        @DefaultEmpty var key: String
        @DefaultEmpty var label: String
        /// January first.
        @LooseInts var months: [Int]
        @LooseInt var totalMinor: Int
        var id: String { key }
    }
    struct Totals: Decodable, Hashable {
        @LooseInts var months: [Int]
        @LooseInt var totalMinor: Int
    }
    struct Currency: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        /// Largest total first.
        let rows: [Row]
        let totals: Totals
        var id: String { currency }
    }
    /// income | expenses
    @DefaultEmpty var report: String
    @LooseInt var year: Int
    /// fund · channel · source · category
    @DefaultEmpty var by: String
    /// KES first, then A–Z; only currencies with data (KES always present).
    let currencies: [Currency]
}

/// FinancePledgesReport — per currency and month.
struct FinPledgesReport: Decodable {
    struct Month: Decodable, Hashable, Identifiable {
        @LooseInt var month: Int                    // 1…12
        @LooseInt var pledgedMinor: Int
        @LooseInt var paidMinor: Int
        @LooseInt var kept: Int
        @LooseInt var missed: Int
        @LooseInt var behindPartners: Int
        var id: Int { month }
    }
    struct Totals: Decodable, Hashable {
        @LooseInt var pledgedMinor: Int
        @LooseInt var paidMinor: Int
        @LooseInt var kept: Int
        @LooseInt var missed: Int
        @LooseInt var behindPartners: Int
    }
    struct Currency: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        let months: [Month]
        let totals: Totals
        var id: String { currency }
    }
    @LooseInt var year: Int
    let currencies: [Currency]
}

/// FinanceAccountBalance.
struct FinAccountBalance: Decodable, Hashable, Identifiable {
    @DefaultEmpty var account: String
    @DefaultEmpty var label: String
    @LooseInt var balanceMinor: Int
    var id: String { account }
}

/// A fund:* line of the financial position (FinanceAccountBalance + code).
struct FinFundAccountBalance: Decodable, Hashable, Identifiable {
    @DefaultEmpty var account: String
    @DefaultEmpty var label: String
    @LooseInt var balanceMinor: Int
    @DefaultEmpty var code: String
    var id: String { account }
}

/// FinanceFinancialPosition — as of a date, per currency.
struct FinFinancialPosition: Decodable {
    struct Totals: Decodable, Hashable {
        @LooseInt var assetsMinor: Int
        @LooseInt var fundsMinor: Int
        @LooseInt var otherMinor: Int
    }
    struct Currency: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        /// cash:* accounts, debits − credits.
        let assets: [FinAccountBalance]
        /// fund:* accounts, credits − debits.
        let funds: [FinFundAccountBalance]
        /// Every other account (sales:media, …), credits − debits.
        let other: [FinAccountBalance]
        let totals: Totals
        /// assets = funds + other.
        @DefaultFalse var balanced: Bool
        var id: String { currency }
    }
    @DefaultEmpty var asOf: String
    let currencies: [Currency]
    @DefaultFalse var balanced: Bool
}

/// FinanceStatementLine.
struct FinStatementLine: Decodable, Hashable, Identifiable {
    /// Fund code, account, or expense category code.
    @DefaultEmpty var key: String
    @DefaultEmpty var label: String
    @LooseInt var amountMinor: Int
    var id: String { key }
}

/// FinanceIncomeExpenditure — a period, per currency.
struct FinIncomeExpenditure: Decodable {
    struct Period: Decodable { @DefaultEmpty var from: String; @DefaultEmpty var to: String }
    struct Totals: Decodable, Hashable {
        @LooseInt var giftsMinor: Int
        @LooseInt var otherIncomeMinor: Int
        /// gifts + other income.
        @LooseInt var incomeMinor: Int
        @LooseInt var expensesMinor: Int
        /// income − expenses (negative = deficit).
        @LooseInt var surplusMinor: Int
    }
    struct Currency: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        /// Per fund: gifts net of reversals.
        let income: [FinStatementLine]
        let otherIncome: [FinStatementLine]
        /// Per expense category.
        let expenses: [FinStatementLine]
        let totals: Totals
        var id: String { currency }
    }
    let period: Period
    let currencies: [Currency]
}

// MARK: - Statements  (GET /admin/finance/statements · the member PDFs)

/// FinanceStatementRow — a member who gave in the year.
struct FinStatementRow: Decodable, Hashable, Identifiable {
    struct FundLine: Decodable, Hashable {
        @DefaultEmpty var code: String
        @DefaultEmpty var name: String
        @DefaultEmpty var currency: String
        @LooseInt var amountMinor: Int
    }
    let userId: String
    @DefaultEmpty var fullName: String
    let phone: String?
    let email: String?
    /// Succeeded gifts in the year, every currency.
    @LooseInt var gifts: Int
    let totals: [FinCurrencyTotal]
    let byFund: [FundLine]
    /// The part of the year's giving that was toward a pledge.
    let pledgePaid: [FinCurrencyAmount]
    @DefaultEmpty var lastGiftAt: String
    var id: String { userId }
}

struct FinStatementsPage: FinPaged {
    @LooseInt var year: Int
    let data: [FinStatementRow]
    let nextCursor: String?
    /// count = gifts.
    let totals: [FinCurrencyTotal]
}

// MARK: - Audit  (GET /admin/finance/audit)

/// FinanceAuditRow.
struct FinAuditRow: Decodable, Hashable, Identifiable {
    @LooseInt var auditId: Int
    let actorId: String?
    let actorName: String?
    @DefaultEmpty var action: String
    @DefaultEmpty var entity: String
    let entityId: String?
    /// Arbitrary JSON (keys exactly as sent).
    let metadata: [String: FinJSON]?
    @DefaultEmpty var occurredAt: String
    /// System | Admin
    @DefaultEmpty var actorType: String
    var id: Int { auditId }
}

/// FinanceAuditPage — keyset-paged, no totals.
struct FinAuditPage: FinPaged {
    let data: [FinAuditRow]
    let nextCursor: String?
    var totals: [FinCurrencyTotal] { [] }

    private enum CodingKeys: String, CodingKey { case data, nextCursor }
}

struct FinAuditFilter: Equatable {
    var period: FinancePeriod? = nil
    /// Must start with a finance prefix: giving. · purchase. · finance. · webhook. ·
    /// pledge. · department.need · expense. · budget. · journal. · fund.
    var actionPrefix = ""
    /// All · System · Admin · a user id ("" = All)
    var actor = ""

    var query: [String: String] {
        var out = period?.query ?? [:]
        if !actionPrefix.isEmpty { out["action_prefix"] = actionPrefix }
        if !actor.isEmpty { out["actor"] = actor }
        return out
    }
}

// MARK: - Settings  (GET /admin/finance/settings)

struct FinSettings: Decodable {
    struct Provider: Decodable, Hashable, Identifiable {
        /// stripe · mpesa · airtel · paypal
        @DefaultEmpty var key: String
        @DefaultEmpty var label: String
        @DefaultFalse var configured: Bool
        /// Environment variable NAMES only — never values.
        let env: [String]
        var id: String { key }
    }
    struct ReceiptCounter: Decodable, Hashable {
        @LooseInt var year: Int
        @LooseInt var next: Int
        /// e.g. OR-2026-00001
        @DefaultEmpty var nextReceipt: String
    }
    struct GivingTier: Decodable, Hashable, Identifiable {
        @LooseInt var amountMinor: Int
        @DefaultEmpty var currency: String
        @LooseInt var disciplesPerYear: Int
        @DefaultEmpty var meaning: String
        var id: String { "\(currency)|\(amountMinor)" }
    }
    struct ReminderPolicy: Decodable, Hashable {
        @LooseInt var dueSoonDays: Int
        @LooseInt var dueWindowDays: Int
        @LooseInt var followUpHours: Int
        @LooseInt var followUps: Int
        @LooseInt var inFlightMinutes: Int
        let text: [String]
    }
    let providers: [Provider]
    let receiptCounter: ReceiptCounter
    let givingTiers: [GivingTier]
    @LooseInt var costPerDiscipleMinor: Int
    let reminderPolicy: ReminderPolicy
}

// MARK: - Department needs, for Finance  (GET /admin/finance/needs)

/// FinanceNeedRow — target vs raised (the Departments page's own figure).
struct FinNeedRow: Decodable, Hashable, Identifiable {
    let needId: String
    @DefaultEmpty var title: String
    @DefaultEmpty var why: String
    @DefaultEmpty var departmentId: String
    @DefaultEmpty var departmentName: String
    /// The department's fund when active — where a gift to the need is booked.
    let fundCode: String?
    @LooseInt var targetMinor: Int
    @LooseInt var raisedMinor: Int
    @LooseInt var giftsCount: Int
    @DefaultEmpty var currency: String
    let deadline: String?
    /// pending · approved · rejected · closed
    @DefaultEmpty var status: String
    @DefaultEmpty var createdAt: String
    let decidedAt: String?
    var id: String { needId }
}

/// FinanceNeedTotal — amount_minor = raised.
struct FinNeedTotal: Decodable, Hashable, FinCurrencyTotaled {
    @DefaultEmpty var currency: String
    @LooseInt var amountMinor: Int
    @LooseInt var count: Int
    @LooseInt var targetMinor: Int
    @LooseInt var raisedMinor: Int
}

struct FinNeedsPage: FinPaged {
    let data: [FinNeedRow]
    let nextCursor: String?
    let totals: [FinNeedTotal]
}

// MARK: - Trend  (GET /admin/finance/trend — FinanceTrend)

struct FinTrendPoint: Decodable, Hashable, Identifiable {
    /// "Sep"
    @DefaultEmpty var m: String
    /// The month's first instant.
    @DefaultEmpty var month: String
    @LooseInt var totalMinor: Int
    var id: String { month.isEmpty ? m : month }
}

struct FinTrend: Decodable {
    struct Series: Decodable, Hashable, Identifiable {
        @DefaultEmpty var currency: String
        let points: [FinTrendPoint]
        var id: String { currency }
    }
    /// Back-compat: the KES series only.
    let data: [FinTrendPoint]
    /// The currency `data` is in.
    @DefaultEmpty var currency: String
    /// One zero-filled series per currency present (KES always).
    let series: [Series]
}

// MARK: - Expenses  (GET/POST /admin/finance/expenses …)

/// BooksExpense.
struct FinExpense: Decodable, Hashable, Identifiable {
    let expenseId: String
    let fund: FinFundRef
    let category: FinCategoryRef
    @DefaultEmpty var payee: String
    let description: String?
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var spentOn: String
    /// onhand · bank · cheque · mpesa · other
    @DefaultEmpty var channel: String
    let reference: String?
    /// recorded · approved · void
    @DefaultEmpty var status: String
    let recordedBy: String?
    let recordedByName: String?
    @DefaultEmpty var recordedAt: String
    let approvedBy: String?
    let approvedByName: String?
    let approvedAt: String?
    let voidedBy: String?
    let voidedByName: String?
    let voidedAt: String?
    let voidReason: String?
    /// The expense journal posted on approval.
    let journalId: String?
    /// The expense_void journal posted when an APPROVED expense is voided.
    let voidJournalId: String?
    var id: String { expenseId }
}

/// BooksExpenseInput (finance:manage) — recorded only; nothing posts until a
/// different person approves.
struct FinExpenseInput: Encodable {
    /// Active fund code.
    var fund: String
    /// Active expense category code.
    var category: String
    /// 2–120 characters.
    var payee: String
    var description: String? = nil
    var amountMinor: Int
    var currency: String
    /// YYYY-MM-DD (EAT), within [today − 366 days, today].
    var spentOn: String
    var channel: FinOfficeChannel
    var reference: String? = nil
}

/// BooksExpensePatch — while recorded only; the editor becomes one of its makers.
struct FinExpensePatch: Encodable {
    var fund: String? = nil
    var category: String? = nil
    var payee: String? = nil
    var description: FinNullable<String> = .keep
    var amountMinor: Int? = nil
    var currency: String? = nil
    var spentOn: String? = nil
    var channel: FinOfficeChannel? = nil
    var reference: FinNullable<String> = .keep

    var isEmpty: Bool {
        fund == nil && category == nil && payee == nil && description.isKeep && amountMinor == nil
            && currency == nil && spentOn == nil && channel == nil && reference.isKeep
    }

    private enum CodingKeys: String, CodingKey {
        case fund, category, payee, description, amountMinor, currency, spentOn, channel, reference
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(fund, forKey: .fund)
        try c.encodeIfPresent(category, forKey: .category)
        try c.encodeIfPresent(payee, forKey: .payee)
        try c.encode(description, forKey: .description)
        try c.encodeIfPresent(amountMinor, forKey: .amountMinor)
        try c.encodeIfPresent(currency, forKey: .currency)
        try c.encodeIfPresent(spentOn, forKey: .spentOn)
        try c.encodeIfPresent(channel, forKey: .channel)
        try c.encode(reference, forKey: .reference)
    }
}

/// BooksExpenseList.
struct FinExpenseList: FinPaged {
    struct StatusTotal: Decodable, Hashable, Identifiable {
        /// recorded · approved · void
        @DefaultEmpty var status: String
        @DefaultEmpty var currency: String
        @LooseInt var amountMinor: Int
        @LooseInt var count: Int
        var id: String { "\(status)|\(currency)" }
    }
    let data: [FinExpense]
    let nextCursor: String?
    /// Per currency over the WHOLE filtered set (every status in the filter).
    let totals: [FinCurrencyTotal]
    /// The same set by status and currency.
    let totalsByStatus: [StatusTotal]
}

struct FinExpenseFilter: Equatable {
    var period: FinancePeriod? = .thisMonth
    /// One status or a comma list of recorded | approved | void ("" = all).
    var status = ""
    var fund = ""
    var category = ""
    var q = ""

    var query: [String: String] {
        var out = period?.query ?? [:]
        if !status.isEmpty { out["status"] = status }
        if !fund.isEmpty { out["fund"] = fund }
        if !category.isEmpty { out["category"] = category }
        if let term = FinanceERPAPI.searchTerm(q) { out["q"] = term }
        return out
    }
}

/// BooksExpenseCategory.
struct FinExpenseCategory: Decodable, Hashable, Identifiable {
    let categoryId: String
    @DefaultEmpty var code: String
    @DefaultEmpty var name: String
    @DefaultFalse var isActive: Bool
    @LooseInt var sort: Int
    var id: String { categoryId }
}

/// BooksExpenseCategoryInput — `code` is a permanent slug.
struct FinExpenseCategoryInput: Encodable {
    var code: String
    /// 2–60 characters.
    var name: String
    var sort: Int? = nil
    var isActive: Bool? = nil
}

/// BooksExpenseCategoryPatch — at least one field.
struct FinExpenseCategoryPatch: Encodable {
    var name: String? = nil
    var sort: Int? = nil
    var isActive: Bool? = nil
    var isEmpty: Bool { name == nil && sort == nil && isActive == nil }
}

// MARK: - Budgets  (/admin/finance/budgets …) — KES only

/// BooksBudget.
struct FinBudget: Decodable, Hashable, Identifiable {
    let budgetId: String
    @LooseInt var year: Int
    @DefaultEmpty var name: String
    /// draft | approved
    @DefaultEmpty var status: String
    /// Always KES.
    @DefaultEmpty var currency: String
    let createdBy: String?
    let createdByName: String?
    @DefaultEmpty var createdAt: String
    let approvedBy: String?
    let approvedByName: String?
    let approvedAt: String?
    @LooseInt var lineCount: Int
    @LooseInt var incomeTotalMinor: Int
    @LooseInt var expenseTotalMinor: Int
    var id: String { budgetId }
}

/// BooksBudgetLine.
struct FinBudgetLine: Decodable, Hashable, Identifiable {
    let lineId: String
    /// income | expense
    @DefaultEmpty var kind: String
    /// Always set on income lines; optional on expense lines.
    let fund: FinFundRef?
    /// Expense lines only.
    let category: FinCategoryRef?
    @DefaultEmpty var label: String
    /// January → December (12 values).
    @LooseInts var monthlyMinor: [Int]
    @LooseInt var totalMinor: Int
    var id: String { lineId }
}

/// BooksBudgetDetail — a budget with its lines (income first).
@dynamicMemberLookup
struct FinBudgetDetail: Decodable {
    let budget: FinBudget
    let lines: [FinBudgetLine]

    private enum K: String, CodingKey { case lines }
    init(from decoder: Decoder) throws {
        budget = try FinBudget(from: decoder)
        lines = try decoder.container(keyedBy: K.self).decode([FinBudgetLine].self, forKey: .lines)
    }
    subscript<T>(dynamicMember keyPath: KeyPath<FinBudget, T>) -> T { budget[keyPath: keyPath] }
}

/// BooksBudgetLinesInput's line: income lines name a fund; expense lines name
/// a category (and optionally a fund). 12 non-negative KES amounts, Jan → Dec.
struct FinBudgetLineInput: Encodable, Hashable {
    /// income | expense
    var kind: String
    var fund: String? = nil
    var category: String? = nil
    /// 2–80 characters.
    var label: String
    var monthlyMinor: [Int]
}

/// Budget vs actual per line and month (KES).
struct FinBudgetActuals: Decodable {
    struct Line: Decodable, Hashable, Identifiable {
        let lineId: String
        /// income | expense
        @DefaultEmpty var kind: String
        @DefaultEmpty var label: String
        let fund: FinFundRef?
        let category: FinCategoryRef?
        @LooseInts var budgetMinor: [Int]
        @LooseInts var actualMinor: [Int]
        /// actual − budget per month (positive = above budget).
        @LooseInts var varianceMinor: [Int]
        @LooseInt var budgetTotalMinor: Int
        @LooseInt var actualTotalMinor: Int
        @LooseInt var varianceTotalMinor: Int
        var id: String { lineId }
    }
    struct Total: Decodable, Hashable, Identifiable {
        /// income | expense (exactly two rows: income, then expense)
        @DefaultEmpty var kind: String
        @LooseInts var budgetMinor: [Int]
        @LooseInts var actualMinor: [Int]
        @LooseInts var varianceMinor: [Int]
        @LooseInt var budgetTotalMinor: Int
        @LooseInt var actualTotalMinor: Int
        @LooseInt var varianceTotalMinor: Int
        /// Actual money of that kind no line covers.
        @LooseInts var unbudgetedMinor: [Int]
        @LooseInt var unbudgetedTotalMinor: Int
        var id: String { kind }
    }
    let budget: FinBudget
    @LooseInt var year: Int
    @DefaultEmpty var currency: String
    /// YYYY-MM, January → December.
    let months: [String]
    let lines: [Line]
    let totals: [Total]
}

// MARK: - Opening balances + journals  (/admin/finance/opening-balances, /journals …)

/// BooksOpeningBalanceInput (finance:approve). One journal per (channel, fund,
/// currency); a wrong one is corrected by reversing it and posting the right one.
struct FinOpeningBalanceInput: Encodable {
    var idempotencyKey: String
    var channel: FinOfficeChannel
    var fund: String
    /// ≤ 1,000,000,000,000 minor.
    var amountMinor: Int
    var currency: String
    /// YYYY-MM-DD (EAT), within [today − 3660 days, today].
    var asOf: String
    /// 3–300 characters.
    var memo: String
}

/// BooksJournal — a posting that is not a giving transaction.
struct FinJournal: Decodable, Hashable, Identifiable {
    let journalId: String
    /// expense · expense_void · transfer · opening · reversal
    @DefaultEmpty var kind: String
    let memo: String?
    /// The economic date.
    @DefaultEmpty var occurredOn: String
    /// When it was entered.
    @DefaultEmpty var createdAt: String
    let createdBy: String?
    let createdByName: String?
    let refId: String?
    /// kind reversal: the journal it mirrors.
    let reversalOf: String?
    /// The reversal that undid this one, if any.
    let reversedByJournalId: String?
    /// Debit first.
    let legs: [FinBooksLeg]
    /// The journal's amount per currency.
    let totals: [FinCurrencyAmount]
    var id: String { journalId }
    /// Transfers and opening balances can be reversed (finance:approve);
    /// expense journals are undone by voiding the expense.
    var looksReversible: Bool { (kind == "transfer" || kind == "opening") && reversedByJournalId == nil }
}

/// BooksJournalResult — the journal plus the replay flag.
@dynamicMemberLookup
struct FinJournalResult: Decodable {
    let journal: FinJournal
    /// true = a replay of the idempotency_key; nothing new was posted.
    let reused: Bool

    private enum K: String, CodingKey { case reused }
    init(from decoder: Decoder) throws {
        journal = try FinJournal(from: decoder)
        reused = (try? decoder.container(keyedBy: K.self).decode(Bool.self, forKey: .reused)) ?? false
    }
    subscript<T>(dynamicMember keyPath: KeyPath<FinJournal, T>) -> T { journal[keyPath: keyPath] }
}

/// BooksJournalList.
struct FinJournalList: FinPaged {
    let data: [FinJournal]
    let nextCursor: String?
    /// amount = Σ debit legs, count = journals.
    let totals: [FinCurrencyTotal]
}

struct FinJournalFilter: Equatable {
    var period: FinancePeriod? = nil
    /// One kind or a comma list of expense · expense_void · transfer · opening · reversal ("" = all).
    var kind = ""

    var query: [String: String] {
        var out = period?.query ?? [:]
        if !kind.isEmpty { out["kind"] = kind }
        return out
    }
}

/// BooksJournalReverseInput.
struct FinJournalReverseInput: Encodable {
    /// 5–300 characters; becomes the reversal's memo.
    var reason: String
    var allowNegative: Bool = false
}

// MARK: - Existing reads the pages reuse (no response schema in openapi.yaml)

/// GET /admin/finance/config — typed from financial/index.ts (funds + provider
/// availability; no secrets).
struct FinConfig: Decodable {
    struct Provider: Codable, Hashable, Identifiable {
        @DefaultEmpty var key: String
        @DefaultEmpty var label: String
        @DefaultFalse var enabled: Bool
        var id: String { key }
    }
    @DefaultEmptyList var funds: [FundOption]
    @DefaultEmptyList var providers: [Provider]
    @DefaultFalse var stepUpRequired: Bool
}

/// A row of GET /admin/finance/schedules — typed from service.ts
/// listSchedulesAdmin (the YAML documents the query, not the row).
struct FinSchedule: Decodable, Hashable, Identifiable {
    let scheduleId: String
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let phoneNumber: String?
    @DefaultEmpty var fund: String
    @LooseInt var amountMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var frequency: String
    let method: String?
    /// active · paused · cancelled
    @DefaultEmpty var status: String
    let nextRunAt: String?
    let lastRunAt: String?
    @LooseInt var consecutiveFailures: Int
    /// The provider's raw words — detail only; `lastFailure` is what the member was told.
    let lastError: String?
    let lastFailedAt: String?
    let pausedAt: String?
    let createdAt: String?
    /// The server's ONE rule (Giving Cycle 7, constants.ts SCHEDULE_ATTENTION_SQL):
    /// failing, stopped after failed prompts, or our own last prompt could not
    /// be sent — never a member's own pause or one that follows a paused pledge.
    @DefaultFalse var needsAttention: Bool

    // Giving Cycle 7 — every one optional, so an older server still decodes.
    /// The fund's name, from the register itself.
    let fundName: String?
    /// Why it is failing, in the words the member was told; nil when it is not.
    let lastFailure: FinGiftFailure?
    /// Our side, not theirs: the last prompt could not be SENT (M-Pesa down or
    /// unconfigured). The giver was not told — only the office can know.
    let officeAlert: String?
    /// failures · member · pledge — why a paused gift is paused (nil on an
    /// older row reads as failures).
    let pauseReason: String?
    /// A member's pause ends on this Nairobi day (YYYY-MM-DD).
    let resumeOn: String?
    /// The member's heads-up before each prompt.
    let headsUp: Bool?
    /// The schedule's own number to prompt; nil = the member's profile number.
    let promptNumber: String?
    let retryAt: String?
    /// The pledge this gift collects, when it collects one.
    let pledge: FinSchedulePledge?
    /// What the next prompt will ask: below amount_minor when its pledge is
    /// part paid, 0 when it is already paid (the prompt is skipped), nil when
    /// nothing is coming.
    @LooseOptInt var nextAmountMinor: Int?

    var id: String { scheduleId }
}

/// GiftFailure — a failed prompt in the words the member was told
/// (financial/giftFailure.ts: what happened, and what to do next). Also on
/// the partner detail's schedules (PartnerSchedule).
struct FinGiftFailure: Codable, Hashable {
    let code: String?
    @DefaultEmpty var reason: String
    @DefaultEmpty var hint: String
    let retryable: Bool?
}

/// The pledge a recurring gift collects: `{pledge_id, title}`.
struct FinSchedulePledge: Decodable, Hashable {
    @DefaultEmpty var pledgeId: String
    @DefaultEmpty var title: String
}

/// What the office may do to a member's recurring gift AT THE MEMBER'S
/// REQUEST (Giving Cycle 7) — POST /admin/finance/schedules/{id}/{action}.
enum FinScheduleOfficeAction: String, CaseIterable, Identifiable {
    case pause, resume, cancel
    var id: String { rawValue }
}

/// OfficeScheduleAction — `{note, resume_on?}`. The note is the member's
/// request in a line (3–300 after trimming, audited); `resume_on` only ever
/// goes with a pause (a Nairobi day, tomorrow to a year ahead). A nil
/// `resumeOn` is left out of the JSON, which the route's `.nullish()` accepts.
struct FinScheduleActionBody: Encodable, Equatable {
    let note: String
    let resumeOn: String?

    static let noteMin = 3
    static let noteMax = 300

    /// The body for `action`: the note trimmed; `until` kept for a pause only.
    static func make(_ action: FinScheduleOfficeAction, note: String, until: String?) -> FinScheduleActionBody {
        let day = until?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return FinScheduleActionBody(note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                                     resumeOn: action == .pause && !day.isEmpty ? day : nil)
    }

    /// The note's length as the route counts it (zod `.length` = UTF-16 code
    /// units, after trimming).
    static func noteLength(_ raw: String) -> Int {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).utf16.count
    }

    static func noteIsValid(_ raw: String) -> Bool {
        (noteMin...noteMax).contains(noteLength(raw))
    }
}

/// GET /admin/finance/collection-health?days (Giving Cycle 9, finance:view) —
/// how collection is going over the window: M-Pesa prompts, paid, failed by
/// reason in the words members were told (whose answer it was), the success
/// rate, the gifts only the office can fix, the live outage check, and what
/// the rest of this Nairobi month should bring in — each gift weighted by its
/// own record, per currency. Decoded leniently: the page's first card must
/// never break the page (an unusable answer hides the card).
struct FinCollectionHealth: Decodable {
    struct Reason: Codable, Hashable {
        @DefaultEmpty var code: String
        @LooseInt var count: Int
        /// The words the member was told (giftFailure.ts).
        @DefaultEmpty var reason: String
        /// Their own answer (cancelled, no money, wrong PIN…) — else it never reached them.
        @DefaultFalse var memberAnswered: Bool
    }
    struct Outage: Decodable, Hashable {
        @DefaultFalse var suspected: Bool
        /// The server's words for what it saw ("8 of the last 10 M-Pesa prompts…").
        let evidence: String?
        @LooseInt var resolved: Int
        @LooseInt var unreached: Int
        @LooseInt var unsent: Int
    }
    struct Forecast: Codable, Hashable {
        @DefaultEmpty var currency: String
        @LooseInt var gifts: Int
        @LooseInt var prompts: Int
        @LooseInt var scheduledMinor: Int
        @LooseInt var expectedMinor: Int
    }
    @LooseInt var windowDays: Int
    @LooseInt var prompts: Int
    @LooseInt var paid: Int
    @LooseInt var failed: Int
    @LooseInt var waiting: Int
    /// paid ÷ (paid + failed), 3 decimals; nil with nothing answered.
    let successRate: Double?
    @DefaultEmptyList var byReason: [Reason]
    @LooseInt var notSentByUs: Int
    let outage: Outage?
    /// YYYY-MM-DD — the last day of the month the forecast covers.
    @DefaultEmpty var monthEnd: String
    /// Per currency (never added together); KES first.
    @DefaultEmptyList var forecast: [Forecast]

    /// A real answer covers a window of at least one day (the route takes
    /// 1–90); anything else — `{}`, another shape — is not shown.
    var isUsable: Bool { windowDays > 0 }
}

/// A row of GET /admin/campaigns — typed from financial/campaigns.ts. Raised
/// = succeeded gifts to the fund in the campaign's currency from starts_on
/// through ends_on (EAT days).
struct FinCampaign: Decodable, Hashable, Identifiable {
    let campaignId: String
    @DefaultEmpty var title: String
    @DefaultEmpty var blurb: String
    let imageUrl: String?
    @LooseInt var goalMinor: Int
    @DefaultEmpty var currency: String
    @DefaultEmpty var startsOn: String
    @DefaultEmpty var endsOn: String
    /// draft · live · ended
    @DefaultEmpty var status: String
    @LooseOptInt var matchMinor: Int?
    let matchPledger: String?
    let fund: String?
    let createdAt: String?
    @LooseInt var raisedMinor: Int
    /// Who was asked, and what came of it (count(*) — BIGINT as text).
    @LooseInt var peopleAsked: Int
    @LooseInt var gave: Int
    @LooseInt var declined: Int
    var id: String { campaignId }
}

/// POST / PUT /admin/campaigns body (campaigns.ts CampaignInput). Both halves
/// of a match, or neither. Always created as a draft.
struct FinCampaignInput: Encodable {
    /// 3–120 characters.
    var title: String
    /// ≥ 10 characters.
    var blurb: String
    var imageUrl: String? = nil
    /// Fund code.
    var fund: String
    var goalMinor: Int
    var currency: String
    var startsOn: String
    var endsOn: String
    var matchMinor: Int? = nil
    var matchPledger: String? = nil
}

/// What campaign writes return: `{campaign_id, status}`.
struct FinCampaignAck: Decodable {
    let campaignId: String?
    let status: String?
}

/// GET /admin/campaigns/{id}/reach — how far an invitation travelled.
struct FinCampaignReach: Decodable, Hashable {
    @LooseInt var peopleAsked: Int
    @LooseInt var timesShown: Int
    @LooseInt var opened: Int
    @LooseInt var gave: Int
    @LooseInt var dismissed: Int
    @LooseInt var declined: Int
}

/// PermissionCatalog — the server's own RBAC dimensions, in server order.
struct FinPermissionCatalog: Decodable, Hashable {
    let modules: [String]
    let capabilities: [String]
}

// MARK: - API

enum FinanceERPAPI {
    static var api: APIClient { .shared }
    private static let base = "/admin/finance"
    private struct DataEnvelope<T: Decodable>: Decodable { let data: T }
    /// Tolerant ack for writes whose body the page does not use.
    private struct Ack: Decodable { init(from decoder: Decoder) throws {} }
    private struct ReasonBody: Encodable { let reason: String }
    private struct StatusBody: Encodable { let status: String }

    /// Paged reads take `limit` (≤ 200; the ledger ≤ 500) and the previous
    /// page's `next_cursor`.
    private static func paged(_ query: [String: String], cursor: String?, limit: Int) -> [String: String] {
        var q = query
        q["limit"] = String(limit)
        if let cursor, !cursor.isEmpty { q["cursor"] = cursor }
        return q
    }

    /// A search term for `q`, trimmed; nil when blank. "+" is dropped:
    /// APIClient's query encoding sends it bare and the server would read a
    /// space — phone numbers still match without it ("254712…").
    static func searchTerm(_ raw: String) -> String? {
        let t = raw.replacingOccurrences(of: "+", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : String(t.prefix(80))
    }

    // MARK: CSV twins (finance:export) — pass the list filter's `query`
    // to FinanceExportButton(path:query:).

    static let transactionsCSV = "\(base)/transactions.csv"
    static let pledgesCSV = "\(base)/pledges.csv"
    static let ledgerCSV = "\(base)/ledger.csv"
    static let expensesCSV = "\(base)/expenses.csv"
    static let statementsCSV = "\(base)/statements.csv"
    static let incomeReportCSV = "\(base)/reports/income.csv"
    static let expensesReportCSV = "\(base)/reports/expenses.csv"
    static let pledgesReportCSV = "\(base)/reports/pledges.csv"
    static let financialPositionCSV = "\(base)/reports/financial-position.csv"
    static let incomeExpenditureCSV = "\(base)/reports/income-expenditure.csv"

    /// A member's giving statement PDF (finance:view; 404 when nothing that
    /// year) — `FinanceExportButton(… path:, query: ["year": "2026"], gate: \.view)`.
    static func givingStatementPath(_ userId: String) -> String { "\(base)/statements/\(userId)/giving.pdf" }
    /// A member's Partners statement PDF (finance:view; 404 if never a partner).
    static func partnersStatementPath(_ userId: String) -> String { "\(base)/statements/\(userId)/partners.pdf" }

    // MARK: Reports — reads (finance:view)

    /// GET /overview?from&to — nil period = this month (the server's default).
    static func overview(period: FinancePeriod?) async throws -> FinOverview {
        try await api.get("\(base)/overview", query: period?.query ?? [:], as: FinOverview.self)
    }

    /// GET /transactions — the register; totals over the whole filtered set.
    static func transactions(_ filter: FinTransactionFilter, cursor: String? = nil, limit: Int = 50) async throws -> FinTransactionsPage {
        try await api.get("\(base)/transactions", query: paged(filter.query, cursor: cursor, limit: limit), as: FinTransactionsPage.self)
    }

    /// GET /transactions/{id} — with every ledger leg it owns.
    static func transaction(_ id: String) async throws -> FinTransactionDetail {
        try await api.get("\(base)/transactions/\(id)", as: FinTransactionDetail.self)
    }

    /// GET /pledges — the pledge register.
    static func pledges(_ filter: FinPledgeFilter, cursor: String? = nil, limit: Int = 50) async throws -> FinPledgesPage {
        try await api.get("\(base)/pledges", query: paged(filter.query, cursor: cursor, limit: limit), as: FinPledgesPage.self)
    }

    /// GET /funds?from&to — every fund (one page); nil = this month / YTD.
    static func funds(period: FinancePeriod? = nil) async throws -> FinFundsPage {
        try await api.get("\(base)/funds", query: period?.query ?? [:], as: FinFundsPage.self)
    }

    /// GET /ledger — postings, transaction AND journal (limit ≤ 500).
    static func ledger(_ filter: FinLedgerFilter, cursor: String? = nil, limit: Int = 100) async throws -> FinLedgerPage {
        try await api.get("\(base)/ledger", query: paged(filter.query, cursor: cursor, limit: min(limit, 500)), as: FinLedgerPage.self)
    }

    /// GET /trial-balance?from&to — nil = all time.
    static func trialBalance(period: FinancePeriod?) async throws -> FinTrialBalance {
        try await api.get("\(base)/trial-balance", query: period?.query ?? [:], as: FinTrialBalance.self)
    }

    /// GET /reconciliation?from&to — nil = this month.
    static func reconciliation(period: FinancePeriod?) async throws -> FinReconciliation {
        try await api.get("\(base)/reconciliation", query: period?.query ?? [:], as: FinReconciliation.self)
    }

    /// GET /reports/income?year&by — by fund (default) · channel · source.
    static func incomeReport(year: Int?, by: String = "fund") async throws -> FinReportMatrix {
        try await api.get("\(base)/reports/income", query: yearQuery(year, by: by), as: FinReportMatrix.self)
    }

    /// GET /reports/expenses?year&by — by category (default) · fund. APPROVED only.
    static func expensesReport(year: Int?, by: String = "category") async throws -> FinReportMatrix {
        try await api.get("\(base)/reports/expenses", query: yearQuery(year, by: by), as: FinReportMatrix.self)
    }

    /// GET /reports/pledges?year.
    static func pledgesReport(year: Int?) async throws -> FinPledgesReport {
        try await api.get("\(base)/reports/pledges", query: yearQuery(year, by: nil), as: FinPledgesReport.self)
    }

    /// GET /reports/financial-position?as_of (YYYY-MM-DD; nil = today).
    static func financialPosition(asOf: String?) async throws -> FinFinancialPosition {
        var q: [String: String] = [:]
        if let asOf, !asOf.isEmpty { q["as_of"] = asOf }
        return try await api.get("\(base)/reports/financial-position", query: q, as: FinFinancialPosition.self)
    }

    /// GET /reports/income-expenditure?from&to — nil = this month.
    static func incomeExpenditure(period: FinancePeriod?) async throws -> FinIncomeExpenditure {
        try await api.get("\(base)/reports/income-expenditure", query: period?.query ?? [:], as: FinIncomeExpenditure.self)
    }

    /// `["year": …, "by": …]` for the report reads and their CSV twins.
    static func yearQuery(_ year: Int?, by: String?) -> [String: String] {
        var q: [String: String] = [:]
        if let year { q["year"] = String(year) }
        if let by, !by.isEmpty { q["by"] = by }
        return q
    }

    /// GET /statements?year&q — the year's givers (nil year = this year).
    static func statements(year: Int?, q: String = "", cursor: String? = nil, limit: Int = 50) async throws -> FinStatementsPage {
        var query = yearQuery(year, by: nil)
        if let term = searchTerm(q) { query["q"] = term }
        return try await api.get("\(base)/statements", query: paged(query, cursor: cursor, limit: limit), as: FinStatementsPage.self)
    }

    /// GET /audit — the finance slice of the audit trail, keyset-paged.
    static func audit(_ filter: FinAuditFilter, cursor: String? = nil, limit: Int = 50) async throws -> FinAuditPage {
        try await api.get("\(base)/audit", query: paged(filter.query, cursor: cursor, limit: limit), as: FinAuditPage.self)
    }

    /// GET /settings — providers (env NAMES only), receipt counter, tiers, reminder policy.
    static func settings() async throws -> FinSettings {
        try await api.get("\(base)/settings", as: FinSettings.self)
    }

    /// GET /needs?status&q — department needs for Finance (finance:view).
    /// status: approved (default) · pending · rejected · closed · all.
    static func needs(status: String = "approved", q: String = "", cursor: String? = nil, limit: Int = 50) async throws -> FinNeedsPage {
        var query: [String: String] = ["status": status]
        if let term = searchTerm(q) { query["q"] = term }
        return try await api.get("\(base)/needs", query: paged(query, cursor: cursor, limit: limit), as: FinNeedsPage.self)
    }

    /// GET /trend?months — succeeded giving per month, per currency (1…24 months).
    static func trend(months: Int = 12) async throws -> FinTrend {
        try await api.get("\(base)/trend", query: ["months": String(min(max(months, 1), 24))], as: FinTrend.self)
    }

    /// GET /summary — per-fund settled revenue (this month + all time).
    static func summary() async throws -> [FundSummary] {
        try await api.get("\(base)/summary", as: FinanceSummary.self).funds
    }

    /// GET /config — funds + provider availability (no secrets).
    static func config() async throws -> FinConfig {
        try await api.get("\(base)/config", as: FinConfig.self)
    }

    /// GET /schedules?status&attention&limit — recurring gifts, the ones
    /// needing attention first. `attention` = only those (the server's one
    /// rule — failing, stopped after failed prompts, or not sent by us; never
    /// a member's own pause, never cancelled).
    static func schedules(status: String? = nil, attention: Bool = false, limit: Int = 200) async throws -> [FinSchedule] {
        var q: [String: String] = ["limit": String(min(max(limit, 1), 200))]
        if let status, !status.isEmpty { q["status"] = status }
        if attention { q["attention"] = "true" }
        return try await api.get("\(base)/schedules", query: q, as: DataEnvelope<[FinSchedule]>.self).data
    }

    /// GET /collection-health?days (1–90) — how collection is going (Giving
    /// Cycle 9). A 404 from an older server throws; the page then shows no card.
    static func collectionHealth(days: Int = 30) async throws -> FinCollectionHealth {
        try await api.get("\(base)/collection-health", query: ["days": String(min(max(days, 1), 90))],
                          as: FinCollectionHealth.self)
    }

    /// POST /schedules/{id}/{pause|resume|cancel} (finance:manage) — the office
    /// changes a member's recurring gift AT THEIR REQUEST (Giving Cycle 7): a
    /// reason is required, the audit names who, and the member is told. Answers
    /// the register row. 400 VALIDATION_FAILED (reason, or resume_on out of
    /// range) · 422 not active / not paused / paused with its pledge / already
    /// cancelled — the server's own words.
    static func scheduleAction(_ scheduleId: String, _ action: FinScheduleOfficeAction,
                               _ body: FinScheduleActionBody) async throws -> FinSchedule {
        try await api.post("\(base)/schedules/\(scheduleId)/\(action.rawValue)", body: body, as: FinSchedule.self)
    }

    // MARK: Partners & claims (the existing Partners routes — PartnersAPI's models)

    /// GET /admin/partners?q&status&sort.
    static func partners(q: String?, status: String = "all", sort: String = "recent") async throws -> PartnersPage {
        try await PartnersAPI.list(q: q.flatMap(searchTerm), status: status, sort: sort)
    }
    /// GET /admin/partners/{userId}.
    static func partner(_ userId: String) async throws -> PartnerDetail {
        try await PartnersAPI.detail(userId)
    }
    /// POST /admin/partners/{userId}/remind (finance:manage).
    static func remindPartner(_ userId: String, pledgeId: String? = nil, message: String? = nil) async throws -> RemindResult {
        try await PartnersAPI.remind(userId, pledgeId: pledgeId, message: message)
    }
    /// POST /admin/partners/remind-behind (finance:manage).
    static func remindEveryoneBehind() async throws -> RemindResult {
        try await PartnersAPI.remindBehind()
    }
    /// GET /admin/partners/claims — pending claims, oldest first.
    static func claims() async throws -> [PledgeClaimRow] {
        try await PartnersAPI.claims()
    }
    /// POST /admin/partners/claims/{id}/confirm (finance:manage) — records an office gift.
    static func confirmClaim(_ claimId: String) async throws {
        try await PartnersAPI.decideClaim(claimId, decision: "confirm")
    }
    /// POST /admin/partners/claims/{id}/reject (finance:manage) — the member is told.
    static func rejectClaim(_ claimId: String) async throws {
        try await PartnersAPI.decideClaim(claimId, decision: "reject")
    }

    // MARK: Campaigns (/admin/campaigns — the caller's congregation)

    /// GET /admin/campaigns.
    static func campaigns() async throws -> [FinCampaign] {
        try await api.get("/admin/campaigns", as: DataEnvelope<[FinCampaign]>.self).data
    }
    /// POST /admin/campaigns (finance:manage) — always a draft.
    static func createCampaign(_ input: FinCampaignInput) async throws -> FinCampaignAck {
        try await api.post("/admin/campaigns", body: input, as: FinCampaignAck.self)
    }
    /// PUT /admin/campaigns/{id} (finance:manage) — the whole campaign.
    static func updateCampaign(_ id: String, _ input: FinCampaignInput) async throws -> FinCampaignAck {
        try await api.put("/admin/campaigns/\(id)", body: input, as: FinCampaignAck.self)
    }
    /// POST /admin/campaigns/{id}/status {live} (finance:manage).
    static func goLive(_ id: String) async throws -> FinCampaignAck {
        try await api.post("/admin/campaigns/\(id)/status", body: StatusBody(status: "live"), as: FinCampaignAck.self)
    }
    /// POST /admin/campaigns/{id}/status {ended} (finance:manage) — final; 409 if already ended.
    static func endCampaign(_ id: String) async throws -> FinCampaignAck {
        try await api.post("/admin/campaigns/\(id)/status", body: StatusBody(status: "ended"), as: FinCampaignAck.self)
    }
    /// GET /admin/campaigns/{id}/reach.
    static func campaignReach(_ id: String) async throws -> FinCampaignReach {
        try await api.get("/admin/campaigns/\(id)/reach", as: FinCampaignReach.self)
    }

    /// GET /admin/departments/needs?status — the Departments module's own list
    /// (needs departments:view; Finance pages use `needs(…)`).
    static func departmentNeeds(status: String = "approved") async throws -> [DepartmentNeedRow] {
        try await DepartmentsAPI.needs(status: status)
    }

    // MARK: Books — writes and registers

    /// POST /gifts (finance:manage). 201 new · 200 replay (`reused`). 409
    /// DUPLICATE_RECEIPT (that M-Pesa code is already booked); 422
    /// INVALID_DATE / INVALID_REFERENCE / CURRENCY_MISMATCH.
    static func recordGift(_ input: FinGiftInput) async throws -> FinGiftResult {
        try await api.post("\(base)/gifts", body: input, as: FinGiftResult.self)
    }

    /// POST /transactions/{id}/reverse (finance:manage) — office gifts and
    /// confirmed claims only; reason 5–300. 422 NOT_REVERSIBLE / ALREADY_REVERSED.
    static func reverseTransaction(_ id: String, reason: String) async throws -> FinBooksTransaction {
        try await api.post("\(base)/transactions/\(id)/reverse", body: ReasonBody(reason: reason), as: FinBooksTransaction.self)
    }

    /// POST /funds (finance:manage). 409 = that code exists.
    static func createFund(_ input: FinFundInput) async throws -> FinFund {
        try await api.post("\(base)/funds", body: input, as: FinFund.self)
    }

    /// PATCH /funds/{code} (finance:manage) — never an empty patch.
    static func updateFund(code: String, _ patch: FinFundPatch) async throws -> FinFund {
        try await api.patch("\(base)/funds/\(code)", body: patch, as: FinFund.self)
    }

    /// POST /transfers (finance:approve). 422 details.reason NEGATIVE_BALANCE
    /// unless `allowNegative`.
    static func transfer(_ input: FinTransferInput) async throws -> FinTransfer {
        try await api.post("\(base)/transfers", body: input, as: FinTransfer.self)
    }

    /// GET /expenses — the expense register (+ totals by status).
    static func expenses(_ filter: FinExpenseFilter, cursor: String? = nil, limit: Int = 50) async throws -> FinExpenseList {
        try await api.get("\(base)/expenses", query: paged(filter.query, cursor: cursor, limit: limit), as: FinExpenseList.self)
    }

    /// GET /expenses/{id}.
    static func expense(_ id: String) async throws -> FinExpense {
        try await api.get("\(base)/expenses/\(id)", as: FinExpense.self)
    }

    /// POST /expenses (finance:manage) — recorded; nothing posts yet.
    static func recordExpense(_ input: FinExpenseInput) async throws -> FinExpense {
        try await api.post("\(base)/expenses", body: input, as: FinExpense.self)
    }

    /// PATCH /expenses/{id} (finance:manage) — while recorded; 422 otherwise.
    static func updateExpense(_ id: String, _ patch: FinExpensePatch) async throws -> FinExpense {
        try await api.patch("\(base)/expenses/\(id)", body: patch, as: FinExpense.self)
    }

    /// POST /expenses/{id}/approve (finance:approve) — posts the journal.
    /// 403 SAME_PERSON when the approver recorded or edited it (SuperAdmin excepted).
    static func approveExpense(_ id: String) async throws -> FinExpense {
        try await api.postEmpty("\(base)/expenses/\(id)/approve", as: FinExpense.self)
    }

    /// POST /expenses/{id}/void (finance:manage) — reason 5–300; an approved
    /// expense also gets its reversing journal.
    static func voidExpense(_ id: String, reason: String) async throws -> FinExpense {
        try await api.post("\(base)/expenses/\(id)/void", body: ReasonBody(reason: reason), as: FinExpense.self)
    }

    /// GET /expense-categories — active and inactive, by sort then name.
    static func expenseCategories() async throws -> [FinExpenseCategory] {
        try await api.get("\(base)/expense-categories", as: DataEnvelope<[FinExpenseCategory]>.self).data
    }

    /// POST /expense-categories (finance:manage). 409 = that code exists.
    static func createExpenseCategory(_ input: FinExpenseCategoryInput) async throws -> FinExpenseCategory {
        try await api.post("\(base)/expense-categories", body: input, as: FinExpenseCategory.self)
    }

    /// PATCH /expense-categories/{id} (finance:manage).
    static func updateExpenseCategory(_ id: String, _ patch: FinExpenseCategoryPatch) async throws -> FinExpenseCategory {
        try await api.patch("\(base)/expense-categories/\(id)", body: patch, as: FinExpenseCategory.self)
    }

    /// GET /budgets — every year's budget, newest first.
    static func budgets() async throws -> [FinBudget] {
        try await api.get("\(base)/budgets", as: DataEnvelope<[FinBudget]>.self).data
    }

    /// POST /budgets (finance:manage) — a draft, one per year. 409 = the year has one.
    static func createBudget(year: Int, name: String) async throws -> FinBudgetDetail {
        struct Body: Encodable { let year: Int; let name: String }
        return try await api.post("\(base)/budgets", body: Body(year: year, name: name), as: FinBudgetDetail.self)
    }

    /// GET /budgets/{id} — with its lines.
    static func budget(_ id: String) async throws -> FinBudgetDetail {
        try await api.get("\(base)/budgets/\(id)", as: FinBudgetDetail.self)
    }

    /// PATCH /budgets/{id} (finance:manage, draft only) — rename or move year.
    static func updateBudget(_ id: String, year: Int? = nil, name: String? = nil) async throws -> FinBudgetDetail {
        struct Body: Encodable { let year: Int?; let name: String? }
        return try await api.patch("\(base)/budgets/\(id)", body: Body(year: year, name: name), as: FinBudgetDetail.self)
    }

    /// PUT /budgets/{id}/lines (finance:manage, draft only) — replaces ALL lines (≤ 200).
    static func replaceBudgetLines(_ id: String, _ lines: [FinBudgetLineInput]) async throws -> FinBudgetDetail {
        struct Body: Encodable { let lines: [FinBudgetLineInput] }
        return try await api.put("\(base)/budgets/\(id)/lines", body: Body(lines: lines), as: FinBudgetDetail.self)
    }

    /// POST /budgets/{id}/approve (finance:approve) — needs ≥ 1 line; read-only after.
    static func approveBudget(_ id: String) async throws -> FinBudgetDetail {
        try await api.postEmpty("\(base)/budgets/\(id)/approve", as: FinBudgetDetail.self)
    }

    /// GET /budgets/{id}/actuals — budget vs actual per line and month (KES).
    static func budgetActuals(_ id: String) async throws -> FinBudgetActuals {
        try await api.get("\(base)/budgets/\(id)/actuals", as: FinBudgetActuals.self)
    }

    /// POST /opening-balances (finance:approve) — idempotent; 201 new · 200 replay.
    static func postOpeningBalance(_ input: FinOpeningBalanceInput) async throws -> FinJournalResult {
        try await api.post("\(base)/opening-balances", body: input, as: FinJournalResult.self)
    }

    /// GET /journals — journals with their legs, newest occurred_on first.
    static func journals(_ filter: FinJournalFilter, cursor: String? = nil, limit: Int = 50) async throws -> FinJournalList {
        try await api.get("\(base)/journals", query: paged(filter.query, cursor: cursor, limit: limit), as: FinJournalList.self)
    }

    /// GET /journals/{id}.
    static func journal(_ id: String) async throws -> FinJournal {
        try await api.get("\(base)/journals/\(id)", as: FinJournal.self)
    }

    /// POST /journals/{id}/reverse (finance:approve) — transfers and opening
    /// balances; once. 422 USE_EXPENSE_VOID / NOT_REVERSIBLE / ALREADY_REVERSED
    /// / NEGATIVE_BALANCE (unless `allowNegative`).
    static func reverseJournal(_ id: String, reason: String, allowNegative: Bool = false) async throws -> FinJournal {
        try await api.post("\(base)/journals/\(id)/reverse",
                           body: FinJournalReverseInput(reason: reason, allowNegative: allowNegative), as: FinJournal.self)
    }

    /// GET /admin/permissions/catalog (rolesAdmin:view OR users:view OR
    /// finance:view) — for role editors and Finance → Settings' roles help.
    static func permissionsCatalog() async throws -> FinPermissionCatalog {
        try await api.get("/admin/permissions/catalog", as: FinPermissionCatalog.self)
    }

    // MARK: Downloads (CSV twins, statement PDFs)

    /// GET a Finance export with the session's auth (one silent token refresh,
    /// like every request), write it to a private temporary folder under the
    /// server's filename (Content-Disposition), and return the file URL for the
    /// share sheet. FinanceExportButton is the usual caller; FinanceShare
    /// deletes the copy when the sheet is done. `query` carries the list's own
    /// filters — the CSV twin takes the same ones (spec §4).
    static func download(path: String, query: [String: String] = [:]) async throws -> URL {
        let file = try await api.getFile(path, query: query)
        let name = safeFilename(filename(fromContentDisposition: file.contentDisposition), fallbackPath: path)
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("finance-exports", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(name)
            try file.data.write(to: url, options: [.atomic, .completeFileProtection])
            return url
        } catch {
            throw APIError.transport("Could not save the downloaded file.")
        }
    }

    /// The filename in a Content-Disposition header — RFC 5987 `filename*=`
    /// first, then `filename="…"` / `filename=…`. Nil when there is none.
    static func filename(fromContentDisposition header: String?) -> String? {
        guard let header else { return nil }
        let parts = header.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
        for p in parts where p.lowercased().hasPrefix("filename*=") {
            let value = p.dropFirst("filename*=".count)
            // charset'lang'percent-encoded
            let pieces = value.split(separator: "'", maxSplits: 2, omittingEmptySubsequences: false)
            let encoded = pieces.count == 3 ? String(pieces[2]) : String(value)
            if let decoded = encoded.removingPercentEncoding, !decoded.isEmpty { return decoded }
        }
        for p in parts where p.lowercased().hasPrefix("filename=") {
            var value = String(p.dropFirst("filename=".count))
            if value.hasPrefix("\""), value.hasSuffix("\""), value.count >= 2 { value = String(value.dropFirst().dropLast()) }
            if !value.isEmpty { return value }
        }
        return nil
    }

    /// A filename that is safe to write: no path separators or colons, no
    /// leading dots, ≤ 120 characters; else the request path's last component.
    static func safeFilename(_ raw: String?, fallbackPath: String) -> String {
        func clean(_ s: String) -> String {
            var t = s.trimmingCharacters(in: .whitespacesAndNewlines)
            for ch in ["/", "\\", ":"] { t = t.replacingOccurrences(of: ch, with: "-") }
            while t.hasPrefix(".") { t.removeFirst() }
            return String(t.prefix(120))
        }
        if let raw, case let name = clean(raw), !name.isEmpty { return name }
        let last = clean(String(fallbackPath.split(separator: "/").last ?? ""))
        return last.isEmpty ? "export" : last
    }
}

// MARK: - Appended by the Finance A pages (Overview · Transactions · Funds · Ledger ·
// Reconciliation · Audit · Settings). Additive only — nothing above changed.

/// One of a member's OPEN pledges, as GET /admin/finance/givers returns it —
/// what Record a gift offers to pay toward (a pledge decides the fund).
struct FinGiverPledge: Decodable, Hashable, Identifiable {
    let pledgeId: String
    @DefaultEmpty var title: String
    @DefaultEmpty var currency: String
    /// monthly | total
    @DefaultEmpty var shape: String
    /// A monthly pledge's instalment.
    @LooseOptInt var amountMinor: Int?
    /// A total pledge's target.
    @LooseOptInt var targetMinor: Int?
    /// The fund a gift toward this pledge is booked to.
    let paysTo: FinFundRef?
    var id: String { pledgeId }
}

/// A member the office can record a gift for (GET /admin/finance/givers, finance:view).
struct FinGiver: Decodable, Hashable, Identifiable {
    let userId: String
    @DefaultEmpty var fullName: String
    let phone: String?
    let email: String?
    let congregationName: String?
    let openPledges: [FinGiverPledge]
    var id: String { userId }
}

/// PATCH /funds/{code} with the FUND_IN_USE override: the patch's own fields
/// plus `force` (true = deactivate even though pledges, recurring gifts,
/// departments or live campaigns still send money to the fund).
struct FinFundPatchForced: Encodable {
    var patch: FinFundPatch
    var force: Bool

    private enum CodingKeys: String, CodingKey { case name, nameSw, description, sort, isActive, force }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(patch.name, forKey: .name)
        try c.encode(patch.nameSw, forKey: .nameSw)
        try c.encode(patch.description, forKey: .description)
        try c.encodeIfPresent(patch.sort, forKey: .sort)
        try c.encodeIfPresent(patch.isActive, forKey: .isActive)
        if force { try c.encode(true, forKey: .force) }
    }
}

extension FinanceERPAPI {
    private struct GiversEnvelope: Decodable { let data: [FinGiver] }

    /// GET /admin/finance/givers?q&limit (finance:view) — members matching a
    /// name / phone / email, each with their OPEN pledges (for Record a gift).
    static func givers(q: String, limit: Int = 8) async throws -> [FinGiver] {
        var query: [String: String] = ["limit": String(min(max(limit, 1), 50))]
        if let term = searchTerm(q) { query["q"] = term }
        return try await api.get("/admin/finance/givers", query: query, as: GiversEnvelope.self).data
    }

    /// PATCH /funds/{code} (finance:manage) with `force` — the second step after
    /// a 409 FUND_IN_USE (details active_pledges · active_schedules ·
    /// departments · live_campaigns) when the office deactivates anyway.
    static func updateFund(code: String, _ patch: FinFundPatch, force: Bool) async throws -> FinFund {
        try await api.patch("/admin/finance/funds/\(code)", body: FinFundPatchForced(patch: patch, force: force), as: FinFund.self)
    }
}
