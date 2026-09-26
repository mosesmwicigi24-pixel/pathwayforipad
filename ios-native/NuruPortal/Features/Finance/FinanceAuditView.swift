// Finance → Audit (pathway docs/FINANCE_ERP.md §5): the finance slice of the
// append-only audit trail (GET /admin/finance/audit) — who did what and when:
// gifts recorded and reversed, funds, transfers, opening balances, expenses,
// budgets, claims, webhooks — newest first, keyset-paged. Filters: the kind of
// action, who acted (the system or a person) and the period (last 12 months by
// default). Nothing here can be changed; that is the point of it. Same columns
// and words as the web's Finance → Audit; a row also opens every fact it carries.
import SwiftUI
import Combine

@MainActor
final class FinanceAuditModel: ObservableObject {
    static let defaultPeriod = FinancePeriod.preset(.last12Months)
    @Published var period = FinanceAuditModel.defaultPeriod
    /// An action family from FinanceARules.auditPrefixes ("" = all finance).
    @Published var prefix = ""
    /// "" (anyone) · Admin (a person) · System
    @Published var actor = ""
    let pager = FinancePager<FinAuditPage>()
    @Published var open: FinAuditRow?
    private var forward: AnyCancellable?

    init() {
        forward = pager.objectWillChange.sink { [weak self] _ in self?.objectWillChange.send() }
    }

    var filter: FinAuditFilter {
        FinAuditFilter(period: period,
                       actionPrefix: FinanceARules.auditPrefixes.contains { $0.value == prefix } ? prefix : "",
                       actor: actor == "Admin" || actor == "System" ? actor : "")
    }
    var isFiltered: Bool { !prefix.isEmpty || !actor.isEmpty || period.preset != .last12Months }

    func clear() {
        prefix = ""
        actor = ""
        period = Self.defaultPeriod
    }

    /// action=<prefix> (or action_prefix), actor=Admin|System, period=<preset> or from/to.
    func apply(_ p: [String: String]) {
        if let a = p["action"] ?? p["action_prefix"] { prefix = FinanceARules.auditPrefixes.contains { $0.value == a } ? a : "" }
        if let a = p["actor"] { actor = a == "Admin" || a == "System" ? a : "" }
        if let period = FinanceARules.period(fromParams: p) { self.period = period }
    }
}

extension FinanceARules {
    /// "transactions" + "5b0c…" — the web's On column: the entity in words and a short id.
    static func auditShortId(_ id: String?) -> String? {
        guard let id, !id.isEmpty else { return nil }
        return id.count > 12 ? String(id.prefix(8)) + "…" : id
    }

    /// Where an audit row's record opens (the web's auditEntityHref): transactions and journals only.
    static func auditEntityLink(entity: String, entityId: String?) -> (section: Section, params: [String: String])? {
        guard let id = entityId, !id.isEmpty else { return nil }
        switch entity.lowercased() {
        case "transactions", "transaction": return (.financeTransactions, ["tx": id])
        case "journals", "journal": return (.financeLedger, ["tab": "journals", "journal": id])
        default: return nil
        }
    }

    /// A detail line set in mono (money: "KES 1,500.00", "-USD 5.00").
    static func auditLineIsMoney(_ line: String) -> Bool {
        let s = line.hasPrefix("-") ? line.dropFirst() : Substring(line)
        let head = s.prefix(4)
        return head.count == 4 && head.prefix(3).allSatisfy { $0.isASCII && $0.isUppercase } && head.last == " "
    }
}

struct FinanceAuditView: View {
    @EnvironmentObject private var router: NavRouter
    @StateObject private var vm = FinanceAuditModel()
    @State private var width: CGFloat = 0

    private enum Layout { case wide, medium, narrow }
    /// Wide: the web's five columns. Medium: the details fold under "What".
    /// Narrow (11" portrait, split view): "Who" folds under "When" too.
    private var layout: Layout { width == 0 || width >= 900 ? .wide : width >= 680 ? .medium : .narrow }

    private var columns: [FinanceColumn] {
        switch layout {
        case .wide: return [
            FinanceColumn("When (EAT)", width: 104),
            FinanceColumn("Who", width: 140),
            FinanceColumn("What", minWidth: 180),
            FinanceColumn("On", width: 124),
            FinanceColumn("Details", minWidth: 200),
        ]
        case .medium: return [
            FinanceColumn("When (EAT)", width: 100),
            FinanceColumn("Who", width: 130),
            FinanceColumn("What", minWidth: 220),
            FinanceColumn("On", width: 118),
        ]
        case .narrow: return [
            FinanceColumn("When (EAT)", width: 118),
            FinanceColumn("What", minWidth: 200),
        ]
        }
    }

