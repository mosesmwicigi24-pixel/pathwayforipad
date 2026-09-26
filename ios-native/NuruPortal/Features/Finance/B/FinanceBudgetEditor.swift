// Finance → Budgets — the draft's lines editor and the "start a budget" sheet.
// Each line is income (names a fund) or expense (names a category, and
// optionally a fund — else it is church-wide), with a label and twelve KES
// amounts typed in shillings (blank = 0). "Spread evenly" divides an annual
// amount into equal whole-cent months with the integer remainder on December
// (FinBMath.spreadEvenly). Save replaces ALL lines at once (PUT …/lines,
// finance:manage); Approve (finance:approve) locks what was saved — so it is
// offered only when nothing is unsaved. The server's rules are checked first
// so the office reads a sentence, not a 400: label 2–80, fund / category as
// the kind needs, 12 amounts 0 … KES 1,000,000,000.00, no overlapping lines
// (FinBMath.overlapProblem), at most 200 lines.
import SwiftUI

/// One line as the editor holds it (text cells until saved).
struct FinBBudgetEditLine: Identifiable, Equatable {
    let id: UUID
    var kind: String                 // income | expense
    var fund: String                 // "" = none (an expense line is then church-wide)
    var category: String             // expense lines only
    var label: String
    var months: [String]             // 12 cells in major units (KES); blank = 0
    var annual = ""                  // the spread helper's input

    init(kind: String, fund: String = "", category: String = "", label: String = "", months: [String] = Array(repeating: "", count: 12)) {
        self.id = UUID()
        self.kind = kind; self.fund = fund; self.category = category; self.label = label
        self.months = months.count == 12 ? months : Array((months + Array(repeating: "", count: 12)).prefix(12))
    }

    init(saved l: FinBudgetLine) {
        self.init(kind: l.kind, fund: l.fund?.code ?? "", category: l.category?.code ?? "", label: l.label,
                  months: l.monthlyMinor.map { $0 == 0 ? "" : FinanceMoney.majorString($0) })
    }

    /// Each cell parsed (nil where the text is not an amount).
    var parsedMonths: [Int?] { months.map { if case .success(let v) = FinBMath.parseMonthCell($0) { v } else { nil } } }
    /// Σ of the cells that parse — for the running total.
    var runningTotal: Int { parsedMonths.compactMap { $0 }.reduce(0, +) }
}

enum FinBBudgetLines {
    /// The PUT body, or every problem in words.
    enum Parsed: Equatable {
        case ok([FinBudgetLineInput])
        case problems([String])
    }

    /// The editor's lines → the PUT body, or every problem in words.
    static func inputs(_ lines: [FinBBudgetEditLine], fundName: (String) -> String,
                       categoryName: (String) -> String) -> Parsed {
        var problems: [String] = []
        var out: [FinBudgetLineInput] = []
        if lines.count > 200 { problems.append("A budget has at most 200 lines (this one has \(lines.count)).") }
        for (i, l) in lines.enumerated() {
            let name = "Line \(i + 1)" + (l.label.trimmingCharacters(in: .whitespaces).isEmpty ? "" : " (\(l.label.trimmingCharacters(in: .whitespaces)))")
            let label = l.label.trimmingCharacters(in: .whitespacesAndNewlines)
            if label.count < 2 || label.count > 80 { problems.append("\(name): the label needs 2–80 characters.") }
            if l.kind == "income" && l.fund.isEmpty { problems.append("\(name): an income line names the fund the money comes into.") }
            if l.kind == "expense" && l.category.isEmpty { problems.append("\(name): an expense line names its category.") }
            var cells: [Int] = []
            for (m, text) in l.months.enumerated() {
                switch FinBMath.parseMonthCell(text) {
                case .success(let v): cells.append(v)
                case .failure(let e): problems.append("\(name), \(FinBMath.monthName(m)): \(e.message)")
                }
            }
            if cells.count == 12, let p = FinBMath.twelveProblem(cells) { problems.append("\(name): \(p)") }
            if cells.count == 12 {
                out.append(FinBudgetLineInput(kind: l.kind,
                                              fund: l.fund.isEmpty ? nil : l.fund,
                                              category: l.kind == "expense" && !l.category.isEmpty ? l.category : nil,
                                              label: label, monthlyMinor: cells))
            }
        }
        let keys = lines.map { FinBMath.LineKey(kind: $0.kind, fund: $0.fund.isEmpty ? nil : $0.fund,
                                                 category: $0.kind == "expense" && !$0.category.isEmpty ? $0.category : nil) }
        if let overlap = FinBMath.overlapProblem(keys, fundName: fundName, categoryName: categoryName) { problems.append(overlap) }
        return problems.isEmpty ? .ok(out) : .problems(problems)
    }
}

