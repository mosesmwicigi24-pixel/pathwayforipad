// Finance → Audit (pathway docs/FINANCE_ERP.md §5): the finance slice of the
// append-only audit trail — giving, office gifts, pledges and claims, department
// needs, expenses, budgets, journals, funds, webhooks, purchases — newest
// first, keyset-paged, filtered by action family, actor (System / Admin) and
// period. Each row reads in words; a row opens every detail it carries.
import SwiftUI
import Combine

@MainActor
final class FinanceAuditModel: ObservableObject {
    @Published var filter = FinAuditFilter()
    let pager = FinancePager<FinAuditPage>()
    @Published var open: FinAuditRow?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    var isFiltered: Bool { filter != FinAuditFilter() }

    func apply(_ p: [String: String]) {
        var f = FinAuditFilter()
        if let a = p["action_prefix"] ?? p["action"] { f.actionPrefix = a }
        if let actor = p["actor"] { f.actor = actor == "All" ? "" : actor }
        if let from = p["from"], let to = p["to"], FinanceDates.date(fromYMD: from) != nil, FinanceDates.date(fromYMD: to) != nil {
            f.period = .custom(from: from, to: to)
        }
        filter = f
    }
}

struct FinanceAuditView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceAuditModel()

    private var columns: [FinanceColumn] { [
        FinanceColumn("When (EAT)", width: 104),
        FinanceColumn("Actor", width: 130),
        FinanceColumn("What happened", minWidth: 190),
        FinanceColumn("Record", width: 120),
    ] }

    var body: some View {
        FinancePageScaffold(title: Section.financeAudit.title,
                            subtitle: "Who did what to the money, and when — nothing here can be edited or deleted.",
                            onRefresh: { await vm.pager.reload() }) {
            FinanceFilterBar(isFiltered: vm.isFiltered, onClear: { vm.filter = FinAuditFilter() }) {
                FinAPeriodMenu(period: $vm.filter.period)
                FinanceFilterMenu(title: "Action", selection: $vm.filter.actionPrefix,
                                  options: FinanceARules.auditPrefixes.map { FinanceFilterOption($0.value, $0.label) },
                                  icon: "line.3.horizontal.decrease")
                FinanceFilterMenu(title: "Actor", selection: $vm.filter.actor,
                                  options: [.all("Anyone"), FinanceFilterOption("System", "System"), FinanceFilterOption("Admin", "Staff (signed in)")])
            }
            let cols = columns
            FinancePagedTable(pager: vm.pager, columns: cols, emptyIcon: "checkmark.shield",
                              emptyMessage: "Nothing in the trail matches these filters.",
                              onSelect: { vm.open = $0 }) { a in
                VStack(alignment: .leading, spacing: 1) {
                    Text(FinanceATime.day(a.occurredAt)).font(.inter(12.5)).lineLimit(1).minimumScaleFactor(0.8)
                    Text(FinanceATime.time(a.occurredAt)).font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                .financeCell(cols[0])
                VStack(alignment: .leading, spacing: 1) {
                    Text(a.actorName ?? (a.actorType == "System" ? "System" : "Staff")).font(.inter(13, .semibold))
                        .foregroundStyle(a.actorType == "System" ? Nuru.ink600 : Nuru.navy).lineLimit(1)
                    Text(a.actorType == "System" ? "automatic" : "signed in").font(.nMicro).foregroundStyle(Nuru.ink400)
                }
                .financeCell(cols[1])
                VStack(alignment: .leading, spacing: 2) {
                    Text(FinanceARules.humanAction(a.action)).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    let details = FinanceARules.auditDetails(a.metadata)
                    if !details.isEmpty {
                        Text(details).font(.nMicro).foregroundStyle(Nuru.ink600).lineLimit(2)
                    }
                }
                .financeCell(cols[2])
                VStack(alignment: .leading, spacing: 1) {
                    Text(a.entity.replacingOccurrences(of: "_", with: " ")).font(.inter(12.5)).foregroundStyle(Nuru.ink).lineLimit(1)
                    if let id = a.entityId { Text(String(id.prefix(8))).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1) }
                }
                .financeCell(cols[3])
            }
        }
        .task(id: vm.filter) {
            let filter = vm.filter
            await vm.pager.load { cursor in try await FinanceERPAPI.audit(filter, cursor: cursor) }
        }
        .onFinanceLink(.financeAudit) { vm.apply($0) }
        .sheet(item: $vm.open) { row in
            FinAAuditSheet(row: row) { section, params in
                vm.open = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { router.openFinance(section, params) }
            }
        }
    }
}

/// One audit row in full: every metadata key as sent, and a way to the record.
struct FinAAuditSheet: View {
    let row: FinAuditRow
    var onOpen: (Section, [String: String]) -> Void = { _, _ in }

    private var link: (label: String, section: Section, params: [String: String])? {
        guard let id = row.entityId, !id.isEmpty else { return nil }
        switch row.entity {
        case "transactions": return ("Open the transaction", .financeTransactions, ["tx": id])
        case "journals": return ("Open the journal", .financeLedger, ["tab": "journals", "journal": id])
        case "funds":
            if case .string(let code)? = row.metadata?["code"] { return ("Open the fund", .financeFunds, ["fund": code]) }
            return nil
        default: return nil
        }
    }

    var body: some View {
        FinAFormSheet(title: FinanceARules.humanAction(row.action)) {
            FinAFacts(facts: [
                FinAFact("When (EAT)", FinanceATime.dayTime(row.occurredAt)),
                FinAFact("Actor", row.actorName ?? row.actorType),
                FinAFact("Actor id", row.actorId, mono: true),
                FinAFact("Action", row.action, mono: true),
                FinAFact("Record", row.entity),
                FinAFact("Record id", row.entityId, mono: true),
                FinAFact("Audit #", String(row.auditId), mono: true),
            ], minimum: 180)
            if let l = link {
                FinanceButton(title: l.label, icon: "arrow.up.right.square", style: .primary) { onOpen(l.section, l.params) }
            }
            FinACard(icon: "curlybraces", title: "Details", caption: "exactly as recorded") {
                let meta = row.metadata ?? [:]
                if meta.isEmpty {
                    Text("No details were recorded.").font(.nCaption).foregroundStyle(Nuru.ink400)
                } else {
                    FinAFacts(facts: meta.keys.sorted().map { k in
                        FinAFact(k.replacingOccurrences(of: "_", with: " "), FinAAuditSheet.value(k, meta[k] ?? .null, meta),
                                 mono: k.hasSuffix("_id") || k == "reference" || k == "receipt_code")
                    }, minimum: 180)
                }
            }
        }
    }

    /// Money keys read as money (amount_minor + currency), everything else as text.
    static func value(_ key: String, _ v: FinJSON, _ all: [String: FinJSON]) -> String {
        if key.hasSuffix("_minor") {
            var cur = ""
            if case .string(let c)? = all["currency"] { cur = c }
            switch v {
            case .number(let n) where n.isFinite: return FinanceMoney.format(Int(n.rounded()), cur)
            case .string(let s): if let i = Int(s) { return FinanceMoney.format(i, cur) }
            default: break
            }
        }
        return v.text
    }
}
