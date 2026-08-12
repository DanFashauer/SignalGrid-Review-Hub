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
  | "remediation:approve"
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

export type ConnectorKind = "microsoft-entra-intune" | "dockbridge-custody" | "wfm-shift";
export type ConnectorMode = "fixture";
export type ConnectorStatus = "healthy" | "degraded" | "never_synced";

/**
 * How dock/custody events reach SignalGrid. All are modeled as fixture
 * ingestion here (public-safe, no real hardware or vendor calls):
 *  - app_in_dock: a generic SignalGrid agent embedded in a third-party
 *    dock/cradle firmware,
 *  - vendor_api: polling a dock/locker vendor's existing event API,
 *  - edge_gateway: an on-site gateway relaying events,
 *  - embedded_smartdock: the dedicated SignalGrid SmartDock — SignalGrid
 *    firmware on SignalGrid-designed smart-charging hardware, emitting the full
 *    custody/charge/tamper/dock/badge signal set natively. Optional layer; see
 *    docs/SIGNALGRID_SMARTDOCK.md.
 */
export type ConnectorIngestionMode =
  | "app_in_dock"
  | "vendor_api"
  | "edge_gateway"
  | "embedded_smartdock";

export interface Connector {
  id: string;
  tenantId: string;
  kind: ConnectorKind;
  mode: ConnectorMode;
  /** Present for hardware connectors: documents the (fixture) ingestion path. */
  ingestionMode?: ConnectorIngestionMode;
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

/**
 * Security-baseline (hardening) alignment for a device, normalized from an
 * endpoint-management / posture source that reports against a recognized
 * baseline (e.g. a CIS Benchmark or CIS Controls v8 profile, or an equivalent
 * NIST 800-53 / STIG hardening baseline). Vendor-neutral and public-safe:
 *  - aligned:      meets the device's assigned baseline profile,
 *  - partial:      minor, non-critical control drift,
 *  - drifted:      material drift from the baseline (hardening regressed),
 *  - not_assessed: no baseline scan on record for this device yet,
 *  - unknown:      state could not be determined (fail-safe, never "aligned").
 */
export type BaselineState =
  | "aligned"
  | "partial"
  | "drifted"
  | "not_assessed"
  | "unknown";

/**
 * Was the baseline answer above produced by the RIGHT test? Summarized from the
 * benchmark-selection dimension (docs/BENCHMARK_SELECTION.md), which grades the
 * QUESTION the way `BaselineState` records the ANSWER: which benchmark document
 * graded this device, at what version, from whose content, on what platform,
 * covering how many rules, and whether it is the one this workflow requires.
 *  - confirmed:  the assessment was the right document, honestly sourced,
 *                adequately covered, and the one this work requires,
 *  - misfit:     an AFFIRMATIVE selection failure — a document for another
 *                platform, an empty assessment, a benchmark off this workflow's
 *                requirement, or one the published catalog does not carry. The
 *                alignment answer is unreliable no matter what it says,
 *  - unverified: not established either way (no signal, axes unknown).
 *                Fail-safe: never read as confirmed — and, deliberately, never
 *                matched by the ACTIVE v1 rule either, so a fleet that does not
 *                yet emit this signal is not stepped up on day one.
 */
export type BenchmarkSelectionState = "confirmed" | "misfit" | "unverified";

/**
 * The labor plane's summary for the worker acting on this device, from the
 * shift-context dimension (docs/SHIFT_CONTEXT.md): is this the right TIME and
 * SITE for this worker to be operating? Custody says which badge holds the
 * device; this says whether the workforce-management plane agrees with the
 * moment.
 *  - confirmed:  scheduled now, on the clock, and the site question (if posed)
 *                answered matched,
 *  - misfit:     an AFFIRMATIVE labor mismatch — scheduled-but-clocked-out
 *                (off-the-clock work, or someone else's badge), operating while
 *                neither scheduled nor punched in, or a shift that places the
 *                worker at a different site,
 *  - unverified: not established either way (no signal, axes unknown).
 *                Fail-safe: never read as confirmed — and, deliberately, never
 *                matched by the ACTIVE v1 rule either, so a fleet that does not
 *                yet emit this signal is not stepped up on day one.
 */
export type ShiftContextState = "confirmed" | "misfit" | "unverified";

/**
 * Badge-binding state from the RFID/prox/NFC badge-reader case — whether the
 * assigned worker's credential is physically bound to this shared device at the
 * moment a workflow fires. This is the signal that ties a human to a shared
 * device; vendor-neutral and public-safe (no live reader, no real credential):
 *  - present: the assigned badge is seated in the reader case (bound now),
 *  - removed: the badge was withdrawn (the session should not continue),
 *  - forced:  the badge was forcibly removed / the reader case was tampered,
 *  - absent:  no badge is present (an unbound shared device — not itself a fault),
 *  - unknown: no reader signal (fail-safe; never assumed present).
 */
export type BadgeBindingState =
  | "present"
  | "removed"
  | "forced"
  | "absent"
  | "unknown";

// Physical-custody / DockBridge hardware states (vendor-neutral).
export type CustodyState =
  | "checked_in"
  | "checked_out"
  | "overdue"
  | "exception"
  | "maintenance"
  | "unknown";
export type ChargeState =
  | "charging"
  | "charged"
  | "low"
  | "critical"
  | "not_present"
  | "unknown";
export type TamperState =
  | "none"
  | "suspected"
  | "confirmed"
  | "sensor_unavailable"
  | "unknown";
export type DockState =
  | "occupied"
  | "empty"
  | "reserved"
  | "faulted"
  | "offline"
  | "unknown";
/**
 * Battery HEALTH, which is a different question from `ChargeState`.
 *
 * `chargeState` answers "how full is it right now" — a state charging changes.
 * `batteryHealth` answers "can this battery still hold a shift" — a state
 * charging does NOT change. The distinction is the reason this field exists:
 * without it, a device whose battery can no longer hold charge reports `low`,
 * gets routed the self-service step "dock it and charge it", comes back `low`,
 * and loops forever on a fix that cannot work. `failing` is the state that
 * says the remedy is a battery, not a bay.
 *
 *  - healthy:  holds expected capacity for a shift,
 *  - degraded: measurably reduced capacity but still serviceable — evidence
 *              only, deliberately carrying NO rule (see policy.ts),
 *  - failing:  will not hold a shift; needs replacement, not charging,
 *  - unknown:  no battery-health read.
 *
 * On `unknown`, and stated precisely because an earlier draft of this comment
 * called it "fail-safe" and that was not true. `unknown` is never *labelled*
 * healthy, but no rule keys on it and it is excluded from
 * `deriveCriticalSignalsPresent`, so a device with no health read is *treated*
 * exactly like a healthy one — `allow` / `TRUST_ESTABLISHED`. That matches how
 * every other custody signal handles absence, and it is deliberate: a rule on
 * `unknown` would step up every device in every fleet whose docks cannot measure
 * capacity, which is most of them today. But under this repo's own standard —
 * a grant requires positive confirmation of every input — it is an honest gap,
 * not a safe default, and calling it "fail-safe" would have hidden that.
 */
export type BatteryHealthState = "healthy" | "degraded" | "failing" | "unknown";

/** Every normalized signal category the core evaluates.
 *
 *  Declared as a const ARRAY with the union derived from it, rather than as a bare
 *  union — the same correction `SIGNAL_KINDS` in @workspace/posture-composition
 *  already carries, and for the same reason, now demonstrated twice.
 *
 *  A bare union is invisible at runtime, so nothing can COUNT it. Every document
 *  that wanted to state how many categories exist had to restate the list by hand,
 *  and `docs/WHAT_SIGNALGRID_DOES_TODAY.md` duly drifted: it claimed 13 while the
 *  union held 15, having already been hand-corrected once from an earlier wrong
 *  figure. Deriving the union from the array makes the list enumerable, so
 *  `signalgrid-core-proof.ts` can emit a real count and the figure guard can hold
 *  every document to it. The failure mode is designed out rather than watched for. */
export const SIGNAL_CATEGORIES = [
  "identity_state",
  "device_compliance",
  "device_management",
  "device_encryption",
  "os_support",
  "posture_freshness",
  "custody_state",
  "charge_state",
  "battery_health",
  "tamper_state",
  "dock_state",
  "security_baseline",
  "benchmark_selection",
  "shift_context",
  "badge_binding",
  // The two launch families the core could not previously represent — found by the
  // 2026-08-10 full-repo scan (PRODUCT_COMPLETION_PLAN §9): device-management-health
  // and local-authority shipped as connectors, proofs and doctrine while the engine
  // had no vocabulary for either. Coarse rollups by design, like security_baseline
  // rolling up the whole CIS engine: the family computes, the core reads the verdict.
  "device_management_health",
  "local_authority",
] as const;

export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

/** Rollup of the device-management-health family: is the MANAGEMENT PLANE itself
 *  trustworthy for this device — enrollment live, check-ins fresh, policy on
 *  baseline. `broken` is affirmative (enrollment failed/retired, never checked in);
 *  silence reads as `unknown`, never as healthy. */
export type ManagementHealthState = "healthy" | "degraded" | "broken" | "unknown";

/** Rollup of the local-authority family: may this shared device act on its own
 *  authority right now (offline lease live, clock trusted). Only the two
 *  AFFIRMATIVE values are readable from a signal — `verified` and `withheld` —
 *  absent or unrecognized falls back to `unverified`, the same
 *  silence-is-not-an-answer rule as benchmark_selection and shift_context. */
export type LocalAuthorityGrantState = "verified" | "withheld" | "unverified";

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
/** Every evidence field a policy rule can test. Const array for the same reason
 *  `SIGNAL_CATEGORIES` above is one: the controls documentation claimed "these —
 *  and only these — are the dimensions a policy rule can test today" over a list
 *  of 15 while the union held 18, and no gate could see the difference because a
 *  union cannot be counted. */
export const EVIDENCE_FIELDS = [
  "identityEnabled",
  "deviceManaged",
  "deviceCompliance",
  "deviceEncrypted",
  "osSupported",
  "ownerType",
  "postureFreshness",
  "workflowRiskTier",
  "criticalSignalsPresent",
  "custodyState",
  "chargeState",
  "batteryHealth",
  "tamperState",
  "dockState",
  "baselineState",
  "benchmarkSelectionState",
  "shiftContextState",
  "badgeState",
  "managementHealthState",
  "localAuthorityState",
] as const;

export type EvidenceField = (typeof EVIDENCE_FIELDS)[number];

export type RuleCondition =
  | { field: "identityEnabled"; equals: boolean | "unknown" }
  | { field: "deviceManaged"; equals: boolean | "unknown" }
  | { field: "deviceEncrypted"; equals: boolean | "unknown" }
  | { field: "osSupported"; equals: boolean | "unknown" }
  | { field: "criticalSignalsPresent"; equals: boolean }
  | { field: "deviceCompliance"; in: ComplianceState[] }
  | { field: "postureFreshness"; in: Freshness[] }
  | { field: "ownerType"; in: OwnerType[] }
  | { field: "workflowRiskTier"; in: RiskTier[] }
  | { field: "custodyState"; in: CustodyState[] }
  | { field: "chargeState"; in: ChargeState[] }
  | { field: "batteryHealth"; in: BatteryHealthState[] }
  | { field: "tamperState"; in: TamperState[] }
  | { field: "dockState"; in: DockState[] }
  | { field: "baselineState"; in: BaselineState[] }
  | { field: "benchmarkSelectionState"; in: BenchmarkSelectionState[] }
  | { field: "shiftContextState"; in: ShiftContextState[] }
  | { field: "badgeState"; in: BadgeBindingState[] }
  | { field: "managementHealthState"; in: ManagementHealthState[] }
  | { field: "localAuthorityState"; in: LocalAuthorityGrantState[] };

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
  /** Physical-custody / DockBridge hardware context (default "unknown"). */
  custodyState: CustodyState;
  dockChargeState: ChargeState;
  /**
   * Battery health (default "unknown"). Distinct from `dockChargeState`: this is
   * the state charging cannot change. See BatteryHealthState.
   */
  batteryHealth: BatteryHealthState;
  tamperState: TamperState;
  /**
   * Dock/SmartDock hardware state (default "unknown"). A `faulted` or `offline`
   * dock means the custody/charge/tamper channel for the device is unreliable,
   * so `allow` should not rest on it. See docs/SIGNALGRID_SMARTDOCK.md.
   */
  dockState: DockState;
  /** Security-baseline (CIS/hardening) alignment for the device (default "unknown"). */
  baselineCompliance: BaselineState;
  /** Whether the baseline answer above came from the RIGHT test (default
   *  "unverified") — see BenchmarkSelectionState. `aligned` + `misfit` means the
   *  device passed a test that does not apply to it. */
  benchmarkSelection: BenchmarkSelectionState;
  /** Labor-plane summary from the shift-context dimension (default "unverified") —
   *  see ShiftContextState. The badge says WHO; this says whether the WFM agrees
   *  it is the right TIME and SITE for them to be operating. */
  shiftContext: ShiftContextState;
  /** Badge-binding state from the RFID/prox badge-reader case (default "unknown"). */
  badgeBinding: BadgeBindingState;
  /** Management-plane health rollup from the device-management-health family
   *  (default "unknown" — silence is not a healthy management plane). */
  managementHealthState: ManagementHealthState;
  /** Local-authority grant rollup (default "unverified" — day-one-quiet until the
   *  connector emits it, like benchmarkSelection and shiftContext). */
  localAuthorityState: LocalAuthorityGrantState;
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
  /**
   * Which build of the core decision path derived these facts.
   *
   * OPTIONAL, and that is load-bearing rather than lazy: durable rows written before
   * this field existed deserialize without it (`decision-store.ts` casts JSONB with an
   * unchecked `as EvidenceSnapshot`), so a required field would make the type lie about
   * what is actually in the database. Absence means "minted before provenance was
   * stamped" and is surfaced as exactly that — never coerced to 0, never back-dated.
   *
   * Generated by `scripts/generate-core-normalization-version.mjs`; it claims ONE
   * direction only — the same value means the covered core source was byte-identical,
   * a different value means something in the core decision path changed.
   */
  coreNormalizationVersion?: number;
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
  /** Copied from the evidence snapshot this decision was minted with — never re-read
   *  from the constant, so all carriers report the value that was actually digested. */
  coreNormalizationVersion?: number;
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

// ── Remediation requests (approval-gated, always simulated) ──────────────────

export type RemediationKind =
  | "request_device_remediation"
  | "request_posture_refresh"
  | "request_encryption_enforcement"
  | "notify_identity_owner"
  | "notify_security"
  | "request_custody_check"
  | "request_baseline_reapply";

export type RemediationStatus =
  | "requires_approval"
  | "approved_simulated"
  | "dismissed";

/**
 * A proposed follow-up action for a non-allow decision. It is ALWAYS
 * approval-required and ALWAYS simulated — SignalGrid records the request and
 * (when approved) simulates it; it never executes a change on a source system.
 * There is deliberately no "executed" status.
 */
export interface RemediationAction {
  id: string;
  tenantId: string;
  decisionId: string;
  kind: RemediationKind;
  targetType: "device" | "identity" | "workflow";
  targetRef: string;
  reasonCode: string;
  status: RemediationStatus;
  approvalRequired: true;
  simulatedOnly: true;
  requestedAt: string;
  approvedAt: string | null;
  note: string;
}

// ── Resolution Assistant (deterministic, approval-gated, simulated) ──────────

export type ResolutionAudience = "worker" | "operator" | "admin" | "system";

export type ResolutionChannel =
  | "device_prompt"
  | "operator_console"
  | "itsm_ticket"
  | "credential_reader"
  | "smart_locker"
  | "notify_owner";

/**
 * How a resolution step may be actioned:
 *  - auto_proposed: low-risk, reversible; the system proposes it automatically
 *    (still approval-gated + simulated — never auto-executed).
 *  - requires_approval: an owner/admin must approve before it is (simulated).
 *  - manual_only: a hard block that needs a person; not self-resolvable.
 */
export type ResolutionClass =
  | "auto_proposed"
  | "requires_approval"
  | "manual_only";

export type ResolutionPathKind = "self_service" | "assisted" | "escalation";

export interface ResolutionStep {
  order: number;
  reasonCode: string;
  audience: ResolutionAudience;
  channel: ResolutionChannel;
  resolutionClass: ResolutionClass;
  action: string;
  /** The reason code this step would clear if completed. */
  clears: string;
}

export interface ResolutionPlan {
  decisionId: string;
  outcome: DecisionOutcome;
  summaryForWorker: string;
  summaryForOperator: string;
  steps: ResolutionStep[];
  /** True when at least one block is auto-proposable/approvable (not all hard). */
  autoResolvable: boolean;
  path: ResolutionPathKind;
}

export interface ResolutionSimulation {
  decisionId: string;
  originalOutcome: DecisionOutcome;
  /** Reason codes whose (simulated) fix was applied in this preview. */
  appliedReasonCodes: string[];
  projectedOutcome: DecisionOutcome;
  projectedReasonCodes: string[];
  /** True when the projected outcome is allow. */
  resolved: boolean;
  note: string;
}

/** Per-organization control over how resolution flows. */
export interface ResolutionConfig {
  tenantId: string;
  /** The organization's primary hardware channel for worker-facing steps. */
  primaryHardwareChannel: ResolutionChannel;
  /** When false, auto_proposed steps are downgraded to requires_approval. */
  autoProposeEnabled: boolean;
}

// ── Webhook delivery (simulated, public-safe) ────────────────────────────────

export type DeliveryStatus = "delivered" | "failed" | "dead_letter";

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  /** Fixture sink URL (…demo.invalid). No real request is ever made. */
  url: string;
  events: AuditEventType[];
  active: boolean;
  /**
   * Fixture reliability knob: the simulated sink rejects this many attempts
   * before succeeding, so retry/backoff can be demonstrated deterministically.
   */
  failuresBeforeSuccess: number;
  maxAttempts: number;
}

export interface DeliveryAttempt {
  attempt: number;
  status: "ok" | "error";
  simulatedStatusCode: number;
  backoffSeconds: number;
}

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  endpointId: string;
  decisionId: string;
  event: AuditEventType;
  status: DeliveryStatus;
  attempts: DeliveryAttempt[];
  createdAt: string;
}

// ── Audit ledger ─────────────────────────────────────────────────────────────

export type AuditEventType =
  | "decision.evaluated"
  | "connector.synced"
  | "policy.version_activated"
  | "evidence.captured"
  | "remediation.requested"
  | "remediation.approved";

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
  /** Copied through from the snapshot. Absent on a decision minted before the stamp
   *  existed — surfaced as "unstamped", never coerced to a number. */
  coreNormalizationVersion?: number;
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
