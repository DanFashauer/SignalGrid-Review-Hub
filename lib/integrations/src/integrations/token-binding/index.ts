import {
  TokenBindingConnector,
  type TokenBindingConnectorConfig,
  type TokenBindingTransport,
} from "./token-binding-connector";
import { TokenBindingConnectorError, type TokenBindingReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./token-binding-connector";
export { createMockTokenBindingTransport, type MockTokenBindingOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND TOKEN_BINDING_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only token-inspection bridge that evaluates the
 * session's access token for the device (its DPoP/mTLS binding, PoP key protection
 * + attestation, audience restriction, and device binding) — SignalGrid consumes
 * that evaluated result and never mints/refreshes/revokes a token.
 */
export type TokenBindingConnectorResolution =
  | { mode: "live"; connector: TokenBindingConnector }
  | { mode: "fixture"; reason: string };

export function resolveTokenBindingConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: TokenBindingTransport,
): TokenBindingConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.TOKEN_BINDING_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "TOKEN_BINDING_ACCESS_TOKEN is not set" };
  }
  const config: TokenBindingConnectorConfig = {
    accessToken,
    baseUrl: env.TOKEN_BINDING_BASE_URL?.trim() || "https://token-binding-bridge.local/token-binding",
    source: "token-binding-bridge",
  };
  return {
    mode: "live",
    connector: new TokenBindingConnector(config, transportOverride ?? makeDefaultTokenBindingTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultTokenBindingTransport(baseUrl: string): TokenBindingTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new TokenBindingConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new TokenBindingConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new TokenBindingConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as TokenBindingReportRaw;
  };
}
