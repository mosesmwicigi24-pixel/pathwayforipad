// Transactional email sender (§5.3). Behind an interface so the auth logic stays
// testable (FakeEmailProvider in tests) and the real SMTP sender drops in for
// production. Without SMTP_HOST configured we use a logging no-op so dev flows
// complete without delivery.
import nodemailer, { type Transporter } from "nodemailer";
import type { Logger } from "pino";
import type { Env } from "../../config/env.js";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

class SmtpEmailProvider implements EmailProvider {
  private readonly tx: Transporter;
  constructor(
    private readonly from: string,
    opts: { host: string; port: number; secure: boolean; user?: string; pass?: string },
    private readonly log?: Logger,
  ) {
    this.tx = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure, // 465 = implicit TLS; 587 = STARTTLS (secure:false, upgraded)
      ...(opts.user ? { auth: { user: opts.user, pass: opts.pass ?? "" } } : {}),
    });
  }
  async send(msg: EmailMessage): Promise<void> {
    await this.tx.sendMail({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      ...(msg.html ? { html: msg.html } : {}),
    });
    this.log?.info({ to: msg.to, subject: msg.subject }, "email sent");
  }
}

class LoggingEmailProvider implements EmailProvider {
  constructor(private readonly log?: Logger) {}
  send(msg: EmailMessage): Promise<void> {
    this.log?.info({ to: msg.to, subject: msg.subject }, "email (logged, no SMTP configured)");
    return Promise.resolve();
  }
}

export function buildEmailProvider(env: Env, log?: Logger): EmailProvider {
  if (env.SMTP_HOST) {
    return new SmtpEmailProvider(
      env.EMAIL_FROM,
      {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        ...(env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : {}),
      },
      log,
    );
  }
  return new LoggingEmailProvider(log);
}
