// Finance → Department needs (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceNeedsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeNeeds.title,
                            subtitle: "Department needs as Finance sees them.") {
            FinanceStubNote("Needs with target vs raised, gifts and where a gift routes (the department's fund) — read-only; approving a need stays in Departments.")
        }
    }
}
