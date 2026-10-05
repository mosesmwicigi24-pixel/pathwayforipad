// The Finance kit's DEBUG self-check (FinanceKit.swift FinanceSelfCheck — money
// formatting and parsing, EAT periods, caps, status words, deep links, the
// A and B pages' helpers, the sidebar), run as a unit test too. It still
// asserts at every Debug launch; here a failure names each broken rule
// instead of stopping the app.
import XCTest
@testable import NuruPortal

final class FinanceSelfCheckTests: XCTestCase {
    func testFinanceSelfCheckPasses() {
        let result = FinanceSelfCheck.run()
        XCTContext.runActivity(named: "FinanceSelfCheck ran \(result.checks) checks") { _ in }
        XCTAssertGreaterThan(result.checks, 0, "the self-check ran no checks")
        XCTAssertEqual(result.failures, [], "FinanceSelfCheck: \(result.failures.count) of \(result.checks) failed")
    }
}
