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
  const category = topDriver ? categoryForKind(topDriver.kind) : "general";
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

function categoryForKind(kind: string): IncidentCategory {
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
    // Identity, authorization & data-governance signals.
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
      return "security_compliance";
    case "vulnerability":
      return "security_vulnerability";
    // Physical custody & endpoint peripheral handling.
    case "reachability":
    case "location":
    case "custody":
    case "peripheral":
      return "asset_device";
    // Active security incidents — live threats, exposed credentials, detections.
    case "threat":
    case "credential_exposure":
    case "detection":
      return "security_incident";
    default:
      return "general";
  }
}

export { PRIORITY_MATRIX, SLA_BY_PRIORITY, ASSIGNMENT_GROUP };
