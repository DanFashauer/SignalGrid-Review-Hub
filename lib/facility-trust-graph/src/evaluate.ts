// The LOCATION-CERTAINTY dimension — achieved precision graded against the
// precision a workflow REQUIRES, over the Facility Trust Graph.
//
// The decisive design rule (docs/FACILITY_TRUST_GRAPH.md, intake row 16): no
// coordinate, badge event, or room presence is individually authoritative. This
// evaluator consumes ONE normalized location observation — whatever produced it
// (Cisco zone presence, RTLS bed sensor, a wristband scan) — plus the graph and
// a caller-supplied requirement, and answers fail-closed: is the certainty
// sufficient to automate, or does the human step up?
//
// THE MULTI-BED RULE, MECHANICALLY. `accuracy_class` is an ordered ladder and
// a candidate class can never satisfy a confirmed requirement: a Wi-Fi fix in
// Room 312 is `room_candidate`, a med-administration workflow requires
// `bed_confirmed`, and the verdict is a step-up ("scan the wristband / select
// the patient explicitly") — "open every patient in the room" is not a state
// this model can express.
//
// NO CLOCK IN THE DECISION PATH. Staleness is derived from the observation's
// own timestamp, the requirement's stated age bound, and a reference instant
// the CALLER supplies — the same three-supplied-inputs shape as the
// benchmark-selection recency axis and shift-context schedule standing.

import type { FacilityGraph } from "./graph";

/** The certainty ladder, least → most precise. The ORDER is the model: policy
 *  states a floor on this ladder, and "at least as precise" is rank comparison.
 *  `unknown` ranks below everything and satisfies nothing. */
export const ACCURACY_CLASSES = [
  "unknown",
  "site",
  "building",
  "floor",
  "zone",
  "room_candidate",
  "room_confirmed",
  "bed_candidate",
  "bed_confirmed",
] as const;
export type AccuracyClass = (typeof ACCURACY_CLASSES)[number];

const RANK: Record<AccuracyClass, number> = Object.fromEntries(
  ACCURACY_CLASSES.map((c, i) => [c, i]),
) as Record<AccuracyClass, number>;

/** Meets-or-exceeds on the ladder. `unknown` (rank 0) satisfies nothing —
 *  including a requirement of `unknown`, which the requirement validator
 *  refuses to state anyway. */
export function satisfies(achieved: AccuracyClass, required: AccuracyClass): boolean {
  return achieved !== "unknown" && RANK[achieved] >= RANK[required];
}

export type SourceHealth = "healthy" | "degraded" | "unavailable" | "unknown";

/** The five location states the owner's design names. Derived, never asserted. */
export type LocationState = "known" | "stale" | "conflicted" | "degraded" | "unavailable";

/** Raw wire observation (loosely typed — location sources are EXTERNAL). */
export interface LocationObservationRaw {
  event_id?: unknown;
  observed_at?: unknown; // ISO-8601 UTC instant
  subject_type?: unknown; // evidence: device | badge | person
  subject_id?: unknown;
  space_id?: unknown; // a SignalGrid spaceId — vendors' ids resolve via the graph BEFORE this layer
  map_version?: unknown; // the map the source located against
  observation_source?: unknown; // evidence: cisco_spaces | rtls | scan | ...
  accuracy_class?: unknown;
  confidence?: unknown; // 0..1, source-reported; carried, graded only against a caller bound
  source_health?: unknown;
  [k: string]: unknown;
}

export const LOCATION_OBSERVATION_KEYS = [
  "event_id",
  "observed_at",
  "subject_type",
  "subject_id",
  "space_id",
  "map_version",
  "observation_source",
  "accuracy_class",
  "confidence",
  "source_health",
] as const;

/** The caller's requirement — POLICY, supplied never invented. */
export interface LocationRequirement {
  /** The floor on the certainty ladder this workflow demands. */
  readonly requiredClass: Exclude<AccuracyClass, "unknown">;
  /** Maximum acceptable observation age, in seconds. Omitted = the operator
   *  states no bound (carried as `unbounded`, an explicit visible choice). */
  readonly maxObservationAgeSeconds?: number;
  /** Minimum acceptable source confidence (0..1). Omitted = no bound. A stated
   *  bound the observation cannot answer (no confidence reported) is unmet-
   *  unknown and raises — posed-but-unanswerable, as everywhere else. */
  readonly minConfidence?: number;
}

