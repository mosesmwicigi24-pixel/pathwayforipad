// Certificates — line-by-line port of the web make (packages/admin-web/src/
// components/pages/Certificates.tsx), tailored for iPad. Navy hero with the
// "Operations › Certificates" breadcrumb, an issued-count tag + Issue chip, the
// issued list with member search + status chips + revoke, a server-authoritative
// public verification panel (GET /verify/{code} recomputes the content hash +
// checks the HMAC signature + revocation, §5.5), a rendered certificate preview
// (the gold-bordered CertificateArt), and the signature / document-hash
// indicators. Reuses PortalAPI.certificates(); the document hash + verification
// result come from page-local Codable structs (the shared CertificateRow model
// omits content_hash, which we must not edit).
import SwiftUI
import UIKit

// MARK: - Page-local wire types (content_hash isn't on the shared CertificateRow)

/// /admin/certificates row including the crypto fields the preview shows.
private struct CertFull: Codable, Identifiable {
    @DefaultEmpty var certificateId: String
    @DefaultEmpty var fullName: String
    let levelNumber: Int?
    let levelTitle: String?
    @DefaultEmpty var verificationCode: String
    @DefaultEmpty var issuedAt: String
    let revokedAt: String?
    @DefaultEmpty var contentHash: String
    var id: String { certificateId }
    var isValid: Bool { revokedAt == nil }
}
private struct CertFullPage: Codable { let data: [CertFull]; let nextCursor: String? }

/// GET /verify/{code} — server recomputes the hash + checks the HMAC signature.
private struct CertVerification: Codable {
    @DefaultFalse var valid: Bool
    let revoked: Bool?
    let recipientName: String?
    let levelNumber: Int?
    let issuedAt: String?
    let verificationCode: String?
    let contentHash: String?
}

// MARK: - Helpers (mirror the web's pure functions)

private func certInitials(_ n: String) -> String {
    let p = n.split(whereSeparator: { $0 == " " }).prefix(2).compactMap { $0.first }
    return p.isEmpty ? "?" : String(p).uppercased()
}
private func shortHash(_ h: String) -> String {
    guard !h.isEmpty else { return "—" }
    return h.count > 14 ? "\(h.prefix(10))…\(h.suffix(4))" : h
}
private func certDate(_ iso: String?) -> String {
    Fmt.date(iso, style: .dateTime.day(.twoDigits).month(.abbreviated).year())
}

// MARK: - View

struct CertificatesView: View {
    @State private var certs: [CertFull] = []
    @State private var levels: [AdminLevel] = []
    @State private var selId: String?
    @State private var query = ""
    @State private var error: String?
    @State private var notice: String?

    // Issue + revoke
    @State private var issueOpen = false
    @State private var revoking: CertFull?     // certificate pending a revoke reason
    @State private var revokeReason = ""

    // Public verification panel
    @State private var verifyInput = ""
    @State private var verifying = false
    @State private var result: VerifyResult?

    // Preview controls
    @State private var copied = false

    private struct VerifyResult {
        let valid: Bool
        let revoked: Bool
        let notFound: Bool
        let v: CertVerification?
    }

    private var filtered: [CertFull] {
        guard !query.isEmpty else { return certs }
        let q = query.lowercased()
        return certs.filter { "\($0.fullName) \($0.verificationCode)".lowercased().contains(q) }
    }
    private var selected: CertFull? { certs.first { $0.certificateId == selId } }

