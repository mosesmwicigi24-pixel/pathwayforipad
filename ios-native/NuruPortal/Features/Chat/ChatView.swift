// Chat — native SwiftUI port of the web admin "Chat" oversight console
// (packages/admin-web/src/components/pages/Chat.tsx). The portal admin reads
// disciple / group / space threads from the mobile-app chat, moderates flagged
// messages (server-authoritative via the chat module), replies as admin, sees
// read receipts, follows / creates spaces and starts DMs from the people
// directory. Moderation (flag / dismiss flag / remove) hits the chat module's
// routes; flagged counts and per-message state come from the server. Mute /
// archive have no endpoint yet and stay local display-only (mobile parity).
//
// Layout: regular width (iPad landscape) → two-pane (inbox | thread) via HStack;
// compact width → inbox with a NavigationLink push into the thread.
//
// Rich message / conversation / people / readers data is fetched with page-local
// Codable models through APIClient.shared (the shared slim Models.swift lacks the
// moderation / reaction / attachment / read-receipt fields the web surfaces).
import SwiftUI

// MARK: - Page-local rich models (mirror api/client.ts ChatApi)

/// null / missing JSON array → []  (the shared Defaults.swift only covers scalars).
@propertyWrapper
private struct DefaultArray<Element: Codable>: Codable {
    var wrappedValue: [Element]
    init(wrappedValue: [Element] = []) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        wrappedValue = (try? c.decode([Element].self)) ?? []
    }
    func encode(to encoder: Encoder) throws { try wrappedValue.encode(to: encoder) }
}
extension KeyedDecodingContainer {
    fileprivate func decode<E>(_ type: DefaultArray<E>.Type, forKey key: Key) throws -> DefaultArray<E> {
        try decodeIfPresent(type, forKey: key) ?? DefaultArray<E>(wrappedValue: [])
    }
}

private struct PChatList: Codable {
    let conversations: [PConversationRow]
    @DefaultArray var discoverSpaces: [PDiscoverSpace]
}

private struct PConversationRow: Codable, Identifiable {
    @DefaultEmpty var conversationId: String
    @DefaultEmpty var kind: String          // dm | group | space
    @DefaultFalse var isPublic: Bool
    let title: String?
    let topic: String?
    let category: String?
    let avatarUrl: String?                   // other member's photo (DM rows)
    @DefaultZero var memberCount: Int
    var lastBody: String?
    let lastType: String?
    var lastAt: String?
    var lastAuthor: String?
    @DefaultZero var unread: Int
    @DefaultZero var flagged: Int            // flagged-but-visible message count
    var id: String { conversationId }
    var displayName: String {
        if let t = title?.trimmed, !t.isEmpty { return t }
        switch kind { case "dm": return "Direct message"; case "space": return "Space"; default: return "Group" }
    }
}

private struct PDiscoverSpace: Codable, Identifiable {
    @DefaultEmpty var conversationId: String
    let title: String?
    let topic: String?
    @DefaultZero var memberCount: Int
    var id: String { conversationId }
}

private struct PReaction: Codable, Identifiable {
    @DefaultEmpty var emoji: String
    @DefaultZero var count: Int
    @DefaultFalse var mine: Bool
    var id: String { emoji }
}

private struct PMessageRow: Codable, Identifiable {
    @DefaultEmpty var messageId: String
    @DefaultEmpty var authorName: String
    @DefaultEmpty var body: String
    @DefaultEmpty var msgType: String        // text | voice | image | file | video
    let attachmentUrl: String?
    let aiTag: String?                        // prayer | action | important | null
    @DefaultEmpty var createdAt: String
    let replyBody: String?
    let replyAuthor: String?
    @DefaultFalse var mine: Bool
    @DefaultArray var reactions: [PReaction]
    let authorAvatar: String?
    let readCount: Int?
    let recipientCount: Int?
    // Moderation (admin/oversight view, server-authoritative)
    @DefaultFalse var isFlagged: Bool
    let flagReason: String?
    @DefaultFalse var isHidden: Bool
    var id: String { messageId }

    var status: MsgStatus { isHidden ? .removed : isFlagged ? .flagged : .sent }
    var attachmentName: String { "Attachment" }
}

private enum MsgStatus { case sent, flagged, removed }

private struct PConversationDetail: Codable {
    @DefaultEmpty var conversationId: String
    @DefaultEmpty var kind: String
    @DefaultFalse var isPublic: Bool
    let topic: String?
    let title: String?
    @DefaultFalse var joined: Bool
    let messages: [PMessageRow]
}

private struct PPerson: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    @DefaultEmpty var role: String
    let avatarUrl: String?
    let congregation: String?
    var id: String { userId }
}
private struct PPeopleEnvelope: Codable { let people: [PPerson] }

private struct PReader: Codable, Identifiable {
    @DefaultEmpty var userId: String
    @DefaultEmpty var fullName: String
    let avatarUrl: String?
    let readAt: String?
    var id: String { userId }
}
private struct PReaders: Codable {
    @DefaultZero var recipientCount: Int
    @DefaultZero var readCount: Int
    @DefaultArray var readers: [PReader]
    static let empty = PReaders(recipientCount: 0, readCount: 0)
    init(recipientCount: Int = 0, readCount: Int = 0, readers: [PReader] = []) {
        self.recipientCount = recipientCount; self.readCount = readCount; self.readers = readers
    }
}

// Helpers ---------------------------------------------------------------

private extension String { var trimmed: String { trimmingCharacters(in: .whitespacesAndNewlines) } }

/// Inbox segments — mirror the mobile app's three-segment control.
private enum Segment: String, CaseIterable, Identifiable {
    case space, dm, group
    var id: String { rawValue }
    var label: String { switch self { case .space: "My Space"; case .dm: "DM"; case .group: "My Groups" } }
    var kind: String { rawValue }
}

/// UI "type" — backend kind widened to the make's labels.
private enum ChatType { case direct, group, support, space
    static func of(_ kind: String) -> ChatType { kind == "dm" ? .direct : kind == "space" ? .space : .group }
    var label: String { switch self { case .direct: "Direct"; case .group: "Group"; case .support: "Support"; case .space: "Space" } }
    var bg: Color { switch self {
        case .direct: Color(hex: 0xEEF1F8); case .group: Color(hex: 0xE8F6EE)
        case .support: Color(hex: 0xF0EBFA); case .space: Color(hex: 0xFDF5E5) } }
    var fg: Color { switch self {
        case .direct: Color(hex: 0x1F3A6B); case .group: Color(hex: 0x0F6B33)
        case .support: Color(hex: 0x5B2BB8); case .space: Color(hex: 0x8A6B1F) } }
}

