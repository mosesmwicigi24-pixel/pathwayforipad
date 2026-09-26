// Finance A pages — small shared views on top of FinanceKit: a titled card,
// a facts grid for detail sheets, the ledger-legs table, form fields for the
// books' write sheets (bright, roomy — UI_DENSITY_SPEC v6), an optional-period
// menu ("All time" + presets) and a large-amount money input.
import SwiftUI

// MARK: - Cards

/// A white card with a header row: icon, title, caption and trailing controls.
struct FinACard<Trailing: View, Content: View>: View {
    var icon: String? = nil
    let title: String
    var caption: String? = nil
    var padding: CGFloat = 16
    @ViewBuilder var trailing: Trailing
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center, spacing: 8) {
                if let icon {
                    Image(systemName: icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(Nuru.goldLo)
                }
                Text(title).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                if let caption {
                    Text(caption).font(.nCaption).foregroundStyle(Nuru.ink600).lineLimit(1).minimumScaleFactor(0.85)
                }
                Spacer(minLength: 8)
                trailing
            }
            content
        }
        .padding(padding)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(Nuru.white)
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
    }
}
extension FinACard where Trailing == EmptyView {
    init(icon: String? = nil, title: String, caption: String? = nil, padding: CGFloat = 16, @ViewBuilder content: () -> Content) {
        self.init(icon: icon, title: title, caption: caption, padding: padding, trailing: { EmptyView() }, content: content)
    }
}

extension FinanceARules {
    /// A tone's colours — the web kit's TONES (warn amber, error red, info navy).
    static func colors(_ t: Tone) -> (fg: Color, bg: Color, border: Color) {
        switch t {
        case .warn: (Color(hex: 0xA87616), Color(hex: 0xFFF4DA), Color(hex: 0xF3DFA6))
        case .error: (Color(hex: 0xB42318), Color(hex: 0xFDECEC), Color(hex: 0xF5C2C0))
        case .info: (Color(hex: 0x1E4068), Color(hex: 0xE6EDF5), Color(hex: 0xC9D6E6))
        }
    }
}

/// A one-line explanation under a heading or table ("Amounts count succeeded gifts…").
struct FinAExplain: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.nMicro).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
    }
}

/// A small tag chip ("Pledge", "Reversal", "Inactive").
struct FinATag: View {
    let text: String
    var tone: (fg: Color, bg: Color) = FinanceStatus.navy
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 8.5, weight: .bold)) }
            Text(text).font(.inter(10.5, .semibold)).lineLimit(1).truncationMode(.tail)
        }
        .foregroundStyle(tone.fg)
        .padding(.horizontal, 7).padding(.vertical, 2.5)
        .background(tone.bg)
        .clipShape(Capsule())
        .fixedSize(horizontal: false, vertical: true)
    }
}

// MARK: - Facts grid (detail sheets)

struct FinAFact: Identifiable {
    let label: String
    let value: String
    var mono = false
    var id: String { label }
    init(_ label: String, _ value: String?, mono: Bool = false) {
        self.label = label
        let v = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        self.value = v.isEmpty ? "—" : v
        self.mono = mono
    }
}

