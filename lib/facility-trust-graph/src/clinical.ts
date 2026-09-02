// Clinical bed context — phase 3 of the Facility Trust Graph.
//
// Three pieces (docs/FACILITY_TRUST_GRAPH.md, owner's implementation order):
//
//  1. ADT/FHIR ASSIGNMENT RESOLUTION. An EHR feed names a facility/unit/room/
//     bed with ITS identifiers; those resolve through the graph's vendorRefs
//     (attachments, never keys) to a target space. An assignment is
//     ADMINISTRATIVE truth — "this workflow concerns bed A" — and is never a
//     location observation: nothing here claims anyone or anything is AT the
//     bed. A record whose own components disagree (a bed that does not descend
//     from its stated room) is an affirmative anomaly, not a resolvable target.
//
//  2. SOURCE-CAPABILITY CEILINGS. Each recognized positioning technology has a
//     maximum accuracy class it can PHYSICALLY vouch for — the owner's verbatim
//     rule made mechanical: a Wi-Fi fix is `room_candidate` at best. A claim
//     above the ceiling is NOT demoted to the ceiling — a source caught
//     claiming what it cannot know gets no partial credit; the observation's
//     certainty becomes `unknown` and the anomaly is surfaced for a human.
//
//  3. THE WRISTBAND-SCAN STEP-UP PATH. When certainty cannot carry a bed-level
//     workflow, the verdict is a step-up whose satisfier is an EXPLICIT
//     SELECTION CEREMONY in the host app (scan the wristband / pick the
//     patient). The host attests only that the ceremony happened and when —
//     no patient identifier crosses into SignalGrid (the embedded-UX law).
//     A valid, fresh attestation lets the workflow proceed WITHOUT EVER
//     UPGRADING THE ACCURACY CLASS, and it satisfies only step-up-class
//     concerns: a ceremony does not cure a wrong map, an unmapped space, or a
//     source that lied about its capability.
//
// NO CLOCK IN THE DECISION PATH: attestation freshness is the same
// three-supplied-inputs shape as everywhere else (the attested instant, a
// caller-supplied bound, a caller-supplied reference instant).

import type { FacilityGraph, SpaceNode } from "./graph";
import {
  ACCURACY_CLASSES,
  evaluateLocationCertainty,
  type AccuracyClass,
  type LocationCertaintyAction,
  type LocationCertaintyVerdict,
  type LocationRequirement,
  type NormalizedLocationObservation,
} from "./evaluate";

// ── source-capability ceilings ──────────────────────────────────────────────────

/** The maximum class each recognized technology can honestly claim. The values
 *  are physics and deployment reality, not tuning: Wi-Fi trilateration cannot
 *  distinguish beds; IR/ultrasound room-bed sensors and UWB can. A technology
 *  not in this table cannot vouch for ANY class — recognition is earned by
 *  being modeled, exactly like a signal kind. */
export const SOURCE_CAPABILITY_CEILINGS: Readonly<Record<string, Exclude<AccuracyClass, "unknown">>> = {
  gps: "building",
  cell: "site",
  wifi: "room_candidate",
  cisco_spaces: "room_candidate",
  ble_beacon: "room_confirmed",
  ir_rtls: "bed_confirmed",
  ultrasound_rtls: "bed_confirmed",
  uwb_rtls: "bed_confirmed",
};

export type CapabilityGrading =
  | "within_capability"
  | "exceeds_capability"
  | "unrecognized_technology"
  | "unstated_technology";

export interface CapabilityResult {
  grading: CapabilityGrading;
  /** The class the observation may carry FORWARD: the claim itself when the
   *  source can vouch for it, `unknown` otherwise. Deliberately never the
   *  ceiling — a demotion would launder an impossible claim into a usable
   *  value from a source whose honesty is now in question. */
  effectiveClass: AccuracyClass;
  technology: string | null;
}

const RANK: Record<AccuracyClass, number> = Object.fromEntries(
  ACCURACY_CLASSES.map((c, i) => [c, i]),
) as Record<AccuracyClass, number>;

