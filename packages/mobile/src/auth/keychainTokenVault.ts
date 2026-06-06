// Keychain-backed TokenVault (spec §5.7) — the real-device implementation. Kept in
// its own file so tests/Node never import the native module; they use
// InMemoryTokenVault instead.
import * as Keychain from "react-native-keychain";
import type { TokenVault } from "./tokenVault";

const SERVICE = "nuru.place.tokens";

export class KeychainTokenVault implements TokenVault {
  private async read(): Promise<{ access?: string; refresh?: string }> {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    if (!creds) return {};
    try {
      return JSON.parse(creds.password) as { access?: string; refresh?: string };
    } catch {
      return {};
    }
  }

  async getAccess(): Promise<string | null> {
    return (await this.read()).access ?? null;
  }
  async getRefresh(): Promise<string | null> {
    return (await this.read()).refresh ?? null;
  }
  async setTokens(access: string, refresh: string): Promise<void> {
    await Keychain.setGenericPassword("tokens", JSON.stringify({ access, refresh }), { service: SERVICE });
  }
  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
  }
}
