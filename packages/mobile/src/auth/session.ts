// 401 → refresh → retry-once (spec §5.3). Pure and testable: the API client wires
// the same logic into an axios interceptor, but the decision lives here.
import type { TokenVault } from "./tokenVault";

export function isUnauthorized(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 401;
}

/**
 * Run `call` with the current access token. On a 401, rotate the refresh token
 * exactly once, persist the new pair, and retry. Any other error propagates.
 */
export async function withRefresh<T>(
  call: (accessToken: string | null) => Promise<T>,
  vault: TokenVault,
  refresh: (refreshToken: string) => Promise<{ access: string; refresh: string }>,
): Promise<T> {
  try {
    return await call(await vault.getAccess());
  } catch (err) {
    if (!isUnauthorized(err)) throw err;
    const refreshToken = await vault.getRefresh();
    if (!refreshToken) throw err;
    const pair = await refresh(refreshToken);
    await vault.setTokens(pair.access, pair.refresh);
    return call(pair.access);
  }
}
