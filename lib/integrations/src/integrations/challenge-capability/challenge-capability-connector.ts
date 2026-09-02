// Read-only normalization + transport for the CHALLENGE-CAPABILITY connector.
//
// The source is an MFA platform's / UEM's already-evaluated inventory of what a
// step-up could actually use on one device+worker pair. Every operation is a
// read; there is no write path — SignalGrid enrolls no credential, installs no
// client, and executes no ceremony.
//
// Defensive normalization ported from the bootstrap-credential connector: the
// bridge is an external system and may emit anything in any slot, so the
// normalizer — not the compiler — makes values safe. Own-property reads only;
// a report that asserts something unreadable is `malformed` and can never
// grade READY. Absence of a method entry is preserved as absence — the
// evaluator, not the normalizer, decides what absence means (never capability).

import {
  CHALLENGE_CAPABILITY_REPORT_KEYS,
  CHALLENGE_METHOD_ENTRY_KEYS,
  CHALLENGE_METHODS,
  ChallengeCapabilityConnectorError,
  MAX_METHOD_ENTRIES,
  type ChallengeCapabilityReportRaw,
  type ChallengeMethod,
  type ChallengeReportIntegrity,
  type MethodStanding,
  type NormalizedChallengeCapability,
} from "./types";
import { createReadOnlyGuard } from "../../utils/guardReadOnly";

/** GET-only guard, mirroring the other connectors. */
export const guardReadOnly = createReadOnlyGuard(
  (method) => new ChallengeCapabilityConnectorError("read_only_violation", `challenge-capability is read-only; refused ${method}`),
);

/** Only an explicit boolean is trusted; null/undefined = not reported. */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Did the entry ASSERT a non-boolean in a boolean slot? `null` counts as absent. */
function boolMalformed(v: unknown): boolean {
  return v !== undefined && v !== null && typeof v !== "boolean";
}

/** Read a field ONLY if the object asserts it as an OWN property. */
function ownValue(o: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(o, key) ? (o as Record<string, unknown>)[key] : undefined;
}

function isPlainObject(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v !== Object.prototype;
}

const MAX_PROTOTYPE_DEPTH = 64;

/** Does the object carry any key outside `known`? Walks the prototype chain even
 *  though value reads are own-only. */
function hasUnrecognizedKey(o: object, known: readonly string[]): boolean {
  try {
    let cur: object | null = o;
    for (let depth = 0; cur !== null && cur !== Object.prototype; depth += 1) {
      if (depth >= MAX_PROTOTYPE_DEPTH) return true;
      for (const k of Reflect.ownKeys(cur)) {
        if (depth > 0) return true;
        if (typeof k === "symbol") return true;
        if (!known.includes(k)) return true;
      }
      cur = Object.getPrototypeOf(cur) as object | null;
    }
    return false;
  } catch {
    return true;
  }
}

/** A trimmed non-empty string, or null. Never a fabricated placeholder. */
function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

export interface ChallengeNormalizeOptions {
  source?: string;
}

/** Normalize one capability report. A missing/errored field yields the fail-safe
 *  absence, never a fabricated capability. */
export function normalizeChallengeReport(
  deviceRef: string,
  report: ChallengeCapabilityReportRaw,
  opts: ChallengeNormalizeOptions = {},
): NormalizedChallengeCapability {
  const source = opts.source ?? "challenge-capability-bridge";
  const plain = isPlainObject(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of CHALLENGE_CAPABILITY_REPORT_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of CHALLENGE_CAPABILITY_REPORT_KEYS) raw[k] = undefined;
  }

  let entriesMalformed = false;
  const methods: MethodStanding[] = [];
  const methodsRaw = raw["methods"];
  if (methodsRaw !== undefined && methodsRaw !== null) {
    if (!Array.isArray(methodsRaw) || methodsRaw.length > MAX_METHOD_ENTRIES) {
      entriesMalformed = true;
    } else {
      const seen = new Set<string>();
      for (const entry of methodsRaw) {
        if (!isPlainObject(entry) || hasUnrecognizedKey(entry, CHALLENGE_METHOD_ENTRY_KEYS)) {
          entriesMalformed = true;
          continue;
        }
        let name: unknown;
        let enrolledRaw: unknown;
        let presentRaw: unknown;
        let healthyRaw: unknown;
        try {
          name = ownValue(entry, "method");
          enrolledRaw = ownValue(entry, "enrolled");
          presentRaw = ownValue(entry, "authenticator_present");
          healthyRaw = ownValue(entry, "client_healthy");
        } catch {
          entriesMalformed = true;
          continue;
        }
        const method = typeof name === "string" ? name.trim().toLowerCase() : "";
        if (!(CHALLENGE_METHODS as readonly string[]).includes(method)) {
          // An unrecognized method name is an assertion we cannot read — never
          // silently dropped into "this method was not reported".
          entriesMalformed = true;
          continue;
        }
        if (seen.has(method)) {
          // Two claims about one fact — a contradiction risk, not extra data.
          entriesMalformed = true;
          continue;
        }
        seen.add(method);
        if (boolMalformed(enrolledRaw) || boolMalformed(presentRaw) || boolMalformed(healthyRaw)) {
          entriesMalformed = true;
        }
        methods.push({
          method: method as ChallengeMethod,
          enrolled: boolOrNull(enrolledRaw),
          authenticatorPresent: boolOrNull(presentRaw),
          clientHealthy: boolOrNull(healthyRaw),
        });
      }
    }
  }

  const bridgeRaw = raw["bridge_reachable"];
  const malformed =
    readThrew ||
    !plain ||
    entriesMalformed ||
    boolMalformed(bridgeRaw) ||
    hasUnrecognizedKey(report, CHALLENGE_CAPABILITY_REPORT_KEYS);
  const reportIntegrity: ChallengeReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "challenge-capability",
    deviceRef,
    methods,
    bridgeReachable: boolOrNull(bridgeRaw),
    idpSubjectRef: textOf(raw["subject_ref"]),
    bridgeSource: textOf(raw["source_system"]),
    reportIntegrity,
    source,
  };
}

export interface ChallengeCapabilityRequest {
  deviceRef: string;
  token: string;
}

export type ChallengeCapabilityTransport = (req: ChallengeCapabilityRequest) => Promise<ChallengeCapabilityReportRaw>;

export interface ChallengeCapabilityConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches one pair's capability standing and normalizes it. */
export class ChallengeCapabilityConnector {
  constructor(
    private readonly config: ChallengeCapabilityConnectorConfig,
    private readonly transport: ChallengeCapabilityTransport,
  ) {}

  async fetchNormalized(deviceRef: string, opts: ChallengeNormalizeOptions = {}): Promise<NormalizedChallengeCapability> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceRef, token: this.config.accessToken });
    return normalizeChallengeReport(deviceRef, raw, {
      ...opts,
      source: opts.source ?? this.config.source ?? "challenge-capability-bridge",
    });
  }
}
