// DEBUG-only preview harness for the B pages (Pledges, Partners, Claims,
// Recurring gifts, Campaigns, Department needs, Expenses, Budgets, Reports,
// Statements): shows one page with fixture data, for headless screenshots,
// without a token and without the live stack.
//
//   xcrun simctl launch <udid> org.nuruplace.portal  with
//     SIMCTL_CHILD_NURU_FINANCE_HARNESS=financeExpenses      (a Section raw value)
//     SIMCTL_CHILD_NURU_FINANCE_HARNESS_LINK="status=recorded" (optional deep link into the page)
//     SIMCTL_CHILD_NURU_FINANCE_HARNESS_ROLE=superadmin|approver|clerk (optional; default superadmin)
//
// Every HTTP(S) request the process makes is answered by
// FinanceBFixtureProtocol from FinanceBFixtures (unknown paths → 404, any write
// → 422 "Preview harness — nothing is saved"), so nothing leaves the device.
// The page shows in its own window above the normal app. Release builds carry
// none of this; unset, it does nothing.
#if DEBUG
import SwiftUI
import UIKit

enum FinanceBHarness {
    private static let env = ProcessInfo.processInfo.environment

    /// The page asked for, if any.
    static var requested: Section? {
        guard let raw = env["NURU_FINANCE_HARNESS"], !raw.isEmpty else { return nil }
        return Section(rawValue: raw)
    }
    static var role: String { env["NURU_FINANCE_HARNESS_ROLE"] ?? "superadmin" }
    /// NURU_FINANCE_HARNESS_SCROLL=<points>: show the page from that far down
    /// (headless screenshots of the lower part of a page).
    static var scroll: CGFloat { CGFloat(Double(env["NURU_FINANCE_HARNESS_SCROLL"] ?? "") ?? 0) }
    /// "a=1&b=2" → the deep link's params.
    static var link: [String: String] {
        var out: [String: String] = [:]
        for pair in (env["NURU_FINANCE_HARNESS_LINK"] ?? "").split(separator: "&") {
            let kv = pair.split(separator: "=", maxSplits: 1).map(String.init)
            if kv.count == 2 { out[kv[0]] = kv[1].removingPercentEncoding ?? kv[1] }
        }
        return out
    }

    private static var window: UIWindow?
    private static var observer: NSObjectProtocol?

    /// Called once from NuruPortalApp.init (Debug): a no-op unless requested.
    static func installIfRequested() {
        guard let section = requested, observer == nil else { return }
        URLProtocol.registerClass(FinanceBFixtureProtocol.self)
        observer = NotificationCenter.default.addObserver(forName: UIScene.didActivateNotification, object: nil, queue: .main) { note in
            guard let scene = note.object as? UIWindowScene else { return }
            MainActor.assumeIsolated { present(section, on: scene) }
        }
        print("FinanceBHarness: showing \(section.rawValue) with fixture data (role \(role))")
    }

    @MainActor private static func present(_ section: Section, on scene: UIWindowScene) {
        guard window == nil else { return }
        let w = UIWindow(windowScene: scene)
        w.windowLevel = .alert + 1
        w.rootViewController = UIHostingController(rootView: FinanceBHarnessRoot(section: section, link: link, role: role))
        w.makeKeyAndVisible()
        window = w
    }

    /// The /me the harness signs in as.
    static func profile(_ role: String) -> MeProfile? {
        guard let json = FinanceBFixtures.json["me_\(role)"] ?? FinanceBFixtures.json["me_superadmin"] else { return nil }
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return (try? d.decode(MeResponse.self, from: Data(json.utf8)))?.profile
    }
}

/// The page inside a stand-in of the portal's chrome (navy sidebar, top bar).
@MainActor
struct FinanceBHarnessRoot: View {
    let section: Section
    let link: [String: String]
    @StateObject private var auth: AuthStore
    @StateObject private var router = NavRouter()

    private static let pages: [Section] = [
        .financePledges, .partners, .financeClaims, .financeRecurring, .financeCampaigns, .financeNeeds,
        .financeExpenses, .financeBudgets, .financeReports, .financeStatements,
    ]

