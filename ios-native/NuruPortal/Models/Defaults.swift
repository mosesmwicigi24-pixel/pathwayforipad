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

extension KeyedDecodingContainer {
    /// Missing key OR explicit null → the provider's default (never throws).
    func decode<P>(_ type: DefaultCodable<P>.Type, forKey key: Key) throws -> DefaultCodable<P> {
        try decodeIfPresent(type, forKey: key) ?? DefaultCodable(wrappedValue: P.defaultValue)
    }
}

enum EmptyStringProvider: DefaultValueProvider { static let defaultValue = "" }
enum ZeroIntProvider: DefaultValueProvider { static let defaultValue = 0 }
enum FalseBoolProvider: DefaultValueProvider { static let defaultValue = false }
enum ZeroDoubleProvider: DefaultValueProvider { static let defaultValue: Double = 0 }

typealias DefaultEmpty = DefaultCodable<EmptyStringProvider>
typealias DefaultZero = DefaultCodable<ZeroIntProvider>
typealias DefaultFalse = DefaultCodable<FalseBoolProvider>
typealias DefaultZeroD = DefaultCodable<ZeroDoubleProvider>
