// Scripture passage fetch + HTML stripping (§3.3). Pure logic; provider injected.
import { describe, it, expect } from "vitest";
import {
  ScriptureService,
  buildScriptureProvider,
  stripHtml,
  type ScriptureProvider,
} from "../src/modules/curriculum/scripture.js";
import { testEnv } from "./helpers/app.js";

describe("scripture (§3.3)", () => {
  it("strips HTML to plain text", () => {
    expect(stripHtml("<p>For <b>God</b> so&nbsp;loved</p>")).toBe("For God so loved");
  });

  it("returns a passage via the provider, defaulting the language", async () => {
    const provider: ScriptureProvider = {
      fetch: (i) => Promise.resolve({ reference: i.ref, version: i.version, language: i.language, text: "verse" }),
    };
    const svc = new ScriptureService(provider, "sw;en");
    const p = await svc.passage("John 3:16");
    expect(p).toMatchObject({ reference: "John 3:16", language: "sw", text: "verse" });
  });

  it("caches by ref+version+language — a second lookup skips the provider", async () => {
    const store = new Map<string, string>();
    const redis = {
      get: (k: string) => Promise.resolve(store.get(k) ?? null),
      set: (k: string, v: string) => {
        store.set(k, v);
        return Promise.resolve("OK");
      },
    } as unknown as import("ioredis").Redis;
    let calls = 0;
    const provider: ScriptureProvider = {
      fetch: (i) => {
        calls += 1;
        return Promise.resolve({ reference: i.ref, version: i.version, language: i.language, text: "verse" });
      },
    };
    const svc = new ScriptureService(provider, "en", redis);
    const a = await svc.passage("John 3:16", "NIV");
    const b = await svc.passage("John 3:16", "NIV");
    expect(calls).toBe(1); // second served from cache
    expect(b).toEqual(a);
    await svc.passage("John 3:16", "KJV"); // different version → fresh fetch
    expect(calls).toBe(2);
  });

  it("requires a ref", async () => {
    const svc = new ScriptureService({ fetch: () => Promise.reject(new Error("x")) }, "en");
    await expect(svc.passage("")).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("fails closed (503) when YouVersion is not configured", async () => {
    const provider = buildScriptureProvider(testEnv()); // no YOUVERSION_APP_KEY
    await expect(provider.fetch({ ref: "John 1:1", version: "", language: "en" })).rejects.toMatchObject({
      code: "UPSTREAM_UNAVAILABLE",
    });
  });

  it("fetches + strips via the YouVersion provider (injected fetch)", async () => {
    const env = { ...testEnv(), YOUVERSION_APP_KEY: "yv-key" };
    const fakeFetch = (async () =>
      ({ ok: true, status: 200, json: async () => ({ passages: [{ content: "<p>In the <i>beginning</i></p>" }] }) }) as unknown as Response) as typeof fetch;
    const provider = buildScriptureProvider(env, fakeFetch);
    const p = await provider.fetch({ ref: "John 1:1", version: "NIV", language: "en" });
    expect(p.text).toBe("In the beginning");
  });
});
