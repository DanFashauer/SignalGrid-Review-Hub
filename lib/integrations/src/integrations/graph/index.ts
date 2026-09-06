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
export {
  createFixtureGraphPostureConnector,
  FIXTURE_GRAPH_TOKEN,
  FIXTURE_GRAPH_USERS,
  FIXTURE_GRAPH_RISKY_USERS,
  FIXTURE_GRAPH_DEVICES,
} from "./fixtures";

import { createFixtureGraphPostureConnector } from "./fixtures";

/**
 * Gated resolution of the read-only Graph posture connector, mirroring the
 * product's live-integration policy exactly: dev and alpha NEVER make live
 * vendor calls; beta and prod may, but ONLY when SIGNALGRID_LIVE_INTEGRATIONS is
 * "true" AND a read-only access token is configured. In every other case this
 * returns `{ mode: "fixture" }` — and, since the launch-seam work, a WORKING
 * connector over the committed fixture dataset, so a fixture-mode caller runs
 * the same sync → normalize → decide pipeline a live one does, deterministic and
 * offline. `mode` remains the source of truth for what the data IS: a fixture
 * connector serves synthetic posture, never a tenant's.
 */
export type GraphConnectorResolution =
  | { mode: "live"; connector: GraphPostureConnector }
  | { mode: "fixture"; reason: string; connector: GraphPostureConnector };

export function resolveGraphPostureConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: GraphTransport,
): GraphConnectorResolution {
  const fixture = (reason: string): GraphConnectorResolution => ({
    mode: "fixture",
    reason,
    connector: createFixtureGraphPostureConnector(),
  });
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  const liveTier = tier === "beta" || tier === "prod";
  if (!liveTier) {
    return fixture(`tier "${tier}" never makes live vendor calls`);
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return fixture("SIGNALGRID_LIVE_INTEGRATIONS is not 'true'");
  }
  const accessToken = env.GRAPH_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return fixture("GRAPH_ACCESS_TOKEN is not set");
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
