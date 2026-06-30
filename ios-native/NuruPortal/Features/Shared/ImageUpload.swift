// Cloudinary image upload — the native equivalent of the web's
// signAdminImage + uploadToCloudinary flow. A signed upload: ask the backend to
// sign (POST /admin/media/images/sign {folder}), then multipart-POST the image
// straight to Cloudinary's upload_url, and return the secure_url.
import SwiftUI
import PhotosUI

private struct CloudinarySign: Decodable {
    let cloudName: String
    let apiKey: String
    let timestamp: Int
    let folder: String
    let signature: String
    let uploadUrl: String
}
private struct CloudinaryResult: Decodable { let secureUrl: String }

enum ImageUpload {
    /// Sign + upload `data` (JPEG) to Cloudinary; returns the hosted secure URL.
    static func upload(_ data: Data, folder: String) async throws -> String {
        struct SignBody: Encodable { let folder: String }
        let sign = try await APIClient.shared.post("/admin/media/images/sign", body: SignBody(folder: folder), as: CloudinarySign.self)

        guard let url = URL(string: sign.uploadUrl) else { throw APIError.transport("Bad upload URL.") }
        let boundary = "Boundary-\(UUID().uuidString)"
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func add(_ s: String) { body.append(s.data(using: .utf8)!) }
        // file part first (matches the web FormData order)
        add("--\(boundary)\r\n")
        add("Content-Disposition: form-data; name=\"file\"; filename=\"upload.jpg\"\r\n")
        add("Content-Type: image/jpeg\r\n\r\n")
        body.append(data); add("\r\n")
        for (k, v) in [("api_key", sign.apiKey), ("timestamp", String(sign.timestamp)), ("folder", sign.folder), ("signature", sign.signature)] {
            add("--\(boundary)\r\n")
            add("Content-Disposition: form-data; name=\"\(k)\"\r\n\r\n")
            add("\(v)\r\n")
        }
        add("--\(boundary)--\r\n")
        req.httpBody = body

        let (respData, resp) = try await URLSession.shared.data(for: req)
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw APIError.transport("Cloudinary upload failed.")
        }
        let dec = JSONDecoder(); dec.keyDecodingStrategy = .convertFromSnakeCase
        return try dec.decode(CloudinaryResult.self, from: respData).secureUrl
    }
}

/// Reusable image field: thumbnail + "Upload/Change" (PhotosPicker → Cloudinary)
/// + Remove, with a paste-a-URL fallback. Binds the resulting hosted URL string.
struct ImageUploadField: View {
    let label: String
    let folder: String   // events | announcements | disciplers | moments
    @Binding var url: String
    var allowPaste: Bool = true

    @State private var item: PhotosPickerItem?
    @State private var uploading = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !label.isEmpty { Text(label).font(.inter(12, .semibold)).foregroundStyle(Nuru.ink600) }
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Nuru.inputBg).frame(width: 56, height: 56)
                    if !url.isEmpty, let u = URL(string: url) {
                        AsyncImage(url: u) { $0.resizable().scaledToFill() } placeholder: { ProgressView() }
                            .frame(width: 56, height: 56).clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                    } else {
                        Image(systemName: "photo").foregroundStyle(Nuru.ink400)
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    PhotosPicker(selection: $item, matching: .images) {
                        Label(url.isEmpty ? "Upload image" : "Change image", systemImage: "arrow.up.circle.fill")
                            .font(.inter(13, .semibold)).foregroundStyle(Nuru.goldLo)
                    }
                    if !url.isEmpty {
                        Button("Remove") { url = "" }.font(.nMicro).tint(Nuru.danger)
                    }
                }
                Spacer()
                if uploading { ProgressView() }
            }
            if allowPaste {
                TextField("…or paste an image URL", text: $url)
                    .font(.nCaption).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            if let error { Text(error).font(.nMicro).foregroundStyle(Nuru.danger) }
        }
        .onChange(of: item) { _, newItem in
            guard let newItem else { return }
            Task {
                uploading = true; error = nil
                do {
                    if let data = try await newItem.loadTransferable(type: Data.self) {
                        url = try await ImageUpload.upload(data, folder: folder)
                    }
                } catch { self.error = "Upload failed. Try again or paste a URL." }
                uploading = false
            }
        }
    }
}
