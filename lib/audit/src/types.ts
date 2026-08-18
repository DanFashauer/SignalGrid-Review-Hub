// Shared audit types. Extracted from index.ts so the storage backends and the
// ledger logic can both reference them without a circular import.

export type AuditEventType =
  | "badge.enroll"
  | "badge.delete"
  | "device.enroll"
  | "device.update"
  | "session.start"
  | "session.poll"
  | "session.refresh"
  | "session.end"
  | "auth.failure"
  | "asset.location.observed"
  | "admin.access"
  | "connector.sync.triggered"
  | "policy.draft.created"
  | "policy.matched"
  | "policy.action.executed"
  // Phase 4: Telemetry + Security events
  | "telemetry.posture.updated"
  | "telemetry.posture.missing"
  | "telemetry.sync.completed"
  | "telemetry.sync.completed_with_errors"
  | "telemetry.sync.failed"
  | "security.webauthn.registered"
  | "security.webauthn.step_up.success"
  | "security.webauthn.step_up.failure"
  // Phase 5: SIEM events
  | "siem.event.sent"
  | "siem.event.failed"
  // Phase 5: ITSM events
  | "itsm.ticket.created"
  | "itsm.ticket.failed"
  // Phase 4: NAC events
  | "nac.quarantine.applied"
  | "nac.quarantine.cleared"
  | "nac.quarantine.failed"
  // Decision Flow Engine events
  | "decision.validation.failed"
  | "decision.allow"
  | "decision.deny"
  | "decision.step_up"
  | "decision.engine_error";

export type Actor = {
  type: "device" | "admin" | "system" | "user";
  id?: string;
};

export type Target = {
  type: "badge" | "session" | "device" | "policy" | "connector";
  id?: string;
};

export type AuditRecord = {
  id: string;
  ts: string;
  requestId?: string;
  actor: Actor;
  eventType: AuditEventType;
  target?: Target;
  meta?: Record<string, unknown>;
  prevHash: string;
  hash: string;
};
