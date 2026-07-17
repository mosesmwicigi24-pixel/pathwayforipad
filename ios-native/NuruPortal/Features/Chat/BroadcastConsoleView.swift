// Broadcast console — one word from the pastor to the whole church, and every
// answer to it in one place. SuperAdmin only; the page itself sits behind the
// §5.3 password step-up. The FIRST thing the page does is try the list with
// the token at hand (a fresh unlock walks straight in); any `passwordRequired`
// from any call — first visit, lapsed 15-minute window, mid-send — drops the
// page back to the gate. The server's pwd_at window is the single source of
// truth; the console keeps no clock of its own.
//
// Layout mirrors the web portal and the iOS member composer: composer up top,
// the last posts sent beneath it (reach · seen · replied), and a post opens
// into its response wall + the tick ledger. "Open thread" on a response is a
// navigation into Chat — the reply already lives in a private 1:1 thread
// seeded with the broadcast as its top message.
import SwiftUI

/// WhatsApp-blue for the seen ticks (matches the member apps' read receipts).
private let tickBlue = Color(hex: 0x2F80ED)

// MARK: - Wire models (decoder is .convertFromSnakeCase)

struct PBroadcastRow: Decodable, Identifiable {
    let broadcastId: String
    let body: String
    var msgType: String = "text"
    var audience: String = "all"
    var recipientCount: Int = 0
    var repliedCount: Int = 0
    var seenCount: Int = 0
    var createdAt: String? = nil
    var id: String { broadcastId }

    private enum CodingKeys: String, CodingKey {
        case broadcastId, body, msgType, audience, recipientCount, repliedCount, seenCount, createdAt
    }
    init(from d: Decoder) throws {
        let c = try d.container(keyedBy: CodingKeys.self)
        broadcastId = try c.decode(String.self, forKey: .broadcastId) // identity — must be real
        body = (try? c.decodeIfPresent(String.self, forKey: .body)) ?? ""
        msgType = (try? c.decodeIfPresent(String.self, forKey: .msgType)) ?? "text"
        audience = (try? c.decodeIfPresent(String.self, forKey: .audience)) ?? "all"
        recipientCount = (try? c.decodeIfPresent(Int.self, forKey: .recipientCount)) ?? 0
        repliedCount = (try? c.decodeIfPresent(Int.self, forKey: .repliedCount)) ?? 0
        seenCount = (try? c.decodeIfPresent(Int.self, forKey: .seenCount)) ?? 0
        createdAt = try? c.decodeIfPresent(String.self, forKey: .createdAt)
    }
}

struct PBroadcastList: Decodable {
    var data: [PBroadcastRow] = []
    var total: Int = 0
}

struct PBroadcastSent: Decodable {
    let broadcastId: String
    var body: String = ""
    var recipientCount: Int = 0
    var sent: Int = 0
    var duplicate: Bool = false
}

struct PBroadcastResponse: Decodable, Identifiable {
    let messageId: String
    let conversationId: String // the private 1:1 thread — "open" is a navigation
    var body: String = ""
    var msgType: String = "text"
    var createdAt: String? = nil
    var userId: String = ""
    var fullName: String = ""
    var avatarUrl: String? = nil
    var fromThem: Int = 0
    var id: String { messageId }
}

struct PBroadcastRecipient: Decodable, Identifiable {
    let userId: String
    var fullName: String = ""
    var avatarUrl: String? = nil
    var seen: Bool = false // two blue ticks; false = delivered (one tick)
    var seenAt: String? = nil
    var id: String { userId }
}

struct PBroadcastDetail: Decodable {
    let broadcastId: String
    var body: String = ""
    var audience: String = "all"
    var recipientCount: Int = 0
    var createdAt: String? = nil
    var responses: [PBroadcastResponse] = []
    var recipients: [PBroadcastRecipient] = []
    var deliveredCount: Int = 0
    var seenCount: Int = 0
}

private struct PConfirmPasswordRes: Decodable { let accessToken: String }

/// Chat deep link: the Broadcast console stashes the thread to open, switches
/// the section to Chat, and ChatView consumes it (same pattern as
/// UploadsSessionsLink — survives the race where Chat mounts after the post).
@MainActor enum ChatLink {
    static var pendingConversationId: String?
    static func consume() -> String? {
        defer { pendingConversationId = nil }
        return pendingConversationId
    }
}

extension Notification.Name {
    /// Posted by the Broadcast console when Chat is ALREADY mounted (keep-alive):
    /// userInfo ["conversationId": String] — ChatView selects it directly.
    static let nuruOpenChatConversation = Notification.Name("nuruOpenChatConversation")
}

