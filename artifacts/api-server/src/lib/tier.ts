// Deployment-tier resolver for the four-tier pipeline: dev → alpha → beta → prod.
// The tier is set per environment via SIGNALGRID_TIER (defaults to "dev").

export type Tier = "dev" | "alpha" | "beta" | "prod";

const TIERS: readonly Tier[] = ["dev", "alpha", "beta", "prod"];

/** Resolve the current deployment tier; unknown/unset values fail safe to "dev". */
export function resolveTier(): Tier {
  const raw = (process.env["SIGNALGRID_TIER"] ?? "dev").toLowerCase();
  return (TIERS as readonly string[]).includes(raw) ? (raw as Tier) : "dev";
}

/**
 * Whether real (live) integration calls to external vendors are permitted.
 *
 * Fixture-safe by default: dev and alpha NEVER make live vendor calls, no matter
 * what is configured. beta and prod may make live calls, but only when
 * explicitly enabled with SIGNALGRID_LIVE_INTEGRATIONS=true. This keeps CI and
 * the lower tiers deterministic and offline while allowing real integrations in
 * the promoted tiers.
 */
export function isLiveIntegrationsEnabled(tier: Tier = resolveTier()): boolean {
  if (tier !== "beta" && tier !== "prod") {
    return false;
  }
  return process.env["SIGNALGRID_LIVE_INTEGRATIONS"] === "true";
}