    init(section: Section, link: [String: String], role: String) {
        self.section = section
        self.link = link
        let store = AuthStore()
        store.profile = FinanceBHarness.profile(role)
        _auth = StateObject(wrappedValue: store)
    }

    private var current: Section { router.section.flatMap { Self.pages.contains($0) ? $0 : nil } ?? section }

    var body: some View {
        HStack(spacing: 0) {
            sidebar
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(current.breadcrumbTitle).font(.inter(17, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text("Preview harness · fixture data").font(.nMicro).foregroundStyle(Nuru.ink600)
                    }
                    Spacer()
                }
                .padding(.horizontal, 20).padding(.vertical, 10)
                .background(Nuru.white)
                .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
                if FinanceBHarness.scroll > 0 {
                    // Lay the page out tall enough for all of it, then show it from further down.
                    NavigationStack { page(current).toolbar(.hidden, for: .navigationBar) }
                        .id(current)
                        .frame(height: 5000)
                        .offset(y: -FinanceBHarness.scroll)
                        .frame(minHeight: 0, maxHeight: .infinity, alignment: .top)
                        .clipped()
                } else {
                    NavigationStack { page(current).toolbar(.hidden, for: .navigationBar) }
                        .id(current)
                }
            }
        }
        .environmentObject(auth)
        .environmentObject(router)
        .background(Nuru.paper.ignoresSafeArea())
        .preferredColorScheme(.light)
        .tint(Nuru.gold)
        .onAppear { router.openFinance(section, link) }
    }

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("NURU PATHWAY").font(.inter(12, .bold)).tracking(1.4).foregroundStyle(Nuru.goldGlow).padding(.bottom, 14)
            Text("FINANCE").font(.nOverline).tracking(1.4).foregroundStyle(.white.opacity(0.45)).padding(.bottom, 4)
            ForEach(Self.pages, id: \.self) { s in
                Button { router.go(s) } label: {
                    HStack(spacing: 10) {
                        Image(systemName: s.icon).font(.system(size: 13, weight: .semibold)).frame(width: 20)
                        Text(s.title).font(.inter(13.5, s == current ? .semibold : .medium))
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(s == current ? .white : .white.opacity(0.7))
                    .padding(.horizontal, 10).padding(.vertical, 8)
                    .background(s == current ? AnyShapeStyle(Nuru.gold.opacity(0.9)) : AnyShapeStyle(Color.clear))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(16)
        .frame(width: 236)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(Nuru.sidebarGradient.ignoresSafeArea())
    }

    @ViewBuilder private func page(_ s: Section) -> some View {
        switch s {
        case .financePledges: FinancePledgesView()
        case .partners: PartnersView()
        case .financeClaims: FinanceClaimsView()
        case .financeRecurring: FinanceRecurringView()
        case .financeCampaigns: FinanceCampaignsView()
        case .financeNeeds: FinanceNeedsView()
        case .financeExpenses: FinanceExpensesView()
        case .financeBudgets: FinanceBudgetsView()
        case .financeReports: FinanceReportsView()
        case .financeStatements: FinanceStatementsView()
        default: Text("\(s.rawValue) is not a B page.").font(.nBody).foregroundStyle(Nuru.ink600)
        }
    }
}

// MARK: - The fixture server

final class FinanceBFixtureProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool {
        guard let scheme = request.url?.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let answer = FinanceBFixtureRouter.respond(to: request)
        var headers = ["Content-Type": answer.type]
        if let d = answer.disposition { headers["Content-Disposition"] = d }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: answer.status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badURL))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

/// Route → fixture, with the filters the pages send applied the way the
/// server would (so a filter chip changes what the page shows).
enum FinanceBFixtureRouter {
    struct Answer {
        var status = 200
        var body = Data()
        var type = "application/json"
        var disposition: String? = nil
    }

