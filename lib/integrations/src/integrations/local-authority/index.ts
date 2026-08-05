// Local-authority family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A DEVICE'S STATE REPORT IS NOT UNLOCKING, ISSUING OR REVOKING ANYTHING.
// This family consumes a report about one device — whether its protected store is
// readable, whether a human has authenticated since boot, when its offline grant
// was minted and how long that grant permits — and grades whether the device may
// act on its own authority. It unlocks nothing, mints no grant, rotates no key,
// sends no management command, and never wipes or locks. Issuing and revoking
// local authority is the owning system's job; deciding whether to believe what it
// reports is ours.

import { LocalAuthorityConnectorError, type LocalAuthorityReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./normalize";

/** Injected so every test and the proof drive the SAME code path the live call
 *  uses. A transport the tests replace wholesale would leave the real one never
 *  executed — the defect the shared live-gate harness exists to catch. */
export type LocalAuthorityTransport = (args: {
  deviceRef: string;
  token: string;
}) => Promise<LocalAuthorityReportRaw>;

export type LocalAuthorityResolution =
  | { mode: "live"; fetchState: (deviceRef: string) => Promise<LocalAuthorityReportRaw> }
  | { mode: "fixture"; reason: string };

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with
 * SIGNALGRID_LIVE_INTEGRATIONS=true AND LOCAL_AUTHORITY_TOKEN. Otherwise fixture
 * mode. Every gate is checked INDEPENDENTLY so removing any one of them falls
 * back to fixtures — proven by the shared live-gate harness rather than asserted
 * here.
 */
export function resolveLocalAuthorityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: LocalAuthorityTransport,
): LocalAuthorityResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const token = env.LOCAL_AUTHORITY_TOKEN?.trim();
  if (!token) {
    return { mode: "fixture", reason: "LOCAL_AUTHORITY_TOKEN is not set" };
  }
  const baseUrl = env.LOCAL_AUTHORITY_BASE_URL?.trim() || "https://edge.local/v1/devices";
  const transport = transportOverride ?? makeDefaultLocalAuthorityTransport(baseUrl);
  return { mode: "live", fetchState: (deviceRef) => transport({ deviceRef, token }) };
}

/** Build a live device-state transport bound to a specific base URL. */
export function makeDefaultLocalAuthorityTransport(baseUrl: string): LocalAuthorityTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}/local-authority`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new LocalAuthorityConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `local-authority source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new LocalAuthorityConnectorError(
        "bad_response",
        "local-authority source returned a non-JSON body",
        res.status,
      );
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new LocalAuthorityConnectorError(
        "bad_response",
        "local-authority source returned a non-object body",
        res.status,
      );
    }
    return body as LocalAuthorityReportRaw;
  };
}

/** Deterministic fixtures — the shapes a reviewer should be able to reproduce.
 *  The second is the headline case: everything looks healthy and the device
 *  cannot read its own credentials. */
export const DEMO_LOCAL_AUTHORITY_RECORDS: Readonly<Record<string, LocalAuthorityReportRaw>> = {
  "ipad.ward.7a": {
    deviceRef: "ipad.ward.7a",
    protectedDataState: "available",
    localAuthState: "verified",
    clockConfidence: "trusted",
    grantIssuedAt: "2026-01-01T06:00:00.000Z",
    maxDisconnectedSeconds: 43200,
    source: "demo-edge",
    observedAt: "2026-01-01T08:00:00.000Z",
  },
  "ipad.ward.7b-rebooted": {
    deviceRef: "ipad.ward.7b-rebooted",
    protectedDataState: "awaiting_first_unlock",
    localAuthState: "not_verified",
    clockConfidence: "trusted",
    grantIssuedAt: "2026-01-01T06:00:00.000Z",
    maxDisconnectedSeconds: 43200,
    source: "demo-edge",
    observedAt: "2026-01-01T08:00:00.000Z",
  },
  "ipad.dock.spare": {
    deviceRef: "ipad.dock.spare",
    protectedDataState: "available",
    localAuthState: "verified",
    clockConfidence: "device_asserted",
    grantIssuedAt: "2026-01-01T06:00:00.000Z",
    maxDisconnectedSeconds: 43200,
    source: "demo-edge",
    observedAt: "2026-01-01T08:00:00.000Z",
  },
};
