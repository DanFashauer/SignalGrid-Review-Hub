/**
 * SignalGrid product-shaped core — type model.
 *
 * PUBLIC-SAFE: every type in this package describes deterministic, synthetic,
 * fixture-backed data. There are no real credentials, tenant identifiers,
 * customer data, PHI/PII, or live vendor calls anywhere in this module. The
 * connector is fixture-only and read-only. This is a product-SHAPED core for
 * review and validation, not the production core and not production-ready.
 */

// ── Roles & principals ───────────────────────────────────────────────────────

export type Role = "owner" | "admin" | "operator" | "auditor" | "connector";

export type Permission =
  | "decision:evaluate"
  | "decision:read"
  | "policy:read"
  | "policy:write"
  | "connector:read"
  | "connector:sync"
  | "audit:read"
  | "tenant:admin";

export type PrincipalType = "user" | "service";

export interface Principal {
  tenantId: string;
  principalType: PrincipalType;
  subjectId: string;
  role: Role;
  /** Non-secret display reference for the presented key (e.g. "sk_live_demo…a1"). */
  keyReference: string;
}

// ── Core tenant-scoped entities ──────────────────────────────────────────────

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
}

export interface Membership {
  id: string;
  tenantId: string;
  userId: string;
  role: Role;
}

/**
 * Public-safe fixture API key. We never store a real secret — only a stable
 * synthetic token used for local review and a non-secret display reference.
 */
export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  principalType: PrincipalType;
  subjectId: string;
  role: Role;
  /** Synthetic demo token. Public-safe: not a real credential. */
  token: string;
  keyReference: string;
}

export type IdentityState = "enabled" | "disabled" | "unknown";

export interface Identity {
  id: string;
  tenantId: string;
  externalRef: string;
  displayName: string;
  state: IdentityState;
  assignedRole: string;
}

export type OwnerType = "corporate" | "personal" | "shared" | "unknown";
export type ManagementAgent = "intune" | "jamf" | "workspace_one" | "unknown";

export interface Device {
  id: string;
  tenantId: string;
  externalRef: string;
  name: string;
  osPlatform: string;
  osVersion: string;
  ownerType: OwnerType;
  managementAgent: ManagementAgent;
}

export type RiskTier = "low" | "standard" | "elevated" | "critical";

export interface Workflow {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  riskTier: RiskTier;
}

// ── Connector (fixture-only, read-only) ──────────────────────────────────────

export type ConnectorKind = "microsoft-entra-intune";
export type ConnectorMode = "fixture";
export type ConnectorStatus = "healthy" | "degraded" | "never_synced";

export interface Connector {
  id: string;
  tenantId: string;
  kind: ConnectorKind;
  mode: ConnectorMode;
  /** Read-only least-privilege permission, documented not exercised. */
  permissionScope: string;
  /**
   * Placeholder reference to a secret store entry (e.g. a Key Vault URI). This
   * is NOT a secret and NOT a real reference — it documents where a real
   * credential reference would live in the private production core.
   */
  credentialRef: string;
  status: ConnectorStatus;
  lastSyncAt: string | null;
}

export type SyncStatus = "success" | "partial" | "failed";

export interface ConnectorSyncRun {
  id: string;
  tenantId: string;
  connectorId: string;
  startedAt: string;
  completedAt: string;
  status: SyncStatus;
  recordsProcessed: number;
  signalsNormalized: number;
  note: string;
}

// ── Normalized signals ───────────────────────────────────────────────────────

export type ComplianceState = "compliant" | "non_compliant" | "unknown";
export type Freshness = "fresh" | "stale" | "expired" | "missing" | "unknown";
export type SubjectType = "device" | "identity";

export type SignalCategory =
  | "identity_state"
  | "device_compliance"
  | "device_management"
  | "device_encryption"
  | "os_support"
  | "posture_freshness";

export interface NormalizedSignal {
  id: string;
  tenantId: string;
  connectorId: string;
  subjectType: SubjectType;
  subjectId: string;
  category: SignalCategory;
  value: string | number | boolean | null;
  observedAt: string;
  freshness: Freshness;
  sourceReference: string;
}

// ── Versioned policy engine ──────────────────────────────────────────────────

export type DecisionOutcome = "allow" | "step_up" | "restrict" | "deny";
export type Severity = "low" | "medium" | "high" | "critical";

/** Fields of the normalized decision-evidence context a rule can test. */
export type EvidenceField =
  | "identityEnabled"
  | "deviceManaged"
  | "deviceCompliance"
  | "deviceEncrypted"
  | "osSupported"
  | "ownerType"
  | "postureFreshness"
  | "workflowRiskTier"
  | "criticalSignalsPresent";

export type RuleCondition =
  | { field: "identityEnabled"; equals: boolean | "unknown" }
  | { field: "deviceManaged"; equals: boolean | "unknown" }
  | { field: "deviceEncrypted"; equals: boolean | "unknown" }
  | { field: "osSupported"; equals: boolean | "unknown" }
  | { field: "criticalSignalsPresent"; equals: boolean }
  | { field: "deviceCompliance"; in: ComplianceState[] }
  | { field: "postureFreshness"; in: Freshness[] }
  | { field: "ownerType"; in: OwnerType[] }
  | { field: "workflowRiskTier"; in: RiskTier[] };

