// Message providers for announcement channels that don't ride the in-house
// notifications infra. Abstracted behind an interface (CLAUDE.md: external
// services are faked in tests — no network, no secrets). A real deployment
// binds Twilio/Africa's Talking (SMS) and the WhatsApp Business API here by
// env-named credentials; the contract is identical.

export interface OutboundMessage {
  to: string; // E.164 phone number
  title: string;
  body: string;
}

export interface MessageProvider {
  readonly channel: "sms" | "whatsapp";
  /** Returns the provider's message reference; throws on hard failure. */
  send(msg: OutboundMessage): Promise<{ ref: string }>;
}

/** Deterministic in-memory stub — records sends so tests can assert fan-out. */
export class FakeMessageProvider implements MessageProvider {
  readonly sent: OutboundMessage[] = [];
  constructor(readonly channel: "sms" | "whatsapp") {}
  async send(msg: OutboundMessage): Promise<{ ref: string }> {
    this.sent.push(msg);
    return { ref: `${this.channel}-fake-${this.sent.length}` };
  }
}
