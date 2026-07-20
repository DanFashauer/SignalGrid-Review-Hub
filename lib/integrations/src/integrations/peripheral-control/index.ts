import {
  PeripheralControlConnector,
  type PeripheralConnectorConfig,
  type PeripheralHttpResponse,
  type PeripheralRequest,
  type PeripheralTransport,
} from "./peripheral-connector";

export * from "./types";
export * from "./evaluate";
export * from "./peripheral-connector";
export { createMockPeripheralTransport, type MockPeripheralOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND PERIPHERAL_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in
 * this shape: Microsoft Intune device control, Microsoft Defender for Endpoint
 * device control, CrowdStrike Falcon Device Control, Ivanti Device Control,
 * Forcepoint.
 */
export type PeripheralConnectorResolution =
  | { mode: "live"; connector: PeripheralControlConnector }
  | { mode: "fixture"; reason: string };

export function resolvePeripheralControlConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PeripheralTransport,
): PeripheralConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.PERIPHERAL_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "PERIPHERAL_ACCESS_TOKEN is not set" };
  }
  const config: PeripheralConnectorConfig = { accessToken, baseUrl: env.PERIPHERAL_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new PeripheralControlConnector(config, transportOverride ?? defaultPeripheralTransport) };
}

const defaultPeripheralTransport: PeripheralTransport = async (req: PeripheralRequest): Promise<PeripheralHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