private struct AiTagMeta { let label: String; let emoji: String; let bg: Color; let fg: Color
    static func of(_ tag: String?) -> AiTagMeta? {
        switch tag {
        case "prayer":    return .init(label: "Prayer", emoji: "🙏", bg: Color(hex: 0xF0EBFA), fg: Color(hex: 0x5B2BB8))
        case "action":    return .init(label: "Action", emoji: "✅", bg: Color(hex: 0xE8F6EE), fg: Color(hex: 0x0F6B33))
        case "important": return .init(label: "Important", emoji: "⚠️", bg: Color(hex: 0xFDECEC), fg: Color(hex: 0xA8281F))
        default:          return nil
        }
    }
}

private let purple = Color(hex: 0x5B2BB8)
private let purpleBg = Color(hex: 0xF0EBFA)

// MARK: - Root view (loads the inbox, owns selection + modals)

struct ChatView: View {
    @StateObject private var model = ChatModel()
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        Group {
            switch model.listState {
            case .idle, .loading:
                ScrollView { SkeletonList(rows: 7).padding(Nuru.S.screen) }
            case .failed(let m):
                ScrollView { ErrorBanner(message: m) { Task { await model.loadList() } }.padding(Nuru.S.screen) }
            case .loaded:
                content
            }
        }
        .background(Nuru.paper)
        .task { if case .idle = model.listState { await model.loadList() } }
        .portalPage("Chat")
        .sheet(isPresented: $model.createOpen) { CreateSpaceSheet(model: model) }
        .sheet(isPresented: $model.newMsgOpen) { NewMessageSheet(model: model) }
        .sheet(item: $model.readersForId) { box in SeenBySheet(messageId: box.id) }
    }

    @ViewBuilder private var content: some View {
        let twoPane = hSize == .regular
        ScrollViewReader { _ in
            VStack(spacing: 0) {
                hero
                VStack(alignment: .leading, spacing: 16) {
                    if let e = model.listError { inlineError(e) }
                    statChips
                    actionBar
                    if twoPane {
                        HStack(alignment: .top, spacing: 16) {
                            InboxPane(model: model)
                                .frame(width: 380)
                                .frame(maxHeight: 760)
                            ThreadPane(model: model)
                                .frame(maxWidth: .infinity)
                                .frame(maxHeight: 760)
                        }
                    } else {
                        InboxPaneCompact(model: model)
                    }
                }
                .padding(.horizontal, Nuru.S.screen)
                .padding(.vertical, 18)
            }
        }
    }

    private func inlineError(_ msg: String) -> some View {
        Text(msg).font(.nCaption).foregroundStyle(Nuru.danger)
            .padding(.horizontal, 14).padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFEF2F2))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(hex: 0xF5C6C2), lineWidth: 1))
    }

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Operations", "Chat"],
            eyebrow: "Messaging",
            title: "Chat",
            subtitle: "Oversee disciple, group and space conversations from the mobile app. Read threads, moderate flagged messages and reply when needed."
        ) {
            if model.totalFlagged > 0 {
                HeroChip(label: "\(model.totalFlagged) flagged", icon: "exclamationmark.shield.fill", style: .tag)
            }
        }
    }

    // Compact stat chips — small icon + number + tiny label tiles (replaces the
    // oversized hero stat strip). A tight, even HStack that stays compact at ~740pt.
    private var statChips: some View {
        let icons = ["bubble.left.and.bubble.right.fill", "bolt.fill", "envelope.fill", "exclamationmark.shield.fill"]
        let tints: [Color] = [Nuru.navy, Color(hex: 0x0F6B33), Nuru.gold, Color(hex: 0xA8281F)]
        return HStack(spacing: 8) {
            ForEach(Array(model.heroStats.enumerated()), id: \.element.id) { i, s in
                statChip(icon: icons[i % icons.count], tint: tints[i % tints.count],
                         value: s.value, label: s.label)
            }
        }
    }

    private func statChip(icon: String, tint: Color, value: String, label: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 12, weight: .semibold))
                .foregroundStyle(tint)
                .frame(width: 26, height: 26)
                .background(tint.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(label.uppercased()).font(.inter(8.5, .bold)).tracking(0.4)
                    .foregroundStyle(Nuru.muted)
                    .lineLimit(1).minimumScaleFactor(0.75)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .frame(maxWidth: .infinity)
        .background(Nuru.white)
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var actionBar: some View {
        HStack {
            Spacer()
            Button { model.createOpen = true } label: {
                Label("New space", systemImage: "number")
                    .font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Nuru.white)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain)
            Button { model.newMsgOpen = true } label: {
                Label("New message", systemImage: "square.and.pencil")
                    .font(.inter(12.5, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).frame(height: 38)
                    .background(Nuru.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain)
        }
    }
}

// MARK: - Inbox (shared list body)

private struct InboxPane: View {
    @ObservedObject var model: ChatModel
    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                InboxHeader(model: model)
                Divider().overlay(Nuru.border)
                ScrollView {
                    InboxList(model: model) { id in model.select(id) }
                }
            }
        }
    }
}

/// Compact: tapping a row pushes the thread.
private struct InboxPaneCompact: View {
    @ObservedObject var model: ChatModel
    var body: some View {
        Card(padding: 0) {
            VStack(spacing: 0) {
                InboxHeader(model: model)
                Divider().overlay(Nuru.border)
                InboxList(model: model, push: true) { id in model.select(id) }
            }
        }
    }
}

private struct InboxHeader: View {
    @ObservedObject var model: ChatModel
    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                TextField("Search conversations…", text: $model.query)
                    .font(.nCaption).textFieldStyle(.plain)
            }
            .padding(.horizontal, 12).frame(height: 38)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

            HStack(spacing: 2) {
                ForEach(Segment.allCases) { seg in
                    let on = model.segment == seg
                    Button { model.segment = seg } label: {
                        HStack(spacing: 6) {
                            Text(seg.label).font(.inter(12, .bold))
                            Text("\(model.count(seg))")
                                .font(.inter(10, .heavy)).foregroundStyle(on ? .white : Nuru.muted)
                                .padding(.horizontal, 5).frame(minWidth: 17, minHeight: 17)
                                .background(on ? Nuru.gold : Nuru.mutedBg).clipShape(Capsule())
                        }
                        .foregroundStyle(on ? .white : Nuru.muted)
                        .frame(maxWidth: .infinity).padding(.vertical, 7)
                        .background(on ? Nuru.navy : .clear)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }
            .padding(3).background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .padding(14)
    }
}

private struct InboxList: View {
    @ObservedObject var model: ChatModel
    var push = false
    let onSelect: (String) -> Void

