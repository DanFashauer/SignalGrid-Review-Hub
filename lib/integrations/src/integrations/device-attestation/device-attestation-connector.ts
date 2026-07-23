// Read-only normalization + transport for the hardware-rooted attestation connector.
//
// The source is a bridge that has already performed the X.509 verification of the
// Managed Device Attestation chain to Apple's Enterprise Attestation Root CA and
// decoded the leaf OIDs (SIP / secure-boot / kext / freshness). This connector
// normalizes that already-verified result. It does NOT re-do the crypto — that is
// the bridge's job (swift-certificates / a Node X.509 lib against the pinned Apple
// root). Every operation here is a read; there is no write path.

import {
  AttestationConnectorError,
  type AttestationReportRaw,
  type AttestedControl,
  type AttestedSecureBoot,
  type AttestationChain,
  type AttestationFreshness,
  type NormalizedAttestation,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new AttestationConnectorError("read_only_violation", `device attestation is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

function readableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s === "") return null;
  const lower = s.toLowerCase();
  if (lower.startsWith("not found") || lower.startsWith("unavailable") || lower.startsWith("error")) return null;
  return s;
}

/** Normalize an attestation-bridge report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown, never a fabricated "verified"/"on". */
export function normalizeReport(
  deviceId: string,
  report: AttestationReportRaw,
  source = "attestation-bridge",
): NormalizedAttestation {
  return {
    sourceSystem: "device-attestation",
    deviceId,
    // Only an explicit boolean is trusted; anything else is null (capability
    // unknown → attestation is still expected, per evaluate()).
    attestable: typeof report.attestable === "boolean" ? report.attestable : null,
    chain: oneOf<AttestationChain>(report.chain, ["verified", "unverifiable", "unknown"], "unknown"),
    freshness: oneOf<AttestationFreshness>(report.freshness, ["fresh", "stale", "unknown"], "unknown"),
    attestedSip: oneOf<AttestedControl>(report.sip, ["on", "off", "unknown"], "unknown"),
    attestedSecureBoot: oneOf<AttestedSecureBoot>(report.secureBoot, ["full", "reduced", "permissive", "unknown"], "unknown"),
    attestedKextAllowed: typeof report.thirdPartyKextAllowed === "boolean" ? report.thirdPartyKextAllowed : null,
    attestedSerial: readableString(report.serial),
    attestedOsVersion: readableString(report.osVersion),
    source,
  };
}

export interface AttestationReportRequest {
  deviceId: string;
  token: string;
}

/** Fetch one device's verified attestation from a bridge. Injectable so
 *  tests/fixtures never touch the network. */
export type AttestationReportTransport = (req: AttestationReportRequest) => Promise<AttestationReportRaw>;

export interface AttestationConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

export class DeviceAttestationConnector {
  constructor(
    private readonly config: AttestationConnectorConfig,
    private readonly transport: AttestationReportTransport,
  ) {}

  async healthCheck(deviceId: string): Promise<{ healthy: boolean; status: number }> {
    try {
      await this.transport({ deviceId, token: this.config.accessToken });
      return { healthy: true, status: 200 };
    } catch (err) {
      const status = err instanceof AttestationConnectorError ? err.status : 0;
      return { healthy: false, status };
    }
  }

  async fetchAttestation(deviceId: string): Promise<NormalizedAttestation> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source);
  }
}
