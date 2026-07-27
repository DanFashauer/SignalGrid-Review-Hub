// The RELEASE LOOP — the second half of Issue #136's warehouse criterion:
// "verify that the inventory/bin state was corrected before releasing the
// workflow."
//
// The law, stated once and enforced here: A RESOLUTION POSTING IS NOT
// VERIFICATION; RELEASE REQUIRES INDEPENDENT EVIDENCE AND A TRUSTED DEVICE.
//
// It is grounded in the verified Oracle WMS short-pick chain the task-exception
// dimension already models: a short pick opens a discrepancy, the discrepancy
// spawns a cycle-count task, and it is the COUNT — a different record, produced by
// a different act — that confirms the fix. The adjustment posting says "we changed
// the number"; the count says "the number now matches the bin". The task-exception
// evaluator carries the same lesson at verdict level (`resolution_task_created`
// never softens severity: a ticket is not a fix); this module carries it at
// release level: a resolution ref is not evidence, and a ref that IS the
// resolution ref is the fix citing itself as its own proof.
//
// Release succeeds ONLY when ALL of these hold:
//   1. the exception was RESOLVED — a recorded, non-empty resolution ref;
//   2. DISTINCT verification evidence exists — a recorded, non-empty
//      verification ref that is NOT equal to the resolution ref;
//   3. the named task is actually HELD in this context;
//   4. the CURRENT device's own most recent composition is below restrict-grade —
//      held work is not released into the hands of a device the fabric is
//      currently restricting. Deliberately judged on `decision.deviceAction`, not
//      `finalRequiredAction`: the carried ceiling is person-scoped and monotone,
//      lowered only through `lowerTrustCeiling` with its own resolution ref — if
//      the ceiling disqualified release, one restrict-grade device anywhere in the
//      person's past would freeze their work on every healthy device forever.
//
// Every refusal is a typed `HandoffSimError`, and no message echoes a
// caller-supplied ref — the no-echo discipline (`@workspace/work-context` review
// history: a refusal message that repeated its argument reflected a pasted JWT
// verbatim; the same defect is designed out here rather than fixed later).
//
// On success the task moves held→active and the exception entry is removed via
// the REAL `resolveException` door — not a hand-rolled filter — so the removal
// demands its resolution ref, sweeps it for credential smells, advances
// `contextVersion` exactly once, and returns a deep-frozen context with
// everything else carried.

import { ACTION_RANK } from "@workspace/posture-composition";
import { resolveException, type PortableWorkContext } from "@workspace/work-context";
import { HandoffSimError, type ReleaseLedger } from "./types";

/** A recorded ref counts only when it is non-empty after trimming — the same
 *  standard `requireResolutionRef` applies inside the work-context doors. */
function recorded(ref: string | undefined): ref is string {
  return typeof ref === "string" && ref.trim().length > 0;
}

/** Release one held task against one carried exception entry. Pure; the input
 *  context is never mutated. Throws `HandoffSimError` (codes below) or, when the
 *  entry is not carried by this context, the `resolveException` door's own
 *  `WorkContextError` (`unknown_exception_ref`) — release never bypasses that
 *  door, so its refusals are the door's refusals. */
