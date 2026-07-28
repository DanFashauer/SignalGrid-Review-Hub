// @workspace/iac — types, errors, and the freeze/rank primitives.
//
// This is the declarative core of SignalGrid's GitOps control plane for
// endpoints: a version-controlled DESIRED state (the kind of thing that lives in
// a Fleet GitOps YAML, a Terraform/Intune config, or a Jamf-in-Git repo) is
// diffed against the OBSERVED fleet state to produce a plan, the plan rolls out
// only through a governed lifecycle (a rollout cannot apply itself — it needs a
// recorded human approval AND an `allow` trust decision), and drift between
// declared and observed becomes a first-class signal.
//
// House style (inherited from work-context → adaptive-proposals → self-audit):
// pure, deterministic, deep-frozen, fail-closed, references-not-values, and NO
// wall clock / randomness anywhere in this module.

// ============================================================================
// Resources
// ============================================================================

/** The declarable resource kinds. Anything outside this set is refused at parse
 *  time (fail-closed) rather than silently ignored. */
export const RESOURCE_KINDS = [
  "enrollment_profile",
  "compliance_policy",
  "config_profile",
  "software_package",
  "decision_policy",
  "app_allowlist",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

/** Stable sort index for a kind, so plans and drift reports are deterministic. */
export const RESOURCE_KIND_ORDER: Readonly<Record<ResourceKind, number>> = Object.freeze(
  RESOURCE_KINDS.reduce((acc, k, i) => {
    acc[k] = i;
    return acc;
  }, {} as Record<ResourceKind, number>),
);

/** A declared resource. `spec` is a FLAT string map on purpose: it makes the
 *  field-level diff total and deterministic, and it is exactly what a compiled
 *  GitOps document (YAML/JSON flattened to leaf keys) reduces to. `sensitive`
 *  marks a resource whose change must always be human-approved. */
export interface ResourceDecl {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly spec: Readonly<Record<string, string>>;
  readonly sensitive?: boolean;
}

/** The version-controlled source of truth. */
export interface DesiredState {
  readonly resources: readonly ResourceDecl[];
}

/** A resource as it currently exists on the fleet/MDM (read-only observation). */
export interface ObservedResource {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly spec: Readonly<Record<string, string>>;
}

export interface ObservedState {
  readonly resources: readonly ObservedResource[];
}

// ============================================================================
// Plan
// ============================================================================

export const PLAN_ACTIONS = ["create", "update", "delete", "noop"] as const;
export type PlanActionKind = (typeof PLAN_ACTIONS)[number];

/** One field's before/after. `before === null` ⇒ the field is being added;
 *  `after === null` ⇒ the field is being removed. */
export interface FieldChange {
  readonly field: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface PlanItem {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly action: PlanActionKind;
  /** True when the change needs human approval: the resource is declared
   *  sensitive, OR the action is a delete (destructive changes are never
   *  auto-applied). */
  readonly sensitive: boolean;
  readonly changes: readonly FieldChange[];
}

export interface Plan {
  readonly items: readonly PlanItem[];
  readonly counts: Readonly<Record<PlanActionKind, number>>;
  /** Any create/update/delete present. */
  readonly hasChanges: boolean;
  /** Any item requires approval (sensitive resource or a delete). */
  readonly requiresApproval: boolean;
}

// ============================================================================
// Trust gate
// ============================================================================

/** The decision-fabric outcome that gates an apply. `unknown` is the fail-closed
 *  value for an unreachable/indeterminate decision — it blocks, like every
 *  non-`allow` outcome. */
export const TRUST_OUTCOMES = ["allow", "step_up", "restrict", "deny", "unknown"] as const;
export type TrustOutcome = (typeof TRUST_OUTCOMES)[number];

// ============================================================================
// Governed rollout lifecycle
// ============================================================================

export const ROLLOUT_STATUSES = [
  "draft",
  "planned",
  "pending_approval",
  "approved",
  "applied",
  "rejected",
  "superseded",
] as const;
export type RolloutStatus = (typeof ROLLOUT_STATUSES)[number];

/** The single source of truth for legal state moves. `applied` is reachable ONLY
 *  from `approved` — the structural guarantee that a rollout cannot apply itself. */
export const LEGAL_TRANSITIONS: Readonly<Record<RolloutStatus, readonly RolloutStatus[]>> =
  Object.freeze({
    draft: ["planned", "superseded"],
    planned: ["pending_approval", "superseded"],
    pending_approval: ["approved", "rejected", "superseded"],
    approved: ["applied", "superseded"],
    applied: ["superseded"],
    rejected: ["superseded"],
    superseded: [],
  });

export function isLegalTransition(from: RolloutStatus, to: RolloutStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** The human gate. `approvedByRef` is a reference to the approver (never a live
 *  credential); `approvedAtRef` is a monotonic sequence handle, deliberately NOT
 *  a wall-clock, so determinism stays provable. */
export interface RolloutApproval {
  readonly approvedByRef: string;
  readonly approvedAtRef: string;
}

export interface Rollout {
  readonly rolloutId: string;
  readonly status: RolloutStatus;
  readonly plan: Plan;
  readonly approval: RolloutApproval | null;
  /** The trust outcome recorded at apply time (null until applied). */
  readonly trustOutcome: TrustOutcome | null;
  readonly version: number;
}

// ============================================================================
// Drift
// ============================================================================

export const DRIFT_STATUSES = ["in_sync", "drifted", "unmanaged", "unknown", "missing"] as const;
export type DriftStatus = (typeof DRIFT_STATUSES)[number];

/** Worst-status-wins ranking. Mirrors self-audit's intent: not-knowing
 *  (`unknown`) outranks a known partial drift, and a wholly-`missing` declared
 *  resource is the worst. */
export const DRIFT_RANK: Readonly<Record<DriftStatus, number>> = Object.freeze({
  in_sync: 0,
  drifted: 1,
  unmanaged: 1,
  unknown: 2,
  missing: 3,
});

export interface DriftFinding {
  readonly kind: ResourceKind;
  readonly id: string;
  readonly status: DriftStatus;
  readonly detail: string;
  readonly changes: readonly FieldChange[];
}

export interface DriftReport {
  readonly findings: readonly DriftFinding[];
  readonly overall: DriftStatus;
  readonly counts: Readonly<Record<DriftStatus, number>>;
}

/** The self-audit-compatible check status (structural, so this module does not
 *  need to depend on @workspace/self-audit). */
export type CheckStatusLike = "healthy" | "drifted" | "broken" | "unknown";
export interface ProbeResultLike {
  readonly status: CheckStatusLike;
  readonly detail: string;
}

// ============================================================================
// Errors
// ============================================================================

export type IacErrorCode =
  | "illegal_transition"
  | "approver_required"
  | "approval_missing"
  | "trust_gate_blocked"
  | "malformed_input"
  | "unknown_kind"
  | "duplicate_resource";

/** A typed refusal. The message NEVER echoes a caller-supplied ref or value —
 *  only safe enum values (codes, statuses) are carried, so a refusal can't leak
 *  or reflect an attacker-influenced string. */
export class IacError extends Error {
  readonly code: IacErrorCode;
  readonly from?: RolloutStatus;
  readonly to?: RolloutStatus;

  constructor(
    code: IacErrorCode,
    message: string,
    opts?: { from?: RolloutStatus; to?: RolloutStatus },
  ) {
    super(message);
    this.name = "IacError";
    this.code = code;
    this.from = opts?.from;
    this.to = opts?.to;
  }
}

// ============================================================================
// Primitives
// ============================================================================

/** Recursively freeze so every handed-out object is immutable. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Non-empty-after-trim predicate for approver refs. */
export function recorded(ref: string | null | undefined): ref is string {
  return typeof ref === "string" && ref.trim().length > 0;
}
