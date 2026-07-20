// Posture-composition proof — pure and deterministic, no I/O.
//
// Proves the fusion of the decision signals into one unified posture: the
// strongest action across all signals wins (fail-safe — a calm signal never
// dilutes a severe one), the risk tier follows from it, drivers come back
// most-severe-first with stable ordering, and the per-dimension adapters map
// onto the unified ladder correctly.
import {
  composeDeviceRisk,
  fromDetection,
  fromDevicePosture,
  fromLocation,
  fromCustody,
  fromIdentityRisk,
  fromPeripheral,
  fromReachability,
  fromThreat,
  fromVuln,
  type ComposableSignal,
} from "@workspace/posture-composition";
import type { ThreatVerdict } from "@workspace/integrations/edr-threat";
import type { IdentityRiskVerdict } from "@workspace/integrations/identity-risk";
import type { CustodyVerdict } from "@workspace/integrations/rtls-custody";
import type { PeripheralVerdict } from "@workspace/integrations/peripheral-control";

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
check("threat critical_compromise → escalate",
  fromThreat(threat({ posture: "critical_compromise", reasonCode: "CRITICAL_ACTIVE_THREAT", recommendedAction: "escalate", activeThreatCount: 1 })).action === "escalate");
check("threat active_threat → restrict",
  fromThreat(threat({ posture: "active_threat", reasonCode: "ACTIVE_THREAT", recommendedAction: "restrict", activeThreatCount: 1 })).action === "restrict");
check("threat unprotected (agent absent) → alert",
  fromThreat(threat({ posture: "unprotected", reasonCode: "AGENT_ABSENT", recommendedAction: "alert", protectionHealthy: false })).action === "alert");
check("threat degraded_protection → step_up",
  fromThreat(threat({ posture: "degraded_protection", reasonCode: "PROTECTION_DEGRADED", recommendedAction: "step_up", protectionHealthy: false })).action === "step_up");
check("threat protected → none, and its kind is 'threat'",
  fromThreat(threat({})).action === "none" && fromThreat(threat({})).kind === "threat");
check("identity compromised → escalate",
  fromIdentityRisk(identity({ posture: "compromised", reasonCode: "CONFIRMED_COMPROMISED", recommendedAction: "escalate" })).action === "escalate");
check("identity high_risk → restrict",
  fromIdentityRisk(identity({ posture: "high_risk", reasonCode: "HIGH_RISK_SIGNIN", recommendedAction: "restrict", riskLevel: "high" })).action === "restrict");
check("identity at_risk → step_up",
  fromIdentityRisk(identity({ posture: "at_risk", reasonCode: "MEDIUM_RISK_SIGNIN", recommendedAction: "step_up", riskLevel: "medium" })).action === "step_up");
check("identity trusted → none, and its kind is 'identity'",
  fromIdentityRisk(identity({})).action === "none" && fromIdentityRisk(identity({})).kind === "identity");
check("custody left_area → escalate",
  fromCustody(custody({ posture: "left_area", reasonCode: "LEFT_AREA", recommendedAction: "escalate" })).action === "escalate");
check("custody at_egress → alert",
  fromCustody(custody({ posture: "at_egress", reasonCode: "AT_EGRESS", recommendedAction: "alert" })).action === "alert");
check("custody stale_fix → locate",
  fromCustody(custody({ posture: "stale_fix", reasonCode: "STALE_FIX", recommendedAction: "locate" })).action === "locate");
check("custody in_zone → none, and its kind is 'custody'",
  fromCustody(custody({})).action === "none" && fromCustody(custody({})).kind === "custody");
check("peripheral exfil_risk → restrict",
  fromPeripheral(peripheral({ posture: "exfil_risk", reasonCode: "UNAUTHORIZED_UNENCRYPTED_MEDIA", recommendedAction: "restrict" })).action === "restrict");
check("peripheral unencrypted_media → alert",
  fromPeripheral(peripheral({ posture: "unencrypted_media", reasonCode: "UNENCRYPTED_WRITABLE_MEDIA", recommendedAction: "alert" })).action === "alert");
check("peripheral policy_unenforced → step_up",
  fromPeripheral(peripheral({ posture: "policy_unenforced", reasonCode: "POLICY_UNENFORCED", recommendedAction: "step_up" })).action === "step_up");
check("peripheral no_removable → none, and its kind is 'peripheral'",
  fromPeripheral(peripheral({})).action === "none" && fromPeripheral(peripheral({})).kind === "peripheral");
check("device posture disabled identity → escalate",
  fromDevicePosture(posture({ identityStatus: "disabled" })).action === "escalate");
check("device posture non-compliant → restrict",
  fromDevicePosture(posture({ deviceComplianceState: "non_compliant" })).action === "restrict");
check("device posture unmanaged → step_up",
  fromDevicePosture(posture({ deviceManagementState: "unmanaged" })).action === "step_up");
check("device posture high user-risk → alert",
  fromDevicePosture(posture({ userRisk: "high" })).action === "alert");
check("device posture compliant+managed → none",
  fromDevicePosture(posture({})).action === "none");

// ── order-proof: the STRONGEST device-posture concern wins (a severe signal is
// never diluted by a calmer one checked later — regression for the adapter bug) ──
check("high user-risk (alert) is NOT diluted by unmanaged (step_up) → alert",
  fromDevicePosture(posture({ userRisk: "high", deviceManagementState: "unmanaged" })).action === "alert");