    private func levelName(_ n: Int?) -> String {
        guard let n else { return "" }
        return levels.first { $0.levelNumber == n }?.title ?? ""
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                hero

                VStack(alignment: .leading, spacing: 24) {
                    if let error { Text(error).font(.nCaption).foregroundStyle(Nuru.danger) }
                    if let notice { Text(notice).font(.nCaption).foregroundStyle(Nuru.success) }

                    // Two-column on iPad (issued list + verification | preview).
                    ViewThatFits(in: .horizontal) {
                        HStack(alignment: .top, spacing: 24) {
                            leftColumn.frame(maxWidth: .infinity)
                            previewColumn.frame(maxWidth: .infinity)
                        }
                        VStack(spacing: 24) {
                            leftColumn
                            previewColumn
                        }
                    }
                }
                .padding(24)
            }
        }
        .background(Nuru.paper)
        .navigationTitle("Certificates")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load(); await loadLevels() }
        .refreshable { await load() }
        .sheet(isPresented: $issueOpen) {
            IssueCertificateSheet(levels: levels) { name in
                issueOpen = false; notice = "Certificate issued to \(name)."; await load()
            } onError: { error = $0 }
        }
        .alert("Revoke certificate?", isPresented: Binding(get: { revoking != nil }, set: { if !$0 { revoking = nil } })) {
            TextField("Reason", text: $revokeReason)
            Button("Cancel", role: .cancel) { revoking = nil; revokeReason = "" }
            Button("Revoke", role: .destructive) {
                if let c = revoking, !revokeReason.trimmingCharacters(in: .whitespaces).isEmpty {
                    let reason = revokeReason
                    Task { await revoke(c, reason: reason) }
                }
                revoking = nil; revokeReason = ""
            }
        } message: {
            Text("Revoke \(revoking?.fullName ?? "")'s certificate? Enter a reason.")
        }
    }

    // MARK: Hero

    private var hero: some View {
        PortalHero(
            breadcrumb: ["Operations", "Certificates"],
            title: "Certificates",
            subtitle: "Issued completion certificates with server-verified signatures."
        ) {
            HStack(spacing: 8) {
                HeroChip(label: "\(certs.count) issued", icon: "rosette", style: .tag)
                HeroChip(label: "Issue certificate", icon: "plus", style: .gold) { issueOpen = true }
            }
        }
    }

    // MARK: Left column — issued list + public verification

    private var leftColumn: some View {
        VStack(spacing: 24) {
            issuedListCard
            verificationCard
        }
    }

    private var issuedListCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Issued certificates").font(.inter(15, .bold)).foregroundStyle(Nuru.ink)
                        Text("\(certs.count) on record").font(.nMicro).foregroundStyle(Nuru.muted)
                    }
                    Spacer()
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Nuru.muted)
                        TextField("Member or code", text: $query)
                            .font(.nCaption).textInputAutocapitalization(.never)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .frame(width: 220)
                    .background(Nuru.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                }
                .padding(.horizontal, 18).padding(.vertical, 14)
                Divider().overlay(Nuru.border)

                // Aligned column header (Member · Level · Issued · Code · Status · ⋯)
                certHeaderRow
                Divider().overlay(Nuru.border)

                if filtered.isEmpty {
                    Text("No certificates match.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity).padding(.vertical, 28)
                } else {
                    ForEach(Array(filtered.enumerated()), id: \.element.id) { i, c in
                        if i > 0 { Divider().overlay(Nuru.border) }
                        certRow(c)
                    }
                }
            }
        }
    }

    private var certHeaderRow: some View {
        HStack(spacing: 12) {
            Color.clear.frame(width: 3)
            Text("Member").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.ink600)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Level").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.ink600)
                .frame(width: 52, alignment: .leading)
            Text("Issued").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.ink600)
                .frame(width: 88, alignment: .leading)
            Text("Code").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.ink600)
                .frame(width: 104, alignment: .leading)
            Text("Status").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.ink600)
                .frame(width: 72, alignment: .leading)
            Color.clear.frame(width: 26)
        }
        .padding(.leading, 12).padding(.trailing, 16).padding(.vertical, 8)
        .background(Nuru.inputBg.opacity(0.5))
    }

    private func certRow(_ c: CertFull) -> some View {
        let isSel = c.certificateId == selId
        return Button { selId = c.certificateId } label: {
            HStack(spacing: 12) {
                Rectangle().fill(isSel ? Nuru.gold : .clear).frame(width: 3)
                    .frame(maxHeight: .infinity)
                HStack(spacing: 9) {
                    RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Nuru.navy)
                        .frame(width: 26, height: 26)
                        .overlay(Text(certInitials(c.fullName)).font(.inter(10.5, .bold)).foregroundStyle(.white))
                    Text(c.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(c.levelNumber.map { "L\($0)" } ?? "Prog")
                    .font(.nMicro).foregroundStyle(Nuru.ink).frame(width: 52, alignment: .leading)
                Text(certDate(c.issuedAt)).font(.nMicro).foregroundStyle(Nuru.muted)
                    .frame(width: 88, alignment: .leading)
                Text(c.verificationCode).font(.inter(11, .regular)).monospaced()
                    .foregroundStyle(Nuru.ink).lineLimit(1).frame(width: 104, alignment: .leading)
                Pill(text: c.isValid ? "Valid" : "Revoked", color: c.isValid ? Nuru.success : Nuru.danger)
                    .frame(width: 72, alignment: .leading)
                if c.isValid {
                    Button { revokeReason = ""; revoking = c } label: {
                        Image(systemName: "arrow.uturn.backward").font(.system(size: 11))
                            .foregroundStyle(Nuru.danger)
                            .padding(6)
                            .background(Nuru.danger.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .frame(width: 26)
                } else {
                    Color.clear.frame(width: 26, height: 1)
                }
            }
            .padding(.trailing, 16).padding(.vertical, 9)
            .background(isSel ? Nuru.surface : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var verificationCard: some View {
        Card(padding: 0) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.shield.fill").foregroundStyle(Nuru.gold)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Public verification").font(.inter(13, .bold)).foregroundStyle(.white)
                        Text("How members and employers verify a certificate")
                            .font(.nMicro).foregroundStyle(Nuru.onNavyDim)
                    }
                    Spacer()
                }
                .padding(.horizontal, 20).padding(.vertical, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Nuru.navy)

                VStack(alignment: .leading, spacing: 12) {
                    Text("ENTER VERIFICATION CODE").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    HStack(spacing: 8) {
                        HStack(spacing: 8) {
                            Image(systemName: "number").font(.system(size: 13)).foregroundStyle(Nuru.muted)
                            TextField("NURU-…", text: $verifyInput)
                                .font(.inter(14, .regular)).monospaced()
                                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                                .onChange(of: verifyInput) { _, new in
                                    verifyInput = new.uppercased()
                                    if result != nil { result = nil }
                                }
                                .onSubmit { Task { await runVerify() } }
                        }
                        .padding(.horizontal, 12).padding(.vertical, 12)
                        .frame(maxWidth: .infinity)
                        .background(Nuru.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Nuru.border, lineWidth: 1))

                        Button { Task { await runVerify() } } label: {
                            HStack(spacing: 8) {
                                if verifying { ProgressView().tint(.white) }
                                else { Image(systemName: "checkmark.shield") }
                                Text("Verify").font(.inter(13, .semibold))
                            }
                            .foregroundStyle(.white)
                            .padding(.horizontal, 18).padding(.vertical, 12)
                            .background(Nuru.gold)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        }
                        .buttonStyle(.plain).disabled(verifying)
                    }

                    if !certs.isEmpty {
                        HStack(spacing: 8) {
                            Text("Try:").font(.nMicro).foregroundStyle(Nuru.muted)
                            ForEach(certs.prefix(3)) { c in
                                Button {
                                    verifyInput = c.verificationCode
                                    result = nil
                                } label: {
                                    Text(c.verificationCode).font(.inter(11, .regular)).monospaced()
                                        .foregroundStyle(Nuru.ink)
                                        .padding(.horizontal, 8).padding(.vertical, 3)
                                        .background(Nuru.surface)
                                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                }
                                .buttonStyle(.plain)
                            }
                            Spacer()
                        }
                    }

                    if let result { verifyResult(result) }
                }
                .padding(24)
            }
        }
    }

    private func verifyResult(_ r: VerifyResult) -> some View {
        let ok = r.valid
        return HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().fill(ok ? Nuru.success : Nuru.danger).frame(width: 40, height: 40)
                Image(systemName: ok ? "checkmark.shield.fill" : "xmark.shield.fill")
                    .font(.system(size: 18)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(ok ? "Valid certificate"
                     : r.notFound ? "No certificate found"
                     : r.revoked ? "Certificate revoked" : "Certificate invalid")
                    .font(.inter(14, .bold)).foregroundStyle(ok ? Nuru.successText : Nuru.danger)
                if let v = r.v {
                    HStack(alignment: .top, spacing: 24) {
                        VStack(alignment: .leading, spacing: 6) {
                            verifyField("Name", v.recipientName ?? "—")
                            verifyField("Issued", v.issuedAt.map { certDate($0) } ?? "—")
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            verifyField("Level", v.levelNumber != nil ? "L\(v.levelNumber!) · \(levelName(v.levelNumber))" : "Program")
                            verifyField("Code", v.verificationCode ?? verifyInput, mono: true)
                        }
                    }
                    if let h = v.contentHash, !h.isEmpty {
                        verifyField("Document hash", shortHash(h), mono: true)
                    }
                    HStack(spacing: 4) {
                        Image(systemName: ok ? "checkmark" : "xmark.shield").font(.system(size: 10, weight: .bold))
                        Text(ok ? "Hash + signature verified server-side"
                             : r.revoked ? "Revoked by an administrator" : "Signature check failed")
                            .font(.nMicro)
                    }
                    .foregroundStyle(ok ? Nuru.successText : Nuru.danger)
                } else {
                    Text("This code does not match any certificate on record.")
                        .font(.nCaption).foregroundStyle(Nuru.danger)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(ok ? Nuru.successBg.opacity(0.55) : Nuru.danger.opacity(0.08))
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous)
            .stroke((ok ? Nuru.success : Nuru.danger).opacity(0.4), lineWidth: 1))
    }

    private func verifyField(_ label: String, _ value: String, mono: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label.uppercased()).font(.system(size: 10)).tracking(0.5).foregroundStyle(Nuru.muted)
            Text(value).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink)
                .monospaced(mono)
        }
    }

    // MARK: Preview column

    private var previewColumn: some View {
        Group {
            if let sel = selected {
                Card {
                    VStack(alignment: .leading, spacing: 16) {
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("PREVIEW").font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                                Text(sel.fullName).font(.fraunces(20, .medium)).foregroundStyle(Nuru.ink)
                            }
                            Spacer()
                            Button {
                                UIPasteboard.general.string = sel.verificationCode
                                copied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { copied = false }
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                                        .foregroundStyle(copied ? Nuru.success : Nuru.ink)
                                    Text(copied ? "Copied" : "Copy code").font(.inter(12, .semibold)).foregroundStyle(Nuru.ink)
                                }
                                .padding(.horizontal, 12).padding(.vertical, 8)
                                .background(Nuru.surface)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                            }
                            .buttonStyle(.plain)
                        }

                        CertificateArt(c: sel, levelName: sel.levelTitle ?? levelName(sel.levelNumber))

                        HStack(spacing: 12) {
                            indicatorTile(
                                icon: "checkmark.seal", title: "Signature", value: "Nuru Pathway",
                                footer: sel.isValid ? "Cryptographically signed" : "Revoked",
                                footerColor: sel.isValid ? Nuru.success : Nuru.danger,
                                footerIcon: sel.isValid ? "checkmark" : nil)
                            indicatorTile(
                                icon: "number", title: "Document hash", value: shortHash(sel.contentHash),
                                valueMono: true, footer: "SHA-256 · HMAC-signed", footerColor: Nuru.muted, footerIcon: nil)
                        }
                    }
                }
            } else {
                Card(padding: 48) {
                    Text("Select a certificate to preview.")
                        .font(.nCaption).foregroundStyle(Nuru.muted)
                        .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func indicatorTile(icon: String, title: String, value: String, valueMono: Bool = false,
                               footer: String, footerColor: Color, footerIcon: String?) -> some View {
        SurfaceTile {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon).font(.system(size: 15)).foregroundStyle(Nuru.gold)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title.uppercased()).font(.nOverline).tracking(0.6).foregroundStyle(Nuru.muted)
                    Text(value).font(.inter(13, .semibold)).foregroundStyle(Nuru.ink).monospaced(valueMono)
                    HStack(spacing: 4) {
                        if let footerIcon { Image(systemName: footerIcon).font(.system(size: 10, weight: .bold)) }
                        Text(footer).font(.nMicro)
                    }
                    .foregroundStyle(footerColor)
                }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: Data

    private func load() async {
        do {
            let page = try await APIClient.shared.get("/admin/certificates", as: CertFullPage.self)
            certs = page.data
            if !page.data.contains(where: { $0.certificateId == selId }) {
                selId = page.data.first?.certificateId
            }
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Could not load certificates."
        }
    }
    private func loadLevels() async {
        levels = (try? await PortalAPI.curriculumLevels()) ?? []
    }

    private func runVerify() async {
        let code = verifyInput.trimmingCharacters(in: .whitespaces)
        guard !code.isEmpty else { return }
        verifying = true; result = nil
        defer { verifying = false }
        do {
            let v = try await APIClient.shared.get(
                "/verify/\(code.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? code)",
                as: CertVerification.self)
            result = VerifyResult(valid: v.valid, revoked: v.revoked ?? false, notFound: false, v: v)
        } catch {
            result = VerifyResult(valid: false, revoked: false, notFound: true, v: nil)
        }
    }

    private func revoke(_ c: CertFull, reason: String) async {
        struct Body: Encodable { let reason: String }
        do {
            _ = try await APIClient.shared.post(
                "/admin/certificates/\(c.certificateId)/revoke",
                body: Body(reason: reason), as: EmptyResponse.self)
            notice = "Certificate revoked."
            await load()
        } catch {
            self.error = (error as? APIError)?.errorDescription ?? "Revoke failed."
        }
    }

    private struct EmptyResponse: Decodable { init(from decoder: Decoder) throws {} }
}

