// SSE-egress family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING AN EDGE'S DEVICE STATUS IS NOT STEERING TRAFFIC. This family consumes
// what the deployment's Security Service Edge already knows about its client on
// one device (Zscaler Client Connector device status, Netskope client inventory,
// GlobalProtect are the reference shapes). SignalGrid routes no traffic, toggles
// no client, and edits no bypass rule — those stay with the SSE.

import {
  SseEgressConnector,
  type SseEgressConnectorConfig,
  type SseEgressTransport,
} from "./sse-egress-connector";
import { SseEgressConnectorError, type SseEgressReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./sse-egress-connector";
export { createMockSseEgressTransport, type MockSseEgressOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND SSE_EGRESS_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type SseEgressConnectorResolution =
  | { mode: "live"; connector: SseEgressConnector }
  | { mode: "fixture"; reason: string };

export function resolveSseEgressConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: SseEgressTransport,
): SseEgressConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.SSE_EGRESS_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "SSE_EGRESS_ACCESS_TOKEN is not set" };
  }
  const config: SseEgressConnectorConfig = {
    accessToken,
    baseUrl: env.SSE_EGRESS_BASE_URL?.trim() || "https://sse.local/device-status",
    source: "sse-egress-bridge",
  };
  return {
    mode: "live",
    connector: new SseEgressConnector(config, transportOverride ?? makeDefaultSseEgressTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultSseEgressTransport(baseUrl: string): SseEgressTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new SseEgressConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `sse-egress source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SseEgressConnectorError("bad_response", "sse-egress source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new SseEgressConnectorError("bad_response", "sse-egress source returned a non-object body", res.status);
    }
    return body as SseEgressReportRaw;
  };
}
