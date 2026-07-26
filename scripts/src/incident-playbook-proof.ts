// Incident-playbook proof — pure and deterministic, no I/O.
//
// Proves the decision → incident mapping against the ITSM model: the full
// Priority = Impact × Urgency matrix, the SLA-per-priority table, category-driven
// assignment routing, P1 escalation + high-impact major-incident flagging, and
// the no-noise rule (none/monitor and info detections open NO incident).
import {
  PRIORITY_MATRIX,
  SLA_BY_PRIORITY,
  mapDetectionToIncident,
  mapPostureToIncident,
  urgencyFromAction,
  type Impact,
  type Priority,
  type Urgency,
} from "@workspace/incident-playbook";
import { SIGNAL_KINDS } from "@workspace/posture-composition";
import type { UnifiedPosture, UnifiedAction } from "@workspace/posture-composition";
import type { Detection } from "@workspace/event-contract";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Incident-playbook proof");

// ── the full Priority = Impact × Urgency matrix (ServiceNow ITSM) ─────────────
const EXPECTED: Record<Impact, Record<Urgency, Priority>> = {
  high: { low: "P3", medium: "P2", high: "P1", critical: "P1" },
  medium: { low: "P4", medium: "P3", high: "P2", critical: "P1" },
  low: { low: "P4", medium: "P4", high: "P3", critical: "P2" },
};
for (const impact of ["high", "medium", "low"] as Impact[]) {
  for (const urgency of ["low", "medium", "high", "critical"] as Urgency[]) {
    check(`matrix ${impact}×${urgency} → ${EXPECTED[impact][urgency]}`, PRIORITY_MATRIX[impact][urgency] === EXPECTED[impact][urgency]);
  }
}

// ── SLA table per priority ────────────────────────────────────────────────────
check("P1 SLA = 15m / 4h", SLA_BY_PRIORITY.P1.responseMinutes === 15 && SLA_BY_PRIORITY.P1.resolutionHours === 4);
check("P2 SLA = 60m / 8h", SLA_BY_PRIORITY.P2.responseMinutes === 60 && SLA_BY_PRIORITY.P2.resolutionHours === 8);
check("P3 SLA response 4h", SLA_BY_PRIORITY.P3.responseMinutes === 240);
check("P4 SLA response 1 business day", SLA_BY_PRIORITY.P4.responseLabel === "1 business day");

// ── urgency from the unified action ladder ────────────────────────────────────
const urgencyCases: Array<[UnifiedAction, string | null]> = [
  ["escalate", "critical"], ["restrict", "high"], ["alert", "high"], ["step_up", "medium"],
  ["locate", "medium"], ["patch", "low"], ["monitor", null], ["none", null],
];
for (const [action, want] of urgencyCases) {
  check(`urgency(${action}) → ${want}`, urgencyFromAction(action) === want);
}

// ── posture → incident ────────────────────────────────────────────────────────
const posture = (action: UnifiedAction, kind = "vulnerability"): UnifiedPosture => ({
  riskTier: action === "escalate" || action === "restrict" ? "blocked" : "at_risk",
  strongestAction: action,
  drivers: [{ kind: kind as never, posture: "p", action, reason: "R", rank: 0 }],
  signalCount: 1,
});

const restrictInc = mapPostureToIncident(posture("restrict"), { impact: "high", correlationId: "c1", subjectLabel: "ipad-ward-01" });
check("restrict + high impact → P1", restrictInc?.priority === "P1");
check("P1 escalates", restrictInc?.escalate === true);
check("P1 + high impact = major incident", restrictInc?.majorIncident === true);
check("vulnerability driver routes to Vulnerability Management", restrictInc?.assignmentGroup === "Vulnerability Management");
check("incident carries the SLA for its priority", restrictInc?.sla.responseMinutes === 15);
check("incident carries drivers + correlationId", (restrictInc?.drivers.length ?? 0) === 1 && restrictInc?.correlationId === "c1");

const stepUpInc = mapPostureToIncident(posture("step_up", "device_posture"), { impact: "low", correlationId: "c2" });
check("step_up + low impact → P4", stepUpInc?.priority === "P4");
check("device_posture driver routes to Identity & Access", stepUpInc?.assignmentGroup === "Identity & Access");
check("P4 does not escalate / is not major", stepUpInc?.escalate === false && stepUpInc?.majorIncident === false);

