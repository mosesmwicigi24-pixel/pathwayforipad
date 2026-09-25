// Finance → Overview (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceOverviewView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeOverview.title,
                            subtitle: "Where the money stands — per currency, never added together.") {
            FinanceStubNote("A period picker; KPI tiles per currency (income, expenses, net, outstanding pledges, partners behind); the 12-month income vs expenses series per currency; fund balances; receipts per channel; and alerts that deep-link to their queues (claims waiting, expenses to approve, failing schedules, stale processing, integrity issues).")
        }
    }
}