struct FinanceBudgetEditor: View {
    let detail: FinBudgetDetail
    @ObservedObject var lookups: FinBLookups
    let caps: FinanceCaps
    let onSave: ([FinBudgetLineInput]) async throws -> Void
    let onApprove: () async throws -> Void

    @State private var lines: [FinBBudgetEditLine]
    @State private var saving = false
    @State private var saveError: String?
    @State private var tried = false
    @State private var approving = false

    init(detail: FinBudgetDetail, lookups: FinBLookups, caps: FinanceCaps,
         onSave: @escaping ([FinBudgetLineInput]) async throws -> Void,
         onApprove: @escaping () async throws -> Void) {
        self.detail = detail
        self.lookups = lookups
        self.caps = caps
        self.onSave = onSave
        self.onApprove = onApprove
        _lines = State(initialValue: detail.lines.map(FinBBudgetEditLine.init(saved:)))
    }

    private var savedInputs: [FinBudgetLineInput] {
        detail.lines.map { FinBudgetLineInput(kind: $0.kind, fund: $0.fund?.code, category: $0.category?.code,
                                              label: $0.label, monthlyMinor: $0.monthlyMinor) }
    }
    private var parsed: FinBBudgetLines.Parsed {
        FinBBudgetLines.inputs(lines, fundName: lookups.fundName, categoryName: lookups.categoryName)
    }
    private var dirty: Bool {
        if case .ok(let inputs) = parsed { return inputs != savedInputs }
        return true
    }
    private var problems: [String] { if case .problems(let p) = parsed { p } else { [] } }
    private var editable: Bool { caps.manage }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            if lines.isEmpty {
                EmptyState.compact(icon: "list.bullet.rectangle", message: editable
                                   ? "No lines yet — add the income the church expects per fund and the expenses per category."
                                   : "No lines yet.")
                    .background(Nuru.white)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            }
            ForEach($lines) { $line in
                lineCard($line)
            }
            if editable {
                HStack(spacing: 8) {
                    FinanceButton(title: "Income line", icon: "plus") { lines.append(.init(kind: "income")) }
                    FinanceButton(title: "Expense line", icon: "plus") { lines.append(.init(kind: "expense")) }
                    Spacer(minLength: 0)
                }
            }
            totals
            if tried, !problems.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(problems, id: \.self) { p in
                        Text("• \(p)").font(.nCaption).foregroundStyle(Nuru.danger).fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(FinanceStatus.red.bg)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            }
            if let saveError { FinanceNoticeBar(notice: .error(saveError)) { self.saveError = nil } }
            actionBar
        }
        .sheet(isPresented: $approving) {
            FinBConfirmSheet(title: "Approve the \(String(detail.year)) budget",
                             consequence: ["Locks the lines — the \(String(detail.year)) budget becomes read-only.",
                                           "Income \(FinanceMoney.format(detail.incomeTotalMinor, "KES")), expense \(FinanceMoney.format(detail.expenseTotalMinor, "KES")) across \(detail.lineCount) line\(detail.lineCount == 1 ? "" : "s"). Budget against actual starts from these; an approved budget cannot be edited."],
                             confirmLabel: "Approve budget") { try await onApprove() }
        }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "pencil.and.list.clipboard").font(.system(size: 14, weight: .semibold)).foregroundStyle(FinanceStatus.amber.fg)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(detail.name) — draft").font(.inter(14.5, .bold)).foregroundStyle(Nuru.navy)
                Text(editable
                     ? "Saving sends every line at once and replaces what was saved. Approval locks what is saved, so save first. Amounts are KES, typed in shillings; a blank month is 0."
                     : "A draft — someone with finance:manage edits the lines; finance:approve approves it.")
                    .font(.nCaption).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if dirty && editable { FinanceStatusChip(status: "pending", label: "Unsaved changes") }
        }
        .padding(14)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    // MARK: one line

    private func lineCard(_ line: Binding<FinBBudgetEditLine>) -> some View {
        let l = line.wrappedValue
        let cells = l.parsedMonths
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                FinBChoiceChips(options: [.init("income", "Income"), .init("expense", "Expense")],
                                selection: Binding(get: { line.wrappedValue.kind },
                                                   set: { k in
                                                       line.wrappedValue.kind = k
                                                       if k == "income" { line.wrappedValue.category = "" }
                                                   }))
                    .disabled(!editable)
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 1) {
                    Text("YEAR").font(.inter(10, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                    Text(FinanceMoney.format(l.runningTotal, "KES")).font(.inter(14.5, .semibold)).foregroundStyle(Nuru.navy).monospacedDigit()
                }
                if editable {
                    Button(role: .destructive) { lines.removeAll { $0.id == l.id } } label: {
                        Image(systemName: "trash").font(.system(size: 13, weight: .semibold)).foregroundStyle(FinanceStatus.rose.fg)
                            .frame(width: 34, height: 34).background(FinanceStatus.rose.bg).clipShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove this line")
                }
            }
            HStack(alignment: .top, spacing: 12) {
                if l.kind == "expense" {
                    FinBField(label: "Category") {
                        FinBPickerField(placeholder: "Choose a category", selection: pick(line, \.category), options: categoryOptions(l.category),
                                        invalid: tried && l.category.isEmpty)
                    }
                    FinBField(label: "Fund", hint: "Optional — none = church-wide") {
                        FinBPickerField(placeholder: "Church-wide (no fund)", selection: pick(line, \.fund), options: fundOptions(l.fund, allowNone: true))
                    }
                } else {
                    FinBField(label: "Fund", hint: "Where the income comes in") {
                        FinBPickerField(placeholder: "Choose a fund", selection: pick(line, \.fund), options: fundOptions(l.fund, allowNone: false),
                                        invalid: tried && l.fund.isEmpty)
                    }
                }
                FinBField(label: "Label", hint: "2–80 characters") {
                    TextField("e.g. Sunday tithes", text: line.label).finbInput(invalid: tried && !(2...80).contains(l.label.trimmingCharacters(in: .whitespacesAndNewlines).count))
                }
            }
            .disabled(!editable)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 86, maximum: 150), spacing: 6)], spacing: 8) {
                ForEach(0..<12, id: \.self) { m in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(FinBMath.monthName(m).uppercased()).font(.inter(10, .semibold)).tracking(0.4).foregroundStyle(Nuru.ink600)
                        TextField("0", text: line.months[m])
                            .keyboardType(.decimalPad)
                            .font(.nMono(12.5)).foregroundStyle(Nuru.ink)
                            .multilineTextAlignment(.trailing)
                            .padding(.horizontal, 8).frame(height: 34)
                            .background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(cells[m] == nil ? Nuru.danger : Nuru.border, lineWidth: 1))
                            .accessibilityLabel("\(l.label.isEmpty ? "Line" : l.label), \(FinBMath.monthName(m))")
                    }
                }
            }
            .disabled(!editable)
            if editable { spreadRow(line) }
        }
        .padding(14)
        .background(l.kind == "income" ? Color(hex: 0xF4FBF6) : Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }

    /// "Spread an annual amount evenly": equal whole-cent months, the integer
    /// remainder on December — the months always add up to exactly the amount.
    private func spreadRow(_ line: Binding<FinBBudgetEditLine>) -> some View {
        let parsedAnnual = FinBMath.parseMonthCell(line.wrappedValue.annual)
        return HStack(spacing: 8) {
            Text("Spread an annual amount evenly").font(.nCaption).foregroundStyle(Nuru.ink600)
            TextField("Annual KES", text: line.annual)
                .keyboardType(.decimalPad).font(.nMono(12.5))
                .multilineTextAlignment(.trailing)
                .padding(.horizontal, 8).frame(width: 150, height: 32)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
            FinanceButton(title: "Spread", icon: "equal") {
                guard case .success(let annual) = parsedAnnual, annual > 0 else { return }
                line.wrappedValue.months = FinBMath.spreadEvenly(annual).map { $0 == 0 ? "" : FinanceMoney.majorString($0) }
                line.wrappedValue.annual = ""
            }
            .disabled({ if case .success(let v) = parsedAnnual { return v <= 0 } else { return true } }())
            if case .success(let annual) = parsedAnnual, annual > 0 {
                let months = FinBMath.spreadEvenly(annual)
                Text(months[0] == months[11] ? "12 × \(FinanceMoney.format(months[0], ""))"
                     : "11 × \(FinanceMoney.format(months[0], "")) + Dec \(FinanceMoney.format(months[11], ""))")
                    .font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
            }
            Spacer(minLength: 0)
        }
    }

    private func pick(_ line: Binding<FinBBudgetEditLine>, _ key: WritableKeyPath<FinBBudgetEditLine, String>) -> Binding<String> {
        Binding(get: { line.wrappedValue[keyPath: key] },
                set: { v in
                    line.wrappedValue[keyPath: key] = v
                    // A new line takes its label from what it names, until one is typed.
                    if line.wrappedValue.label.trimmingCharacters(in: .whitespaces).isEmpty, !v.isEmpty {
                        line.wrappedValue.label = key == \FinBBudgetEditLine.category ? lookups.categoryName(v) : lookups.fundName(v)
                    }
                })
    }

    private func fundOptions(_ current: String, allowNone: Bool) -> [FinanceFilterOption] {
        var list = lookups.activeFunds.map { FinanceFilterOption($0.code, $0.name) }
        if !current.isEmpty, !list.contains(where: { $0.value == current }) {
            list.insert(.init(current, "\(lookups.fundName(current)) (inactive)"), at: 0)
        }
        return allowNone ? [.init("", "Church-wide (no fund)")] + list : list
    }

    private func categoryOptions(_ current: String) -> [FinanceFilterOption] {
        var list = lookups.activeCategories.map { FinanceFilterOption($0.code, $0.name) }
        if !current.isEmpty, !list.contains(where: { $0.value == current }) {
            list.insert(.init(current, "\(lookups.categoryName(current)) (inactive)"), at: 0)
        }
        return list
    }

    // MARK: totals + actions

    private var totals: some View {
        let income = lines.filter { $0.kind == "income" }.reduce(0) { $0 + $1.runningTotal }
        let expense = lines.filter { $0.kind == "expense" }.reduce(0) { $0 + $1.runningTotal }
        let net = income - expense
        return FinanceFlowLayout(spacing: 22, rowSpacing: 8) {
            total("Income", income, nil)
            total("Expense", expense, nil)
            total(net < 0 ? "Deficit" : "Surplus", abs(net), net < 0 ? FinanceStatus.amber.fg : Nuru.success)
            Text(dirty ? "as typed — not saved yet" : "as saved").font(.nMicro).foregroundStyle(Nuru.ink400).frame(height: 32)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
    }

    private func total(_ label: String, _ minor: Int, _ tint: Color?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased()).font(.inter(10, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            Text(FinanceMoney.format(minor, "KES")).font(.inter(15, .semibold)).foregroundStyle(tint ?? Nuru.navy).monospacedDigit()
        }
    }

    @ViewBuilder private var actionBar: some View {
        if editable || caps.approve {
            HStack(spacing: 10) {
                if editable {
                    FinanceButton(title: saving ? "Saving…" : "Save lines", icon: "tray.and.arrow.down", style: .gold, busy: saving) { save() }
                        .disabled(!dirty)
                        .opacity(dirty ? 1 : 0.5)
                }
                if caps.approve {
                    FinanceButton(title: "Approve budget", icon: "lock", style: .primary) { approving = true }
                        .disabled(dirty || detail.lines.isEmpty)
                        .opacity(dirty || detail.lines.isEmpty ? 0.5 : 1)
                }
                Spacer(minLength: 0)
            }
            if caps.approve, dirty || detail.lines.isEmpty {
                Text(detail.lines.isEmpty ? "Approval needs at least one saved line." : "Save the lines first — approval locks what is saved.")
                    .font(.nMicro).foregroundStyle(Nuru.ink600)
            }
        }
    }

    private func save() {
        tried = true
        saveError = nil
        guard case .ok(let inputs) = parsed else {
            saveError = "Fix the problems listed above, then save."
            return
        }
        saving = true
        Task { @MainActor in
            do {
                try await onSave(inputs)
                saving = false
                tried = false
            } catch {
                saving = false
                saveError = FinBError.message(error, fallback: "Could not save the lines.")
            }
        }
    }
}

