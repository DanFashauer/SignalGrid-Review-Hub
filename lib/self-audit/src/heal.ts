// The SELF-HEALING half, done the only way this repo permits: PROPOSAL, NOT
// MUTATION. A broken or drifted item that is `healable` yields a governed
// HealProposal that DESCRIBES the fix. Applying it is a human-approved act, and —
// exactly as `@workspace/adaptive-proposals` enforces for a policy change — there
// is no code path to `applied` that does not pass through `approved` carrying a
// non-empty human approver ref. A self-audit that silently repaired production
// would be unauditable; one that proposes and lets an operator approve compounds
// trust under governance instead of around it.

import {
  deepFreeze,
  SelfAuditError,
  type HealProposal,
  type HealStatus,
  type SelfAuditReport,
} from "./types";

/** The legal transitions of a heal proposal. The ONLY route to `applied` is
 *  `approved → applied`, and `approved` is reachable only from `proposed`. There is
 *  no `proposed → applied` edge: application cannot skip approval. */
const LEGAL_TRANSITIONS: Readonly<Record<HealStatus, readonly HealStatus[]>> = Object.freeze({
  proposed: ["approved", "rejected"],
  approved: ["applied", "rejected"],
  applied: [],
  rejected: [],
});

/**
 * Derive governed heal proposals from an audit report.
 *
 * Deterministic and pure. Emits one `proposed` HealProposal per item that is
 * `broken` or `drifted` AND `healable`. A healthy/unknown item, or a broken item
 * that is not healable, yields nothing — we never fabricate a fix we cannot
 * describe safely, and `unknown` means we do not even know there is something to
 * fix. Every proposal starts at `proposed` with `approvedByRef: null`; nothing is
 * applied. Sorted by proposalId, deep-frozen.
 */
export function proposeHeals(report: SelfAuditReport): HealProposal[] {
  const proposals: HealProposal[] = [];
  for (const ci of report.items) {
    if (ci.status !== "broken" && ci.status !== "drifted") continue;
    if (!ci.item.healable) continue;
    proposals.push(
      deepFreeze({
        proposalId: `heal-${ci.item.id}`,
        targetItemId: ci.item.id,
        layer: ci.item.layer,
        triggeredBy: ci.status,
        remediation: ci.item.remediationHint,
        status: "proposed" as HealStatus,
        approvedByRef: null,
        version: 1,
      }),
    );
  }
  proposals.sort((a, b) => a.proposalId.localeCompare(b.proposalId));
  return proposals;
}

function transition(proposal: HealProposal, to: HealStatus): void {
  const legal = LEGAL_TRANSITIONS[proposal.status] ?? [];
  if (!legal.includes(to)) {
    throw new SelfAuditError(
      "illegal_transition",
      `A heal proposal cannot move from '${proposal.status}' to '${to}'.`,
    );
  }
}

/**
 * Approve a proposed heal. REQUIRES a non-empty approver ref — the human gate.
 * Returns a new `approved` proposal; the input is never mutated. This is the ONLY
 * way to reach a state from which `applyHeal` can succeed.
 */
export function approveHeal(proposal: HealProposal, approvedByRef: string): HealProposal {
  transition(proposal, "approved");
  if (typeof approvedByRef !== "string" || approvedByRef.trim().length === 0) {
    // The core invariant, enforced HERE and again in applyHeal: no approval without
    // a human ref. A blank ref is not an approval.
    throw new SelfAuditError(
      "missing_approver",
      "Approving a heal requires a non-empty human approver ref.",
    );
  }
  return deepFreeze({
    ...proposal,
    status: "approved" as HealStatus,
    approvedByRef,
    version: proposal.version + 1,
  });
}

/**
 * Apply an APPROVED heal. This is the terminal governed act. It refuses unless the
 * proposal is `approved` AND carries a non-empty approver ref — the invariant is
 * enforced a SECOND time here so that even a hand-constructed `approved` proposal
 * with a blank ref cannot reach `applied`. Returns a new `applied` proposal.
 *
 * NOTE: applying is a STATE TRANSITION on the proposal record. It does not itself
 * execute a repair — the remediation is descriptive, and enacting it belongs to the
 * system of record the item names, under the same governance. This package records
 * that a human approved and applied a described fix; it never runs one.
 */
export function applyHeal(proposal: HealProposal): HealProposal {
  transition(proposal, "applied");
  if (typeof proposal.approvedByRef !== "string" || proposal.approvedByRef.trim().length === 0) {
    throw new SelfAuditError(
      "missing_approver",
      "A heal cannot be applied without a non-empty approver ref on the approved proposal.",
    );
  }
  return deepFreeze({
    ...proposal,
    status: "applied" as HealStatus,
    version: proposal.version + 1,
  });
}

/** Reject a proposed or approved heal. Terminal. Input never mutated. */
export function rejectHeal(proposal: HealProposal): HealProposal {
  transition(proposal, "rejected");
  return deepFreeze({
    ...proposal,
    status: "rejected" as HealStatus,
    version: proposal.version + 1,
  });
}

export { LEGAL_TRANSITIONS };
