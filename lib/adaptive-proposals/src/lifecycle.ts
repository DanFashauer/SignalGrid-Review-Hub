// The STATE MACHINE — the whole point of this package.
//
// The eight-step loop is only governance if its states can be reached in exactly one
// order, and the order is enforced by construction rather than by convention. This
// module is that enforcement.
//
// THE CORE INVARIANT, structurally enforced and proof-pinned:
//
//   There is NO transition from any pre-approval state directly to `activated`.
//   Activation requires passing through `approved`, and `approved` requires an
//   approval carrying a NON-EMPTY approver ref — the human gate. A proposal cannot
//   activate itself: there is no auto-approve flag, and no code path sets
//   `status = "activated"` without a prior `approved` state carrying an approver.
//
// It is enforced twice, on purpose:
//   1. STRUCTURALLY, by `LEGAL_TRANSITIONS`: `activated` appears as a target of exactly
//      one from-status, `approved`. The proof enumerates the whole table and asserts
//      this is exhaustively true, not merely untested-happens-to-hold.
//   2. DEFENCE IN DEPTH, in `activate()`: even a hand-crafted object claiming
//      `status: "approved"` with no approval is refused (`activation_without_approval`)
//      — so the gate does not rest on the table alone.
//
// Every refusal is a typed `AdaptiveProposalError` carrying its reason, and NO refusal
// message echoes a caller-supplied ref — messages name only statuses (safe enum values)
// and the reason. The input proposal is never mutated; every returned proposal is a new
// deep-frozen object with `version` advanced by one.

import {
  AdaptiveProposalError,
  deepFreeze,
  type AdaptiveProposal,
  type ProposalApproval,
  type ProposalStatus,
  type MeasurementResult,
  type SimulationResult,
} from "./types";

/** The transition table. The ONLY source of truth for what may follow what.
 *
 *  Read the invariant straight off it: `activated` is listed as a target ONLY under
 *  `approved`. `superseded` is reachable from anything not already terminal — a
 *  proposal can always be retired — but a superseded/activated/rejected proposal goes
 *  no further on its own. */
export const LEGAL_TRANSITIONS: Record<ProposalStatus, readonly ProposalStatus[]> = {
  draft: ["simulated", "superseded"],
  simulated: ["pending_approval", "superseded"],
  pending_approval: ["approved", "rejected", "superseded"],
  approved: ["activated", "superseded"],
  activated: ["superseded"],
  rejected: ["superseded"],
  superseded: [],
};

/** Is `to` a legal successor of `from`? Pure lookup over the table above — exported so
 *  the proof can enumerate the entire (status × status) space against it. */
