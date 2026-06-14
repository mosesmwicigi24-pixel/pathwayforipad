// Encryption-at-rest for the local store (spec §5.7). A KeyValueStore decorator:
// values are encrypted with an injected Cipher before they hit the underlying KV
// (AsyncStorage), and decrypted on read. Keys are left clear (they're opaque
// namespaced ids like np:cache:saved_verses:<uuid>, not secrets) so getAllKeys /
// prefix listing still work. The Cipher is a port so this is unit-testable with a
// fake; the device cipher (AES-256 keyed from the keychain) plugs in on startup.
import type { KeyValueStore } from "./keyValueStore.js";

export interface Cipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
}

export class EncryptedKeyValueStore implements KeyValueStore {
  constructor(
    private readonly base: KeyValueStore,
    private readonly cipher: Cipher,
  ) {}

  async getItem(key: string): Promise<string | null> {
    const raw = await this.base.getItem(key);
    if (raw === null) return null;
    try {
      return await this.cipher.decrypt(raw);
    } catch {
      // Unreadable (corrupt / key rotated) → treat as absent rather than crash.
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await this.base.setItem(key, await this.cipher.encrypt(value));
  }

  removeItem(key: string): Promise<void> {
    return this.base.removeItem(key);
  }

  getAllKeys(): Promise<readonly string[]> {
    return this.base.getAllKeys();
  }
}
