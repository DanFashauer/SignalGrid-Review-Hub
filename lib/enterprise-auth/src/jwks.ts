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

/**
 * After a FAILED fetch, no new fetch starts until the backoff lapses; requests in
 * the window are REFUSED (the call throws, the caller 401s) — a stale keyset is
 * never served in its place. The window doubles per consecutive failure up to a
 * cap and resets on the first success.
 */
const FAILURE_BACKOFF_BASE_MS = 5 * 1000;
const FAILURE_BACKOFF_MAX_MS = 60 * 1000;

/**
 * A fetch still unresolved this long (by the INJECTED clock) is abandoned: the
 * next caller starts a fresh one instead of joining it, so one hung IdP response
 * cannot wedge every future authentication behind a promise that never settles.
 * An abandoned fetch that resolves later is subject to the generation guard.
 */
const INFLIGHT_ABANDON_MS = 15 * 1000;

export function createJwksCache(uri: string, fetchImpl: JwksFetch, ttlMs = 10 * 60 * 1000): JwksCache {
  let cached: Jwks | null = null;
  let fetchedAtMs = 0;
  let lastKidMissFetchAtMs = Number.NEGATIVE_INFINITY;

  // Single-flight: every caller arriving while a fetch is in flight joins it.
  let inflight: { promise: Promise<Jwks>; startedAtMs: number; generation: number } | null = null;
  // Generation guard: each started fetch takes the next number; a response may
  // only replace the cache if it is NEWER than the one that filled it.
  let startedGeneration = 0;
  let installedGeneration = 0;
  // Failure backoff, measured from the start of the newest failed fetch.
  let consecutiveFailures = 0;
  let backoffUntilMs = Number.NEGATIVE_INFINITY;

  const hasKid = (jwks: Jwks | null, kid: string | undefined): boolean => {
    if (!jwks) return false;
    if (kid === undefined) return true; // no kid to satisfy; TTL alone governs
    return jwks.keys.some((k) => typeof k === "object" && k !== null && k.kid === kid);
  };

  const startFetch = (nowMs: number): Promise<Jwks> => {
    startedGeneration += 1;
    const generation = startedGeneration;
    // Deferred one microtask so `inflight` is assigned BEFORE the body runs: a
    // fetchImpl that throws synchronously must not clear it ahead of assignment.
    const promise = Promise.resolve().then(async (): Promise<Jwks> => {
      try {
        const res = await fetchImpl(uri);
        if (!res.ok) {
          throw new Error(`JWKS fetch failed: HTTP ${res.status}`);
        }
        const body = (await res.json()) as Partial<Jwks>;
        if (!body || !Array.isArray(body.keys)) {
          throw new Error("JWKS response has no keys array");
        }
        if (generation > installedGeneration) {
          cached = { keys: body.keys };
          fetchedAtMs = nowMs;
          installedGeneration = generation;
          consecutiveFailures = 0;
          backoffUntilMs = Number.NEGATIVE_INFINITY;
          return cached;
        }
        // A newer fetch already filled the cache: this older response loses, and
        // its callers get the newer keyset rather than the one they waited for.
        return cached as Jwks;
      } catch (err) {
        // Only the newest fetch governs the backoff: an abandoned older fetch
        // failing after a newer one succeeded must not re-arm it.
        if (generation === startedGeneration) {
          consecutiveFailures += 1;
          const window = Math.min(
            FAILURE_BACKOFF_MAX_MS,
            FAILURE_BACKOFF_BASE_MS * 2 ** Math.min(consecutiveFailures - 1, 16),
          );
          backoffUntilMs = nowMs + window;
        }
        throw err;
      } finally {
        if (inflight !== null && inflight.generation === generation) {
          inflight = null;
        }
      }
    });
    inflight = { promise, startedAtMs: nowMs, generation };
    return promise;
  };

  return {
    async get(nowMs: number, wantKid?: string): Promise<Jwks> {
      // freshness: local-by-design — not the sighting-freshness rule — a JWKS CACHE TTL over a fetch this process performed itself, so there is no foreign clock to skew against
      const fresh = cached !== null && nowMs - fetchedAtMs < ttlMs;
      if (fresh && hasKid(cached, wantKid)) {
        return cached as Jwks;
      }
      // Join a fetch already in flight rather than starting another — unless it
      // has been in flight past the abandon limit (a hung IdP response).
      // freshness: local-by-design — an in-flight age over a fetch this process started itself; no foreign clock
      if (inflight !== null && nowMs - inflight.startedAtMs < INFLIGHT_ABANDON_MS) {
        return inflight.promise;
      }
      // Backing off after a failure: a fresh cache answers (the caller then
      // rejects a token whose kid it lacks); a cold or stale one REFUSES.
      // freshness: local-by-design — a backoff window over this process's own failed fetch
      if (nowMs < backoffUntilMs) {
        if (fresh) return cached as Jwks;
        throw new Error("JWKS fetch suppressed: backing off after a failed fetch");
      }
      // Fresh, but missing the key this token needs: refetch once per cooldown,
      // then fall back to the cache and let the caller reject the token.
      // freshness: local-by-design — the same self-performed-fetch cache cooldown; no foreign clock, no skew
      if (fresh && nowMs - lastKidMissFetchAtMs < KID_MISS_COOLDOWN_MS) {
        return cached as Jwks;
      }
      if (fresh) {
        lastKidMissFetchAtMs = nowMs;
      }
      return startFetch(nowMs);
    },
  };
}
