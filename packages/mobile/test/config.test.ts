import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { apiBaseUrl } from "../src/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = globalThis as any;

describe("apiBaseUrl", () => {
  beforeEach(() => {
    g.__DEV__ = true; // default these unit tests to the dev (Metro) path
  });
  afterEach(() => {
    delete process.env.API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.NURU_API_URL;
    delete g.__DEV__;
  });

  it("defaults to localhost for iOS / simulator in dev", () => {
    expect(apiBaseUrl("ios")).toBe("http://localhost:8080/v1");
    expect(apiBaseUrl()).toBe("http://localhost:8080/v1");
  });

  it("uses the 10.0.2.2 host alias for the Android emulator in dev", () => {
    expect(apiBaseUrl("android")).toBe("http://10.0.2.2:8080/v1");
  });

  it("uses the production URL for release builds (__DEV__ false)", () => {
    g.__DEV__ = false;
    expect(apiBaseUrl("ios")).toBe("https://pathway.nuruplace.org/v1");
    expect(apiBaseUrl("android")).toBe("https://pathway.nuruplace.org/v1");
  });

  it("honors an env override (LAN IP for a physical device) and trims trailing slash", () => {
    process.env.API_URL = "http://192.168.1.20:8080/v1/";
    expect(apiBaseUrl("android")).toBe("http://192.168.1.20:8080/v1");
  });
});
