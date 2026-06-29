// Sign-in — a navy gradient stage with a floating brand card. Email + password,
// plus the 2FA code step when the account returns an mfa challenge.
import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var auth: AuthStore

    @State private var email = ""
    @State private var password = ""
    @State private var mfaToken: String?
    @State private var code = ""
    @State private var loading = false
    @State private var error: String?
    @FocusState private var focus: Field?
    private enum Field { case email, password, code }

    var body: some View {
        ZStack {
            Nuru.navyGradient.ignoresSafeArea()
            // ambient gold glow
            Circle().fill(Nuru.gold.opacity(0.22)).frame(width: 360, height: 360)
                .blur(radius: 120).offset(x: -120, y: -220)
            Circle().fill(Nuru.gold.opacity(0.12)).frame(width: 320, height: 320)
                .blur(radius: 120).offset(x: 160, y: 280)

            ScrollView {
                VStack(spacing: 22) {
                    Spacer(minLength: 50)
                    header
                    card
                    Text("Server-authoritative · offline-first · §1")
                        .font(.nMicro).foregroundStyle(.white.opacity(0.35))
                    Spacer(minLength: 30)
                }
                .frame(maxWidth: .infinity)
                .padding(24)
            }
        }
    }

    private var header: some View {
        VStack(spacing: 14) {
            BrandMark(size: 64)
            VStack(spacing: 3) {
                Text("Nuru Pathway").font(.nuruDisplay(30)).foregroundStyle(.white)
                Text("Discipleship Admin Portal").font(.nBody).foregroundStyle(.white.opacity(0.6))
            }
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text(mfaToken == nil ? "Welcome back" : "Two-factor verification")
                .font(.nuruDisplay(22)).foregroundStyle(Nuru.navy)

            if mfaToken == nil { credentialsFields } else { mfaField }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.nCaption).foregroundStyle(Nuru.danger)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.danger.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            Button(action: submit) {
                HStack(spacing: 8) {
                    if loading { ProgressView().tint(.white) }
                    Text(mfaToken == nil ? "Sign in" : "Verify")
                        .fontWeight(.semibold)
                    if !loading { Image(systemName: "arrow.right") }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Nuru.goldGradient)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .nuruShadow(0.6)
            }
            .disabled(loading || !canSubmit)
            .opacity(canSubmit ? 1 : 0.55)

            if mfaToken != nil {
                Button("Use a different account") { mfaToken = nil; code = ""; error = nil }
                    .font(.nCaption).foregroundStyle(Nuru.muted)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(28)
        .background(Nuru.surface)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .frame(maxWidth: 430)
        .shadow(color: .black.opacity(0.35), radius: 40, y: 20)
    }

    private var credentialsFields: some View {
        VStack(spacing: 14) {
            LoginField(title: "Email", icon: "envelope") {
                TextField("you@nuruplace.org", text: $email)
                    .textContentType(.username).keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($focus, equals: .email).submitLabel(.next)
                    .onSubmit { focus = .password }
            }
            LoginField(title: "Password", icon: "lock") {
                SecureField("••••••••", text: $password)
                    .textContentType(.password)
                    .focused($focus, equals: .password).submitLabel(.go)
                    .onSubmit { if canSubmit { submit() } }
            }
        }
    }

    private var mfaField: some View {
        LoginField(title: "Verification code", icon: "key") {
            TextField("123456", text: $code)
                .keyboardType(.numberPad).textContentType(.oneTimeCode)
                .focused($focus, equals: .code)
        }
    }

    private var canSubmit: Bool {
        mfaToken == nil ? (!email.isEmpty && !password.isEmpty) : code.count >= 6
    }

    private func submit() {
        loading = true; error = nil; focus = nil
        Task {
            do {
                if let token = mfaToken {
                    let s = try await PortalAPI.completeMfa(mfaToken: token, code: code)
                    await auth.onAuthenticated(s)
                } else {
                    let r = try await PortalAPI.login(email: email, password: password)
                    if let s = r.session { await auth.onAuthenticated(s) }
                    else if let mfa = r.mfa { withAnimation { mfaToken = mfa.mfaToken } }
                }
            } catch {
                self.error = (error as? APIError)?.errorDescription ?? error.localizedDescription
            }
            loading = false
        }
    }
}

private struct LoginField<Content: View>: View {
    let title: String
    let icon: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title).font(.inter(13, .semibold)).foregroundStyle(Nuru.muted)
            HStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(Nuru.gold).frame(width: 18)
                content
            }
            .padding(.horizontal, 14).padding(.vertical, 13)
            .background(Nuru.inputBg)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}
