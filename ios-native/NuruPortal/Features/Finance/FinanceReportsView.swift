// Finance → Reports (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceReportsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeReports.title,
                            subtitle: "The year in figures, and the two financial statements.") {
            FinanceStubNote("Tabs: Income (by fund, channel or source × 12 months), Expenses (by category or fund), Pledges (pledged, paid, kept, missed, behind), Income & expenditure (a period) and Financial position (as of a date) — per currency, each with CSV.")
        }
    }
}
