import {
  PlatformSsoConnector,
  type PlatformSsoConnectorConfig,
  type PlatformSsoTransport,
} from "./platform-sso-connector";
import { PlatformSsoConnectorError, type PlatformSsoReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./platform-sso-connector";
export { createMockPlatformSsoTransport, type MockPlatformSsoOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * PLATFORM_SSO_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only MDM inventory / grid-collected view of each Mac's
 * Platform SSO state. SignalGrid consumes that reading; it never enrolls, chooses a
 * method, or deploys a policy — those stay with the IdP extension and MDM
 * (docs/PLATFORM_SSO.md).
 */
export type PlatformSsoConnectorResolution =
  | { mode: "live"; connector: PlatformSsoConnector }
  | { mode: "fixture"; reason: string };

export function resolvePlatformSsoConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PlatformSsoTransport,
): PlatformSsoConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.PLATFORM_SSO_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "PLATFORM_SSO_ACCESS_TOKEN is not set" };
  }
  const config: PlatformSsoConnectorConfig = {
    accessToken,
    baseUrl: env.PLATFORM_SSO_BASE_URL?.trim() || "https://platform-sso-inventory.local/platform-sso",
    source: "platform-sso-inventory",
  };
  return {
    mode: "live",
    connector: new PlatformSsoConnector(config, transportOverride ?? makeDefaultPlatformSsoTransport(config.baseUrl)),
  };
}

/** Build a live inventory transport bound to a specific base URL (honors config). */
export function makeDefaultPlatformSsoTransport(baseUrl: string): PlatformSsoTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new PlatformSsoConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `platform-sso source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PlatformSsoConnectorError("bad_response", "platform-sso source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PlatformSsoConnectorError("bad_response", "platform-sso source returned a non-object body", res.status);
    }
    return body as PlatformSsoReportRaw;
  };
}