export interface NormalizedLocationObservation {
  subjectRef: string;
  accuracyClass: AccuracyClass;
  /** The graph node the observation names, or null when unmapped/absent. */
  spaceId: string | null;
  spaceInGraph: "known" | "unmapped" | "unstated";
  /** Observation map version vs the graph's — the wrong-map detector. */
  mapVersionMatch: "matched" | "mismatched" | "unassessed";
  recency: "current" | "stale" | "unbounded" | "unknown";
  confidenceFit: "met" | "unmet" | "unbounded" | "unknown";
  sourceHealth: SourceHealth;
  observedAt: string | null;
  confidence: number | null;
  observationSource: string | null;
  subjectType: string | null;
  reportIntegrity: "clean" | "malformed";
}

export type LocationCertaintyAction = "none" | "monitor" | "step_up" | "alert" | "restrict" | "escalate";

export type LocationCertaintyReason =
  | "SUFFICIENT_CERTAINTY"
  | "INSUFFICIENT_PRECISION"
  | "LOCATION_STALE"
  | "MAP_VERSION_MISMATCH"
  | "SPACE_UNMAPPED"
  | "SOURCE_DEGRADED"
  | "SOURCE_UNAVAILABLE"
  | "INSUFFICIENT_CONFIDENCE"
  | "LOCATION_UNKNOWN"
  | "REPORT_MALFORMED"
  | "NOT_COVERED";

export interface LocationCertaintyVerdict {
  subjectRef: string;
  state: LocationState;
  reasonCode: LocationCertaintyReason;
  recommendedAction: LocationCertaintyAction;
  criticalFindings: string[];
  unknownSignals: string[];
  /** True ONLY when the state is `known` and the achieved class meets the
   *  workflow's required floor. Says nothing about identity, custody, or the
   *  labor plane — those stay with their own dimensions. */
  certaintyConfirmed: boolean;
}

function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function ownValue(report: object, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(report, key) ? (report as Record<string, unknown>)[key] : undefined;
}

function isPlain(report: unknown): report is object {
  return typeof report === "object" && report !== null && !Array.isArray(report) && report !== Object.prototype;
}

const MAX_PROTOTYPE_DEPTH = 64;
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

export interface NormalizeLocationOptions {
  requirement: LocationRequirement;
  /** The caller's "now" — the reference instant staleness is derived against. */
  referenceTime?: string;
}

/** Normalize one observation against the graph and the caller's requirement.
 *  Defensive throughout: absent is null/unknown, never a fabricated positive. */
