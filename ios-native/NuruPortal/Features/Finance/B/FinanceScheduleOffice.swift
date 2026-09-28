// Finance → Recurring gifts, the office's view (Giving Cycle 7 — pathway
// docs/GIVING.md §10). The iPad twin of the web's finance/b/logic.ts
// (pauseReasonLabel · nextAskLabel · nairobiTomorrow) and of Recurring.tsx's
// office actions:
//   • why a gift is paused, as the office should read it — the member's own
//     choice (until when), its pledge's, or stopped after failed prompts; only
//     the last is the office's to chase;
//   • what the next prompt asks when the gift collects a pledge;
//   • with finance:manage, pause (optionally until a day), resume or cancel a
//     gift AT THE MEMBER'S REQUEST — a reason is required, the audit names the
//     officer, and the member is told the office did it.
// The words are pure; NuruPortalTests/GivingCycle7Tests pins them.
import SwiftUI

// MARK: - The office's words

enum FinBScheduleWords {
    /// Why a gift is paused: the member's own choice (with its day), its
    /// pledge's, or stopped after failed prompts — an older row with no reason
    /// on record reads as the last. Nil when it is not paused.
    static func pauseReason(status: String, pauseReason: String?, resumeOn: String?) -> String? {
        guard status == "paused" else { return nil }
        switch pauseReason {
        case "member":
            if let day = resumeOn, !day.isEmpty { return "The member paused it until \(FinanceDates.display(day))" }
            return "The member paused it"
        case "pledge":
            return "Paused with its pledge"
        default:
            return "Stopped after failed prompts"
        }
    }

    /// Whether the pause is the office's to chase (said in the danger tone):
    /// stopped after failures, or no reason on record (web: pause_reason
    /// "failures" or none).
    static func pauseIsFailure(_ pauseReason: String?) -> Bool {
        pauseReason == nil || pauseReason == "" || pauseReason == "failures"
    }

    /// What the next prompt asks when that is not the gift's amount — a gift
    /// that collects a pledge asks only what the pledge still owes. Nil when
    /// it is the same, the gift is not active, or nothing is coming.
    static func nextAsk(status: String, amountMinor: Int, currency: String, nextAmountMinor: Int?) -> String? {
        guard status == "active", let next = nextAmountMinor, next != amountMinor else { return nil }
        if next == 0 { return "Next: nothing — the pledge is already paid" }
        return "Next: \(FinanceMoney.format(next, currency)) — the rest of the pledge"
    }

    /// Tomorrow in Nairobi (YYYY-MM-DD) — the earliest a pause can end.
    static func nairobiTomorrow(now: Date = Date()) -> String {
        FinanceDates.todayOffset(1, now: now)
    }

    /// A year from today in Nairobi — the latest a pause can end (the route
    /// takes up to 366 days ahead, so this is always inside it).
    static func nairobiYearAhead(now: Date = Date()) -> String {
        let noon = FinanceDates.date(fromYMD: FinanceDates.today(now: now)) ?? now
        return FinanceDates.ymd(FinanceDates.calendar.date(byAdding: .year, value: 1, to: noon) ?? noon)
    }
}

