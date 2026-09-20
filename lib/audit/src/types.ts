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
  | "decision.evaluated"
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
  | "decision.engine_error"
  // Data lifecycle (DR-003). The erasure row is a TOMBSTONE: it records that an
  // erasure of a given size happened, and deliberately carries no subject
  // identifier — writing one into an append-only ledger in response to a request to
  // erase it would create a permanent new copy of the very thing being removed.
  | "data.retention.applied"
  | "data.subject.erased";

export type Actor = {
  type: "device" | "admin" | "system" | "user";
  id?: string;
};

export type Target = {
  // `tenant` is the target of a lifecycle run: retention and erasure act on a
  // TENANT'S records, and naming any narrower target would name the subject.
  type: "badge" | "session" | "device" | "policy" | "connector" | "decision" | "tenant";
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
  /** Hashed into the record when present; absent on rows written before the column. */
  tenantId?: string;
  prevHash: string;
  hash: string;
};
