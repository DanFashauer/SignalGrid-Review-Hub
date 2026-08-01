// Challenge-capability family — public surface and live-call gate.
//
// Under connector discipline from birth: tier gate + SIGNALGRID_LIVE_INTEGRATIONS +
// credential + injected transport, deterministic fixture mode, proof, and no write
// path of any kind.
//
// READING A CAPABILITY INVENTORY IS NOT RUNNING A CHALLENGE. This family consumes
// what an MFA platform / UEM already knows about a device+worker pair's enrolled
// methods, present authenticators, and client health (HID DigitalPersona's AD/LDS
// inventory and Entra's authentication-methods registry are the reference shapes).
// SignalGrid enrolls no credential, installs no client, and executes no ceremony —
// challenge execution stays with the HOST app.

import {
  ChallengeCapabilityConnector,
  type ChallengeCapabilityConnectorConfig,
  type ChallengeCapabilityTransport,
} from "./challenge-capability-connector";
import { ChallengeCapabilityConnectorError, type ChallengeCapabilityReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./challenge-capability-connector";
export { createMockChallengeCapabilityTransport, type MockChallengeCapabilityOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha never
 * make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS=true
 * AND CHALLENGE_CAPABILITY_ACCESS_TOKEN. Otherwise fixture mode.
 */
export type ChallengeCapabilityConnectorResolution =
  | { mode: "live"; connector: ChallengeCapabilityConnector }
  | { mode: "fixture"; reason: string };

export function resolveChallengeCapabilityConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: ChallengeCapabilityTransport,
): ChallengeCapabilityConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.CHALLENGE_CAPABILITY_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "CHALLENGE_CAPABILITY_ACCESS_TOKEN is not set" };
  }
  const config: ChallengeCapabilityConnectorConfig = {
    accessToken,
    baseUrl: env.CHALLENGE_CAPABILITY_BASE_URL?.trim() || "https://mfa.local/capability-records",
    source: "challenge-capability-bridge",
  };
  return {
    mode: "live",
    connector: new ChallengeCapabilityConnector(
      config,
      transportOverride ?? makeDefaultChallengeCapabilityTransport(config.baseUrl),
    ),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultChallengeCapabilityTransport(baseUrl: string): ChallengeCapabilityTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceRef, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceRef)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new ChallengeCapabilityConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `challenge-capability source returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ChallengeCapabilityConnectorError("bad_response", "challenge-capability source returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new ChallengeCapabilityConnectorError("bad_response", "challenge-capability source returned a non-object body", res.status);
    }
    return body as ChallengeCapabilityReportRaw;
  };
}
