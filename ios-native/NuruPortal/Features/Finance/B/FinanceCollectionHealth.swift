// Finance → Recurring gifts: "How collection is going" (Giving Cycle 9 —
// pathway docs/GIVING.md; the web's Recurring.tsx CollectionHealthCard). The
// page opens with it: an outage banner when M-Pesa itself looks unwell, then
// the window's success rate and the gifts our side could not send, failures by
// reason in the words members were told — whose answer it was — and what the
// rest of the month should bring in, per currency, each gift weighted by its
// own record. GET /admin/finance/collection-health?days=30; a failed read (an
// older server) shows no card and never holds the page.
// The words are pure; NuruPortalTests/GivingCycle9HealthTests pins them.
import SwiftUI

// MARK: - The words

enum FinBCollectionHealthWords {
    static let title = "How collection is going"
    static let successRateTitle = "Success rate"
    static let reasonsTitle = "Why prompts failed"
    static let forecastTitle = "Rest of the month, expected"
    static let noFailures = "None failed."
    static let noForecast = "No recurring prompts left this month."
    static let outageLead = "M-Pesa looks unwell right now."
    static let forecastHelp = "Each gift's remaining prompts this month, weighted by how often that gift has been paid (its last six answered prompts)."

    /// "M-Pesa prompts in the last 30 days — 6 paid of 12 answered, 1 still
    /// waiting." — the waiting part only when some are.
    static func subtitle(_ h: FinCollectionHealth) -> String {
        var s = "M-Pesa prompts in the last \(h.windowDays) days — \(count(h.paid)) paid of \(count(h.paid + h.failed)) answered"
        if h.waiting > 0 { s += ", \(count(h.waiting)) still waiting" }
        return s + "."
    }

    /// The rate as a whole percent, rounded like the web (Math.round: halves
    /// up); "—" when nothing was answered.
    static func successRate(_ rate: Double?) -> String {
        guard let rate, rate.isFinite else { return "—" }
        return "\(Int((rate * 100 + 0.5).rounded(.down)))%"
    }

    /// Under the rate, only when there are some: gifts our side could not send
    /// today — the givers were never told, so only the office can know.
    static func notSentByUs(_ n: Int) -> String? {
        guard n > 0 else { return nil }
        return "\(count(n)) recurring \(n == 1 ? "gift" : "gifts") not sent by us today — the givers were not told."
    }

    /// The banner, only while an outage is suspected: the bold lead, then the
    /// server's evidence and what it means.
    static func outage(_ o: FinCollectionHealth.Outage?) -> (lead: String, rest: String)? {
        guard let o, o.suspected else { return nil }
        let evidence = o.evidence?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let rest = [evidence, "Gifts may fail until it recovers — nothing to fix on our side."]
            .filter { !$0.isEmpty }.joined(separator: " ")
        return (outageLead, rest)
    }

    /// Whose answer a failure was.
    static func whose(_ memberAnswered: Bool) -> String {
        memberAnswered ? "(their answer)" : "(never reached them)"
    }

    /// One reason: "3", "We couldn't reach the phone.", "(never reached them)".
    static func reasonParts(_ r: FinCollectionHealth.Reason) -> (count: String, reason: String, whose: String) {
        (count(r.count), r.reason, whose(r.memberAnswered))
    }

    /// One currency's forecast: "KES 6,000.00", " of KES 7,000.00 scheduled",
    /// " · 3 prompts, 2 gifts" — the web's own words (it does not singularise).
    static func forecastParts(_ f: FinCollectionHealth.Forecast) -> (expected: String, scheduled: String, detail: String) {
        (FinanceMoney.format(f.expectedMinor, f.currency),
         " of \(FinanceMoney.format(f.scheduledMinor, f.currency)) scheduled",
         " · \(count(f.prompts)) prompts, \(count(f.gifts)) gifts")
    }

    /// The forecast lines, one per currency, KES first then A–Z — never added.
    static func forecastLines(_ h: FinCollectionHealth) -> [FinCollectionHealth.Forecast] {
        h.forecast.sorted { FinanceMoney.currencyPrecedes($0.currency, $1.currency) }
    }

    /// A count with thousands separated by commas, as the web's toLocaleString.
    static func count(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out.append(",") }
            out.append(ch)
        }
        return (n < 0 ? "-" : "") + out
    }
}

// MARK: - The card

/// The top of Recurring gifts: the house B card, an error banner while M-Pesa
/// looks unwell, then three blocks that sit side by side when there is room
/// (≥ 240 pt each, the web's auto-fit grid) and stack in a narrow window.
struct FinanceCollectionHealthCard: View {
    let health: FinCollectionHealth
    private typealias W = FinBCollectionHealthWords

    var body: some View {
        FinBCard(title: W.title, caption: W.subtitle(health), icon: "waveform.path.ecg") {
            VStack(alignment: .leading, spacing: 14) {
                if let o = W.outage(health.outage) { outageBanner(o) }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 16, alignment: .topLeading)],
                          alignment: .leading, spacing: 14) {
                    block(W.successRateTitle) { successRate }
                    block(W.reasonsTitle) { reasons }
                    block(W.forecastTitle) { forecast }
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var successRate: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(W.successRate(health.successRate))
                .font(.nMono(22, .medium)).foregroundStyle(Nuru.navy).monospacedDigit()
            if let line = W.notSentByUs(health.notSentByUs) {
                Text(line).font(.nCaption).foregroundStyle(FinanceStatus.rose.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder private var reasons: some View {
        if health.byReason.isEmpty {
            Text(W.noFailures).font(.inter(12.5)).foregroundStyle(Nuru.ink400)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(health.byReason.enumerated()), id: \.offset) { _, r in
                    let p = W.reasonParts(r)
                    (Text(p.count).font(.nMono(12.5, .medium))
                        + Text(" \(p.reason) ").font(.inter(12.5))
                        + Text(p.whose).font(.inter(11)).foregroundStyle(Nuru.ink400))
                        .foregroundStyle(Nuru.navy)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder private var forecast: some View {
        let lines = W.forecastLines(health)
        if lines.isEmpty {
            Text(W.noForecast).font(.inter(12.5)).foregroundStyle(Nuru.ink400)
        } else {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, f in
                    let p = W.forecastParts(f)
                    (Text(p.expected).font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                        + Text(p.scheduled).font(.inter(12.5)).foregroundStyle(Nuru.navy)
                        + Text(p.detail).font(.inter(12.5)).foregroundStyle(Nuru.ink400))
                        .monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                        .help(W.forecastHelp)
                }
            }
        }
    }

    /// A block: the small overline label of FinBKeyValue, then its content.
    private func block<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased()).font(.inter(10.5, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                .fixedSize(horizontal: false, vertical: true)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }

    /// The error notice (FinanceNoticeBar's look, in the kit's error tone) with
    /// the web's bold lead.
    private func outageBanner(_ o: (lead: String, rest: String)) -> some View {
        let t = FinanceARules.colors(.error)
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 12, weight: .bold))
            (Text(o.lead).font(.inter(12.5, .bold)) + Text(" " + o.rest).font(.inter(12.5, .medium)))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(t.fg)
        .padding(.horizontal, 12).padding(.vertical, 9)
        .background(t.bg)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous).stroke(t.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
