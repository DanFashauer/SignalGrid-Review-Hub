// @workspace/incident-playbook — deterministic mapping from a SignalGrid decision
// (composed device posture or cross-domain detection) to a prioritized, SLA-bound,
// routed incident, following the ITSM model (Priority = Impact × Urgency). Vendor-
// neutral so a ServiceNow / Jira / PagerDuty connector can dispatch it. Pure.
export * from "./types";
export * from "./map";
// Cascade join 1 (DR-042): the pure Incident → ticket-request mapper and the
// dispatch seam that routes it through @workspace/integrations' emission gate.
// It lives HERE, not in the integrations family, because it reads the incident
// type and the integrations package must stay below the incident layer.
export * from "./dispatch";
