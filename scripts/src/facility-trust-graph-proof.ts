// Facility Trust Graph decision proof — fully OFFLINE and deterministic.
//
// Phase 1 of the spatial-trust subsystem (docs/FACILITY_TRUST_GRAPH.md, intake
// row 16). Two claims proven: the GRAPH is a canonical, versioned, refusal-
// validated model of space whose vendor identifiers are attachments and never
// keys; and the CERTAINTY dimension grades achieved precision against the floor
// a workflow requires, fail-closed on every axis, with THE MULTI-BED RULE
// mechanical: a room candidate can never satisfy a bed-confirmed requirement —
// the verdict is a step-up to scan, and "open every patient in the room" is
// unrepresentable.
import {
  ACCURACY_CLASSES,
  applyCapabilityCeiling,
  correlateCrossing,
  evaluateBedWorkflow,
  FacilityGraphError,
  buildFacilityGraph,
  evaluateLocationCertainty,
  gradeExplicitSelection,
  gradeZonePresence,
  normalizeLocationObservation,
  resolveClinicalAssignment,
  satisfies,
  type AccuracyClass,
  type ClinicalAssignmentRaw,
  type FacilityGraphDoc,
  type LocationObservationRaw,
  type NormalizedLocationObservation,
  type SelectionAttestationRaw,
  type SpaceNode,
} from "@workspace/facility-trust-graph";
import { SIGNAL_KINDS, composeDeviceRisk, fromLocationCertainty } from "@workspace/posture-composition";
import { enumerateGrantSafety, productOf } from "./lib/grant-safety.js";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Facility Trust Graph decision proof");

// ── the graph: a small but real hospital slice ──────────────────────────────────
const DOC: FacilityGraphDoc = {
  mapVersion: "2026.07.14",
  spaces: [
    { spaceId: "SG-ORG", kind: "organization", name: "Fixture Health", parentId: null },
    { spaceId: "SG-HOSP-A", kind: "campus", name: "Hospital A", parentId: "SG-ORG" },
    { spaceId: "SG-HOSP-A-BLDG1", kind: "building", name: "Building 1", parentId: "SG-HOSP-A" },
    { spaceId: "SG-HOSP-A-BLDG1-F03", kind: "floor", name: "Floor 3", parentId: "SG-HOSP-A-BLDG1",
      vendorRefs: { cisco: { floor_id: "flr-9911", map_id: "map-77" } } },
    { spaceId: "SG-F03-ZONE-MED", kind: "security_zone", name: "Medication zone", parentId: "SG-HOSP-A-BLDG1-F03",
      securityClassification: "controlled" },
    { spaceId: "SG-F03-UNIT-4W", kind: "unit", name: "4 West Med-Surg", parentId: "SG-HOSP-A-BLDG1-F03",
      vendorRefs: { ehr: { nursing_unit: "4W" } } },
    { spaceId: "SG-RM0312", kind: "room", name: "Room 312", parentId: "SG-F03-UNIT-4W",
      vendorRefs: { cisco: { zone_id: "zn-312" }, ehr: { room: "0312" } } },
    { spaceId: "SG-RM0312-BED-A", kind: "bed", name: "Bed A", parentId: "SG-RM0312",
      vendorRefs: { rtls: { bed_zone_id: "bz-312a" }, ehr: { bed: "0312-A" } } },
    { spaceId: "SG-RM0312-BED-B", kind: "bed", name: "Bed B", parentId: "SG-RM0312",
      vendorRefs: { rtls: { bed_zone_id: "bz-312b" }, ehr: { bed: "0312-B" } } },
    { spaceId: "SG-F03-CORRIDOR-W", kind: "room", name: "West corridor", parentId: "SG-F03-UNIT-4W",
      vendorRefs: { ehr: { room: "0399" } } },
    { spaceId: "SG-RM0312-DOOR", kind: "door", name: "Room 312 door", parentId: "SG-RM0312",
      connects: ["SG-F03-CORRIDOR-W"],
      vendorRefs: { physical_access: { door_id: "door-3120", reader_id: "rdr-3120" } } },
  ],
};
const graph = buildFacilityGraph(DOC);

check("the graph builds, and derived figures are recomputed from the spaces (11 total; 2 beds; 1 door)",
  graph.derived.total === 11 && graph.derived.byKind.bed === 2 && graph.derived.byKind.door === 1);
check("path() walks root-first: org → campus → building → floor → unit → room → bed",
  graph.path("SG-RM0312-BED-B").map((s) => s.kind).join(",") === "organization,campus,building,floor,unit,room,bed");
check("containing() finds the nearest ancestor of a kind — the bed's unit is 4 West",
  graph.containing("SG-RM0312-BED-B", "unit")?.spaceId === "SG-F03-UNIT-4W");
check("VENDOR IDS ARE ATTACHMENTS, NEVER KEYS: cisco zone zn-312 resolves to the room, rtls bz-312b to Bed B, the door reader to the door",
  graph.resolveVendorRef("cisco", "zone_id", "zn-312")?.spaceId === "SG-RM0312" &&
  graph.resolveVendorRef("rtls", "bed_zone_id", "bz-312b")?.spaceId === "SG-RM0312-BED-B" &&
  graph.resolveVendorRef("physical_access", "reader_id", "rdr-3120")?.spaceId === "SG-RM0312-DOOR");
check("an unmapped vendor id resolves to null, never a guess",
  graph.resolveVendorRef("cisco", "zone_id", "zn-999") === null);
// THE REPLACEMENT-SAFETY CLAIM: re-point every cisco id and the spaceIds stand.
const migrated = buildFacilityGraph({
  ...DOC,
  spaces: DOC.spaces.map((s) =>
    s.vendorRefs?.cisco ? { ...s, vendorRefs: { ...s.vendorRefs, cisco: Object.fromEntries(Object.entries(s.vendorRefs.cisco).map(([k]) => [k, `new-${k}`])) } } : s),
});
check("a full Cisco migration (every cisco id replaced) leaves every spaceId, path, and policy target intact — the mapping moved, the identity did not",
  migrated.get("SG-RM0312-BED-B") !== null &&
  migrated.resolveVendorRef("cisco", "zone_id", "zn-312") === null &&
  migrated.resolveVendorRef("cisco", "zone_id", "new-zone_id")?.spaceId === "SG-RM0312");

