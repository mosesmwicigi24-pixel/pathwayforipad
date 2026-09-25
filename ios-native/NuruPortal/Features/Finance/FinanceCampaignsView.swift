// Finance → Campaigns (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceCampaignsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeCampaigns.title,
                            subtitle: "Appeals — raised against goal, and how far they reached.") {
            FinanceStubNote("Campaigns with raised vs goal; create and edit (always as a draft), go live, end; and each campaign's reach (asked, shown, opened, gave, dismissed, declined).")
        }
    }
}
