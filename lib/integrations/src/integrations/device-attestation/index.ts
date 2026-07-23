import {
  DeviceAttestationConnector,
  type AttestationConnectorConfig,
  type AttestationReportTransport,
} from "./device-attestation-connector";
import { AttestationConnectorError, type AttestationReportRaw } from "./types";

export * from "./types";
export * from "./evaluate";
export * from "./device-attestation-connector";
export { createMockAttestationTransport, type MockAttestationOptions } from "./mock-transport";

/**
 * Gated resolution, mirroring the product's live-integration policy: dev/alpha
 * never make live calls; beta/prod may, but only with SIGNALGRID_LIVE_INTEGRATIONS
 * =true AND DEVICE_ATTESTATION_ACCESS_TOKEN. Otherwise fixture mode.
 *
 * The "live" source is a read-only bridge that verifies the Managed Device
 * Attestation chain to Apple's Enterprise Attestation Root CA and decodes the leaf
 * OIDs — SignalGrid consumes the verified result.
 */
export type AttestationConnectorResolution =
  | { mode: "live"; connector: DeviceAttestationConnector }
  | { mode: "fixture"; reason: string };

export function resolveAttestationConnector(
  env: NodeJS.ProcessEnv = process.env,
  transportOverride?: AttestationReportTransport,
): AttestationConnectorResolution {
  const tier = (env.SIGNALGRID_TIER ?? "dev").toLowerCase();
  if (tier !== "beta" && tier !== "prod") {
    return { mode: "fixture", reason: `tier "${tier}" never makes live vendor calls` };
  }
  if (env.SIGNALGRID_LIVE_INTEGRATIONS !== "true") {
    return { mode: "fixture", reason: "SIGNALGRID_LIVE_INTEGRATIONS is not 'true'" };
  }
  const accessToken = env.DEVICE_ATTESTATION_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    return { mode: "fixture", reason: "DEVICE_ATTESTATION_ACCESS_TOKEN is not set" };
  }
  const config: AttestationConnectorConfig = {
    accessToken,
    baseUrl: env.DEVICE_ATTESTATION_BASE_URL?.trim() || "https://attestation-bridge.local/device-attestation",
    source: "attestation-bridge",
  };
  return {
    mode: "live",
    connector: new DeviceAttestationConnector(config, transportOverride ?? makeDefaultAttestationTransport(config.baseUrl)),
  };
}

/** Build a live bridge transport bound to a specific base URL (honors config). */
export function makeDefaultAttestationTransport(baseUrl: string): AttestationReportTransport {
  const root = baseUrl.replace(/\/+$/, "");
  return async ({ deviceId, token }) => {
    const res = await fetch(`${root}/${encodeURIComponent(deviceId)}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new AttestationConnectorError(
        res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error",
        `bridge returned ${res.status}`,
        res.status,
      );
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AttestationConnectorError("bad_response", "bridge returned a non-JSON body", res.status);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new AttestationConnectorError("bad_response", "bridge returned a non-object body", res.status);
    }
    return body as AttestationReportRaw;
  };
}
