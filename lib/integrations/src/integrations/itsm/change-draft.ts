// Cascade join 2 — a change record is OPENED, not only read.
//
// The fabric could already READ the change plane (`../change-window/`) and grade
// whether an operation was happening under an approved change. It could already
// PLAN a resolution (`signalgrid-core/resolution.ts`) — ordered steps, each naming
// the reason code it would clear. Nothing joined them: a plan that required a
// change to a managed system had no way to say so in the system that governs
// changes, and the change plane could only ever observe a record somebody else
// raised.
//
// This module is that join. It turns a resolution plan into a CHANGE-REQUEST
// DRAFT — what would change, on which target, why, and which reason codes it would
// clear — and submits it through the itsm family's own gate.
//
// ── WHY THIS LIVES IN itsm/ AND NOT IN change-window/ ────────────────────────
// Reading the change plane and opening a change record are different acts, and the
// read-only family says so in its own header: "SignalGrid raises no change,
// approves none, schedules none, closes none, and never writes a word back."
// That sentence stays true. A draft is an outbound act, so it belongs with the
// outbound family and passes the gate every outbound act here passes
// (`resolveItsmEmitter`). change-window types are imported for EVIDENCE only —
// nothing in this file calls that connector, and no draft is ever written back to
// the record it cites.
//
// ── THE THREE RULES THIS DRAFT INHERITS, AND MUST NOT QUIETLY LOOSEN ─────────
//
//  1. APPROVAL-REQUIRED AND SIMULATED, exactly as `proposeRemediation` already is.
//     `status` is the literal `"requires_approval"`; `approvalRequired` and
//     `simulatedOnly` are literal `true`. They are literal TYPES, not booleans with
//     a true default — the type cannot express a draft that is pre-approved or
//     self-executing, so no branch, no caller and no future edit can produce one
//     without changing the type and tripping every assertion that reads it.
//     Submitting a draft is not approving it: the `submitted` result carries the
//     same draft, still `requires_approval`. There is no "approved" status and no
//     "executed" status, by design.
//
//  2. A CHANGE WINDOW MAY NEVER RELAX A CONTROL. The read-only family refuses to
//     let an ITSM row manufacture a grant; a draft derived from that row inherits
//     the refusal. `changeWindowEvidence` is carried into the draft for the human
//     approving it and is read by NOTHING here: a verdict of `change_authorized`
//     with `changeAuthorized: true` produces a draft byte-identical to one drafted
//     with no change record at all, apart from that evidence field. An approved
//     window does not pre-approve the draft, shorten it, or drop a step.
//
//  3. AN ABSENT OR UNREACHABLE CHANGE PLANE MEANS NO CHANGE RECORD EXISTS, which
//     can never itself authorize the change. Passing `null` is therefore not a
//     degraded mode with fewer checks — it is the SAME draft, and the absence is
//     recorded as absence (`changeWindowEvidence: null`) rather than as silence.
//     `changeClass` (standard / normal / emergency) rides along as a string a
//     source system wrote, never graded, for the same reason the evaluator refuses
//     to grade it: anyone who can write that field could otherwise write themselves
//     a pass.
//
// Pure and total: no clock, no randomness, no IO in `draftChangeRequest`. The id is
// a digest of the inputs, so the same plan and target draft the same request
// forever, and two drafts that differ anywhere differ in their id.

import { createHash } from "node:crypto";
import { resolveItsmEmitter, type ItsmEmitPayload, type ItsmEmitTransport } from "./resolve";
import type { ChangeWindowVerdict } from "../change-window/types";

/**
 * The slice of a core `ResolutionPlan` a draft reads.
 *
 * STRUCTURAL ON PURPOSE. `lib/integrations` does not depend on
 * `lib/signalgrid-core` — no module here imports it, and that layering is
 * deliberate. A real `ResolutionPlan` satisfies this shape, so the join costs no
 * dependency edge and no lockfile change, and this interface doubles as the
 * statement of exactly which four facts a change draft is entitled to read.
 */