/** Grade a claimed accuracy class against the claiming technology's ceiling. */
export function applyCapabilityCeiling(claimed: AccuracyClass, technology: unknown): CapabilityResult {
  const tech = typeof technology === "string" && technology.trim().length > 0 ? technology.trim().toLowerCase() : null;
  if (tech === null) {
    return { grading: "unstated_technology", effectiveClass: "unknown", technology: null };
  }
  if (!Object.prototype.hasOwnProperty.call(SOURCE_CAPABILITY_CEILINGS, tech)) {
    return { grading: "unrecognized_technology", effectiveClass: "unknown", technology: tech };
  }
  const ceiling = SOURCE_CAPABILITY_CEILINGS[tech];
  if (claimed !== "unknown" && RANK[claimed] > RANK[ceiling]) {
    return { grading: "exceeds_capability", effectiveClass: "unknown", technology: tech };
  }
  return { grading: "within_capability", effectiveClass: claimed, technology: tech };
}

// ── ADT/FHIR assignment resolution ──────────────────────────────────────────────

export const CLINICAL_ASSIGNMENT_KEYS = [
  "system", // evidence: adt | fhir | ...
  "nursing_unit",
  "room",
  "bed",
] as const;

/** Raw wire assignment (loosely typed — EHR feeds are EXTERNAL). */
export interface ClinicalAssignmentRaw {
  system?: unknown;
  nursing_unit?: unknown;
  room?: unknown;
  bed?: unknown;
  [k: string]: unknown;
}

export type ComponentResolution = "resolved" | "unmapped" | "unstated";

export type ClinicalAssignmentOutcome =
  | "resolved" // a coherent target space exists
  | "incoherent" // components resolve but disagree with the graph's own hierarchy
  | "unmapped" // a stated identifier has no attachment in the graph
  | "unstated" // no locating component was supplied at all
  | "malformed"; // the record itself is unreadable

export interface ClinicalAssignmentResolution {
  outcome: ClinicalAssignmentOutcome;
  /** The most precise coherent space the record names, or null. */
  targetSpaceId: string | null;
  targetDepth: "bed" | "room" | "unit" | "none";
  components: { unit: ComponentResolution; room: ComponentResolution; bed: ComponentResolution };
  system: string | null;
}

function textOf(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
}

function isPlain(v: unknown): v is object {
  return typeof v === "object" && v !== null && !Array.isArray(v) && v !== Object.prototype;
}

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

export interface ResolveClinicalOptions {
  /** The vendorRefs namespace EHR identifiers are attached under (the fixture
   *  uses "ehr"). SUPPLIED, because the attachment namespace is the operator's
   *  onboarding decision, not a constant of the fabric. */
  namespace: string;
}

function componentNode(
  graph: FacilityGraph,
  namespace: string,
  key: "nursing_unit" | "room" | "bed",
  value: string | null,
  expectedKind: SpaceNode["kind"],
): { resolution: ComponentResolution; node: SpaceNode | null; kindMismatch: boolean } {
  if (value === null) return { resolution: "unstated", node: null, kindMismatch: false };
  const node = graph.resolveVendorRef(namespace, key, value);
  if (node === null) return { resolution: "unmapped", node: null, kindMismatch: false };
  return { resolution: "resolved", node, kindMismatch: node.kind !== expectedKind };
}

/** True when one space sits on the other's root path (either direction). */
function pathsConsistent(graph: FacilityGraph, aId: string, bId: string): boolean {
  const aPath = graph.path(aId).map((n) => n.spaceId);
  const bPath = graph.path(bId).map((n) => n.spaceId);
  return aPath.includes(bId) || bPath.includes(aId);
}

/**
 * Resolve one EHR-reported assignment to a graph target. The bed must descend
 * from its stated room, and the room from its stated unit — an ADT record that
 * contradicts the graph's own hierarchy is `incoherent` (a mis-mapped feed or
 * a stale attachment), never "probably the bed".
 */