// MARK: - Start a year's budget

struct FinanceBudgetStartSheet: View {
    let year: Int
    let onStart: (String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var busy = false
    @State private var error: String?

    init(year: Int, onStart: @escaping (String) async throws -> Void) {
        self.year = year
        self.onStart = onStart
        _name = State(initialValue: "\(year) budget")
    }

    private var trimmed: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool { (2...80).contains(trimmed.count) }

    var body: some View {
        FinBFormSheet(title: "Start the \(String(year)) budget", confirmLabel: "Start draft",
                      canConfirm: valid, busy: busy, error: error, onConfirm: start) {
            FinanceNoticeBar(notice: .warn("Starts a draft in KES — one budget per year. Nothing is locked until it is approved."))
            FinBField(label: "Name", hint: "2–80 characters", error: valid ? nil : "2–80 characters.") {
                TextField("\(String(year)) budget", text: $name).finbInput(invalid: !valid)
            }
        }
        .presentationDetents([.medium])
    }

    private func start() {
        guard valid else { return }
        busy = true
        error = nil
        Task { @MainActor in
            do {
                try await onStart(trimmed)
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = error.apiStatus == 409 ? "\(String(year)) already has a budget — reload the page." : FinBError.message(error, fallback: "Could not start the budget.")
            }
        }
    }
}
