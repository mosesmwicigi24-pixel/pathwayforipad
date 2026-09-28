// Shared by the unit tests: the wire's JSON conventions (APIClient decodes
// snake_case → camelCase and encodes the other way) and an HTTP stub, so a
// test can drive a real FinanceERPAPI / PartnersAPI call end to end — method,
// path, JSON body, status, error envelope — with nothing leaving the simulator.
import Foundation
import XCTest
@testable import NuruPortal

enum Wire {
    /// Decode like APIClient does.
    static func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return try d.decode(T.self, from: Data(json.utf8))
    }

    /// Encode like APIClient does, read back as a JSON object.
    static func object<T: Encodable>(_ value: T) throws -> [String: Any] {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        let data = try e.encode(value)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    /// An instant from ISO 8601 ("2026-09-30T22:30:00Z").
    static func at(_ iso: String) -> Date {
        ISO8601DateFormatter().date(from: iso) ?? Date(timeIntervalSince1970: 0)
    }
}

/// Answers every HTTP(S) request of the process (URLSession.shared — the one
/// APIClient uses) from `route`, and records what was asked. Install in
/// setUp, remove in tearDown. An unrouted request is a 599, never the network.
final class StubHTTP: URLProtocol {
    struct Seen {
        let method: String
        let path: String
        let body: Data?
        /// The query string as sent ("days=30"), or nil.
        var query: String? = nil
    }
    struct Reply {
        var status = 200
        var json = "{}"
    }

    private static let lock = NSLock()
    private static var _route: ((Seen) -> Reply)?
    private static var _seen: [Seen] = []

    static func install(_ route: @escaping (Seen) -> Reply) {
        lock.lock(); _route = route; _seen = []; lock.unlock()
        URLProtocol.registerClass(StubHTTP.self)
    }
    static func uninstall() {
        URLProtocol.unregisterClass(StubHTTP.self)
        lock.lock(); _route = nil; _seen = []; lock.unlock()
    }
    static var seen: [Seen] {
        lock.lock(); defer { lock.unlock() }
        return _seen
    }

    override class func canInit(with request: URLRequest) -> Bool {
        guard let scheme = request.url?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let seen = Seen(method: request.httpMethod ?? "GET", path: request.url?.path ?? "", body: Self.body(of: request),
                        query: request.url?.query)
        Self.lock.lock()
        Self._seen.append(seen)
        let route = Self._route
        Self.lock.unlock()
        let reply = route?(seen) ?? Reply(status: 599, json: #"{"error":{"code":"UNROUTED","message":"No stub for this request"}}"#)
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
                                             headerFields: ["Content-Type": "application/json"]) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(reply.json.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}

    /// A URLProtocol sees the body as a stream, not `httpBody`.
    private static func body(of request: URLRequest) -> Data? {
        if let b = request.httpBody { return b }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let n = stream.read(&buffer, maxLength: buffer.count)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}

extension StubHTTP.Seen {
    /// The JSON body as an object.
    var json: [String: Any]? {
        guard let body else { return nil }
        return (try? JSONSerialization.jsonObject(with: body)) as? [String: Any]
    }
}
