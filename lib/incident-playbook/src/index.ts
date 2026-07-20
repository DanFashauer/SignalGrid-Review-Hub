// @workspace/incident-playbook — deterministic mapping from a SignalGrid decision
// (composed device posture or cross-domain detection) to a prioritized, SLA-bound,
// routed incident, following the ITSM model (Priority = Impact × Urgency). Vendor-
// neutral so a ServiceNow / Jira / PagerDuty connector can dispatch it. Pure.
export * from "./types";
export * from "./map";
