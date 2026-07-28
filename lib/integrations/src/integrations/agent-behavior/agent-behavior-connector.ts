// Read-only normalization + transport for the agent-BEHAVIOR (action-judgment) connector.
//
// The source is a behavior-analytics bridge that has already evaluated an ACTION —
// how its volume compares to the actor's baseline, whether the actor has touched this
// target before, whether an authorizing intent/process sits behind it, how wide the
// action reaches, and whether its cadence is human-plausible. This connector
// normalizes that already-evaluated result. Every operation is a read; there is no
// write path. Defensive normalization is ported from the agent-identity connector: a
// bridge is an external system and may emit anything in any slot, so the normalizer —
// not the compiler — is what makes a value safe, own-property reads only, malformed
// reports fail closed.

import {
  AGENT_BEHAVIOR_REPORT_KEYS,
  AgentBehaviorConnectorError,
  type AgentBehaviorReportRaw,
  type BlastRadius,
  type Cadence,
  type NormalizedAgentBehavior,
  type Provenance,
  type ReportIntegrity,
  type TargetFamiliarity,
  type VolumeState,
} from "./types";

/** GET-only guard, mirroring the other connectors. */
export function guardReadOnly(method: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new AgentBehaviorConnectorError("read_only_violation", `agent behavior is read-only; refused ${method}`);
  }
}

/** Map a string to one of `allowed`, case-insensitively; anything else → fallback.
 *  An ALLOWLIST on purpose — an unrecognized value fails to the safe unknown. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** Only an explicit boolean is trusted; anything else is null (not reported). */
function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** Did the report ASSERT something here that we could not parse? `oneOf`/`boolOrNull`
 *  collapse "absent" and "unreadable" into one sentinel — correct for deciding a value,
 *  wrong for deciding whether the report was UNDERSTOOD. `null` counts as absent. */
function enumMalformed(v: unknown, allowed: readonly string[]): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v !== "string") return true;
  return !allowed.includes(v.trim().toLowerCase());
}

function boolMalformed(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return typeof v !== "boolean";
}

/** Read a field ONLY if the report asserts it as an OWN property. An inherited value is
 *  the prototype's claim, not this report's, and must not be readable as a confirmation. */
function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key)
    ? (report as Record<string, unknown>)[key]
    : undefined;
}

/** Is this a plain JSON-shaped object at all? An injected adapter returning a string
 *  must fail closed, not throw an untyped TypeError out of the normalizer. */
function isPlainReport(report: unknown): report is object {
  // The Object.prototype exclusion is load-bearing (review finding, extended to
  // this connector by the same audit): passing Object.prototype itself as the
  // report would let POLLUTED prototype fields read as own assertions on a
  // "plain" object — empirically a clean parse, and a grant.
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

/** Depth bound for the prototype scan — a Proxy may return a fresh object from
 *  getPrototypeOf on every call, so the walk must be bounded rather than trusted. */
const MAX_PROTOTYPE_DEPTH = 64;

/** Does the report carry any key this connector does not understand? Walks the
 *  PROTOTYPE CHAIN even though value reads are own-only: an inherited behavioral
 *  assertion in a spelling we ignore is still an assertion, and this scan is the only
 *  thing that notices it. A symbol key counts; a class instance fails closed; a
 *  JSON.parse result is unaffected (its prototype is Object.prototype). */
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

/** Normalize a behavioral report. Defensive throughout: a missing/errored field yields
 *  the fail-safe unknown/null, never a fabricated in-pattern value. */
export function normalizeReport(
  deviceId: string,
  report: AgentBehaviorReportRaw,
  source = "agent-behavior-bridge",
): NormalizedAgentBehavior {
  const plain = isPlainReport(report);
  const raw = {
    volumeState: plain ? ownValue(report, "volumeState") : undefined,
    targetFamiliarity: plain ? ownValue(report, "targetFamiliarity") : undefined,
    provenance: plain ? ownValue(report, "provenance") : undefined,
    blastRadius: plain ? ownValue(report, "blastRadius") : undefined,
    cadence: plain ? ownValue(report, "cadence") : undefined,
    bridgeReachable: plain ? ownValue(report, "bridgeReachable") : undefined,
  };

  const volumeState = oneOf<VolumeState>(raw.volumeState, ["within_expected", "elevated", "burst", "unknown"], "unknown");
  const targetFamiliarity = oneOf<TargetFamiliarity>(raw.targetFamiliarity, ["familiar", "first_seen", "unknown"], "unknown");
  const provenance = oneOf<Provenance>(raw.provenance, ["authorized", "absent", "unknown"], "unknown");
  const blastRadius = oneOf<BlastRadius>(raw.blastRadius, ["scoped", "broad", "unknown"], "unknown");
  const cadence = oneOf<Cadence>(raw.cadence, ["human_plausible", "superhuman", "unknown"], "unknown");

  // A field present but unparseable is an ASSERTION WE COULD NOT READ, distinct from
  // silence; an unrecognized key is a behavioral assertion in a spelling we ignore.
  // Both mark the report malformed — as does a report that is not a plain object.
  const malformed =
    !plain ||
    hasUnrecognizedKey(report, AGENT_BEHAVIOR_REPORT_KEYS) ||
    enumMalformed(raw.volumeState, ["within_expected", "elevated", "burst", "unknown"]) ||
    enumMalformed(raw.targetFamiliarity, ["familiar", "first_seen", "unknown"]) ||
    enumMalformed(raw.provenance, ["authorized", "absent", "unknown"]) ||
    enumMalformed(raw.blastRadius, ["scoped", "broad", "unknown"]) ||
    enumMalformed(raw.cadence, ["human_plausible", "superhuman", "unknown"]) ||
    boolMalformed(raw.bridgeReachable);
  const reportIntegrity: ReportIntegrity = malformed ? "malformed" : "clean";

  return {
    sourceSystem: "agent-behavior",
    deviceId,
    volumeState,
    targetFamiliarity,
    provenance,
    blastRadius,
    cadence,
    bridgeReachable: boolOrNull(raw.bridgeReachable),
    reportIntegrity,
    source,
  };
}

export interface AgentBehaviorRequest {
  deviceId: string;
  token: string;
}

export type AgentBehaviorTransport = (req: AgentBehaviorRequest) => Promise<AgentBehaviorReportRaw>;

export interface AgentBehaviorConnectorConfig {
  accessToken: string;
  baseUrl: string;
  source?: string;
}

/** Read-only connector: fetches a behavioral report for a device and normalizes it. */
export class AgentBehaviorConnector {
  constructor(
    private readonly config: AgentBehaviorConnectorConfig,
    private readonly transport: AgentBehaviorTransport,
  ) {}

  async fetchNormalized(deviceId: string): Promise<NormalizedAgentBehavior> {
    guardReadOnly("GET");
    const raw = await this.transport({ deviceId, token: this.config.accessToken });
    return normalizeReport(deviceId, raw, this.config.source ?? "agent-behavior-bridge");
  }
}