export function releaseHeldTask(
  context: PortableWorkContext,
  taskRef: string,
  exceptionRef: string,
  ledger: ReleaseLedger,
): PortableWorkContext {
  // (3) first: a release aimed at a task this context does not hold is the
  // caller's bug, and answering anything else about it would leak what the
  // ledger knows about work that is not held here.
  if (!context.work.heldTaskRefs.includes(taskRef)) {
    throw new HandoffSimError(
      "task_not_held",
      "cannot release: the named task is not among this context's held tasks (value withheld from this message by design).",
    );
  }

  // The named exception must be THE one holding the named task. Review proved
  // the hole this closes: with only "is the task held somewhere" checked, a
  // resolved+verified exception freed an UNRELATED held task whose own blocker
  // was still open. A release names both halves; the ledger's hold linkage is
  // what makes that naming checkable rather than decorative.
  if (ledger.holds[taskRef] !== exceptionRef) {
    throw new HandoffSimError(
      "exception_does_not_hold_task",
      "cannot release: the named exception is not the one holding the named task — a hold is released by resolving ITS exception, not any exception (values withheld from this message by design).",
    );
  }

  // (1) the fix must exist: a resolve step recorded a non-empty resolution ref.
  const resolutionRef = ledger.resolutions[exceptionRef];
  if (!recorded(resolutionRef)) {
    throw new HandoffSimError(
      "exception_unresolved",
      "cannot release: no resolution has been recorded for the named exception — a hold is released against a referenced fix, never against silence.",
    );
  }

  // (2) the PROOF of the fix must exist...
  const verificationRef = ledger.verifications[exceptionRef];
  if (!recorded(verificationRef)) {
    throw new HandoffSimError(
      "verification_missing",
      "cannot release: the exception is resolved but unverified — the resolution posting is not the verification; independent evidence (the cycle count, the re-scan) must exist before the workflow is released.",
    );
  }

  // ...and must be a DIFFERENT record than the fix. Same ref = the fix citing
  // itself as its own proof.
  // Trimmed on BOTH sides: review released with evidence = resolution + one
  // trailing space — the fix citing itself as its own proof modulo whitespace.
  if (verificationRef.trim() === resolutionRef.trim()) {
    throw new HandoffSimError(
      "verification_not_independent",
      "cannot release: the verification evidence is the resolution itself — the fix and the proof of the fix are different things, and one record cannot be both.",
    );
  }

  // One evidence record verifies ONE exception. Review verified the same
  // cycle-count ref "independently verifying" two different exceptions —
  // evidence replay. Independence is per-record, so a ref already recorded as
  // another exception's verification cannot verify this one.
  for (const [otherEntry, otherRef] of Object.entries(ledger.verifications)) {
    if (otherEntry !== exceptionRef && recorded(otherRef) && otherRef.trim() === verificationRef.trim()) {
      throw new HandoffSimError(
        "verification_evidence_reused",
        "cannot release: the verification evidence is already recorded as a DIFFERENT exception's verification — one record proves one fix.",
      );
    }
  }

  // (4) the device in the person's hands right now must not itself be judged
  // restrict-or-worse by its own composition.
  const decision = ledger.currentDeviceDecision;
  if (decision === null || ACTION_RANK[decision.deviceAction] >= ACTION_RANK.restrict) {
    throw new HandoffSimError(
      "device_not_trusted_for_release",
      "cannot release: the current device's own composition is restrict-grade or worse (or no device has been evaluated) — held work is not released into a device the fabric is currently restricting.",
    );
  }

  // Success. Move the task held→active on a plain structural copy, then let the
  // REAL resolveException door remove the exception entry: it re-validates the
  // resolution ref, refuses an entry this context does not carry, deep-copies,
  // deep-freezes, and advances contextVersion exactly once for the whole release.
  const moved: PortableWorkContext = {
    subject: { ...context.subject },
    work: {
      workflowKey: context.work.workflowKey,
      activeTaskRefs: [...context.work.activeTaskRefs, taskRef],
      heldTaskRefs: context.work.heldTaskRefs.filter((r) => r !== taskRef),
      unresolvedExceptionRefs: [...context.work.unresolvedExceptionRefs],
      appCatalogKeys: [...context.work.appCatalogKeys],
    },
    situation: {
      lastKnownZoneRef: context.situation.lastKnownZoneRef,
      custodyRefs: [...context.situation.custodyRefs],
    },
    trust: {
      requiredStepUpLevel: context.trust.requiredStepUpLevel,
      activeRestrictions: [...context.trust.activeRestrictions],
      policyVersionRef: context.trust.policyVersionRef,
      lastVerdictRef: context.trust.lastVerdictRef,
    },
    provenance: {
      assembledAtRef: context.provenance.assembledAtRef,
      sourceVerdictRefs: [...context.provenance.sourceVerdictRefs],
      contextVersion: context.provenance.contextVersion,
    },
  };
  return resolveException(moved, exceptionRef, resolutionRef);
}
