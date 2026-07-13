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
export const v1RateLimiter: RateLimitRequestHandler = rateLimit({
  windowMs: 60_000,
  limit: 240,
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