    var body: some View {
        let rows = model.filtered
        VStack(spacing: 0) {
            if rows.isEmpty && !(model.segment == .space && !model.discover.isEmpty) {
                emptyState
            } else {
                ForEach(rows) { c in
                    if push {
                        NavigationLink {
                            ThreadScreen(model: model, conversationId: c.conversationId)
                                .onAppear { onSelect(c.conversationId) }
                        } label: { ConversationRowView(c: c, active: false, model: model) }
                        .buttonStyle(.plain)
                    } else {
                        Button { onSelect(c.conversationId) } label: {
                            ConversationRowView(c: c, active: model.activeId == c.conversationId, model: model)
                        }.buttonStyle(.plain)
                    }
                }
                if model.segment == .space && !model.discover.isEmpty { discoverSection }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 24)).foregroundStyle(Nuru.muted.opacity(0.5))
            Text(model.segment == .dm ? "No direct messages yet — start one with “New message”."
                 : model.segment == .space ? "No spaces yet — follow one below." : "No groups yet.")
                .font(.nCaption).foregroundStyle(Nuru.muted).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 40).padding(.horizontal, 20)
    }

    private var discoverSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("DISCOVER SPACES").font(.inter(10.5, .heavy)).tracking(1.4).foregroundStyle(Nuru.muted)
                .padding(.top, 12)
            ForEach(model.discover) { s in
                HStack(spacing: 12) {
                    ConvAvatar(name: s.title ?? "Space", uri: nil, kind: "space", size: 38)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(s.title ?? "Space").font(.inter(12.5, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                        Text(s.topic ?? "\(s.memberCount) \(s.memberCount == 1 ? "member" : "members")")
                            .font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(1)
                    }
                    Spacer()
                    Button { Task { await model.joinSpace(s.conversationId) } } label: {
                        Text(model.joiningId == s.conversationId ? "Following…" : "Follow")
                            .font(.inter(11.5, .bold)).foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 12).frame(height: 30)
                            .background(Nuru.gold.opacity(0.1))
                            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.gold, lineWidth: 1))
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    }.buttonStyle(.plain).disabled(model.joiningId == s.conversationId)
                }
                .padding(.vertical, 9)
                Divider().overlay(Nuru.border)
            }
        }
        .padding(.horizontal, 14).padding(.bottom, 8)
    }
}

private struct ConversationRowView: View {
    let c: PConversationRow
    let active: Bool
    @ObservedObject var model: ChatModel
    var body: some View {
        let isDm = c.kind == "dm"
        HStack(alignment: .top, spacing: 12) {
            ConvAvatar(name: c.displayName, uri: isDm ? c.avatarUrl : nil, kind: c.kind, size: 42)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(c.displayName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Spacer(minLength: 4)
                    if c.lastAt != nil {
                        Text(Fmt.relative(c.lastAt))
                            .font(.inter(10.5, c.unread > 0 ? .bold : .regular))
                            .foregroundStyle(c.unread > 0 ? Nuru.gold : Nuru.muted)
                    }
                }
                Text(c.lastBody.map { "\(c.lastAuthor.map { "\($0): " } ?? "")\($0)" } ?? "No messages yet")
                    .font(.nCaption).foregroundStyle(Nuru.muted).lineLimit(1)
                HStack(spacing: 6) {
                    if let cat = c.category {
                        Text(cat.uppercased()).font(.inter(9.5, .bold)).foregroundStyle(Nuru.gold)
                            .padding(.horizontal, 7).padding(.vertical, 1)
                            .background(Nuru.gold.opacity(0.12)).clipShape(Capsule())
                    }
                    if !isDm {
                        Text("\(c.memberCount) \(c.memberCount == 1 ? "member" : "members")")
                            .font(.nMicro).foregroundStyle(Nuru.muted)
                    }
                    if model.muted.contains(c.conversationId) { Image(systemName: "speaker.slash").font(.system(size: 10)).foregroundStyle(Nuru.muted) }
                    if model.archived.contains(c.conversationId) { Image(systemName: "archivebox").font(.system(size: 10)).foregroundStyle(Nuru.muted) }
                    Spacer(minLength: 0)
                    if c.unread > 0 {
                        Text("\(c.unread)").font(.inter(10, .heavy)).foregroundStyle(.white)
                            .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18)
                            .background(Nuru.gold).clipShape(Capsule())
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(active ? Nuru.gold.opacity(0.08) : .clear)
        .overlay(alignment: .leading) {
            Rectangle().fill(active ? Nuru.gold : .clear).frame(width: 3)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(Nuru.border).frame(height: 1) }
    }
}

/// Avatar that mirrors the web: DM → photo/initials circle; group/space → tinted square w/ icon.
private struct ConvAvatar: View {
    let name: String
    let uri: String?
    let kind: String
    var size: CGFloat = 42
    var body: some View {
        let radius = kind == "dm" ? size / 2 : size * 0.3
        Group {
            if kind == "dm", let u = uri, let url = URL(string: u) {
                AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                placeholder: { Monogram(name: name, size: size) }
            } else if kind == "dm" {
                Monogram(name: name, size: size)
            } else {
                ZStack {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).fill(Nuru.navy.opacity(0.1))
                    Image(systemName: kind == "space" ? "number" : "person.3.fill")
                        .font(.system(size: size * 0.4, weight: .semibold)).foregroundStyle(Nuru.navy)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
    }
}

// MARK: - Thread (two-pane right side)

private struct ThreadPane: View {
    @ObservedObject var model: ChatModel
    var body: some View {
        Card(padding: 0) {
            if let active = model.active {
                ThreadBody(model: model, conv: active)
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 28)).foregroundStyle(Nuru.muted.opacity(0.4))
                    Text("Select a conversation").font(.inter(14, .semibold)).foregroundStyle(Nuru.navy)
                    Text("Pick a chat from the list to read and moderate it.").font(.nCaption).foregroundStyle(Nuru.muted)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(36)
            }
        }
    }
}

/// Compact push screen — loads the active conversation by id.
private struct ThreadScreen: View {
    @ObservedObject var model: ChatModel
    let conversationId: String
    var body: some View {
        Group {
            if let conv = model.filtered.first(where: { $0.conversationId == conversationId })
                ?? model.rows.first(where: { $0.conversationId == conversationId }) {
                ScrollView(.vertical, showsIndicators: true) {
                    ThreadBody(model: model, conv: conv).padding(.bottom, 8)
                }
            } else {
                ProgressView()
            }
        }
        .background(Nuru.paper)
        .navigationTitle(model.active?.displayName ?? "Chat")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct ThreadBody: View {
    @ObservedObject var model: ChatModel
    let conv: PConversationRow

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider().overlay(Nuru.border)
            if model.aiOpen { nuruPanel; Divider().overlay(Nuru.border) }
            messagesArea
            if model.assistOpen && !model.isArchived { assistPanel }
            if model.uploading { uploadingChip }
            Divider().overlay(Nuru.border)
            composer
        }
    }

    private var type: ChatType { ChatType.of(conv.kind) }

    private var header: some View {
        HStack(spacing: 12) {
            ConvAvatar(name: conv.displayName, uri: conv.kind == "dm" ? conv.avatarUrl : nil, kind: conv.kind, size: 42)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 8) {
                    Text(conv.displayName).font(.inter(14, .bold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    Text(type.label.uppercased()).font(.inter(9.5, .bold)).foregroundStyle(type.fg)
                        .padding(.horizontal, 8).padding(.vertical, 1).background(type.bg).clipShape(Capsule())
                }
                Text(conv.topic ?? "\(conv.memberCount) \(conv.memberCount == 1 ? "member" : "members")")
                    .font(.nMicro).foregroundStyle(Nuru.muted).lineLimit(1)
            }
            Spacer()
            HStack(spacing: 6) {
                Button { model.toggleNuru() } label: {
                    Label("Nuru", systemImage: "sparkles").font(.inter(12, .bold))
                        .foregroundStyle(model.aiOpen ? purple : Nuru.navy)
                        .padding(.horizontal, 10).frame(height: 34)
                        .background(model.aiOpen ? purpleBg : Nuru.white)
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(model.aiOpen ? purple.opacity(0.4) : Nuru.border, lineWidth: 1))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }.buttonStyle(.plain)
                toolBtn(model.isMuted ? "speaker.wave.2" : "speaker.slash") { model.toggleMute() }
                toolBtn(model.isArchived ? "arrow.uturn.backward" : "archivebox") { model.toggleArchive() }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 14)
    }

    private func toolBtn(_ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.system(size: 14)).foregroundStyle(Nuru.navy)
                .frame(width: 34, height: 34).background(Nuru.white)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }.buttonStyle(.plain)
    }

