// Finance → Audit (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceAuditView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeAudit.title,
                            subtitle: "Who did what to the money, and when.") {
            FinanceStubNote("The finance audit trail — filter by action family (giving, pledge, expense, budget, journal, fund, finance…), actor and dates; keyset-paged; each entry's details in a drawer.")
        }
    }
}
