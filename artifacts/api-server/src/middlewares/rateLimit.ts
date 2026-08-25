import rateLimit, { ipKeyGenerator, type RateLimitRequestHandler } from "express-rate-limit";
import type { Request, Response } from "express";

/**
 * 429 body in the SAME flat envelope every other error uses ({requestId, error,
 * message}). This was a static `message` object before, which meant two things a
 * client could not rely on: no requestId to correlate a throttle against server
 * logs, and a different shape from every other error class. express-rate-limit
 * sets the RateLimit and Retry-After headers before invoking the handler.
 */
function rateLimitHandler(req: Request, res: Response): void {
  res.status(429).json({
    requestId: req.requestId ?? null,
    error: "rate_limited",
    message: "Rate limit exceeded. Slow down and retry shortly.",
  });
}

/**
 * Fixed-window rate limiter for the /v1 product surface. Uses the standard
 * `express-rate-limit` middleware (a production deployment would back it with a
 * shared/distributed store).
 *
 * The limiter runs ahead of the authentication middleware, so it parses the
 * bearer token itself and keys by token — this gives per-key limiting instead
 * of per-IP, so a single caller behind shared NAT cannot exhaust the bucket for
 * every demo key from that address. Unauthenticated requests fall back to the
 * client address.
 */
/**
 * Read a positive-integer limit from the environment, falling back to the
 * shipped default.
 *
 * WHY THIS KNOB EXISTS. The load harness (`test/load.test.mjs`) measured the
 * real ceiling for the first time and found the LIMITER, not the decision path,
 * defines capacity: the core answers in ~1.3 ms while a single key is capped at
 * 240 requests per minute — four decisions a second. That default is right for a
 * public demo surface and far too low for a real fleet, where several hundred
 * shared devices each re-check a session on pickup. Before this, an operator
 * hitting the ceiling had no lever short of editing source.
 *
 * The DEFAULTS ARE UNCHANGED, deliberately: a deployment that sets nothing
 * behaves exactly as before, so this adds a control without moving anyone's
 * ground. A malformed or non-positive value falls back rather than disabling the
 * limiter — the failure mode of a rate limit misread as "0" is an open door.
 */
function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export const v1RateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: limitFromEnv("SIGNALGRID_V1_RATE_LIMIT", 240),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const token = bearerToken(req);
    // The unauthenticated fallback goes through the library's ipKeyGenerator,
    // which buckets IPv6 callers by /56 subnet: keying raw IPv6 addresses
    // per-address would let one caller rotate through a subnet's worth of
    // addresses and dodge the limit (the library's ERR_ERL_KEY_GEN_IPV6
    // validation exists to catch exactly this, and fired on the old code).
    return token ? `tok:${token}` : req.ip ? `ip:${ipKeyGenerator(req.ip)}` : "ip:unknown";
  },
  // Address validation is not relevant on the primary path — we key by token
  // first and only fall back to the (subnet-bucketed) address without one.
  validate: { ip: false },
  handler: rateLimitHandler,
});

/**
 * Coarser limiter applied to EVERY route (registered first in `app.ts`), so the
 * unauthenticated public surface — health, integrations, the simulator, and the
 * `/v1/keys` discovery route that sits ahead of the /v1 auth guard — cannot be
 * spammed for amplification or token harvesting. Keyed by client address; the
 * per-key /v1 limiter still applies a tighter bound on the authenticated paths.
 */
/**
 * Liveness and readiness, app-absolute. These are mounted under the `/api`
 * router, and the global limiter runs at the app level BEFORE that mount, so
 * `req.path` here carries the prefix.
 *
 * Matched by EXACT string, never by prefix. A prefix test would exempt
 * `/api/healthz-and-also-something-expensive` from the limiter, and an
 * allowlist that is loose in the direction of exempting more is the wrong
 * direction for this one.
 */
const UNTHROTTLED_PROBES = new Set(["/api/healthz", "/api/readyz"]);

/**
 * Why the probes are exempt at all: `lib/profile.ts` already keeps `/healthz`
 * and `/readyz` outside the GA fence on the stated reasoning that an
 * orchestrator "would treat a fenced 404 as a dead instance and restart a
 * working server". A 429 lands in exactly the same place — a probe that cannot
 * get an answer reads as an unhealthy instance, so the limiter reintroduced by
 * a different route the failure the fence exemption exists to prevent. Under
 * load, which is when the limiter engages, is precisely when a false unhealthy
 * verdict is most expensive.
 *
 * `/metrics` is treated differently ON PURPOSE. It is not a liveness signal, it
 * is a data surface, and exempting it unconditionally would leave an open,
 * unauthenticated, unthrottled endpoint on any deployment that has not set
 * `METRICS_TOKEN`. So the exemption is conditional on the endpoint being
 * authenticated: configured token, scrape is exempt; no token, the endpoint is
 * open and the limiter is the only protection it has left, so the limit stays.
 * The unconfigured case keeps the restriction, which is the direction this
 * repository requires of an unknown.
 *
 * Read per request rather than at module load: a constant captured at import
 * time reports the environment as it was when the module first ran, which is a
 * defect this codebase has already fixed once in `webhooks/dispatch.ts`.
 */
function skipGlobalLimit(req: Request): boolean {
  if (UNTHROTTLED_PROBES.has(req.path)) {
    return true;
  }
  return req.path === "/metrics" && (process.env.METRICS_TOKEN?.trim() ?? "") !== "";
}

export const globalRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: limitFromEnv("SIGNALGRID_GLOBAL_RATE_LIMIT", 600),
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipGlobalLimit,
  handler: rateLimitHandler,
});

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return null;
  }
  const prefix = "bearer ";
  if (
    header.length <= prefix.length ||
    header.slice(0, prefix.length).toLowerCase() !== prefix
  ) {
    return null;
  }
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}