    // Nuru summary + quick actions
    private var nuruPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                HStack(spacing: 8) {
                    Image(systemName: "sparkles").font(.system(size: 12)).foregroundStyle(.white)
                        .frame(width: 24, height: 24).background(purple).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    Text("Nuru summary").font(.inter(12.5, .heavy)).foregroundStyle(purple)
                }
                Spacer()
                Button { model.aiOpen = false } label: { Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(Nuru.muted) }
                    .buttonStyle(.plain)
            }
            if model.summaryBusy {
                HStack(spacing: 6) { ProgressView().controlSize(.small); Text("Nuru is reading the thread…").font(.nCaption).foregroundStyle(Nuru.muted) }
            } else if let s = model.summary {
                Text(s).font(.nCaption).foregroundStyle(Nuru.foreground)
            } else {
                Button("Summarise this conversation") { Task { await model.loadSummary() } }
                    .font(.inter(12, .bold)).tint(purple)
            }
            HStack(spacing: 8) {
                assistChip("Draft a reply", icon: "wand.and.stars", filled: true) { model.runAssist(.reply); model.assistOpen = true }
                assistChip("🙏 Offer a prayer") { model.runAssist(.prayer); model.assistOpen = true }
                assistChip("💛 Encourage") { model.runAssist(.encourage); model.assistOpen = true }
            }
        }
        .padding(.horizontal, 18).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(LinearGradient(colors: [Color(hex: 0xFAF7FE), .white], startPoint: .top, endPoint: .bottom))
    }

    private func assistChip(_ label: String, icon: String? = nil, filled: Bool = false, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 11)) }
                Text(label).font(.inter(11.5, .bold))
            }
            .foregroundStyle(filled ? .white : purple)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(filled ? purple : purpleBg).clipShape(Capsule())
        }
        .buttonStyle(.plain).disabled(model.isArchived || model.assistBusy).opacity(model.isArchived ? 0.5 : 1)
    }

    // Messages
    private var messagesArea: some View {
        Group {
            if model.threadLoading {
                ProgressView().frame(maxWidth: .infinity).padding(40)
            } else if let err = model.threadError, model.messages.isEmpty {
                threadErrorBanner(err)
            } else if model.messages.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "text.bubble").font(.system(size: 22)).foregroundStyle(Nuru.muted.opacity(0.4))
                    Text("No messages yet.").font(.nCaption).foregroundStyle(Nuru.muted)
                }.frame(maxWidth: .infinity).padding(40)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(spacing: 12) {
                            if let err = model.threadError { threadErrorBanner(err) }
                            ForEach(model.messages) { m in
                                MessageRowView(m: m, model: model)
                            }
                            Color.clear.frame(height: 1).id("bottom")
                        }
                        .padding(.horizontal, 18).padding(.vertical, 16)
                    }
                    .background(Nuru.background)
                    .onChange(of: model.messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 240)
    }

    private func threadErrorBanner(_ msg: String) -> some View {
        Text(msg).font(.nCaption).foregroundStyle(Color(hex: 0xA8281F))
            .padding(.horizontal, 12).padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(hex: 0xFEF2F2))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(hex: 0xF5C6C2), lineWidth: 1))
    }

    // Nuru composer assist (intent + tone chips)
    private var assistPanel: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 6) {
                    Image(systemName: "sparkles").font(.system(size: 12)).foregroundStyle(purple)
                    Text("Nuru assist").font(.inter(11.5, .heavy)).foregroundStyle(purple)
                    if model.assistBusy { ProgressView().controlSize(.mini) }
                }
                Spacer()
                Button { model.assistOpen = false; model.assistIntent = nil } label: {
                    Image(systemName: "xmark").font(.system(size: 11)).foregroundStyle(Nuru.muted)
                }.buttonStyle(.plain)
            }
            HStack(spacing: 6) {
                ForEach(NuruIntent.allCases) { intent in
                    let on = model.assistIntent == intent
                    Button { model.runAssist(intent) } label: {
                        Text(intent.label).font(.inter(11.5, .bold)).foregroundStyle(on ? .white : purple)
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(on ? purple : Nuru.white)
                            .overlay(Capsule().stroke(on ? purple : purple.opacity(0.3), lineWidth: 1))
                            .clipShape(Capsule())
                    }.buttonStyle(.plain).disabled(model.assistBusy)
                }
            }
            if let intent = model.assistIntent {
                HStack(spacing: 6) {
                    Text("Tone:").font(.inter(10.5, .semibold)).foregroundStyle(Nuru.muted)
                    ForEach(NuruTone.allCases) { tone in
                        Button { model.runAssist(intent, tone: tone) } label: {
                            Text(tone.label).font(.inter(10.5, .semibold)).foregroundStyle(Nuru.navy)
                                .padding(.horizontal, 10).padding(.vertical, 5)
                                .background(Nuru.white).overlay(Capsule().stroke(Nuru.border, lineWidth: 1))
                                .clipShape(Capsule())
                        }.buttonStyle(.plain).disabled(model.assistBusy)
                    }
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Color(hex: 0xFAF7FE))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(purple.opacity(0.25), lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .padding(.horizontal, 16).padding(.top, 10)
    }

    private var uploadingChip: some View {
        HStack(spacing: 6) {
            ProgressView().controlSize(.mini)
            Text("Uploading attachment…").font(.inter(11.5, .bold)).foregroundStyle(purple)
        }
        .padding(.horizontal, 10).padding(.vertical, 4)
        .background(purpleBg).overlay(Capsule().stroke(purple.opacity(0.25), lineWidth: 1)).clipShape(Capsule())
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16).padding(.top, 8)
    }

    // Composer
    private var composer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            Button { model.assistOpen.toggle() } label: {
                Image(systemName: "sparkles").font(.system(size: 16))
                    .foregroundStyle(model.assistOpen ? purple : Nuru.navy)
                    .frame(width: 34, height: 40)
                    .background(model.assistOpen ? purple.opacity(0.08) : Nuru.white)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(model.assistOpen ? purple.opacity(0.4) : Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }.buttonStyle(.plain).disabled(model.isArchived)

            TextField(model.isArchived ? "Conversation archived — reopen to reply" : "Reply as admin, or ask Nuru to draft…",
                      text: $model.draft, axis: .vertical)
                .font(.nCaption).lineLimit(1...5)
                .padding(.horizontal, 12).padding(.vertical, 9)
                .background(Nuru.inputBg)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .disabled(model.isArchived || model.sending)

            Button { Task { await model.sendAdminMessage() } } label: {
                Group {
                    if model.sending { ProgressView().tint(.white) }
                    else { Image(systemName: "paperplane.fill").font(.system(size: 15)) }
                }
                .foregroundStyle(.white).frame(width: 40, height: 40)
                .background(Nuru.gold).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            .buttonStyle(.plain)
            .disabled(model.draft.trimmed.isEmpty || model.isArchived || model.sending)
            .opacity(model.draft.trimmed.isEmpty || model.isArchived || model.sending ? 0.5 : 1)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .background(Nuru.white)
    }
}

