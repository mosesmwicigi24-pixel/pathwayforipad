// Finance → Budgets (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceBudgetsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeBudgets.title,
                            subtitle: "The year's plan, and how the year is going against it.") {
            FinanceStubNote("The year's budget in KES — the lines editor (12 months per line, income by fund, expenses by category), approval, and budget vs actual with variance and the unbudgeted remainder.")
        }
    }
}
