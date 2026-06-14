// Minimal key/value port — exactly the slice of AsyncStorage's API the persistent
// LocalStore needs. Keeping it as a port means AsyncStorageLocalStore is unit-
// testable with an in-memory fake (no native module in the vitest runner); the
// real @react-native-async-storage/async-storage is injected on device.
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** Keys currently stored (used to list a cache domain / the queue). */
  getAllKeys(): Promise<readonly string[]>;
}

/** In-memory KeyValueStore for tests + first-run dev. */
export class MemoryKeyValueStore implements KeyValueStore {
  private map = new Map<string, string>();
  getItem(key: string): Promise<string | null> {
    return Promise.resolve(this.map.has(key) ? (this.map.get(key) as string) : null);
  }
  setItem(key: string, value: string): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }
  removeItem(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }
  getAllKeys(): Promise<readonly string[]> {
    return Promise.resolve([...this.map.keys()]);
  }
}
