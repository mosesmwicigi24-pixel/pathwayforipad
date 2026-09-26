// Finance → Settings (pathway docs/FINANCE_ERP.md §5): expense categories
// (finance:manage — add, rename, reorder, activate / deactivate; codes are
// permanent), which payment providers are on, the office receipt numbering,
// the giving tiers and reminder policy (read-only) and who can do what.
import SwiftUI

@MainActor
final class FinanceSettingsModel: ObservableObject {
    @Published private(set) var settings: FinSettings?
    @Published private(set) var settingsError: String?
    @Published private(set) var categories: [FinExpenseCategory] = []
    @Published private(set) var categoriesError: String?
    @Published private(set) var loadingCategories = true
    @Published private(set) var busy = false
    @Published var notice: FinanceNotice?

    func load() async {
        async let s: Void = loadSettings()
        async let c: Void = loadCategories()
        _ = await (s, c)
    }

    func loadSettings() async {
        do { settings = try await FinanceERPAPI.settings(); settingsError = nil }
        catch { if !Task.isCancelled { settingsError = FinanceARules.message(error) } }
    }

    func loadCategories() async {
        loadingCategories = true
        defer { loadingCategories = false }
        do { categories = try await FinanceERPAPI.expenseCategories(); categoriesError = nil }
        catch { if !Task.isCancelled { categoriesError = FinanceARules.message(error) } }
    }

