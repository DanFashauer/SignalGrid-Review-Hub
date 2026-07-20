import {
  RtlsCustodyConnector,
  type RtlsConnectorConfig,
  type RtlsHttpResponse,
  type RtlsRequest,
  type RtlsTransport,
} from "./rtls-connector";

export * from "./types";
export * from "./evaluate";
export * from "./rtls-connector";
export { createMockRtlsTransport, type MockRtlsOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND RTLS_ACCESS_TOKEN. Otherwise fixture mode. Integration targets in this
 * shape: CenTrak, Stanley Healthcare / HID AeroScout, Zebra MotionWorks, Sonitor,
 * Cisco Spaces (DNA Spaces), Kontakt.io.
 */
export type RtlsConnectorResolution =
  | { mode: "live"; connector: RtlsCustodyConnector }
  | { mode: "fixture"; reason: string };

export function resolveRtlsCustodyConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: RtlsTransport,
): RtlsConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.RTLS_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "RTLS_ACCESS_TOKEN is not set" };
  }
  const config: RtlsConnectorConfig = { accessToken, baseUrl: env.RTLS_BASE_URL?.trim() || undefined };
  return { mode: "live", connector: new RtlsCustodyConnector(config, transportOverride ?? defaultRtlsTransport) };
}

const defaultRtlsTransport: RtlsTransport = async (req: RtlsRequest): Promise<RtlsHttpResponse> => {
  const res = await fetch(req.url, { method: req.method, headers: req.headers, signal: AbortSignal.timeout(10000) });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