/// Label-over-value pairs in a grid (2 columns; 3 when wide). Values are selectable.
struct FinAFacts: View {
    let facts: [FinAFact]
    var minimum: CGFloat = 200
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: 16, alignment: .topLeading)],
                  alignment: .leading, spacing: 14) {
            ForEach(facts) { f in
                VStack(alignment: .leading, spacing: 3) {
                    Text(f.label.uppercased()).font(.inter(10.5, .semibold)).tracking(0.6).foregroundStyle(Nuru.ink600)
                        .lineLimit(1).minimumScaleFactor(0.85)
                    Text(f.value)
                        .font(f.mono ? .nMono(13) : .inter(13.5, .medium))
                        .foregroundStyle(f.value == "—" ? Nuru.ink400 : Nuru.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

// MARK: - Ledger legs

/// A posting's legs as a small register: posted (EAT day) · account · debit ·
/// credit, reversing legs tagged, then the per-currency debit = credit check.
struct FinALegsTable<Leg: FinLeg & Identifiable>: View {
    let legs: [Leg]
    var fundNames: [String: String] = [:]
    var isReversal: (Leg) -> Bool = { _ in false }
    /// Narrower than the four columns (a sheet, an expanded row): the posting
    /// date folds under the account.
    @State private var width: CGFloat = 0

    init(legs: [Leg], fundNames: [String: String] = [:], isReversal: @escaping (Leg) -> Bool = { _ in false }) {
        self.legs = legs
        self.fundNames = fundNames
        self.isReversal = isReversal
    }

    private var narrow: Bool { width > 0 && width < 520 }

    private var cols: [FinanceColumn] {
        if narrow {
            return [
                FinanceColumn("Account", minWidth: 130),
                FinanceColumn("Debit", width: 112, align: .trailing),
                FinanceColumn("Credit", width: 112, align: .trailing),
            ]
        }
        return [
            FinanceColumn("Posted", width: 86),
            FinanceColumn("Account", minWidth: 140),
            FinanceColumn("Debit", width: 112, align: .trailing),
            FinanceColumn("Credit", width: 112, align: .trailing),
        ]
    }

    var body: some View {
        let cols = self.cols
        let narrow = self.narrow
        let offset = narrow ? 0 : 1
        return VStack(alignment: .leading, spacing: 8) {
            FinanceTable(rows: legs, columns: cols, emptyIcon: "book.closed", emptyMessage: "No postings.") { leg in
                if !narrow {
                    Text(FinanceATime.day(leg.createdAt)).font(.inter(12.5)).foregroundStyle(Nuru.ink600).financeCell(cols[0])
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(leg.account).font(.nMono(12.5)).foregroundStyle(Nuru.navy).lineLimit(1).minimumScaleFactor(0.8)
                    HStack(spacing: 6) {
                        Text(FinanceARules.accountLabel(leg.account, fundNames: fundNames) + (narrow ? " · \(FinanceATime.day(leg.createdAt))" : ""))
                            .font(.nMicro).foregroundStyle(Nuru.ink400).lineLimit(1)
                        if isReversal(leg) { FinATag(text: "Reversal", tone: FinanceStatus.violet) }
                    }
                }
                .financeCell(cols[offset])
                Text(leg.side == "debit" ? FinanceMoney.format(leg.amountMinor, leg.currency) : "")
                    .font(.nMono(12.5)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[offset + 1])
                Text(leg.side == "credit" ? FinanceMoney.format(leg.amountMinor, leg.currency) : "")
                    .font(.nMono(12.5)).foregroundStyle(Nuru.ink).lineLimit(1).minimumScaleFactor(0.7).financeCell(cols[offset + 2])
            }
            .measureWidth($width)
            ForEach(FinALegCheck.of(legs)) { c in
                HStack(spacing: 6) {
                    Image(systemName: c.balanced ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(c.balanced ? FinanceStatus.green.fg : FinanceStatus.red.fg)
                    Text("\(c.currency): debits \(FinanceMoney.format(c.debit, c.currency)) · credits \(FinanceMoney.format(c.credit, c.currency))"
                         + (c.balanced ? " — balanced" : " — NOT balanced"))
                        .font(.nMicro).foregroundStyle(c.balanced ? Nuru.ink600 : FinanceStatus.red.fg)
                }
            }
        }
    }
}

/// Σ debit and Σ credit of some legs, per currency (never across currencies).
struct FinALegCheck: Identifiable, Equatable {
    let currency: String
    let debit: Int
    let credit: Int
    var balanced: Bool { debit == credit }
    var id: String { currency }

    static func of<Leg: FinLeg>(_ legs: [Leg]) -> [FinALegCheck] {
        var debit: [String: Int] = [:], credit: [String: Int] = [:]
        for l in legs {
            if l.side == "debit" { debit[l.currency, default: 0] += l.amountMinor } else { credit[l.currency, default: 0] += l.amountMinor }
        }
        let currencies = Set(debit.keys).union(credit.keys).sorted(by: FinanceMoney.currencyPrecedes)
        return currencies.map { FinALegCheck(currency: $0, debit: debit[$0] ?? 0, credit: credit[$0] ?? 0) }
    }
}

// MARK: - Optional period ("All time" + presets)

/// A period chip whose first choice is "All time" (nil) — for reads whose
/// server default is all time (trial balance, audit, journals).
struct FinAPeriodMenu: View {
    @Binding var period: FinancePeriod?
    var allTimeLabel = "All time"
    @State private var showCustom = false

    init(period: Binding<FinancePeriod?>, allTimeLabel: String = "All time") {
        _period = period
        self.allTimeLabel = allTimeLabel
    }

    var body: some View {
        Menu {
            Button { period = nil } label: {
                if period == nil { Label(allTimeLabel, systemImage: "checkmark") } else { Text(allTimeLabel) }
            }
            Divider()
            ForEach(FinancePeriodPreset.allCases) { p in
                Button {
                    if p == .custom { showCustom = true } else { period = .preset(p) }
                } label: {
                    if period?.preset == p { Label(p.label, systemImage: "checkmark") } else { Text(p.label) }
                }
            }
        } label: {
            FinanceChipLabel(icon: "calendar", title: "Period", value: period?.label ?? allTimeLabel, active: period != nil)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityLabel("Period")
        .accessibilityValue(period?.label ?? allTimeLabel)
        .sheet(isPresented: $showCustom) {
            FinanceCustomRangeSheet(initial: period ?? .thisMonth) { period = $0 }
        }
    }
}

// MARK: - Form sheets (bright, roomy — UI_DENSITY_SPEC v6)

/// The id a write sheet scrolls to when its `alertKey` changes — put it on the
/// refusal / error block, so the answer to a toolbar tap is always in view.
enum FinAFormAnchor { static let alert = "finA.form.alert" }

/// A write sheet: warm paper, a centred column (≤ 820), the title inline, Cancel
/// and a confirm button in the toolbar. Opens large. When `alertKey` changes to
/// a value, the sheet scrolls the view marked `.id(FinAFormAnchor.alert)` into view.
struct FinAFormSheet<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    var confirmTitle: String? = nil
    var confirmEnabled = true
    var busy = false
    var alertKey: String? = nil
    var onConfirm: () -> Void = {}
    let content: Content
    @Environment(\.dismiss) private var dismiss

    init(title: String, subtitle: String? = nil, confirmTitle: String? = nil, confirmEnabled: Bool = true,
         busy: Bool = false, alertKey: String? = nil, onConfirm: @escaping () -> Void = {}, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.confirmTitle = confirmTitle
        self.confirmEnabled = confirmEnabled
        self.busy = busy
        self.alertKey = alertKey
        self.onConfirm = onConfirm
        self.content = content()
    }

    var body: some View {
        NavigationStack {
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        if let subtitle {
                            Text(subtitle).font(.nBody).foregroundStyle(Nuru.ink600).fixedSize(horizontal: false, vertical: true)
                        }
                        content
                    }
                    .padding(24)
                    .frame(maxWidth: 820, alignment: .leading)
                    .frame(maxWidth: .infinity)
                }
                .onChange(of: alertKey) { _, key in
                    guard key != nil else { return }
                    withAnimation(.easeInOut(duration: 0.25)) { proxy.scrollTo(FinAFormAnchor.alert, anchor: .center) }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Nuru.paper)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(confirmTitle == nil ? "Done" : "Cancel") { dismiss() }.disabled(busy)
                }
                if let confirmTitle {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(action: onConfirm) {
                            if busy { ProgressView() } else { Text(confirmTitle).fontWeight(.semibold) }
                        }
                        .disabled(!confirmEnabled || busy)
                    }
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(busy)
    }
}

/// Label, control, then the error (once shown) or a hint.
struct FinAFormField<Content: View>: View {
    let label: String
    var hint: String? = nil
    var error: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            content
            if let error {
                Text(error).font(.nCaption).foregroundStyle(Nuru.danger).fixedSize(horizontal: false, vertical: true)
            } else if let hint {
                Text(hint).font(.nCaption).foregroundStyle(Nuru.ink400).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Two fields side by side when there is room, stacked when narrow.
struct FinAFieldRow<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 16) { content }
            VStack(alignment: .leading, spacing: 16) { content }
        }
    }
}

extension View {
    /// The house text-input face: white, hairline border (red on error), 44pt.
    func finAInput(error: Bool = false) -> some View {
        self.font(.inter(15)).foregroundStyle(Nuru.ink)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                .stroke(error ? Nuru.danger : Nuru.border, lineWidth: 1))
    }
}