    var sorted: [FinExpenseCategory] {
        categories.sorted { $0.sort != $1.sort ? $0.sort < $1.sort : $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// Move a category one place up or down: renumber the list 10, 20, 30… and
    /// PATCH only the categories whose order changes.
    func move(_ c: FinExpenseCategory, by offset: Int) async {
        var list = sorted
        guard let i = list.firstIndex(where: { $0.categoryId == c.categoryId }) else { return }
        let j = i + offset
        guard list.indices.contains(j) else { return }
        list.swapAt(i, j)
        busy = true
        defer { busy = false }
        do {
            for (index, cat) in list.enumerated() where cat.sort != (index + 1) * 10 {
                _ = try await FinanceERPAPI.updateExpenseCategory(cat.categoryId, FinExpenseCategoryPatch(sort: (index + 1) * 10))
            }
            notice = .ok("Order saved.")
        } catch {
            notice = .error("Couldn't save the order — \(FinanceARules.message(error))")
        }
        await loadCategories()
    }

    func setActive(_ c: FinExpenseCategory, _ active: Bool) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await FinanceERPAPI.updateExpenseCategory(c.categoryId, FinExpenseCategoryPatch(isActive: active))
            notice = .ok(active ? "“\(c.name)” is active again." : "“\(c.name)” is inactive — past expenses keep it; new ones can't use it.")
        } catch {
            notice = .error("Couldn't change “\(c.name)” — \(FinanceARules.message(error))")
        }
        await loadCategories()
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

    var body: some View {
        let caps = auth.financeCaps
        FinancePageScaffold(title: Section.financeSettings.title,
                            subtitle: "How Finance is set up — categories, providers, receipts and who can do what.",
                            onRefresh: { await vm.load() }) {
            if let n = vm.notice { FinanceNoticeBar(notice: n) { vm.notice = nil } }
            categoriesSection(caps)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 320), spacing: 16, alignment: .top)], alignment: .leading, spacing: 16) {
                receiptsCard
                providersCard
                tiersCard
                reminderCard
            }
            whoCanCard(caps)
        }
        .task { await vm.load() }
        .sheet(item: $sheet) { s in
            FinACategoryEditor(mode: s, nextSort: (vm.sorted.last?.sort ?? 0) + 10) { message in
                vm.notice = .ok(message)
                Task { await vm.loadCategories() }
            }
        }
    }

    // MARK: Expense categories

    private var categoryColumns: [FinanceColumn] { [
        FinanceColumn("Category", minWidth: 170),
        FinanceColumn("Code", width: 170),
        FinanceColumn("Status", width: 86),
        FinanceColumn("", width: 150, align: .trailing),
    ] }

    @ViewBuilder private func categoriesSection(_ caps: FinanceCaps) -> some View {
        FinASectionTitle(icon: "tag", title: "Expense categories", caption: "what spending is for") {
            if caps.manage {
                FinanceButton(title: "Add category", icon: "plus", style: .gold) { sheet = .add }
            }
        }
        if vm.loadingCategories && vm.categories.isEmpty {
            SkeletonTable(rows: 5)
        } else if let e = vm.categoriesError, vm.categories.isEmpty {
            ErrorBanner(message: e) { Task { await vm.loadCategories() } }
        } else {
            let cols = categoryColumns
            let list = vm.sorted
            FinanceTable(rows: list, columns: cols, emptyIcon: "tag", emptyMessage: "No categories yet.") { c in
                Text(c.name).font(.inter(13.5, .semibold)).foregroundStyle(c.isActive ? Nuru.navy : Nuru.ink600).lineLimit(1).financeCell(cols[0])
                Text(c.code).font(.nMono(12)).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.8).financeCell(cols[1])
                FinanceStatusChip(status: c.isActive ? "active" : "inactive", label: c.isActive ? "Active" : "Inactive").financeCell(cols[2])
                HStack(spacing: 6) {
                    if caps.manage {
                        iconButton("arrow.up", "Move up", disabled: c.id == list.first?.id) { Task { await vm.move(c, by: -1) } }
                        iconButton("arrow.down", "Move down", disabled: c.id == list.last?.id) { Task { await vm.move(c, by: 1) } }
                        iconButton("pencil", "Rename") { sheet = .rename(c) }
                        iconButton(c.isActive ? "pause.circle" : "play.circle", c.isActive ? "Deactivate" : "Activate") {
                            Task { await vm.setActive(c, !c.isActive) }
                        }
                    }
                }
                .financeCell(cols[3])
            }
            FinAExplain("A category's code is permanent — it names the category on every expense and in the reports. Rename or reorder freely; deactivate a category you no longer use (its past expenses keep it).")
        }
    }

    private func iconButton(_ icon: String, _ label: String, disabled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                .foregroundStyle(disabled ? Nuru.ink300 : Nuru.navy)
                .frame(width: 30, height: 28)
                .background(Nuru.navy.opacity(disabled ? 0.03 : 0.08))
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xs, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(disabled || vm.busy)
        .accessibilityLabel(label)
    }

    // MARK: Read-only cards

    private var receiptsCard: some View {
        FinACard(icon: "number", title: "Office receipts", caption: vm.settings.map { "year \($0.receiptCounter.year)" }) {
            if let s = vm.settings {
                VStack(alignment: .leading, spacing: 6) {
                    Text("NEXT RECEIPT").font(.inter(10.5, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                    Text(s.receiptCounter.nextReceipt).font(.nMono(22, .medium)).foregroundStyle(Nuru.goldLo).textSelection(.enabled)
                    Text(s.receiptCounter.next <= 1 ? "No office receipt has been issued this year yet." : "\(s.receiptCounter.next - 1) office \(s.receiptCounter.next - 1 == 1 ? "receipt" : "receipts") issued in \(String(s.receiptCounter.year)).")
                        .font(.nCaption).foregroundStyle(Nuru.ink600)
                    FinAExplain("Every office gift — cash, bank, cheque or M-Pesa recorded here — takes the next number, with no gaps. A reversed gift keeps its number; it is never reused. The M-Pesa code or cheque number is kept beside it.")
                }
            } else { settingsPlaceholder }
        }
    }

    private var providersCard: some View {
        FinACard(icon: "creditcard", title: "Payment providers", caption: "online giving") {
            if let s = vm.settings {
                VStack(spacing: 0) {
                    ForEach(Array(s.providers.enumerated()), id: \.element.id) { i, p in
                        HStack {
                            Text(p.label.isEmpty ? p.key.capitalized : p.label).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
                            Spacer()
                            FinanceStatusChip(status: p.configured ? "active" : "inactive", label: p.configured ? "On" : "Off")
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
                FinAExplain("On means the server holds that provider's settings. They are changed on the server, never here.")
            } else { settingsPlaceholder }
        }
    }

    private var tiersCard: some View {
        FinACard(icon: "person.3", title: "Giving tiers", caption: "read-only") {
            if let s = vm.settings {
                VStack(spacing: 0) {
                    ForEach(Array(s.givingTiers.enumerated()), id: \.element.id) { i, t in
                        HStack(alignment: .top, spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(FinanceMoney.format(t.amountMinor, t.currency)).font(.nMono(13.5, .medium)).foregroundStyle(Nuru.navy)
                                Text(t.meaning).font(.nMicro).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                            }
                            Spacer(minLength: 8)
                            Text("\(t.disciplesPerYear) / yr").font(.inter(12.5, .semibold)).foregroundStyle(Nuru.goldLo)
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                    }
                }
                FinAExplain("One disciple through a level costs \(FinanceMoney.format(s.costPerDiscipleMinor, FinanceMoney.homeCurrency)); every tier's words derive from it.")
            } else { settingsPlaceholder }
        }
    }

    private var reminderCard: some View {
        FinACard(icon: "bell", title: "Pledge reminders", caption: "read-only") {
            if let s = vm.settings {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(s.reminderPolicy.text.enumerated()), id: \.offset) { _, line in
                        HStack(alignment: .top, spacing: 8) {
                            Circle().fill(Nuru.gold).frame(width: 5, height: 5).padding(.top, 7)
                            Text(line).font(.nCaption).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            } else { settingsPlaceholder }
        }
    }

    @ViewBuilder private var settingsPlaceholder: some View {
        if let e = vm.settingsError {
            VStack(alignment: .leading, spacing: 8) {
                Text("Couldn't load — \(e)").font(.nCaption).foregroundStyle(Nuru.danger)
                FinanceButton(title: "Retry", icon: "arrow.clockwise") { Task { await vm.loadSettings() } }
            }
        } else {
            Skeleton(height: 60)
        }
    }

    private func whoCanCard(_ caps: FinanceCaps) -> some View {
        FinACard(icon: "person.badge.key", title: "Who can do what", caption: "finance permissions") {
            if isSectionVisible(.roles, profile: auth.profile) {
                Button { router.go(.roles) } label: {
                    Text("Roles & Permissions").font(.inter(12, .semibold)).foregroundStyle(Nuru.goldLo)
                }
                .buttonStyle(.plain)
            }
        } content: {
            VStack(spacing: 0) {
                ForEach(Array(FinanceARules.capabilityHelp.enumerated()), id: \.offset) { i, c in
                    let held: Bool = {
                        switch c.key {
                        case "view": caps.view
                        case "export": caps.export
                        case "manage": caps.manage
                        default: caps.approve
                        }
                    }()
                    HStack(alignment: .top, spacing: 12) {
                        Text(c.label).font(.nMono(12.5, .medium)).foregroundStyle(Nuru.navy).frame(width: 130, alignment: .leading)
                        Text(c.detail).font(.nCaption).foregroundStyle(Nuru.ink).fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        FinanceStatusChip(status: held ? "active" : "inactive", label: held ? "You have it" : "Not yours")
                    }
                    .padding(.vertical, 9)
                    .overlay(alignment: .top) { if i > 0 { Rectangle().fill(Nuru.border).frame(height: 1) } }
                }
            }
            FinAExplain("Admins and Super Admins hold all four. Everyone else gets them through their role (System → Roles & Permissions). While your profile loads, write actions stay hidden.")
        }
    }
}

// MARK: - Category editor

struct FinACategoryEditor: View {
    let mode: FinACategorySheet
    let nextSort: Int
    var onSaved: (String) -> Void = { _ in }

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var code = ""
    @State private var codeEdited = false
    @State private var busy = false
    @State private var error: String?
    @State private var showProblems = false

    init(mode: FinACategorySheet, nextSort: Int, onSaved: @escaping (String) -> Void = { _ in }) {
        self.mode = mode
        self.nextSort = nextSort
        self.onSaved = onSaved
        if case .rename(let c) = mode { _name = State(initialValue: c.name) } else { _name = State(initialValue: "") }
    }

    private var existing: FinExpenseCategory? { if case .rename(let c) = mode { return c } else { return nil } }

    private var problems: [String: String] {
        var p: [String: String] = [:]
        if let e = FinanceARules.lengthProblem(name, min: 2, max: 60, what: "The name") { p["name"] = e }
        if existing == nil, let e = FinanceARules.slugProblem(code) { p["code"] = e }
        return p
    }

    var body: some View {
        FinAFormSheet(title: existing == nil ? "Add an expense category" : "Rename “\(existing?.name ?? "")”",
                      confirmTitle: existing == nil ? "Add" : "Save",
                      busy: busy,
                      onConfirm: { Task { await save() } }) {
            if let error { FinanceNoticeBar(notice: .error(error)) { self.error = nil } }
            FinAFormField(label: "Name", hint: "2–60 characters — what the office sees when recording an expense.", error: showProblems ? problems["name"] : nil) {
                TextField("e.g. Youth ministry", text: $name).finAInput(error: showProblems && problems["name"] != nil)
                    .onChange(of: name) { _, v in if existing == nil && !codeEdited { code = FinanceARules.suggestedSlug(from: v) } }
            }
            if existing == nil {
                FinAFormField(label: "Code", hint: "Permanent. Lowercase letters, digits and hyphens; starts with a letter; 2–40 characters.",
                              error: showProblems ? problems["code"] : nil) {
                    TextField("youth-ministry", text: Binding(get: { code }, set: { code = $0.lowercased(); codeEdited = true }))
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .font(.nMono(15)).finAInput(error: showProblems && problems["code"] != nil)
                }
            } else if let c = existing {
                FinAExplain("The code \(c.code) stays — only the name changes.")
            }
        }
    }

    private func save() async {
        showProblems = true
        guard problems.isEmpty else { return }
        busy = true
        defer { busy = false }
        error = nil
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            if let c = existing {
                guard n != c.name else { dismiss(); return }
                _ = try await FinanceERPAPI.updateExpenseCategory(c.categoryId, FinExpenseCategoryPatch(name: n))
                onSaved("Renamed to “\(n)”.")
            } else {
                _ = try await FinanceERPAPI.createExpenseCategory(FinExpenseCategoryInput(code: code, name: n, sort: nextSort, isActive: true))
                onSaved("“\(n)” added.")
            }
            dismiss()
        } catch let e where e.apiCode == "CONFLICT" {
            error = "A category with the code “\(code)” already exists — choose another code."
        } catch {
            self.error = FinanceARules.message(error)
        }
    }
}
