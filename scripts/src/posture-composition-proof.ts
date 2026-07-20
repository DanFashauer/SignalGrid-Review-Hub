// Posture-composition proof — pure and deterministic, no I/O.
//
// Proves the fusion of the five decision signals into one unified posture: the
// strongest action across all signals wins (fail-safe — a calm signal never
// dilutes a severe one), the risk tier follows from it, drivers come back
// most-severe-first with stable ordering, and the per-dimension adapters map
// onto the unified ladder correctly.
import {
  composeDeviceRisk,
  fromDetection,
  fromDevicePosture,
  fromLocation,
  fromReachability,
  fromVuln,
  type ComposableSignal,
} from "@workspace/posture-composition";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Posture-composition proof");

// ── adapters map each dimension onto the unified ladder ───────────────────────
check("reachability escalate → escalate",
  fromReachability({ posture: "unreachable", reasonCode: "FULLY_UNREACHABLE", recommendedAction: "escalate", locatable: false }).action === "escalate");
check("location locate → locate",
  fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false }).action === "locate");
check("vuln restrict → restrict",
  fromVuln({ posture: "critical_exposure", highestSeverity: "critical", findingCount: 1, exploitableCount: 1, reasonCode: "CRITICAL_OR_EXPLOITABLE", recommendedAction: "restrict" }).action === "restrict");
check("detection critical → escalate",
  fromDetection({ code: "DOCK_TAMPER_WITH_NETWORK_LOSS", severity: "critical", reason: "x", correlationId: "c", evidenceEventIds: [] }).action === "escalate");
check("device posture disabled identity → escalate",
  fromDevicePosture(posture({ identityStatus: "disabled" })).action === "escalate");
check("device posture non-compliant → restrict",
  fromDevicePosture(posture({ deviceComplianceState: "non_compliant" })).action === "restrict");
check("device posture unmanaged → step_up",
  fromDevicePosture(posture({ deviceManagementState: "unmanaged" })).action === "step_up");
check("device posture compliant+managed → none",
  fromDevicePosture(posture({})).action === "none");

// ── composition: strongest action wins, tier follows ──────────────────────────
const mixed: ComposableSignal[] = [
  fromDevicePosture(posture({})),                         // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false }), // locate
  fromVuln({ posture: "critical_exposure", highestSeverity: "critical", findingCount: 2, exploitableCount: 1, reasonCode: "CRITICAL_OR_EXPLOITABLE", recommendedAction: "restrict" }), // restrict
];
const u = composeDeviceRisk(mixed);
check("strongest action wins (restrict over locate/monitor/none)", u.strongestAction === "restrict");
check("risk tier follows the strongest action (restrict ⇒ blocked)", u.riskTier === "blocked");
check("all signals are retained as drivers", u.signalCount === 4 && u.drivers.length === 4);
check("drivers are ordered most-severe first", u.drivers[0].action === "restrict" && u.drivers[u.drivers.length - 1].action === "none");

// escalate outranks restrict.
const withDetection = composeDeviceRisk([...mixed, fromDetection({ code: "DOCK_TAMPER_WITH_NETWORK_LOSS", severity: "critical", reason: "x", correlationId: "c", evidenceEventIds: [] })]);
check("a critical detection (escalate) outranks a restrict", withDetection.strongestAction === "escalate" && withDetection.riskTier === "blocked");

// tiers across the ladder
check("all-calm signals ⇒ ok tier", composeDeviceRisk([fromDevicePosture(posture({})), fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true })]).riskTier === "ok");
check("a step_up ⇒ at_risk tier", composeDeviceRisk([fromDevicePosture(posture({ deviceManagementState: "unmanaged" }))]).riskTier === "at_risk");
check("a locate ⇒ watch tier", composeDeviceRisk([fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false })]).riskTier === "watch");

// no signals ⇒ ok/none, distinguishable by signalCount.
const empty = composeDeviceRisk([]);
check("no signals ⇒ ok / none / signalCount 0", empty.riskTier === "ok" && empty.strongestAction === "none" && empty.signalCount === 0);

// determinism + stable ordering for equal ranks.
const a = composeDeviceRisk(mixed);
const b = composeDeviceRisk(mixed);
check("composition is deterministic", JSON.stringify(a) === JSON.stringify(b));
const equalRank: ComposableSignal[] = [
  { kind: "reachability", posture: "p1", action: "alert", reason: "R1" },
  { kind: "vulnerability", posture: "p2", action: "alert", reason: "R2" },
];
const stable = composeDeviceRisk(equalRank);
check("equal-rank drivers keep input order (stable sort)", stable.drivers[0].reason === "R1" && stable.drivers[1].reason === "R2");

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }

// Build a GraphPostureSignal with sane compliant defaults, overriding as needed.
function posture(over: Partial<import("@workspace/integrations/graph").GraphPostureSignal>): import("@workspace/integrations/graph").GraphPostureSignal {
  return {
    sourceSystem: "microsoft-graph",
    correlationId: "u:d",
    observedAt: "2026-07-20T12:00:00.000Z",
    subjectId: "u",
    identityStatus: "enabled",
    userRisk: "none",
    deviceId: "d",
    deviceComplianceState: "compliant",
    deviceManagementState: "managed",
    deviceRegistrationState: "registered",
    deviceLastSeenAt: "2026-07-20T11:59:00Z",
    ...over,
  };
}
