// Token storage (spec §5.7). Tokens live in the OS secure enclave (Keychain /
// Keystore), never in plain SQLite/async-storage. Behind an interface so the sync
// engine + API client are testable with an in-memory vault.
export interface TokenVault {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  setTokens(access: string, refresh: string): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory vault for tests and first-run dev. Never used on a real device. */
export class InMemoryTokenVault implements TokenVault {
  private access: string | null = null;
  private refresh: string | null = null;
  getAccess(): Promise<string | null> {
    return Promise.resolve(this.access);
  }
  getRefresh(): Promise<string | null> {
    return Promise.resolve(this.refresh);
  }
  setTokens(access: string, refresh: string): Promise<void> {
    this.access = access;
    this.refresh = refresh;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.access = null;
    this.refresh = null;
    return Promise.resolve();
  }
}
