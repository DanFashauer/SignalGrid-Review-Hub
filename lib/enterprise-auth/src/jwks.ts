import type { Jwks } from "./jwt";

/**
 * A tiny TTL cache for an IdP's published JWKS. The signing keys rotate rarely,
 * so we fetch once and reuse until the TTL lapses — but we never cache a failed
 * fetch, so a transient outage doesn't poison the cache. The HTTP client and the
 * clock are both INJECTED, which keeps this unit testable offline and lets the
 * proof exercise refresh/expiry without a real network or wall clock.
 */

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type JwksFetch = (uri: string) => Promise<FetchLikeResponse>;

export interface JwksCache {
  /** Return the cached JWKS, refetching when the TTL has lapsed. */
  get(nowMs: number): Promise<Jwks>;
}

export function createJwksCache(uri: string, fetchImpl: JwksFetch, ttlMs = 10 * 60 * 1000): JwksCache {
  let cached: Jwks | null = null;
  let fetchedAtMs = 0;

  return {
    async get(nowMs: number): Promise<Jwks> {
      if (cached && nowMs - fetchedAtMs < ttlMs) {
        return cached;
      }
      const res = await fetchImpl(uri);
      if (!res.ok) {
        throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
      }
      const body = (await res.json()) as Partial<Jwks>;
      if (!body || !Array.isArray(body.keys)) {
        throw new Error("JWKS response has no keys array");
      }
      cached = { keys: body.keys };
      fetchedAtMs = nowMs;
      return cached;
    },
  };
}
