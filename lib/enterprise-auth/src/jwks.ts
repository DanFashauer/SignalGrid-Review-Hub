import type { Jwks } from "./jwt";

/**
 * A tiny TTL cache for an IdP's published JWKS. The signing keys rotate rarely,
 * so we fetch once and reuse until the TTL lapses — but we never cache a failed
 * fetch. A failure does open a short FETCH_FAILURE_BACKOFF_MS window in which
 * get() refuses without fetching, so an IdP outage is not hammered. The HTTP
 * client and the clock are both INJECTED, which keeps this unit testable offline
 * and lets the proof exercise refresh/expiry without a real network or wall clock.
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

/**
 * The injected fetch MUST settle on its own (a timeout or abort signal). The cache
 * single-flights it: every concurrent `get()` joins ONE shared promise, and the
 * cache has no timer of its own (its clock is injected), so a fetch that never
 * settles stalls every caller. api-server's `defaultJwksFetch` carries
 * `AbortSignal.timeout(5000)`, which also aborts the body read.
 */
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

/**
 * After a failed fetch, refuse without refetching for this long, so a cold or
 * stale cache does not turn every bearer request into an IdP request while the
 * IdP is down. Kept SHORT on purpose: it also delays recovery by up to this much
 * after the IdP comes back.
 */
const FETCH_FAILURE_BACKOFF_MS = 10_000;

export function createJwksCache(uri: string, fetchImpl: JwksFetch, ttlMs = 10 * 60 * 1000): JwksCache {
  let cached: Jwks | null = null;
  let fetchedAtMs = 0;
  let lastKidMissFetchAtMs = Number.NEGATIVE_INFINITY;
  // One shared in-flight fetch: concurrent callers join it, so two fetches can
  // never overlap and an older response can never overwrite a newer one.
  let inflight: Promise<Jwks> | null = null;
  let failedAtMs = Number.NEGATIVE_INFINITY;

  const hasKid = (jwks: Jwks | null, kid: string | undefined): boolean => {
    if (!jwks) return false;
    if (kid === undefined) return true; // no kid to satisfy; TTL alone governs
    return jwks.keys.some((k) => k.kid === kid);
  };

  return {
    async get(nowMs: number, wantKid?: string): Promise<Jwks> {
      // freshness: local-by-design — not the sighting-freshness rule — a JWKS CACHE TTL over a fetch this process performed itself, so there is no foreign clock to skew against
      const fresh = cached !== null && nowMs - fetchedAtMs < ttlMs;
      if (fresh && hasKid(cached, wantKid)) {
        return cached as Jwks;
      }
      // Fresh, but missing the key this token needs: refetch once per cooldown,
      // then fall back to the cache and let the caller reject the token.
      // freshness: local-by-design — the same self-performed-fetch cache cooldown; no foreign clock, no skew
      if (fresh && nowMs - lastKidMissFetchAtMs < KID_MISS_COOLDOWN_MS) {
        return cached as Jwks;
      }
      if (inflight) {
        return inflight;
      }
      // A clock stepped backwards must not stretch the backoff by the size of the step:
      // on a cold cache that would refuse every request with no fetch at all.
      // freshness: local-by-design — the backoff after this process's own failed fetch; no foreign clock, no skew
      const sinceFailureMs = nowMs - failedAtMs;
      if (sinceFailureMs >= 0 && sinceFailureMs < FETCH_FAILURE_BACKOFF_MS) {
        throw new Error("JWKS fetch failed recently; backing off");
      }
      if (fresh) {
        lastKidMissFetchAtMs = nowMs;
      }
      inflight = (async () => {
        const res = await fetchImpl(uri);
        if (!res.ok) {
          throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
        }
        const body = (await res.json()) as Partial<Jwks>;
        if (!body || !Array.isArray(body.keys)) {
          throw new Error("JWKS response has no keys array");
        }
        // Cache only object elements, so a `null` key cannot throw in hasKid or selectKey.
        cached = { keys: body.keys.filter((k) => k !== null && typeof k === "object") };
        fetchedAtMs = nowMs;
        return cached;
      })()
        .catch((e) => {
          failedAtMs = nowMs;
          throw e;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
  };
}