export interface ChangeDraftPlan {
  readonly decisionId: string;
  readonly steps: readonly {
    readonly reasonCode: string;
    readonly resolutionClass: string;
    readonly action: string;
    /** The reason code this step would clear if completed. */
    readonly clears: string;
  }[];
  /** Reason codes the planner has no step for. Carried, never dropped. */
  readonly unresolvedCodes: readonly string[];
}

/** What the change would act on. `kind` is narrative for the approver — it is
 *  written into the summary and graded by nothing. */
export interface ChangeDraftTarget {
  readonly kind: "device" | "identity" | "policy" | "facility";
  readonly ref: string;
}

/** One proposed change line, derived from one resolution step. */
export interface ChangeDraftItem {
  readonly order: number;
  readonly reasonCode: string;
  readonly resolutionClass: string;
  /** What would be done. Verbatim from the plan — this module writes no actions. */
  readonly action: string;
  /** The reason code this line would clear. */
  readonly clears: string;
}

/**
 * The change-request draft.
 *
 * Note what this type does NOT have: no `approved`, no `executed`, no
 * `autoApprove`, no field an ITSM answer could set to make the draft carry its own
 * authorization. The omissions are the safety property; adding one of them back is
 * the defect this header exists to name in advance.
 */
export interface ChangeRequestDraft {
  /** Digest of every input below. Deterministic, no clock, no counter. */
  readonly id: string;
  readonly decisionId: string;
  readonly target: ChangeDraftTarget;
  /** One line a human reads first. */
  readonly summary: string;
  /** Why: the blocks this change answers, in the plan's own words. */
  readonly justification: string;
  readonly items: readonly ChangeDraftItem[];
  /** Which reason codes this draft would clear, deduplicated, plan order. */
  readonly clearsReasonCodes: readonly string[];
  /** Reason codes the plan could not answer, so the approver sees what this draft
   *  does NOT fix. A draft that hid these would read as a complete remedy. */
  readonly unresolvedReasonCodes: readonly string[];
  /** The change plane's standing at draft time, or null when it was absent or
   *  unreachable. EVIDENCE ONLY — see rules 2 and 3 in the header. */
  readonly changeWindowEvidence: ChangeWindowVerdict | null;
  /** Source-reported, carried, never graded. Null when no record was read. */
  readonly changeClass: string | null;
  readonly status: "requires_approval";
  readonly approvalRequired: true;
  readonly simulatedOnly: true;
}

/**
 * Build a change-request draft from a resolution plan. Pure and total.
 *
 * Every step becomes a line: a plan whose steps are all `manual_only` still drafts,
 * because the change record is how a manual remedy gets scheduled and attributed.
 * The plan's `unresolvedCodes` ride along so the approver can see the draft is
 * partial when it is.
 */
export function draftChangeRequest(
  plan: ChangeDraftPlan,
  target: ChangeDraftTarget,
  changeWindowEvidence: ChangeWindowVerdict | null = null,
): ChangeRequestDraft {
  const items: ChangeDraftItem[] = plan.steps.map((step, i) => ({
    order: i + 1,
    reasonCode: step.reasonCode,
    resolutionClass: step.resolutionClass,
    action: step.action,
    clears: step.clears,
  }));
  const clearsReasonCodes = [...new Set(items.map((item) => item.clears))];
  const unresolvedReasonCodes = [...new Set(plan.unresolvedCodes)];

  const summary = `SignalGrid: ${items.length} proposed change${items.length === 1 ? "" : "s"} on ${target.kind} ${target.ref} (decision ${plan.decisionId})`;
  const justification =
    clearsReasonCodes.length > 0
      ? `Would clear: ${clearsReasonCodes.join(", ")}.`
      : "Would clear no reason code — the plan proposed no step that resolves a block.";

  return {
    id: draftId(plan, target),
    decisionId: plan.decisionId,
    target,
    summary,
    justification,
    items,
    clearsReasonCodes,
    unresolvedReasonCodes,
    changeWindowEvidence,
    changeClass: null,
    status: "requires_approval",
    approvalRequired: true,
    simulatedOnly: true,
  };
}

