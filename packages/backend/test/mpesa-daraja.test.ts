// M-Pesa Daraja adapter (real STK-push provider). Only the pure callback-parsing
// path is unit-tested here — initiate() makes live Safaricom calls and is never
// exercised in CI (no network/secrets, CLAUDE.md). Settlement still rides the
// existing webhook → processed_webhooks → ledger path (covered by financial.test).
import { describe, it, expect } from "vitest";
import { DarajaMpesaProvider } from "../src/modules/financial/providers.js";

const provider = new DarajaMpesaProvider({
  consumerKey: "k",
  consumerSecret: "s",
  passkey: "p",
  shortcode: "4043755",
  env: "sandbox",
  txType: "CustomerPayBillOnline",
  callbackUrl: "https://example.org/v1/webhooks/mobilemoney/mpesa",
});

const callback = (resultCode: number, checkoutId = "ws_CO_123") =>
  JSON.stringify({
    Body: {
      stkCallback: {
        MerchantRequestID: "m-1",
        CheckoutRequestID: checkoutId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? "The service request is processed successfully." : "Cancelled",
      },
    },
  });

describe("DarajaMpesaProvider.verifyCallback", () => {
  it("maps ResultCode 0 → succeeded, keyed by CheckoutRequestID", () => {
    const cb = provider.verifyCallback(callback(0, "ws_CO_ABC"));
    expect(cb).toEqual({ event_id: "ws_CO_ABC", ref: "ws_CO_ABC", status: "succeeded" });
  });

  it("maps a non-zero ResultCode → failed", () => {
    expect(provider.verifyCallback(callback(1032)).status).toBe("failed");
  });

  it("accepts a Buffer body (raw webhook)", () => {
    const cb = provider.verifyCallback(Buffer.from(callback(0, "ws_CO_BUF")));
    expect(cb.ref).toBe("ws_CO_BUF");
  });

  it("rejects a malformed callback", () => {
    expect(() => provider.verifyCallback("{ not json")).toThrow();
    expect(() => provider.verifyCallback(JSON.stringify({ Body: {} }))).toThrow();
  });
});
