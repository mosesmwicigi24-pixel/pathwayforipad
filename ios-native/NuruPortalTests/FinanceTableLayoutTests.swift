// Seen on screen (Giving Cycle 7 on-screen check, iPad Air 13", local API):
// a Finance table laid out wide (landscape) and then offered less width
// (rotated to portrait, Split View, a narrower Mac window) kept its wide
// layout — the grid's own floors held its width measurement up — and widened
// the WHOLE page, clipping it on both sides. The table must follow the width
// it is offered both ways, scrolling sideways when that is narrower than its
// columns.
import XCTest
import SwiftUI
@testable import NuruPortal

final class FinanceTableLayoutTests: XCTestCase {
    private struct Row: Identifiable { let id: Int }

    /// Let SwiftUI land its state changes (the width measurement) between layouts.
    @MainActor
    private func settle(_ host: UIViewController) {
        for _ in 0..<4 {
            host.view.setNeedsLayout()
            host.view.layoutIfNeeded()
            RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        }
    }

    @MainActor
    func testATableFollowsTheOfferedWidthBothWays() throws {
        let cols = [FinanceColumn("Wide", width: 300), FinanceColumn("Wider", width: 300)]   // floors 644 with gaps + padding
        let table = FinanceTable(rows: [Row(id: 1)], columns: cols) { _ in
            Text("a").financeCell(cols[0])
            Text("b").financeCell(cols[1])
        }
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let window = UIWindow(windowScene: scene)
        let host = UIHostingController(rootView: table)
        window.rootViewController = host
        window.frame = CGRect(x: 0, y: 0, width: 1000, height: 700)
        window.isHidden = false
        defer { window.isHidden = true }

        settle(host)
        XCTAssertEqual(host.sizeThatFits(in: CGSize(width: 1000, height: 700)).width, 1000, accuracy: 1,
                       "wide: the table fills the offered width")

        // Narrower than the columns' floors (644): the table stays inside the
        // offered width and scrolls sideways.
        window.frame = CGRect(x: 0, y: 0, width: 500, height: 700)
        settle(host)
        XCTAssertLessThanOrEqual(host.sizeThatFits(in: CGSize(width: 500, height: 700)).width, 501,
                                 "narrowed after a wide layout: the table never widens the page")

        // And back.
        window.frame = CGRect(x: 0, y: 0, width: 1000, height: 700)
        settle(host)
        XCTAssertEqual(host.sizeThatFits(in: CGSize(width: 1000, height: 700)).width, 1000, accuracy: 1)
    }
}