// MARK: - Message row (bubble, reply quote, attachment, ai tag, flags, receipts, moderation)

private struct MessageRowView: View {
    let m: PMessageRow
    @ObservedObject var model: ChatModel

    var body: some View {
        let mine = m.mine
        let removed = m.status == .removed
        let flagged = m.status == .flagged
        let navy = mine && !removed && !flagged

        HStack(alignment: .bottom, spacing: 8) {
            if mine { Spacer(minLength: 40) }
            if !mine {
                ConvAvatar(name: m.authorName, uri: m.authorAvatar, kind: "dm", size: 28)
            }
            VStack(alignment: mine ? .trailing : .leading, spacing: 3) {
                if !mine {
                    Text(m.authorName).font(.inter(11, .bold)).foregroundStyle(Nuru.navy)
                }
                bubble(navy: navy, removed: removed, flagged: flagged)
                if !removed && !mine { moderationActions(flagged: flagged) }
            }
            if !mine { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private func bubble(navy: Bool, removed: Bool, flagged: Bool) -> some View {
        let txt: Color = navy ? .white : (removed ? Nuru.muted : Color(hex: 0x1F2937))
        let sub: Color = navy ? .white.opacity(0.72) : Nuru.muted
        let bg: Color = removed ? Nuru.inputBg : (flagged ? Color(hex: 0xFEF2F2) : (navy ? Nuru.navy : .white))

        VStack(alignment: .leading, spacing: 6) {
            if !removed, let rb = m.replyBody {
                VStack(alignment: .leading, spacing: 1) {
                    Text(m.replyAuthor ?? "Reply").font(.inter(10, .bold)).foregroundStyle(navy ? .white : Nuru.navy)
                    Text(rb).font(.inter(11)).foregroundStyle(sub).lineLimit(1)
                }
                .padding(.horizontal, 8).padding(.vertical, 5)
                .frame(maxWidth: 240, alignment: .leading)
                .background(navy ? Color.white.opacity(0.12) : Color.black.opacity(0.04))
                .overlay(alignment: .leading) { Rectangle().fill(Nuru.gold).frame(width: 2) }
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            if !removed, m.attachmentUrl != nil { AttachmentView(m: m, onNavy: navy) }
            if !removed, !m.body.isEmpty {
                Text(m.body).font(.nCaption).foregroundStyle(txt).fixedSize(horizontal: false, vertical: true)
            }
            if removed {
                Text("This message was removed by a moderator.").font(.nCaption).italic().foregroundStyle(Nuru.muted)
            }
            if !removed, let tag = AiTagMeta.of(m.aiTag) {
                HStack(spacing: 4) {
                    Image(systemName: "sparkles").font(.system(size: 9))
                    Text("\(tag.emoji) \(tag.label)").font(.inter(9.5, .bold))
                }
                .foregroundStyle(tag.fg).padding(.horizontal, 8).padding(.vertical, 1)
                .background(tag.bg).clipShape(Capsule())
            }
            if !removed {
                HStack(spacing: 4) {
                    ForEach(m.reactions) { r in
                        Button { model.react(m.messageId, r.emoji) } label: {
                            Text("\(r.emoji) \(r.count)").font(.inter(10.5, .semibold))
                                .foregroundStyle(r.mine ? Nuru.gold : (navy ? .white : Nuru.navy))
                                .padding(.horizontal, 7).padding(.vertical, 2)
                                .background(navy ? Color.white.opacity(0.14) : Nuru.inputBg).clipShape(Capsule())
                        }.buttonStyle(.plain)
                    }
                    Menu {
                        ForEach(["🙏", "🔥", "❤️", "👏", "✅", "😀"], id: \.self) { e in
                            Button(e) { model.react(m.messageId, e) }
                        }
                    } label: {
                        Image(systemName: "face.smiling").font(.system(size: 11))
                            .foregroundStyle(navy ? .white.opacity(0.7) : Nuru.ink400)
                            .padding(.horizontal, 6).padding(.vertical, 3)
                            .background(navy ? Color.white.opacity(0.10) : Nuru.inputBg).clipShape(Capsule())
                    }
                }
            }
            if flagged {
                HStack(spacing: 4) {
                    Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 9))
                    Text("Flagged for review\(m.flagReason.map { " · \($0)" } ?? "")").font(.inter(10.5, .semibold))
                }.foregroundStyle(Color(hex: 0xB91C1C))
            }
            HStack(spacing: 4) {
                Spacer(minLength: 0)
                Text(Fmt.relative(m.createdAt)).font(.inter(9.5)).foregroundStyle(sub)
                if m.mine && !removed { receipt(sub: sub) }
            }
        }
        .padding(.horizontal, 13).padding(.vertical, 9)
        .frame(maxWidth: 360, alignment: .leading)
        .background(bg)
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(flagged ? Color(hex: 0xF5C6C2) : (navy ? .clear : Color(hex: 0xE6E8EB)), lineWidth: 1)
        )
        .clipShape(BubbleShape(mine: m.mine))
    }

    private func receipt(sub: Color) -> some View {
        let recip = m.recipientCount ?? 0
        let reads = m.readCount ?? 0
        let allRead = recip > 0 && reads >= recip
        let someRead = reads > 0 && !allRead
        return Button { model.showReaders(m.messageId) } label: {
            Image(systemName: allRead || someRead ? "checkmark.circle.fill" : "checkmark")
                .font(.system(size: 11))
                .foregroundStyle(allRead ? Color(hex: 0x3DA8E0) : sub)
        }.buttonStyle(.plain)
    }

    private func moderationActions(flagged: Bool) -> some View {
        let busy = model.moderatingIds.contains(m.messageId)
        return HStack(spacing: 12) {
            if flagged {
                Button { model.unflag(m.messageId) } label: {
                    Label("Dismiss flag", systemImage: "circle").font(.inter(10.5, .bold)).foregroundStyle(Color(hex: 0x0F6B33))
                }
            } else {
                Button { model.flag(m.messageId) } label: {
                    Label("Flag", systemImage: "flag").font(.inter(10.5, .semibold)).foregroundStyle(Nuru.muted)
                }
            }
            Button { model.remove(m.messageId) } label: {
                Label("Remove", systemImage: "trash").font(.inter(10.5, .bold)).foregroundStyle(Nuru.danger)
            }
        }
        .buttonStyle(.plain).disabled(busy).opacity(busy ? 0.5 : 1)
        .padding(.leading, 2)
    }
}

/// Asymmetric bubble corner (sharp on the sender's bottom inside corner).
private struct BubbleShape: Shape {
    let mine: Bool
    func path(in rect: CGRect) -> Path {
        let big: CGFloat = 16, small: CGFloat = 5
        return Path(roundedRect: rect,
                    cornerRadii: RectangleCornerRadii(
                        topLeading: big, bottomLeading: mine ? big : small,
                        bottomTrailing: mine ? small : big, topTrailing: big),
                    style: .continuous)
    }
}

private struct AttachmentView: View {
    let m: PMessageRow
    let onNavy: Bool
    var body: some View {
        Group {
            if m.msgType == "image", let u = m.attachmentUrl, let url = URL(string: u) {
                AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fit) }
                placeholder: { Rectangle().fill(Nuru.mutedBg).frame(height: 120) }
                .frame(maxWidth: 240, maxHeight: 240)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else if let u = m.attachmentUrl, let url = URL(string: u) {
                Link(destination: url) {
                    HStack(spacing: 8) {
                        Image(systemName: m.msgType == "voice" ? "waveform" : "doc.text")
                            .font(.system(size: 14)).foregroundStyle(Nuru.navy)
                        Text(m.msgType == "voice" ? "Voice note" : m.attachmentName)
                            .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.navy).lineLimit(1)
                    }
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .frame(maxWidth: 240, alignment: .leading)
                    .background(Color.black.opacity(0.04))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
    }
}

// MARK: - Modals

private struct CreateSpaceSheet: View {
    @ObservedObject var model: ChatModel
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var topic = ""
    @State private var errorText: String? = nil
    @State private var busy = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("A public, joinable channel in the mobile-app chat.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Space name").font(.nMicro).foregroundStyle(Nuru.muted)
                        sheetField("e.g. Citywide Prayer Wall", text: $name)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Topic (optional)").font(.nMicro).foregroundStyle(Nuru.muted)
                        sheetField("What is this space for?", text: $topic)
                    }
                    if let errorText {
                        Text(errorText).font(.nCaption).foregroundStyle(Nuru.danger)
                    }
                }
                .padding(Nuru.S.screen)
            }
            .background(Nuru.paper)
            .navigationTitle("Create a space").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") { submit() }.disabled(busy)
                }
            }
        }
    }
    private func sheetField(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .font(.nCaption).textFieldStyle(.plain)
            .padding(.horizontal, 12).frame(height: 40)
            .background(Nuru.inputBg)
            .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    private func submit() {
        guard name.trimmed.count >= 3 else { errorText = "Give the space a name (at least 3 characters)."; return }
        busy = true; errorText = nil
        Task {
            let ok = await model.createSpace(title: name.trimmed, topic: topic.trimmed)
            busy = false
            if ok { dismiss() } else { errorText = "Could not create the space. Please try again." }
        }
    }
}