export function resolveClinicalAssignment(
  graph: FacilityGraph,
  raw: ClinicalAssignmentRaw | null | undefined,
  opts: ResolveClinicalOptions,
): ClinicalAssignmentResolution {
  const none: ClinicalAssignmentResolution["components"] = { unit: "unstated", room: "unstated", bed: "unstated" };
  if (raw === null || raw === undefined || !isPlain(raw) || hasUnrecognizedKey(raw, CLINICAL_ASSIGNMENT_KEYS)) {
    return { outcome: "malformed", targetSpaceId: null, targetDepth: "none", components: none, system: null };
  }
  let unitVal: string | null;
  let roomVal: string | null;
  let bedVal: string | null;
  let system: string | null;
  try {
    unitVal = textOf((raw as Record<string, unknown>)["nursing_unit"]);
    roomVal = textOf((raw as Record<string, unknown>)["room"]);
    bedVal = textOf((raw as Record<string, unknown>)["bed"]);
    system = textOf((raw as Record<string, unknown>)["system"]);
  } catch {
    return { outcome: "malformed", targetSpaceId: null, targetDepth: "none", components: none, system: null };
  }

  const ns = opts.namespace;
  const unit = componentNode(graph, ns, "nursing_unit", unitVal, "unit");
  const room = componentNode(graph, ns, "room", roomVal, "room");
  const bed = componentNode(graph, ns, "bed", bedVal, "bed");
  const components = { unit: unit.resolution, room: room.resolution, bed: bed.resolution };

  if (unit.resolution === "unstated" && room.resolution === "unstated" && bed.resolution === "unstated") {
    return { outcome: "unstated", targetSpaceId: null, targetDepth: "none", components, system };
  }
  if (unit.resolution === "unmapped" || room.resolution === "unmapped" || bed.resolution === "unmapped") {
    return { outcome: "unmapped", targetSpaceId: null, targetDepth: "none", components, system };
  }
  if (unit.kindMismatch || room.kindMismatch || bed.kindMismatch) {
    return { outcome: "incoherent", targetSpaceId: null, targetDepth: "none", components, system };
  }
  if (bed.node !== null && room.node !== null && !pathsConsistent(graph, bed.node.spaceId, room.node.spaceId)) {
    return { outcome: "incoherent", targetSpaceId: null, targetDepth: "none", components, system };
  }
  if (bed.node !== null && unit.node !== null && !pathsConsistent(graph, bed.node.spaceId, unit.node.spaceId)) {
    return { outcome: "incoherent", targetSpaceId: null, targetDepth: "none", components, system };
  }
  if (room.node !== null && unit.node !== null && !pathsConsistent(graph, room.node.spaceId, unit.node.spaceId)) {
    return { outcome: "incoherent", targetSpaceId: null, targetDepth: "none", components, system };
  }

  const target = bed.node ?? room.node ?? unit.node;
  const targetDepth: ClinicalAssignmentResolution["targetDepth"] =
    bed.node !== null ? "bed" : room.node !== null ? "room" : unit.node !== null ? "unit" : "none";
  return {
    outcome: "resolved",
    targetSpaceId: target === null ? null : target.spaceId,
    targetDepth,
    components,
    system,
  };
}

// ── the explicit-selection ceremony ─────────────────────────────────────────────

export const EXPLICIT_SELECTION_KEYS = ["method", "attested_at"] as const;

/** The recognized ceremonies. `wristband_scan` is the healthcare headline;
 *  `manual_selection` is the deliberate on-screen pick. Both are HOST-APP
 *  acts — SignalGrid sees that one happened and when, never who was selected. */
export const SELECTION_METHODS = ["wristband_scan", "manual_selection"] as const;
export type SelectionMethod = (typeof SELECTION_METHODS)[number];

export type SelectionStanding =
  | "valid"
  | "stale"
  | "future_dated"
  | "unverifiable" // a freshness bound was posed but cannot be answered
  | "unrecognized_method"
  | "malformed"
  | "absent";

export interface SelectionAttestationRaw {
  method?: unknown;
  attested_at?: unknown;
  [k: string]: unknown;
}

export interface SelectionPolicy {
  /** Maximum age of the ceremony, in seconds. Omitted = the operator states no
   *  bound — carried as valid-by-explicit-choice, exactly like every other
   *  omitted bound in the fabric. */
  maxSelectionAgeSeconds?: number;
  /** The caller's "now". Required to answer any freshness question. */
  referenceTime?: string;
}

export interface SelectionGrade {
  standing: SelectionStanding;
  method: SelectionMethod | null;
  attestedAt: string | null;
}