export function normalizeLocationObservation(
  subjectRef: string,
  graph: FacilityGraph,
  report: LocationObservationRaw,
  opts: NormalizeLocationOptions,
): NormalizedLocationObservation {
  const plain = isPlain(report);
  const raw: Record<string, unknown> = {};
  let readThrew = false;
  try {
    if (plain) for (const k of LOCATION_OBSERVATION_KEYS) raw[k] = ownValue(report, k);
  } catch {
    readThrew = true;
    for (const k of LOCATION_OBSERVATION_KEYS) raw[k] = undefined;
  }

  const accuracyClass: AccuracyClass = (() => {
    const s = textOf(raw["accuracy_class"])?.toLowerCase();
    return s !== undefined && (ACCURACY_CLASSES as readonly string[]).includes(s) ? (s as AccuracyClass) : "unknown";
  })();
  const accuracyAsserted = raw["accuracy_class"] !== undefined && raw["accuracy_class"] !== null;
  const accuracyShapeBad = accuracyAsserted && accuracyClass === "unknown" &&
    textOf(raw["accuracy_class"])?.toLowerCase() !== "unknown";

  const healthRaw = textOf(raw["source_health"])?.toLowerCase();
  const HEALTHS: readonly SourceHealth[] = ["healthy", "degraded", "unavailable", "unknown"];
  const sourceHealth: SourceHealth = healthRaw !== undefined && (HEALTHS as readonly string[]).includes(healthRaw)
    ? (healthRaw as SourceHealth)
    : "unknown";
  const healthShapeBad = raw["source_health"] !== undefined && raw["source_health"] !== null &&
    sourceHealth === "unknown" && healthRaw !== "unknown";

  const spaceId = textOf(raw["space_id"]);
  const spaceInGraph: NormalizedLocationObservation["spaceInGraph"] =
    spaceId === null ? "unstated" : graph.get(spaceId) !== null ? "known" : "unmapped";

  const mapVersion = textOf(raw["map_version"]);
  const mapVersionMatch: NormalizedLocationObservation["mapVersionMatch"] =
    mapVersion === null ? "unassessed" : mapVersion === graph.mapVersion ? "matched" : "mismatched";

  const observedRaw = raw["observed_at"];
  const observedMs = instantOf(observedRaw);
  const timeShapeBad = observedRaw !== undefined && observedRaw !== null && observedMs === null;
  const referenceMs = instantOf(opts.referenceTime);
  const bound = opts.requirement.maxObservationAgeSeconds;
  const recency: NormalizedLocationObservation["recency"] = (() => {
    if (bound === undefined) return "unbounded";
    if (typeof bound !== "number" || !Number.isFinite(bound) || bound <= 0) return "unknown";
    if (observedMs === null || referenceMs === null) return "unknown";
    const ageMs = referenceMs - observedMs;
    if (ageMs < 0) return "unknown"; // future-dated never reads as fresh
    return ageMs <= bound * 1000 ? "current" : "stale";
  })();

  const confRaw = raw["confidence"];
  const confidence = typeof confRaw === "number" && Number.isFinite(confRaw) && confRaw >= 0 && confRaw <= 1 ? confRaw : null;
  const confShapeBad = confRaw !== undefined && confRaw !== null && confidence === null;
  const minConf = opts.requirement.minConfidence;
  const confidenceFit: NormalizedLocationObservation["confidenceFit"] = (() => {
    if (minConf === undefined) return "unbounded";
    if (typeof minConf !== "number" || !Number.isFinite(minConf) || minConf < 0 || minConf > 1) return "unknown";
    if (confidence === null) return "unknown"; // posed but unanswerable raises
    return confidence >= minConf ? "met" : "unmet";
  })();

  const malformed =
    readThrew || !plain || accuracyShapeBad || healthShapeBad || timeShapeBad || confShapeBad ||
    hasUnrecognizedKey(report, LOCATION_OBSERVATION_KEYS);

  return {
    subjectRef,
    accuracyClass,
    spaceId,
    spaceInGraph,
    mapVersionMatch,
    recency,
    confidenceFit,
    sourceHealth,
    observedAt: observedMs !== null ? (observedRaw as string).trim() : null,
    confidence,
    observationSource: textOf(raw["observation_source"]),
    subjectType: textOf(raw["subject_type"]),
    reportIntegrity: malformed ? "malformed" : "clean",
  };
}

const SEVERITY: Record<LocationCertaintyAction, number> = {
  none: 0, monitor: 1, step_up: 2, alert: 3, restrict: 4, escalate: 5,
};

interface Candidate {
  state: LocationState;
  action: LocationCertaintyAction;
  reason: LocationCertaintyReason;
}

export interface EvaluateLocationOptions {
  /** False when no observation exists for this subject. Default true. */
  covered?: boolean;
}

/**
 * The ladder:
 *  - map-version mismatch → restrict (the wrong-map case: a fix on last year's
 *    floor plan is the platform-mismatch of physical space)
 *  - space not in the graph → alert (measurement broken at operator scale)
 *  - source unavailable / no observation → step_up (a restricted place never
 *    silently loosens because location went dark)
 *  - stale → step_up; source degraded → step_up; confidence bound unmet or
 *    unanswerable → step_up; accuracy unknown → step_up
 *  - achieved < required → step_up (INSUFFICIENT_PRECISION — the multi-bed
 *    rule's rung: scan the wristband, select explicitly)
 *  - grant: state KNOWN + achieved meets the required floor
 */
