// Read-only normalization + transport for the POLICY-BINDING connector.
//
// The source is a management plane's own report of one device's group/team
// binding: whether it is bound at all, whether its current binding matches what
// the plane's OWN rules derive from the device's observed properties (this
// connector never re-implements a vendor's grouping engine), the mismatch
// direction, and the group's membership hygiene. Every operation is a read;
// there is no write path — moving a device between groups stays with the
// management plane.
// Defensive normalization is ported from the custody-beacon connector: inventories
// are external systems and may emit anything in any slot, so the normalizer — not
// the compiler — is what makes a value safe; own-property reads only; malformed
// reports fail closed.

import {
  POLICY_BINDING_REPORT_KEYS,
  PolicyBindingConnectorError,
  type BindingState,
  type MembershipHygiene,
  type MismatchDirection,
  type NormalizedPolicyBinding,
  type PolicyBindingReportRaw,
  type ProfileMatch,
  type ReportIntegrity,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new PolicyBindingConnectorError("read_only_violation", `policy-binding is read-only; refused ${method}`);
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

const BINDINGS = ["bound", "unbound", "unknown"] as const;
const MATCHES = ["matched", "mismatched", "unknown"] as const;
const DIRECTIONS = ["wider", "narrower", "unknown"] as const;
const HYGIENES = ["clean", "mixed", "unknown"] as const;

/** Normalize one policy-binding report. Defensive throughout: a missing/errored
 *  field yields the fail-safe unknown, never a fabricated "matched". */
export function normalizeReport(
  deviceRef: string,
  report: PolicyBindingReportRaw,
  source = "policy-binding-inventory",
): NormalizedPolicyBinding {
  const plain = isPlainReport(report);
  let rawBinding: unknown;
  let rawMatch: unknown;
  let rawDirection: unknown;
  let rawHygiene: unknown;
  let readThrew = false;
  try {
    rawBinding = plain ? ownValue(report, "binding") : undefined;
    rawMatch = plain ? ownValue(report, "profile_match") : undefined;
    rawDirection = plain ? ownValue(report, "mismatch_direction") : undefined;
    rawHygiene = plain ? ownValue(report, "membership_hygiene") : undefined;
  } catch {
    readThrew = true;
    rawBinding = rawMatch = rawDirection = rawHygiene = undefined;
  }

  const binding = oneOf<BindingState>(rawBinding, BINDINGS, "unknown");
  const profileMatch = oneOf<ProfileMatch>(rawMatch, MATCHES, "unknown");
  const mismatchDirection = oneOf<MismatchDirection>(rawDirection, DIRECTIONS, "unknown");
  const membershipHygiene = oneOf<MembershipHygiene>(rawHygiene, HYGIENES, "unknown");

  const malformed =
    readThrew ||
    !plain ||
    hasUnrecognizedKey(report, POLICY_BINDING_REPORT_KEYS) ||
    enumMalformed(rawBinding, BINDINGS) ||
    enumMalformed(rawMatch, MATCHES) ||
    enumMalformed(rawDirection, DIRECTIONS) ||
    enumMalformed(rawHygiene, HYGIENES);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "policy-binding",
    deviceRef,
    binding,
    profileMatch,
    mismatchDirection,
    membershipHygiene,
    reportIntegrity,
    source,
  };
}

export interface PolicyBindingRequest {
  deviceRef: string;
  token: string;
}

export type PolicyBindingTransport = (req: PolicyBindingRequest) => Promise<PolicyBindingReportRaw>;

export interface PolicyBindingConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one device's binding report and normalizes it. */
export class PolicyBindingConnector {
  constructor(
    private readonly config: PolicyBindingConnectorConfig,
    private readonly transport: PolicyBindingTransport,
  ) {}

  async fetchNormalized(deviceRef: string): Promise<NormalizedPolicyBinding> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, token: this.config.accessToken });
    return normalizeReport(deviceRef, raw, this.config.source ?? "policy-binding-inventory");
  }
}
