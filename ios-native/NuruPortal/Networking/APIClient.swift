// URLSession-based API client for the native portal. Mirrors api/client.ts:
// injects the gateway JWT (§1.3), targets the versioned prod surface (§3.1), and
// silently rotates the access token once on a 401 via the stored refresh token.
import Foundation

enum APIError: LocalizedError {
    case http(status: Int, message: String)
    case decoding(String)
    case transport(String)
    case unauthorized

    var errorDescription: String? {
        switch self {
        case .http(_, let m): return m
        case .decoding(let m): return "Couldn't read the server response. \(m)"
        case .transport(let m): return m
        case .unauthorized: return "Your session has expired. Please sign in again."
        }
    }
}

/// Backend error envelope: { "error": { "code": "...", "message": "..." } } or { "message": "..." }.
private struct ErrorEnvelope: Decodable {
    struct Inner: Decodable { let code: String?; let message: String? }
    let error: Inner?
    let message: String?
    var text: String? { error?.message ?? message }
}

actor APIClient {
    static let shared = APIClient()

    /// Prod API surface (same base the Capacitor build bakes in via VITE_API_BASE).
    private let baseURL = URL(string: "https://pathway.nuruplace.org/v1")!

    private let atKey = "nuru.portal.at"
    private let rtKey = "nuru.portal.rt"

    private var accessToken: String?
    private var refreshToken: String?

    /// Called when the refresh token itself is dead — the app returns to /login.
    private var onSessionExpired: (@Sendable () -> Void)?

    private let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.keyEncodingStrategy = .convertToSnakeCase
        return e
    }()

    init() {
        accessToken = Keychain.get(atKey)
        refreshToken = Keychain.get(rtKey)
    }

    // MARK: Session

    var hasSession: Bool { accessToken != nil }

    func setOnSessionExpired(_ fn: @escaping @Sendable () -> Void) { onSessionExpired = fn }

    func setSession(access: String?, refresh: String?) {
        accessToken = access
        refreshToken = refresh
        Keychain.set(access, for: atKey)
        Keychain.set(refresh, for: rtKey)
    }

    func clearSession() { setSession(access: nil, refresh: nil) }

    // MARK: Requests

    func get<T: Decodable>(_ path: String, query: [String: String] = [:], as type: T.Type) async throws -> T {
        try await send(path, method: "GET", query: query, body: Optional<Int>.none, as: T.self)
    }

    func post<B: Encodable, T: Decodable>(_ path: String, body: B, as type: T.Type) async throws -> T {
        try await send(path, method: "POST", body: body, as: T.self)
    }

    /// Core request with one transparent token refresh + replay on 401.
    private func send<B: Encodable, T: Decodable>(
        _ path: String, method: String, query: [String: String] = [:],
        body: B?, as type: T.Type, isRetry: Bool = false
    ) async throws -> T {
        var comps = URLComponents(url: baseURL.appendingPathComponent(path.hasPrefix("/") ? String(path.dropFirst()) : path), resolvingAgainstBaseURL: false)!
        if !query.isEmpty {
            comps.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        }
        var req = URLRequest(url: comps.url!)
        req.httpMethod = method
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token = accessToken { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = try encoder.encode(body)
        }

        let data: Data, response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: req)
        } catch {
            throw APIError.transport(error.localizedDescription)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.transport("No HTTP response.")
        }

        if http.statusCode == 401, !isRetry, refreshToken != nil {
            if try await refreshSession() {
                return try await send(path, method: method, query: query, body: body, as: T.self, isRetry: true)
            } else {
                onSessionExpired?()
                throw APIError.unauthorized
            }
        }

        guard (200..<300).contains(http.statusCode) else {
            let msg = (try? decoder.decode(ErrorEnvelope.self, from: data))?.text
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw APIError.http(status: http.statusCode, message: msg)
        }

        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }

    /// Single-flight refresh: exchange the one-time refresh token for a new pair.
    private func refreshSession() async throws -> Bool {
        guard let rt = refreshToken else { return false }
        struct Body: Encodable { let refreshToken: String }
        var req = URLRequest(url: baseURL.appendingPathComponent("auth/token/refresh"))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try encoder.encode(Body(refreshToken: rt))
        guard let (data, resp) = try? await URLSession.shared.data(for: req),
              let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let session = try? decoder.decode(Session.self, from: data) else {
            clearSession()
            return false
        }
        setSession(access: session.accessToken, refresh: session.refreshToken)
        return true
    }
}