// MARK: - Issue certificate sheet (member picker → POST /admin/certificates)

/// Mirrors the web IssueModal: debounced member search (GET /admin/members),
/// a level picker (full programme or a specific level), then
/// POST /admin/certificates { user_id, level_number }.
private struct IssueCertificateSheet: View {
    let levels: [AdminLevel]
    let onDone: (String) async -> Void
    let onError: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [MemberRow] = []
    @State private var picked: MemberRow?
    @State private var level: Int?          // nil = full programme
    @State private var busy = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 8) {
                        Image(systemName: "rosette").font(.system(size: 11)).foregroundStyle(Nuru.gold)
                        Text("ISSUE").font(.nOverline).tracking(0.5).foregroundStyle(Nuru.gold)
                    }
                    Text("Issue a certificate").font(.fraunces(24, .medium)).foregroundStyle(Nuru.navy)

                    if let m = picked {
                        HStack(spacing: 12) {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Nuru.navy)
                                .frame(width: 32, height: 32)
                                .overlay(Text(certInitials(m.fullName)).font(.inter(12, .bold)).foregroundStyle(.white))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(m.fullName).font(.inter(13.5, .bold)).foregroundStyle(Nuru.navy)
                                Text("\(m.cellName ?? "—") · L\(m.currentLevel.map(String.init) ?? "—")")
                                    .font(.nMicro).foregroundStyle(Nuru.muted)
                            }
                            Spacer()
                            Button("Change") { picked = nil }
                                .font(.inter(12, .semibold)).foregroundStyle(Nuru.gold)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .background(Nuru.surface)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                    } else {
                        HStack(spacing: 8) {
                            Image(systemName: "magnifyingglass").font(.system(size: 14, weight: .medium)).foregroundStyle(Nuru.ink600)
                            TextField("Search member…", text: $query).font(.inter(15, .regular)).foregroundStyle(Nuru.ink)
                                .textInputAutocapitalization(.words)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 12)
                        .background(Nuru.white)
                        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Self.fieldBorder, lineWidth: 1))

                        VStack(spacing: 6) {
                            ForEach(results) { m in
                                Button { picked = m } label: {
                                    HStack(spacing: 12) {
                                        RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Nuru.navy)
                                            .frame(width: 28, height: 28)
                                            .overlay(Text(certInitials(m.fullName)).font(.inter(11, .bold)).foregroundStyle(.white))
                                        Text(m.fullName).font(.inter(13, .semibold)).foregroundStyle(Nuru.navy)
                                        Spacer()
                                    }
                                    .padding(.horizontal, 12).padding(.vertical, 8)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Nuru.white)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Nuru.border, lineWidth: 1))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    VStack(alignment: .leading, spacing: 6) {
                        Text("LEVEL").font(.inter(12, .semibold)).tracking(0.5).foregroundStyle(Nuru.ink600)
                        Menu {
                            Button("Full programme") { level = nil }
                            ForEach(levels) { l in
                                Button("Level \(l.levelNumber) — \(l.title)") { level = l.levelNumber }
                            }
                        } label: {
                            HStack {
                                Text(level.flatMap { n in levels.first { $0.levelNumber == n }.map { "Level \($0.levelNumber) — \($0.title)" } } ?? "Full programme")
                                    .font(.inter(15, .medium)).foregroundStyle(Nuru.ink).lineLimit(1)
                                Spacer()
                                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(Nuru.gold)
                            }
                            .padding(.horizontal, 12).padding(.vertical, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Nuru.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous).stroke(Self.fieldBorder, lineWidth: 1))
                        }
                    }
                }
                .padding(24)
                .frame(maxWidth: 760)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.paper)
            .scrollContentBackground(.hidden)
            .navigationTitle("Issue certificate").navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button { Task { await issue() } } label: {
                        HStack(spacing: 6) { Image(systemName: "rosette"); Text("Issue").bold() }
                            .font(.inter(14, .semibold))
                            .foregroundStyle((picked == nil || busy) ? AnyShapeStyle(Nuru.muted) : AnyShapeStyle(Color.white))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .background((picked == nil || busy) ? AnyShapeStyle(Nuru.inputBg) : AnyShapeStyle(Nuru.goldGradient))
                            .clipShape(Capsule())
                    }.disabled(picked == nil || busy)
                }
            }
            .onChange(of: query) { _, q in
                searchTask?.cancel()
                let term = q.trimmingCharacters(in: .whitespaces)
                guard !term.isEmpty else { results = []; return }
                searchTask = Task {
                    try? await Task.sleep(nanoseconds: 250_000_000)
                    if Task.isCancelled { return }
                    if let page = try? await PortalAPI.members(search: term) {
                        if !Task.isCancelled { results = Array(page.data.prefix(8)) }
                    } else if !Task.isCancelled {
                        results = []
                    }
                }
            }
        }
        .presentationDetents([.large])
    }
    private static let fieldBorder = Color(hex: 0x0A2540, alpha: 0.20)

    private func issue() async {
        guard let m = picked else { return }
        busy = true; defer { busy = false }
        // Match the web body exactly: { user_id, level_number } where a full-programme
        // certificate sends an explicit null (not an omitted key).
        struct Body: Encodable {
            let userId: String; let levelNumber: Int?
            enum CodingKeys: String, CodingKey { case userId, levelNumber }
            func encode(to encoder: Encoder) throws {
                var c = encoder.container(keyedBy: CodingKeys.self)
                try c.encode(userId, forKey: .userId)
                try c.encode(levelNumber, forKey: .levelNumber)   // emits null when nil
            }
        }
        struct Ack: Decodable { init(from decoder: Decoder) throws {} }
        do {
            _ = try await APIClient.shared.post(
                "/admin/certificates",
                body: Body(userId: m.userId, levelNumber: level), as: Ack.self)
            await onDone(m.fullName)
        } catch {
            onError((error as? APIError)?.errorDescription ?? "Could not issue certificate.")
        }
    }
}

