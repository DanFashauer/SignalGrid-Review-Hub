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
    // `benchmark_selection` is the hardening plane's equivalent: the device was
    // graded against the wrong benchmark document, a superseded version, content
    // that is not CIS's own, or a run that evaluated almost nothing. A measurement
    // failure about the compliance evidence itself, owned by the same queue.
    // `credential_rotation` is secrets hygiene: a static secret past the maximum age
    // its own policy declares, or one with no rotation policy at all. A governance
    // state about the credential rather than a live compromise — the leaked-secret
    // case is `credential_exposure`, which routes to SecOps below. Owned by the same
    // compliance queue that owns the other "configured wrong, quietly" dimensions.
    case "credential_rotation":
    case "benchmark_selection":
      return "security_compliance";
    // `app_update` is the per-app sibling of `device_management_health`: a host app
    // below its version floor, lagging a forced update, or installed outside the
    // managed channel is a software-compliance state on the device, owned by the same
    // compliance queue — not a live incident and not the generic Service Desk.
    case "app_update":
      return "security_compliance";
    // `change_window` is the change plane's governance reading: an operation running
    // outside the window its own approval authorizes, under a record nobody approved,
    // by an implementer the record does not name, or on a record too old to be
    // evidence about now. All four are change-governance states owned by the same
    // compliance queue that already holds `policy_binding` and `benchmark_selection`
    // — never the generic Service Desk, and never SecOps: a change worked against a
    // rejected record is a governance breach to reconcile with the CAB, not an
    // intrusion to investigate.
    case "change_window":
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
    // `shift_context` is the labor plane's sibling of `pacs_access`: scheduled-but-
    // clocked-out, off-duty operation and a site mismatch are either a workforce
    // schedule/policy question or a borrowed badge — both owned by the Identity &
    // Access queue that already handles badge and session concerns, never the
    // generic Service Desk. Never SecOps: the dimension deliberately step-ups
    // rather than restricts, and its findings are policy states, not live threats.
    case "shift_context":
    // `location_certainty` is the spatial sibling: a wrong-map fix, an unmapped
    // space, or precision below a workflow's floor is a facility-context /
    // measurement state owned by the same queue — not a live threat, and never
    // the generic Service Desk.
    case "location_certainty":
    // `bootstrap_credential` is the auth plane's provenance reading: a temporary
    // pass beyond enrollment scope, expired-in-use, minted broad, or issued on
    // location alone is a credential-lifecycle concern owned by the same
    // Identity & Access queue as `sso_session` and `pim_activation` — never the
    // generic Service Desk, and not SecOps: its findings are issuance/policy
    // states, not live threats.
    case "bootstrap_credential":
    // `challenge_capability` findings are enrollment/provisioning states — a
    // worker with no enrolled method, a device missing its authenticator or
    // agent — owned by the same Identity & Access queue: the fix is enroll or
    // re-provision, not a SecOps investigation and not a generic ticket.
    case "challenge_capability":
    // `service_lifecycle` is the joiner-mover-leaver plane read from the SERVICE
    // side: entitlements stripped with no departure recorded, entitlements
    // outliving one, or a service plan assigned AFTER a departure no rehire
    // explains. Same queue as `access_governance`, and deliberately so — these are
    // the two witnesses whose DISAGREEMENT is the finding, so splitting them across
    // queues would hand each half to someone who cannot see the other.
    //
    // Never SecOps: a half-finished offboarding is a governance failure to complete,
    // not an intrusion to investigate — and the most common cause of the stripped
    // reading is an automated licence-reclamation sweep, which is finance's
    // housekeeping rather than anybody's attack. Never the generic Service Desk: the
    // fix is an entitlement decision, not a ticket.
    // `break_glass` is the governance record of an emergency clinical override —
    // unjustified, unbounded, never-reviewed, or invoked by someone who did not need
    // it. An ACCESS-GOVERNANCE question, owned by the same queue as
    // `access_governance` and `service_lifecycle`. Never SecOps: a clinician reaching
    // past a gate to reach a patient is not an intrusion, and treating it as one is
    // how a hospital learns to stop reporting. Never the generic Service Desk: the
    // fix is a policy and review-loop decision, not a ticket.
    case "break_glass":
    case "service_lifecycle":
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
    // `sse_egress` is the network plane's egress reading — a mandated edge the
    // device's traffic is not traversing. Its findings (client disabled, never
    // installed, bypassed, an uncorroborated tunnel claim) are provisioning and
    // policy states on the same plane as `network`/`link_usability`, so they
    // route the same way; they are not live threats for SecOps.
    case "sse_egress":
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
    // `session_readiness` is the DEX plane's reading — an app that never came up, a
    // posed tap-to-app budget exceeded, an endpoint nobody instrumented, a DEX plane
    // that cannot be read. These are END-USER-COMPUTING problems and they route to the
    // Endpoint / Mobility owner who actually operates the endpoint, VDI broker and DEX
    // agent.
    //
    // Deliberately NOT `security_compliance`, even though the sibling this dimension is
    // most often paired with (`sso_session`) lives there: a slow VDI reconnect is a
    // performance owner's work, and routing it to Identity & Access would hand it to a
    // team who cannot fix it. Deliberately NOT SecOps either — paging a security analyst
    // for a broker delay trains everyone to ignore the channel. And never the generic
    // Service Desk: the fix is an endpoint/broker change, not a ticket.
    // `observability_integrity` is the evidence plane grading itself — an exporter that
    // stopped, a stream sampled or dropped or cost-capped. The fix is an instrumentation
    // or pipeline change, so it reaches the same endpoint/platform owner as the readiness
    // dimension above. Deliberately NOT SecOps: a sample rate is not an intrusion, and
    // paging an analyst for one trains everybody to ignore the channel.
    case "observability_integrity":
    // `local_authority` is most often a device that restarted and has not been unlocked,
    // so its vault, network credential and offline grant are unreadable. That is an
    // ERRAND — somebody walks over and types a passcode — which is precisely the asset /
    // device-support queue. Routing it to a security queue would describe a locked iPad
    // as an incident.
    case "local_authority":
    case "session_readiness":
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
