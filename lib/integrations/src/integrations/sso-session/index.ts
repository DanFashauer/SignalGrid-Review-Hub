import {
  SsoSessionConnector,
  type SsoSessionConnectorConfig,
  type SsoSessionTransport,
} from "./sso-session-connector";
import { SsoSessionConnectorError, type SsoSessionReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./sso-session-connector";
export { createMockSsoSessionTransport, type MockSsoSessionOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND SSO_SESSION_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only IdP session-state bridge (Microsoft Entra,
 * Okta, Ping, Duo, …) that evaluates the live session for the device and compares
 * its subject to the checked-out badge-holder — SignalGrid consumes that result.
 */
export type SsoSessionConnectorResolution =
  | { mode: "live"; connector: SsoSessionConnector }
  | { mode: "fixture"; reason: string };

export function resolveSsoSessionConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: SsoSessionTransport,
): SsoSessionConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.SSO_SESSION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "SSO_SESSION_ACCESS_TOKEN is not set" };
  }
  const config: SsoSessionConnectorConfig = {
    accessToken,
    baseUrl: env.SSO_SESSION_BASE_URL?.trim() || "https://sso-session-bridge.local/sso-session",
    source: "sso-session-bridge",
  };
  return {
    mode: "live",
    connector: new SsoSessionConnector(config, transportOverride ?? makeDefaultSsoSessionTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultSsoSessionTransport(baseUrl: string): SsoSessionTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new SsoSessionConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new SsoSessionConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new SsoSessionConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as SsoSessionReportRaw;
  };
}
