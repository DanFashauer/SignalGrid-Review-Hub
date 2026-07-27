// The deterministic simulator: replay a handoff script through the REAL
// mechanisms and record every step in a trace.
//
// Pure and deterministic — no clock, no randomness, no I/O. Two runs of the same
// script produce byte-identical traces; the input script is never mutated; the
// returned trace is deep-frozen. Steps that throw a TYPED refusal
// (`HandoffSimError` or the underlying `WorkContextError`) become `refused` trace
// entries with the state unchanged — refusals are part of the audit story, not
// crashes. Anything else (a genuine bug) still throws.
//
// Nothing simulated here is a live workflow: the "execution system" is the raw
// fixture inside an exception step, run through the real
// `normalizeReport → evaluateTaskException → fromTaskException` chain so the
// verdict — and therefore the hold, the carried entry's reason-code prefix, and
// the device decision — is exactly what the live fabric would have concluded from
// the same report.

import {
  WorkContextError,
  assembleWorkContext,
  deepFreeze,
  reevaluateForDevice,
  refuseCredentialMaterial,
  type DeviceDecision,
  type PortableWorkContext,
} from "@workspace/work-context";
import { ACTION_RANK, fromTaskException, type ComposableSignal } from "@workspace/posture-composition";
import { evaluateTaskException, normalizeReport } from "@workspace/integrations/task-exception";
import { releaseHeldTask } from "./release";
import {
  HandoffSimError,
  type HandoffRunResult,
  type HandoffScript,
  type HandoffTraceEntry,
  type TraceExceptionVerdict,
  type TraceRefusalCode,
} from "./types";

/** Structural deep copy — plain data in, plain data out. Used to thaw a frozen
 *  context before a simulator-level work transition (the hold) and to snapshot
 *  state into trace entries without aliasing the live objects. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Fixture device id used when an exception step arrives before any handoff —
 *  deterministic, and honest about the gap (the report reached the person's
 *  context without a device in the story yet). */
const UNATTRIBUTED_DEVICE = "device-unattributed";

/** A verdict at alert-or-worse holds the named task. Alert is the fabric's grade
 *  for a CONFIRMED fact about the work (open inventory exception, failed
 *  verification); restrict-grade integrity violations are above it. Monitor and
 *  step_up verdicts inform the decision but hold nothing — a watched inference or
 *  a gap is not a confirmed defect in the work. */
const HOLD_RANK: number = ACTION_RANK.alert;

/** Run one handoff script. Returns the final context (null if the script never
 *  assembled one) and the full deep-frozen trace. */