extension FinSchedule {
    /// Why it is paused (FinBScheduleWords.pauseReason); nil when it is not.
    var pauseReasonLabel: String? {
        FinBScheduleWords.pauseReason(status: status, pauseReason: pauseReason, resumeOn: resumeOn)
    }
    /// The pause is the office's to chase.
    var pauseIsFailure: Bool { FinBScheduleWords.pauseIsFailure(pauseReason) }
    /// "Next: …" under the amount, when the next prompt asks something else.
    var nextAskLabel: String? {
        FinBScheduleWords.nextAsk(status: status, amountMinor: amountMinor, currency: currency, nextAmountMinor: nextAmountMinor)
    }
    /// Why it is failing: the words the member was told, else (an older
    /// server) the provider's own; nil when there are none.
    var failureWords: String? {
        if let reason = lastFailure?.reason, !reason.isEmpty { return reason }
        if let raw = lastError, !raw.isEmpty { return raw }
        return nil
    }
    /// The provider's raw error, kept as detail under the member's words.
    var failureDetail: String? {
        guard let reason = lastFailure?.reason, !reason.isEmpty, let raw = lastError, !raw.isEmpty, raw != reason else { return nil }
        return raw
    }
    /// The number the prompt goes to: the schedule's own, else the profile's.
    var promptOrProfileNumber: String? {
        if let n = promptNumber, !n.isEmpty { return n }
        return phoneNumber
    }
    /// What the office may do (web Recurring.tsx): pause while active; resume
    /// while paused — unless paused with its pledge (resume the pledge
    /// instead; the route refuses it); cancel until it is cancelled.
    var officeActions: [FinScheduleOfficeAction] {
        var out: [FinScheduleOfficeAction] = []
        if status == "active" { out.append(.pause) }
        if status == "paused" && pauseReason != "pledge" { out.append(.resume) }
        if status != "cancelled" { out.append(.cancel) }
        return out
    }
    /// "Amina Wanjiru's monthly gift of KES 5,000.00" — what the dialog is about.
    var giftDescription: String {
        let who = fullName.isEmpty ? "the member" : fullName
        let gift = frequency.isEmpty ? "gift" : "\(frequency) gift"
        return "\(who)'s \(gift) of \(FinanceMoney.format(amountMinor, currency))"
    }
}

extension FinScheduleOfficeAction {
    /// The row's button.
    var buttonTitle: String {
        switch self {
        case .pause: "Pause"
        case .resume: "Resume"
        case .cancel: "Cancel"
        }
    }
    var icon: String {
        switch self {
        case .pause: "pause.fill"
        case .resume: "play.fill"
        case .cancel: "nosign"
        }
    }
    /// The dialog's title: "Pause this gift?".
    var title: String { "\(buttonTitle) this gift?" }
    /// The dialog's confirm button: "Pause gift".
    var confirmLabel: String { "\(buttonTitle) gift" }

    /// What it does to `gift` (FinSchedule.giftDescription) — the web's sentences.
    func consequence(_ gift: String) -> String {
        switch self {
        case .pause: "No prompts go to \(gift) while it is paused."
        case .resume: "\(Self.sentence(gift)) picks up at its next occurrence — nothing missed is charged."
        case .cancel: "\(Self.sentence(gift)) stops for good. Only do this when the member asked."
        }
    }
    /// Said under every consequence.
    static let memberIsTold = "The member is told the office did it, at their request."

    /// The toast once it went through: "Paused Amina Wanjiru's gift — they have been told".
    func done(name: String) -> String {
        let verb: String
        switch self {
        case .pause: verb = "Paused"
        case .resume: verb = "Resumed"
        case .cancel: verb = "Cancelled"
        }
        return "\(verb) \(name.isEmpty ? "the member" : name)'s gift — they have been told"
    }

    /// A sentence starts with a capital ("The member's …" when there is no name).
    private static func sentence(_ s: String) -> String { s.prefix(1).uppercased() + s.dropFirst() }
}

// MARK: - The office acts, at the member's request

/// A gift and what the office was asked to do to it — `.sheet(item:)`.
struct FinScheduleOfficeRequest: Identifiable {
    let row: FinSchedule
    let action: FinScheduleOfficeAction
    var id: String { "\(row.scheduleId):\(action.rawValue)" }
}

/// Pause, resume or cancel a member's recurring gift at their request (the
/// web's ConfirmDialog in Recurring.tsx): the consequence in plain words, for
/// a pause an optional "until" day (tomorrow to a year ahead, Nairobi), and a
/// REQUIRED reason — 3–300 characters after trimming, the route's own rule —
/// with a live counter. Stays open with the server's words on a 400 / 422;
/// dismisses when it went through.
struct FinanceScheduleActionSheet: View {
    let request: FinScheduleOfficeRequest
    /// Sends the body; throws for the sheet to show.
    let onConfirm: (FinScheduleActionBody) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var note = ""
    @State private var untilOn = false
    @State private var until = ""
    @State private var busy = false
    @State private var error: String?

