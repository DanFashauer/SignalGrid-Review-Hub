import {
  OAuthConsentConnector,
  type OAuthConsentConnectorConfig,
  type OAuthConsentTransport,
} from "./oauth-consent-connector";
import { OAuthConsentConnectorError, type OAuthConsentReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./oauth-consent-connector";
export { createMockOAuthConsentTransport, type MockOAuthConsentOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND OAUTH_CONSENT_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only OAuth/consent-governance bridge (Microsoft Entra
 * enterprise apps / OAuth grants, Okta OAuth, Google Workspace app access) that
 * evaluates the riskiest delegated grant on the principal — SignalGrid consumes it.
 */
export type OAuthConsentConnectorResolution =
  | { mode: "live"; connector: OAuthConsentConnector }
  | { mode: "fixture"; reason: string };

export function resolveOAuthConsentConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: OAuthConsentTransport,
): OAuthConsentConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.OAUTH_CONSENT_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "OAUTH_CONSENT_ACCESS_TOKEN is not set" };
  }
  const config: OAuthConsentConnectorConfig = {
    accessToken,
    baseUrl: env.OAUTH_CONSENT_BASE_URL?.trim() || "https://oauth-consent-bridge.local/oauth-consent",
    source: "oauth-consent-bridge",
  };
  return {
    mode: "live",
    connector: new OAuthConsentConnector(config, transportOverride ?? makeDefaultOAuthConsentTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultOAuthConsentTransport(baseUrl: string): OAuthConsentTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ principalId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(principalId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new OAuthConsentConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new OAuthConsentConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new OAuthConsentConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as OAuthConsentReportRaw;
  };
}
