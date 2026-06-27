// A tiny server-state cache + hooks (a focused stand-in for React Query). Kept
// dependency-free on purpose: adding a new native-adjacent package to a running
// Metro/monorepo build is riskier than ~80 lines we fully control. It gives the
// screens loading/error/refresh states, request de-duplication, stale-time, and
// targeted invalidation so writes can refresh exactly the reads they affect.
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
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

// --- Live refresh: focus / foreground signals ----------------------------
// Mounted screens stay alive in the navigation stack, so a useQuery only ever
// fetched once (on mount) and never saw server changes until the app was killed
// and relaunched. We fix that with a global "refresh now" signal that every
// mounted useQuery listens to: fired when the app returns to the foreground and
// whenever navigation focus changes (returning to a screen). Each query then does
// a background refetch — keeping its current data on screen (no spinner) while the
// fresh result loads. notifyFocus() is also what the navigator calls on each
// screen transition.
const focusListeners = new Set<() => void>();

/** Ping every mounted query to refresh itself if it's not already fetching. Called
 *  on app-foreground and on navigation focus changes. */
export function notifyFocus(): void {
  focusListeners.forEach((l) => l());
}

let appStateWired = false;
function wireAppState(): void {
  if (appStateWired) return;
  appStateWired = true;
  try {
    AppState.addEventListener("change", (s) => {
      if (s === "active") notifyFocus();
    });
  } catch {
    /* AppState unavailable (tests) — focus refresh just won't fire */
  }
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
  wireAppState(); // start refreshing queries on app-foreground
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

/** Structural equality for two server payloads (plain JSON). Lets us repaint ONLY
 *  when the table's data actually changed — an identical refresh is a no-op. */
function dataEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function runFetch<T>(key: string, fetcher: () => Promise<T>, opts: { silent?: boolean } = {}): Promise<void> {
  const prev = cache.get(key);
  const silent = opts.silent === true;
  // A first/explicit load flips to "loading" so the screen can show its state; a
  // SILENT background refresh (focus / foreground / write / poll) never does — it
  // stays invisible and only surfaces if the data really changed.
  if (!silent) {
    // Build entries without ever assigning `undefined` explicitly (exactOptionalPropertyTypes).
    const loading: Entry<T> = { status: "loading" };
    if (prev?.data !== undefined) loading.data = prev.data as T;
    if (prev?.fetchedAt !== undefined) loading.fetchedAt = prev.fetchedAt;
    cache.set(key, loading);
    emit(key);
  }
  try {
    const data = await fetcher();
    const prevData = cache.get(key)?.data;
    if (prevData !== undefined && dataEqual(prevData, data)) {
      // Unchanged: keep the SAME data reference (so React doesn't re-render) and only
      // bump freshness. The screen updates only when the DB row actually changed.
      cache.set(key, { status: "success", data: prevData as T, fetchedAt: Date.now() });
      if (!silent) emit(key); // settle the loading flag we raised above
      return;
    }
    const ok: Entry<T> = { status: "success", data, fetchedAt: Date.now() };
    cache.set(key, ok);
    persist(key, ok);
    emit(key);
  } catch (error) {
    if (silent) return; // a failed background refresh stays invisible over good data
    const cur = cache.get(key);
    const failed: Entry<T> = { status: "error", error };
    if (cur?.data !== undefined) failed.data = cur.data as T;
    if (cur?.fetchedAt !== undefined) failed.fetchedAt = cur.fetchedAt;
    cache.set(key, failed);
    emit(key);
  }
}

/** Refresh every cached key starting with `prefix` after a write. Keeps the last
 *  data on screen and marks it stale so mounted subscribers refetch in the
 *  background (no blank/spinner flash); drops keys that have no data yet. This is
 *  the same behaviour as refreshQueries — invalidate no longer hard-deletes, so a
 *  list the user navigates back to never flashes a spinner. */
export function invalidateQueries(prefix: string): void {
  refreshQueries(prefix);
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
  opts: { enabled?: boolean; staleMs?: number; pollMs?: number } = {},
): QueryResult<T> {
  const { enabled = true, staleMs = 30_000, pollMs } = opts;
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (!key || !enabled) return;
    // Refetch the key in the background if it isn't already loading. `force` (focus /
    // foreground / poll) refetches as long as it's older than a short throttle, so
    // returning to a screen always pulls fresh data; otherwise we honour staleMs.
    const maybeFetch = (forceFresh: boolean): void => {
      const e = cache.get(key);
      if (e?.status === "loading") return;
      const age = e?.fetchedAt ? Date.now() - e.fetchedAt : Number.POSITIVE_INFINITY;
      // First load (no data yet) shows the loading state; once we have data, every
      // refresh is silent — invisible unless the data actually changed.
      if (forceFresh ? age > 1500 : age >= staleMs) void runFetch(key, fetcherRef.current, { silent: e?.data !== undefined });
    };
    // A write (invalidate/refresh) or a peer update emits on this key → re-render AND
    // refetch-if-stale, so an already-mounted screen reflects DB changes immediately.
    const onNotify = (): void => {
      rerender();
      maybeFetch(false);
    };
    const onFocus = (): void => maybeFetch(true);
    const unsub = subscribe(key, onNotify);
    focusListeners.add(onFocus);
    maybeFetch(false); // initial load (or refresh if the hydrated copy is stale)
    const poll = pollMs ? setInterval(() => maybeFetch(true), pollMs) : undefined;
    return () => {
      unsub();
      focusListeners.delete(onFocus);
      if (poll) clearInterval(poll);
    };
  }, [key, enabled, staleMs, pollMs, rerender]);

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