// MARK: - Rendered certificate (the gold-bordered CertificateArt, §5.5)

private struct CertificateArt: View {
    let c: CertFull
    let levelName: String

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let u = w / 100        // 1cqw ≈ 1% of width
            content(w: w, u: u)
        }
        .aspectRatio(1.414, contentMode: .fit)
    }

    private func content(w: CGFloat, u: CGFloat) -> some View {
        ZStack {
            LinearGradient(colors: [Color(hex: 0xFFFDF7), Color(hex: 0xFBF4E2)],
                           startPoint: .top, endPoint: .bottom)
            // Double gold inner frames
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color(hex: 0xC89B3C), lineWidth: 1)
                .padding(2.6 * u)
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(Color(hex: 0xC89B3C, alpha: 0.35), lineWidth: 1)
                .padding(3.8 * u)

            VStack(spacing: 0) {
                HStack(spacing: 1.2 * u) {
                    Image(systemName: "rosette").font(.system(size: 2.6 * u)).foregroundStyle(Color(hex: 0xC89B3C))
                    Text("NURU PATHWAY · CERTIFICATE OF COMPLETION")
                        .font(.inter(2 * u, .bold)).tracking(0.5 * u).foregroundStyle(Color(hex: 0x7A5410))
                        .lineLimit(1).minimumScaleFactor(0.6)
                }
                Rectangle().fill(Color(hex: 0xC89B3C)).frame(width: 11 * u, height: 1).padding(.vertical, 1.8 * u)
                Text("THIS IS TO CERTIFY THAT")
                    .font(.inter(2.1 * u, .regular)).tracking(0.35 * u).foregroundStyle(Color(hex: 0x7A5410))
                    .padding(.top, 0.7 * u)
                Text(c.fullName)
                    .font(.fraunces(6.4 * u, .medium)).foregroundStyle(Color(hex: 0x0B1F33))
                    .multilineTextAlignment(.center).padding(.top, 2 * u)
                Text("has faithfully completed")
                    .font(.inter(2.1 * u, .regular)).tracking(0.2 * u).foregroundStyle(Color(hex: 0x7A5410))
                    .padding(.top, 2 * u)
                Text(c.levelNumber != nil
                     ? "Level \(c.levelNumber!)\(levelName.isEmpty ? "" : " — \(levelName)")"
                     : "the Pathway programme")
                    .font(.fraunces(3.9 * u, .medium)).foregroundStyle(Color(hex: 0x0B1F33))
                    .multilineTextAlignment(.center).padding(.top, 1 * u)

                Spacer(minLength: 4 * u)

                HStack(alignment: .bottom, spacing: 2 * u) {
                    VStack(alignment: .leading, spacing: 0) {
                        Rectangle().fill(Color(hex: 0x0B1F33)).frame(width: 25 * u, height: 1).padding(.top, 0.7 * u)
                        Text("PASTORAL SIGNATURE").font(.inter(1.8 * u, .regular)).tracking(0.2 * u)
                            .foregroundStyle(Color(hex: 0x7A5410)).padding(.top, 0.7 * u)
                        Text("Nuru Pathway").font(.inter(2 * u, .regular)).foregroundStyle(Color(hex: 0x0B1F33))
                    }
                    Spacer(minLength: 0)
                    VStack(spacing: 0.2 * u) {
                        Image(systemName: "seal").font(.system(size: 3.6 * u)).foregroundStyle(Color(hex: 0x7A5410))
                        Text("SEALED").font(.inter(1.4 * u, .bold)).tracking(0.2 * u).foregroundStyle(Color(hex: 0x7A5410))
                    }
                    .frame(width: 12.8 * u, height: 12.8 * u)
                    .overlay(Circle().stroke(Color(hex: 0xC89B3C), lineWidth: 2))
                    Spacer(minLength: 0)
                    VStack(alignment: .trailing, spacing: 0) {
                        Text("ISSUED").font(.inter(1.8 * u, .regular)).tracking(0.2 * u).foregroundStyle(Color(hex: 0x7A5410))
                        Text(certDate(c.issuedAt)).font(.fraunces(2.85 * u, .medium)).foregroundStyle(Color(hex: 0x0B1F33))
                        Text("VERIFICATION CODE").font(.inter(1.8 * u, .regular)).tracking(0.2 * u)
                            .foregroundStyle(Color(hex: 0x7A5410)).padding(.top, 1.8 * u)
                        Text(c.verificationCode).font(.inter(2.3 * u, .bold)).monospaced()
                            .foregroundStyle(Color(hex: 0x0B1F33))
                    }
                }
            }
            .padding(.horizontal, 6.4 * u)
            .padding(.top, 6.4 * u)
            .padding(.bottom, 5 * u)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color(hex: 0xE6D4A8), lineWidth: 1))
    }
}
