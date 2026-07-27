// Assembly: fabric verdict summaries in, portable work context out.
//
// Pure and deterministic — same inputs, byte-identical context. There is no clock in
// here (`assembledAtRef` is an opaque monotonic ref the caller mints), no I/O, and no
// judgement of the underlying reports: this layer consumes what the dimensions already
// CONCLUDED, the same position `pim-activation` occupies. The verdicts stay owned by
// the attestation layer; this only carries their refs, reason codes and actions.
//
// The one refusal this layer owns is the credential sweep. "Descriptive, never
// permissive" is a property of the schema, and a property nobody enforces is a
// property the first hurried caller deletes — so every string in the inputs is swept
// against `CREDENTIAL_DENYLIST` and one hit refuses the WHOLE assembly with a typed
// error naming the field path and the smell. Refuses, not sanitizes: a context minus
// the secret-looking field would still have been assembled from inputs someone
// contaminated, and the caller needs to hear that, not receive a quietly edited copy.

import {
  CREDENTIAL_DENYLIST,
  WorkContextError,
  ceilingFromAction,
  worstCeiling,
  type PortableWorkContext,
  type WorkContextSituation,
  type WorkContextSubject,
  type WorkContextWork,
} from "./types";
import { ACTION_RANK, type UnifiedAction } from "@workspace/posture-composition";

/** One dimension's contribution to the assembly: the fabric's conclusion, by ref.
 *  A VERDICT summary — action + reason codes + the handle of the sealed verdict —
 *  never the raw report it was concluded from. */
export interface SourceVerdictSummary {
  /** Opaque handle to the sealed verdict in the attestation layer. */
  verdictRef: string;
  /** What the fabric concluded, on the unified action ladder. */
  strongestAction: UnifiedAction;
  /** The reason codes that drove it (e.g. `TASK_ASSIGNMENT_MISMATCH`). */
  reasonCodes: string[];
}

export interface AssembleWorkContextInputs {
  subject: WorkContextSubject;
  work: WorkContextWork;
  situation: WorkContextSituation;
  /** The verdicts this context is assembled FROM, oldest first. At least one:
   *  a context with no provenance is an assertion, not a context. */
  sourceVerdicts: SourceVerdictSummary[];
  /** Opaque handle naming the policy version in force at assembly. */
  policyVersionRef: string;
  /** Opaque MONOTONIC assembly ref — the caller's sequence handle, never a clock. */
  assembledAtRef: string;
}

// ── the credential sweep ──────────────────────────────────────────────────────

/** Walk every string in `value`, depth-first in key order, and throw the typed
 *  refusal on the FIRST credential smell. Deterministic: object keys are visited
 *  in their own enumeration order, so the same inputs name the same path. */
export function refuseCredentialMaterial(value: unknown, path: string): void {
  if (typeof value === "string") {
    for (const entry of CREDENTIAL_DENYLIST) {
      if (entry.pattern.test(value)) {
        // The offending VALUE is deliberately not echoed — an error that repeats a
        // secret is a second leak. The path and the family are enough to fix it.
        throw new WorkContextError(
          "credential_material_refused",
          `refusing to assemble a work context: the value at \`${path}\` matches the credential denylist (${entry.smell}). ` +
            "This schema is descriptive, never permissive — refs are opaque handles, and nothing that could be replayed may travel with the work.",
          path,
          entry.smell,
        );
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => refuseCredentialMaterial(v, `${path}[${i}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) refuseCredentialMaterial(v, `${path}.${k}`);
  }
  // numbers, booleans, null, undefined: nothing to smell.
}

// ── immutability ──────────────────────────────────────────────────────────────

/** Freeze a context (or any plain data) all the way down. Every context this
 *  package hands out is frozen, so "the input context is never mutated" is not a
 *  convention downstream code is trusted with — a mutation attempt throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

// ── assembly ──────────────────────────────────────────────────────────────────

const RESTRICT_RANK = ACTION_RANK.restrict;

/** Build a portable work context from fabric outputs. Pure, deterministic, and
 *  fail-safe in both derivations:
 *
 *  - `trust.requiredStepUpLevel` is the WORST ceiling any source verdict projects
 *    to (`alert` projects to `step_up`, `escalate` to `restrict` — projection never
 *    rounds down past a rung, see `ceilingFromAction`);
 *  - `trust.activeRestrictions` collects the reason codes of every verdict at
 *    `restrict` or above — confirmed findings, which is what restrict-grade means
 *    in this fabric — deduplicated, input order preserved.
 *
 *  Throws `WorkContextError`:
 *  - `credential_material_refused` if any input string smells like a credential;
 *  - `no_source_verdicts` if `sourceVerdicts` is empty. */
export function assembleWorkContext(inputs: AssembleWorkContextInputs): PortableWorkContext {
  refuseCredentialMaterial(inputs, "inputs");

  if (inputs.sourceVerdicts.length === 0) {
    throw new WorkContextError(
      "no_source_verdicts",
      "refusing to assemble a work context from zero source verdicts: a context is a summary of what the fabric concluded, and with no verdicts there is nothing it could be a summary of.",
    );
  }

  let ceiling = ceilingFromAction("none");
  const restrictions: string[] = [];
  for (const v of inputs.sourceVerdicts) {
    ceiling = worstCeiling(ceiling, ceilingFromAction(v.strongestAction));
    if (ACTION_RANK[v.strongestAction] >= RESTRICT_RANK) {
      for (const code of v.reasonCodes) if (!restrictions.includes(code)) restrictions.push(code);
    }
  }

  const context: PortableWorkContext = {
    subject: { ...inputs.subject },
    work: {
      workflowKey: inputs.work.workflowKey,
      activeTaskRefs: [...inputs.work.activeTaskRefs],
      heldTaskRefs: [...inputs.work.heldTaskRefs],
      unresolvedExceptionRefs: [...inputs.work.unresolvedExceptionRefs],
      appCatalogKeys: [...inputs.work.appCatalogKeys],
    },
    situation: {
      lastKnownZoneRef: inputs.situation.lastKnownZoneRef,
      custodyRefs: [...inputs.situation.custodyRefs],
    },
    trust: {
      requiredStepUpLevel: ceiling,
      activeRestrictions: restrictions,
      policyVersionRef: inputs.policyVersionRef,
      lastVerdictRef: inputs.sourceVerdicts[inputs.sourceVerdicts.length - 1].verdictRef,
    },
    provenance: {
      assembledAtRef: inputs.assembledAtRef,
      sourceVerdictRefs: inputs.sourceVerdicts.map((v) => v.verdictRef),
      contextVersion: 1,
    },
  };

  return deepFreeze(context);
}
