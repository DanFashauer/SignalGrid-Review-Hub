import {
  IdentityRiskConnector,
  type IdentityConnectorConfig,
  type IdentityHttpResponse,
  type IdentityRequest,
  type IdentityTransport,
} from "./identity-connector";

export * from "./types";
export * from "./evaluate";
export * from "./identity-connector";
export { createMockIdentityTransport, type MockIdentityOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND IDENTITY_RISK_ACCESS_TOKEN. Otherwise fixture mode. Integration
 * targets in this shape: Microsoft Entra ID Protection (risky users / risk
 * detections), Okta ThreatInsight, Ping Identity, Cisco Duo, Google Workspace
 * context-aware access.
 */
export type IdentityConnectorResolution =
  | { mode: "live"; connector: IdentityRiskConnector }
  | { mode: "fixture"; reason: string };

export function resolveIdentityRiskConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: IdentityTransport,
): IdentityConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.IDENTITY_RISK_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "IDENTITY_RISK_ACCESS_TOKEN is not set" };
  }
  const config: IdentityConnectorConfig = { accessToken, baseUrl: env.IDENTITY_RISK_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new IdentityRiskConnector(config, transportOverride ?? defaultIdentityTransport) };
}

const defaultIdentityTransport: IdentityTransport = async (req: IdentityRequest): Promise<IdentityHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
