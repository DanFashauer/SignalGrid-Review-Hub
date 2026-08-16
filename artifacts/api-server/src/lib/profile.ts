// Product profile — which SUPPORTED surface this deployment serves.
//
// Orthogonal to `tier.ts`. Tier answers "how promoted is this deployment?"
// (dev → alpha → beta → prod) and gates LIVE VENDOR CALLS. Profile answers a
// different question — "is this a public review deployment, or a customer one?"
// — and gates DEMO AFFORDANCES. Keeping them separate matters: the API test
// spawns servers with `NODE_ENV=production` while `SIGNALGRID_TIER` stays at its
// "dev" default, so neither of the existing signals actually means "a customer
// is using this".
//
// WHY THIS EXISTS. An audit of the running server found three unauthenticated
// surfaces, each acceptable in a fixture demo and none acceptable in front of a
// customer:
//
//   1. `GET /v1/keys` is registered ABOVE the auth guard (routes/v1.ts), and
//      `DEMO_KEYS` carries the RAW bearer. It publishes an owner token for every
//      seeded tenant to anonymous callers. The route's own neighbouring comment
//      already admitted "any visitor can satisfy the role check … must not be
//      inherited by a real deployment" — prose, with no gate behind it.
//   2. `POST /api/sim/room-entry` is mounted with no auth, derives a tenant from a
//      CLIENT-SUPPLIED scenarioId, mints that tenant's own operator/owner token,
//      and then WRITES — decision, evidence snapshot, two audit-ledger appends, a
//      metrics increment.
//   3. The whole `/cp/v1` control plane is mounted with no auth, so its
//      client-supplied `?tenant=` query parameter is the only scoping there is.
//
// The `/v1` isolation model underneath is sound — every route derives its tenant
// from the verified bearer and a cross-tenant read returns the same 404 as a
// nonexistent id. These are not holes in that model; they are demo scaffolding
// reachable in front of it.
//
// ADDITIVE BY CONSTRUCTION. The default is unchanged: with no profile set, every
// demo surface behaves exactly as before. Those surfaces are load-bearing — they
// are how this repo is publicly reviewable — so the gateway profile is opt-IN,
// and a deployment that wants the demo keeps working by doing nothing. What the
// profile buys is a single switch a real deployment can set, and a gate that
// proves BOTH halves rather than only the one it was written for.

/** The supported product surfaces. `review-demo` is the fixture-backed public
 *  surface; `shared-device-gateway` is the first commercial profile. */
export type ProductProfile = "review-demo" | "shared-device-gateway";

const PROFILES: readonly ProductProfile[] = ["review-demo", "shared-device-gateway"];

/**
 * Resolve the configured profile.
 *
 * Unset or unrecognized resolves to `review-demo` — the CURRENT behaviour, so
 * this cannot silently change an existing deployment. Note the fail direction is
 * the opposite of `resolveTier`'s and deliberately so: an unreadable TIER must
 * not enable live vendor calls, whereas an unreadable PROFILE must not switch off
 * the demo surfaces a reviewer is relying on. In both cases the unknown value
 * resolves to the option that changes nothing.
 */
export function resolveProfile(): ProductProfile {
  const raw = (process.env["SIGNALGRID_PRODUCT_PROFILE"] ?? "").trim().toLowerCase();
  return (PROFILES as readonly string[]).includes(raw) ? (raw as ProductProfile) : "review-demo";
}

/**
 * May this deployment serve demo affordances — published demo credentials, the
 * unauthenticated simulator, the unauthenticated control plane, and demo bearer
 * tokens as credentials?
 *
 * True for `review-demo`, false for `shared-device-gateway`. Expressed as one
 * predicate rather than a scatter of `resolveProfile() === …` comparisons so that
 * every affordance is gated on the SAME condition and a future profile has one
 * place to change.
 */
export function demoSurfacesEnabled(profile: ProductProfile = resolveProfile()): boolean {
  return profile === "review-demo";
}

