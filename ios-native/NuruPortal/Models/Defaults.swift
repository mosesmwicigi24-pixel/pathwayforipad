// Resilient decoding helpers. The backend sometimes sends `null` (or omits a key)
// for fields the TypeScript contract types as non-null `string` — which would
// otherwise crash JSONDecoder. `@DefaultEmpty` decodes null/missing to "" so a
// stray null never breaks a whole screen. Views keep using plain `String`.
import Foundation

protocol DefaultValueProvider {
    associatedtype Value: Codable
    static var defaultValue: Value { get }
}

@propertyWrapper
struct DefaultCodable<P: DefaultValueProvider>: Codable {
    var wrappedValue: P.Value
    init(wrappedValue: P.Value) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        wrappedValue = (try? c.decode(P.Value.self)) ?? P.defaultValue
    }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}

extension DefaultCodable: Equatable where P.Value: Equatable {
    static func == (l: Self, r: Self) -> Bool { l.wrappedValue == r.wrappedValue }
}
extension DefaultCodable: Hashable where P.Value: Hashable {
    func hash(into hasher: inout Hasher) { hasher.combine(wrappedValue) }
}

extension KeyedDecodingContainer {
    /// Missing key OR explicit null → the provider's default (never throws).
    func decode<P>(_ type: DefaultCodable<P>.Type, forKey key: Key) throws -> DefaultCodable<P> {
        try decodeIfPresent(type, forKey: key) ?? DefaultCodable(wrappedValue: P.defaultValue)
    }
}

enum EmptyStringProvider: DefaultValueProvider { static let defaultValue = "" }
enum ZeroIntProvider: DefaultValueProvider { static let defaultValue = 0 }
enum FalseBoolProvider: DefaultValueProvider { static let defaultValue = false }
enum TrueBoolProvider: DefaultValueProvider { static let defaultValue = true }
enum ZeroDoubleProvider: DefaultValueProvider { static let defaultValue: Double = 0 }

typealias DefaultEmpty = DefaultCodable<EmptyStringProvider>
typealias DefaultZero = DefaultCodable<ZeroIntProvider>
typealias DefaultFalse = DefaultCodable<FalseBoolProvider>
typealias DefaultTrue = DefaultCodable<TrueBoolProvider>
typealias DefaultZeroD = DefaultCodable<ZeroDoubleProvider>

/// An integer that may arrive as a JSON number, a float, or a numeric STRING.
/// Postgres BIGINT / NUMERIC columns cast `::text` on the way out (pledge
/// claims, partner schedules and payments all send `amount_minor` that way,
/// financial/partners.ts) and `@DefaultZero` would silently read those as 0 —
/// a wrong money figure, not a missing one. Null / missing / unparseable → 0.
/// Views keep using plain `Int`.
@propertyWrapper
struct LooseInt: Codable, Equatable, Hashable {
    var wrappedValue: Int
    init(wrappedValue: Int) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let i = try? c.decode(Int.self) {
            wrappedValue = i
        } else if let d = try? c.decode(Double.self), d.isFinite {
            wrappedValue = Int(d.rounded())
        } else if let s = try? c.decode(String.self) {
            let t = s.trimmingCharacters(in: .whitespaces)
            wrappedValue = Int(t) ?? Double(t).map { Int($0.rounded()) } ?? 0
        } else {
            wrappedValue = 0
        }
    }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}

extension KeyedDecodingContainer {
    /// Missing key OR explicit null → 0 (never throws), like the providers above.
    func decode(_ type: LooseInt.Type, forKey key: Key) throws -> LooseInt {
        try decodeIfPresent(type, forKey: key) ?? LooseInt(wrappedValue: 0)
    }
}