private struct NewMessageSheet: View {
    @ObservedObject var model: ChatModel
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var people: [PPerson] = []
    @State private var loading = true
    @State private var error: String? = nil
    @State private var busyId: String? = nil
    var body: some View {
        NavigationStack {
            List {
                if loading { HStack { Spacer(); ProgressView(); Spacer() } }
                else if people.isEmpty { Text("No one matches “\(q)”.").foregroundStyle(Nuru.muted) }
                else {
                    ForEach(people) { p in
                        Button { pick(p.userId) } label: {
                            HStack(spacing: 12) {
                                ConvAvatar(name: p.fullName, uri: p.avatarUrl, kind: "dm", size: 38)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(p.fullName).font(.inter(13, .bold)).foregroundStyle(Nuru.navy)
                                    Text(p.role + (p.congregation.map { " · \($0)" } ?? "")).font(.nMicro).foregroundStyle(Nuru.muted)
                                }
                                Spacer()
                                if busyId == p.userId { ProgressView().controlSize(.small) }
                                else { Image(systemName: "paperplane").foregroundStyle(Nuru.muted) }
                            }
                        }.disabled(busyId != nil)
                    }
                }
                if let error { Text(error).foregroundStyle(Nuru.danger).font(.nCaption) }
            }
            .searchable(text: $q, prompt: "Search people by name…")
            .navigationTitle("New message").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .task(id: q) { await load() }
        }
    }
    private func load() async {
        loading = true
        try? await Task.sleep(nanoseconds: 220_000_000)
        if Task.isCancelled { return }
        do {
            let env: PPeopleEnvelope = try await APIClient.shared.get(
                "/chat/people", query: q.trimmed.isEmpty ? [:] : ["q": q.trimmed], as: PPeopleEnvelope.self)
            people = env.people; error = nil
        } catch let err { error = (err as? APIError)?.errorDescription ?? "Could not load the directory." }
        loading = false
    }
    private func pick(_ userId: String) {
        busyId = userId
        Task {
            let opened = await model.startDm(userId)
            busyId = nil
            if opened { dismiss() } else { error = "Could not start the conversation." }
        }
    }
}

