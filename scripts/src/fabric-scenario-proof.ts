// Signal-fabric capstone proof — the whole fabric working as ONE decision, fully
// OFFLINE and deterministic.
//
// The other proofs verify each dimension in isolation. This one proves the
// INTEGRATION the founder's North Star actually asks for: take a realistic shared
// clinical device, run every signal, fuse them into one verdict, and turn that
// verdict into one prioritized incident — so a human sees a single answer, not
// eight dashboards. It also exercises the event-contract cross-domain path
// (timeline → detection → incident). No network, no real data.
import {
  composeDeviceRisk,
  fromCustody,
  fromDevicePosture,
  fromIdentityRisk,
  fromLocation,
  fromNetwork,
  fromPeripheral,
  fromReachability,
  fromThreat,
  fromVuln,
  type ComposableSignal,
} from "@workspace/posture-composition";
import { evaluateVulnPosture, normalizeFinding } from "@workspace/integrations/vuln-scan";
import { evaluateThreatPosture, normalizeEndpoint } from "@workspace/integrations/edr-threat";
import { evaluateIdentityRisk, normalizePrincipal } from "@workspace/integrations/identity-risk";
import { evaluateCustodyPosture, normalizeLocation } from "@workspace/integrations/rtls-custody";
import { evaluatePeripheralPosture, normalizeDevice } from "@workspace/integrations/peripheral-control";
import type { GraphPostureSignal } from "@workspace/integrations/graph";
import { mapDetectionToIncident, mapPostureToIncident } from "@workspace/incident-playbook";
import { detectCrossDomain, validateEvent, type SignalGridEvent } from "@workspace/event-contract";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Signal-fabric capstone proof (fabric → fusion → incident)");

// A compliant, managed device-posture baseline (Graph/MDM) unless overridden.
function devicePosture(over: Partial<GraphPostureSignal> = {}): GraphPostureSignal {
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

// ── Scenario A — a nurse's shared tablet, lost after shift ─────────────────────
// Cyber signals are calm (compliant, patched, protected), but the device has
// physically left the ward and dropped off cellular — a custody breach. The fabric
// must escalate on the physical/reachability plane even though every cyber signal
// says "fine".
{
  const signals: ComposableSignal[] = [
    fromDevicePosture(devicePosture()),                                                                    // none
    fromVuln(evaluateVulnPosture([], { scanned: true })),                                                  // clean → none
    fromThreat(evaluateThreatPosture(normalizeEndpoint({ deviceId: "d", agentInstalled: true, agentRunning: true, realtimeProtection: true, signatureAgeHours: 2, threats: [] }))), // protected → none
    fromIdentityRisk(evaluateIdentityRisk(normalizePrincipal({ principalId: "nurse", riskLevel: "none" }))), // trusted → none
    fromPeripheral(evaluatePeripheralPosture(normalizeDevice({ deviceId: "d", policyEnforced: true, peripherals: [] }))), // no_removable → none
    fromCustody(evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "egress", zoneAuthorized: true, fixAgeSeconds: 300, present: false }))), // left_area → escalate
    fromReachability({ posture: "unreachable", reasonCode: "FULLY_UNREACHABLE", recommendedAction: "escalate", locatable: false }), // escalate
    fromLocation({ posture: "off_premises", reasonCode: "OUTSIDE_AUTHORIZED_GEOFENCE", recommendedAction: "locate", locatable: true, usesPreciseLocation: false }), // locate
    fromNetwork({ posture: "network_unknown", reasonCode: "NETWORK_STATE_UNKNOWN", recommendedAction: "monitor", accessLocation: null }), // monitor
  ];
  const unified = composeDeviceRisk(signals);
  check("A: lost tablet fuses to escalate / blocked despite calm cyber signals", unified.strongestAction === "escalate" && unified.riskTier === "blocked");
  check("A: the custody + reachability escalations are both retained as drivers", unified.drivers.filter((d) => d.action === "escalate").length === 2);

  const incident = mapPostureToIncident(unified, { impact: "high", correlationId: "cust-A", subjectLabel: "ward tablet ipad-ward-01" });
  check("A: the fused verdict becomes a P1 escalation incident", incident !== null && incident.priority === "P1" && incident.escalate === true);
  check("A: P1 carries the ITSM 15-minute response SLA", incident !== null && incident.sla.responseMinutes === 15);
}

// ── Scenario B — compliant device, compromised identity + unauthorized USB ─────
// The device itself is compliant and on the trusted segment, but the USER is
// confirmed-compromised AND an unauthorized unencrypted USB is attached. The fabric
// must block on the identity/data-exfil planes even though the device posture is OK.
{
  const signals: ComposableSignal[] = [
    fromDevicePosture(devicePosture()),                                                                    // none
    fromVuln(evaluateVulnPosture([normalizeFinding({ deviceId: "d", severity: "low", cvssScore: 2.0 })])), // low_risk → monitor
    fromThreat(evaluateThreatPosture(normalizeEndpoint({ deviceId: "d", agentInstalled: true, agentRunning: true, realtimeProtection: true, signatureAgeHours: 1, threats: [] }))), // protected → none
    fromIdentityRisk(evaluateIdentityRisk(normalizePrincipal({ principalId: "clerk", riskLevel: "high", riskState: "confirmedCompromised" }))), // compromised → escalate
    fromPeripheral(evaluatePeripheralPosture(normalizeDevice({ deviceId: "d", policyEnforced: true, peripherals: [{ peripheralId: "u", class: "mass_storage", access: "read_write", authorized: false, encrypted: false }] }))), // exfil_risk → restrict
    fromCustody(evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 20, dwellSeconds: 300, badgeAssociated: true, present: true }))), // in_zone → none
    fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
    fromNetwork({ posture: "on_trusted_segment", reasonCode: "AUTHENTICATED_TRUSTED_SEGMENT", recommendedAction: "none", accessLocation: "swport-3/14" }), // none
  ];
  const unified = composeDeviceRisk(signals);
  check("B: compromised identity (escalate) drives the verdict over a compliant device", unified.strongestAction === "escalate" && unified.riskTier === "blocked");
  check("B: the exfil-risk USB (restrict) is retained as a driver alongside it", unified.drivers.some((d) => d.kind === "peripheral" && d.action === "restrict"));

  const incident = mapPostureToIncident(unified, { impact: "high", correlationId: "cust-B", subjectLabel: "checkout clerk workstation" });
  check("B: the fused verdict becomes a P1 escalation incident", incident !== null && incident.priority === "P1" && incident.escalate === true);
}