// MARK: - View

struct BroadcastConsoleView: View {
    @EnvironmentObject private var router: NavRouter
    private let api = APIClient.shared

    // locked → the password gate; open → the console.
    @State private var locked = true
    @State private var checking = true // first silent list attempt in flight
    @State private var password = ""
    @State private var gateBusy = false
    @State private var gateError: String? = nil

    @State private var rows: [PBroadcastRow] = []
    @State private var total = 0
    @State private var detail: PBroadcastDetail? = nil
    @State private var detailTab = 0 // 0 responses · 1 recipients

    @State private var draft = ""
    @State private var confirming = false
    @State private var sending = false
    @State private var sentReach: Int? = nil
    @State private var sendError: String? = nil
    /// Survives a mid-send re-lock so the retry is the SAME idempotent send.
    @State private var mutationId: String? = nil

    var body: some View {
        Group {
            if checking {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if locked {
                gate
            } else if let d = detail {
                detailView(d)
            } else {
                console
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Nuru.paper.ignoresSafeArea())
        .navigationTitle("Broadcast")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(initial: true) }
    }

    // MARK: Data

    private func load(initial: Bool = false) async {
        do {
            let r: PBroadcastList = try await api.get("/chat/broadcasts", as: PBroadcastList.self)
            rows = r.data
            total = r.total
            locked = false
        } catch APIError.passwordRequired {
            locked = true
        } catch {
            // Transport blip on a page already open: keep what we have.
            if initial { locked = true }
        }
        checking = false
    }

    private func unlock() async {
        guard !password.isEmpty, !gateBusy else { return }
        gateBusy = true
        gateError = nil
        struct Body: Encodable { let password: String }
        do {
            let res: PConfirmPasswordRes = try await api.post("/auth/confirm-password", body: Body(password: password), as: PConfirmPasswordRes.self)
            await api.setAccessTokenOnly(res.accessToken)
            password = ""
            await load()
        } catch let APIError.http(status, message) {
            gateError = status == 401 ? "That password isn't right." : message
        } catch {
            gateError = "Couldn't confirm. Please try again."
        }
        gateBusy = false
    }

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        sending = true
        sendError = nil
        let mid = mutationId ?? UUID().uuidString
        mutationId = mid
        struct Body: Encodable { let body: String; let msgType: String; let clientMutationId: String }
        do {
            let res: PBroadcastSent = try await api.post("/chat/broadcast", body: Body(body: text, msgType: "text", clientMutationId: mid), as: PBroadcastSent.self)
            sentReach = res.recipientCount > 0 ? res.recipientCount : res.sent
            draft = ""
            mutationId = nil
            await load()
        } catch APIError.passwordRequired {
            locked = true // draft + mutation id survive; unlocking resumes cleanly
        } catch {
            sendError = "Couldn't send the broadcast. Please try again."
        }
        sending = false
    }

    private func openDetail(_ id: String) async {
        do {
            detail = try await api.get("/chat/broadcasts/\(id)", as: PBroadcastDetail.self)
            detailTab = 0
        } catch APIError.passwordRequired {
            locked = true
        } catch {}
    }

    private func openThread(_ conversationId: String) {
        ChatLink.pendingConversationId = conversationId
        NotificationCenter.default.post(name: .nuruOpenChatConversation, object: nil,
                                        userInfo: ["conversationId": conversationId])
        router.go(.chat)
    }

    // MARK: The gate