    var body: some View {
        FinancePageScaffold(title: Section.financeAudit.title,
                            subtitle: "Every change to the money, as it happened — who, what, when (East Africa Time) and the key facts. The trail is append-only: nothing in it can be edited or deleted.",
                            onRefresh: { await vm.pager.reload() }) {
            FinanceFilterBar(period: $vm.period, isFiltered: vm.isFiltered, onClear: { vm.clear() }) {
                FinanceFilterMenu(title: "Kind", selection: $vm.prefix,
                                  options: FinanceARules.auditPrefixes.map { FinanceFilterOption($0.value, $0.label) },
                                  icon: "line.3.horizontal.decrease")
                FinanceFilterMenu(title: "Who", selection: $vm.actor,
                                  options: [.all("Anyone"), FinanceFilterOption("Admin", "A person"), FinanceFilterOption("System", "The system")])
            }
            VStack(alignment: .leading, spacing: 8) {
                FinASectionTitle(icon: "checkmark.shield", title: "Trail",
                                 caption: vm.pager.hasMore ? "Newest first — load more at the bottom." : "Newest first.")
                table
            }
        }
        .task(id: vm.filter) {
            let filter = vm.filter
            await vm.pager.load { cursor in try await FinanceERPAPI.audit(filter, cursor: cursor) }
        }
        .onFinanceLink(.financeAudit) { vm.apply($0) }
        .finADebugLaunchParams(.financeAudit) { vm.apply($0) }
        .sheet(item: $vm.open) { row in
            FinAAuditSheet(row: row) { section, params in
                vm.open = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { router.openFinance(section, params) }
            }
        }
    }

    private var table: some View {
        let cols = columns
        let layout = self.layout
        return FinancePagedTable(pager: vm.pager, columns: cols, emptyIcon: "checkmark.shield",
                                 emptyMessage: "No finance activity matches these filters.",
                                 onSelect: { vm.open = $0 }) { a in
            VStack(alignment: .leading, spacing: 1) {
                Text(FinanceATime.day(a.occurredAt)).font(.nMono(12)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.8)
                Text(FinanceATime.time(a.occurredAt)).font(.nMono(11)).foregroundStyle(Nuru.ink400)
                if layout == .narrow { who(a).padding(.top, 3) }
            }
            .financeCell(cols[0])
            if layout != .narrow { who(a).financeCell(cols[1]) }
            VStack(alignment: .leading, spacing: 2) {
                Text(FinanceARules.humanAction(a.action)).font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(2)
                Text(a.action).font(.nMono(10.5)).foregroundStyle(Nuru.ink400).lineLimit(1)
                if layout != .wide { details(a).padding(.top, 2) }
                if layout == .narrow { on(a).padding(.top, 2) }
            }
            .financeCell(cols[layout == .narrow ? 1 : 2])
            if layout != .narrow { on(a).financeCell(cols[3]) }
            if layout == .wide { details(a).financeCell(cols[4]) }
        }
        .measureWidth($width)
    }

    @ViewBuilder private func who(_ a: FinAuditRow) -> some View {
        if a.actorType == "System" {
            Text("The system").font(.inter(13)).foregroundStyle(Nuru.ink400).lineLimit(1)
        } else {
            Text(a.actorName ?? "A signed-in person").font(.inter(13, .semibold)).foregroundStyle(Nuru.navy).lineLimit(2)
        }
    }

    private func on(_ a: FinAuditRow) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(a.entity.replacingOccurrences(of: "_", with: " ")).font(.inter(12.5)).foregroundStyle(Nuru.ink).lineLimit(1)
            // The row opens the entry; its sheet links to the transaction or journal.
            if let short = FinanceARules.auditShortId(a.entityId) {
                let linked = FinanceARules.auditEntityLink(entity: a.entity, entityId: a.entityId) != nil
                Text(short).font(.nMono(11)).foregroundStyle(linked ? Nuru.navy : Nuru.ink400)
            }
        }
    }

    @ViewBuilder private func details(_ a: FinAuditRow) -> some View {
        let lines = FinanceARules.auditDetails(a.metadata)
        if lines.isEmpty {
            Text("—").font(.inter(12)).foregroundStyle(Nuru.ink400)
        } else {
            FinanceFlowLayout(spacing: 10, rowSpacing: 3) {
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line).font(FinanceARules.auditLineIsMoney(line) ? .nMono(11.5) : .inter(12))
                        .foregroundStyle(Nuru.ink600).lineLimit(2)
                }
            }
        }
    }
}

/// One audit row in full: every metadata key as recorded (money keys as money),
/// and a way to the record when it is a transaction or a journal.
struct FinAAuditSheet: View {
    let row: FinAuditRow
    var onOpen: (Section, [String: String]) -> Void = { _, _ in }

    var body: some View {
        FinAFormSheet(title: FinanceARules.humanAction(row.action)) {
            FinAFacts(facts: [
                FinAFact("When (EAT)", FinanceATime.dayTime(row.occurredAt)),
                FinAFact("Who", row.actorType == "System" ? "The system" : (row.actorName ?? "A signed-in person")),
                FinAFact("Action", row.action, mono: true),
                FinAFact("On", row.entity.replacingOccurrences(of: "_", with: " ")),
                FinAFact("Record id", row.entityId, mono: true),
                FinAFact("Audit #", String(row.auditId), mono: true),
            ], minimum: 180)
            if let link = FinanceARules.auditEntityLink(entity: row.entity, entityId: row.entityId) {
                FinanceButton(title: link.section == .financeTransactions ? "Open the transaction" : "Open the journal",
                              icon: "arrow.up.right.square", style: .primary) { onOpen(link.section, link.params) }
            }
            FinACard(icon: "list.bullet.rectangle", title: "Details", caption: "as recorded") {
                let facts = FinanceARules.auditMetadataFacts(row.metadata)
                if facts.isEmpty {
                    Text("No details were recorded.").font(.nCaption).foregroundStyle(Nuru.ink400)
                } else {
                    FinAFacts(facts: facts, minimum: 180)
                }
            }
        }
    }
}