// ── Scenario C — an ordinary, healthy checkout (the common case) ───────────────
// Every signal is calm. The fabric must produce NO incident — the no-noise rule.
// This is the case that matters most for "device management should be the least of
// anyone's concern": a normal device generates zero tickets.
{
  const signals: ComposableSignal[] = [
    fromDevicePosture(devicePosture()),                                                                    // none
    fromVuln(evaluateVulnPosture([], { scanned: true })),                                                  // clean → none
    fromThreat(evaluateThreatPosture(normalizeEndpoint({ deviceId: "d", agentInstalled: true, agentRunning: true, realtimeProtection: true, signatureAgeHours: 1, threats: [] }))), // protected → none
    fromIdentityRisk(evaluateIdentityRisk(normalizePrincipal({ principalId: "nurse", riskLevel: "none" }))), // trusted → none
    fromPeripheral(evaluatePeripheralPosture(normalizeDevice({ deviceId: "d", policyEnforced: true, peripherals: [] }))), // no_removable → none
    fromCustody(evaluateCustodyPosture(normalizeLocation({ deviceId: "d", zoneType: "clinical", zoneAuthorized: true, fixAgeSeconds: 15, dwellSeconds: 120, badgeAssociated: true, present: true }))), // in_zone → none
    fromReachability({ posture: "reachable", reasonCode: "CELLULAR_ONLINE", recommendedAction: "monitor", locatable: true }), // monitor
    fromNetwork({ posture: "on_trusted_segment", reasonCode: "AUTHENTICATED_TRUSTED_SEGMENT", recommendedAction: "none", accessLocation: "swport-2/8" }), // none
  ];
  const unified = composeDeviceRisk(signals);
  check("C: an ordinary healthy checkout fuses to the ok tier", unified.riskTier === "ok");
  const incident = mapPostureToIncident(unified, { impact: "medium", correlationId: "cust-C", subjectLabel: "healthy device" });
  check("C: a calm fabric produces NO incident (no-noise rule)", incident === null);
}

// ── Event-contract cross-domain path — timeline → detection → incident ─────────
// A detection no single tool could make (dock tamper + connectivity loss) becomes
// a critical, P1 incident through the same playbook.
{
  let seq = 0;
  const ev = (over: Partial<SignalGridEvent> & Pick<SignalGridEvent, "eventType">): SignalGridEvent => ({
    eventId: `e${(seq += 1)}`,
    occurredAt: "2026-07-20T12:00:00.000Z",
    correlationId: "cust-D",
    tenantId: "tenant_northwind",
    ...over,
  });

  check("D: a well-formed inbound event validates (fail-closed contract)", validateEvent({ eventType: "tamper_detected", eventId: "e0", occurredAt: "2026-07-20T12:00:00.000Z", correlationId: "cust-D", tenantId: "tenant_northwind", tamperState: "confirmed" }).ok === true);

  const detections = detectCrossDomain([
    ev({ eventType: "tamper_detected", tamperState: "confirmed" }),
    ev({ eventType: "reachability_changed", carrierConnectivityState: "offline" }),
  ]);
  const tamper = detections.find((d) => d.code === "DOCK_TAMPER_WITH_NETWORK_LOSS");
  check("D: the shared fabric detects dock-tamper-with-network-loss (critical)", tamper !== undefined && tamper.severity === "critical");

  const incident = tamper ? mapDetectionToIncident(tamper, { impact: "high", correlationId: "cust-D", subjectLabel: "docked device" }) : null;
  check("D: the critical cross-domain detection becomes a P1 major incident", incident !== null && incident.priority === "P1" && incident.escalate === true);
}

// ── Determinism of the whole pipeline ──────────────────────────────────────────
{
  const build = (): ComposableSignal[] => [
    fromIdentityRisk(evaluateIdentityRisk(normalizePrincipal({ principalId: "x", riskState: "confirmedCompromised", riskLevel: "high" }))),
    fromPeripheral(evaluatePeripheralPosture(normalizeDevice({ deviceId: "d", policyEnforced: false, peripherals: [] }))),
  ];
  const a = mapPostureToIncident(composeDeviceRisk(build()), { impact: "high", correlationId: "cust-E" });
  const b = mapPostureToIncident(composeDeviceRisk(build()), { impact: "high", correlationId: "cust-E" });
  check("E: the full fabric→incident pipeline is deterministic", JSON.stringify(a) === JSON.stringify(b));
}

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
