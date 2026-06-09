export type SignalGridEventType =
  | "identity.authenticated"
  | "identity.risk_detected"
  | "device.posture_observed"
  | "device.non_compliant"
  | "device.stale_checkin"
  | "device.low_battery"
  | "device.health_degraded"
  | "dock.device_docked"
  | "dock.device_undocked"
  | "dock.wrong_slot_return"
  | "dock.device_missing"
  | "rtls.location_observed"
  | "rtls.wrong_zone"
  | "rts.staff_safety_alert"
  | "workflow.assignment_changed"
  | "api.integration_failed"
  | "ticket.created"
  | "ticket.updated"
  | "remediation.requested"
  | "remediation.verified"
  | "audit.recorded";

export type SignalGridLayer =
  | "identity"
  | "device"
  | "operational_health"
  | "location"
  | "dockbridge"
  | "workflow"
  | "integration"
  | "decision"
  | "audit";

export type DecisionOutcome =
  | "allow"
  | "step_up"
  | "restrict"
  | "deny"
  | "alert_operator"
  | "create_ticket"
  | "route_to_owner"
  | "request_remediation"
  | "verify_remediation"
  | "record_audit";

export type ActionKind =
  | "alert_operator"
  | "create_ticket"
  | "route_to_owner"
  | "request_remediation"
  | "verify_remediation"
  | "queue_retry"
  | "record_audit";

export interface SignalGridSignal {
  id: string;
  type: SignalGridEventType;
  layer: SignalGridLayer;
  source: string;
  subject: string;
  observedAt: string;
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  attributes: Record<string, string | number | boolean | null>;
}

export interface IdentitySignal extends SignalGridSignal {
  layer: "identity";
}

export interface DevicePostureSignal extends SignalGridSignal {
  layer: "device";
}

export interface OperationalHealthSignal extends SignalGridSignal {
  layer: "operational_health";
}

export interface LocationSignal extends SignalGridSignal {
  layer: "location";
}

export interface DockSignal extends SignalGridSignal {
  layer: "dockbridge";
}

export interface WorkflowSignal extends SignalGridSignal {
  layer: "workflow";
}

export interface IntegrationHealthSignal extends SignalGridSignal {
  layer: "integration";
}

export interface RoutedAction {
  id: string;
  kind: ActionKind;
  title: string;
  ownerTeam: string;
  priority: "P1" | "P2" | "P3";
  status: "simulated" | "queued" | "requires_review" | "verified";
  route: string;
  evidenceRefs: string[];
}

export interface AuditEvidence {
  id: string;
  recordedAt: string;
  actor: string;
  summary: string;
  evidenceType: "decision_trace" | "routing_trace" | "posture_refresh" | "ticket_update";
  references: string[];
}

export interface SignalGridDecision {
  id: string;
  scenarioId: string;
  evaluatedAt: string;
  outcomes: DecisionOutcome[];
  primaryOutcome: DecisionOutcome;
  confidence: "high" | "medium" | "low";
  reasonCodes: string[];
  explanation: string;
}

export interface SimulatorScenario {
  id: string;
  title: string;
  summary: string;
  persona: string;
  startingSignals: SignalGridSignal[];
  expectedOutcomes: DecisionOutcome[];
  expectedOwnerTeam: string;
  safeDemoNote: string;
}

export interface SimulatorRunResult {
  scenario: SimulatorScenario;
  normalizedSignals: SignalGridSignal[];
  decision: SignalGridDecision;
  routedActions: RoutedAction[];
  auditEvidence: AuditEvidence[];
  status: "PASS" | "FAIL";
}
