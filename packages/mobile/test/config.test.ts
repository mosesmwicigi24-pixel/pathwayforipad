import { describe, it, expect, afterEach } from "vitest";
import { apiBaseUrl } from "../src/config";

describe("apiBaseUrl", () => {
  afterEach(() => {
    delete process.env.API_URL;
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.NURU_API_URL;
  });

  it("defaults to localhost for iOS / simulator", () => {
    expect(apiBaseUrl("ios")).toBe("http://localhost:8080/v1");
    expect(apiBaseUrl()).toBe("http://localhost:8080/v1");
  });

  it("uses the 10.0.2.2 host alias for the Android emulator", () => {
    expect(apiBaseUrl("android")).toBe("http://10.0.2.2:8080/v1");
  });

  it("honors an env override (LAN IP for a physical device) and trims trailing slash", () => {
    process.env.API_URL = "http://192.168.1.20:8080/v1/";
    expect(apiBaseUrl("android")).toBe("http://192.168.1.20:8080/v1");
  });
});
