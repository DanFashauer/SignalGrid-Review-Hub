import type { NextFunction, Request, Response } from "express";
import { pathMatcher } from "../lib/profile";

/**
 * Deprecation announcements — the MECHANISM, shipped before it is needed.
 *
 * docs/API_VERSIONING_POLICY.md promises that a route is never removed or
 * changed incompatibly without a machine-readable warning period: the
 * `Deprecation` header (with the date the deprecation was announced) and a
 * `Sunset` header (RFC 8594 — the earliest date the route may stop working).
 * A policy that names headers nothing serves is a promise with no delivery
 * path, so the middleware exists now and the registry it reads is EMPTY —
 * which the test suite asserts live, so this can never silently deprecate.
 *
 * NOTHING IS DEPRECATED TODAY. Adding an entry here is a scope decision:
 * bump the policy doc, and expect the api tests to hold you to the headers.
 */
export interface DeprecatedRoute {
  method: string;
  /** Express-style pattern, matched by the SAME matcher as the GA fence. */
  path: string;
  /** ISO date the deprecation was announced (Deprecation header value). */
  since: string;
  /** ISO date the route may stop answering (Sunset header value). */
  sunset: string;
  /** Where the replacement is documented (Link header, rel="deprecation"). */
  link?: string;
}

export const DEPRECATED_ROUTES: readonly DeprecatedRoute[] = [];

/**
 * Operator-injected entries, for drills and for announcing a deprecation on a
 * running deployment ahead of a release: SIGNALGRID_DEPRECATED_ROUTES is a
 * JSON array of DeprecatedRoute. Malformed JSON or a non-array yields NO
 * entries rather than a guess — wrongly announcing a deprecation is a false
 * statement to every client that sees the header, so the failure mode of a
 * bad value must be silence, not enthusiasm. (This is also how the test
 * suite proves the headers actually get served, without deprecating anything
 * in source.)
 */
function envEntries(): DeprecatedRoute[] {
  const raw = process.env.SIGNALGRID_DEPRECATED_ROUTES;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is DeprecatedRoute =>
        typeof e === "object" && e !== null &&
        typeof e.method === "string" && typeof e.path === "string" &&
        typeof e.since === "string" && typeof e.sunset === "string",
    );
  } catch {
    return [];
  }
}

const matchers = [...DEPRECATED_ROUTES, ...envEntries()].map((r) => ({
  ...r,
  verb: r.method.toUpperCase(),
  re: pathMatcher(r.path),
}));

export function deprecationHeaders(req: Request, res: Response, next: NextFunction): void {
  if (matchers.length > 0) {
    // Registry entries use SPEC paths (/v1/...), and the spec's server base is
    // /api — but this middleware runs at app level, where req.path carries the
    // full served path (/api/v1/...). Strip exactly the one mount segment so an
    // entry names a route the way every document names it. (Caught by the test
    // on first run: the headers matched nothing because /api/v1/audit is not
    // /v1/audit.)
    const full = (req.path.split("?")[0] ?? "").replace(/\/+$/, "") || "/";
    const clean = full.startsWith("/api/") ? full.slice("/api".length) : full;
    const verb = req.method.toUpperCase();
    const hit = matchers.find((m) => m.verb === verb && m.re.test(clean));
    if (hit) {
      // Wire formats per the RFCs, derived from the registry's ISO dates:
      // Deprecation (RFC 9745) is "@" + unix seconds; Sunset (RFC 8594) is an
      // HTTP-date. A registry entry whose dates do not parse serves NOTHING —
      // half-formed headers would be a false statement in a compliant costume.
      const sinceMs = Date.parse(hit.since);
      const sunsetMs = Date.parse(hit.sunset);
      if (Number.isFinite(sinceMs) && Number.isFinite(sunsetMs)) {
        res.setHeader("Deprecation", `@${Math.floor(sinceMs / 1000)}`);
        res.setHeader("Sunset", new Date(sunsetMs).toUTCString());
        if (hit.link) res.setHeader("Link", `<${hit.link}>; rel="deprecation"`);
      }
    }
  }
  next();
}
