// Shift-context family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A SCHEDULE IS NOT MANAGING ONE. This family consumes the punch and shift
// record a workforce-management system (UKG, Dayforce, ADP and their peers) already
// keeps, and grades its coherence. SignalGrid punches nobody in or out, edits no
// schedule, computes no hours, and touches nothing payroll-adjacent.

import {
  ShiftContextConnector,
  type ShiftContextConnectorConfig,
  type ShiftContextTransport,
} from "./shift-context-connector";
import { ShiftContextConnectorError, type ShiftContextReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./shift-context-connector";
export { createMockShiftContextTransport, type MockShiftContextOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND SHIFT_CONTEXT_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type ShiftContextConnectorResolution =
  | { mode: "live"; connector: ShiftContextConnector }
  | { mode: "fixture"; reason: string };

export function resolveShiftContextConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ShiftContextTransport,
): ShiftContextConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.SHIFT_CONTEXT_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "SHIFT_CONTEXT_ACCESS_TOKEN is not set" };
  }
  const config: ShiftContextConnectorConfig = {
    accessToken,
    baseUrl: env.SHIFT_CONTEXT_BASE_URL?.trim() || "https://wfm.local/labor-records",
    source: "shift-context-wfm",
  };
  return {
    mode: "live",
    connector: new ShiftContextConnector(
      config,
      transportOverride ?? makeDefaultShiftContextTransport(config.baseUrl),
    ),
  };
}

/** Build a live WFM transport bound to a specific base URL (honors config). */
export function makeDefaultShiftContextTransport(baseUrl: string): ShiftContextTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ workerRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(workerRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new ShiftContextConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `shift-context source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ShiftContextConnectorError("bad_response", "shift-context source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ShiftContextConnectorError("bad_response", "shift-context source returned a non-object body", res.status);
    }
    return body as ShiftContextReportRaw;
  };
}