export function evaluateLocationCertainty(
  obs: NormalizedLocationObservation,
  requirement: LocationRequirement,
  opts: EvaluateLocationOptions = {},
): LocationCertaintyVerdict {
  const covered = opts.covered ?? true;
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { subjectRef: obs.subjectRef };

  if (!covered) {
    return {
      ...base, state: "unavailable", reasonCode: "NOT_COVERED", recommendedAction: "step_up",
      criticalFindings, unknownSignals: ["location_observation"], certaintyConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  if (obs.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ state: "degraded", action: "step_up", reason: "REPORT_MALFORMED" });
  }
  if (obs.accuracyClass === "unknown") {
    unknownSignals.push("accuracy_class");
    candidates.push({ state: "degraded", action: "step_up", reason: "LOCATION_UNKNOWN" });
  }
  if (obs.mapVersionMatch === "mismatched") {
    criticalFindings.push("map_version_mismatch");
    candidates.push({ state: "conflicted", action: "restrict", reason: "MAP_VERSION_MISMATCH" });
  }
  if (obs.spaceInGraph === "unmapped") {
    criticalFindings.push("space_not_in_graph");
    candidates.push({ state: "conflicted", action: "alert", reason: "SPACE_UNMAPPED" });
  } else if (obs.spaceInGraph === "unstated") {
    unknownSignals.push("space_id");
    candidates.push({ state: "degraded", action: "step_up", reason: "LOCATION_UNKNOWN" });
  }
  if (obs.sourceHealth === "unavailable") {
    criticalFindings.push("source_unavailable");
    candidates.push({ state: "unavailable", action: "step_up", reason: "SOURCE_UNAVAILABLE" });
  } else if (obs.sourceHealth === "degraded") {
    candidates.push({ state: "degraded", action: "step_up", reason: "SOURCE_DEGRADED" });
  } else if (obs.sourceHealth === "unknown") {
    unknownSignals.push("source_health");
    candidates.push({ state: "degraded", action: "step_up", reason: "SOURCE_DEGRADED" });
  }
  if (obs.recency === "stale") {
    criticalFindings.push("observation_stale");
    candidates.push({ state: "stale", action: "step_up", reason: "LOCATION_STALE" });
  } else if (obs.recency === "unknown") {
    unknownSignals.push("observation_recency");
    candidates.push({ state: "degraded", action: "step_up", reason: "LOCATION_STALE" });
  }
  if (obs.confidenceFit === "unmet") {
    criticalFindings.push("confidence_below_required");
    candidates.push({ state: "degraded", action: "step_up", reason: "INSUFFICIENT_CONFIDENCE" });
  } else if (obs.confidenceFit === "unknown") {
    unknownSignals.push("confidence");
    candidates.push({ state: "degraded", action: "step_up", reason: "INSUFFICIENT_CONFIDENCE" });
  }
  if (obs.accuracyClass !== "unknown" && !satisfies(obs.accuracyClass, requirement.requiredClass)) {
    criticalFindings.push("precision_below_required");
    candidates.push({ state: "degraded", action: "step_up", reason: "INSUFFICIENT_PRECISION" });
  }

  // Defence in depth: the grant is affirmative on every axis. The branches
  // above already push a raising candidate for each non-confirmed state, so
  // today this never fires — it exists to catch a FUTURE weakening.
  const positivelyCertain =
    obs.reportIntegrity === "clean" &&
    obs.spaceInGraph === "known" &&
    (obs.mapVersionMatch === "matched" || obs.mapVersionMatch === "unassessed") &&
    obs.sourceHealth === "healthy" &&
    (obs.recency === "current" || obs.recency === "unbounded") &&
    (obs.confidenceFit === "met" || obs.confidenceFit === "unbounded") &&
    satisfies(obs.accuracyClass, requirement.requiredClass);
  if (!positivelyCertain && candidates.length === 0) {
    candidates.push({ state: "degraded", action: "step_up", reason: "LOCATION_UNKNOWN" });
  }

  const seed: Candidate = { state: "known", action: "none", reason: "SUFFICIENT_CERTAINTY" };
  const winner = candidates.reduce<Candidate>((max, c) => (SEVERITY[c.action] > SEVERITY[max.action] ? c : max), seed);

  return {
    ...base,
    state: winner.state,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    criticalFindings,
    unknownSignals,
    certaintyConfirmed: winner.action === "none",
  };
}