// ── The GA served surface ─────────────────────────────────────────────────────
//
// `demoSurfacesEnabled` above answers "may this deployment show demo
// affordances". It does NOT answer the question a customer deployment actually
// raises: WHAT DOES THIS SERVER SERVE? Under `shared-device-gateway` it still
// mounts the integrations catalog, the monitoring routes, the simulator, the
// signal radar and all 46 deferred `/v1` paths. Every one of those is real work
// that is not part of Limited GA, and a surface nobody scoped is a surface nobody
// reviewed — which is Blocker 8 stated precisely.
//
// So the gateway profile carries an ALLOWLIST, and everything outside it 404s.
//
// WHY AN ALLOWLIST AND NOT A DENYLIST. A denylist has to be updated every time a
// route is added, and the failure mode of forgetting is that the new route SHIPS.
// An allowlist's failure mode is that a new route 404s until someone adds it —
// noisy, immediate, and safe. Fail-closed is the whole doctrine of this codebase
// applied to its own attack surface.
//
// WHY 404 AND NOT 403. A route that exists and refuses still answers "does this
// deployment have a control plane?". A 404 from this allowlist is indistinguishable
// from a route that was never registered, which is the same reasoning
// `routes/index.ts` already gives for not mounting the demo routers at all.
//
// THIS LIST IS CROSS-CHECKED, not trusted: `scripts/check-launch-profile.mjs`
// holds it against the `launch` entries of the published-API-paths surface in
// `scripts/launch-profile.mjs`. Runtime and governance are written in different
// files, by different mechanisms, and a gate compares them — so neither can drift
// into agreeing with itself.
export const GA_ALLOWED_ROUTES: readonly { method: string; path: string }[] = [
  { method: "GET", path: "/healthz" },
  // Readiness beside liveness — infra probes, like /healthz deliberately outside
  // the published OpenAPI contract. A gateway deployment whose orchestrator
  // cannot ask "should this instance take traffic?" would treat a fenced 404 as
  // a dead instance and restart a working server.
  { method: "GET", path: "/readyz" },
  { method: "GET", path: "/v1/context" },
  { method: "POST", path: "/v1/decisions/evaluate" },
  { method: "GET", path: "/v1/decisions" },
  { method: "GET", path: "/v1/decisions/:id" },
  { method: "GET", path: "/v1/decisions/:id/evidence" },
  { method: "GET", path: "/v1/audit" },
  { method: "GET", path: "/v1/metrics" },
  // Launch wireframe screen 2 (connector setup/health) — read + fixture-sync
  // only. POST /sync runs the core's fixture pipeline; runFixtureSync throws on
  // any non-fixture connector, so no route here can touch a source system.
  { method: "GET", path: "/v1/connectors" },
  { method: "GET", path: "/v1/connectors/:id/sync-runs" },
  { method: "POST", path: "/v1/connectors/:id/sync" },
  // Launch wireframe screen 5 (policy version) — read + test-run only. Draft
  // creation and version activation stay OFF the fence: policy changes ride
  // the repository at launch, not a UI.
  { method: "GET", path: "/v1/policies" },
  { method: "GET", path: "/v1/policies/:id/versions" },
  { method: "GET", path: "/v1/policies/:id/tests" },
];

/** `/v1/decisions/:id` → /^\/v1\/decisions\/[^/]+$/ — anchored at BOTH ends so
 *  `/v1/decisions/abc/resolution` cannot ride in on a prefix match. */
function pathMatcher(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${source}$`);
}

const GA_MATCHERS = GA_ALLOWED_ROUTES.map((r) => ({ method: r.method, re: pathMatcher(r.path) }));

/**
 * Is this request inside the Limited GA surface?
 *
 * THE METHOD IS PART OF THE ANSWER, and that is not tidiness — it closes a hole the
 * test caught on the first run. With paths alone, `/v1/decisions/:id` matches
 * `[^/]+` in the id position, so `POST /v1/decisions/reconcile` — a DEFERRED route —
 * sailed through the fence looking exactly like a decision id. A parameterised
 * allowlist entry silently swallows its literal siblings, and the sibling here was a
 * write path. Pinning the method separates `GET /v1/decisions/:id` (launch) from
 * `POST /v1/decisions/reconcile` (deferred) without a denylist of names to maintain.
 *
 * Query strings are never consulted: scoping by a client-supplied query parameter is
 * exactly the defect the control-plane router was unmounted for.
 */
export function routeServedByGateway(method: string, path: string): boolean {
  const clean = path.split("?")[0]!.replace(/\/+$/, "") || "/";
  const verb = method.toUpperCase();
  return GA_MATCHERS.some((m) => m.method === verb && m.re.test(clean));
}
