import {
  GraphPostureConnector,
  type GraphConnectorConfig,
  type GraphHttpResponse,
  type GraphRequest,
  type GraphTransport,
} from "./posture-connector";

export * from "./types";
export * from "./posture-connector";
export { createMockGraphTransport, type MockGraphOptions } from "./mock-transport";

/**
 * Gated resolution of the read-only Graph posture connector, mirroring the
 * product's live-integration policy exactly: dev and alpha NEVER make live
 * vendor calls; beta and prod may, but ONLY when SIGNALGRID_LIVE_INTEGRATIONS is
 * "true" AND a read-only access token is configured. In every other case this
 * returns `{ mode: "fixture" }` and the caller reads committed fixtures instead —
 * so CI and the lower tiers stay deterministic and offline, and no external call
 * is ever made without explicit opt-in.
 */
export type GraphConnectorResolution =
  | { mode: "live"; connector: GraphPostureConnector }
  | { mode: "fixture"; reason: string };

export function resolveGraphPostureConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: GraphTransport,
): GraphConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  const liveTier = tier === "beta" || tier === "prod";
  if (!liveTier) {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.GRAPH_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "GRAPH_ACCESS_TOKEN is not set" };
  }
  const config: GraphConnectorConfig = {
    accessToken,
    baseUrl: env.GRAPH_BASE_URL?.trim() || undefined,
  };
  return {
    mode: "live",
    connector: new GraphPostureConnector(config, transportOverride ?? defaultGraphTransport),
  };
}

/** Real transport: a GET with a hard timeout so a hung Graph can't stall a caller. */
const defaultGraphTransport: GraphTransport = async (req: GraphRequest): Promise<GraphHttpResponse> => {
  const res = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    signal: AbortSignal.timeout(10000),
  });
  return { status: res.status, ok: res.ok, json: () => res.json() };
};
