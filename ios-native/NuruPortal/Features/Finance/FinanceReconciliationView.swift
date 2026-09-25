// Finance → Reconciliation (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceReconciliationView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeReconciliation.title,
                            subtitle: "Does the money on hand match the books?") {
            FinanceStubNote("Tabs: Daily settlement per cash channel (received, reversed, net), Exceptions (stale processing, failed, missing or unbalanced ledger, duplicate receipts, unbalanced journals) and Integrity (debits = credits per currency).")
        }
    }
}
