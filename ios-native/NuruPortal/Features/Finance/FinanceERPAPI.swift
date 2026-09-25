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

// MARK: - API

enum FinanceERPAPI {
    static var api: APIClient { .shared }

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
