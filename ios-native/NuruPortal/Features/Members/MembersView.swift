// Members — searchable, paginated roster from /admin/members. Native list with
// engagement band coloring and cursor paging (mirrors the web Members page).
import SwiftUI

@MainActor
final class MembersViewModel: ObservableObject {
    @Published var members: [MemberRow] = []
    @Published var loading = false
    @Published var error: String?
    @Published var search = ""

    private var cursor: String?
    private var canLoadMore = true

    func reload() async {
        cursor = nil; canLoadMore = true; members = []
        await loadMore()
    }

    func loadMore() async {
        guard canLoadMore, !loading else { return }
        loading = true; error = nil
        do {
            let page = try await PortalAPI.members(search: search, cursor: cursor)
            members.append(contentsOf: page.data)
            cursor = page.nextCursor
            canLoadMore = page.nextCursor != nil
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }
}

struct MembersView: View {
    @StateObject private var vm = MembersViewModel()

    var body: some View {
        List {
            ForEach(vm.members) { m in
                NavigationLink {
                    MemberDetailView(userId: m.userId, name: m.fullName)
                } label: {
                    MemberRowView(member: m)
                }
                .onAppear {
                    if m.id == vm.members.last?.id { Task { await vm.loadMore() } }
                }
            }
            if vm.loading {
                HStack { Spacer(); ProgressView(); Spacer() }
                    .listRowSeparator(.hidden)
            }
            if let error = vm.error {
                ErrorBanner(message: error) { Task { await vm.reload() } }
                    .listRowSeparator(.hidden)
            }
        }
        .listStyle(.plain)
        .background(Nuru.background)
        .navigationTitle("Members")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.visible, for: .navigationBar)
        .searchable(text: $vm.search, prompt: "Search members")
        .onSubmit(of: .search) { Task { await vm.reload() } }
        .task { if vm.members.isEmpty { await vm.reload() } }
        .refreshable { await vm.reload() }
        .overlay {
            if vm.members.isEmpty && !vm.loading && vm.error == nil {
                ContentUnavailableView("No members", systemImage: "person.2", description: Text("No members match this view."))
            }
        }
    }
}

private struct MemberRowView: View {
    let member: MemberRow
    var body: some View {
        HStack(spacing: 14) {
            Circle().fill(Nuru.navy).frame(width: 42, height: 42)
                .overlay(Text(initials).font(.inter(13, .bold)).foregroundStyle(.white))
            VStack(alignment: .leading, spacing: 3) {
                Text(member.fullName).font(.inter(15, .semibold)).foregroundStyle(Nuru.navy)
                Text(subtitle).font(.nCaption).foregroundStyle(Nuru.muted).lineLimit(1)
            }
            Spacer()
            if let band = member.band {
                Text(band.capitalized)
                    .font(.inter(11.5, .bold))
                    .foregroundStyle(Nuru.bandColor(band))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Nuru.bandColor(band).opacity(0.12))
                    .clipShape(Capsule())
            }
            if let score = member.eScore {
                Text(String(format: "%.0f", score))
                    .font(.inter(15, .bold)).foregroundStyle(Nuru.gold)
                    .frame(minWidth: 34)
            }
        }
        .padding(.vertical, 6)
    }

    private var initials: String {
        let p = member.fullName.split(separator: " ").prefix(2).compactMap { $0.first }
        return p.isEmpty ? "?" : String(p).uppercased()
    }
    private var subtitle: String {
        var bits: [String] = []
        if let c = member.cellName { bits.append(c) }
        if let lvl = member.currentLevel { bits.append("Level \(lvl)") }
        if bits.isEmpty, let e = member.email { bits.append(e) }
        return bits.joined(separator: " · ")
    }
}
