// @workspace/iac — governed rollout lifecycle with a trust gate.
//
// The GitOps "pull-request-before-rollout" workflow, encoded as state:
//   draft → planned → pending_approval → approved → applied
// Two guarantees stack, both fail-closed:
//   1. A rollout cannot apply itself. `applied` is reachable only from
//      `approved`, and apply() re-checks that the carried approval has a
//      non-empty approver ref — so a hand-forged {status:"approved",
//      approval:null} still cannot apply.
//   2. The apply is TRUST-GATED. Even a fully-approved rollout applies only when
//      the live decision-fabric outcome is `allow`; any other outcome
//      (step_up/restrict/deny) and the fail-closed `unknown` block it.
//
// Every transition returns a NEW deep-frozen rollout with version+1; the input
// is never mutated.

import {
  deepFreeze,
  IacError,
  isLegalTransition,
  recorded,
  type Plan,
  type Rollout,
  type RolloutStatus,
  type TrustOutcome,
} from "./types";

/** Single mutator: validates the move, then returns a frozen next state. */
function advance(rollout: Rollout, to: RolloutStatus, patch: Partial<Rollout> = {}): Rollout {
  if (!isLegalTransition(rollout.status, to)) {
    throw new IacError(
      "illegal_transition",
      `Cannot move a rollout from ${rollout.status} to ${to}.`,
      { from: rollout.status, to },
    );
  }
  return deepFreeze({
    ...rollout,
    ...patch,
    status: to,
    version: rollout.version + 1,
  });
}

/** Create a fresh rollout in `draft` around a computed plan. */
export function createRollout(rolloutId: string, plan: Plan): Rollout {
  if (typeof rolloutId !== "string" || rolloutId.trim().length === 0) {
    throw new IacError("malformed_input", "A rollout needs a non-empty id.");
  }
  return deepFreeze({
    rolloutId,
    status: "draft",
    plan,
    approval: null,
    trustOutcome: null,
    version: 0,
  });
}

/** draft → planned. Marks the plan as reviewed and ready to submit. */
export function markPlanned(rollout: Rollout): Rollout {
  return advance(rollout, "planned");
}

/** planned → pending_approval. Submit for human review. */
export function requestApproval(rollout: Rollout): Rollout {
  return advance(rollout, "pending_approval");
}

/** pending_approval → approved. THE human gate: refuses an empty approver ref. */
export function approve(
  rollout: Rollout,
  approvedByRef: string,
  approvedAtRef: string,
): Rollout {
  if (!recorded(approvedByRef)) {
    throw new IacError("approver_required", "Approval requires a recorded approver reference.");
  }
  if (!recorded(approvedAtRef)) {
    throw new IacError("approver_required", "Approval requires a recorded approval sequence reference.");
  }
  return advance(rollout, "approved", { approval: { approvedByRef, approvedAtRef } });
}

/** pending_approval → rejected. */
export function reject(rollout: Rollout): Rollout {
  return advance(rollout, "rejected");
}

/** any → superseded. */
export function supersede(rollout: Rollout): Rollout {
  return advance(rollout, "superseded");
}

/**
 * approved → applied, gated on BOTH a recorded approval and an `allow` trust
 * outcome. Order of checks is deliberate: legality (via advance) then the
 * approval re-check then the trust gate — every failure is a typed refusal that
 * leaves the rollout unchanged.
 */
export function apply(rollout: Rollout, trustOutcome: TrustOutcome): Rollout {
  // Legality first: only an `approved` rollout can move to `applied`. A rollout
  // in any other state (draft, pending_approval, …) is refused here as an
  // illegal transition — before we even look at approval or trust.
  if (!isLegalTransition(rollout.status, "applied")) {
    throw new IacError(
      "illegal_transition",
      `Cannot move a rollout from ${rollout.status} to applied.`,
      { from: rollout.status, to: "applied" },
    );
  }
  // Re-verify the carried approval independently of status, so a forged
  // `approved` record with a null/blank approver cannot slip through.
  if (!rollout.approval || !recorded(rollout.approval.approvedByRef)) {
    throw new IacError(
      "approval_missing",
      "A rollout cannot be applied without a recorded human approval.",
      { from: rollout.status, to: "applied" },
    );
  }
  // The trust gate. Only `allow` releases; every other outcome — including the
  // fail-closed `unknown` — blocks the apply.
  if (trustOutcome !== "allow") {
    throw new IacError(
      "trust_gate_blocked",
      `The trust decision (${trustOutcome}) does not permit this apply; only an allow releases a rollout.`,
      { from: rollout.status, to: "applied" },
    );
  }
  return advance(rollout, "applied", { trustOutcome });
}
