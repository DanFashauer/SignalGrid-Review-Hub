// Read-only normalization + transport for the custody-BEACON (asset-recovery) connector.
//
// The source is a recovery-beacon network / dedicated asset tracker that has already
// resolved a coarse zone reading and (out of band) the device's reachability. This
// connector normalizes that reading. Every operation is a read; there is no write path.
// Defensive normalization is ported from the agent-behavior connector: a beacon network
// is an external system and may emit anything in any slot, so the normalizer — not the
// compiler — is what makes a value safe, own-property reads only, malformed reports fail
// closed.

import {
  CUSTODY_BEACON_REPORT_KEYS,
  CustodyBeaconConnectorError,
  type BeaconFreshness,
  type BeaconZone,
  type CustodyBeaconReportRaw,
  type DeviceReachability,
  type NormalizedCustodyBeacon,
  type ReportIntegrity,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new CustodyBeaconConnectorError("read_only_violation", `custody beacon is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Did the report ASSERT something here that we could not parse? `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not read as a confirmation. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected transport returning a string
 *  must fail closed, not throw an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  // The Object.prototype exclusion is load-bearing (review finding): passing
  // Object.prototype itself as the report would let POLLUTED prototype fields
  // read as own assertions on a "plain" object.
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the PROTOTYPE
 *  CHAIN even though value reads are own-only: an inherited location assertion in a
 *  spelling we ignore is still an assertion, and this scan is the only thing that
 *  notices it. A symbol key counts; a class instance fails closed. */
function hasUnrecognizedKey(report: object, known: readonly string[]): boolean {
  try {
    let o: object | null = report;
    for (let depth = 0; o !== null && o !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(o)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      o = Object.getPrototypeOf(o) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

const ZONES = ["in_custody_zone", "departing", "off_premises", "unknown"] as const;
const FRESHNESS = ["fresh", "stale", "expired", "unknown"] as const;
const REACHABILITY = ["reachable", "unreachable", "unknown"] as const;

/** Normalize a beacon reading. Defensive throughout: a missing/errored field yields the
 *  fail-safe unknown, never a fabricated in-zone value. Reads are wrapped so a throwing
 *  accessor fails closed to malformed rather than escaping as an exception. */
export function normalizeReport(
  deviceRef: string,
  report: CustodyBeaconReportRaw,
  source = "custody-beacon-network",
): NormalizedCustodyBeacon {
  const plain = isPlainReport(report);
  let rawZone: unknown;
  let rawFreshness: unknown;
  let rawReachability: unknown;
  let readThrew = false;
  try {
    rawZone = plain ? ownValue(report, "zone") : undefined;
    rawFreshness = plain ? ownValue(report, "freshness") : undefined;
    rawReachability = plain ? ownValue(report, "reachability") : undefined;
  } catch {
    readThrew = true;
    rawZone = rawFreshness = rawReachability = undefined;
  }

  const zone = oneOf<BeaconZone>(rawZone, ZONES, "unknown");
  const freshness = oneOf<BeaconFreshness>(rawFreshness, FRESHNESS, "unknown");
  const reachability = oneOf<DeviceReachability>(rawReachability, REACHABILITY, "unknown");

  const malformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(report, CUSTODY_BEACON_REPORT_KEYS) ||
    enumMalformed(rawZone, ZONES) ||
    enumMalformed(rawFreshness, FRESHNESS) ||
    enumMalformed(rawReachability, REACHABILITY);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "custody-beacon",
    deviceRef,
    zone,
    freshness,
    reachability,
    reportIntegrity,
    source,
  };
}

export interface CustodyBeaconRequest {
  deviceRef: string;
  token: string;
}

export type CustodyBeaconTransport = (req: CustodyBeaconRequest) => Promise<CustodyBeaconReportRaw>;

export interface CustodyBeaconConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches a beacon reading for a device and normalizes it. */
export class CustodyBeaconConnector {
  constructor(
    private readonly config: CustodyBeaconConnectorConfig,
    private readonly transport: CustodyBeaconTransport,
  ) {}

  async fetchNormalized(deviceRef: string): Promise<NormalizedCustodyBeacon> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, token: this.config.accessToken });
    return normalizeReport(deviceRef, raw, this.config.source ?? "custody-beacon-network");
  }
}
