// Finance → Recurring gifts (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceRecurringView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeRecurring.title,
                            subtitle: "Recurring gifts and how their collections are going.") {
            FinanceStubNote("Every recurring schedule with collection health — the needs-attention filter (paused or failing), consecutive failures and last error, next run, and run-rate totals per currency.")
        }
    }
}
