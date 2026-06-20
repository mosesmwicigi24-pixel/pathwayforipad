// A tiny server-state cache + hooks (a focused stand-in for React Query). Kept
// dependency-free on purpose: adding a new native-adjacent package to a running
// Metro/monorepo build is riskier than ~80 lines we fully control. It gives the
// screens loading/error/refresh states, request de-duplication, stale-time, and
// targeted invalidation so writes can refresh exactly the reads they affect.
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type Status = "idle" | "loading" | "success" | "error";

interface Entry<T = unknown> {
  status: Status;
  data?: T;
  error?: unknown;
  fetchedAt?: number;
}

const cache = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function emit(key: string): void {
  listeners.get(key)?.forEach((l) => l());
}

// --- Offline persistence (§1.7 offline-first) -----------------------------
// Successful reads are mirrored to AsyncStorage so the last-known data survives
// an app restart and shows instantly — even with no network. On launch we hydrate
// the cache from disk (marked stale), so a mounted screen renders cached data
// immediately and refetches in the background: when the DB changed, the fresh
// result replaces it; when it hasn't, the cached copy simply stays.
const PERSIST_PREFIX = "rq:";
let persistEnabled = false;

function persist(key: string, entry: Entry): void {
  if (!persistEnabled || entry.status !== "success" || entry.data === undefined) return;
  void AsyncStorage.setItem(PERSIST_PREFIX + key, JSON.stringify({ d: entry.data, t: entry.fetchedAt ?? 0 })).catch(() => undefined);
}

/** Load persisted reads into the cache (call once at app start). Each entry is
 *  hydrated stale so a mounted useQuery shows it immediately and refreshes in the
 *  background. Never throws — if AsyncStorage is unavailable the app just runs
 *  in-memory only. */
export async function hydrateQueryCache(): Promise<void> {
  persistEnabled = true;
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PERSIST_PREFIX));
    if (keys.length === 0) return;
    const pairs = await Promise.all(keys.map(async (k) => [k, await AsyncStorage.getItem(k)] as const));
    for (const [k, v] of pairs) {
      if (!v) continue;
      const key = k.slice(PERSIST_PREFIX.length);
      if (cache.has(key)) continue; // a live fetch already populated this — don't clobber
      try {
        const parsed = JSON.parse(v) as { d: unknown; t?: number };
        cache.set(key, { status: "success", data: parsed.d, fetchedAt: parsed.t ?? 0 });
        emit(key);
      } catch {
        /* skip a corrupt entry */
      }
    }
  } catch {
    /* AsyncStorage unavailable — stay in-memory only */
  }
}

function subscribe(key: string, fn: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    set?.delete(fn);
  };
}

async function runFetch<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const prev = cache.get(key);
  // Build entries without ever assigning `undefined` explicitly (exactOptionalPropertyTypes).
  const loading: Entry<T> = { status: "loading" };
  if (prev?.data !== undefined) loading.data = prev.data as T;
  if (prev?.fetchedAt !== undefined) loading.fetchedAt = prev.fetchedAt;
  cache.set(key, loading);
  emit(key);
  try {
    const data = await fetcher();
    const ok: Entry<T> = { status: "success", data, fetchedAt: Date.now() };
    cache.set(key, ok);
    persist(key, ok);
  } catch (error) {
    const cur = cache.get(key);
    const failed: Entry<T> = { status: "error", error };
    if (cur?.data !== undefined) failed.data = cur.data as T;
    if (cur?.fetchedAt !== undefined) failed.fetchedAt = cur.fetchedAt;
    cache.set(key, failed);
  }
  emit(key);
}

/** Drop every cached key whose name starts with `prefix`, forcing a refetch. */
export function invalidateQueries(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
      emit(key);
    }
  }
}

/** Mark matching queries stale WITHOUT dropping their cached data, so a mounted
 *  subscriber refetches in the background while still showing the last data (no
 *  blank/spinner flash). Prefer this over invalidateQueries() for refreshing a
 *  list the user may navigate back to. */
export function refreshQueries(prefix: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) {
      const e = cache.get(key);
      if (e && e.data !== undefined) {
        cache.set(key, { ...e, fetchedAt: 0 }); // stale → useQuery effect refetches, keeps data
        emit(key);
      } else {
        cache.delete(key);
        emit(key);
      }
    }
  }
}

/** Optimistically set a query's data (e.g. an offline write the screen should
 *  show immediately). Marks it fresh so the optimistic value isn't refetched away
 *  until the next explicit refresh/invalidate. */
export function setQueryData<T>(key: string, updater: (prev: T | undefined) => T): void {
  const prev = cache.get(key) as Entry<T> | undefined;
  const next: Entry<T> = { status: "success", data: updater(prev?.data), fetchedAt: Date.now() };
  cache.set(key, next);
  persist(key, next);
  emit(key);
}

/** Wipe all cached data (used on sign-out so a new session never sees stale
 *  data) — both in memory and the persisted mirror. */
export function clearQueryCache(): void {
  const keys = [...cache.keys()];
  cache.clear();
  keys.forEach(emit);
  void AsyncStorage.getAllKeys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith(PERSIST_PREFIX)).map((k) => AsyncStorage.removeItem(k))))
    .catch(() => undefined);
}

export interface QueryResult<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
  isRefreshing: boolean;
  refetch: () => Promise<void>;
}

export function useQuery<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { enabled?: boolean; staleMs?: number } = {},
): QueryResult<T> {
  const { enabled = true, staleMs = 30_000 } = opts;
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key || !enabled) return;
    const unsub = subscribe(key, rerender);
    const entry = cache.get(key);
    const fresh = entry?.fetchedAt && Date.now() - entry.fetchedAt < staleMs;
    if (!fresh && entry?.status !== "loading") {
      void runFetch(key, fetcherRef.current);
    }
    return unsub;
  }, [key, enabled, staleMs, rerender]);

  const entry = (key ? cache.get(key) : undefined) as Entry<T> | undefined;
  const refetch = useCallback(async () => {
    if (key) await runFetch(key, fetcherRef.current);
  }, [key]);

  return {
    data: entry?.data,
    error: entry?.status === "error" ? entry.error : undefined,
    isLoading: enabled && !!key && entry?.data === undefined && entry?.status !== "error",
    isRefreshing: entry?.status === "loading" && entry?.data !== undefined,
    refetch,
  };
}

export function useMutation<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
): { mutate: (...args: TArgs) => Promise<TResult>; isLoading: boolean; error: unknown } {
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(undefined);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const mutate = useCallback(async (...args: TArgs): Promise<TResult> => {
    setLoading(true);
    setError(undefined);
    try {
      return await fnRef.current(...args);
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);
  return { mutate, isLoading, error };
}

/** Normalize an axios/unknown error into a short user-facing message. */
export function errorMessage(err: unknown): string {
  if (!err) return "Something went wrong.";
  const e = err as { response?: { data?: { error?: { message?: string; code?: string } }; status?: number }; message?: string };
  return (
    e.response?.data?.error?.message ??
    (e.response?.status ? `Request failed (${e.response.status}).` : undefined) ??
    e.message ??
    "Network error. Check your connection."
  );
}
