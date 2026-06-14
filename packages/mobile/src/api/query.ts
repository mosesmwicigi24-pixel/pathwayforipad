// A tiny server-state cache + hooks (a focused stand-in for React Query). Kept
// dependency-free on purpose: adding a new native-adjacent package to a running
// Metro/monorepo build is riskier than ~80 lines we fully control. It gives the
// screens loading/error/refresh states, request de-duplication, stale-time, and
// targeted invalidation so writes can refresh exactly the reads they affect.
import { useCallback, useEffect, useRef, useState } from "react";

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
    cache.set(key, { status: "success", data, fetchedAt: Date.now() });
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

/** Optimistically set a query's data (e.g. an offline write the screen should
 *  show immediately). Marks it fresh so the optimistic value isn't refetched away
 *  until the next explicit refresh/invalidate. */
export function setQueryData<T>(key: string, updater: (prev: T | undefined) => T): void {
  const prev = cache.get(key) as Entry<T> | undefined;
  cache.set(key, { status: "success", data: updater(prev?.data), fetchedAt: Date.now() });
  emit(key);
}

/** Wipe all cached data (used on sign-out so a new session never sees stale data). */
export function clearQueryCache(): void {
  const keys = [...cache.keys()];
  cache.clear();
  keys.forEach(emit);
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
