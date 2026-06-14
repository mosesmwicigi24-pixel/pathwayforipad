import { describe, it, expect } from "vitest";
import { MemoryKeyValueStore } from "../src/db/keyValueStore";
import { EncryptedKeyValueStore, type Cipher } from "../src/db/encryptedKeyValueStore";
import { AsyncStorageLocalStore } from "../src/db/asyncStorageLocalStore";

// A reversible fake cipher: enough to prove the decorator round-trips and that
// what lands in the underlying store is NOT the plaintext.
const reverse: Cipher = {
  encrypt: (p) => Promise.resolve(`enc(${[...p].reverse().join("")})`),
  decrypt: (c) => {
    // A real cipher rejects ciphertext it didn't produce; model that so the
    // decorator's "undecryptable → null" path is genuinely exercised.
    if (!c.startsWith("enc(") || !c.endsWith(")")) {
      return Promise.reject(new Error("bad ciphertext"));
    }
    return Promise.resolve([...c.slice(4, -1)].reverse().join(""));
  },
};

describe("EncryptedKeyValueStore", () => {
  it("round-trips values while storing only ciphertext", async () => {
    const base = new MemoryKeyValueStore();
    const enc = new EncryptedKeyValueStore(base, reverse);

    await enc.setItem("np:cache:saved_verses:v1", "John 3:16");
    // What's actually persisted is encrypted, never the plaintext.
    const onDisk = await base.getItem("np:cache:saved_verses:v1");
    expect(onDisk).not.toBe("John 3:16");
    expect(onDisk).not.toContain("John");
    // But reads decrypt transparently.
    expect(await enc.getItem("np:cache:saved_verses:v1")).toBe("John 3:16");
  });

  it("leaves keys clear so prefix listing still works", async () => {
    const enc = new EncryptedKeyValueStore(new MemoryKeyValueStore(), reverse);
    await enc.setItem("np:queue", "[]");
    await enc.setItem("np:cursor:modules", "7");
    expect((await enc.getAllKeys()).sort()).toEqual(["np:cursor:modules", "np:queue"]);
  });

  it("returns null for missing and for undecryptable values", async () => {
    const base = new MemoryKeyValueStore();
    const enc = new EncryptedKeyValueStore(base, reverse);
    expect(await enc.getItem("absent")).toBeNull();
    // A value written by something other than this cipher (e.g. pre-encryption
    // data or a rotated key) must not crash the app — treat as absent.
    await base.setItem("legacy", "not-our-format");
    expect(await enc.getItem("legacy")).toBeNull();
  });

  it("drives the real LocalStore unchanged when layered underneath it", async () => {
    // The whole point: AsyncStorageLocalStore neither knows nor cares that its KV
    // is encrypted. Same behavior as the plaintext test, now over a cipher.
    const kv = new EncryptedKeyValueStore(new MemoryKeyValueStore(), reverse);
    const s = new AsyncStorageLocalStore(kv);
    await s.setCursor("modules", 42);
    await s.cacheUpsert("saved_verses", "v1", { saved_verse_id: "v1", reference: "John 3:16" });
    expect(await s.getCursor("modules")).toBe(42);
    expect((await s.cacheList("saved_verses")).map((r) => r.saved_verse_id)).toEqual(["v1"]);
  });
});
