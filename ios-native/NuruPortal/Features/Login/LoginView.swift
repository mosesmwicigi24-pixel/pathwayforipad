// Sign-in screen — email + password, with the 2FA code step when the account
// returns an mfa challenge (mirrors authSlice login/completeMfa).
import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore

    @State private var email = ""
    @State private var password = ""
    @State private var mfaToken: String?
    @State private var code = ""
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        ZStack {
            Nuru.navy.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 60)
                    card
                    Spacer(minLength: 40)
                }
                .frame(maxWidth: .infinity)
                .padding()
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                BrandMark(size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Nuru Pathway").font(.nuruDisplay(22)).foregroundStyle(Nuru.navy)
                    Text("Admin Portal").font(.footnote).foregroundStyle(Nuru.muted)
                }
            }

            if mfaToken == nil { credentialsFields } else { mfaField }

            if let error {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(Nuru.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Button(action: submit) {
                HStack {
                    if loading { ProgressView().tint(.white) }
                    Text(mfaToken == nil ? "Sign in" : "Verify code")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
                .background(Nuru.gold)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .disabled(loading || !canSubmit)
            .opacity(canSubmit ? 1 : 0.6)

            if mfaToken != nil {
                Button("Use a different account") { mfaToken = nil; code = ""; error = nil }
                    .font(.footnote).foregroundStyle(Nuru.muted)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(28)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .frame(maxWidth: 420)
        .shadow(color: .black.opacity(0.25), radius: 30, y: 14)
    }

    private var credentialsFields: some View {
        VStack(spacing: 14) {
            Field(title: "Email") {
                TextField("you@nuruplace.org", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }
            Field(title: "Password") {
                SecureField("••••••••", text: $password)
                    .textContentType(.password)
            }
        }
    }

    private var mfaField: some View {
        Field(title: "Verification code") {
            TextField("123456", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
        }
    }

    private var canSubmit: Bool {
        mfaToken == nil ? (!email.isEmpty && !password.isEmpty) : code.count >= 6
    }

    private func submit() {
        loading = true; error = nil
        Task {
            do {
                if let token = mfaToken {
                    let session = try await PortalAPI.completeMfa(mfaToken: token, code: code)
                    await auth.onAuthenticated(session)
                } else {
                    let result = try await PortalAPI.login(email: email, password: password)
                    if let session = result.session {
                        await auth.onAuthenticated(session)
                    } else if let mfa = result.mfa {
                        mfaToken = mfa.mfaToken
                    }
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
            loading = false
        }
    }
}

/// Labeled input wrapper matching the web portal's field styling.
private struct Field<Content: View>: View {
    let title: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).fontWeight(.semibold).foregroundStyle(Nuru.muted)
            content
                .padding(.horizontal, 14).padding(.vertical, 12)
                .background(Nuru.inputBg)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Nuru.border, lineWidth: 1))
        }
    }
}
