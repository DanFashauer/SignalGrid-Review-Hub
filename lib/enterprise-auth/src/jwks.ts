import type { Jwks } from "./jwt";

/**
 * A tiny TTL cache for an IdP's published JWKS. The signing keys rotate rarely,
 * so we fetch once and reuse until the TTL lapses — but we never cache a failed
 * fetch, so a transient outage doesn't poison the cache. The HTTP client and the
 * clock are both INJECTED, which keeps this unit testable offline and lets the
 * proof exercise refresh/expiry without a real network or wall clock.
 *
 * IT ALSO REFETCHES ON AN UNKNOWN `kid`, and that half was missing.
 *
 * "Keys rotate rarely" is true and was the wrong thing to design around. When an
 * IdP DOES rotate, it signs with a key this cache has never seen, `selectKey`
 * finds no match, `verifyJwtRs256` returns `no JWKS key matches kid` and the
 * request 401s. With refresh driven only by the TTL, that is EVERY request
 * failing for up to the full ten minutes — a total authentication outage for the
 * deployment, triggered by a routine action Entra ID and Okta perform on their
 * own schedule with no notice to us.
 *
 * The refetch is COOLDOWN-LIMITED. An unknown `kid` is also exactly what a
 * forged token carries, so refetching unconditionally would let anyone drive
 * unbounded outbound requests to the IdP by presenting garbage `kid` values.
 * One refetch per cooldown window at most, and a miss that has already been
 * refreshed is answered from cache — the caller then fails the token, which is
 * the correct answer for a key that genuinely does not exist.
 */

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export type JwksFetch = (uri: string) => Promise<FetchLikeResponse>;

export interface JwksCache {
  /**
   * Return the cached JWKS, refetching when the TTL has lapsed OR when
   * `wantKid` names a key the cached set does not contain.
   *
   * `wantKid` is optional so existing callers keep working unchanged; passing it
   * is what buys rotation survival.
   */
  get(nowMs: number, wantKid?: string): Promise<Jwks>;
}

/** At most one unknown-kid refetch per window, so a forged kid cannot drive traffic at the IdP. */
const KID_MISS_COOLDOWN_MS = 60 * 1000;

export function createJwksCache(uri: string, fetchImpl: JwksFetch, ttlMs = 10 * 60 * 1000): JwksCache {
  let cached: Jwks | null = null;
  let fetchedAtMs = 0;
  let lastKidMissFetchAtMs = Number.NEGATIVE_INFINITY;

  const hasKid = (jwks: Jwks | null, kid: string | undefined): boolean => {
    if (!jwks) return false;
    if (kid === undefined) return true; // no kid to satisfy; TTL alone governs
    return jwks.keys.some((k) => k.kid === kid);
  };

  return {
    async get(nowMs: number, wantKid?: string): Promise<Jwks> {
      const fresh = cached !== null && nowMs - fetchedAtMs < ttlMs;
      if (fresh && hasKid(cached, wantKid)) {
        return cached as Jwks;
      }
      // Fresh, but missing the key this token needs: refetch once per cooldown,
      // then fall back to the cache and let the caller reject the token.
      if (fresh && nowMs - lastKidMissFetchAtMs < KID_MISS_COOLDOWN_MS) {
        return cached as Jwks;
      }
      if (fresh) {
        lastKidMissFetchAtMs = nowMs;
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