// Every composable SignalKind must route to a SECURITY owner, never the generic
// Service Desk — a hardware-rooted attested-compromised device especially. A driver
// falling through to "general" would silently delay response for a critical signal.
const routeOf = (kind: string): string | undefined =>
  mapPostureToIncident(posture("escalate", kind), { impact: "high", correlationId: `r-${kind}` })?.assignmentGroup;
check("attestation (hardware-rooted) routes to a security owner, NOT Service Desk", routeOf("attestation") === "Identity & Access");
check("access_governance routes to Identity & Access", routeOf("access_governance") === "Identity & Access");
check("ot_posture routes to a security owner", routeOf("ot_posture") === "Identity & Access");
check("threat routes to Security Operations (SecOps)", routeOf("threat") === "Security Operations (SecOps)");
check("credential_exposure routes to Security Operations (SecOps)", routeOf("credential_exposure") === "Security Operations (SecOps)");
check("custody / peripheral route to Endpoint / Mobility", routeOf("custody") === "Endpoint / Mobility" && routeOf("peripheral") === "Endpoint / Mobility");
check("identity / data_protection route to Identity & Access", routeOf("identity") === "Identity & Access" && routeOf("data_protection") === "Identity & Access");
check("sso_session (leftover-session risk) routes to Identity & Access", routeOf("sso_session") === "Identity & Access");
check("oauth_consent (delegated-grant risk) routes to Identity & Access", routeOf("oauth_consent") === "Identity & Access");
// Iterates SIGNAL_KINDS itself rather than a hand-copied list. The hand-copy drifted
// FIVE kinds behind the union — token_binding, pacs_access, agent_identity,
// device_management_health and link_usability were all added to `categoryForKind` with
// their routing ungated, and adversarial review noticed only because the newest one was
// under the microscope. `SignalKind` is now derived from that array, so a kind added
// tomorrow is covered here the moment it exists. `detection` is excluded deliberately:
// it is an event kind rather than a composable posture dimension.
const POSTURE_KINDS = SIGNAL_KINDS.filter((k) => k !== "detection");
const misrouted = POSTURE_KINDS.filter((k) => routeOf(k) === "Service Desk");
check(`NO composable posture kind falls through to the generic Service Desk (checked all ${POSTURE_KINDS.length}${misrouted.length ? ", misrouted: " + misrouted.join(", ") : ""})`, misrouted.length === 0);

// ── no-noise rule: calm signals open no incident ──────────────────────────────
check("monitor posture opens NO incident", mapPostureToIncident(posture("monitor"), { impact: "high", correlationId: "c3" }) === null);
check("none posture opens NO incident", mapPostureToIncident(posture("none"), { impact: "high", correlationId: "c4" }) === null);

// ── detection → incident ──────────────────────────────────────────────────────
const det = (severity: Detection["severity"]): Detection => ({ code: "DOCK_TAMPER_WITH_NETWORK_LOSS", severity, reason: "x", correlationId: "cX", evidenceEventIds: [] });
const critInc = mapDetectionToIncident(det("critical"), { impact: "high", correlationId: "c5", subjectLabel: "cart-15" });
check("critical detection + high impact → P1 SecOps", critInc?.priority === "P1" && critInc?.assignmentGroup === "Security Operations (SecOps)");
check("info detection opens NO incident", mapDetectionToIncident(det("info"), { impact: "high", correlationId: "c6" }) === null);

// ── default impact + determinism ──────────────────────────────────────────────
const def = mapPostureToIncident(posture("alert"), { correlationId: "c7" });
check("impact defaults to medium (alert → P2)", def?.impact === "medium" && def?.priority === "P2");
const a = mapPostureToIncident(posture("restrict"), { impact: "high", correlationId: "c8" });
const b = mapPostureToIncident(posture("restrict"), { impact: "high", correlationId: "c8" });
check("mapping is deterministic", JSON.stringify(a) === JSON.stringify(b));

const total = passed + failures.length;
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
