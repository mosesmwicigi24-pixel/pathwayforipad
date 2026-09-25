// Finance → Claims (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceClaimsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeClaims.title,
                            subtitle: "“I paid another way” — confirm or reject.") {
            FinanceStubNote("The claims queue as its own page, oldest first: confirm (records an office gift with ledger and receipt) or reject (the member is told).")
        }
    }
}