// ── graph refusals ──────────────────────────────────────────────────────────────
const refuses = (doc: FacilityGraphDoc): boolean => {
  try { buildFacilityGraph(doc); return false; }
  catch (err) { return err instanceof FacilityGraphError && err.code === "bad_graph"; }
};
const swap = (over: (s: SpaceNode) => SpaceNode) => ({ ...DOC, spaces: DOC.spaces.map(over) });
check("an EMPTY graph is refused (a graph with no spaces cannot answer anything)",
  refuses({ mapVersion: "v", spaces: [] }));
check("a blank mapVersion is refused — an unversioned map cannot participate in the wrong-map detector",
  refuses({ ...DOC, mapVersion: "  " }));
check("a duplicate spaceId is refused — identity must be unambiguous",
  refuses({ ...DOC, spaces: [...DOC.spaces, { ...DOC.spaces[6], name: "Room 312 again" }] }));
check("a missing parent is refused",
  refuses(swap((s) => (s.spaceId === "SG-RM0312" ? { ...s, parentId: "SG-NOPE" } : s))));
check("an ILLEGAL hierarchy is refused — a building cannot sit under a room",
  refuses({ ...DOC, spaces: [...DOC.spaces, { spaceId: "SG-BAD", kind: "building", name: "B", parentId: "SG-RM0312" }] }));
check("a second root is refused — one organization per graph",
  refuses({ ...DOC, spaces: [...DOC.spaces, { spaceId: "SG-ORG2", kind: "organization", name: "Other", parentId: null }] }));
check("a CYCLE is refused by the bounded walk",
  refuses(swap((s) => (s.spaceId === "SG-HOSP-A" ? { ...s, parentId: "SG-RM0312" } : s))));
check("an AMBIGUOUS vendor ref (same namespace/key/id on two spaces) is refused — ambiguity does not resolve, it refuses",
  refuses(swap((s) => (s.spaceId === "SG-RM0312-BED-A" ? { ...s, vendorRefs: { rtls: { bed_zone_id: "bz-312b" } } } : s))));

// ── phase 2: portal adjacency + crossing correlation ────────────────────────────
const DOOR = "SG-RM0312-DOOR";
const W = { maxCorrelationSeconds: 90 };
const corr = (obsSpace: string, crossedAt: string, observedAt: string, w = W) =>
  correlateCrossing(graph, { doorSpaceId: DOOR, crossedAt }, { spaceId: obsSpace, observedAt }, w);
check("doorSides = parent + connects: the Room 312 door touches the room and the west corridor, in either direction",
  JSON.stringify([...(graph.doorSides(DOOR) ?? [])].sort()) === JSON.stringify(["SG-F03-CORRIDOR-W", "SG-RM0312"]));
