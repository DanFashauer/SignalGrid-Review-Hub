import {
  CarrierReachabilityConnector,
  type CarrierConnectorConfig,
  type CarrierHttpResponse,
  type CarrierRequest,
  type CarrierTransport,
} from "./reachability-connector";

export * from "./types";
export * from "./evaluate";
export * from "./reachability-connector";
export { createMockCarrierTransport, type MockCarrierOptions } from "./mock-transport";

/**
 * Gated resolution of the read-only carrier reachability connector, mirroring the
 * product's live-integration policy exactly: dev and alpha NEVER make live vendor
 * calls; beta and prod may, but ONLY when SIGNALGRID_LIVE_INTEGRATIONS is "true"
 * AND a read-only token is configured. In every other case this returns
 * `{ mode: "fixture" }` and the caller reads committed fixtures instead — so CI
 * and the lower tiers stay deterministic and offline, and no external call is ever
 * made without explicit opt-in.
 */
export type CarrierConnectorResolution =
  | { mode: "live"; connector: CarrierReachabilityConnector }
  | { mode: "fixture"; reason: string };

export function resolveCarrierReachabilityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: CarrierTransport,
): CarrierConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  const liveTier = tier === "beta" || tier === "prod";
  if (!liveTier) {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.CARRIER_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "CARRIER_ACCESS_TOKEN is not set" };
  }
  const config: CarrierConnectorConfig = {
    accessToken,
    baseUrl: env.CARRIER_BASE_URL?.trim() || undefined,
  };
  return {
    mode: "live",
    connector: new CarrierReachabilityConnector(config, transportOverride ?? defaultCarrierTransport),
  };
}

/** Real transport: a GET with a hard timeout so a hung platform can't stall a caller. */
const defaultCarrierTransport: CarrierTransport = async (req: CarrierRequest): Promise<CarrierHttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