    static func respond(to request: URLRequest) -> Answer {
        guard let url = request.url, let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return error(400, "BAD_REQUEST", "Bad request")
        }
        var path = comps.path
        if path.hasPrefix("/v1") { path.removeFirst(3) }
        var q: [String: String] = [:]
        for item in comps.queryItems ?? [] { if let v = item.value { q[item.name] = v } }
        guard (request.httpMethod ?? "GET") == "GET" else {
            return error(422, "PREVIEW", "Preview harness — nothing is saved here.")
        }
        let parts = path.split(separator: "/").map(String.init)

        if path.hasSuffix(".csv") {
            let name = (parts.last ?? "export.csv")
            return Answer(body: Data("preview,harness\nfixture,data\n".utf8), type: "text/csv; charset=utf-8",
                          disposition: "attachment; filename=\"\(name)\"")
        }
        if path.hasSuffix(".pdf") {
            // u-john has never been a partner in the fixtures → the 404 sentence shows.
            if path.contains("u-john"), path.hasSuffix("partners.pdf") { return error(404, "NOT_FOUND", "Not found") }
            return Answer(body: Data("%PDF-1.4\n% preview harness\n%%EOF\n".utf8), type: "application/pdf",
                          disposition: "attachment; filename=\"\(parts.last ?? "statement.pdf")\"")
        }

