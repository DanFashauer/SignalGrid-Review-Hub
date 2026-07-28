import {
  CustodyBeaconConnector,
  type CustodyBeaconConnectorConfig,
  type CustodyBeaconTransport,
} from "./custody-beacon-connector";
import { CustodyBeaconConnectorError, type CustodyBeaconReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./custody-beacon-connector";
export { createMockCustodyBeaconTransport, type MockCustodyBeaconOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * CUSTODY_BEACON_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only recovery-beacon network / asset tracker that has
 * already resolved a coarse zone reading. SignalGrid consumes that reading; it takes no
 * action of its own and never activates any recovery mechanism itself.
 */
export type CustodyBeaconConnectorResolution =
  | { mode: "live"; connector: CustodyBeaconConnector }
  | { mode: "fixture"; reason: string };

export function resolveCustodyBeaconConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: CustodyBeaconTransport,
): CustodyBeaconConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.CUSTODY_BEACON_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "CUSTODY_BEACON_ACCESS_TOKEN is not set" };
  }
  const config: CustodyBeaconConnectorConfig = {
    accessToken,
    baseUrl: env.CUSTODY_BEACON_BASE_URL?.trim() || "https://custody-beacon-network.local/custody-beacon",
    source: "custody-beacon-network",
  };
  return {
    mode: "live",
    connector: new CustodyBeaconConnector(config, transportOverride ?? makeDefaultCustodyBeaconTransport(config.baseUrl)),
  };
}

/** Build a live beacon-network transport bound to a specific base URL (honors config). */
export function makeDefaultCustodyBeaconTransport(baseUrl: string): CustodyBeaconTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new CustodyBeaconConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `beacon network returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new CustodyBeaconConnectorError("bad_response", "beacon network returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new CustodyBeaconConnectorError("bad_response", "beacon network returned a non-object body", res.status);
    }
    return body as CustodyBeaconReportRaw;
  };
}
