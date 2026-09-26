// Finance → Settings (pathway docs/FINANCE_ERP.md §5–§6):
//  • Expense categories (GET/POST/PATCH /admin/finance/expense-categories): add,
//    rename, reorder, activate / deactivate (finance:manage). Codes are
//    permanent slugs; categories are never deleted.
//  • Read-only (GET /admin/finance/settings): which payment providers are
//    configured (the env var NAMES they read — never a value), the next office
//    receipt number, the giving tiers and the reminder policy.
//  • Who can do what: the four Finance capabilities and what each allows.
// Same content and words as the web's Finance → Settings.
import SwiftUI

@MainActor
final class FinanceSettingsModel: ObservableObject {
    @Published private(set) var settings: FinSettings?
    @Published private(set) var settingsError: String?
    /// In the server's order (sort, then name) — the order the pickers show.
    @Published private(set) var categories: [FinExpenseCategory] = []
    @Published private(set) var categoriesError: String?
    @Published private(set) var loadingCategories = true
    /// "reorder", "act-<id>", "deactivate" while a write runs.
    @Published private(set) var busy: String?
    @Published var error: String?
    @Published var toast: ToastData?

    func load() async {
        async let s: Void = loadSettings()
        async let c: Void = loadCategories()
        _ = await (s, c)
    }

    func loadSettings() async {
        do { settings = try await FinanceERPAPI.settings(); settingsError = nil }
        catch { if !Task.isCancelled { settingsError = FinanceARules.message(error, fallback: "Could not load the Finance settings.") } }
    }

    func loadCategories() async {
        loadingCategories = true
        defer { loadingCategories = false }
        do { categories = try await FinanceERPAPI.expenseCategories(); categoriesError = nil }
        catch { if !Task.isCancelled { categoriesError = FinanceARules.message(error, fallback: "Could not load the expense categories.") } }
    }

    /// The next category goes to the end of the list.
    var nextSort: Int { (categories.map(\.sort).max() ?? 0) + 10 }

    /// One write, then the list as it now stands (the web's run()).
    private func run(_ key: String, fallback: String, _ work: () async throws -> Void) async {
        busy = key
        error = nil
        do { try await work() } catch { self.error = FinanceARules.message(error, fallback: fallback) }
        busy = nil
        await loadCategories()
    }

    /// Move a category one place up (−1) or down (+1): renumber the whole list
    /// 10, 20, 30… and PATCH only the categories whose sort changes (the web's reorderPlan).
    func move(at index: Int, by dir: Int) async {
        let plan = FinanceARules.reorderPlan(categories.map { ($0.categoryId, $0.sort) }, index: index, dir: dir)
        guard !plan.isEmpty else { return }
        await run("reorder", fallback: "Not all of the new order was saved — the list below is as it stands now; try the move again.") {
            for p in plan { _ = try await FinanceERPAPI.updateExpenseCategory(p.id, FinExpenseCategoryPatch(sort: p.sort)) }
        }
    }

    func activate(_ c: FinExpenseCategory) async {
        await run("act-\(c.categoryId)", fallback: "The category was not activated.") {
            _ = try await FinanceERPAPI.updateExpenseCategory(c.categoryId, FinExpenseCategoryPatch(isActive: true))
            toast = .success("\(c.name) is active again.")
        }
    }

    func deactivate(_ c: FinExpenseCategory) async {
        await run("deactivate", fallback: "The category was not deactivated.") {
            _ = try await FinanceERPAPI.updateExpenseCategory(c.categoryId, FinExpenseCategoryPatch(isActive: false))
            toast = .success("\(c.name) deactivated.")
        }
    }
}

extension FinanceARules {
    /// Swap the item at `index` with its neighbour (`dir` −1 up / +1 down), renumber
    /// 10, 20, 30… and return only the ids whose sort changes (the web's reorderPlan).
    static func reorderPlan(_ list: [(id: String, sort: Int)], index: Int, dir: Int) -> [(id: String, sort: Int)] {
        let target = index + dir
        guard list.indices.contains(index), list.indices.contains(target) else { return [] }
        var next = list
        next.swapAt(index, target)
        var plan: [(id: String, sort: Int)] = []
        for (i, c) in next.enumerated() where c.sort != (i + 1) * 10 {
            plan.append((id: c.id, sort: (i + 1) * 10))
        }
        return plan
    }
}

