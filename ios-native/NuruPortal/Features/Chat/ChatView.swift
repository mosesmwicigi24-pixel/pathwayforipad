// Chat — staff inbox (Spaces / Groups / DMs) over /chat/conversations, with a
// native message thread. Read + open; composing is the next iteration.
import SwiftUI

struct ChatView: View {
    var body: some View {
        AsyncView(PortalAPI.chatConversations) { list in
            if list.conversations.isEmpty && list.discoverSpaces.isEmpty {
                ContentUnavailableView("No conversations", systemImage: "bubble.left.and.bubble.right",
                                       description: Text("Your Spaces, Groups and DMs will appear here."))
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(list.conversations) { c in
                            NavigationLink {
                                ChatThreadView(conversationId: c.conversationId, title: c.displayName)
                            } label: { ConversationRow(c: c) }
                            .buttonStyle(.plain)
                        }
                        if !list.discoverSpaces.isEmpty {
                            SectionTitle(text: "Discover spaces").padding(.top, 8)
                            ForEach(list.discoverSpaces) { s in
                                Card {
                                    HStack {
                                        Image(systemName: "number").foregroundStyle(Nuru.gold)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(s.title ?? "Space").font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                            if let t = s.topic { Text(t).font(.caption).foregroundStyle(Nuru.muted) }
                                        }
                                        Spacer()
                                        Text("\(s.memberCount)").font(.caption).foregroundStyle(Nuru.muted)
                                    }
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Chat")
    }
}

private struct ConversationRow: View {
    let c: ChatConversationRow
    var body: some View {
        Card {
            HStack(spacing: 12) {
                if c.kind == "dm", let a = c.avatarUrl, let url = URL(string: a) {
                    AsyncImage(url: url) { $0.resizable().aspectRatio(contentMode: .fill) }
                    placeholder: { Monogram(name: c.displayName, size: 44) }
                    .frame(width: 44, height: 44).clipShape(Circle())
                } else if c.kind == "dm" {
                    Monogram(name: c.displayName, size: 44)
                } else {
                    ZStack {
                        Circle().fill(Nuru.navy.opacity(0.1)).frame(width: 44, height: 44)
                        Image(systemName: c.isPublic ? "number" : "person.3").foregroundStyle(Nuru.navy)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(c.displayName).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                    if let body = c.lastBody {
                        Text("\(c.lastAuthor.map { "\($0): " } ?? "")\(body)")
                            .font(.caption).foregroundStyle(Nuru.muted).lineLimit(1)
                    }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 4) {
                    if let at = c.lastAt { Text(Fmt.relative(at)).font(.caption2).foregroundStyle(Nuru.muted) }
                    if c.unread > 0 {
                        Text("\(c.unread)").font(.caption2.weight(.bold)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Nuru.gold).clipShape(Capsule())
                    }
                }
            }
        }
    }
}

struct ChatThreadView: View {
    let conversationId: String
    let title: String
    var body: some View {
        AsyncView({ try await PortalAPI.chatConversation(conversationId) }) { detail in
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(detail.messages) { m in MessageBubble(m: m) }
                }
                .padding(20)
            }
            .background(Nuru.background)
        }
        .portalPage(title)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct MessageBubble: View {
    let m: ChatMessageRow
    var body: some View {
        HStack {
            if m.mine { Spacer(minLength: 40) }
            VStack(alignment: m.mine ? .trailing : .leading, spacing: 3) {
                if !m.mine {
                    Text(m.authorName).font(.caption2.weight(.semibold)).foregroundStyle(Nuru.gold)
                }
                if let rb = m.replyBody {
                    Text("↳ \(m.replyAuthor.map { "\($0): " } ?? "")\(rb)")
                        .font(.caption2).foregroundStyle(Nuru.muted).lineLimit(1)
                }
                Text(m.body)
                    .font(.subheadline)
                    .foregroundStyle(m.mine ? .white : Nuru.foreground)
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(m.mine ? Nuru.navy : Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Nuru.border, lineWidth: m.mine ? 0 : 1))
                Text(Fmt.relative(m.createdAt)).font(.caption2).foregroundStyle(Nuru.muted)
            }
            if !m.mine { Spacer(minLength: 40) }
        }
    }
}