/// Segmented choice chips (giver mode, channel): navy when selected.
struct FinAChoiceChips<Option: Hashable>: View {
    let options: [Option]
    @Binding var selection: Option
    let label: (Option) -> String
    var icon: (Option) -> String? = { _ in nil }

    var body: some View {
        FinanceFlowLayout(spacing: 8, rowSpacing: 8) {
            ForEach(options, id: \.self) { o in
                let on = o == selection
                Button { selection = o } label: {
                    HStack(spacing: 6) {
                        if let i = icon(o) { Image(systemName: i).font(.system(size: 11, weight: .semibold)) }
                        Text(label(o)).font(.inter(13, on ? .semibold : .medium)).lineLimit(1)
                    }
                    .foregroundStyle(on ? .white : Nuru.navy)
                    .padding(.horizontal, 14).frame(height: 36)
                    .background(on ? Nuru.navy : Nuru.white)
                    .clipShape(Capsule())
                    .overlay(Capsule().stroke(on ? Nuru.navy : Nuru.border, lineWidth: 1))
                    .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// A picker that looks like an input: the chosen option's label (or the
/// placeholder) and a chevron; options from FinanceFilterOption.
struct FinAMenuField: View {
    let placeholder: String
    @Binding var selection: String
    let options: [FinanceFilterOption]
    var error = false

    var body: some View {
        Menu {
            Picker(placeholder, selection: $selection) {
                ForEach(options) { o in Text(o.label).tag(o.value) }
            }
        } label: {
            HStack(spacing: 8) {
                Text(options.first { $0.value == selection && !selection.isEmpty }?.label ?? placeholder)
                    .foregroundStyle(selection.isEmpty ? Nuru.ink400 : Nuru.ink)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.ink400)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .finAInput(error: error)
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .accessibilityValue(options.first { $0.value == selection }?.label ?? placeholder)
    }
}

/// A calendar day in EAT, limited to `range` ("YYYY-MM-DD" bounds).
struct FinADayField: View {
    @Binding var ymd: String
    let range: ClosedRange<String>

    var body: some View {
        let lower = FinanceDates.date(fromYMD: range.lowerBound) ?? Date()
        let upper = FinanceDates.date(fromYMD: range.upperBound) ?? Date()
        DatePicker("", selection: Binding(
            get: { FinanceDates.date(fromYMD: ymd) ?? upper },
            set: { ymd = FinanceDates.ymd($0) }
        ), in: lower...upper, displayedComponents: .date)
        .labelsHidden()
        .datePickerStyle(.compact)
        .tint(Nuru.gold)
        .environment(\.timeZone, FinanceDates.timeZone)
        .environment(\.calendar, FinanceDates.calendar)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A money input like FinanceMoneyField, with its own ceiling (opening
/// balances go to 1,000,000,000,000 minor; gifts stop at the kit's 1,000,000,000).
struct FinAMoneyInput: View {
    let label: String
    @Binding var text: String
    @Binding var currency: String
    var currencies: [String] = ["KES", "USD"]
    var maxMinor: Int = FinanceMoney.maxMinor
    @State private var edited = false

    init(label: String, text: Binding<String>, currency: Binding<String>,
         currencies: [String] = ["KES", "USD"], maxMinor: Int = FinanceMoney.maxMinor) {
        self.label = label
        _text = text
        _currency = currency
        self.currencies = currencies
        self.maxMinor = maxMinor
    }

    private var parsed: Result<Int, FinanceMoneyError> { FinanceARules.parseMajor(text, maxMinor: maxMinor) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label.uppercased()).font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            HStack(spacing: 0) {
                Menu {
                    Picker("Currency", selection: $currency) { ForEach(currencies, id: \.self) { Text($0).tag($0) } }
                } label: {
                    HStack(spacing: 4) {
                        Text(currency).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                        if currencies.count > 1 {
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold)).foregroundStyle(Nuru.ink400)
                        }
                    }
                    .padding(.horizontal, 12).frame(maxHeight: .infinity).background(Nuru.surface)
                }
                .menuStyle(.button).buttonStyle(.plain)
                .disabled(currencies.count < 2)
                Rectangle().fill(Nuru.border).frame(width: 1)
                TextField("0.00", text: $text)
                    .keyboardType(.decimalPad)
                    .font(.nMono(16)).foregroundStyle(Nuru.ink)
                    .padding(.horizontal, 12)
                    .onChange(of: text) { _, _ in edited = true }
            }
            .frame(height: 44)
            .background(Nuru.white)
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous).stroke(showError ? Nuru.danger : Nuru.border, lineWidth: 1))
            switch parsed {
            case .failure(let e) where showError:
                Text(e == .tooLarge ? "That is more than \(FinanceMoney.format(maxMinor, "")) — check the amount." : e.message)
                    .font(.nCaption).foregroundStyle(Nuru.danger)
            case .success(let minor):
                Text("Records \(FinanceMoney.format(minor, currency))").font(.nCaption).foregroundStyle(Nuru.ink400)
            default:
                EmptyView()
            }
        }
    }

    private var showError: Bool {
        guard edited, case .failure(let e) = parsed else { return false }
        return e != .empty || !text.isEmpty
    }
}

extension FinanceARules {
    /// FinanceMoney.parseMajor with another ceiling: the same grammar (the kit
    /// checks it before it reports tooLarge), up to `maxMinor`.
    static func parseMajor(_ raw: String, maxMinor: Int) -> Result<Int, FinanceMoneyError> {
        let kit = FinanceMoney.parseMajor(raw)
        if case .success(let minor) = kit { return minor <= maxMinor ? kit : .failure(.tooLarge) }
        guard case .failure(.tooLarge) = kit, maxMinor > FinanceMoney.maxMinor else { return kit }
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        s.removeAll { $0 == "," || $0 == " " || $0 == "\u{00A0}" || $0 == "_" }
        let parts = s.split(separator: ".", omittingEmptySubsequences: false)
        guard let wholePart = parts.first, parts.count <= 2 else { return .failure(.invalid) }
        let significant = wholePart.drop { $0 == "0" }
        guard significant.count <= 15, let whole = Int(significant.isEmpty ? "0" : String(significant)) else { return .failure(.tooLarge) }
        let fraction = parts.count == 2 ? String(parts[1]) : ""
        let cents = Int(fraction.padding(toLength: 2, withPad: "0", startingAt: 0)) ?? 0
        let (scaled, overflow) = whole.multipliedReportingOverflow(by: 100)
        guard !overflow else { return .failure(.tooLarge) }
        let minor = scaled + cents
        return minor <= maxMinor ? .success(minor) : .failure(.tooLarge)
    }

    /// A sentence the office can act on — the web's financeErrorMessage: the
    /// server's own message wins (the books write it for people); then the
    /// session / permission / transport / server cases; then `fallback`.
    static func message(_ error: Error, fallback: String = "That didn't work — try again.") -> String {
        let unreachable = "Could not reach the server — check the connection and try again."
        let slow = "The server took too long to answer — try again."
        if let e = error as? APIError {
            switch e {
            case .unauthorized:
                return "Your session expired — please sign in again."
            case .http(let status, let message, _):
                if status == 401 { return "Your session expired — please sign in again." }
                let m = message.trimmingCharacters(in: .whitespacesAndNewlines)
                // APIClient falls back to the status's own name when the body had no message.
                if !m.isEmpty && m != HTTPURLResponse.localizedString(forStatusCode: status) { return m }
                if status == 403 { return "You don't have permission to do that." }
                if status >= 500 { return "The server had a problem (\(status)) — try again in a minute." }
                return fallback
            case .transport(let m):
                return m.localizedCaseInsensitiveContains("timed out") ? slow : unreachable
            case .decoding, .passwordRequired:
                return e.errorDescription ?? fallback
            }
        }
        if let u = error as? URLError { return u.code == .timedOut ? slow : unreachable }
        return fallback
    }
}

// MARK: - DEBUG launch params

extension View {
    /// DEBUG builds: apply NURU_FINANCE_PARAMS ("tx=t-003", "tab=journals") to
    /// the NURU_START_SECTION page once, like a deep link — headless smoke
    /// tests and screenshots (A/FinanceAFixtures.swift). Release: no-op.
    @ViewBuilder
    func finADebugLaunchParams(_ section: Section, perform: @escaping ([String: String]) -> Void) -> some View {
        #if DEBUG
        onAppear { if let p = FinanceAFixtures.launchParams(for: section) { perform(p) } }
        #else
        self
        #endif
    }
}