private struct SeenBySheet: View {
    let messageId: String
    @Environment(\.dismiss) private var dismiss
    @State private var data: PReaders? = nil
    var body: some View {
        NavigationStack {
            List {
                if let d = data {
                    if d.readers.isEmpty { Text("No one has read this yet.").foregroundStyle(Nuru.muted) }
                    else {
                        ForEach(d.readers) { r in
                            HStack(spacing: 12) {
                                ConvAvatar(name: r.fullName, uri: r.avatarUrl, kind: "dm", size: 32)
                                Text(r.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                Spacer()
                                HStack(spacing: 4) {
                                    if let at = r.readAt { Text(Fmt.relative(at)).font(.nMicro).foregroundStyle(Nuru.muted) }
                                    Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(hex: 0x3DA8E0))
                                }
                            }
                        }
                    }
                } else { HStack { Spacer(); ProgressView(); Spacer() } }
            }
            .navigationTitle(data.map { "Seen by · \($0.readCount) of \($0.recipientCount)" } ?? "Seen by")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                data = (try? await APIClient.shared.get("/chat/messages/\(messageId)/readers", as: PReaders.self))
                    ?? .empty
            }
        }
    }
}

// MARK: - Nuru intents / tones

private enum NuruIntent: String, CaseIterable, Identifiable {
    case reply, encourage, prayer
    var id: String { rawValue }
    var label: String { switch self { case .reply: "Help me reply"; case .encourage: "Encourage"; case .prayer: "Offer a prayer" } }
    var prompt: String {
        switch self {
        case .reply:     "Draft a short, warm admin reply to the most recent member message in this conversation."
        case .prayer:    "Offer a short, heartfelt prayer responding to what this member shared."
        case .encourage: "Write a brief, genuine word of encouragement for this member."
        }
    }
}
private enum NuruTone: String, CaseIterable, Identifiable {
    case `default`, shorter, warmer, formal
    var id: String { rawValue }
    var label: String { switch self { case .default: "Default"; case .shorter: "Shorter"; case .warmer: "Warmer"; case .formal: "Formal" } }
    var suffix: String {
        switch self {
        case .default:  ""
        case .shorter:  " Keep it to one or two sentences."
        case .warmer:   " Make it especially warm and personal."
        case .formal:   " Use a respectful, formal tone."
        }
    }
}

// MARK: - View model (state + server-authoritative actions)

@MainActor
private final class ChatModel: ObservableObject {
    // List
    @Published var listState: Loadable<Void> = .idle
    @Published var rows: [PConversationRow] = []
    @Published var discover: [PDiscoverSpace] = []
    @Published var listError: String? = nil

    // Selection / filters
    @Published var segment: Segment = .dm
    @Published var query = ""
    @Published var activeId = ""

    // Modals
    @Published var createOpen = false
    @Published var newMsgOpen = false
    @Published var readersForId: IdBox? = nil
    @Published var joiningId: String? = nil

    // Thread
    @Published var messages: [PMessageRow] = []
    @Published var threadError: String? = nil
    @Published var threadLoading = false
    @Published var draft = ""
    @Published var sending = false
    @Published var uploading = false

    // Local-only display
    @Published var muted: Set<String> = []
    @Published var archived: Set<String> = []
    @Published var moderatingIds: Set<String> = []

    // Nuru
    @Published var aiOpen = true
    @Published var assistOpen = false
    @Published var assistIntent: NuruIntent? = nil
    @Published var assistBusy = false
    @Published var summary: String? = nil
    @Published var summaryBusy = false

    struct IdBox: Identifiable { let id: String }

    private let api = APIClient.shared

    // MARK: derived
    var filtered: [PConversationRow] {
        rows.filter { c in
            guard c.kind == segment.kind else { return false }
            let q = query.trimmed.lowercased()
            if q.isEmpty { return true }
            let hay = "\(c.displayName) \(c.lastBody ?? "") \(c.lastAuthor ?? "")".lowercased()
            return hay.contains(q)
        }
    }
    var active: PConversationRow? {
        filtered.first(where: { $0.conversationId == activeId })
            ?? filtered.first
            ?? rows.first(where: { $0.conversationId == activeId })
    }
    func count(_ seg: Segment) -> Int { rows.filter { $0.kind == seg.kind }.count }
    var totalFlagged: Int { rows.reduce(0) { $0 + $1.flagged } }
    var isMuted: Bool { active.map { muted.contains($0.conversationId) } ?? false }
    var isArchived: Bool { active.map { archived.contains($0.conversationId) } ?? false }
    var heroStats: [HeroStat] {
        let day: TimeInterval = 24 * 3600
        let activeToday = rows.filter { r in
            guard let at = r.lastAt, let d = isoDate(at) else { return false }
            return Date().timeIntervalSince(d) < day
        }.count
        let unread = rows.reduce(0) { $0 + $1.unread }
        return [
            HeroStat(label: "Conversations", value: "\(rows.count)", hint: "all chats"),
            HeroStat(label: "Active today", value: "\(activeToday)", hint: "with activity"),
            HeroStat(label: "Unread", value: "\(unread)", hint: "across chats"),
            HeroStat(label: "Flagged", value: "\(totalFlagged)", hint: "need moderation"),
        ]
    }

    // MARK: list
    func loadList() async {
        if case .loaded = listState {} else { listState = .loading }
        do {
            let r: PChatList = try await api.get("/chat/conversations", query: ["scope": "mine"], as: PChatList.self)
            rows = r.conversations
            discover = r.discoverSpaces
            listError = nil
            listState = .loaded(())
            if activeId.isEmpty, let first = r.conversations.first { select(first.conversationId) }
        } catch {
            let m = (error as? APIError)?.errorDescription ?? "Could not load conversations."
            if rows.isEmpty { listState = .failed(m) } else { listError = m }
        }
    }

    func select(_ id: String) {
        activeId = id
        Task { await loadThread(id) }
    }

    private func loadThread(_ id: String) async {
        threadLoading = true; summary = nil; assistOpen = false; assistIntent = nil
        do {
            let d: PConversationDetail = try await api.get("/chat/conversations/\(id)", as: PConversationDetail.self)
            messages = d.messages; threadError = nil
            // best-effort mark-read
            _ = try? await api.post("/chat/conversations/\(id)/read", body: EmptyBody(), as: ReadAck.self)
            if let idx = rows.firstIndex(where: { $0.conversationId == id }) { rows[idx].unread = 0 }
        } catch {
            threadError = (error as? APIError)?.errorDescription ?? "Could not open this conversation."
            messages = []
        }
        threadLoading = false
    }

