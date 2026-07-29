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
