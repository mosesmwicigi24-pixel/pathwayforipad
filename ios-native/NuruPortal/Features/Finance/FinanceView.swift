// Finance — fund balances + this-month giving, from /admin/finance/summary.
// Read-only (the money path is server-authoritative & PCI SAQ-A, §5.6).
import SwiftUI

struct FinanceView: View {
    var body: some View {
        AsyncView(PortalAPI.financeSummary) { funds in
            ScrollView {
                VStack(spacing: 12) {
                    ForEach(funds) { fund in
                        Card {
                            VStack(alignment: .leading, spacing: 10) {
                                HStack {
                                    Text(fund.name).font(.nHeading).foregroundStyle(Nuru.navy)
                                    Spacer()
                                    Pill(text: "\(fund.giftCount) gifts", color: Nuru.navy)
                                }
                                HStack(alignment: .firstTextBaseline, spacing: 24) {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(Fmt.money(minor: fund.totalMinor, currency: fund.currency))
                                            .font(.nuruDisplay(26)).foregroundStyle(Nuru.gold)
                                        Text("Total").font(.nMicro).foregroundStyle(Nuru.muted)
                                    }
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(Fmt.money(minor: fund.monthMinor, currency: fund.currency))
                                            .font(.fraunces(22, .semibold)).foregroundStyle(Nuru.navy)
                                        Text("This month").font(.nMicro).foregroundStyle(Nuru.muted)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .portalPage("Finance")
    }
}
