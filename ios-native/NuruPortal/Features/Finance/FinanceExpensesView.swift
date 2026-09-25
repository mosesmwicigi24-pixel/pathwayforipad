// Finance → Expenses (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceExpensesView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeExpenses.title,
                            subtitle: "Money out — recorded, approved by someone else, posted.") {
            FinanceStubNote("The expense register with totals by status and currency: record, correct while recorded, approve (maker-checker — a different person, or a SuperAdmin), void with a reason (a reversing journal if it was approved); CSV.")
        }
    }
}
