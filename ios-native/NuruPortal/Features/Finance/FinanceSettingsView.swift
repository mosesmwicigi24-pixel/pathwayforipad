// Finance → Settings (pathway docs/FINANCE_ERP.md §5). STUB — the page agent
// replaces the body; the header, breadcrumb and routing are already wired.
import SwiftUI

struct FinanceSettingsView: View {
    var body: some View {
        FinancePageScaffold(title: Section.financeSettings.title,
                            subtitle: "How Finance is set up.") {
            FinanceStubNote("Expense categories (add, rename, reorder, deactivate), payment providers (configured or not — environment names only, never values), the next office receipt number, giving tiers, the reminder policy, and which capability (view, export, manage, approve) allows what.")
        }
    }
}
