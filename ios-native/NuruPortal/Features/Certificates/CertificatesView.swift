// Certificates — issued completion certificates, from /admin/certificates.
import SwiftUI

struct CertificatesView: View {
    var body: some View {
        AsyncView(PortalAPI.certificates) { certs in
            if certs.isEmpty {
                ContentUnavailableView("No certificates yet", systemImage: "rosette",
                                       description: Text("Certificates appear here as members complete levels."))
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(certs) { c in
                            Card {
                                HStack(spacing: 14) {
                                    Monogram(name: c.fullName, size: 40, fill: Nuru.gold)
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(c.fullName).font(.subheadline.weight(.semibold)).foregroundStyle(Nuru.navy)
                                        Text(c.levelTitle ?? (c.levelNumber.map { "Level \($0)" } ?? "Certificate"))
                                            .font(.caption).foregroundStyle(Nuru.muted)
                                        Text("Issued \(Fmt.date(c.issuedAt)) · \(c.verificationCode)")
                                            .font(.caption2).foregroundStyle(Nuru.muted)
                                    }
                                    Spacer()
                                    if c.revokedAt != nil { Pill(text: "Revoked", color: Nuru.danger) }
                                    else { Pill(text: "Valid", color: Nuru.success) }
                                }
                            }
                        }
                    }
                    .padding(20)
                }
            }
        }
        .portalPage("Certificates")
    }
}