    private var gate: some View {
        VStack {
            Spacer(minLength: 40)
            VStack(spacing: 14) {
                ZStack {
                    Circle().fill(Nuru.goldTint).frame(width: 58, height: 58)
                    Image(systemName: "lock.fill").font(.system(size: 22)).foregroundStyle(Nuru.gold)
                }
                Text("The Broadcast is locked").font(.nuruDisplay(20)).foregroundStyle(Nuru.navy)
                Text("This room is between the shepherd and the flock. Confirm your password to open it — it stays open for 15 minutes.")
                    .font(.nBody).foregroundStyle(Nuru.muted)
                    .multilineTextAlignment(.center)
                SecureField("Your password", text: $password)
                    .textContentType(.password)
                    .padding(.horizontal, 14).padding(.vertical, 11)
                    .background(Nuru.inputBg, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .onSubmit { Task { await unlock() } }
                if let e = gateError {
                    Text(e).font(.nCaption).foregroundStyle(Nuru.danger)
                }
                Button {
                    Task { await unlock() }
                } label: {
                    Text(gateBusy ? "Confirming…" : "Open the Broadcast")
                        .font(.inter(14, .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 12)
                        .background(Nuru.gold, in: Capsule())
                }
                .disabled(password.isEmpty || gateBusy)
                .opacity(password.isEmpty || gateBusy ? 0.55 : 1)
            }
            .padding(28)
            .frame(maxWidth: 380)
            .background(Nuru.white, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Nuru.gold.opacity(0.3), lineWidth: 1))
            Spacer(minLength: 40)
        }
        .frame(maxWidth: .infinity)
        .padding(Nuru.S.screen)
    }

    // MARK: The console

    private var console: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Navy explainer
                HStack(alignment: .top, spacing: 14) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Nuru.gold.opacity(0.25)).frame(width: 44, height: 44)
                        Image(systemName: "megaphone.fill").font(.system(size: 18)).foregroundStyle(Nuru.goldLight)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Message every member").font(.nuruDisplay(18)).foregroundStyle(.white)
                        Text("Reaches every member as a personal message from you. Replies come back to you one-on-one — no one else sees them.")
                            .font(.nCaption).foregroundStyle(.white.opacity(0.65))
                    }
                    Spacer(minLength: 0)
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.navy, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                // Composer
                VStack(alignment: .leading, spacing: 12) {
                    TextField("Write your message to everyone…", text: $draft, axis: .vertical)
                        .lineLimit(4...10)
                        .font(.nBody)
                        .padding(12)
                        .background(Nuru.surface, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .onChange(of: draft) { _, _ in sentReach = nil }
                    HStack {
                        if let reach = sentReach {
                            Text("Delivered to \(reach) members 🎉").font(.inter(12, .semibold)).foregroundStyle(Nuru.success)
                        }
                        if let e = sendError {
                            Text(e).font(.inter(12, .medium)).foregroundStyle(Nuru.danger)
                        }
                        Spacer()
                        Button {
                            confirming = true
                        } label: {
                            Label(sending ? "Sending…" : "Send to everyone", systemImage: "paperplane.fill")
                                .font(.inter(13, .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 18).padding(.vertical, 10)
                                .background(Nuru.gold, in: Capsule())
                        }
                        .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                        .opacity(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending ? 0.55 : 1)
                    }
                }
                .padding(16)
                .background(Nuru.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Nuru.border, lineWidth: 1))

                // Last posts sent
                HStack(alignment: .firstTextBaseline) {
                    Text("LAST POSTS SENT").font(.inter(11, .bold)).tracking(1.4).foregroundStyle(Nuru.faint)
                    Spacer()
                    if total > rows.count {
                        Text("\(total) all-time").font(.nCaption).foregroundStyle(Nuru.faint)
                    }
                }
                if rows.isEmpty {
                    Text("Nothing sent yet — your first word to the whole church starts above.")
                        .font(.nBody).foregroundStyle(Nuru.faint)
                        .frame(maxWidth: .infinity).padding(.vertical, 32)
                        .background(Nuru.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                ForEach(rows) { b in
                    Button {
                        Task { await openDetail(b.broadcastId) }
                    } label: {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(b.body).font(.inter(14, .medium)).foregroundStyle(Nuru.navy)
                                .lineLimit(2).multilineTextAlignment(.leading)
                            HStack(spacing: 16) {
                                if let at = b.createdAt { Text(Self.ago(at)) }
                                Label("\(b.recipientCount)", systemImage: "person.2")
                                HStack(spacing: 3) {
                                    Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(tickBlue)
                                    Text("\(b.seenCount) seen")
                                }
                                Label("\(b.repliedCount) replied", systemImage: "bubble.left")
                            }
                            .font(.nCaption).foregroundStyle(Nuru.muted)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(16)
                        .background(Nuru.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            .padding(Nuru.S.screen)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .refreshable { await load() }
        .confirmationDialog("Broadcast to all members?", isPresented: $confirming, titleVisibility: .visible) {
            Button("Send") { Task { await send() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every member receives this as a personal message from you.")
        }
    }

    // MARK: Detail

    private func detailView(_ d: PBroadcastDetail) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Button {
                    detail = nil
                } label: {
                    Label("All broadcasts", systemImage: "chevron.left")
                        .font(.inter(13, .semibold)).foregroundStyle(Nuru.muted)
                }
                .buttonStyle(.plain)

                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Image(systemName: "megaphone.fill").font(.system(size: 11))
                        Text("BROADCAST\(d.createdAt.map { " · " + Self.ago($0).uppercased() } ?? "")")
                            .font(.inter(10, .bold)).tracking(1.4)
                    }
                    .foregroundStyle(Nuru.goldLight)
                    Text(d.body).font(.inter(15, .regular)).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 16) {
                        Label("Reached \(d.recipientCount)", systemImage: "person.2")
                        HStack(spacing: 3) {
                            Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(tickBlue)
                            Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).foregroundStyle(tickBlue).padding(.leading, -7)
                            Text("Seen by \(d.seenCount)")
                        }
                        Label("\(d.responses.count) replies", systemImage: "bubble.left")
                    }
                    .font(.nCaption).foregroundStyle(.white.opacity(0.7))
                }
                .padding(18)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.navy, in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                Picker("", selection: $detailTab) {
                    Text("Responses (\(d.responses.count))").tag(0)
                    Text("Recipients (\(d.recipients.count))").tag(1)
                }
                .pickerStyle(.segmented)

                if detailTab == 0 {
                    if d.responses.isEmpty {
                        Text("No replies yet — the word is still landing.")
                            .font(.nBody).foregroundStyle(Nuru.faint)
                            .frame(maxWidth: .infinity).padding(.vertical, 32)
                            .background(Nuru.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    ForEach(d.responses) { r in
                        HStack(alignment: .top, spacing: 12) {
                            InitialsAvatar(name: r.fullName, url: r.avatarUrl, size: 36)
                            VStack(alignment: .leading, spacing: 3) {
                                HStack {
                                    Text(r.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                    Spacer()
                                    if let at = r.createdAt {
                                        Text(Self.ago(at)).font(.nMicro).foregroundStyle(Nuru.faint)
                                    }
                                }
                                Text(r.msgType == "voice" ? "🎙 Voice note" : r.body)
                                    .font(.inter(13, .regular)).foregroundStyle(Nuru.ink600)
                                    .lineLimit(2)
                            }
                            Button {
                                openThread(r.conversationId)
                            } label: {
                                Text("Open thread")
                                    .font(.inter(11, .bold)).foregroundStyle(Nuru.goldChipText)
                                    .padding(.horizontal, 12).padding(.vertical, 7)
                                    .background(Nuru.goldChipBg, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                        }
                        .padding(14)
                        .background(Nuru.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                    }
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(d.recipients.enumerated()), id: \.element.id) { i, m in
                            HStack(spacing: 12) {
                                InitialsAvatar(name: m.fullName, url: m.avatarUrl, size: 30)
                                Text(m.fullName).font(.inter(13, .medium)).foregroundStyle(Nuru.navy)
                                Spacer()
                                if m.seen {
                                    HStack(spacing: 3) {
                                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold))
                                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).padding(.leading, -8)
                                        Text("Seen").font(.inter(11, .semibold))
                                    }
                                    .foregroundStyle(tickBlue)
                                } else {
                                    HStack(spacing: 4) {
                                        Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(tickBlue)
                                        Text("Delivered").font(.inter(11, .semibold)).foregroundStyle(Nuru.faint)
                                    }
                                }
                            }
                            .padding(.horizontal, 14).padding(.vertical, 9)
                            if i < d.recipients.count - 1 {
                                Rectangle().fill(Nuru.border.opacity(0.6)).frame(height: 1).padding(.leading, 56)
                            }
                        }
                    }
                    .background(Nuru.white, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
            }
            .padding(Nuru.S.screen)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
    }

    // MARK: Helpers

    private static func ago(_ iso: String) -> String {
        let frac = ISO8601DateFormatter(); frac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = frac.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return "" }
        let s = Date().timeIntervalSince(date)
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60))m ago" }
        if s < 86400 { return "\(Int(s / 3600))h ago" }
        let f = DateFormatter(); f.dateStyle = .medium
        return f.string(from: date)
    }
}

/// Small initials-or-photo avatar (console + detail rows).
private struct InitialsAvatar: View {
    let name: String
    let url: String?
    let size: CGFloat
    var body: some View {
        ZStack {
            Circle().fill(Nuru.navy)
            if let u = url, let real = URL(string: u) {
                AsyncImage(url: real) { img in
                    img.resizable().scaledToFill()
                } placeholder: { initials }
                .frame(width: size, height: size).clipShape(Circle())
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
    }
    private var initials: some View {
        Text(name.split(separator: " ").prefix(2).compactMap { $0.first.map(String.init) }.joined())
            .font(.inter(size * 0.32, .bold)).foregroundStyle(.white)
    }
}
