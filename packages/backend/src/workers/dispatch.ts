// Notification dispatch provider (spec §1.5). The actual APNs/FCM/email send is
// behind this interface so the scheduling/worker logic is testable and the real
// provider (PUSH_PROVIDER_KEY) drops in for production. Without a key configured
// we use a logging provider that succeeds — dev flows complete without delivery.
import type { Logger } from "pino";
import type { Env } from "../config/env.js";

export interface DispatchMessage {
  channel: "push" | "email";
  to: string; // device token or email address
  template: string;
  payload: Record<string, unknown>;
}

export interface DispatchProvider {
  send(msg: DispatchMessage): Promise<void>;
}

class LoggingDispatchProvider implements DispatchProvider {
  constructor(private readonly log?: Logger) {}
  send(msg: DispatchMessage): Promise<void> {
    this.log?.info({ channel: msg.channel, template: msg.template, to: msg.to }, "notification (logged, no provider)");
    return Promise.resolve();
  }
}

export function buildDispatchProvider(env: Env, log?: Logger): DispatchProvider {
  // Real provider keyed by PUSH_PROVIDER_KEY wires APNs/FCM/SES here.
  if (env.PUSH_PROVIDER_KEY) {
    return new LoggingDispatchProvider(log); // placeholder until the SDK lands
  }
  return new LoggingDispatchProvider(log);
}
