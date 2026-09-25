// Finance → Funds (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceFundsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeFunds.title,
                            subtitle: "Every fund's balance and movement.") {
            FinanceStubNote("Every fund with its balance per currency, income for the period and year, expenses, transfers in and out, last activity — create, rename, describe, reorder, deactivate; transfer between funds; and post an opening balance (a reversible journal).")
        }
    }
}
