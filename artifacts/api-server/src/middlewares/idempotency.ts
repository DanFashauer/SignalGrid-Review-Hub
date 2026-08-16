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
const TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, StoredResponse>();

function cacheKey(req: Request): string | null {
  if (req.method !== "POST") return null;
  const key = req.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0 || key.length > 256) return null;
  // Caller-scoped: the bearer (set by requireTenantContext upstream) is part of
  // the key, so one tenant's key can never replay another tenant's response.
  // originalUrl, not req.path — this runs under a mounted router, where
  // req.path is relative to the mount and two different absolute routes could
  // collide. (The deprecation middleware hit the mirror image of this.)
  const path = (req.originalUrl.split("?")[0] ?? "").replace(/\/+$/, "");
  return `${req.bearerToken}\n${req.method}\n${path}\n${key}`;
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
