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
    @State private var forgotOpen = false
    @State private var bioBusy = false
    @FocusState private var focus: Field?
    private enum Field { case email, password, code }

    /// Biometric fast path: the lock preference is ON and a session survives on
    /// this device (e.g. the admin chose "Use password instead" earlier) — offer
    /// Face ID / Touch ID to restore it without typing anything.
    private var canFastPath: Bool {
        mfaToken == nil && auth.biometricLockEnabled && auth.hasPersistedSession && BiometricAuth.isAvailable
    }

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

            // Gentle note when a biometric unlock revealed a dead session — the
            // device can unlock the app, but only a password can mint a new one.
            if let note = auth.sessionNote, mfaToken == nil {
                Label(note, systemImage: "clock.arrow.circlepath")
                    .font(.nCaption).foregroundStyle(Nuru.goldChipText)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.goldChipBg)
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
            }

            if canFastPath { biometricFastPath }

            if mfaToken == nil { credentialsFields } else { mfaField }

            if let error {
                Label(error, systemImage: "exclamationmark.circle.fill")
                    .font(.nCaption).foregroundStyle(Nuru.danger)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Nuru.danger.opacity(0.08))
                    .clipShape(RoundedRectangle(cornerRadius: Nuru.R.chip, style: .continuous))
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
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
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
        .clipShape(RoundedRectangle(cornerRadius: Nuru.R.xl, style: .continuous))
        .frame(maxWidth: 430)
        .shadow(color: .black.opacity(0.35), radius: 40, y: 20)
    }

    /// "Sign in with Face ID" — restores the persisted session behind one system
    /// authentication, above the password form. The password stays the fallback.
    private var biometricFastPath: some View {
        VStack(spacing: 14) {
            Button {
                guard !bioBusy else { return }
                bioBusy = true; error = nil
                Task {
                    _ = await auth.restoreViaBiometrics()
                    bioBusy = false
                }
            } label: {
                HStack(spacing: 9) {
                    if bioBusy { ProgressView().tint(.white) }
                    else { Image(systemName: BiometricAuth.icon).font(.system(size: 16, weight: .semibold)) }
                    Text(BiometricAuth.label.map { "Sign in with \($0)" } ?? "Unlock")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity).padding(.vertical, 15)
                .background(Nuru.navyGradient)
                .foregroundStyle(.white)
                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                .nuruShadow(0.6)
            }
            .disabled(bioBusy)

            HStack(spacing: 10) {
                Rectangle().fill(Nuru.border).frame(height: 1)
                Text("or use your password").font(.nMicro).foregroundStyle(Nuru.muted)
                    .fixedSize()
                Rectangle().fill(Nuru.border).frame(height: 1)
            }
        }
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
            // Email-a-reset-link flow (POST /auth/password/forgot — never enumerates accounts).
            Button("Forgot password?") { forgotOpen = true }
                .font(.inter(12.5, .semibold)).foregroundStyle(Nuru.gold)
                .frame(maxWidth: .infinity, alignment: .trailing)
                .padding(.top, -4)
                .sheet(isPresented: $forgotOpen) { ForgotPasswordSheet(email: email) }
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

/// "Forgot password?" — email field → POST /auth/password/forgot. Fire-and-forget:
/// the server always answers "sent" (no account enumeration, web client.ts
/// forgotPassword parity), so we show the same confirmation copy regardless.
private struct ForgotPasswordSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var sent = false
    @State private var busy = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if sent {
                        VStack(alignment: .leading, spacing: 12) {
                            Image(systemName: "envelope.badge.fill")
                                .font(.system(size: 28)).foregroundStyle(Nuru.gold)
                            Text("Check your inbox").font(.nuruDisplay(22)).foregroundStyle(Nuru.navy)
                            Text("If that email exists, a reset link is on its way.")
                                .font(.nBody).foregroundStyle(Nuru.muted)
                                .fixedSize(horizontal: false, vertical: true)
                            Button("Done") { dismiss() }
                                .font(.inter(14, .bold)).foregroundStyle(.white)
                                .frame(maxWidth: .infinity).padding(.vertical, 13)
                                .background(Nuru.goldGradient)
                                .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        }
                    } else {
                        Text("Reset your password").font(.nuruDisplay(22)).foregroundStyle(Nuru.navy)
                        Text("Enter the email on your account and we'll send a reset link.")
                            .font(.nBody).foregroundStyle(Nuru.muted)
                            .fixedSize(horizontal: false, vertical: true)
                        LoginField(title: "Email", icon: "envelope") {
                            TextField("you@nuruplace.org", text: $email)
                                .textContentType(.username).keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never).autocorrectionDisabled()
                                .focused($focused).submitLabel(.send)
                                .onSubmit { if canSend { send() } }
                        }
                        Button(action: send) {
                            HStack(spacing: 8) {
                                if busy { ProgressView().tint(.white) }
                                Text("Send reset link").fontWeight(.semibold)
                                if !busy { Image(systemName: "paperplane.fill") }
                            }
                            .frame(maxWidth: .infinity).padding(.vertical, 13)
                            .background(Nuru.goldGradient)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.control, style: .continuous))
                        }
                        .disabled(busy || !canSend)
                        .opacity(canSend ? 1 : 0.55)
                    }
                }
                .padding(28)
                .frame(maxWidth: 480, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(Nuru.surface)
            .navigationTitle("Forgot password").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }

    private var canSend: Bool { email.contains("@") && !email.trimmingCharacters(in: .whitespaces).isEmpty }

    private func send() {
        struct Body: Encodable { let email: String }
        struct Ack: Decodable {}   // { sent: true } — always
        busy = true
        let addr = email.trimmingCharacters(in: .whitespaces)
        Task {
            // Fire-and-forget: same confirmation whether or not the account exists.
            _ = try? await APIClient.shared.post("/auth/password/forgot", body: Body(email: addr), as: Ack.self)
            busy = false
            withAnimation { sent = true }
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
            .clipShape(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Nuru.R.tile, style: .continuous).stroke(Nuru.border, lineWidth: 1))
        }
    }
}
