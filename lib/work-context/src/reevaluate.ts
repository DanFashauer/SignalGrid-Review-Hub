// Re-evaluation: the context follows the person; trust is re-earned per device.
//
// This is the half of Issue #136's semantic that makes continuity safe to have. The
// context that arrives with a person is a description of their work plus a carried
// trust floor. The device they just picked up contributes its OWN signals, composed
// through the fabric's real `composeDeviceRisk` — not a copy of the ladder, the
// actual one — and the decision for this device is the WORST of the two:
//
//     finalRequiredAction = worst( device-composed action, carried ceiling )
//
// Which yields the two monotone properties the proof enumerates:
//
//   CONTINUITY NEVER WIDENS. For a fixed context, a device that composes worse can
//   never receive a more permissive decision — `worst` is monotone in its first
//   argument. Carrying the context saved the person's WORK; it saved them nothing
//   on trust.
//
//   THE CEILING NEVER LOWERS BY MOVEMENT. The context that moves on carries
//   `worst(carried ceiling, projection of this device's action)`. Movement can
//   RAISE the floor the next device must re-prove; it can never lower it. Lowering
//   is an explicit, referenced act — `lowerTrustCeiling` with a non-empty
//   resolution ref — never a side effect of walking to a better device.
//
// And the third: EXCEPTIONS TRAVEL. `unresolvedExceptionRefs` and
// `activeRestrictions` are carried into every next context, and restrict-grade
// findings among this device's drivers are ADDED (restrict/escalate mean confirmed
// facts in this fabric, not gaps — a gap grades `step_up` and raises the ceiling
// instead). Nothing in re-evaluation removes an entry. Removal is `resolveException`
// / `clearRestriction`, one named entry at a time, each demanding a resolution ref —
// so every disappearance has a receipt.

import { ACTION_RANK, composeDeviceRisk, type ComposableSignal, type UnifiedAction } from "@workspace/posture-composition";
import {
  WorkContextError,
  ceilingFromAction,
  worstCeiling,
  type ContextTrustCeiling,
  type DeviceReevaluation,
  type PortableWorkContext,
} from "./types";
import { deepFreeze, refuseCredentialMaterial } from "./assemble";

/** The stricter of two full-ladder actions, by the fabric's own ranks. */
function worstAction(a: UnifiedAction, b: UnifiedAction): UnifiedAction {
  return ACTION_RANK[a] >= ACTION_RANK[b] ? a : b;
}

/** A copy of `context` with the trust/provenance overrides applied and the version
 *  bumped. Every path out of this module goes through here, so no path can forget
 *  the bump or accidentally alias the input's arrays. */
function advance(
  context: PortableWorkContext,
  trust: Partial<PortableWorkContext["trust"]>,
  work: Partial<PortableWorkContext["work"]> = {},
): PortableWorkContext {
  return deepFreeze({
    subject: { ...context.subject },
    work: {
      workflowKey: context.work.workflowKey,
      activeTaskRefs: [...context.work.activeTaskRefs],
      heldTaskRefs: [...context.work.heldTaskRefs],
      unresolvedExceptionRefs: [...context.work.unresolvedExceptionRefs],
      appCatalogKeys: [...context.work.appCatalogKeys],
      ...work,
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
      ...trust,
    },
    provenance: {
      assembledAtRef: context.provenance.assembledAtRef,
      sourceVerdictRefs: [...context.provenance.sourceVerdictRefs],
      contextVersion: context.provenance.contextVersion + 1,
    },
  });
}

/** Re-evaluate a carried context against ONE device's live signals.
 *
 *  Pure and deterministic; the input context is never mutated (and is typically
 *  already frozen — every context this package builds is). The device signals are
 *  swept against the credential denylist like every other ingress: a signal whose
 *  reason string smells like a token is refused, not composed. */
