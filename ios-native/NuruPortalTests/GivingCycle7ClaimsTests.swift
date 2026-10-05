// Giving Cycle 7 — Finance → Claims: a claim in another currency than its
// pledge can only be rejected (Confirm disabled, "Pledge is in KES"), and a
// CURRENCY_MISMATCH on confirm is shown in the sheet — never read as "already
// decided", which is the server's UNPROCESSABLE (web Claims.tsx isAlreadyDecided).
import XCTest
@testable import NuruPortal

final class GivingCycle7ClaimsTests: XCTestCase {

    private static func claim(currency: String = "KES", mismatch: String = "") -> String {
        #"{"claim_id":"c-1","pledge_id":"p-1","user_id":"u-1","full_name":"Dollar Giver","amount_minor":"5000","#
            + #""currency":"\#(currency)","paid_on":"2026-09-18","note":null,"status":"pending","#
            + #""created_at":"2026-09-19T06:00:00.000Z","pledge_title":"Kenya trip""#
            + mismatch + "}"
    }

    // MARK: The rule

    func testAClaimInAnotherCurrencyCanOnlyBeRejected() throws {
        let usd = try Wire.decode(PledgeClaimRow.self, Self.claim(currency: "USD", mismatch: #","pledge_currency":"KES","currency_mismatch":true"#))
        XCTAssertEqual(usd.pledgeCurrency, "KES")
        XCTAssertTrue(usd.currencyMismatch)
        XCTAssertFalse(usd.canConfirm)
        XCTAssertEqual(usd.currencyMismatchNote, "Pledge is in KES")

        let kes = try Wire.decode(PledgeClaimRow.self, Self.claim(mismatch: #","pledge_currency":"KES","currency_mismatch":false"#))
        XCTAssertTrue(kes.canConfirm)
        XCTAssertNil(kes.currencyMismatchNote)
    }

    func testAClaimFromAnOlderServerCanStillBeConfirmed() throws {
        let old = try Wire.decode(PledgeClaimRow.self, Self.claim())
        XCTAssertNil(old.pledgeCurrency)
        XCTAssertFalse(old.currencyMismatch)
        XCTAssertTrue(old.canConfirm)
        XCTAssertNil(old.currencyMismatchNote)
        XCTAssertEqual(old.amountMinor, 5_000)
        // Flagged without the pledge's currency: still said, in general words.
        let flagged = try Wire.decode(PledgeClaimRow.self, Self.claim(mismatch: #","pledge_currency":null,"currency_mismatch":true"#))
        XCTAssertFalse(flagged.canConfirm)
        XCTAssertEqual(flagged.currencyMismatchNote, "Pledge is in another currency")
    }

    func testOnlyUnprocessableMeansAlreadyDecided() {
        func http(_ status: Int, _ code: String?) -> Error {
            APIError.http(status: status, message: "m", info: code.map { APIErrorInfo(code: $0, details: [:]) })
        }
        XCTAssertTrue(FinanceClaimsModel.isAlreadyDecided(http(422, "UNPROCESSABLE")))
        XCTAssertFalse(FinanceClaimsModel.isAlreadyDecided(http(422, "CURRENCY_MISMATCH")))
        XCTAssertTrue(FinanceClaimsModel.isAlreadyDecided(http(422, nil)))       // a bare 422, as before
        XCTAssertFalse(FinanceClaimsModel.isAlreadyDecided(http(404, "NOT_FOUND")))
        XCTAssertFalse(FinanceClaimsModel.isAlreadyDecided(http(400, "VALIDATION_FAILED")))
        XCTAssertFalse(FinanceClaimsModel.isAlreadyDecided(APIError.transport("offline")))
    }

    // MARK: Confirming, on the wire

    override func tearDown() {
        StubHTTP.uninstall()
        super.tearDown()
    }

    @MainActor
    func testACurrencyMismatchOnConfirmStaysInTheSheet() async throws {
        let words = "This claim is in USD but the pledge is in KES. Reject it and ask the member to tell us again in KES."
        StubHTTP.install { seen in
            seen.method == "POST"
                ? .init(status: 422, json: #"{"error":{"code":"CURRENCY_MISMATCH","message":"\#(words)","details":{"expected":"KES"}}}"#)
                : .init(status: 200, json: #"{"data":[]}"#)
        }
        let vm = FinanceClaimsModel()
        let c = try Wire.decode(PledgeClaimRow.self, Self.claim(currency: "USD", mismatch: #","pledge_currency":"KES","currency_mismatch":true"#))
        do {
            try await vm.decide(c, confirm: true)
            XCTFail("a CURRENCY_MISMATCH must reach the sheet")
        } catch {
            XCTAssertEqual(error.apiCode, "CURRENCY_MISMATCH")
            XCTAssertEqual(FinBError.message(error, fallback: "Could not confirm the claim."), words)
        }
        XCTAssertNil(vm.notice, "not reported as already decided")
        XCTAssertEqual(StubHTTP.seen.map(\.method), ["POST"], "no reload — the claim is still waiting")
        XCTAssertEqual(StubHTTP.seen.first?.path, "/v1/admin/partners/claims/c-1/confirm")
    }

    @MainActor
    func testAnUnprocessableOnConfirmIsAlreadyDecided() async throws {
        StubHTTP.install { seen in
            seen.method == "POST"
                ? .init(status: 422, json: #"{"error":{"code":"UNPROCESSABLE","message":"Claim already confirmed"}}"#)
                : .init(status: 200, json: #"{"data":[]}"#)
        }
        let vm = FinanceClaimsModel()
        let c = try Wire.decode(PledgeClaimRow.self, Self.claim())
        try await vm.decide(c, confirm: true)               // not thrown: the queue catches up
        XCTAssertEqual(vm.notice, .warn("Claim already confirmed"))
        XCTAssertEqual(StubHTTP.seen.map(\.method), ["POST", "GET"])
        XCTAssertEqual(StubHTTP.seen.last?.path, "/v1/admin/partners/claims")
    }
}
