// Deterministic incident playbook: turn a SignalGrid decision (a composed device
// posture or a cross-domain detection) into a properly-prioritized incident,
// vendor-neutral so a ServiceNow / Jira Service Management / PagerDuty connector
// can dispatch it. This is the "deterministic playbooks" half of the founder's
// keystone ("a good event contract and deterministic playbooks") and follows the
// ITSM model directly: Priority = Impact × Urgency, an SLA per priority, an
// assignment group, and escalation for the top priority. Pure and deterministic.

export type Priority = "P1" | "P2" | "P3" | "P4";
export type Impact = "high" | "medium" | "low";
export type Urgency = "low" | "medium" | "high" | "critical";

export type IncidentCategory =
  | "security_compliance"
  | "security_vulnerability"
  | "asset_device"
  | "security_incident"
  | "general";

/** Service-level targets for a priority. Numeric for determinism + a human label. */
export interface Sla {
  responseMinutes: number;
  resolutionHours: number;
  responseLabel: string;
  resolutionLabel: string;
}

export interface Incident {
  priority: Priority;
  impact: Impact;
  urgency: Urgency;
  category: IncidentCategory;
  assignmentGroup: string;
  sla: Sla;
  /** True for the top priority — routes to the escalation / on-call path. */
  escalate: boolean;
  /** True when a high-impact P1 warrants the major-incident (war-room) process. */
  majorIncident: boolean;
  shortDescription: string;
  correlationId: string;
  /** The reason codes that drove this incident, most-severe first. */
  drivers: string[];
}
