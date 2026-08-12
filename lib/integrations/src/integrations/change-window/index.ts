// Change-window family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A CHANGE RECORD IS NOT MANAGING ONE. This family consumes the change
// record an ITSM (ServiceNow, Jira Service Management, BMC, Cherwell and their
// peers) already keeps, and grades whether it authorizes what is happening now.
// SignalGrid raises no change, approves none, schedules none, closes none, and
// never writes a word back.

import {
  ChangeWindowConnector,
  type ChangeWindowConnectorConfig,
  type ChangeWindowTransport,
} from "./change-window-connector";
import { ChangeWindowConnectorError, type ChangeWindowReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./change-window-connector";
export { createMockChangeWindowTransport, type MockChangeWindowOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND CHANGE_WINDOW_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type ChangeWindowConnectorResolution =
  | { mode: "live"; connector: ChangeWindowConnector }
  | { mode: "fixture"; reason: string };

export function resolveChangeWindowConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ChangeWindowTransport,
): ChangeWindowConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.CHANGE_WINDOW_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "CHANGE_WINDOW_ACCESS_TOKEN is not set" };
  }
  const config: ChangeWindowConnectorConfig = {
    accessToken,
    baseUrl: env.CHANGE_WINDOW_BASE_URL?.trim() || "https://itsm.local/change-records",
    source: "change-window-itsm",
  };
  return {
    mode: "live",
    connector: new ChangeWindowConnector(
      config,
      transportOverride ?? makeDefaultChangeWindowTransport(config.baseUrl),
    ),
  };
}

/** Build a live ITSM transport bound to a specific base URL (honors config). */
export function makeDefaultChangeWindowTransport(baseUrl: string): ChangeWindowTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ changeRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(changeRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new ChangeWindowConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `change-window source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ChangeWindowConnectorError(
        "bad_response",
        "change-window source returned a non-JSON body",
        res.status,
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ChangeWindowConnectorError(
        "bad_response",
        "change-window source returned a non-object body",
        res.status,
      );
    }
    return body as ChangeWindowReportRaw;
  };
}
