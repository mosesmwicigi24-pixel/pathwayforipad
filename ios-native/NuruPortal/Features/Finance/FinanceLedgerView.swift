// Finance → Ledger (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceLedgerView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeLedger.title,
                            subtitle: "The books — every posting, balanced.") {
            FinanceStubNote("Tabs: Journal (every posting with its source — receipt or journal kind and memo — filters, CSV), Trial balance (per account and currency, with the balanced check) and Journals (expenses, voids, transfers, opening balances and reversals, with Reverse).")
        }
    }
}
