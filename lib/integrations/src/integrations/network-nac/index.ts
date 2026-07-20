import {
  NetworkNacConnector,
  type NetworkConnectorConfig,
  type NetworkHttpResponse,
  type NetworkRequest,
  type NetworkTransport,
} from "./network-connector";

export * from "./types";
export * from "./evaluate";
export * from "./network-connector";
export { createMockNetworkTransport, type MockNetworkOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND NAC_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in this
 * shape: Cisco ISE / Catalyst Center / Meraki, FortiNAC, Aruba ClearPass / Central,
 * Arista CloudVision.
 */
export type NetworkConnectorResolution =
  | { mode: "live"; connector: NetworkNacConnector }
  | { mode: "fixture"; reason: string };

export function resolveNetworkNacConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: NetworkTransport,
): NetworkConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.NAC_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "NAC_ACCESS_TOKEN is not set" };
  }
  const config: NetworkConnectorConfig = { accessToken, baseUrl: env.NAC_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new NetworkNacConnector(config, transportOverride ?? defaultNetworkTransport) };
}

const defaultNetworkTransport: NetworkTransport = async (req: NetworkRequest): Promise<NetworkHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
