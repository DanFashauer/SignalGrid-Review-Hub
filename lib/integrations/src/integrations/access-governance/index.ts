import {
  AccessGovernanceConnector,
  type AccessGovernanceConnectorConfig,
  type AccessGovernanceReportTransport,
} from "./access-governance-connector";
import { AccessGovernanceConnectorError, type AccessGovernanceReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./access-governance-connector";
export { createMockAccessGovernanceTransport, type MockAccessGovernanceOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND ACCESS_GOVERNANCE_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only bridge to the IGA/PAM system (SailPoint,
 * privileged-access managers, directory governance) — it hands SignalGrid the
 * already-evaluated entitlement/governance/privilege state for a principal.
 */
export type AccessGovernanceConnectorResolution =
  | { mode: "live"; connector: AccessGovernanceConnector }
  | { mode: "fixture"; reason: string };

export function resolveAccessGovernanceConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AccessGovernanceReportTransport,
): AccessGovernanceConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.ACCESS_GOVERNANCE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "ACCESS_GOVERNANCE_ACCESS_TOKEN is not set" };
  }
  const config: AccessGovernanceConnectorConfig = {
    accessToken,
    baseUrl: env.ACCESS_GOVERNANCE_BASE_URL?.trim() || "https://iga-bridge.local/access-governance",
    source: "iga-bridge",
  };
  return {
    mode: "live",
    connector: new AccessGovernanceConnector(config, transportOverride ?? makeDefaultAccessGovernanceTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultAccessGovernanceTransport(baseUrl: string): AccessGovernanceReportTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ principalId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(principalId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AccessGovernanceConnectorError(
        res.status === 401 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    return (await res.json()) as AccessGovernanceReportRaw;
  };
}
