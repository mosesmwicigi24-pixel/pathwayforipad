// Seen on screen (Giving Cycle 7 on-screen check, iPad Air 13", local API):
// a Finance table laid out wide (landscape) and then offered less width
// (rotated to portrait, Split View, a narrower Mac window) kept its wide
// layout — the grid's own floors held its width measurement up — and widened
// the WHOLE page, clipping it on both sides. The table must follow the width
// it is offered both ways, scrolling sideways when that is narrower than its
// columns. And Recurring gifts' columns grow with the reader's text size.
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

    func testRecurringColumnsGrowWithTheReadersTextSize() {
        let base = FinanceRecurringView.columns(manage: true)
        XCTAssertEqual(base.map(\.title), ["Member", "Gift · fund · method", "Next · last run", "Failures", "Status", "Office"])
        XCTAssertEqual(base.map { $0.width ?? $0.minWidth }, [130, 180, 124, 140, 160, 104])
        let large = FinanceRecurringView.columns(manage: true, scale: 2.35)
        for (b, l) in zip(base, large) {
            XCTAssertEqual((l.width ?? l.minWidth), (b.width ?? b.minWidth) * 2.35, accuracy: 0.001, b.title)
            XCTAssertEqual(l.width == nil, b.width == nil, "\(b.title) keeps its kind (fixed or flexible)")
        }
        // Smaller text never squeezes the columns below their default size.
        XCTAssertEqual(FinanceRecurringView.columns(manage: true, scale: 0.8).map { $0.width ?? $0.minWidth },
                       [130, 180, 124, 140, 160, 104])
        // The office's column only with finance:manage.
        XCTAssertEqual(FinanceRecurringView.columns(manage: false).map(\.title),
                       ["Member", "Gift · fund · method", "Next · last run", "Failures", "Status"])
    }
}