export function runHandoffScript(script: HandoffScript): HandoffRunResult {
  let context: PortableWorkContext | null = null;
  let deviceRef: string | null = null;
  let deviceSignals: ComposableSignal[] = [];
  let lastDecision: DeviceDecision | null = null;
  const resolutions: Record<string, string> = {};
  const holdsMap: Record<string, string> = {};
  const verifications: Record<string, string> = {};

  const entries: HandoffTraceEntry[] = [];

  script.steps.forEach((step, stepIndex) => {
    let status: HandoffTraceEntry["status"] = "applied";
    let refusalCode: TraceRefusalCode | null = null;
    let decision: HandoffTraceEntry["decision"] = null;
    let exception: TraceExceptionVerdict | null = null;

    try {
      if (context === null && step.kind !== "assemble") {
        throw new HandoffSimError(
          "step_before_assemble",
          "cannot apply this step: no work context has been assembled yet — a script's first step must mint the context the rest of it acts on.",
        );
      }
      switch (step.kind) {
        case "assemble": {
          context = assembleWorkContext(step.inputs);
          deviceRef = null;
          deviceSignals = [];
          lastDecision = null;
          break;
        }
        case "handoff": {
          const result = reevaluateForDevice(context as PortableWorkContext, step.deviceSignals);
          context = result.nextContext;
          deviceRef = step.deviceRef;
          deviceSignals = copy(step.deviceSignals);
          lastDecision = result.decision;
          decision = {
            finalRequiredAction: result.decision.finalRequiredAction,
            deviceAction: result.decision.deviceAction,
            carriedCeiling: result.decision.carriedCeiling,
            riskTier: result.decision.riskTier,
          };
          break;
        }
        case "exception": {
          const current = context as PortableWorkContext;
          // The REAL chain, end to end: hardened normalize → fail-safe evaluate →
          // unified-ladder adapter. The simulator invents no verdict of its own.
          const normalized = normalizeReport(deviceRef ?? UNATTRIBUTED_DEVICE, step.raw);
          const verdict = evaluateTaskException(normalized);
          const signal = fromTaskException(verdict);
          const carriedEntry = `${verdict.reasonCode}:${step.exceptionRef}`;
          const holds = ACTION_RANK[signal.action] >= HOLD_RANK;

          // A hold-grade exception is a work transition: the named task moves
          // active→held and the entry joins the travelling exceptions BEFORE the
          // re-evaluation, so the context that moves on already tells the next
          // device the truth. Applied on a plain copy; `reevaluateForDevice`
          // deep-copies, freezes, and advances the version exactly once.
          // Exception-step refs reach the carried context, so they are swept like
          // every other ingress — review found the doc claiming "every ref is
          // swept" while these two arrived unswept; the fix makes the claim true
          // rather than narrowing it.
          refuseCredentialMaterial(step.taskRef, "exception.taskRef");
          refuseCredentialMaterial(step.exceptionRef, "exception.exceptionRef");
          const base = copy(current);
          if (holds) {
            base.work.activeTaskRefs = base.work.activeTaskRefs.filter((r) => r !== step.taskRef);
            if (!base.work.heldTaskRefs.includes(step.taskRef)) base.work.heldTaskRefs.push(step.taskRef);
            if (!base.work.unresolvedExceptionRefs.includes(carriedEntry)) {
              base.work.unresolvedExceptionRefs.push(carriedEntry);
            }
            holdsMap[step.taskRef] = carriedEntry;
          }
          const result = reevaluateForDevice(base, [...deviceSignals, signal]);
          context = result.nextContext;
          lastDecision = result.decision;
          decision = {
            finalRequiredAction: result.decision.finalRequiredAction,
            deviceAction: result.decision.deviceAction,
            carriedCeiling: result.decision.carriedCeiling,
            riskTier: result.decision.riskTier,
          };
          exception = {
            posture: verdict.posture,
            reasonCode: verdict.reasonCode,
            recommendedAction: signal.action,
            carriedEntry,
            taskHeld: holds,
          };
          break;
        }
        case "resolve": {
          resolutions[step.exceptionRef] = step.resolutionRef;
          break;
        }
        case "verify": {
          verifications[step.exceptionRef] = step.verificationEvidenceRef;
          break;
        }
        case "release": {
          context = releaseHeldTask(context as PortableWorkContext, step.taskRef, step.exceptionRef, {
            holds: holdsMap,
            resolutions,
            verifications,
            currentDeviceDecision: lastDecision,
          });
          break;
        }
      }
    } catch (err) {
      // Typed refusals are part of the story; anything else is a bug and escapes.
      if (err instanceof HandoffSimError || err instanceof WorkContextError) {
        status = "refused";
        refusalCode = err.code;
      } else {
        throw err;
      }
    }

    entries.push({
      stepIndex,
      kind: step.kind,
      status,
      refusalCode,
      deviceRef,
      contextVersion: context === null ? null : context.provenance.contextVersion,
      requiredStepUpLevel: context === null ? null : context.trust.requiredStepUpLevel,
      decision,
      exception,
      work: context === null ? null : copy(context.work),
      activeRestrictions: context === null ? [] : [...context.trust.activeRestrictions],
      custodyRefs: context === null ? [] : [...context.situation.custodyRefs],
    });
  });

  return {
    finalContext: context,
    trace: deepFreeze({ scriptRef: script.scriptRef, entries }),
  };
}
