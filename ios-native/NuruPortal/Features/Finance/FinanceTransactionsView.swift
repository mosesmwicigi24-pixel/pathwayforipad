// Finance → Transactions (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceTransactionsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeTransactions.title,
                            subtitle: "Every gift and payment, online and at the office.") {
            FinanceStubNote("Filters (dates, fund, status, channel, source, pledged, need, search), per-currency totals for the whole filtered set, the keyset-paged register with CSV, a detail drawer (ledger legs, receipt, member / pledge / need links, Reverse for office entries) and Record a gift (member search or walk-in / anonymous, fund, amount, channel, reference, date, optional pledge or need). Office receipts are OR-<year>-<5 digits>; the M-Pesa code, cheque number or bank reference is the office reference.")
        }
    }
}
