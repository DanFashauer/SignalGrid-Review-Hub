// NAC (network access control) — READ-ONLY, and gated before it can read live.
//
// The vendor adapters (Cisco ISE, Aruba ClearPass) previously exposed quarantine
// and un-quarantine actuators that cut a device off the network. Those are gone
// (see the removal notes in cisco-ise.ts / aruba-clearpass.ts and the NACAdapter
// contract): a device action has no read-only-disciplined form. What remains —
// endpoint lookup and a connectivity check — still talks to a real appliance, so
// it is gated the same way every other live vendor path in this repo is: dev and
// alpha NEVER make live calls; beta/prod may, and only with
// SIGNALGRID_LIVE_INTEGRATIONS=true plus a configured provider. Anything else
// resolves to fixture mode WITH A REASON, so a caller can never mistake "not
// configured" for "checked and clean".

import { CiscoISEAdapter, type CiscoISEConfig } from "./cisco-ise";
import { ArubaClearPassAdapter, type ArubaClearPassConfig } from "./aruba-clearpass";
import type { NACAdapter } from "../adapters/types";

export type NACResolution =
  | { mode: "live"; adapter: NACAdapter; provider: "ise" | "clearpass" }
  | { mode: "fixture"; reason: string };

/**
 * Resolve a live NAC adapter, or explain why not.
 *
 * Fail-closed by construction: every branch that cannot prove it should be live
 * returns `fixture` with the reason, and no branch returns an adapter that can
 * act on a device — the contract no longer has such a method.
 */
export function resolveNacAdapter(env: NodeJS.ProcessEnv = process.env): NACResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }

  const provider = env.NAC_PROVIDER?.trim().toLowerCase();
  const baseUrl = env.NAC_BASE_URL?.trim();
  if (!baseUrl) {
    return { mode: "fixture", reason: "NAC_BASE_URL is not set" };
  }

  if (provider === "ise") {
    const username = env.NAC_USERNAME?.trim();
    const password = env.NAC_PASSWORD?.trim();
    if (!username || !password) {
      return { mode: "fixture", reason: "NAC_USERNAME / NAC_PASSWORD are not set" };
    }
    const config: CiscoISEConfig = { baseUrl, username, password };
    return { mode: "live", adapter: new CiscoISEAdapter(config), provider: "ise" };
  }

  if (provider === "clearpass") {
    const clientId = env.NAC_CLIENT_ID?.trim();
    const clientSecret = env.NAC_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      return { mode: "fixture", reason: "NAC_CLIENT_ID / NAC_CLIENT_SECRET are not set" };
    }
    const config: ArubaClearPassConfig = { baseUrl, clientId, clientSecret };
    return { mode: "live", adapter: new ArubaClearPassAdapter(config), provider: "clearpass" };
  }

  return { mode: "fixture", reason: `NAC_PROVIDER "${provider ?? "(unset)"}" is not a supported provider` };
}

export { CiscoISEAdapter, ArubaClearPassAdapter };
export type { CiscoISEConfig, ArubaClearPassConfig };
