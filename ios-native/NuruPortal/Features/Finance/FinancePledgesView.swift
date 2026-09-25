// Finance → Pledges (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinancePledgesView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financePledges.title,
                            subtitle: "Every commitment, read from the instalment ledger.") {
            FinanceStubNote("The pledge register — standing chips, kept of due, next due, overdue since, pledged / paid / remaining for the year per currency, CSV; a row opens that member's partner drawer.")
        }
    }
}
