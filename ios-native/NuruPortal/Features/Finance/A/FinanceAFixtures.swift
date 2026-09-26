// DEBUG-only harness for the Finance A pages: with the launch environment
// NURU_FINANCE_FIXTURES=1 (SuperAdmin) or =viewer (finance:view only) every
// HTTP request the app makes is answered here from FinAFixtureData — nothing
// leaves the device — so a page can be launched and screenshotted in the
// simulator with no backend and no real session:
//
//   SIMCTL_CHILD_NURU_FINANCE_FIXTURES=1 SIMCTL_CHILD_NURU_ACCESS_TOKEN=fixture \
//   SIMCTL_CHILD_NURU_START_SECTION=financeOverview xcrun simctl launch <udid> org.nuruplace.portal
//
// NURU_FINANCE_PARAMS="tx=t-003" (or "record=gift", "tab=journals") is applied
// to the start section as a deep link. Writes answer like the server,
// including the refusals the pages must word: M-Pesa code QDUPL1CATE →
// 409 DUPLICATE_RECEIPT; a transfer over KES 50,000 without allow_negative →
// 422 NEGATIVE_BALANCE; deactivating the building fund without force → 409
// FUND_IN_USE; reversing a journal without allow_negative → NEGATIVE_BALANCE.
// Release builds carry none of it.
#if DEBUG
import Foundation
import UIKit

enum FinanceAFixtures {
    static var mode: String? { ProcessInfo.processInfo.environment["NURU_FINANCE_FIXTURES"] }

    /// Called once at launch (FinanceSelfCheck.runAtLaunch): registers the
    /// fixture protocol when the environment asks for it.
    static func installIfRequested() {
        guard let m = mode, !m.isEmpty, m != "0" else { return }
        URLProtocol.registerClass(FinAFixtureProtocol.self)
        print("FinanceAFixtures: ON (\(m)) — every request is answered from fixtures; nothing leaves the device")
        // NURU_FINANCE_SCROLL=<points>: scroll the front-most page (or sheet) that far
        // a few seconds after launch — lower sections can be screenshotted headlessly.
        if let raw = ProcessInfo.processInfo.environment["NURU_FINANCE_SCROLL"], let y = Double(raw) {
            let delay = Double(ProcessInfo.processInfo.environment["NURU_FINANCE_SCROLL_AFTER"] ?? "") ?? 4
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { scrollFrontmost(to: CGFloat(y)) }
        }
    }

