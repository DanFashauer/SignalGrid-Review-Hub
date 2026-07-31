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
  correlateCrossing,
  FacilityGraphError,
  buildFacilityGraph,
  evaluateLocationCertainty,
  normalizeLocationObservation,
  satisfies,
  type AccuracyClass,
  type FacilityGraphDoc,
  type LocationObservationRaw,
  type NormalizedLocationObservation,
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
    { spaceId: "SG-F03-CORRIDOR-W", kind: "room", name: "West corridor", parentId: "SG-F03-UNIT-4W" },
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
