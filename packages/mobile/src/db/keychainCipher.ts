// Real-device Cipher (spec §5.7) — AES-256-CBC over react-native-aes-crypto, with
// the data key sealed in the OS keychain (Secure Enclave / Keystore-backed, same
// place as the auth tokens). Kept in its own file so tests/Node never import the
// native modules; the vitest suite exercises EncryptedKeyValueStore with a fake
// Cipher instead. Wired into the local store on startup in App.tsx.
import * as Keychain from "react-native-keychain";
import Aes from "react-native-aes-crypto";
import type { Cipher } from "./encryptedKeyValueStore";

const KEY_SERVICE = "nuru.place.localstore.key";
const ALGORITHM = "aes-256-cbc";

// One persistent 256-bit data key per install. Generated on first run and stored
// in the keychain; every value is encrypted under it with a fresh random IV.
async function loadOrCreateKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: KEY_SERVICE });
  if (existing) return existing.password;
  const key = await Aes.randomKey(32); // 32 bytes → AES-256, hex-encoded
  await Keychain.setGenericPassword("localstore", key, { service: KEY_SERVICE });
  return key;
}

/**
 * Build the device Cipher. Resolves once the data key is loaded from (or written
 * to) the keychain, so callers can hand the result to EncryptedKeyValueStore.
 */
export async function createKeychainCipher(): Promise<Cipher> {
  const key = await loadOrCreateKey();
  return {
    async encrypt(plaintext: string): Promise<string> {
      const iv = await Aes.randomKey(16); // fresh 128-bit IV per value
      const ciphertext = await Aes.encrypt(plaintext, key, iv, ALGORITHM);
      return `${iv}:${ciphertext}`; // IV is not secret; store it alongside
    },
    async decrypt(stored: string): Promise<string> {
      const sep = stored.indexOf(":");
      if (sep < 0) throw new Error("malformed ciphertext");
      const iv = stored.slice(0, sep);
      const ciphertext = stored.slice(sep + 1);
      return Aes.decrypt(ciphertext, key, iv, ALGORITHM);
    },
  };
}
