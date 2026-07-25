import {
  PacsAccessConnector,
  type PacsAccessConnectorConfig,
  type PacsAccessTransport,
} from "./pacs-access-connector";
import { PacsAccessConnectorError, type PacsAccessReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./pacs-access-connector";
export { createMockPacsAccessTransport, type MockPacsAccessOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND PACS_ACCESS_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only physical access-control bridge (Control iD /
 * ZKTeco-class controllers, HID readers, ZKBio / Verkada-class cloud access control)
 * that evaluates the controlled entry for the device — SignalGrid consumes that
 * evaluated result and opens no door, unlocks no turnstile, and revokes no credential.
 */
export type PacsAccessConnectorResolution =
  | { mode: "live"; connector: PacsAccessConnector }
  | { mode: "fixture"; reason: string };

export function resolvePacsAccessConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: PacsAccessTransport,
): PacsAccessConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.PACS_ACCESS_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "PACS_ACCESS_ACCESS_TOKEN is not set" };
  }
  const config: PacsAccessConnectorConfig = {
    accessToken,
    baseUrl: env.PACS_ACCESS_BASE_URL?.trim() || "https://pacs-access-bridge.local/pacs-access",
    source: "pacs-access-bridge",
  };
  return {
    mode: "live",
    connector: new PacsAccessConnector(config, transportOverride ?? makeDefaultPacsAccessTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultPacsAccessTransport(baseUrl: string): PacsAccessTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new PacsAccessConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PacsAccessConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new PacsAccessConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as PacsAccessReportRaw;
  };
}
