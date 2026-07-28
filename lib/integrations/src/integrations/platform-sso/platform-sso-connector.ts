// Read-only normalization + transport for the PLATFORM-SSO connector.
//
// The source is an MDM inventory row or a grid-collected macOS report describing
// one Mac's Platform SSO state (registration, method, login-policy claim, offline
// grace, break-glass exemption) — already-resolved observations, never the app's
// or the user's claim about themselves. This connector normalizes that reading.
// Every operation is a read; there is no write path — enrollment, method choice,
// and policy deployment stay with the IdP extension and MDM.
// Defensive normalization is ported from the custody-beacon connector: inventories
// are external systems and may emit anything in any slot, so the normalizer — not
// the compiler — is what makes a value safe; own-property reads only; malformed
// reports fail closed.

import {
  PLATFORM_SSO_REPORT_KEYS,
  PlatformSsoConnectorError,
  type NormalizedPlatformSso,
  type PlatformSsoReportRaw,
  type PssoBreakGlass,
  type PssoLoginPolicy,
  type PssoMethod,
  type PssoOfflineGrace,
  type PssoRegistration,
  type ReportIntegrity,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new PlatformSsoConnectorError("read_only_violation", `platform-sso is read-only; refused ${method}`);
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
  return typeof report === "object" && report !== null && !Array.isArray(report);
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the PROTOTYPE
 *  CHAIN even though value reads are own-only: an inherited method assertion in a
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

const REGISTRATIONS = ["user", "device_only", "none", "unknown"] as const;
const METHODS = ["secure_enclave_key", "smart_card", "password_sync", "web_based", "none", "unknown"] as const;
const POLICIES = ["required", "not_required", "unknown"] as const;
const GRACES = ["valid", "expired", "not_configured", "unknown"] as const;
const BREAK_GLASS = ["exempt_configured", "none", "unknown"] as const;

/** Normalize one Platform SSO report. Defensive throughout: a missing/errored field
 *  yields the fail-safe unknown, never a fabricated registration or method. */
export function normalizeReport(
  deviceRef: string,
  report: PlatformSsoReportRaw,
  source = "platform-sso-inventory",
): NormalizedPlatformSso {
  const plain = isPlainReport(report);
  let rawRegistration: unknown;
  let rawMethod: unknown;
  let rawPolicy: unknown;
  let rawGrace: unknown;
  let rawBreakGlass: unknown;
  let readThrew = false;
  try {
    rawRegistration = plain ? ownValue(report, "registration") : undefined;
    rawMethod = plain ? ownValue(report, "method") : undefined;
    rawPolicy = plain ? ownValue(report, "login_policy") : undefined;
    rawGrace = plain ? ownValue(report, "offline_grace") : undefined;
    rawBreakGlass = plain ? ownValue(report, "break_glass") : undefined;
  } catch {
    readThrew = true;
    rawRegistration = rawMethod = rawPolicy = rawGrace = rawBreakGlass = undefined;
  }

  const registration = oneOf<PssoRegistration>(rawRegistration, REGISTRATIONS, "unknown");
  const method = oneOf<PssoMethod>(rawMethod, METHODS, "unknown");
  const loginPolicy = oneOf<PssoLoginPolicy>(rawPolicy, POLICIES, "unknown");
  const offlineGrace = oneOf<PssoOfflineGrace>(rawGrace, GRACES, "unknown");
  const breakGlass = oneOf<PssoBreakGlass>(rawBreakGlass, BREAK_GLASS, "unknown");

  const malformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(report, PLATFORM_SSO_REPORT_KEYS) ||
    enumMalformed(rawRegistration, REGISTRATIONS) ||
    enumMalformed(rawMethod, METHODS) ||
    enumMalformed(rawPolicy, POLICIES) ||
    enumMalformed(rawGrace, GRACES) ||
    enumMalformed(rawBreakGlass, BREAK_GLASS);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "platform-sso",
    deviceRef,
    registration,
    method,
    loginPolicy,
    offlineGrace,
    breakGlass,
    reportIntegrity,
    source,
  };
}

export interface PlatformSsoRequest {
  deviceRef: string;
  token: string;
}

export type PlatformSsoTransport = (req: PlatformSsoRequest) => Promise<PlatformSsoReportRaw>;

export interface PlatformSsoConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one Mac's Platform SSO state and normalizes it. */
export class PlatformSsoConnector {
  constructor(
    private readonly config: PlatformSsoConnectorConfig,
    private readonly transport: PlatformSsoTransport,
  ) {}

  async fetchNormalized(deviceRef: string): Promise<NormalizedPlatformSso> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, token: this.config.accessToken });
    return normalizeReport(deviceRef, raw, this.config.source ?? "platform-sso-inventory");
  }
}