function instantOf(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

/** Grade one attestation. Absent is a first-class answer, not an error — the
 *  normal state of a workflow that has not stepped up yet. */
export function gradeExplicitSelection(
  raw: SelectionAttestationRaw | null | undefined,
  policy: SelectionPolicy,
): SelectionGrade {
  if (raw === null || raw === undefined) return { standing: "absent", method: null, attestedAt: null };
  if (!isPlain(raw) || hasUnrecognizedKey(raw, EXPLICIT_SELECTION_KEYS)) {
    return { standing: "malformed", method: null, attestedAt: null };
  }
  let methodRaw: string | null;
  let attestedRaw: unknown;
  try {
    methodRaw = textOf((raw as Record<string, unknown>)["method"])?.toLowerCase() ?? null;
    attestedRaw = (raw as Record<string, unknown>)["attested_at"];
  } catch {
    return { standing: "malformed", method: null, attestedAt: null };
  }
  const methodOk = methodRaw !== null && (SELECTION_METHODS as readonly string[]).includes(methodRaw);
  const method: SelectionMethod | null = methodOk ? (methodRaw as SelectionMethod) : null;
  const attestedMs = instantOf(attestedRaw);
  const attestedAt = attestedMs !== null ? (attestedRaw as string).trim() : null;
  if (!methodOk) return { standing: "unrecognized_method", method: null, attestedAt };
  if (attestedRaw !== undefined && attestedRaw !== null && attestedMs === null) {
    return { standing: "malformed", method, attestedAt: null };
  }

  const bound = policy.maxSelectionAgeSeconds;
  const referenceMs = instantOf(policy.referenceTime);

  // Future-dated is never valid, bound or no bound — an attestation from the
  // future is a clock problem the ceremony cannot vouch through.
  // freshness: local-by-design — same rule, but this package cannot import @workspace/integrations without a new workspace dependency and a lockfile regeneration; folded copy pending that change (tolerance 0; future attestation reads `future_dated`, this family's raising member)
  if (attestedMs !== null && referenceMs !== null && attestedMs > referenceMs) {
    return { standing: "future_dated", method, attestedAt };
  }

  if (bound === undefined) return { standing: "valid", method, attestedAt };
  if (typeof bound !== "number" || !Number.isFinite(bound) || bound <= 0) {
    return { standing: "unverifiable", method, attestedAt };
  }
  if (attestedMs === null || referenceMs === null) return { standing: "unverifiable", method, attestedAt };
  // freshness: local-by-design — the age arithmetic guarded by the future check above; same local-by-design reason
  return referenceMs - attestedMs <= bound * 1000 ? { standing: "valid", method, attestedAt } : { standing: "stale", method, attestedAt };
}

// ── the bed-workflow evaluator ──────────────────────────────────────────────────

export type BedWorkflowMode = "location_confirmed" | "explicitly_selected" | "step_up_required" | "blocked";

export type BedWorkflowReason =
  | "BED_CERTAINTY_CONFIRMED"
  | "EXPLICIT_SELECTION_SATISFIED"
  | "EXPLICIT_SELECTION_REQUIRED"
  | "SELECTION_STALE"
  | "SELECTION_FUTURE_DATED"
  | "SELECTION_UNVERIFIABLE"
  | "SELECTION_UNRECOGNIZED_METHOD"
  | "SELECTION_MALFORMED"
  | "ASSIGNMENT_BROKEN"
  | "ASSIGNMENT_LOCATION_MISMATCH"
  | "SOURCE_CLAIM_EXCEEDS_CAPABILITY"
  | "LOCATION_BLOCKED";

export interface BedWorkflowVerdict {
  mode: BedWorkflowMode;
  reasonCode: BedWorkflowReason;
  recommendedAction: LocationCertaintyAction;
  /** THE PIN: the class the location evidence actually earned. A satisfied
   *  ceremony changes the MODE, never this — corroboration and consent are
   *  evidence, not precision. */
  achievedClass: AccuracyClass;
  capability: CapabilityGrading;
  selection: SelectionStanding;
  assignment: ClinicalAssignmentResolution;
  /** The full certainty verdict on the capability-graded observation —
   *  embedded so a satisfied step-up hides nothing. */
  location: LocationCertaintyVerdict;
}

export interface BedWorkflowInput {
  assignment: ClinicalAssignmentResolution;
  observation: NormalizedLocationObservation;
  requirement: LocationRequirement;
  selection?: SelectionAttestationRaw | null;
  selectionPolicy?: SelectionPolicy;
}

const SEVERITY: Record<LocationCertaintyAction, number> = {
  none: 0, monitor: 1, step_up: 2, alert: 3, restrict: 4, escalate: 5,
};

/**
 * The composition:
 *  - a source claim above its technology's ceiling → blocked (alert) — the
 *    ceremony cannot cure a lie;
 *  - a broken assignment (unmapped / incoherent / malformed) → blocked (alert)
 *    — clinical mapping failed at operator scale;
 *  - a location verdict of alert/restrict class → blocked with that action —
 *    wrong map, unmapped space: not steppable;
 *  - confirmed certainty AND a resolved, spatially consistent assignment →
 *    location_confirmed (the only path that proceeds on location alone);
 *  - everything else — insufficient precision, stale, degraded, dark source,
 *    no assignment, wrong-bed mismatch — is a STEP-UP whose satisfier is the
 *    explicit-selection ceremony. A valid ceremony proceeds; anything less
 *    (absent, stale, future-dated, unverifiable, unrecognized, malformed)
 *    keeps the step-up with the specific reason.
 */
export function evaluateBedWorkflow(graph: FacilityGraph, input: BedWorkflowInput): BedWorkflowVerdict {
  const capability = applyCapabilityCeiling(input.observation.accuracyClass, input.observation.observationSource);
  const gradedObs: NormalizedLocationObservation = { ...input.observation, accuracyClass: capability.effectiveClass };
  const location = evaluateLocationCertainty(gradedObs, input.requirement);
  const selection = gradeExplicitSelection(input.selection, input.selectionPolicy ?? {});
  const assignment = input.assignment;

  const base = {
    achievedClass: capability.effectiveClass,
    capability: capability.grading,
    selection: selection.standing,
    assignment,
    location,
  };

  // Blockers first — worst wins; a ceremony satisfies none of these.
  const blockers: Array<{ action: LocationCertaintyAction; reason: BedWorkflowReason }> = [];
  if (capability.grading === "exceeds_capability") {
    blockers.push({ action: "alert", reason: "SOURCE_CLAIM_EXCEEDS_CAPABILITY" });
  }
  if (assignment.outcome === "unmapped" || assignment.outcome === "incoherent" || assignment.outcome === "malformed") {
    blockers.push({ action: "alert", reason: "ASSIGNMENT_BROKEN" });
  }
  if (SEVERITY[location.recommendedAction] > SEVERITY.step_up) {
    blockers.push({ action: location.recommendedAction, reason: "LOCATION_BLOCKED" });
  }
  if (blockers.length > 0) {
    const worst = blockers.reduce((max, b) => (SEVERITY[b.action] > SEVERITY[max.action] ? b : max));
    return { mode: "blocked", reasonCode: worst.reason, recommendedAction: worst.action, ...base };
  }

  // Spatial consistency of the observation with the resolved target: one must
  // sit on the other's root path. Only assessable when both exist. The two
  // null guards are genuinely inert at runtime (pathsConsistent over a missing
  // id is false for any graph) and exist for the types; the spaceInGraph
  // conjunct is masked by the SPACE_UNMAPPED alert blocker above, which never
  // lets an unmapped observation reach this line. Assignment outcome is NOT
  // re-checked here — both consumers below gate on `outcome === "resolved"`.
  const spatiallyConsistent =
    assignment.targetSpaceId !== null &&
    gradedObs.spaceId !== null &&
    gradedObs.spaceInGraph === "known" &&
    pathsConsistent(graph, gradedObs.spaceId, assignment.targetSpaceId);

  // The location-alone grant: affirmative on EVERY conjunct — confirmed
  // certainty from a source that can vouch for it, a resolved assignment, and
  // the observation actually at (or within) the target. Anything less steps
  // up. The capability conjunct is deliberately redundant defence-in-depth:
  // `exceeds` is blocked above and unstated/unrecognized force the effective
  // class to unknown, which certaintyConfirmed already refuses — it exists to
  // catch a FUTURE weakening, per the affirmative-on-every-axis doctrine.
  if (
    location.certaintyConfirmed &&
    capability.grading === "within_capability" &&
    assignment.outcome === "resolved" &&
    spatiallyConsistent
  ) {
    return { mode: "location_confirmed", reasonCode: "BED_CERTAINTY_CONFIRMED", recommendedAction: "none", ...base };
  }

  // Everything else is the step-up path; a valid ceremony satisfies it.
  if (selection.standing === "valid") {
    return { mode: "explicitly_selected", reasonCode: "EXPLICIT_SELECTION_SATISFIED", recommendedAction: "none", ...base };
  }

  const reasonCode: BedWorkflowReason =
    selection.standing === "stale" ? "SELECTION_STALE"
    : selection.standing === "future_dated" ? "SELECTION_FUTURE_DATED"
    : selection.standing === "unverifiable" ? "SELECTION_UNVERIFIABLE"
    : selection.standing === "unrecognized_method" ? "SELECTION_UNRECOGNIZED_METHOD"
    : selection.standing === "malformed" ? "SELECTION_MALFORMED"
    : location.certaintyConfirmed && assignment.outcome === "resolved" && !spatiallyConsistent
      ? "ASSIGNMENT_LOCATION_MISMATCH"
      : "EXPLICIT_SELECTION_REQUIRED";
  return { mode: "step_up_required", reasonCode, recommendedAction: "step_up", ...base };
}
