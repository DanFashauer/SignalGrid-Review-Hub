// Site Context Gateway — the decision/data core of phase 4
// (docs/FACILITY_TRUST_GRAPH.md; the hybrid deployment contract from the
// row-17 research report).
//
// The hybrid rule: the SENSITIVE JOIN — precise staff location + badge
// identity + device session + patient encounter/bed — happens locally, and
// the cloud receives ONLY the minimum: policy outcome, coarse zone,
// pseudonymous subject, device security tier, source health, latency, reason
// codes. This module is the pure core of that boundary:
//
//  1. projectUpstreamRecord — the MINIMIZATION PROJECTOR. It does not "strip
//     what it recognizes as sensitive"; it REFUSES anything it does not
//     recognize. A projector that silently dropped a patient_id would teach
//     callers to keep sending one — refusal is the only shape that shrinks
//     the wire over time. Spatial content is coarsened THROUGH THE GRAPH to a
//     caller-supplied kind ceiling, and when the coarse zone cannot be
//     derived the record carries NOTHING spatial — never the precise id.
//
//  2. deriveGatewayMode — the RESTRICTED-MODE grader. When required local
//     sources go dark, the gateway enters a defined restricted mode in which
//     location-derived privileges are WITHDRAWN — a restricted place never
//     silently loosens because location went dark, and a gateway that cannot
//     read its own source-health report is itself restricted.
//
// The local audit trail is NOT rebuilt here: @workspace/audit is already an
// atomic hash-chained ledger. The gateway's contribution is the ANCHOR — the
// upstream record carries the local chain HEAD hash (`audit_head`), so the
// control plane can detect local-ledger tampering or truncation without ever
// receiving the sensitive records themselves.
//
// Transport, sync cadence, and config-down integrity remain the province of
// `control-plane`/`edge-sync` (bundle checksums + signatures, counts-only
// aggregation). Nothing here opens a socket; everything is deterministic and
// no clock is read.

import type { FacilityGraph, SpaceKind } from "./graph";
import type { LocationCertaintyAction } from "./evaluate";

// ── the minimization projector ──────────────────────────────────────────────────

export const UPSTREAM_INPUT_KEYS = [
  "outcome",
  "reason_codes",
  "space_id",
  "pseudonym",
  "device_tier",
  "source_health",
  "decision_latency_ms",
  "audit_head",
] as const;

export const UPSTREAM_OUTCOMES = ["allow", "step_up", "restrict", "deny"] as const;
export type UpstreamOutcome = (typeof UPSTREAM_OUTCOMES)[number];

const MAX_REASON_CODES = 32;

export interface UpstreamProjectionInput {
  outcome?: unknown;
  reason_codes?: unknown;
  /** The PRECISE local space. Never emitted — only its coarse ancestor is. */
  space_id?: unknown;
  /** Caller-supplied pseudonym. The projector never accepts a raw subject
   *  field, and applies a cheap tripwire (no "@") against the most common
   *  raw-identifier leak — a tripwire, not proof of pseudonymity. */
  pseudonym?: unknown;
  device_tier?: unknown;
  source_health?: unknown;
  decision_latency_ms?: unknown;
  /** HEAD hash of the local @workspace/audit chain — the tamper anchor. */
  audit_head?: unknown;
  [k: string]: unknown;
}

export type UpstreamRefusal =
  | "UNRECOGNIZED_FIELD"
  | "INPUT_UNREADABLE"
  | "OUTCOME_UNRECOGNIZED"
  | "REASON_CODES_UNREADABLE"
  | "PSEUDONYM_MISSING"
  | "PSEUDONYM_SUSPECT"
  | "SPACE_UNMAPPED"
  | "CEILING_UNRECOGNIZED";

export interface UpstreamRecord {
  schema: "sg-gateway-upstream/v1";
  outcome: UpstreamOutcome;
  reasonCodes: string[];
  /** The nearest ancestor-or-self at the coarsening ceiling, or null when it
   *  cannot be derived — deliberately never the precise space. */
  coarseZoneId: string | null;
  coarseZoneKind: SpaceKind;
  pseudonym: string;
  deviceTier: string | null;
  sourceHealth: string | null;
  decisionLatencyMs: number | null;
  auditHead: string | null;
}