    private func refetchThread(_ id: String) async {
        if let d: PConversationDetail = try? await api.get("/chat/conversations/\(id)", as: PConversationDetail.self) {
            messages = d.messages
        }
    }

    // MARK: send
    func sendAdminMessage() async {
        guard let active, !draft.trimmed.isEmpty, !sending, !isArchived else { return }
        let id = active.conversationId; let text = draft.trimmed
        sending = true
        do {
            _ = try await api.post("/chat/conversations/\(id)/messages",
                                   body: SendBody(messageId: UUID().uuidString, body: text, msgType: "text"),
                                   as: SendAck.self)
            draft = ""; assistOpen = false; assistIntent = nil
            await refetchThread(id)
            if let idx = rows.firstIndex(where: { $0.conversationId == id }) {
                rows[idx].lastBody = text; rows[idx].lastAt = isoNow; rows[idx].lastAuthor = "You"
            }
        } catch {
            threadError = (error as? APIError)?.errorDescription ?? "Could not send your reply."
        }
        sending = false
    }

    // MARK: moderation (server-authoritative)
    private func moderate(_ messageId: String, _ run: @escaping () async throws -> Void) {
        guard let active, !moderatingIds.contains(messageId) else { return }
        let id = active.conversationId
        moderatingIds.insert(messageId)
        Task {
            do { try await run(); await refetchThread(id); await loadList() }
            catch { threadError = (error as? APIError)?.errorDescription ?? "Moderation action failed." }
            moderatingIds.remove(messageId)
        }
    }
    func flag(_ id: String)   { moderate(id) { _ = try await self.api.post("/chat/messages/\(id)/flag", body: EmptyBody(), as: ModAck.self) } }
    func unflag(_ id: String) { moderate(id) { _ = try await self.api.post("/chat/messages/\(id)/unflag", body: EmptyBody(), as: ModAck.self) } }
    func remove(_ id: String) { moderate(id) { _ = try await self.api.post("/chat/messages/\(id)/remove", body: EmptyBody(), as: ModAck.self) } }

    /// Toggle an emoji reaction on a message (POST /chat/messages/{id}/reactions {emoji}).
    func react(_ messageId: String, _ emoji: String) {
        struct ReactBody: Encodable { let emoji: String }
        struct ReactAck: Decodable {}
        Task {
            _ = try? await api.post("/chat/messages/\(messageId)/reactions", body: ReactBody(emoji: emoji), as: ReactAck.self)
            await refetchThread(activeId)
        }
    }

    // MARK: local toggles
    func toggleMute()    { if let id = active?.conversationId { toggle(&muted, id) } }
    func toggleArchive() { if let id = active?.conversationId { toggle(&archived, id) } }
    private func toggle(_ set: inout Set<String>, _ id: String) { if set.contains(id) { set.remove(id) } else { set.insert(id) } }

    // MARK: spaces / dms / readers
    func joinSpace(_ id: String) async {
        guard joiningId == nil else { return }
        joiningId = id
        do {
            _ = try await api.post("/chat/spaces/\(id)/join", body: EmptyBody(), as: JoinAck.self)
            await loadList(); select(id)
        } catch { listError = (error as? APIError)?.errorDescription ?? "Could not join the space." }
        joiningId = nil
    }

    func createSpace(title: String, topic: String) async -> Bool {
        let cid = UUID().uuidString
        do {
            let res: CreateSpaceAck = try await api.post("/chat/spaces",
                body: CreateSpaceBody(conversationId: cid, title: title, topic: topic.isEmpty ? nil : topic),
                as: CreateSpaceAck.self)
            await loadList(); select(res.conversationId); return true
        } catch { return false }
    }

    func startDm(_ userId: String) async -> Bool {
        do {
            let res: DmAck = try await api.post("/chat/dms", body: DmBody(userId: userId), as: DmAck.self)
            await loadList(); segment = .dm; select(res.conversationId); return true
        } catch { return false }
    }

    func showReaders(_ messageId: String) { readersForId = IdBox(id: messageId) }

    // MARK: Nuru
    func toggleNuru() {
        aiOpen.toggle()
        if aiOpen && summary == nil { Task { await loadSummary() } }
    }
    private func recentTurns() -> [AssistTurn] {
        messages.filter { !$0.isHidden }.suffix(12).map {
            AssistTurn(role: $0.mine ? "assistant" : "user", text: String("\($0.authorName): \($0.body)".prefix(4000)))
        }.filter { !$0.text.trimmed.isEmpty }
    }
    func loadSummary() async {
        guard let active else { return }
        summaryBusy = true
        do {
            let r: AssistReply = try await api.post("/assistant/chat",
                body: AssistChatBody(messages: [AssistTurn(role: "user",
                    text: "Summarise this conversation in 2-3 sentences, noting any prayer requests, follow-ups, or anything needing a leader's attention.")],
                    conversationId: active.conversationId), as: AssistReply.self)
            summary = r.reply
        } catch {
            summary = nil
            threadError = (error as? APIError)?.errorDescription ?? "Nuru summary unavailable."
        }
        summaryBusy = false
    }
    func runAssist(_ intent: NuruIntent, tone: NuruTone = .default) {
        guard let active else { return }
        assistIntent = intent; assistBusy = true
        Task {
            do {
                let ask = AssistTurn(role: "user", text: intent.prompt + tone.suffix)
                let r: AssistReply = try await api.post("/assistant/chat",
                    body: AssistChatBody(messages: recentTurns() + [ask], conversationId: active.conversationId),
                    as: AssistReply.self)
                draft = r.reply
            } catch {
                threadError = (error as? APIError)?.errorDescription ?? "Nuru could not draft a reply just now."
            }
            assistBusy = false
        }
    }

    // MARK: small helpers
    private var isoNow: String { ISO8601DateFormatter().string(from: Date()) }
    private func isoDate(_ s: String) -> Date? {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }
}

// MARK: - Request / response bodies

private struct EmptyBody: Encodable {}
private struct ReadAck: Decodable {}
private struct ModAck: Decodable {}
private struct JoinAck: Decodable {}
private struct SendAck: Decodable {}
private struct SendBody: Encodable { let messageId: String; let body: String; let msgType: String }
private struct CreateSpaceBody: Encodable { let conversationId: String; let title: String; let topic: String? }
private struct CreateSpaceAck: Decodable { @DefaultEmpty var conversationId: String }
private struct DmBody: Encodable { let userId: String }
private struct DmAck: Decodable { @DefaultEmpty var conversationId: String }

private struct AssistTurn: Codable { let role: String; let text: String }
private struct AssistChatBody: Encodable { let messages: [AssistTurn]; let conversationId: String }
private struct AssistReply: Decodable { @DefaultEmpty var reply: String }