/// Add a category, or rename one.
enum FinACategorySheet: Identifiable {
    case add
    case rename(FinExpenseCategory)
    var id: String {
        switch self { case .add: "add"; case .rename(let c): "rename:\(c.categoryId)" }
    }
}

struct FinanceSettingsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceSettingsModel()
    @State private var sheet: FinACategorySheet?
    @State private var deactivating: FinExpenseCategory?
    @State private var width: CGFloat = 0
    private var narrow: Bool { width > 0 && width < 640 }

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeSettings.title,
                            subtitle: "Expense categories you can change; how payments, receipt numbers, tiers and reminders are set up; and which capability allows what.",
                            onRefresh: { await vm.load() }) {
            categoriesSection(caps)
            if let s = vm.settings {
                providersCard(s)
                numberingCard(s)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 420), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                    tiersCard(s)
                    remindersCard(s)
                }
            } else {
                FinACard(title: "Providers, receipts, tiers and reminders") {
                    if let e = vm.settingsError {
                        ErrorBanner(message: e) { Task { await vm.loadSettings() } }
                    } else {
                        Skeleton(height: 60)
                    }
                }
            }
            whoCanCard(caps)
        }
        .task { await vm.load() }
        .sheet(item: $sheet) { s in
            FinACategoryEditor(mode: s, nextSort: vm.nextSort) { message in
                vm.toast = .success(message)
                Task { await vm.loadCategories() }
            }
        }
        .alert(deactivating.map { "Deactivate \($0.name)?" } ?? "Deactivate?",
               isPresented: Binding(get: { deactivating != nil }, set: { if !$0 { deactivating = nil } })) {
            Button("Deactivate", role: .destructive) {
                if let c = deactivating { Task { await vm.deactivate(c) } }
                deactivating = nil
            }
            Button("Cancel", role: .cancel) { deactivating = nil }
        } message: {
            Text("It disappears from the pickers for new expenses and budget lines. Expenses already recorded keep it, and the reports still show them. You can activate it again at any time.")
        }
        .toast($vm.toast)
    }

    // MARK: Expense categories

    /// Only the manage layout (arrows + two action buttons) needs to fold.
    private func folds(_ manage: Bool) -> Bool { manage && narrow }

    private func categoryColumns(_ manage: Bool) -> [FinanceColumn] {
        var cols: [FinanceColumn] = []
        if manage { cols.append(FinanceColumn("Order", width: 74)) }
        if folds(manage) {
            // 11" portrait / split view: the status folds under the name so both
            // actions keep their words side by side.
            cols.append(FinanceColumn("Name · code · status", minWidth: 150))
        } else {
            cols.append(FinanceColumn("Name", minWidth: 170))
            cols.append(FinanceColumn("Code", width: 170))
            cols.append(FinanceColumn("Status", width: 90))
        }
        if manage { cols.append(FinanceColumn("", width: 210, align: .trailing)) }
        return cols
    }

    @ViewBuilder private func categoriesSection(_ caps: FinanceCaps) -> some View {
        FinACard(icon: "tag", title: "Expense categories") {
            if caps.manage {
                FinanceButton(title: "Add category", icon: "plus") { sheet = .add }
            }
        } content: {
            FinAExplain("What money is spent on — used by expenses, budgets and the expense reports. Codes are permanent; a category is deactivated, never deleted.")
            if let e = vm.error { FinanceNoticeBar(notice: .error(e)) { vm.error = nil } }
            if let e = vm.categoriesError {
                ErrorBanner(message: e) { Task { await vm.loadCategories() } }
            } else if vm.loadingCategories && vm.categories.isEmpty {
                SkeletonTable(rows: 3)
            } else if vm.categories.isEmpty {
                EmptyState.compact(icon: "tag", message: "No categories yet. " + (caps.manage ? "Add the first with Add category." : "Someone with finance:manage can add them."))
            } else {
                categoriesTable(caps)
            }
        }
    }

    private func categoriesTable(_ caps: FinanceCaps) -> some View {
        let cols = categoryColumns(caps.manage)
        let list = vm.categories
        let narrow = folds(caps.manage)
        let manage = caps.manage
        let o = manage ? 1 : 0
        let rows = list.enumerated().map { FinAIndexed(index: $0.offset, value: $0.element) }
        return FinanceTable(rows: rows, columns: cols, emptyIcon: "tag", emptyMessage: "") { r in
            let c = r.value
            if manage {
                HStack(spacing: 2) {
                    arrow("arrow.up", "Move \(c.name) up", disabled: r.index == 0) { Task { await vm.move(at: r.index, by: -1) } }
                    arrow("arrow.down", "Move \(c.name) down", disabled: r.index == list.count - 1) { Task { await vm.move(at: r.index, by: 1) } }
                }
                .financeCell(cols[0])
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(c.name).font(.inter(13.5, .semibold)).foregroundStyle(c.isActive ? Nuru.navy : Nuru.ink400).lineLimit(2)
                if narrow {
                    Text(c.code).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                    FinanceStatusChip(status: c.isActive ? "active" : "inactive", label: c.isActive ? "Active" : "Inactive")
                }
            }
            .financeCell(cols[o])
            if !narrow {
                Text(c.code).font(.nMono(12)).foregroundStyle(Nuru.ink400).lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[o + 1])
                FinanceStatusChip(status: c.isActive ? "active" : "inactive", label: c.isActive ? "Active" : "Inactive")
                    .financeCell(cols[o + 2])
            }
            if manage {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { rowActions(c) }
                    VStack(alignment: .trailing, spacing: 6) { rowActions(c) }
                }
                .financeCell(cols[cols.count - 1])
            }
        }
        .opacity(vm.busy == "reorder" ? 0.55 : 1)
        .measureWidth($width)
    }

    @ViewBuilder private func rowActions(_ c: FinExpenseCategory) -> some View {
        FinanceButton(title: "Rename", icon: "pencil") { sheet = .rename(c) }
        if c.isActive {
            FinanceButton(title: "Deactivate") { deactivating = c }
                .disabled(vm.busy != nil)
        } else {
            FinanceButton(title: "Activate", busy: vm.busy == "act-\(c.categoryId)") { Task { await vm.activate(c) } }
                .disabled(vm.busy != nil && vm.busy != "act-\(c.categoryId)")
        }
    }

    private func arrow(_ icon: String, _ label: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                .foregroundStyle(Nuru.navy)
                .frame(width: 30, height: 30)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(disabled ? 0.3 : 1)
        .disabled(disabled || vm.busy != nil)
        .accessibilityLabel(label)
    }

    // MARK: Read-only

    private func providersCard(_ s: FinSettings) -> some View {
        FinACard(icon: "creditcard", title: "Payment providers") {
            FinAExplain("Whether each online channel is set up on the server. Keys live on the server only — this page never shows a value.")
            VStack(spacing: 0) {
                ForEach(Array(s.providers.enumerated()), id: \.element.id) { i, p in
                    FinanceFlowLayout(spacing: 12, rowSpacing: 6) {
                        Text(p.label.isEmpty ? p.key : p.label).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                            .frame(minWidth: 140, alignment: .leading)
                        FinanceStatusChip(status: p.configured ? "active" : "inactive", label: p.configured ? "Configured" : "Not configured")
                        if !p.env.isEmpty {
                            (Text("Reads ") + Text(p.env.joined(separator: ", ")).font(.nMono(11.5)))
                                .font(.inter(11.5)).foregroundStyle(Nuru.ink400)
                        }
                    }
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
            }
        }
    }

    private func numberingCard(_ s: FinSettings) -> some View {
        let c = s.receiptCounter
        let issued = c.next > 1
            ? "\(FinanceARules.plural(c.next - 1, "office receipt")) issued in \(String(c.year)) so far. "
            : "None issued in \(String(c.year)) yet. "
        return FinACard(icon: "number", title: "Office receipt numbers") {
            FinAExplain("Every gift the office records gets the next number — one sequence per year, no gaps, never reused.")
            VStack(alignment: .leading, spacing: 2) {
                Text("NEXT RECEIPT").font(.inter(10.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                Text(c.nextReceipt).font(.nMono(24, .semibold)).foregroundStyle(Nuru.navy).textSelection(.enabled)
            }
            Text(issued + "A reversed gift keeps its number; an M-Pesa code, cheque number or bank reference is kept beside it, never used as the receipt.")
                .font(.nMicro).foregroundStyle(Nuru.ink400)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 560, alignment: .leading)
        }
    }

    private func tiersCard(_ s: FinSettings) -> some View {
        let cols = [
            FinanceColumn("Monthly gift", width: 132, align: .trailing),
            FinanceColumn("Disciples a year", width: 116, align: .trailing),
            FinanceColumn("What it means", minWidth: 140),
        ]
        return FinACard(icon: "key", title: "Giving tiers") {
            if s.costPerDiscipleMinor > 0 {
                (Text("Carrying one disciple through a level costs ")
                 + Text(FinanceMoney.format(s.costPerDiscipleMinor, s.givingTiers.first?.currency ?? FinanceMoney.homeCurrency)).fontWeight(.semibold).foregroundStyle(Nuru.navy)
                 + Text("; every tier's wording derives from it."))
                    .font(.inter(12.5)).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
            } else {
                FinAExplain("Read-only.")
            }
            if s.givingTiers.isEmpty {
                Text("No tiers configured.").font(.nCaption).foregroundStyle(Nuru.ink400)
            } else {
                FinanceTable(rows: s.givingTiers, columns: cols, emptyIcon: "key", emptyMessage: "") { t in
                    Text(FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy)
                        .lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[0])
                    Text("\(t.disciplesPerYear)").font(.nMono(12.5)).financeCell(cols[1])
                    Text(t.meaning).font(.inter(12.5)).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true).financeCell(cols[2])
                }
            }
        }
    }

    private func remindersCard(_ s: FinSettings) -> some View {
        let p = s.reminderPolicy
        let facts: [(String, String)] = [
            ("Due soon", "\(p.dueSoonDays) \(p.dueSoonDays == 1 ? "day" : "days") before"),
            ("Due window", "\(p.dueWindowDays) \(p.dueWindowDays == 1 ? "day" : "days")"),
            ("Follow-ups", "\(p.followUps) × every \(p.followUpHours) h"),
            ("Payment in flight", "\(p.inFlightMinutes) min"),
        ]
        return FinACard(icon: "bell", title: "Pledge reminders") {
            FinAExplain("How partners are reminded about their instalments. Read-only.")
            FinanceFlowLayout(spacing: 22, rowSpacing: 10) {
                ForEach(facts, id: \.0) { k, v in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(k.uppercased()).font(.inter(10.5, .semibold)).tracking(0.8).foregroundStyle(Nuru.ink600)
                        Text(v).font(.nMono(13.5, .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(p.text.enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•").font(.inter(12.5)).foregroundStyle(Nuru.navy)
                        Text(line).font(.inter(12.5)).foregroundStyle(Nuru.navy).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    private func whoCanCard(_ caps: FinanceCaps) -> some View {
        let loadingMe = auth.profile == nil
        let cols = [
            FinanceColumn("Capability", width: 136),
            FinanceColumn("Allows", minWidth: 200),
            FinanceColumn("You", width: 56, align: .center),
        ]
        let rows = FinanceARules.capabilityHelp.enumerated().map { FinAIndexed(index: $0.offset, value: $0.element) }
        return FinACard(icon: "checkmark.shield", title: "Who can do what") {
            if isSectionVisible(.roles, profile: auth.profile) {
                Button { router.go(.roles) } label: {
                    Text("Roles & Permissions →").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy)
                }
                .buttonStyle(.plain)
            }
        } content: {
            FinAExplain("Four Finance capabilities, given to a role (or one person) in Roles & Permissions. Admin and SuperAdmin can do everything.")
            FinanceTable(rows: rows, columns: cols, emptyIcon: "checkmark.shield", emptyMessage: "") { r in
                let c = r.value
                let held: Bool = {
                    switch c.key {
                    case "view": caps.view
                    case "export": caps.export
                    case "manage": caps.manage
                    default: caps.approve
                    }
                }()
                Text(c.label).font(.nMono(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[0])
                Text(c.detail).font(.inter(12.5)).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true).financeCell(cols[1])
                Group {
                    if loadingMe {
                        Text("…").foregroundStyle(Nuru.ink400)
                    } else if held {
                        Image(systemName: "checkmark").font(.system(size: 14, weight: .bold)).foregroundStyle(FinanceStatus.green.fg)
                            .accessibilityLabel("You have this")
                    } else {
                        Text("—").foregroundStyle(Nuru.ink400).accessibilityLabel("You don't have this")
                    }
                }
                .financeCell(cols[2])
            }
        }
    }
}

/// A row that carries its position (lists whose order is the point).
struct FinAIndexed<Value>: Identifiable {
    let index: Int
    let value: Value
    var id: Int { index }
}

// MARK: - Category editor

struct FinACategoryEditor: View {
    let mode: FinACategorySheet
    let nextSort: Int
    var onSaved: (String) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var code = ""
    @State private var codeTouched = false
    @State private var attempted = false
    @State private var busy = false
    @State private var error: String?

    init(mode: FinACategorySheet, nextSort: Int, onSaved: @escaping (String) -> Void = { _ in }) {
        self.mode = mode
        self.nextSort = nextSort
        self.onSaved = onSaved
        if case .rename(let c) = mode { _name = State(initialValue: c.name) } else { _name = State(initialValue: "") }
    }

    private var existing: FinExpenseCategory? { if case .rename(let c) = mode { return c } else { return nil } }
    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var nameProblem: String? { FinanceARules.lengthProblem(name, min: 2, max: 60, what: "a name") }
    private var codeProblem: String? { existing == nil ? FinanceARules.slugProblem(code) : nil }
    private var unchanged: Bool { existing.map { trimmed == $0.name } ?? false }

    var body: some View {
        FinAFormSheet(title: existing == nil ? "Add category" : "Rename \(existing?.name ?? "")",
                      subtitle: existing == nil ? "It goes to the end of the list; move it after." : nil,
                      confirmTitle: existing == nil ? "Add" : "Save name",
                      confirmEnabled: existing == nil || (nameProblem == nil && !unchanged),
                      busy: busy,
                      onConfirm: { Task { await save() } }) {
            FinAFormField(label: "Name", error: (attempted || existing != nil) ? nameProblem : nil) {
                TextField("e.g. Youth ministry", text: Binding(get: { name }, set: { v in
                    name = String(v.prefix(60))
                    if existing == nil && !codeTouched { code = FinanceARules.suggestedSlug(from: name) }
                }))
                .finAInput(error: (attempted || existing != nil) && nameProblem != nil)
            }
            if existing == nil {
                FinAFormField(label: "Code", hint: "Permanent: lowercase letters, digits, hyphens.",
                              error: (attempted || codeTouched) ? codeProblem : nil) {
                    TextField("", text: Binding(get: { code }, set: { code = String($0.lowercased().prefix(40)); codeTouched = true }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(.nMono(15)).finAInput(error: (attempted || codeTouched) && codeProblem != nil)
                }
            } else if let c = existing {
                FinAExplain("The code \(c.code) stays — only the name changes.")
            }
            if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
        }
    }

    private func save() async {
        attempted = true
        guard nameProblem == nil, codeProblem == nil, !unchanged, !busy else { return }
        busy = true
        defer { busy = false }
        error = nil
        do {
            if let c = existing {
                _ = try await FinanceERPAPI.updateExpenseCategory(c.categoryId, FinExpenseCategoryPatch(name: trimmed))
                onSaved("Category renamed.")
            } else {
                let c = try await FinanceERPAPI.createExpenseCategory(FinExpenseCategoryInput(code: code, name: trimmed, sort: nextSort))
                onSaved("Category added — \(c.name) (\(c.code)).")
            }
            dismiss()
        } catch let e where e.apiCode == "CONFLICT" && existing == nil {
            error = "A category with the code “\(code)” already exists — codes are permanent, so pick another."
        } catch {
            self.error = FinanceARules.message(error, fallback: existing == nil ? "The category was not added." : "The new name was not saved.")
        }
    }
}