export function isLegalTransition(from: ProposalStatus, to: ProposalStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

interface AdvancePatch {
  status?: ProposalStatus;
  simulation?: SimulationResult;
  approval?: ProposalApproval;
  measurement?: MeasurementResult;
}

/** The single mutator. Returns a NEW deep-frozen proposal with the patch applied and
 *  `version` advanced by one. Every path out of this module goes through here, so no
 *  path can forget the version bump or alias the input's arrays/objects. The input is
 *  never mutated (it is typically already frozen — every proposal this package hands
 *  out is). */
function advance(proposal: AdaptiveProposal, patch: AdvancePatch): AdaptiveProposal {
  return deepFreeze({
    proposalId: proposal.proposalId,
    provenance: {
      observedIncidentCount: proposal.provenance.observedIncidentCount,
      sourceEventRefs: [...proposal.provenance.sourceEventRefs],
      correlationSummary: proposal.provenance.correlationSummary,
    },
    recommendation: {
      kind: proposal.recommendation.kind,
      target: proposal.recommendation.target,
      description: proposal.recommendation.description,
    },
    simulation:
      patch.simulation !== undefined
        ? patch.simulation
        : proposal.simulation === null
          ? null
          : { ...proposal.simulation },
    status: patch.status ?? proposal.status,
    approval:
      patch.approval !== undefined
        ? patch.approval
        : proposal.approval === null
          ? null
          : { ...proposal.approval },
    measurement:
      patch.measurement !== undefined
        ? patch.measurement
        : proposal.measurement === null
          ? null
          : { ...proposal.measurement },
    version: proposal.version + 1,
  });
}

/** Guard a status change against `LEGAL_TRANSITIONS`. Throws `illegal_transition` — the
 *  message names only the two statuses (safe enum values), never a caller ref. */
function assertLegal(from: ProposalStatus, to: ProposalStatus): void {
  if (!isLegalTransition(from, to)) {
    throw new AdaptiveProposalError(
      "illegal_transition",
      `cannot transition from "${from}" to "${to}": not a legal transition in the governed lifecycle.`,
      from,
      to,
    );
  }
}

/** A recorded ref counts only when it is non-empty after trimming — the same standard
 *  the work-context resolution doors apply. */
function recorded(ref: string | undefined | null): ref is string {
  return typeof ref === "string" && ref.trim().length > 0;
}

// ── the transitions ────────────────────────────────────────────────────────────
//
// `draft → simulated` lives in `simulate.ts` (it must attach the simulation it just
// computed). Everything else is here.

/** simulated → pending_approval. Step 5 gates step 6: a proposal cannot reach
 *  `pending_approval` without a simulation attached. The simulation check is a REAL
 *  gate, not a comment — even a proposal that claims `simulated` status with no
 *  simulation attached is refused (`simulation_required`). */
export function requestApproval(proposal: AdaptiveProposal): AdaptiveProposal {
  assertLegal(proposal.status, "pending_approval");
  if (proposal.simulation === null) {
    throw new AdaptiveProposalError(
      "simulation_required",
      "cannot request approval: no simulation is attached — a change is not put before an owner until it has been simulated against history.",
      proposal.status,
      "pending_approval",
    );
  }
  return advance(proposal, { status: "pending_approval" });
}

/** pending_approval → approved. THE HUMAN GATE. Requires a NON-EMPTY `approvedByRef`;
 *  an empty or whitespace-only ref is refused (`approver_required`) — the gate cannot
 *  be satisfied by silence. On an illegal from-state (e.g. approving a still-`simulated`
 *  proposal) the refusal is `illegal_transition` and, critically, does NOT echo the
 *  caller-supplied `approvedByRef` — an adversarial approver ref is a token to withhold,
 *  not to reflect. */
export function approve(
  proposal: AdaptiveProposal,
  approvedByRef: string,
  approvedAtRef: string,
): AdaptiveProposal {
  assertLegal(proposal.status, "approved");
  if (!recorded(approvedByRef)) {
    throw new AdaptiveProposalError(
      "approver_required",
      "cannot approve: a non-empty approver ref is required — approval is a human act, and an empty ref is not one.",
      proposal.status,
      "approved",
    );
  }
  return advance(proposal, {
    status: "approved",
    approval: { approvedByRef, approvedAtRef },
  });
}

/** approved → activated. Version & activate explicitly (step 7). The table already
 *  bars every route to `activated` except from `approved`; this adds defence in depth:
 *  the proposal must actually CARRY an approval with a non-empty approver ref, so a
 *  hand-crafted `{ status: "approved", approval: null }` still cannot activate itself
 *  (`activation_without_approval`). There is no auto-approve path here — activation
 *  reads the approver the human gate recorded; it never mints one. */
export function activate(proposal: AdaptiveProposal): AdaptiveProposal {
  assertLegal(proposal.status, "activated");
  if (proposal.approval === null || !recorded(proposal.approval.approvedByRef)) {
    throw new AdaptiveProposalError(
      "activation_without_approval",
      "cannot activate: the proposal carries no approval with a non-empty approver ref — activation is reachable only through a human-approved state, never self-granted.",
      proposal.status,
      "activated",
    );
  }
  return advance(proposal, { status: "activated" });
}

/** pending_approval → rejected. The owner declined; the proposal is retired without
 *  ever activating. */
export function reject(proposal: AdaptiveProposal): AdaptiveProposal {
  assertLegal(proposal.status, "rejected");
  return advance(proposal, { status: "rejected" });
}

/** any (non-terminal) → superseded. A newer proposal, or an operator, retires this one.
 *  Legal from every state except the terminal ones (`superseded` cannot supersede
 *  itself; the table refuses it). Never a route to `activated`. */
export function supersede(proposal: AdaptiveProposal): AdaptiveProposal {
  assertLegal(proposal.status, "superseded");
  return advance(proposal, { status: "superseded" });
}

/** Internal helper shared with `simulate.ts` / `measure.ts`, which must attach a
 *  computed result while still going through the one mutator (so the version bump and
 *  deep-freeze cannot be forgotten). Not exported from the package's public surface. */
export function advanceWith(proposal: AdaptiveProposal, patch: AdvancePatch): AdaptiveProposal {
  return advance(proposal, patch);
}

export { assertLegal as assertLegalTransition };
