import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";
import type { Request } from "express";

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
    return token ? `tok:${token}` : `ip:${req.ip ?? "unknown"}`;
  },
  // Key-generator IP validation is not relevant here — we key by token first
  // and only fall back to the address for unauthenticated requests.
  validate: { ip: false },
  message: {
    error: "rate_limited",
    message: "Rate limit exceeded. Slow down and retry shortly.",
  },
});

/**
 * Coarser limiter applied to EVERY route (registered first in `app.ts`), so the
 * unauthenticated public surface — health, integrations, the simulator, and the
 * `/v1/keys` discovery route that sits ahead of the /v1 auth guard — cannot be
 * spammed for amplification or token harvesting. Keyed by client address; the
 * per-key /v1 limiter still applies a tighter bound on the authenticated paths.
 */
export const globalRateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: limitFromEnv("SIGNALGRID_GLOBAL_RATE_LIMIT", 600),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "rate_limited",
    message: "Rate limit exceeded. Slow down and retry shortly.",
  },
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
