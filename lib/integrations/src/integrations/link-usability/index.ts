import {
  LinkUsabilityConnector,
  type LinkUsabilityConnectorConfig,
  type LinkUsabilityTransport,
} from "./link-usability-connector";
import { LinkUsabilityConnectorError, type LinkUsabilityReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./link-usability-connector";
export { createMockLinkUsabilityTransport, type MockLinkUsabilityOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * LINK_USABILITY_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only wireless controller or cloud dashboard (Meraki /
 * Mist / Aruba / Ruckus-class) that has already evaluated the client's connection
 * ladder, roaming behaviour and latency banding — SignalGrid consumes that evaluated
 * result and joins no network, steers no client, changes no radio setting, and
 * deauthenticates nobody.
 */
export type LinkUsabilityConnectorResolution =
  | { mode: "live"; connector: LinkUsabilityConnector }
  | { mode: "fixture"; reason: string };

export function resolveLinkUsabilityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: LinkUsabilityTransport,
): LinkUsabilityConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.LINK_USABILITY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "LINK_USABILITY_ACCESS_TOKEN is not set" };
  }
  const config: LinkUsabilityConnectorConfig = {
    accessToken,
    baseUrl: env.LINK_USABILITY_BASE_URL?.trim() || "https://wlan-bridge.local/link-usability",
    source: "link-usability-bridge",
  };
  return {
    mode: "live",
    connector: new LinkUsabilityConnector(
      config,
      transportOverride ?? makeDefaultLinkUsabilityTransport(config.baseUrl),
    ),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultLinkUsabilityTransport(baseUrl: string): LinkUsabilityTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new LinkUsabilityConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new LinkUsabilityConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new LinkUsabilityConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as LinkUsabilityReportRaw;
  };
}
