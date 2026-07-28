import {
  PolicyBindingConnector,
  type PolicyBindingConnectorConfig,
  type PolicyBindingTransport,
} from "./policy-binding-connector";
import { PolicyBindingConnectorError, type PolicyBindingReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./policy-binding-connector";
export { createMockPolicyBindingTransport, type MockPolicyBindingOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * POLICY_BINDING_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a management plane's own binding report (Intune dynamic-group
 * re-evaluation, Fleet team assignment, PACS access levels — docs/POLICY_BINDING.md
 * maps them all). SignalGrid consumes that reading; it never moves a device between
 * groups — that stays with the management plane.
 */
export type PolicyBindingConnectorResolution =
  | { mode: "live"; connector: PolicyBindingConnector }
  | { mode: "fixture"; reason: string };

export function resolvePolicyBindingConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PolicyBindingTransport,
): PolicyBindingConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.POLICY_BINDING_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "POLICY_BINDING_ACCESS_TOKEN is not set" };
  }
  const config: PolicyBindingConnectorConfig = {
    accessToken,
    baseUrl: env.POLICY_BINDING_BASE_URL?.trim() || "https://policy-binding-inventory.local/policy-binding",
    source: "policy-binding-inventory",
  };
  return {
    mode: "live",
    connector: new PolicyBindingConnector(config, transportOverride ?? makeDefaultPolicyBindingTransport(config.baseUrl)),
  };
}

/** Build a live inventory transport bound to a specific base URL (honors config). */
export function makeDefaultPolicyBindingTransport(baseUrl: string): PolicyBindingTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new PolicyBindingConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `policy-binding source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PolicyBindingConnectorError("bad_response", "policy-binding source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PolicyBindingConnectorError("bad_response", "policy-binding source returned a non-object body", res.status);
    }
    return body as PolicyBindingReportRaw;
  };
}
