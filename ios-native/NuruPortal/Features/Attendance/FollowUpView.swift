// Follow-up — who came, who didn't, and who is waiting to be called.
//
// Ported from packages/admin-web/src/components/pages/FollowUp.tsx, including
// the call list added alongside the cadence engine (backend #429).
//
// "To call" is first and default because it is the only tab with people waiting
// on it. The others answer questions; this one asks something of the reader.
import SwiftUI

struct FollowUpView: View {
    private enum Tab: String, CaseIterable, Identifiable {
        case due = "To call", members = "Members", services = "Services"
        var id: String { rawValue }
    }

    @State private var tab: Tab = .due
    @State private var due: [FollowUpDueStep] = []
    @State private var members: [FollowUpMemberRow] = []
    @State private var services: [ServiceAttendanceSummary] = []
    @State private var loading = true
    @State private var error: String?

    private var year: Int { Calendar.current.component(.year, from: Date()) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                tabs
                if loading {
                    SkeletonList(rows: 5)
                } else if let error {
                    Card { Text(error).font(.system(size: 13)).foregroundStyle(Nuru.danger) }
                } else {
                    switch tab {
                    case .due: dueList
                    case .members: memberList
                    case .services: serviceList
                    }
                }
            }
            .padding(20)
        }
        .background(Nuru.paper)
        .task { await load() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Follow-up").font(.system(size: 24, weight: .semibold)).foregroundStyle(Nuru.navy)
            Text("Who came, who didn't, and who is waiting to be called.")
                .font(.system(size: 13)).foregroundStyle(Nuru.ink600)
        }
    }

    private var tabs: some View {
        HStack(spacing: 6) {
            ForEach(Tab.allCases) { t in
                let count = t == .due ? due.count : t == .members ? members.count : services.count
                Button { tab = t } label: {
                    Text("\(t.rawValue)  \(count)")
                        .font(.system(size: 12.5, weight: .semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(tab == t ? Nuru.navy : Nuru.white)
                        .foregroundStyle(tab == t ? .white : Nuru.navy)
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: The call list

    private var dueList: some View {
        Group {
            if due.isEmpty {
                Card {
                    VStack(spacing: 6) {
                        Image(systemName: "phone").font(.system(size: 20)).foregroundStyle(Nuru.ink600.opacity(0.45))
                        Text("No one is waiting to be called.").font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.navy)
                        // Say what would put someone here. A leader who has never
                        // seen this populated should still understand its purpose.
                        Text("People appear when a cadence reaches a day that asks for a person, not a message.")
                            .font(.system(size: 12.5)).foregroundStyle(Nuru.ink600)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                }
            } else {
                VStack(spacing: 10) { ForEach(due, id: \.eventId) { step in DueRow(step: step, onRecorded: { Task { await load() } }) } }
            }
        }
    }

    private var memberList: some View {
        VStack(spacing: 8) {
            ForEach(members, id: \.userId) { m in
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.fullName).font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.navy)
                            Text(m.phoneNumber ?? "No phone number on file")
                                .font(.system(size: 12))
                                .foregroundStyle(m.phoneNumber == nil ? Nuru.danger : Nuru.ink600)
                        }
                        Spacer()
                        Pill(text: statusLabel(m.status), color: statusTint(m.status))
                    }
                }
            }
        }
    }

    private var serviceList: some View {
        VStack(spacing: 8) {
            ForEach(services, id: \.serviceId) { s in
                Card {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(s.title).font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.navy)
                            Text(s.serviceDate).font(.system(size: 12)).foregroundStyle(Nuru.ink600)
                        }
                        Spacer()
                        Text("\(s.attended)/\(s.expected)")
                            .font(.system(size: 14, weight: .semibold)).foregroundStyle(Nuru.navy)
                    }
                }
            }
        }
    }

    private func statusLabel(_ s: String) -> String {
        switch s {
        case "active": "Attending"
        case "at_risk": "Missed last"
        case "broken": "Slipping"
        default: "Never attended"
        }
    }

    private func statusTint(_ s: String) -> Color {
        switch s {
        case "active": Nuru.success
        case "at_risk": Nuru.gold
        case "broken": Nuru.danger
        default: Nuru.ink600
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            async let d = AttendanceAPI.due()
            async let m = AttendanceAPI.members(year: year)
            async let s = AttendanceAPI.serviceSummaries(year: year)
            (due, members, services) = try await (d, m, s)
            error = nil
        } catch {
            self.error = "Couldn't load follow-up. \(error.localizedDescription)"
        }
    }
}

/// One person, one action, and an outcome required to close it.
private struct DueRow: View {
    let step: FollowUpDueStep
    let onRecorded: () -> Void
    @State private var busy = false
    @State private var failed = false

    private var edge: Color {
        // Overdue is a coloured edge, not a red row: this list is read every day
        // and a wall of red stops meaning anything by the second week.
        step.daysOverdue > 6 ? Nuru.danger : step.daysOverdue > 0 ? Nuru.gold : Nuru.success
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(step.fullName).font(.system(size: 15, weight: .semibold)).foregroundStyle(Nuru.navy)
                        Text("\(step.action) · \(step.cadenceName)" + (step.serviceTitle.map { " · after \($0)" } ?? ""))
                            .font(.system(size: 12.5)).foregroundStyle(Nuru.ink600)
                    }
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 2) {
                        if let phone = step.phoneNumber {
                            // The number is the point of the row — one tap to call.
                            Link(phone, destination: URL(string: "tel:\(phone)") ?? URL(string: "tel:")!)
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Nuru.navyMid)
                        } else {
                            Text("No phone number on file").font(.system(size: 12)).foregroundStyle(Nuru.danger)
                        }
                        Text(step.daysOverdue > 0
                             ? "\(step.daysOverdue) day\(step.daysOverdue == 1 ? "" : "s") overdue"
                             : "Due today")
                            .font(.system(size: 11.5)).foregroundStyle(edge)
                    }
                }
                HStack(spacing: 6) {
                    ForEach(FollowUpOutcome.allCases, id: \.rawValue) { outcome in
                        Button {
                            Task {
                                busy = true
                                // A leader who believes they logged a call and did
                                // not is worse off than one who knows it failed.
                                do {
                                    try await AttendanceAPI.recordContact(
                                        eventId: step.eventId, outcome: outcome, note: nil)
                                    onRecorded()
                                } catch {
                                    failed = true
                                }
                                busy = false
                            }
                        } label: {
                            Text(outcome.label).font(.system(size: 12, weight: .semibold))
                                .padding(.horizontal, 11).padding(.vertical, 6)
                        }
                        .buttonStyle(.plain)
                        .background(Nuru.white)
                        .clipShape(Capsule())
                        .overlay(Capsule().stroke(Nuru.ink600.opacity(0.3)))
                        .disabled(busy)
                        .opacity(busy ? 0.5 : 1)
                    }
                }
            }
            .overlay(alignment: .leading) {
                Rectangle().fill(edge).frame(width: 3).padding(.vertical, -14).padding(.leading, -14)
            }
        }
    }
}