export function reevaluateForDevice(
  context: PortableWorkContext,
  deviceSignals: readonly ComposableSignal[],
): DeviceReevaluation {
  refuseCredentialMaterial(deviceSignals, "deviceSignals");

  const posture = composeDeviceRisk(deviceSignals);
  const deviceAction = posture.strongestAction;
  const carriedCeiling = context.trust.requiredStepUpLevel;

  // The device-scoped decision: worst of what this device composed and what the
  // person carried. The ceiling can only tighten the outcome, never spend it.
  const finalRequiredAction = worstAction(deviceAction, carriedCeiling);

  // The person-scoped ratchet: the floor the NEXT device must re-prove.
  const nextCeiling = worstCeiling(carriedCeiling, ceilingFromAction(deviceAction));

  // Restrict-grade drivers are CONFIRMED findings (this fabric grades gaps
  // `step_up`), so their reason codes join the restrictions that travel with the
  // person until explicitly cleared. Union, never replacement: carried entries
  // first, order preserved, no duplicates.
  const nextRestrictions = [...context.trust.activeRestrictions];
  for (const d of posture.drivers) {
    if (d.rank >= ACTION_RANK.restrict && !nextRestrictions.includes(d.reason)) {
      nextRestrictions.push(d.reason);
    }
  }

  return {
    decision: {
      finalRequiredAction,
      deviceAction,
      carriedCeiling,
      riskTier: posture.riskTier,
      drivers: posture.drivers,
    },
    nextContext: advance(context, {
      requiredStepUpLevel: nextCeiling,
      activeRestrictions: nextRestrictions,
    }),
  };
}

// ── the explicit resolution doors ─────────────────────────────────────────────

/** Every resolution call demands a non-empty resolution ref — the opaque handle of
 *  whatever closed the finding in its system of record (the cycle count that ran,
 *  the incident that closed). "Someone clicked dismiss" does not produce one. */
function requireResolutionRef(resolutionRef: string, what: string): void {
  refuseCredentialMaterial(resolutionRef, "resolutionRef");
  if (resolutionRef.trim().length === 0) {
    throw new WorkContextError(
      "resolution_ref_required",
      `refusing to ${what} without a resolution ref: carried trust state only narrows against a referenced resolution, never against silence.`,
    );
  }
}

/** Remove EXACTLY the named exception entry. Unknown ref → typed refusal, because a
 *  silent no-op is how a retried call "resolves" an exception that was never there
 *  while the real one keeps travelling. */
export function resolveException(
  context: PortableWorkContext,
  exceptionRef: string,
  resolutionRef: string,
): PortableWorkContext {
  requireResolutionRef(resolutionRef, "resolve an exception");
  if (!context.work.unresolvedExceptionRefs.includes(exceptionRef)) {
    // The ref is NOT echoed. Adversarial review pasted a full JWT into this
    // argument and read it back verbatim from the thrown message — the same
    // second-leak the assembly path already refuses. An unknown ref is the
    // caller's bug; the message names the problem, never the value.
    throw new WorkContextError(
      "unknown_exception_ref",
      "cannot resolve: the given ref is not among this context's unresolved exceptions (value withheld from this message by design).",
    );
  }
  return advance(context, {}, {
    unresolvedExceptionRefs: context.work.unresolvedExceptionRefs.filter((r) => r !== exceptionRef),
  });
}

/** Remove EXACTLY the named restriction reason code. Same rules as above. */
export function clearRestriction(
  context: PortableWorkContext,
  reasonCode: string,
  resolutionRef: string,
): PortableWorkContext {
  requireResolutionRef(resolutionRef, "clear a restriction");
  if (!context.trust.activeRestrictions.includes(reasonCode)) {
    throw new WorkContextError(
      "unknown_restriction",
      "cannot clear: the given reason code is not among this context's active restrictions (value withheld from this message by design).",
    );
  }
  return advance(context, {
    activeRestrictions: context.trust.activeRestrictions.filter((r) => r !== reasonCode),
  });
}

/** The ONLY way the carried ceiling goes down. Movement raises it (see
 *  `reevaluateForDevice`); this lowers it, against a resolution ref. A target at or
 *  above the current ceiling is refused — the resolution door does not raise, so a
 *  caller cannot launder an escalation through the audit trail of a resolution. */
export function lowerTrustCeiling(
  context: PortableWorkContext,
  to: ContextTrustCeiling,
  resolutionRef: string,
): PortableWorkContext {
  requireResolutionRef(resolutionRef, "lower the trust ceiling");
  if (ACTION_RANK[to] >= ACTION_RANK[context.trust.requiredStepUpLevel]) {
    throw new WorkContextError(
      "not_a_lowering",
      `cannot "lower" the ceiling from \`${context.trust.requiredStepUpLevel}\` to \`${to}\`: the resolution door only lowers; raising happens through re-evaluation, driven by evidence.`,
    );
  }
  return advance(context, { requiredStepUpLevel: to });
}