/**
 * Attach the source-reported change class as evidence.
 *
 * A SEPARATE function rather than a parameter, so the one field this family refuses
 * to grade cannot reach `draftChangeRequest` at all. Nothing in the drafting path
 * can branch on a value it never receives — which is a stronger guarantee than a
 * comment asking future edits not to. The returned draft differs in exactly this
 * one field and its id.
 */
export function withChangeClass(draft: ChangeRequestDraft, changeClass: string | null): ChangeRequestDraft {
  const next = { ...draft, changeClass };
  return { ...next, id: digest(JSON.stringify([draft.id, changeClass])) };
}

function draftId(plan: ChangeDraftPlan, target: ChangeDraftTarget): string {
  return digest(
    JSON.stringify([
      plan.decisionId,
      target.kind,
      target.ref,
      plan.steps.map((s) => [s.reasonCode, s.resolutionClass, s.action, s.clears]),
      [...plan.unresolvedCodes],
    ]),
  );
}

function digest(input: string): string {
  return `chg-draft-${createHash("sha256").update(input).digest("hex").slice(0, 12)}`;
}

/**
 * The outcome of offering a draft to the ITSM.
 *
 * `submitted` means a change record was opened carrying the draft — NOT that the
 * change was approved. The draft it carries is the same draft, still
 * `requires_approval`; approval happens in the ITSM, by people, and SignalGrid
 * never learns of it here.
 */
export type ChangeDraftSubmission =
  | { readonly status: "submitted"; readonly draft: ChangeRequestDraft }
  | { readonly status: "not_submitted"; readonly reason: string; readonly draft: ChangeRequestDraft }
  | {
      readonly status: "withheld";
      readonly reason: string;
      readonly draft: ChangeRequestDraft;
      /** The fixture record of what WOULD have been sent. `delivered: false` is a
       *  literal on that type — a withheld draft cannot claim it was opened. */
      readonly recorded: ItsmEmitPayload;
    };

/**
 * Submit a draft through the itsm family's gate — the same gate the ticket path
 * passes, for the same reason: opening a change record is an outbound act.
 *
 * Fail-closed on every path. `withheld` is the gate declining (wrong tier, flag
 * off, no token, no injected transport — this repository ships none, so `withheld`
 * is the only answer in this tree). `not_submitted` is a transport that was
 * present and did not deliver. Neither is ever reported as `submitted`, and every
 * refusal names its cause, because "no change record was opened" and "there was no
 * change to open" must not read alike.
 *
 * The transport is a PARAMETER. It was almost a module-level lookup, which would
 * have made the `submitted` and `not_submitted` arms unreachable by any test in
 * this tree — and a refusal nothing can reach is a comment, not a guard.
 */
export async function submitChangeDraft(
  draft: ChangeRequestDraft,
  env: NodeJS.ProcessEnv = process.env,
  transport?: ItsmEmitTransport,
): Promise<ChangeDraftSubmission> {
  const payload = changeDraftPayload(draft);
  const resolution = resolveItsmEmitter(env, transport);
  if (resolution.mode === "fixture") {
    resolution.emitter.record(payload);
    return { status: "withheld", reason: resolution.reason, draft, recorded: payload };
  }
  try {
    await resolution.deliver(payload);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      status: "not_submitted",
      reason: `the change plane did not accept the draft: ${detail}`,
      draft,
    };
  }
  return { status: "submitted", draft };
}

/** The wire shape. Flat, so an ITSM field mapping is a rename rather than a walk. */
export function changeDraftPayload(draft: ChangeRequestDraft): ItsmEmitPayload {
  return {
    kind: "change_request_draft",
    id: draft.id,
    decisionId: draft.decisionId,
    targetKind: draft.target.kind,
    targetRef: draft.target.ref,
    summary: draft.summary,
    justification: draft.justification,
    items: draft.items,
    clearsReasonCodes: draft.clearsReasonCodes,
    unresolvedReasonCodes: draft.unresolvedReasonCodes,
    changeClass: draft.changeClass,
    changeWindowPosture: draft.changeWindowEvidence?.posture ?? null,
    changeWindowRef: draft.changeWindowEvidence?.changeRef ?? null,
    status: draft.status,
    approvalRequired: draft.approvalRequired,
    simulatedOnly: draft.simulatedOnly,
  };
}