check("high user-risk (alert) is NOT diluted by missing compliance (step_up) → alert",
  fromDevicePosture(posture({ userRisk: "high", deviceComplianceState: "missing" })).action === "alert");
check("non-compliant (restrict) outranks a high-risk user (alert) → restrict",
  fromDevicePosture(posture({ userRisk: "high", deviceComplianceState: "non_compliant" })).action === "restrict");
check("disabled identity (escalate) outranks everything → escalate",
  fromDevicePosture(posture({ identityStatus: "disabled", deviceComplianceState: "non_compliant", userRisk: "high" })).action === "escalate");

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

// an active EDR threat fuses in and drives the verdict alongside the others.
const withThreat = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromThreat(threat({ posture: "critical_compromise", reasonCode: "CRITICAL_ACTIVE_THREAT", recommendedAction: "escalate", activeThreatCount: 1, threatCount: 1 })), // escalate
]);
check("an active critical EDR threat (escalate) drives the fused verdict", withThreat.strongestAction === "escalate" && withThreat.riskTier === "blocked");
check("the threat signal is retained as a driver, tagged kind 'threat'", withThreat.drivers.some((d) => d.kind === "threat" && d.action === "escalate"));

// identity/SSO sign-in risk fuses in: a compliant, reachable device whose USER
// is confirmed-compromised composes to escalate/blocked — device fine, identity not.
const withIdentity = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
  fromIdentityRisk(identity({ posture: "compromised", reasonCode: "CONFIRMED_COMPROMISED", recommendedAction: "escalate", riskState: "confirmed_compromised" })), // escalate
]);
check("a confirmed-compromised identity (escalate) drives the fused verdict on an otherwise-clean device", withIdentity.strongestAction === "escalate" && withIdentity.riskTier === "blocked");
check("the identity signal is retained as a driver, tagged kind 'identity'", withIdentity.drivers.some((d) => d.kind === "identity" && d.action === "escalate"));

// RTLS physical custody fuses in: a device that has left the monitored area
// composes to escalate/blocked even when its cyber signals are calm.
const withCustody = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromVuln({ posture: "clean", highestSeverity: "info", findingCount: 0, exploitableCount: 0, reasonCode: "NO_FINDINGS", recommendedAction: "none" }), // none
  fromCustody(custody({ posture: "left_area", reasonCode: "LEFT_AREA", recommendedAction: "escalate" })), // escalate
]);
check("a device that left the monitored area (escalate) drives the fused verdict", withCustody.strongestAction === "escalate" && withCustody.riskTier === "blocked");
check("the custody signal is retained as a driver, tagged kind 'custody'", withCustody.drivers.some((d) => d.kind === "custody" && d.action === "escalate"));

// Removable-media fuses in: an unauthorized unencrypted writable USB on an
// otherwise-compliant device composes to restrict/blocked.
const withPeripheral = composeDeviceRisk([
  fromDevicePosture(posture({})),                                                                 // none
  fromCustody(custody({})),                                                                        // none (in-zone)
  fromPeripheral(peripheral({ posture: "exfil_risk", reasonCode: "UNAUTHORIZED_UNENCRYPTED_MEDIA", recommendedAction: "restrict", writableRemovableCount: 1 })), // restrict
]);
check("an unauthorized+unencrypted writable USB (restrict) drives the fused verdict", withPeripheral.strongestAction === "restrict" && withPeripheral.riskTier === "blocked");
check("the peripheral signal is retained as a driver, tagged kind 'peripheral'", withPeripheral.drivers.some((d) => d.kind === "peripheral" && d.action === "restrict"));

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

// Build a ThreatVerdict with sane "protected" defaults, overriding as needed.
function threat(over: Partial<ThreatVerdict>): ThreatVerdict {
  return {
    posture: "protected",
    highestThreatSeverity: "info",
    threatCount: 0,
    activeThreatCount: 0,
    protectionHealthy: true,
    reasonCode: "NO_THREATS_HEALTHY",
    recommendedAction: "none",
    ...over,
  };
}

// Build an IdentityRiskVerdict with sane "trusted" defaults, overriding as needed.
function identity(over: Partial<IdentityRiskVerdict>): IdentityRiskVerdict {
  return {
    posture: "trusted",
    riskLevel: "none",
    riskState: "unknown",
    detectionCount: 0,
    highestDetectionGrade: null,
    mfaSatisfied: true,
    reasonCode: "NO_RISK",
    recommendedAction: "none",
    ...over,
  };
}

// Build a CustodyVerdict with sane "in_zone" defaults, overriding as needed.
function custody(over: Partial<CustodyVerdict>): CustodyVerdict {
  return {
    posture: "in_zone",
    zoneId: "z1",
    zoneType: "clinical",
    fixAgeSeconds: 30,
    dwellSeconds: 120,
    badgeAssociated: true,
    reasonCode: "CUSTODY_OK",
    recommendedAction: "none",
    ...over,
  };
}

// Build a PeripheralVerdict with sane "no_removable" defaults, overriding as needed.
function peripheral(over: Partial<PeripheralVerdict>): PeripheralVerdict {
  return {
    posture: "no_removable",
    removableCount: 0,
    writableRemovableCount: 0,
    policyEnforced: true,
    reasonCode: "NO_REMOVABLE",
    recommendedAction: "none",
    ...over,
  };
}
