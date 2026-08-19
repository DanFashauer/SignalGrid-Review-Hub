import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

/**
 * Idempotency replay for the mutating /v1 POSTs — opt-in per request.
 *
 * A frontline device retries: connectivity drops after the server answered but
 * before the client heard it, the host app re-sends, and without this a single
 * pickup mints two decisions, two audit appends, two sessions. A client that
 * sends `Idempotency-Key: <its own token>` on a POST gets exactly-once
 * semantics for that key: the first completion is stored, and any repeat of
 * the SAME key on the SAME route by the SAME caller replays the stored
 * response — marked `Idempotency-Replay: true` so a client can tell a replay
 * from a fresh execution.
 *
 * SCOPE, stated honestly rather than implied:
 *   · The store is per-process memory, like the rate limiter beside it — a
 *     multi-instance deployment needs a shared store before this is a
 *     cross-instance guarantee, and nothing here claims otherwise.
 *   · Only 2xx responses are stored. An error is not an outcome worth pinning:
 *     the client may fix the payload and legitimately reuse its key.
 *   · Two copies of the same request racing PAST each other both execute —
 *     replay begins once the first completes. Closing that window takes an
 *     in-flight lock; on this surface the double-send that matters is the
 *     sequential retry, and claiming more than is built is the defect class
 *     this repo exists to refuse.
 *
 * The key space is BOUNDED (FIFO eviction at MAX_ENTRIES, TTL besides) so a
 * caller spraying random keys degrades replay coverage, never memory.
 */

interface StoredResponse {
  status: number;
  body: unknown;
  at: number;
}

const MAX_ENTRIES = 10_000;
// FIVE MINUTES, down from 24 hours — a review finding, and the reasoning is
// worth keeping: this window exists for TRANSPORT retries (a response lost in
// flight, a crash-recovering host app re-sending), which live on the scale of
// seconds. A 24h window quietly converted retry safety into POSTURE PINNING:
// a decision-bearing 2xx (an allow verdict, a step-up release) could be
// replayed a working day after the posture it graded had degraded to deny —
// defeating the freshness the decision paths are built on. Five minutes keeps
// every legitimate retry and none of the pinning.
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, StoredResponse>();

function cacheKey(req: Request): string | null {
  if (req.method !== "POST") return null;
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0 || key.length > 256) return null;
  // Caller-scoped by the VERIFIED PRINCIPAL (tenant + subject), not the raw
  // bearer — a review finding, and the distinction is the whole feature: under
  // enterprise OIDC the context middleware deliberately mints a fresh opaque
  // server credential per request, so a bearer-keyed cache could NEVER hit in
  // exactly the production mode, silently minting the double the header
  // comment promises cannot happen (and evicting demo-mode entries while at
  // it). The principal is stable across a caller's requests in both auth
  // modes; the bearer remains only as a fail-closed fallback that scopes at
  // least as narrowly.
  const p = req.principal as { tenantId?: string; subjectId?: string } | undefined;
  const caller = p?.tenantId && p?.subjectId ? `${p.tenantId}\n${p.subjectId}` : `tok:${req.bearerToken}`;
  // originalUrl, not req.path — this runs under a mounted router, where
  // req.path is relative to the mount and two different absolute routes could
  // collide. (The deprecation middleware hit the mirror image of this.)
  const path = (req.originalUrl.split("?")[0] ?? "").replace(/\/+$/, "");
  // The BODY is part of the key (review finding): the same key with a
  // different payload must execute fresh, never serve another request's
  // response as a 200 the client has no way to distinguish. Keying (rather
  // than rejecting) the mismatch keeps the middleware honest without
  // inventing a new error class on a surface whose envelope is contractual.
  const bodyDigest = createHash("sha256").update(JSON.stringify(req.body ?? null)).digest("hex");
  return `${caller}\n${req.method}\n${path}\n${key}\n${bodyDigest}`;
}

export function idempotencyReplay(req: Request, res: Response, next: NextFunction): void {
  const key = cacheKey(req);
  if (key === null) {
    next();
    return;
  }

  const hit = cache.get(key);
  if (hit !== undefined) {
    if (Date.now() - hit.at > TTL_MS) {
      cache.delete(key);
    } else {
      res.setHeader("Idempotency-Replay", "true");
      res.status(hit.status).json(hit.body);
      return;
    }
  }

  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode >= 200 && res.statusCode < 300 && !cache.has(key)) {
      if (cache.size >= MAX_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(key, { status: res.statusCode, body, at: Date.now() });
    }
    return json(body);
  }) as Response["json"];

  next();
}
