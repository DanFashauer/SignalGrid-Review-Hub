import {
  PasskeyAssuranceConnector,
  type PasskeyConnectorConfig,
  type PasskeyTransport,
} from "./passkey-assurance-connector";
import { PasskeyConnectorError, type PasskeyReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./passkey-assurance-connector";
export { createMockPasskeyTransport, type MockPasskeyOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * PASSKEY_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only IdP authentication-methods export describing one
 * identity's registered credential. SignalGrid consumes that reading; it never
 * registers, revokes, or reconfigures a passkey profile — those stay with the IdP
 * (docs/PASSKEY_ASSURANCE.md).
 */
export type PasskeyConnectorResolution =
  | { mode: "live"; connector: PasskeyAssuranceConnector }
  | { mode: "fixture"; reason: string };

export function resolvePasskeyConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PasskeyTransport,
): PasskeyConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.PASSKEY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "PASSKEY_ACCESS_TOKEN is not set" };
  }
  const config: PasskeyConnectorConfig = {
    accessToken,
    baseUrl: env.PASSKEY_BASE_URL?.trim() || "https://idp.local/authentication-methods",
    source: "passkey-idp-export",
  };
  return {
    mode: "live",
    connector: new PasskeyAssuranceConnector(config, transportOverride ?? makeDefaultPasskeyTransport(config.baseUrl)),
  };
}

/** Build a live IdP transport bound to a specific base URL (honors config). */
export function makeDefaultPasskeyTransport(baseUrl: string): PasskeyTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ identityRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(identityRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new PasskeyConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `passkey source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PasskeyConnectorError("bad_response", "passkey source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PasskeyConnectorError("bad_response", "passkey source returned a non-object body", res.status);
    }
    return body as PasskeyReportRaw;
  };
}
