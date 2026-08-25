// Request-timing middleware: records count + latency for every HTTP request once
// the response finishes. Registered early so it observes the whole pipeline.
import type { Request, Response, NextFunction } from "express";
import { httpRequests, httpDuration, OTHER_ROUTE } from "../lib/metrics";

/**
 * The route label comes from the route Express MATCHED, never from the URL the
 * caller sent.
 *
 * WHY. This used to be `normalizeRoute(req.originalUrl)`, which collapsed only
 * recognised id shapes and let every other path become its own label, verbatim, in
 * two Maps that never evict. Measured: 150 unauthenticated GETs to `/api/junk-N`
 * created 150 label series and grew the `/metrics` body from 2,119 to 185,583
 * bytes — 88x in 150 requests, with no credential, under both product profiles,
 * because this middleware and `GET /metrics` sit above the `/api` GA fence.
 *
 * Throttling could not cap it either: 51 of those 150 series were minted by
 * requests the limiter had ALREADY rejected with a 429, because this middleware is
 * registered above `globalRateLimiter` — deliberately, so throttled requests are
 * still counted. Counting them is right; letting each one mint a permanent label
 * is not.
 *
 * `req.route` is set by Express only when a layer actually matched, and is
 * undefined for a 404. That is the discriminator: a real route contributes its
 * PATTERN (`/v1/decisions/:id`, already id-free by construction), and anything
 * unmatched contributes one shared bucket. An attacker can now mint at most one
 * label, whatever they send.
 */
function routeLabel(req: Request): string {
  const matched = (req as Request & { route?: { path?: string } }).route?.path;
  if (typeof matched !== "string" || matched.length === 0) {
    return OTHER_ROUTE;
  }

  // The label must be APP-ABSOLUTE, and `req.baseUrl` cannot be trusted to supply
  // the prefix at this point. Express restores `baseUrl` as the router stack
  // unwinds, so a response produced by the app-level error handler has already
  // lost it while one produced inside the router still has it. That made the label
  // depend on HOW the response was produced rather than on which route matched:
  // `/api/healthz` and `/api/v1/keys` came out fully qualified while
  // `/api/v1/decisions/:id` — which answers a 404 through the error handler —
  // came out as `/v1/decisions/:id`. Two labels for one mount.
  //
  // Derive the prefix from the URL instead. `originalUrl` is never rewritten, so
  // the mount is whatever precedes the pattern's own first literal segment.
  const originalPath = (req.originalUrl || req.url || "").split("?")[0];
  const firstLiteral = matched.split("/").find((seg) => seg.length > 0 && !seg.startsWith(":"));

  if (!firstLiteral) {
    // The pattern is "/" or entirely parameterised — the whole path is the mount.
    const base = req.baseUrl || "";
    return base.length > 0 ? base : OTHER_ROUTE;
  }

  const at = originalPath.indexOf(`/${firstLiteral}`);
  const prefix = at > 0 ? originalPath.slice(0, at) : "";
  const full = `${prefix}${matched}`;
  return full.length > 0 ? full : OTHER_ROUTE;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routeLabel(req);
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequests.inc(labels);
    httpDuration.observe({ route }, durationSec);
  });
  next();
}
