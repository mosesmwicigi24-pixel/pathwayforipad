// Finance → Statements (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceStatementsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeStatements.title,
                            subtitle: "Year-end giving statements for every giver.") {
            FinanceStubNote("The year's givers — totals per currency, gifts, giving by fund, pledge paid — with each member's giving statement and partners statement PDFs, and the list as CSV.")
        }
    }
}
