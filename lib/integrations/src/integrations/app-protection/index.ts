// App-protection / MAM family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A MAM POLICY IS NOT MANAGING ONE. This family consumes the managed-app
// registration a MAM plane (Intune App Protection first; Jamf, Workspace ONE and
// their peers later) already keeps, and grades whether an app-protection policy is
// applied, clean and current for the app the worker is using. SignalGrid assigns no
// policy, wraps no app, and — the capability MAM is best known for — NEVER wipes one.

import {
  AppProtectionConnector,
  type AppProtectionConnectorConfig,
  type AppProtectionTransport,
} from "./app-protection-connector";
import { AppProtectionConnectorError, type AppProtectionReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./app-protection-connector";
export { createMockAppProtectionTransport, type MockAppProtectionOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true AND
 * APP_PROTECTION_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type AppProtectionConnectorResolution =
  | { mode: "live"; connector: AppProtectionConnector }
  | { mode: "fixture"; reason: string };

export function resolveAppProtectionConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AppProtectionTransport,
): AppProtectionConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.APP_PROTECTION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "APP_PROTECTION_ACCESS_TOKEN is not set" };
  }
  const config: AppProtectionConnectorConfig = {
    accessToken,
    baseUrl: env.APP_PROTECTION_BASE_URL?.trim() || "https://graph.microsoft.local/managedAppRegistrations",
    source: "app-protection-mam",
  };
  return {
    mode: "live",
    connector: new AppProtectionConnector(
      config,
      transportOverride ?? makeDefaultAppProtectionTransport(config.baseUrl),
    ),
  };
}

/** Build a live MAM transport bound to a specific base URL (honors config). */
export function makeDefaultAppProtectionTransport(baseUrl: string): AppProtectionTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ appRef, userRef, deviceRef, token }) => {
    // The query names the worker and device the registration is read FOR; the connector
    // still validates the returned record's own echo against them before normalizing.
    const query = `user=${encodeURIComponent(userRef)}&device=${encodeURIComponent(deviceRef)}`;
    const res = await fetch(`${root}/${encodeURIComponent(appRef)}?${query}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AppProtectionConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `app-protection source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AppProtectionConnectorError(
        "bad_response",
        "app-protection source returned a non-JSON body",
        res.status,
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AppProtectionConnectorError(
        "bad_response",
        "app-protection source returned a non-object body",
        res.status,
      );
    }
    return body as AppProtectionReportRaw;
  };
}