        switch path {
        case "/me": return fixture("me_\(FinanceBHarness.role)")
        case "/admin/finance/pledges": return pledges(q)
        case "/admin/partners": return partners(q)
        case "/admin/partners/claims": return fixture("claims")
        case "/admin/finance/schedules": return schedules(q)
        case "/admin/campaigns": return fixture("campaigns")
        case "/admin/finance/config": return fixture("config")
        case "/admin/finance/needs": return needs(q)
        case "/admin/finance/expenses": return expenses(q)
        case "/admin/finance/expense-categories": return fixture("categories")
        case "/admin/finance/funds": return fixture("funds")
        case "/admin/finance/audit": return fixture("audit")
        case "/admin/finance/budgets": return fixture("budgets")
        case "/admin/finance/reports/income": return fixture("income/\(q["by"] ?? "fund")")
        case "/admin/finance/reports/expenses": return fixture("expenses_report/\(q["by"] ?? "category")")
        case "/admin/finance/reports/pledges": return fixture("pledges_report")
        case "/admin/finance/reports/income-expenditure":
            return patched("ie") { obj in
                if let f = q["from"], let t = q["to"] { obj["period"] = ["from": f, "to": t] }
            }
        case "/admin/finance/reports/financial-position":
            return patched("position") { obj in if let a = q["as_of"] { obj["as_of"] = a } }
        case "/admin/finance/statements": return statements(q)
        default: break
        }
        // Paths with ids.
        if parts.count == 3, parts[0] == "admin", parts[1] == "partners" { return fixture("partner_details/\(parts[2])", notFound: "Not a partner") }
        if parts.count == 4, parts[0] == "admin", parts[1] == "campaigns", parts[3] == "reach" { return fixture("reach") }
        if parts.count == 4, parts[1] == "finance", parts[2] == "expenses" {
            let all = array("expenses")
            if let e = all.first(where: { ($0["expense_id"] as? String) == parts[3] }) { return json(e) }
            return error(404, "NOT_FOUND", "No such expense")
        }
        if parts.count == 4, parts[1] == "finance", parts[2] == "budgets" { return fixture("budget_\(parts[3])", notFound: "No such budget") }
        if parts.count == 5, parts[1] == "finance", parts[2] == "budgets", parts[4] == "actuals" {
            return fixture("actuals_\(parts[3])", notFound: "No such budget")
        }
        return error(404, "NOT_FOUND", "No fixture for \(path)")
    }

    // MARK: helpers

    private static func object(_ key: String) -> Any? {
        guard let s = FinanceBFixtures.json[key] else { return nil }
        return try? JSONSerialization.jsonObject(with: Data(s.utf8))
    }
    private static func array(_ key: String) -> [[String: Any]] { (object(key) as? [[String: Any]]) ?? [] }
    private static func json(_ obj: Any, status: Int = 200) -> Answer {
        Answer(status: status, body: (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8))
    }
    private static func fixture(_ key: String, notFound: String = "Not found") -> Answer {
        guard let s = FinanceBFixtures.json[key] else { return error(404, "NOT_FOUND", notFound) }
        return Answer(body: Data(s.utf8))
    }
    private static func patched(_ key: String, _ edit: (inout [String: Any]) -> Void) -> Answer {
        guard var obj = object(key) as? [String: Any] else { return error(404, "NOT_FOUND", "Not found") }
        edit(&obj)
        return json(obj)
    }
    private static func error(_ status: Int, _ code: String, _ message: String) -> Answer {
        json(["error": ["code": code, "message": message]], status: status)
    }
    private static func int(_ v: Any?) -> Int {
        if let i = v as? Int { return i }
        if let s = v as? String { return Int(s) ?? 0 }
        if let d = v as? Double { return Int(d) }
        return 0
    }
    private static func str(_ v: Any?) -> String { (v as? String) ?? "" }
    private static func matches(_ row: [String: Any], _ term: String?, _ keys: [String]) -> Bool {
        guard let t = term?.trimmingCharacters(in: .whitespaces).lowercased(), !t.isEmpty else { return true }
        return keys.contains { str(row[$0]).lowercased().contains(t) }
    }
    private static func sortCurrencies(_ a: [String: Any], _ b: [String: Any]) -> Bool {
        FinanceMoney.currencyPrecedes(str(a["currency"]), str(b["currency"]))
    }

    // MARK: filtered lists (the server's filters, applied to the fixtures)

    private static func pledges(_ q: [String: String]) -> Answer {
        let rows = array("pledges").filter { r in
            (q["status"].map { str(r["status"]) == $0 } ?? true)
                && (q["standing"].map { str(r["standing"]) == $0 } ?? true)
                && (q["shape"].map { str(r["shape"]) == $0 } ?? true)
                && (q["user_id"].map { str(r["user_id"]) == $0 } ?? true)
                && matches(r, q["q"], ["member_name", "member_phone", "title"])
        }
        var by: [String: [String: Any]] = [:]
        for r in rows {
            let c = str(r["currency"])
            var t = by[c] ?? ["currency": c, "amount_minor": 0, "count": 0, "pledged_minor": 0, "paid_minor": 0,
                              "remaining_minor": 0, "paid_toward_minor": 0, "paid_beyond_minor": 0]
            let pledged = int(r["pledged_year_minor"]), paid = int(r["paid_year_minor"])
            t["amount_minor"] = int(t["amount_minor"]) + pledged
            t["pledged_minor"] = int(t["pledged_minor"]) + pledged
            t["paid_minor"] = int(t["paid_minor"]) + paid
            t["remaining_minor"] = int(t["remaining_minor"]) + int(r["remaining_year_minor"])
            t["paid_toward_minor"] = int(t["paid_toward_minor"]) + min(paid, pledged)
            t["paid_beyond_minor"] = int(t["paid_beyond_minor"]) + max(paid - pledged, 0)
            t["count"] = int(t["count"]) + 1
            by[c] = t
        }
        return json(["year": Int(q["year"] ?? "") ?? 2026, "data": rows, "next_cursor": NSNull(),
                     "totals": by.values.sorted(by: sortCurrencies)])
    }

    private static func partners(_ q: [String: String]) -> Answer {
        guard var obj = object("partners") as? [String: Any], let all = obj["data"] as? [[String: Any]] else { return fixture("partners") }
        obj["data"] = all.filter { r in
            let status = ((r["membership"] as? [String: Any])?["status"] as? String) ?? ""
            let ok: Bool
            switch q["status"] ?? "all" {
            case "behind": ok = (r["behind"] as? Bool) == true
            case "active", "paused", "left": ok = status == q["status"]
            default: ok = true
            }
            return ok && matches(r, q["q"], ["full_name", "email"])
        }
        return json(obj)
    }

    private static func schedules(_ q: [String: String]) -> Answer {
        guard let obj = object("schedules") as? [String: Any], let all = obj["data"] as? [[String: Any]] else { return fixture("schedules") }
        let rows = all.filter { r in
            let status = str(r["status"])
            let statusOK = q["status"].map { status == $0 } ?? (status != "cancelled")
            let attentionOK = q["attention"] == "true" ? ((r["needs_attention"] as? Bool) == true && status != "cancelled") : true
            return statusOK && attentionOK
        }
        return json(["data": rows])
    }

    private static func needs(_ q: [String: String]) -> Answer {
        guard let obj = object("needs") as? [String: Any], let all = obj["data"] as? [[String: Any]] else { return fixture("needs") }
        let status = q["status"] ?? "approved"
        let rows = all.filter { (status == "all" || str($0["status"]) == status) && matches($0, q["q"], ["title", "department_name"]) }
        var by: [String: [String: Any]] = [:]
        for r in rows {
            let c = str(r["currency"])
            var t = by[c] ?? ["currency": c, "amount_minor": 0, "count": 0, "target_minor": 0, "raised_minor": 0]
            t["amount_minor"] = int(t["amount_minor"]) + int(r["raised_minor"])
            t["raised_minor"] = int(t["raised_minor"]) + int(r["raised_minor"])
            t["target_minor"] = int(t["target_minor"]) + int(r["target_minor"])
            t["count"] = int(t["count"]) + 1
            by[c] = t
        }
        return json(["data": rows, "next_cursor": NSNull(), "totals": by.values.sorted(by: sortCurrencies)])
    }

    private static func expenses(_ q: [String: String]) -> Answer {
        let statuses = Set((q["status"] ?? "").split(separator: ",").map(String.init))
        let rows = array("expenses").filter { e in
            (statuses.isEmpty || statuses.contains(str(e["status"])))
                && (q["fund"].map { str((e["fund"] as? [String: Any])?["code"]) == $0 } ?? true)
                && (q["category"].map { str((e["category"] as? [String: Any])?["code"]) == $0 } ?? true)
                && (q["from"].map { str(e["spent_on"]) >= $0 } ?? true)
                && (q["to"].map { str(e["spent_on"]) <= $0 } ?? true)
                && matches(e, q["q"], ["payee", "description", "reference"])
        }
        var totals: [String: [String: Any]] = [:], byStatus: [String: [String: Any]] = [:]
        for e in rows {
            let c = str(e["currency"]), s = str(e["status"]), a = int(e["amount_minor"])
            var t = totals[c] ?? ["currency": c, "amount_minor": 0, "count": 0]
            t["amount_minor"] = int(t["amount_minor"]) + a
            t["count"] = int(t["count"]) + 1
            totals[c] = t
            var b = byStatus["\(s)|\(c)"] ?? ["status": s, "currency": c, "amount_minor": 0, "count": 0]
            b["amount_minor"] = int(b["amount_minor"]) + a
            b["count"] = int(b["count"]) + 1
            byStatus["\(s)|\(c)"] = b
        }
        return json(["data": rows, "next_cursor": NSNull(), "totals": totals.values.sorted(by: sortCurrencies),
                     "totals_by_status": Array(byStatus.values)])
    }

    private static func statements(_ q: [String: String]) -> Answer {
        let rows = array("statements").filter { matches($0, q["q"], ["full_name", "phone", "email"]) }
        var by: [String: [String: Any]] = [:]
        for r in rows {
            for t in (r["totals"] as? [[String: Any]]) ?? [] {
                let c = str(t["currency"])
                var x = by[c] ?? ["currency": c, "amount_minor": 0, "count": 0]
                x["amount_minor"] = int(x["amount_minor"]) + int(t["amount_minor"])
                x["count"] = int(x["count"]) + int(t["count"])
                by[c] = x
            }
        }
        return json(["year": Int(q["year"] ?? "") ?? 2026, "data": rows, "next_cursor": NSNull(),
                     "totals": by.values.sorted(by: sortCurrencies)])
    }
}
#endif