check("doorSides on a non-door is null, never a guess", graph.doorSides("SG-RM0312") === null);
check("CORROBORATED: badge crosses the Room 312 door, device observed at Bed B 30s later — the bed DESCENDS from a side, so the crossing and the observation agree",
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").corroboration === "corroborated" &&
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").recommendedAction === "none");
check("...and corroboration is EVIDENCE, not a grant: the corridor side corroborates too (a door works in both directions)",
  corr("SG-F03-CORRIDOR-W", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").corroboration === "corroborated");
check("CONTRADICTED: badge crosses the Room 312 door, device observed in the MEDICATION ZONE 30s later — the door does not lead there: passback, tailgate, or a cloned badge → alert",
  corr("SG-F03-ZONE-MED", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").corroboration === "contradicted" &&
  corr("SG-F03-ZONE-MED", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").recommendedAction === "alert");
check("UNASSESSED outside the window: an observation 5 minutes later does not speak about a 90-second window — no claim posed, nothing granted, nothing raised by this pair",
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:05:01Z").corroboration === "unassessed" &&
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:05:01Z").recommendedAction === "none");
check("UNASSESSED before the crossing: clock skew lands honestly as not-evidence, never as a silent pass",
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T13:59:59Z").reasonCode === "OBSERVATION_BEFORE_CROSSING");
check("the window boundary is inclusive: exactly 90s corroborates; 90.001s is outside",
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:01:30.000Z").corroboration === "corroborated" &&
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:01:30.001Z").corroboration === "unassessed");
check("unknowns RAISE: a door not in the graph, an unreadable window, and an unreadable instant each step up (never a silent skip)",
  correlateCrossing(graph, { doorSpaceId: "SG-NOPE", crossedAt: "2026-07-31T14:00:00Z" }, { spaceId: "SG-RM0312", observedAt: "2026-07-31T14:00:30Z" }, W).recommendedAction === "step_up" &&
  corr("SG-RM0312-BED-B", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z", { maxCorrelationSeconds: 0 }).reasonCode === "WINDOW_UNREADABLE" &&
  corr("SG-RM0312-BED-B", "just now", "2026-07-31T14:00:30Z").reasonCode === "INSTANT_UNREADABLE");
check("an observed space the graph does not carry → alert (the same measurement-broken class as SPACE_UNMAPPED)",
  corr("SG-DEMOLISHED", "2026-07-31T14:00:00Z", "2026-07-31T14:00:30Z").reasonCode === "OBSERVED_SPACE_NOT_IN_GRAPH");
check("adjacency refusals: connects on a non-door, into nowhere, into itself, and into another door are all refused at build",
  refuses(swap((s) => (s.spaceId === "SG-RM0312" ? { ...s, connects: ["SG-F03-CORRIDOR-W"] } : s))) &&
  refuses(swap((s) => (s.spaceId === "SG-RM0312-DOOR" ? { ...s, connects: ["SG-NOWHERE"] } : s))) &&
  refuses(swap((s) => (s.spaceId === "SG-RM0312-DOOR" ? { ...s, connects: ["SG-RM0312-DOOR"] } : s))));

// ── the certainty ladder ────────────────────────────────────────────────────────
check("the ladder is ordered least→most precise and 'unknown' satisfies NOTHING",
  satisfies("bed_confirmed", "room_confirmed") && satisfies("room_confirmed", "zone") &&
  !satisfies("room_candidate", "room_confirmed") && !satisfies("unknown", "site") &&
  ACCURACY_CLASSES[0] === "unknown" && ACCURACY_CLASSES[ACCURACY_CLASSES.length - 1] === "bed_confirmed");

const REF = "2026-07-31T14:32:30Z";
const MED_REQ = { requiredClass: "bed_confirmed" as const, maxObservationAgeSeconds: 120, minConfidence: 0.6 };
const clean = (over: LocationObservationRaw = {}): LocationObservationRaw => ({
  event_id: "evt-0175",
  observed_at: "2026-07-31T14:32:17.421Z",
  subject_type: "device",
  subject_id: "device-wow-442",
  space_id: "SG-RM0312-BED-B",
  map_version: "2026.07.14",
  observation_source: "rtls",
  accuracy_class: "bed_confirmed",
  confidence: 0.93,
  source_health: "healthy",
  ...over,
});
const ev = (r: LocationObservationRaw, requirement: import("@workspace/facility-trust-graph").LocationRequirement = MED_REQ, referenceTime: string | undefined = REF) =>
  evaluateLocationCertainty(normalizeLocationObservation("wow-442", graph, r, { requirement, referenceTime }), requirement);

const grant = ev(clean());
check("bed-confirmed RTLS fix, current map, fresh, confident → the grant for a bed_confirmed workflow",
  grant.recommendedAction === "none" && grant.reasonCode === "SUFFICIENT_CERTAINTY" &&
  grant.state === "known" && grant.certaintyConfirmed === true &&
  grant.criticalFindings.length === 0 && grant.unknownSignals.length === 0);

// THE MULTI-BED HEADLINE.
const roomOnly = ev(clean({ accuracy_class: "room_candidate", observation_source: "cisco_spaces", space_id: "SG-RM0312", confidence: 0.78 }));
check("THE MULTI-BED RULE: a Wi-Fi room CANDIDATE (Cisco, 0.78) against a bed_confirmed requirement → step_up (INSUFFICIENT_PRECISION) — scan the wristband; 'open every patient in the room' is unrepresentable",
  roomOnly.recommendedAction === "step_up" && roomOnly.reasonCode === "INSUFFICIENT_PRECISION" &&
  roomOnly.criticalFindings.includes("precision_below_required") && roomOnly.certaintyConfirmed === false);
check("the SAME observation satisfies a unit-dashboard workflow (requires zone or better) — the requirement is the policy, not the sensor",
  ev(clean({ accuracy_class: "room_candidate", space_id: "SG-RM0312", confidence: 0.78 }),
    { requiredClass: "zone" }).recommendedAction === "none");
check("a room CONFIRMED fix still cannot satisfy bed_confirmed — confirmed-at-a-coarser-level is not confirmed-at-the-required one",
  ev(clean({ accuracy_class: "room_confirmed", space_id: "SG-RM0312" })).reasonCode === "INSUFFICIENT_PRECISION");

// ── fail-safe states ────────────────────────────────────────────────────────────
const wrongMap = ev(clean({ map_version: "2025.11.02" }));
check("a fix located on LAST YEAR'S MAP → restrict (MAP_VERSION_MISMATCH, state conflicted) — the wrong-map case is the platform-mismatch of physical space",
  wrongMap.recommendedAction === "restrict" && wrongMap.reasonCode === "MAP_VERSION_MISMATCH" && wrongMap.state === "conflicted");
const unmapped = ev(clean({ space_id: "SG-DEMOLISHED-WING" }));
check("a space the graph does not carry → alert (SPACE_UNMAPPED): measurement broken at operator scale",
  unmapped.recommendedAction === "alert" && unmapped.reasonCode === "SPACE_UNMAPPED" && unmapped.state === "conflicted");
const stale = ev(clean({ observed_at: "2026-07-31T14:00:00Z" }));
check("an observation older than the stated bound → step_up (LOCATION_STALE, state stale) — a restricted place never silently loosens",
  stale.recommendedAction === "step_up" && stale.reasonCode === "LOCATION_STALE" && stale.state === "stale");
check("the age bound is caller-supplied and the reference instant too — no bound stated means recency is unbounded and the same old fix grants",
  ev(clean({ observed_at: "2026-07-31T14:00:00Z" }), { requiredClass: "bed_confirmed", minConfidence: 0.6 }).recommendedAction === "none");
const down = ev(clean({ source_health: "unavailable" }));
check("source UNAVAILABLE → step_up (state unavailable), never a silent pass-through of the last answer",
  down.recommendedAction === "step_up" && down.reasonCode === "SOURCE_UNAVAILABLE" && down.state === "unavailable");
check("source DEGRADED → step_up; an ABSENT health claim is unknown and also raises",
  ev(clean({ source_health: "degraded" })).reasonCode === "SOURCE_DEGRADED" &&
  ev(clean({ source_health: undefined })).recommendedAction === "step_up");
const lowConf = ev(clean({ confidence: 0.41 }));
check("confidence below the caller's stated floor → step_up (INSUFFICIENT_CONFIDENCE) — the number is graded only against a supplied bound, never a tuned one",
  lowConf.recommendedAction === "step_up" && lowConf.reasonCode === "INSUFFICIENT_CONFIDENCE");
check("a confidence bound POSED and the source reports none → unknown raises (posed-but-unanswerable)",
  ev(clean({ confidence: undefined })).reasonCode === "INSUFFICIENT_CONFIDENCE");
check("no observation at all (covered=false) → step_up (NOT_COVERED, state unavailable)",
  evaluateLocationCertainty(
    normalizeLocationObservation("w", graph, clean(), { requirement: MED_REQ, referenceTime: REF }),
    MED_REQ, { covered: false },
  ).reasonCode === "NOT_COVERED");
check("a junk accuracy spelling is malformed AND unknown — never coerced",
  (() => { const n = normalizeLocationObservation("w", graph, clean({ accuracy_class: "pretty-close" }), { requirement: MED_REQ, referenceTime: REF });
    return n.reportIntegrity === "malformed" && n.accuracyClass === "unknown"; })());
check("a future-dated observation never reads as fresh",
  ev(clean({ observed_at: "2027-01-01T00:00:00Z" })).recommendedAction === "step_up");
const extraKey = normalizeLocationObservation("w", graph, { ...clean(), gps_hint: "trust me" } as LocationObservationRaw,
  { requirement: MED_REQ, referenceTime: REF });
check("an unrecognized key refuses AS malformed — REPORT_MALFORMED from its own branch, not the backstop wearing another reason",
  extraKey.reportIntegrity === "malformed" &&
  evaluateLocationCertainty(extraKey, MED_REQ).reasonCode === "REPORT_MALFORMED");
// Ordering pins: each unknown-axis branch must LEAD over a later same-action
// candidate, so deleting the branch changes a pinned reason (the mutation sweep
// found all five masked by the backstop before these existed).
check("accuracy ABSENT + confidence unmet → LOCATION_UNKNOWN leads (the accuracy branch is its own rung, not the backstop)",
  ev(clean({ accuracy_class: undefined, confidence: 0.41 })).reasonCode === "LOCATION_UNKNOWN");
check("space_id ABSENT + confidence unmet → LOCATION_UNKNOWN leads (the unstated-space branch is its own rung)",
  ev(clean({ space_id: undefined, confidence: 0.41 })).reasonCode === "LOCATION_UNKNOWN");
check("health ABSENT + confidence unmet → SOURCE_DEGRADED leads (the unknown-health branch is its own rung)",
  ev(clean({ source_health: undefined, confidence: 0.41 })).reasonCode === "SOURCE_DEGRADED");
check("observed_at ABSENT while a bound is stated + confidence unmet → LOCATION_STALE leads (the unknown-recency branch is its own rung)",
  ev(clean({ observed_at: undefined, confidence: 0.41 })).reasonCode === "LOCATION_STALE");
let deepProto: object = {};
for (let i = 0; i < 100; i += 1) deepProto = Object.create(deepProto);
const throwingKeys = new Proxy(clean(), { ownKeys: () => { throw new Error("hostile"); } }) as LocationObservationRaw;
check("a Proxy that THROWS from ownKeys fails closed to malformed — the catch is load-bearing, not decoration",
  normalizeLocationObservation("tk", graph, throwingKeys, { requirement: MED_REQ, referenceTime: REF }).reportIntegrity === "malformed");
check("an observation behind a 100-deep prototype chain is malformed (the bounded walk is load-bearing)",
  normalizeLocationObservation("deep", graph, Object.assign(Object.create(deepProto), clean()) as LocationObservationRaw,
    { requirement: MED_REQ, referenceTime: REF }).reportIntegrity === "malformed");

// ── exhaustive (normalized): the grant is the seven-axis conjunction ────────────
const normDomains = {
  accuracyClass: [...ACCURACY_CLASSES],
  spaceInGraph: ["known", "unmapped", "unstated"],
  mapVersionMatch: ["matched", "mismatched", "unassessed"],
  recency: ["current", "stale", "unbounded", "unknown"],
  confidenceFit: ["met", "unmet", "unbounded", "unknown"],
  sourceHealth: ["healthy", "degraded", "unavailable", "unknown"],
  reportIntegrity: ["clean", "malformed"],
};
const REQ = { requiredClass: "room_confirmed" as const };
const buildNorm = (c: Record<string, unknown>): NormalizedLocationObservation => ({
  subjectRef: "enum",
  accuracyClass: c.accuracyClass as AccuracyClass,
  spaceId: "SG-RM0312",
  spaceInGraph: c.spaceInGraph as NormalizedLocationObservation["spaceInGraph"],
  mapVersionMatch: c.mapVersionMatch as NormalizedLocationObservation["mapVersionMatch"],
  recency: c.recency as NormalizedLocationObservation["recency"],
  confidenceFit: c.confidenceFit as NormalizedLocationObservation["confidenceFit"],
  sourceHealth: c.sourceHealth as NormalizedLocationObservation["sourceHealth"],
  observedAt: null, confidence: null, observationSource: null, subjectType: null,
  reportIntegrity: c.reportIntegrity as NormalizedLocationObservation["reportIntegrity"],
});
const normRes = enumerateGrantSafety({
  domains: normDomains,
  build: buildNorm,
  evaluate: (r) => evaluateLocationCertainty(r, REQ),
  actionOf: (v) => (v.recommendedAction === "none" ? "none" : v.recommendedAction),
  confirmedWhenNone: (v) => v.certaintyConfirmed === true && v.criticalFindings.length === 0 && v.unknownSignals.length === 0,
  positivelyClean: (c) =>
    c.reportIntegrity === "clean" &&
    c.spaceInGraph === "known" &&
    (c.mapVersionMatch === "matched" || c.mapVersionMatch === "unassessed") &&
    c.sourceHealth === "healthy" &&
    (c.recency === "current" || c.recency === "unbounded") &&
    (c.confidenceFit === "met" || c.confidenceFit === "unbounded") &&
    satisfies(c.accuracyClass as AccuracyClass, "room_confirmed"),
});
check(
  `exhaustive (normalized): over all ${normRes.combos} states, certainty is confirmed ONLY on the seven-axis conjunction (mismatches=${normRes.mismatches}${normRes.firstMismatch ? ", first=" + normRes.firstMismatch : ""})`,
  normRes.mismatches === 0 && normRes.combos === productOf(normDomains) && normRes.combos === 10368,
);
check("exhaustive (normalized): exactly 24 states grant — 3 sufficient classes (room_confirmed, bed_candidate, bed_confirmed) × 2 map-version × 2 recency × 2 confidence answers",
  normRes.noneCount === 24);

// ── phase 3: clinical bed context ───────────────────────────────────────────────
// Source-capability ceilings: the maximum class a technology can PHYSICALLY
// vouch for, with no partial credit for a claim above it.
check("wifi claiming room_candidate is within its ceiling — the claim stands as claimed",
  applyCapabilityCeiling("room_candidate", "wifi").grading === "within_capability" &&
  applyCapabilityCeiling("room_candidate", "wifi").effectiveClass === "room_candidate");
check("THE CEILING'S TEETH: wifi claiming bed_confirmed exceeds what Wi-Fi can know — and the effective class is UNKNOWN, deliberately NOT demoted to the ceiling (a caught lie gets no partial credit)",
  applyCapabilityCeiling("bed_confirmed", "wifi").grading === "exceeds_capability" &&
  applyCapabilityCeiling("bed_confirmed", "wifi").effectiveClass === "unknown");
check("ir_rtls claiming bed_confirmed is within capability — bed precision is earned by the technology, not the label",
  applyCapabilityCeiling("bed_confirmed", "ir_rtls").grading === "within_capability" &&
  applyCapabilityCeiling("bed_confirmed", "ir_rtls").effectiveClass === "bed_confirmed");
check("an unrecognized technology can vouch for NOTHING — 'quantum_locator' and even the generic 'rtls' label grade unrecognized with effective class unknown",
  applyCapabilityCeiling("bed_confirmed", "quantum_locator").grading === "unrecognized_technology" &&
  applyCapabilityCeiling("bed_confirmed", "quantum_locator").effectiveClass === "unknown" &&
  applyCapabilityCeiling("bed_confirmed", "rtls").grading === "unrecognized_technology");
check("an unstated technology (null / non-string / blank) grades unstated, class unknown",
  applyCapabilityCeiling("room_candidate", null).grading === "unstated_technology" &&
  applyCapabilityCeiling("room_candidate", 42).grading === "unstated_technology" &&
  applyCapabilityCeiling("room_candidate", "  ").effectiveClass === "unknown");
check("a claim of 'unknown' from a recognized technology is within capability and stays unknown — nothing claimed, nothing granted",
  applyCapabilityCeiling("unknown", "ir_rtls").grading === "within_capability" &&
  applyCapabilityCeiling("unknown", "ir_rtls").effectiveClass === "unknown");
check("technology matching normalizes case and whitespace — ' WiFi ' is wifi",
  applyCapabilityCeiling("room_candidate", " WiFi ").grading === "within_capability");

// ADT/FHIR assignment resolution: administrative truth, resolved through
// vendor attachments, coherence-checked against the graph's own hierarchy.
const EHR = { namespace: "ehr" };
const fullAssignment: ClinicalAssignmentRaw = { system: "adt", nursing_unit: "4W", room: "0312", bed: "0312-A" };
const resolvedFull = resolveClinicalAssignment(graph, fullAssignment, EHR);
check("a coherent ADT record (unit 4W / room 0312 / bed 0312-A) resolves to Bed A at depth bed — EHR ids are attachments, never keys",
  resolvedFull.outcome === "resolved" && resolvedFull.targetSpaceId === "SG-RM0312-BED-A" &&
  resolvedFull.targetDepth === "bed" && resolvedFull.system === "adt");
check("a room-only record resolves to the room at depth room",
  resolveClinicalAssignment(graph, { room: "0312" }, EHR).targetSpaceId === "SG-RM0312" &&
  resolveClinicalAssignment(graph, { room: "0312" }, EHR).targetDepth === "room");
check("INCOHERENT: bed 0312-A stated with room 0399 (the corridor) — the record contradicts the graph's own hierarchy and is never 'probably the bed'",
  resolveClinicalAssignment(graph, { room: "0399", bed: "0312-A" }, EHR).outcome === "incoherent" &&
  resolveClinicalAssignment(graph, { room: "0399", bed: "0312-A" }, EHR).targetSpaceId === null);
check("a stated identifier with no attachment in the graph → unmapped, target null",
  resolveClinicalAssignment(graph, { bed: "9999-Z" }, EHR).outcome === "unmapped");
check("an empty record poses nothing → unstated; a record with an unrecognized key, a non-object, and a hostile proxy are all malformed",
  resolveClinicalAssignment(graph, {}, EHR).outcome === "unstated" &&
  resolveClinicalAssignment(graph, { bed: "0312-A", patient_name: "leak" } as ClinicalAssignmentRaw, EHR).outcome === "malformed" &&
  resolveClinicalAssignment(graph, "0312-A" as unknown as ClinicalAssignmentRaw, EHR).outcome === "malformed" &&
  resolveClinicalAssignment(graph, new Proxy({}, { ownKeys: () => { throw new Error("hostile"); } }) as ClinicalAssignmentRaw, EHR).outcome === "malformed");
// A second unit with its own EHR attachment, to prove EVERY pairwise
// coherence edge — bed↔room is not the only one an ADT feed can contradict.
const twoUnitGraph = buildFacilityGraph({
  ...DOC,
  spaces: [
    ...DOC.spaces,
    { spaceId: "SG-F03-UNIT-5E", kind: "unit", name: "5 East Tele", parentId: "SG-HOSP-A-BLDG1-F03",
      vendorRefs: { ehr: { nursing_unit: "5E" } } },
  ],
});
check("INCOHERENT on the bed↔unit edge: bed 0312-A stated under unit 5E — the bed does not descend from the stated unit",
  resolveClinicalAssignment(twoUnitGraph, { nursing_unit: "5E", bed: "0312-A" }, EHR).outcome === "incoherent");
check("INCOHERENT on the room↔unit edge: room 0312 stated under unit 5E",
  resolveClinicalAssignment(twoUnitGraph, { nursing_unit: "5E", room: "0312" }, EHR).outcome === "incoherent");
const trapGraph = buildFacilityGraph({
  ...DOC,
  spaces: DOC.spaces.map((s) => s.spaceId === "SG-RM0312"
    ? { ...s, vendorRefs: { ...s.vendorRefs, ehr: { ...(s.vendorRefs?.ehr ?? {}), bed: "trap" } } } : s),
});
check("an ehr 'bed' id attached to a non-bed space is incoherent — the attachment's kind must match the component's claim",
  resolveClinicalAssignment(trapGraph, { bed: "trap" }, EHR).outcome === "incoherent");

// The explicit-selection ceremony: graded like every attestation — supplied
// bound, supplied reference, absent is a first-class answer.
const SEL_POLICY = { maxSelectionAgeSeconds: 300, referenceTime: REF };
const freshScan: SelectionAttestationRaw = { method: "wristband_scan", attested_at: "2026-07-31T14:30:00Z" };
check("a wristband scan inside the caller's bound is valid",
  gradeExplicitSelection(freshScan, SEL_POLICY).standing === "valid" &&
  gradeExplicitSelection(freshScan, SEL_POLICY).method === "wristband_scan");
check("a scan older than the bound is stale — yesterday's ceremony does not carry today's med pass",
  gradeExplicitSelection({ method: "wristband_scan", attested_at: "2026-07-31T14:00:00Z" }, SEL_POLICY).standing === "stale");
check("a future-dated attestation is never valid, bound or no bound",
  gradeExplicitSelection({ method: "wristband_scan", attested_at: "2026-07-31T15:00:00Z" }, SEL_POLICY).standing === "future_dated" &&
  gradeExplicitSelection({ method: "wristband_scan", attested_at: "2026-07-31T15:00:00Z" }, { referenceTime: REF }).standing === "future_dated");
check("a bound posed but unanswerable (no attested instant / no reference / a nonsense bound) is unverifiable — posed-but-unanswerable raises, everywhere",
  gradeExplicitSelection({ method: "wristband_scan" }, SEL_POLICY).standing === "unverifiable" &&
  gradeExplicitSelection(freshScan, { maxSelectionAgeSeconds: 300 }).standing === "unverifiable" &&
  gradeExplicitSelection(freshScan, { maxSelectionAgeSeconds: -1, referenceTime: REF }).standing === "unverifiable");
check("'room_presence' is not a selection ceremony — an unrecognized method never satisfies",
  gradeExplicitSelection({ method: "room_presence", attested_at: "2026-07-31T14:30:00Z" }, SEL_POLICY).standing === "unrecognized_method");
check("an extra key (a patient identifier trying to cross the boundary) is malformed; absent is absent; a garbled attested instant is malformed, not quietly unverifiable",
  gradeExplicitSelection({ ...freshScan, patient_id: "P123" }, SEL_POLICY).standing === "malformed" &&
  gradeExplicitSelection(undefined, SEL_POLICY).standing === "absent" &&
  gradeExplicitSelection({ method: "wristband_scan", attested_at: "not-a-time" }, SEL_POLICY).standing === "malformed");
check("no bound stated → valid by the operator's explicit visible choice",
  gradeExplicitSelection(freshScan, {}).standing === "valid");

// The bed-workflow composition: certainty, capability, assignment, ceremony.
const normObs = (over: LocationObservationRaw = {}): NormalizedLocationObservation =>
  normalizeLocationObservation("wow-442", graph, clean(over), { requirement: MED_REQ, referenceTime: REF });
const wifiRoom = normObs({ accuracy_class: "room_candidate", observation_source: "wifi", space_id: "SG-RM0312", confidence: 0.78 });
const bed = (over: Record<string, unknown> = {}) => evaluateBedWorkflow(graph, {
  assignment: resolvedFull, observation: wifiRoom, requirement: MED_REQ, selectionPolicy: SEL_POLICY, ...over,
});
const headline = bed();
check("PHASE-3 HEADLINE: a Wi-Fi room fix, a bed_confirmed med workflow, an assigned bed → STEP UP: scan the wristband — never 'open every patient in the room'",
  headline.mode === "step_up_required" && headline.reasonCode === "EXPLICIT_SELECTION_REQUIRED" &&
  headline.recommendedAction === "step_up");
const satisfied = bed({ selection: freshScan });
check("...a valid wristband scan satisfies the step-up: the workflow proceeds",
  satisfied.mode === "explicitly_selected" && satisfied.reasonCode === "EXPLICIT_SELECTION_SATISFIED" &&
  satisfied.recommendedAction === "none");
check("THE PIN: the satisfied ceremony changed the MODE, not the CERTAINTY — achievedClass is still room_candidate and the embedded location verdict still says INSUFFICIENT_PRECISION",
  satisfied.achievedClass === "room_candidate" && satisfied.location.reasonCode === "INSUFFICIENT_PRECISION" &&
  satisfied.location.certaintyConfirmed === false);
check("a STALE scan does not satisfy — step_up stays, with the specific reason",
  bed({ selection: { method: "wristband_scan", attested_at: "2026-07-31T14:00:00Z" } }).reasonCode === "SELECTION_STALE" &&
  bed({ selection: { method: "wristband_scan", attested_at: "2026-07-31T14:00:00Z" } }).recommendedAction === "step_up");
const irBedA = normObs({ accuracy_class: "bed_confirmed", observation_source: "ir_rtls", space_id: "SG-RM0312-BED-A" });
const confirmed = bed({ observation: irBedA });
check("IR-RTLS bed_confirmed AT the assigned bed → location_confirmed: the only path that proceeds on location alone",
  confirmed.mode === "location_confirmed" && confirmed.reasonCode === "BED_CERTAINTY_CONFIRMED" &&
  confirmed.recommendedAction === "none" && confirmed.achievedClass === "bed_confirmed");
const irBedB = normObs({ accuracy_class: "bed_confirmed", observation_source: "ir_rtls" }); // clean() sits at Bed B
check("WRONG BED: bed_confirmed at Bed B while assigned to Bed A → ASSIGNMENT_LOCATION_MISMATCH steps up; the scan ceremony satisfies it",
  bed({ observation: irBedB }).reasonCode === "ASSIGNMENT_LOCATION_MISMATCH" &&
  bed({ observation: irBedB }).recommendedAction === "step_up" &&
  bed({ observation: irBedB, selection: freshScan }).mode === "explicitly_selected");
const wifiLie = normObs({ accuracy_class: "bed_confirmed", observation_source: "wifi", space_id: "SG-RM0312" });
check("THE LIE IS NOT STEPPABLE: wifi claiming bed_confirmed → blocked with an ALERT, and a valid scan does NOT cure it — a ceremony never launders a source that claimed what it cannot know",
  bed({ observation: wifiLie }).mode === "blocked" &&
  bed({ observation: wifiLie }).reasonCode === "SOURCE_CLAIM_EXCEEDS_CAPABILITY" &&
  bed({ observation: wifiLie }).recommendedAction === "alert" &&
  bed({ observation: wifiLie, selection: freshScan }).mode === "blocked");
const wrongMapObs = normObs({ observation_source: "ir_rtls", map_version: "2025.11.02" });
check("a wrong-map fix stays RESTRICT even with a valid scan — restrict-class concerns are not steppable",
  bed({ observation: wrongMapObs, selection: freshScan }).mode === "blocked" &&
  bed({ observation: wrongMapObs, selection: freshScan }).reasonCode === "LOCATION_BLOCKED" &&
  bed({ observation: wrongMapObs, selection: freshScan }).recommendedAction === "restrict");
check("NO ASSIGNMENT: bed_confirmed presence at Bed A with nothing assigned still requires the ceremony — presence alone never picks a patient; the scan then proceeds",
  bed({ observation: irBedA, assignment: resolveClinicalAssignment(graph, {}, EHR) }).reasonCode === "EXPLICIT_SELECTION_REQUIRED" &&
  bed({ observation: irBedA, assignment: resolveClinicalAssignment(graph, {}, EHR), selection: freshScan }).mode === "explicitly_selected");
check("a BROKEN assignment (unmapped bed id) is an alert the ceremony cannot cure — clinical mapping failed at operator scale",
  bed({ assignment: resolveClinicalAssignment(graph, { bed: "9999-Z" }, EHR), selection: freshScan }).mode === "blocked" &&
  bed({ assignment: resolveClinicalAssignment(graph, { bed: "9999-Z" }, EHR), selection: freshScan }).reasonCode === "ASSIGNMENT_BROKEN");
const darkObs = normObs({ observation_source: "ir_rtls", source_health: "unavailable" });
check("location gone DARK is step_up class — the ceremony is exactly the degraded-mode workflow, so a valid scan proceeds; without one, step up",
  bed({ observation: darkObs }).recommendedAction === "step_up" &&
  bed({ observation: darkObs, selection: freshScan }).mode === "explicitly_selected");
const genericRtls = normObs({ accuracy_class: "bed_confirmed", observation_source: "rtls", space_id: "SG-RM0312-BED-A" });
check("the generic 'rtls' label cannot vouch for bed certainty — unrecognized technology grades unknown and the workflow steps up to the ceremony instead of trusting the label",
  bed({ observation: genericRtls }).mode === "step_up_required" &&
  bed({ observation: genericRtls }).achievedClass === "unknown" &&
  bed({ observation: genericRtls, selection: freshScan }).mode === "explicitly_selected");
check("a HAND-CRAFTED resolution claiming a target while unstated (a buggy caller) can never reach location_confirmed — the grant re-checks the outcome, not just the target",
  bed({ observation: irBedA, assignment: {
    outcome: "unstated" as const, targetSpaceId: "SG-RM0312-BED-A", targetDepth: "bed" as const,
    components: { unit: "unstated" as const, room: "unstated" as const, bed: "unstated" as const }, system: null,
  } }).mode === "step_up_required");
check("the bed-workflow evaluator is deterministic",
  JSON.stringify(bed({ selection: freshScan })) === JSON.stringify(bed({ selection: freshScan })));

// ── zone-presence transitions: dwell, grace, hysteresis (ledger row 17) ────────
// Presence is earned; exit is confirmed; silence does neither.
const ZONE = "SG-RM0312";
const at = (s: string, space = ZONE) => ({ space_id: space, observed_at: s });
const zp = (observations: Array<{ space_id?: unknown; observed_at?: unknown }>, over: Record<string, unknown> = {}) =>
  gradeZonePresence(graph, {
    zoneId: ZONE,
    exitBoundaryId: "SG-F03-UNIT-4W",
    observations,
    policy: { entryDwellSeconds: 30, exitGraceSeconds: 60, maxObservationAgeSeconds: 120 },
    referenceTime: "2026-07-31T14:32:30Z",
    ...over,
  });
check("ONE BLIP IS NOT AN ENTRY: a single in-zone observation spans zero seconds and never meets a positive dwell — state is crossing, presence NOT confirmed",
  zp([at("2026-07-31T14:32:20Z")]).state === "crossing" &&
  zp([at("2026-07-31T14:32:20Z")]).reasonCode === "ENTRY_DWELL_NOT_MET" &&
  zp([at("2026-07-31T14:32:20Z")]).presenceConfirmed === false);
check("PRESENCE IS EARNED: continuous in-zone evidence spanning the dwell (30.000s inclusive) → present; 29s → still crossing",
  zp([at("2026-07-31T14:31:55Z"), at("2026-07-31T14:32:25Z")]).state === "present" &&
  zp([at("2026-07-31T14:31:56Z"), at("2026-07-31T14:32:25Z")]).state === "crossing");
check("a blip that ends before dwell is met is never_present (ENTRY_NOT_SUSTAINED) — the visit was a blip, not an entry",
  zp([at("2026-07-31T14:31:00Z"), at("2026-07-31T14:31:05Z", "SG-F03-CORRIDOR-W")]).state === "never_present" &&
  zp([at("2026-07-31T14:31:00Z"), at("2026-07-31T14:31:05Z", "SG-F03-CORRIDOR-W")]).reasonCode === "ENTRY_NOT_SUSTAINED");
const settled = [at("2026-07-31T14:30:00Z"), at("2026-07-31T14:31:30Z")]; // 90s dwell, earned
check("ONE MISSING OBSERVATION NEVER REVOKES: earned presence with a corridor observation inside the grace window → probably_outside, action MONITOR — retained, watched",
  zp([...settled, at("2026-07-31T14:32:00Z", "SG-F03-CORRIDOR-W")]).state === "probably_outside" &&
  zp([...settled, at("2026-07-31T14:32:00Z", "SG-F03-CORRIDOR-W")]).reasonCode === "ZONE_EXITED_WITHIN_GRACE" &&
  zp([...settled, at("2026-07-31T14:32:00Z", "SG-F03-CORRIDOR-W")]).recommendedAction === "monitor");
check("HYSTERESIS VIA CONTAINMENT: past grace but every later observation is still inside the exit boundary (the unit) → probably_outside, never confirmed",
  zp([...settled, at("2026-07-31T14:31:31Z", "SG-F03-CORRIDOR-W")],
    { referenceTime: "2026-07-31T14:35:00Z" }).state === "probably_outside" &&
  zp([...settled, at("2026-07-31T14:31:31Z", "SG-F03-CORRIDOR-W")],
    { referenceTime: "2026-07-31T14:35:00Z" }).reasonCode === "WITHIN_EXIT_BOUNDARY");
check("EXIT IS CONFIRMED only by an affirmative observation OUTSIDE the boundary past grace — observed on the medication zone side of the floor, outside 4 West",
  zp([...settled, at("2026-07-31T14:31:40Z", "SG-F03-ZONE-MED")],
    { referenceTime: "2026-07-31T14:35:00Z" }).state === "confirmed_outside" &&
  zp([...settled, at("2026-07-31T14:31:40Z", "SG-F03-ZONE-MED")],
    { referenceTime: "2026-07-31T14:35:00Z" }).recommendedAction === "step_up");
check("SILENCE NEVER CONFIRMS AN EXIT: earned presence then nothing, past grace → probably_outside PRESENCE_EVIDENCE_EXPIRED (step_up), NOT confirmed_outside — a dead access point is not a door event",
  zp(settled, { referenceTime: "2026-07-31T14:40:00Z" }).state === "probably_outside" &&
  zp(settled, { referenceTime: "2026-07-31T14:40:00Z" }).reasonCode === "PRESENCE_EVIDENCE_EXPIRED" &&
  zp(settled, { referenceTime: "2026-07-31T14:40:00Z" }).recommendedAction === "step_up");
check("the grace bound alone expires silent presence: NO staleness bound posed, silence past grace → probably_outside PRESENCE_EVIDENCE_EXPIRED — omitting the staleness bound never buys eternal presence",
  zp(settled, { referenceTime: "2026-07-31T14:40:00Z", policy: { entryDwellSeconds: 30, exitGraceSeconds: 60 } }).state === "probably_outside" &&
  zp(settled, { referenceTime: "2026-07-31T14:40:00Z", policy: { entryDwellSeconds: 30, exitGraceSeconds: 60 } }).reasonCode === "PRESENCE_EVIDENCE_EXPIRED");
check("a stale-but-in-grace in-zone word is probably_outside EVIDENCE_STALE (monitor) — a posed staleness bound cannot hold `present` on old evidence",
  zp([at("2026-07-31T14:28:00Z"), at("2026-07-31T14:30:00Z")],
    { policy: { entryDwellSeconds: 30, exitGraceSeconds: 600, maxObservationAgeSeconds: 120 } }).state === "probably_outside" &&
  zp([at("2026-07-31T14:28:00Z"), at("2026-07-31T14:30:00Z")],
    { policy: { entryDwellSeconds: 30, exitGraceSeconds: 600, maxObservationAgeSeconds: 120 } }).reasonCode === "EVIDENCE_STALE");
check("no in-zone observation at all → never_present (step_up); an EMPTY sequence is unknown — no evidence cannot answer a posed question",
  zp([at("2026-07-31T14:31:00Z", "SG-F03-CORRIDOR-W")]).state === "never_present" &&
  zp([]).state === "unknown" && zp([]).reasonCode === "NO_OBSERVATIONS");
check("unreadable inputs all raise: garbled instant, unmapped space, disordered sequence, future-dated observation, boundary that does not contain the zone, unmapped zone",
  zp([{ space_id: ZONE, observed_at: "not-a-time" }]).state === "unknown" &&
  zp([at("2026-07-31T14:31:00Z", "SG-GHOST-WING")]).state === "unknown" &&
  zp([at("2026-07-31T14:32:00Z"), at("2026-07-31T14:31:00Z")]).reasonCode === "SEQUENCE_DISORDERED" &&
  zp([at("2026-07-31T14:33:00Z")]).reasonCode === "OBSERVATION_FUTURE_DATED" &&
  zp([at("2026-07-31T14:31:00Z")], { exitBoundaryId: "SG-F03-CORRIDOR-W" }).reasonCode === "EXIT_BOUNDARY_INVALID" &&
  zp([at("2026-07-31T14:31:00Z")], { zoneId: "SG-GHOST-WING" }).reasonCode === "ZONE_NOT_IN_GRAPH");
check("a nonsense policy (negative dwell, zero staleness bound) is unreadable, never a default",
  zp([at("2026-07-31T14:31:00Z")], { policy: { entryDwellSeconds: -1, exitGraceSeconds: 60 } }).reasonCode === "POLICY_UNREADABLE" &&
  zp([at("2026-07-31T14:31:00Z")], { policy: { entryDwellSeconds: 30, exitGraceSeconds: 60, maxObservationAgeSeconds: 0 } }).reasonCode === "POLICY_UNREADABLE");
check("presenceConfirmed is true for exactly ONE state — present — and the grader is deterministic",
  zp([...settled]).presenceConfirmed === true && zp([...settled]).state === "present" &&
  JSON.stringify(zp([...settled])) === JSON.stringify(zp([...settled])));

// ── fusion into the fabric ──────────────────────────────────────────────────────
check("location_certainty is a member of the runtime SIGNAL_KINDS array",
  (SIGNAL_KINDS as readonly string[]).includes("location_certainty"));
const fusedRoomOnly = fromLocationCertainty(roomOnly);
check("fromLocationCertainty maps the multi-bed step-up onto the unified ladder",
  fusedRoomOnly.kind === "location_certainty" && fusedRoomOnly.action === "step_up" && fusedRoomOnly.reason === "INSUFFICIENT_PRECISION");
const fused = composeDeviceRisk([
  { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
  { kind: "shift_context", posture: "on_shift_clocked_in", action: "none", reason: "ON_SHIFT_AND_ON_CLOCK" },
  fusedRoomOnly,
]);
check("THE HEADLINE: a healthy device, an on-shift clocked-in nurse, and only ROOM-level certainty for a bed-level workflow no longer composes to an allow",
  fused.strongestAction === "step_up" && fused.drivers[0]?.kind === "location_certainty");
check("...and a confirmed certainty contributes none — the dimension never lowers, only raises",
  composeDeviceRisk([
    { kind: "device_posture", posture: "healthy", action: "none", reason: "OK" },
    fromLocationCertainty(grant),
  ]).strongestAction === "none");

// Determinism.
const d1 = normalizeLocationObservation("det", graph, clean(), { requirement: MED_REQ, referenceTime: REF });
check("evaluator is deterministic",
  JSON.stringify(evaluateLocationCertainty(d1, MED_REQ)) === JSON.stringify(evaluateLocationCertainty(d1, MED_REQ)));

const total = passed + failures.length;
console.log(`figures=graphSpaces=${graph.derived.total},normalizedCombos=${normRes.combos},grantingCombos=${normRes.noneCount},accuracyClasses=${ACCURACY_CLASSES.length},ladderRungs=6`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
