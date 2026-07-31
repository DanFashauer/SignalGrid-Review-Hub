// Bootstrap-credential family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A CREDENTIAL RECORD IS NOT MANAGING ONE. This family consumes the
// session-credential record an identity provider already keeps (Entra Temporary
// Access Pass and its peers are the reference shape) and grades its coherence.
// SignalGrid issues no pass, revokes no pass, extends no lifetime, and enrolls
// no authenticator.

import {
  BootstrapCredentialConnector,
  type BootstrapCredentialConnectorConfig,
  type BootstrapCredentialTransport,
} from "./bootstrap-credential-connector";
import { BootstrapCredentialConnectorError, type BootstrapCredentialReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./bootstrap-credential-connector";
export { createMockBootstrapCredentialTransport, type MockBootstrapCredentialOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND BOOTSTRAP_CREDENTIAL_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type BootstrapCredentialConnectorResolution =
  | { mode: "live"; connector: BootstrapCredentialConnector }
  | { mode: "fixture"; reason: string };

export function resolveBootstrapCredentialConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: BootstrapCredentialTransport,
): BootstrapCredentialConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.BOOTSTRAP_CREDENTIAL_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "BOOTSTRAP_CREDENTIAL_ACCESS_TOKEN is not set" };
  }
  const config: BootstrapCredentialConnectorConfig = {
    accessToken,
    baseUrl: env.BOOTSTRAP_CREDENTIAL_BASE_URL?.trim() || "https://idp.local/credential-records",
    source: "bootstrap-credential-idp",
  };
  return {
    mode: "live",
    connector: new BootstrapCredentialConnector(
      config,
      transportOverride ?? makeDefaultBootstrapCredentialTransport(config.baseUrl),
    ),
  };
}

/** Build a live IdP transport bound to a specific base URL (honors config). */
export function makeDefaultBootstrapCredentialTransport(baseUrl: string): BootstrapCredentialTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ subjectRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(subjectRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new BootstrapCredentialConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bootstrap-credential source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new BootstrapCredentialConnectorError("bad_response", "bootstrap-credential source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new BootstrapCredentialConnectorError("bad_response", "bootstrap-credential source returned a non-object body", res.status);
    }
    return body as BootstrapCredentialReportRaw;
  };
}
