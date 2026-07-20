import {
  EdrThreatConnector,
  type EdrConnectorConfig,
  type EdrHttpResponse,
  type EdrRequest,
  type EdrTransport,
} from "./edr-connector";

export * from "./types";
export * from "./evaluate";
export * from "./edr-connector";
export { createMockEdrTransport, type MockEdrOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND EDR_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in this
 * shape: Microsoft Defender for Endpoint, CrowdStrike Falcon, SentinelOne
 * Singularity, Jamf Protect, Sophos Intercept X, VMware Carbon Black.
 */
export type EdrConnectorResolution =
  | { mode: "live"; connector: EdrThreatConnector }
  | { mode: "fixture"; reason: string };

export function resolveEdrThreatConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: EdrTransport,
): EdrConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.EDR_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "EDR_ACCESS_TOKEN is not set" };
  }
  const config: EdrConnectorConfig = { accessToken, baseUrl: env.EDR_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new EdrThreatConnector(config, transportOverride ?? defaultEdrTransport) };
}

const defaultEdrTransport: EdrTransport = async (req: EdrRequest): Promise<EdrHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
