import {
  LocationServicesConnector,
  type LocationConnectorConfig,
  type LocationHttpResponse,
  type LocationRequest,
  type LocationTransport,
} from "./location-connector";

export * from "./types";
export * from "./evaluate";
export * from "./location-connector";
export { createMockLocationTransport, type MockLocationOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy exactly:
 * dev/alpha never make live calls; beta/prod may, but only with
 * SIGNALGRID_LIVE_INTEGRATIONS=true AND LOCATION_ACCESS_TOKEN. Otherwise fixture
 * mode — so location data (privacy-sensitive) is never fetched without explicit
 * opt-in on a promoted tier.
 */
export type LocationConnectorResolution =
  | { mode: "live"; connector: LocationServicesConnector }
  | { mode: "fixture"; reason: string };

export function resolveLocationServicesConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: LocationTransport,
): LocationConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.LOCATION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "LOCATION_ACCESS_TOKEN is not set" };
  }
  const config: LocationConnectorConfig = { accessToken, baseUrl: env.LOCATION_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new LocationServicesConnector(config, transportOverride ?? defaultLocationTransport) };
}

const defaultLocationTransport: LocationTransport = async (req: LocationRequest): Promise<LocationHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