    private var action: FinScheduleOfficeAction { request.action }
    private var length: Int { FinScheduleActionBody.noteLength(note) }
    private var valid: Bool { FinScheduleActionBody.noteIsValid(note) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(action.consequence(request.row.giftDescription))
                            .font(.inter(15.5, .semibold)).foregroundStyle(Nuru.navy)
                            .fixedSize(horizontal: false, vertical: true)
                        Text(FinScheduleOfficeAction.memberIsTold)
                            .font(.nBody).foregroundStyle(Nuru.ink600)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if action == .pause { untilField }
                    reasonField
                    if let error { FinanceNoticeBar(notice: .error(error)) }
                }
                .padding(24)
                .frame(maxWidth: 620, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Nuru.paper)
            .navigationTitle(action.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(busy) }
                ToolbarItem(placement: .confirmationAction) {
                    Button(action: submit) {
                        if busy { ProgressView() } else { Text(action.confirmLabel).fontWeight(.semibold) }
                    }
                    .tint(action == .cancel ? Nuru.danger : Nuru.navy)
                    .disabled(!valid || busy)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .interactiveDismissDisabled(busy)
    }

    /// Pause only: resume by itself on a chosen day, or stay paused until the
    /// member (or the office) resumes it.
    private var untilField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $untilOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Until a day").font(.inter(13.5, .semibold)).foregroundStyle(Nuru.navy)
                    Text("Optional — it resumes by itself that day.").font(.nCaption).foregroundStyle(Nuru.ink600)
                }
            }
            .tint(Nuru.gold)
            .disabled(busy)
            .onChange(of: untilOn) { _, on in
                if on && until.isEmpty { until = FinBScheduleWords.nairobiTomorrow() }
            }
            if untilOn {
                HStack(spacing: 10) {
                    Text("Resumes on").font(.nCaption).foregroundStyle(Nuru.ink600)
                    FinBDayPicker(label: "Resumes on", ymd: $until,
                                  earliest: FinBScheduleWords.nairobiTomorrow(),
                                  latest: FinBScheduleWords.nairobiYearAhead())
                        .disabled(busy)
                    Spacer(minLength: 0)
                }
            }
        }
    }

    private var reasonField: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("WHY — THE MEMBER'S REQUEST, IN A LINE").font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
            TextField("e.g. Called the office: travelling in October", text: $note, axis: .vertical)
                .lineLimit(2...5)
                .font(.nBody).foregroundStyle(Nuru.ink)
                .padding(12)
                .background(Nuru.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Nuru.R.badge, style: .continuous)
                    .stroke(length > FinScheduleActionBody.noteMax ? Nuru.danger : Nuru.border, lineWidth: 1))
                .disabled(busy)
                .accessibilityLabel("Why — the member's request, in a line")
            HStack {
                Text(length < FinScheduleActionBody.noteMin ? "At least \(FinScheduleActionBody.noteMin) characters." : " ")
                    .font(.nCaption).foregroundStyle(Nuru.ink400)
                Spacer()
                Text("\(length)/\(FinScheduleActionBody.noteMax)")
                    .font(.nMono(11.5))
                    .foregroundStyle(length > FinScheduleActionBody.noteMax ? Nuru.danger : Nuru.ink400)
            }
        }
    }

    private func submit() {
        guard valid, !busy else { return }
        busy = true
        error = nil
        let body = FinScheduleActionBody.make(action, note: note, until: untilOn ? until : nil)
        Task { @MainActor in
            do {
                try await onConfirm(body)
                busy = false
                dismiss()
            } catch {
                busy = false
                self.error = FinBError.message(error, fallback: "Could not change the gift.")
            }
        }
    }
}
