import type { Detection } from "@workspace/event-contract";
import type { UnifiedAction, UnifiedPosture } from "@workspace/posture-composition";
import type {
  Impact,
  Incident,
  IncidentCategory,
  Priority,
  Sla,
  Urgency,
} from "./types";

/**
 * Priority = Impact × Urgency, exactly the ServiceNow ITSM matrix:
 *
 *              Urgency:  low     medium  high      critical
 *   Impact high         P3      P2      P1        P1
 *   Impact medium       P4      P3      P2        P1
 *   Impact low          P4      P4      P3        P2
 */
const PRIORITY_MATRIX: Record<Impact, Record<Urgency, Priority>> = {
  high: { low: "P3", medium: "P2", high: "P1", critical: "P1" },
  medium: { low: "P4", medium: "P3", high: "P2", critical: "P1" },
  low: { low: "P4", medium: "P4", high: "P3", critical: "P2" },
};

/** SLA per priority — the ITSM example table (response / resolution). */
const SLA_BY_PRIORITY: Record<Priority, Sla> = {
  P1: { responseMinutes: 15, resolutionHours: 4, responseLabel: "15 minutes", resolutionLabel: "4 hours" },
  P2: { responseMinutes: 60, resolutionHours: 8, responseLabel: "1 hour", resolutionLabel: "8 hours" },
  P3: { responseMinutes: 240, resolutionHours: 16, responseLabel: "4 hours", resolutionLabel: "2 business days" },
  P4: { responseMinutes: 480, resolutionHours: 40, responseLabel: "1 business day", resolutionLabel: "5 business days" },
};

const ASSIGNMENT_GROUP: Record<IncidentCategory, string> = {
  security_compliance: "Identity & Access",
  security_vulnerability: "Vulnerability Management",
  asset_device: "Endpoint / Mobility",
  security_incident: "Security Operations (SecOps)",
  general: "Service Desk",
};

/**
 * Urgency from the unified action ladder. `none`/`monitor` return null — they are
 * informational and do NOT open an incident (no ticket noise for calm signals).
 */
export function urgencyFromAction(action: UnifiedAction): Urgency | null {
  switch (action) {
    case "escalate":
      return "critical";
    case "restrict":
    case "alert":
      return "high";
    case "step_up":
    case "locate":
      return "medium";
    case "patch":
      return "low";
    case "monitor":
    case "none":
      return null;
    default:
      return null;
  }
}

/** Urgency from a cross-domain detection severity. `info` returns null. */
export function urgencyFromDetection(severity: Detection["severity"]): Urgency | null {
  switch (severity) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "info":
      return null;
    default:
      return null;
  }
}

export interface MapOptions {
  /** Business impact of the affected device/workflow. Default "medium". */
  impact?: Impact;
  correlationId: string;
  /** A short human label for the subject (device/user), used in the summary. */
  subjectLabel?: string;
}

/**
 * Map a composed device posture to an incident, or null when nothing actionable
 * (strongest action is none/monitor). Category comes from the most-severe driver.
 */
export function mapPostureToIncident(posture: UnifiedPosture, opts: MapOptions): Incident | null {
  const urgency = urgencyFromAction(posture.strongestAction);
  if (urgency === null) {
    return null;
  }
  const impact = opts.impact ?? "medium";
  const topDriver = posture.drivers[0];
  const category = topDriver ? categoryForKind(topDriver.kind, topDriver.reason) : "general";
  const drivers = posture.drivers.map((d) => `${d.kind}:${d.reason}`);
  const subject = opts.subjectLabel ?? "device";
  const shortDescription = `${category.replace(/_/g, " ")} — ${posture.strongestAction} on ${subject} (${posture.riskTier})`;
  return buildIncident({ impact, urgency, category, correlationId: opts.correlationId, shortDescription, drivers });
}

/** Map a cross-domain detection to an incident, or null for an info detection. */
export function mapDetectionToIncident(detection: Detection, opts: MapOptions): Incident | null {
  const urgency = urgencyFromDetection(detection.severity);
  if (urgency === null) {
    return null;
  }
  const impact = opts.impact ?? "medium";
  const subject = opts.subjectLabel ?? "device";
  const shortDescription = `security incident — ${detection.code} on ${subject}`;
  return buildIncident({
    impact,
    urgency,
    category: "security_incident",
    correlationId: opts.correlationId,
    shortDescription,
    drivers: [`detection:${detection.code}`],
  });
}

function buildIncident(input: {
  impact: Impact;
  urgency: Urgency;
  category: IncidentCategory;
  correlationId: string;
  shortDescription: string;
  drivers: string[];
}): Incident {
  const priority = PRIORITY_MATRIX[input.impact][input.urgency];
  return {
    priority,
    impact: input.impact,
    urgency: input.urgency,
    category: input.category,
    assignmentGroup: ASSIGNMENT_GROUP[input.category],
    sla: SLA_BY_PRIORITY[priority],
    escalate: priority === "P1",
    majorIncident: priority === "P1" && input.impact === "high",
    shortDescription: input.shortDescription,
    correlationId: input.correlationId,
    drivers: input.drivers,
  };
}