export type UpstreamProjection =
  | { projected: UpstreamRecord; refusal: null }
  | { projected: null; refusal: UpstreamRefusal };

const MAX_PROTOTYPE_DEPTH = 64;
function hasUnrecognizedKey(record: object, known: readonly string[]): boolean {
  try {
    let o: object | null = record;
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

function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function refuse(refusal: UpstreamRefusal): UpstreamProjection {
  return { projected: null, refusal };
}

/**
 * Project one local decision into the minimum upstream record, or refuse.
 * `coarsenToKind` is the operator's explicit spatial ceiling (e.g. "unit"):
 * the cloud never learns anything finer.
 */
export function projectUpstreamRecord(
  graph: FacilityGraph,
  input: UpstreamProjectionInput | null | undefined,
  coarsenToKind: SpaceKind,
): UpstreamProjection {
  if (graph.derived.byKind[coarsenToKind] === undefined) return refuse("CEILING_UNRECOGNIZED");
  if (input === null || input === undefined || typeof input !== "object" || Array.isArray(input)) {
    return refuse("INPUT_UNREADABLE");
  }
  if (hasUnrecognizedKey(input, UPSTREAM_INPUT_KEYS)) return refuse("UNRECOGNIZED_FIELD");

  let outcome: string | null;
  let reasonsRaw: unknown;
  let spaceId: string | null;
  let pseudonym: string | null;
  let deviceTier: string | null;
  let sourceHealth: string | null;
  let latencyRaw: unknown;
  let auditHead: string | null;
  try {
    outcome = textOf(input.outcome);
    reasonsRaw = input.reason_codes;
    spaceId = textOf(input.space_id);
    pseudonym = textOf(input.pseudonym);
    deviceTier = textOf(input.device_tier);
    sourceHealth = textOf(input.source_health);
    latencyRaw = input.decision_latency_ms;
    auditHead = textOf(input.audit_head);
  } catch {
    return refuse("INPUT_UNREADABLE");
  }

  if (outcome === null || !(UPSTREAM_OUTCOMES as readonly string[]).includes(outcome)) {
    return refuse("OUTCOME_UNRECOGNIZED");
  }
  if (!Array.isArray(reasonsRaw) || reasonsRaw.length > MAX_REASON_CODES || reasonsRaw.some((r) => textOf(r) === null)) {
    return refuse("REASON_CODES_UNREADABLE");
  }
  if (pseudonym === null) return refuse("PSEUDONYM_MISSING");
  if (pseudonym.includes("@")) return refuse("PSEUDONYM_SUSPECT");

  let coarseZoneId: string | null = null;
  if (spaceId !== null) {
    if (graph.get(spaceId) === null) {
      // An unmapped precise id cannot be coarsened, and forwarding it raw
      // would be exactly the leak this projector exists to prevent.
      return refuse("SPACE_UNMAPPED");
    }
    coarseZoneId = graph.containing(spaceId, coarsenToKind)?.spaceId ?? null;
  }

  const latencyOk = typeof latencyRaw === "number" && Number.isFinite(latencyRaw) && latencyRaw >= 0;
  return {
    projected: {
      schema: "sg-gateway-upstream/v1",
      outcome: outcome as UpstreamOutcome,
      reasonCodes: (reasonsRaw as unknown[]).map((r) => (r as string).trim()),
      coarseZoneId,
      coarseZoneKind: coarsenToKind,
      pseudonym,
      deviceTier,
      sourceHealth,
      decisionLatencyMs: latencyOk ? (latencyRaw as number) : null,
      auditHead,
    },
    refusal: null,
  };
}

// ── the restricted-mode grader ──────────────────────────────────────────────────

export type GatewayMode = "normal" | "degraded" | "restricted";

export type GatewayModeReason =
  | "ALL_REQUIRED_SOURCES_HEALTHY"
  | "REQUIRED_SOURCE_DEGRADED"
  | "REQUIRED_SOURCE_UNAVAILABLE"
  | "REPORT_UNREADABLE"
  | "POLICY_UNREADABLE";

export const SOURCE_HEALTH_STATES = ["healthy", "degraded", "unavailable"] as const;

export interface GatewayModePolicy {
  /** The sources this site's high-trust workflows depend on. POSED by the
   *  operator; an empty list is their explicit visible choice. */
  requiredSources: string[];
}

export interface GatewayModeVerdict {
  mode: GatewayMode;
  reasonCode: GatewayModeReason;
  recommendedAction: LocationCertaintyAction;
  /** THE LAW: `withdrawn` in restricted mode — a restricted place never
   *  silently loosens because location went dark. Never a third, wider value. */
  locationDerivedPrivileges: "retained" | "withdrawn";
  unavailableSources: string[];
  degradedSources: string[];
  /** Required sources whose health is unreadable, unrecognized, or simply
   *  absent from the report — absence is not health, so these count toward
   *  restriction, but they are named separately so an operator can tell a
   *  dead source from a missing report line. */
  unknownSources: string[];
}

/**
 * Grade the gateway's aggregate source health into one honest mode.
 * Fail-closed on both inputs: an unreadable report or policy is RESTRICTED —
 * a gateway that cannot read its own health is not entitled to normal mode.
 */
export function deriveGatewayMode(report: unknown, policy: GatewayModePolicy | null | undefined): GatewayModeVerdict {
  const restricted = (reasonCode: GatewayModeReason, unavailable: string[], degraded: string[], unknown: string[]): GatewayModeVerdict => ({
    mode: "restricted",
    reasonCode,
    recommendedAction: "step_up",
    locationDerivedPrivileges: "withdrawn",
    unavailableSources: unavailable,
    degradedSources: degraded,
    unknownSources: unknown,
  });

  if (policy === null || policy === undefined || !Array.isArray(policy.requiredSources) ||
      policy.requiredSources.some((s) => textOf(s) === null)) {
    return restricted("POLICY_UNREADABLE", [], [], []);
  }
  if (report === null || report === undefined || typeof report !== "object" || Array.isArray(report)) {
    return restricted("REPORT_UNREADABLE", [], [], []);
  }
  let entries: Array<[string, unknown]>;
  try {
    entries = Object.entries(report as Record<string, unknown>);
  } catch {
    return restricted("REPORT_UNREADABLE", [], [], []);
  }
  const health = new Map<string, string>();
  for (const [name, value] of entries) {
    const v = textOf(value)?.toLowerCase() ?? "";
    health.set(name, (SOURCE_HEALTH_STATES as readonly string[]).includes(v) ? v : "unknown");
  }

  const unavailable: string[] = [];
  const degraded: string[] = [];
  const unknown: string[] = [];
  for (const name of policy.requiredSources.map((s) => s.trim())) {
    const state = health.get(name);
    if (state === undefined || state === "unknown") unknown.push(name);
    else if (state === "unavailable") unavailable.push(name);
    else if (state === "degraded") degraded.push(name);
  }

  if (unavailable.length > 0 || unknown.length > 0) {
    return restricted("REQUIRED_SOURCE_UNAVAILABLE", unavailable, degraded, unknown);
  }
  if (degraded.length > 0) {
    return {
      mode: "degraded",
      reasonCode: "REQUIRED_SOURCE_DEGRADED",
      recommendedAction: "monitor",
      locationDerivedPrivileges: "retained",
      unavailableSources: [],
      degradedSources: degraded,
      unknownSources: [],
    };
  }
  return {
    mode: "normal",
    reasonCode: "ALL_REQUIRED_SOURCES_HEALTHY",
    recommendedAction: "none",
    locationDerivedPrivileges: "retained",
    unavailableSources: [],
    degradedSources: [],
    unknownSources: [],
  };
}