export interface PolicyRuleSpec {
  id: string;
  description: string;
  /** ALL conditions must hold (logical AND) for the rule to fire. */
  match: RuleCondition[];
  outcome: DecisionOutcome;
  reasonCode: string;
  severity: Severity;
}

export type PolicyVersionStatus = "active" | "superseded" | "draft";

export interface PolicyVersion {
  id: string;
  tenantId: string;
  policyId: string;
  version: number;
  status: PolicyVersionStatus;
  rules: PolicyRuleSpec[];
  createdAt: string;
  /** Deterministic content digest of the rule set (tamper-evidence demo). */
  digest: string;
}

export interface Policy {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string;
  workflowPattern: string;
  activeVersionId: string;
}

// ── Decision evidence, decisions, snapshots ──────────────────────────────────

export interface DecisionEvidence {
  identityEnabled: boolean | "unknown";
  deviceManaged: boolean | "unknown";
  deviceCompliance: ComplianceState;
  deviceEncrypted: boolean | "unknown";
  osSupported: boolean | "unknown";
  ownerType: OwnerType;
  postureFreshness: Freshness;
  workflowRiskTier: RiskTier;
  /** True only when every critical input is present and not degraded. */
  criticalSignalsPresent: boolean;
}

export interface MatchedRule {
  ruleId: string;
  reasonCode: string;
  outcome: DecisionOutcome;
  severity: Severity;
}

export type ReviewStatus = "not_required" | "pending_review" | "reviewed";

export interface EvidenceSnapshot {
  id: string;
  tenantId: string;
  decisionId: string;
  capturedAt: string;
  evidence: DecisionEvidence;
  signalsUsed: NormalizedSignal[];
  policyVersionId: string;
  policyVersion: number;
  sourceReferences: string[];
  /** Deterministic content digest making the snapshot tamper-evident. */
  digest: string;
}

export interface Decision {
  id: string;
  tenantId: string;
  identityId: string;
  deviceId: string;
  workflowId: string;
  outcome: DecisionOutcome;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  matchedRules: MatchedRule[];
  reasonCodes: string[];
  signalIds: string[];
  evidenceSnapshotId: string;
  requestContext: Record<string, string>;
  latencyMs: number;
  createdAt: string;
  reviewStatus: ReviewStatus;
  reviewable: boolean;
  explanation: string;
}

// ── Policy tests (fixtures that pin a version's behaviour) ───────────────────

export interface PolicyTest {
  id: string;
  tenantId: string;
  policyId: string;
  name: string;
  evidence: DecisionEvidence;
  expectedOutcome: DecisionOutcome;
  expectedReasonCode?: string;
}

export interface PolicyTestResult {
  testId: string;
  name: string;
  passed: boolean;
  expectedOutcome: DecisionOutcome;
  actualOutcome: DecisionOutcome;
  expectedReasonCode?: string;
  actualReasonCodes: string[];
}

// ── Simulation / replay ──────────────────────────────────────────────────────

export interface SimulationResult {
  decisionId: string;
  storedOutcome: DecisionOutcome;
  simulatedPolicyVersionId: string;
  simulatedPolicyVersion: number;
  simulatedOutcome: DecisionOutcome;
  simulatedReasonCodes: string[];
  simulatedMatchedRules: MatchedRule[];
  changed: boolean;
  /** The (immutable) evidence the replay was evaluated against. */
  evidence: DecisionEvidence;
}

// ── Operator metrics ─────────────────────────────────────────────────────────

export interface MetricsSummary {
  totalDecisions: number;
  byOutcome: Record<DecisionOutcome, number>;
  allowRate: number;
  restrictDenyRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  decisionsWithPolicyVersion: number;
  decisionsWithEvidence: number;
  pendingReview: number;
}

// ── Audit ledger ─────────────────────────────────────────────────────────────

export type AuditEventType =
  | "decision.evaluated"
  | "connector.synced"
  | "policy.version_activated"
  | "evidence.captured";

export interface AuditEvent {
  id: string;
  tenantId: string;
  seq: number;
  type: AuditEventType;
  actor: string;
  subject: string;
  summary: string;
  references: string[];
  recordedAt: string;
  /** Digest of the previous event in this tenant's chain ("genesis" if first). */
  prevDigest: string;
  /** Digest over (prevDigest + canonical event body): tamper-evident chain. */
  digest: string;
}

// ── Evaluate request/response ────────────────────────────────────────────────

export interface EvaluateRequest {
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
  requestContext?: Record<string, string>;
}

export interface EvaluateResult {
  decisionId: string;
  outcome: DecisionOutcome;
  reasonCodes: string[];
  policyId: string;
  policyVersion: number;
  policyVersionId: string;
  evidenceSnapshotId: string;
  matchedRules: MatchedRule[];
  reviewable: boolean;
  latencyMs: number;
  explanation: string;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export type CoreErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "validation"
  | "cross_tenant_denied"
  | "connector_unavailable";

export class CoreError extends Error {
  readonly code: CoreErrorCode;
  readonly status: number;
  constructor(code: CoreErrorCode, message: string, status: number) {
    super(message);
    this.name = "CoreError";
    this.code = code;
    this.status = status;
  }
}