function categoryForKind(kind: string, reason?: string): IncidentCategory {
  switch (kind) {
    // Device / endpoint integrity & posture — self-reported or hardware-proven.
    // `attestation` mirrors its self-reported twin `device_posture`: a hardware-
    // rooted SIP-disabled verdict must route to a security owner, never the generic
    // Service Desk. `ot_posture` is the OT/IIoT device-posture sibling.
    case "device_posture":
    case "attestation":
    case "ot_posture":
    case "device_management_health":
      return "security_compliance";
    // `policy_binding` is group-assignment drift — a device in the wrong Intune
    // group / Fleet team / access level holds the wrong policies silently. A
    // management-plane configuration state owned by the compliance queue, the
    // direct sibling of `device_management_health`.
    case "policy_binding":
      return "security_compliance";
    // `app_update` is the per-app sibling of `device_management_health`: a host app
    // below its version floor, lagging a forced update, or installed outside the
    // managed channel is a software-compliance state on the device, owned by the same
    // compliance queue — not a live incident and not the generic Service Desk.
    case "app_update":
      return "security_compliance";
    // Identity, authorization & data-governance signals. `platform_sso` belongs
    // here rather than with the device kinds: its findings — a policy claimed on a
    // method that cannot enforce it, a password-grade method where phishing
    // resistance was assumed, lockout exposure before enforcement — are identity-
    // credential configuration questions, owned by the same Identity & Access queue
    // as `sso_session` and `identity`.
    case "platform_sso":
    case "identity":
    case "access_governance":
    case "sso_session":
    case "oauth_consent":
    case "token_binding":
    case "pacs_access":
    case "agent_identity":
    case "data_protection":
      return "security_compliance";
    case "network":
    // Link usability is the network plane's "admitted but not usable" reading, and it
    // routes exactly as `network` already does. Note the destination: this category
    // resolves to the "Identity & Access" assignment group, not to a network team. That
    // is a pre-existing property of how `network` is routed rather than a choice made
    // here, and it is called out because an earlier draft of this comment justified the
    // routing by "the fix is a WLAN change" — which is true of the remedy and not of the
    // owner this actually reaches.
    case "link_usability":
      return "security_compliance";
    case "vulnerability":
      return "security_vulnerability";
    // Task-exception is the one kind whose classes have DIFFERENT owners, so it is the
    // one kind routed by the driver's reason code rather than by the kind alone —
    // which is why `categoryForKind` gained its optional `reason` parameter. A single
    // category here would send a short pick to the same queue as a spoofed executor.
    case "task_exception":
      return taskExceptionCategory(reason);
    // Physical custody & endpoint peripheral handling.
    case "reachability":
    case "location":
    case "custody":
    // `custody_beacon` is the offline asset-recovery sibling of `custody`/`location`:
    // an independent recovery beacon placing a device off-premises or dark is a physical
    // device-custody event, and routes to the same Endpoint / Mobility owner that handles
    // device loss/recovery, not the generic Service Desk.
    case "custody_beacon":
    case "peripheral":
      return "asset_device";
    // Active security incidents — live threats, exposed credentials, detections.
    // `agent_behavior` joins them: an anomalous agent ACTION (a burst volume, no
    // provenance, a superhuman cadence) is a live incident to investigate, distinct
    // from its sibling `agent_identity` (agent GOVERNANCE → Identity & Access above).
    // Who the agent is is a compliance question; a runaway action is an incident one.
    case "threat":
    case "credential_exposure":
    case "detection":
    case "agent_behavior":
      return "security_incident";
    default:
      return "general";
  }
}

/** Route a task-exception driver by its CLASS, read off the reason code.
 *
 *  INTEGRITY-class exceptions — a spoofed/mismatched executor, a bypassed required
 *  verification, a verification that caught the wrong object — are live security
 *  events about how work was executed, and they route to the security/operations
 *  owner: `security_incident` → "Security Operations (SecOps)".
 *
 *  INVENTORY-class (short pick, wrong/empty location, damaged, discrepancy) and
 *  FLOW-class (failed RF transaction, bridge-derived stall) exceptions are operations
 *  problems: nobody's identity is in question, something physical or transactional is.
 *  They route to `asset_device`. Note the destination: that category resolves to the
 *  "Endpoint / Mobility" assignment group — the closed ITSM table's operations-facing
 *  owner — not to a warehouse-operations or inventory-control team, which this table
 *  does not have. Both classes therefore land on the SAME group today; the classes are
 *  still routed separately here because the distinction is the point of the model, and
 *  collapsing them in this switch would silently survive the day the table gains a
 *  real inventory owner. TASK_FLOW_STALLED is additionally UNREACHABLE through
 *  `mapPostureToIncident` today — it is `monitor`, monitor opens no incident, and a
 *  monitor driver can never be the top driver of an incident-opening posture — and is
 *  kept, labelled, as the flow-class routing statement.
 *
 *  Everything else on this dimension (contradictory reports, malformed envelopes, an
 *  unreachable execution system, unknowns) is a trust-fabric integrity question and
 *  routes exactly as its siblings (`device_management_health`, `link_usability`) do:
 *  `security_compliance`, never the generic Service Desk. */
function taskExceptionCategory(reason?: string): IncidentCategory {
  switch (reason) {
    // Integrity-class → security/operations owner.
    case "TASK_ASSIGNMENT_MISMATCH":
    case "PROCEDURE_BYPASSED":
    case "VERIFICATION_FAILED":
      return "security_incident";
    // Inventory-class → the operations/inventory owner (see the note above).
    case "INVENTORY_EXCEPTION_ACTIVE":
      return "asset_device";
    // Flow-class → operations (see the note above).
    case "TASK_TRANSACTION_ERROR":
    case "TASK_FLOW_STALLED":
      return "asset_device";
    default:
      return "security_compliance";
  }
}

export { PRIORITY_MATRIX, SLA_BY_PRIORITY, ASSIGNMENT_GROUP };