    /// Scroll the last (front-most) vertically scrollable view that is not the sidebar.
    @MainActor
    private static func scrollFrontmost(to y: CGFloat) {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })
            .flatMap(\.windows).first(where: \.isKeyWindow) else { return }
        var target: UIScrollView?
        /// Kept-alive pages sit hidden (opacity 0, no hit testing) above the current one.
        func showing(_ view: UIView) -> Bool {
            var v: UIView? = view
            while let x = v {
                if x.isHidden || x.alpha < 0.01 || x.layer.opacity < 0.01 || !x.isUserInteractionEnabled { return false }
                v = x.superview
            }
            return true
        }
        func walk(_ v: UIView) {
            if let s = v as? UIScrollView, s.bounds.height >= 300,
               s.contentSize.height > s.bounds.height + 1, showing(s) {
                let frame = s.convert(s.bounds, to: window)
                if !(frame.minX < 40 && frame.width < 320) { target = s }
            }
            v.subviews.forEach(walk)
        }
        walk(window)
        guard let s = target else { return }
        let maxY = max(0, s.contentSize.height - s.bounds.height + s.adjustedContentInset.bottom)
        s.setContentOffset(CGPoint(x: s.contentOffset.x, y: min(y, maxY) - s.adjustedContentInset.top), animated: false)
    }

    /// The start section's deep-link params from NURU_FINANCE_PARAMS ("a=1&b=2"), once.
    static func launchParams(for section: Section) -> [String: String]? {
        let env = ProcessInfo.processInfo.environment
        guard !consumed, env["NURU_START_SECTION"] == section.rawValue,
              let raw = env["NURU_FINANCE_PARAMS"], !raw.isEmpty else { return nil }
        consumed = true
        var out: [String: String] = [:]
        for pair in raw.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { out[kv[0]] = kv[1] }
        }
        return out
    }
    nonisolated(unsafe) private static var consumed = false

    /// DEBUG: NURU_FINANCE_FORM="amount=80000&from=tithe&submit=1" — the values the
    /// first A write sheet to appear fills in (and submits when submit=1). Once.
    static func formValues() -> [String: String]? {
        guard !formConsumed, let raw = ProcessInfo.processInfo.environment["NURU_FINANCE_FORM"], !raw.isEmpty else { return nil }
        formConsumed = true
        var out: [String: String] = [:]
        for pair in raw.split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { out[kv[0]] = kv[1].replacingOccurrences(of: "+", with: " ") }
        }
        return out
    }
    nonisolated(unsafe) private static var formConsumed = false

    // MARK: Routing

    static func respond(method: String, path: String, query: [String: String], body: [String: Any]) -> (Int, String) {
        func err(_ status: Int, _ code: String, _ message: String, _ details: [String: Any] = [:]) -> (Int, String) {
            let obj: [String: Any] = ["error": ["code": code, "message": message, "details": details]]
            let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data()
            return (status, String(data: data, encoding: .utf8) ?? "{}")
        }
        let segments = path.split(separator: "/").map(String.init)
        switch (method, path) {
        case ("GET", "/me"): return (200, mode == "viewer" ? FinAFixtureData.meViewer : FinAFixtureData.me)
        case ("GET", "/admin/notifications"): return (200, #"{"data":[]}"#)
        case ("GET", "/admin/finance/config"): return (200, FinAFixtureData.config)
        case ("GET", "/admin/finance/overview"): return (200, FinAFixtureData.overview)
        case ("GET", "/admin/finance/transactions"):
            if query["status"] == "processing" || query["status"] == "requires_action" {
                // David Mwangi (+254744000404) has an M-Pesa push in flight, started 25 minutes ago.
                guard query["status"] == "processing", (query["q"] ?? "").contains("254744000404") else {
                    return (200, #"{"data":[],"next_cursor":null,"totals":[]}"#)
                }
                let started = ISO8601DateFormatter().string(from: Date().addingTimeInterval(-25 * 60))
                let row = FinAFixtureData.transactionsPage1
                    .components(separatedBy: #"{"transaction_id":"t-004""#).dropFirst().first?
                    .components(separatedBy: #"},{"transaction_id""#).first ?? ""
                let patched = (#"{"transaction_id":"t-004""# + row + "}")
                    .replacingOccurrences(of: #""created_at":"2026-09-26T08:55:00.000Z""#, with: #""created_at":"\#(started)""#)
                return (200, #"{"data":["# + patched + #"],"next_cursor":null,"totals":[{"currency":"KES","amount_minor":0,"count":1}]}"#)
            }
            return (200, query["cursor"] == "c2" ? FinAFixtureData.transactionsPage2 : FinAFixtureData.transactionsPage1)
        case ("GET", "/admin/finance/funds"): return (200, FinAFixtureData.funds)
        case ("GET", "/admin/finance/ledger"): return (200, FinAFixtureData.ledger)
        case ("GET", "/admin/finance/journals"): return (200, FinAFixtureData.journals)
        case ("GET", "/admin/finance/trial-balance"): return (200, FinAFixtureData.trialBalance)
        case ("GET", "/admin/finance/reconciliation"): return (200, FinAFixtureData.reconciliation)
        case ("GET", "/admin/finance/audit"): return (200, FinAFixtureData.audit)
        case ("GET", "/admin/finance/settings"): return (200, FinAFixtureData.settings)
        case ("GET", "/admin/finance/expense-categories"): return (200, FinAFixtureData.categories)
        case ("GET", "/admin/finance/givers"):
            let q = (query["q"] ?? "").lowercased()
            guard let all = (object(FinAFixtureData.givers) as? [String: Any])?["data"] as? [[String: Any]] else { return (200, FinAFixtureData.givers) }
            let hits = all.filter { g in
                q.isEmpty || ["full_name", "phone", "email"].contains { ((g[$0] as? String) ?? "").lowercased().contains(q) }
            }
            return (200, text(["data": hits]) ?? #"{"data":[]}"#)
        case ("GET", "/admin/finance/needs"): return (200, FinAFixtureData.needs)
        case ("GET", "/admin/permissions/catalog"): return (200, FinAFixtureData.catalog)
        case ("GET", "/admin/roles"): return (200, FinAFixtureData.roles)
        case ("POST", "/admin/finance/gifts"):
            if (body["reference"] as? String)?.uppercased() == "QDUPL1CATE" {
                return err(409, "DUPLICATE_RECEIPT", "That M-Pesa code is already booked", ["transaction_id": "t-001"])
            }
            return (201, FinAFixtureData.giftOK)
        case ("POST", "/admin/finance/transfers"):
            let amount = (body["amount_minor"] as? Int) ?? 0
            if amount > 5_000_000, (body["allow_negative"] as? Bool) != true {
                return err(422, "UNPROCESSABLE", "The from-fund would go below zero",
                           ["reason": "NEGATIVE_BALANCE", "balance_minor": 5_000_000, "balance_after_minor": 5_000_000 - amount])
            }
            return (201, FinAFixtureData.transferOK)
        case ("POST", "/admin/finance/opening-balances"): return (201, FinAFixtureData.openingOK)
        case ("POST", "/admin/finance/funds"): return (201, FinAFixtureData.fundOK)
        case ("POST", "/admin/finance/expense-categories"):
            return (201, #"{"category_id":"c-new","code":"youth-ministry","name":"Youth ministry","is_active":true,"sort":110}"#)
        case ("PUT", _) where path.hasPrefix("/admin/roles/"): return (200, "{}")
        default: break
        }
        // Parameterised routes.
        if method == "GET", segments.count == 4, segments[0] == "admin", segments[1] == "finance", segments[2] == "transactions" {
            return detail(segments[3]) ?? err(404, "NOT_FOUND", "No such transaction")
        }
        if method == "GET", segments.count == 4, segments[2] == "journals" {
            return journal(segments[3]) ?? err(404, "NOT_FOUND", "No such journal")
        }
        if method == "POST", segments.count == 5, segments[2] == "transactions", segments[4] == "reverse" {
            return (200, FinAFixtureData.booksTransaction)
        }
        if method == "POST", segments.count == 5, segments[2] == "journals", segments[4] == "reverse" {
            if (body["allow_negative"] as? Bool) != true {
                return err(422, "UNPROCESSABLE", "The fund would go below zero",
                           ["reason": "NEGATIVE_BALANCE", "balance_minor": 20_000_000, "balance_after_minor": -30_000_000])
            }
            return journal(segments[3]) ?? err(404, "NOT_FOUND", "No such journal")
        }
        if method == "PATCH", segments.count == 4, segments[2] == "funds" {
            if (body["is_active"] as? Bool) == false, (body["force"] as? Bool) != true, segments[3] == "building" {
                return err(409, "FUND_IN_USE", "12 active pledges, 3 recurring gifts and 1 department still send money to Building fund",
                           ["active_pledges": 12, "active_schedules": 3, "departments": 1, "live_campaigns": 0])
            }
            return (200, FinAFixtureData.fundOK)
        }
        if method == "PATCH", segments.count == 4, segments[2] == "expense-categories" {
            return (200, #"{"category_id":"c-1","code":"utilities","name":"Utilities","is_active":true,"sort":20}"#)
        }
        return err(404, "NOT_FOUND", "Fixture harness: no data for \(method) \(path)")
    }

    private static func object(_ json: String) -> Any? { try? JSONSerialization.jsonObject(with: Data(json.utf8)) }
    private static func text(_ obj: Any) -> String? {
        (try? JSONSerialization.data(withJSONObject: obj)).flatMap { String(data: $0, encoding: .utf8) }
    }
    private static func detail(_ id: String) -> (Int, String)? {
        guard let all = object(FinAFixtureData.transactionDetails) as? [String: Any], let d = all[id], let s = text(d) else { return nil }
        return (200, s)
    }
    private static func journal(_ id: String) -> (Int, String)? {
        guard let all = object(FinAFixtureData.journalList) as? [[String: Any]],
              let j = all.first(where: { ($0["journal_id"] as? String) == id }), let s = text(j) else { return nil }
        return (200, s)
    }
}

/// Answers every http(s) request from FinanceAFixtures.respond — registered
/// only by installIfRequested (DEBUG + the environment flag).
final class FinAFixtureProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        guard let scheme = request.url?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let url = request.url else { return }
        let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
        var path = comps?.path ?? url.path
        if let r = path.range(of: "/v1/") { path = "/" + path[r.upperBound...] }
        var query: [String: String] = [:]
        for item in comps?.queryItems ?? [] { query[item.name] = item.value ?? "" }
        var bodyData = request.httpBody
        if bodyData == nil, let stream = request.httpBodyStream { bodyData = Self.read(stream) }
        let body = bodyData.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
        let (status, json) = FinanceAFixtures.respond(method: request.httpMethod ?? "GET", path: path, query: query, body: body)
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json; charset=utf-8"])
        // A beat of latency so loading states are real.
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.15) { [weak self] in
            guard let self, let response else { return }
            self.client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            self.client?.urlProtocol(self, didLoad: Data(json.utf8))
            self.client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        let size = 4096
        let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
        defer { buffer.deallocate() }
        while stream.hasBytesAvailable {
            let n = stream.read(buffer, maxLength: size)
            if n <= 0 { break }
            data.append(buffer, count: n)
        }
        return data
    }
}
#endif
