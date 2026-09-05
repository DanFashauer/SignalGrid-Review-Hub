// Cross-device handoff simulation — Issue #136's continuity semantic as a
// DETERMINISTIC SCRIPT, plus the exception-release verification loop.
//
// A handoff script is DATA: a typed sequence of steps describing a person's shift
// across shared devices — assemble the portable context, hand off to a device,
// take an exception from the execution system, resolve it, verify the fix, release
// the held work. The simulator (`simulate.ts`) replays the script through the REAL
// mechanisms — `assembleWorkContext` / `reevaluateForDevice` from
// `@workspace/work-context`, the real `normalizeReport → evaluateTaskException →
// fromTaskException` chain from the task-exception dimension — and records every
// step's outcome in a trace. The trace IS the audit story: what the person carried,
// what each device was judged, which refusals fired and why (by typed code, never
// by echoed ref).
//
// Nothing here talks to a live system. Scripts are fixtures; every run from the
// same script is byte-identical; the input script is never mutated and the trace is
// deep-frozen. This package moves no inventory, holds no real task, and grants
// nothing — it simulates the DESCRIPTION of a workflow so the release-loop law can
// be machine-checked.

import type {
  AssembleWorkContextInputs,
  ContextTrustCeiling,
  DeviceDecision,
  PortableWorkContext,
  WorkContextErrorCode,
  WorkContextWork,
} from "@workspace/work-context";
import type { ComposableSignal, RiskTier, UnifiedAction } from "@workspace/posture-composition";
import type {
  TaskExceptionPosture,
  TaskExceptionReasonCode,
  TaskExceptionReportRaw,
} from "@workspace/integrations/task-exception";

// ── the script: a deterministic sequence of typed steps, as data ──────────────

/** Mint the portable work context this script's person carries. Must be the first
 *  step — every other step is an event happening TO that carried context. */
export interface AssembleStep {
  kind: "assemble";
  inputs: AssembleWorkContextInputs;
}

/** The person picks up (or turns to) a device. The device's OWN signals are
 *  composed through the fabric's real `composeDeviceRisk` inside
 *  `reevaluateForDevice`: the work travels unchanged; trust is re-earned here. */
export interface HandoffStep {
  kind: "handoff";
  /** Opaque fixture handle for the device (e.g. `handheld-A`). Names the device in
   *  the trace; asserts nothing about it — its signals do that. */
  deviceRef: string;
  deviceSignals: ComposableSignal[];
}

/** The execution system raises an exception about the work on the CURRENT device.
 *
 *  The raw report runs the REAL chain — `normalizeReport` (hardened parse) →
 *  `evaluateTaskException` (fail-safe verdict) → `fromTaskException` (unified
 *  ladder) — and the resulting signal is composed with the current device's
 *  signals through `reevaluateForDevice`, so the decision reflects the exception
 *  the same way the live fabric would see it.
 *
 *  A restrict/alert-grade verdict also HOLDS the named task: `taskRef` moves from
 *  `activeTaskRefs` to `heldTaskRefs`, and the carried entry
 *  `<verdict.reasonCode>:<exceptionRef>` (the `work-context` exception-entry
 *  convention) is appended to `unresolvedExceptionRefs`. The person's OTHER tasks
 *  stay active — one bad pick holds one task, not the shift. */
export interface ExceptionStep {
  kind: "exception";
  /** The task the exception is about — the one a hold-grade verdict holds. */
  taskRef: string;
  /** Opaque handle of the exception record in the execution system. The carried
   *  entry derives its prefix from the REAL evaluator's reason code. */
  exceptionRef: string;
  raw: TaskExceptionReportRaw;
}

/** The execution system posts a RESOLUTION for an exception (the inventory
 *  adjustment, the corrected bin). Recorded in the release ledger; the exception
 *  entry keeps travelling — a resolution posting alone releases nothing. */
export interface ResolveStep {
  kind: "resolve";
  /** The carried exception entry (`<reasonCode>:<exceptionRef>`). */
  exceptionRef: string;
  /** Opaque handle of what closed the finding in its system of record. */
  resolutionRef: string;
}

/** INDEPENDENT verification evidence that the fix is real (the cycle count that
 *  re-counted the bin — the Oracle short-pick chain's second half). Recorded in
 *  the release ledger. A later verify step for the same exception replaces an
 *  earlier one — evidence can be superseded, never accumulated ambiguously. */
export interface VerifyStep {
  kind: "verify";
  exceptionRef: string;
  verificationEvidenceRef: string;
}

/** Attempt to release the held task against the named exception — the release
 *  loop (`release.ts`). Succeeds only when resolution + independent verification
 *  + a trusted current device ALL hold; otherwise the step is a typed refusal in
 *  the trace, and the hold stands. */
export interface ReleaseStep {
  kind: "release";
  taskRef: string;
  exceptionRef: string;
}

export type HandoffScriptStep =
  | AssembleStep
  | HandoffStep
  | ExceptionStep
  | ResolveStep
  | VerifyStep
  | ReleaseStep;

export interface HandoffScript {
  /** Opaque fixture handle naming this script in traces and docs. */
  scriptRef: string;
  steps: HandoffScriptStep[];
}

// ── the release ledger ────────────────────────────────────────────────────────

/** What the release loop consults, keyed by carried exception entry. Maintained by
 *  the simulator from resolve/verify steps; passable by hand for direct use. */
export interface ReleaseLedger {
  /** exception entry → resolution ref (the fix's posting). */
  /** Which carried exception entry HOLDS which task — recorded at hold time,
   *  checked at release time. Added after adversarial review demonstrated the
   *  hole its absence left: with only "is the task held somewhere" checked, a
   *  resolved+verified exception could free ANY held task, including one whose
   *  own blocker was still open — an audit story that says exc-A closed while
   *  exc-B's task quietly went live. A release names both halves, and the
   *  ledger is what makes the naming checkable. */
  holds: Readonly<Record<string, string>>;
  resolutions: Readonly<Record<string, string>>;
  /** exception entry → verification evidence ref (the proof of the fix). */
  verifications: Readonly<Record<string, string>>;
  /** The CURRENT device's most recent reevaluation decision — release judges the
   *  device the person is holding NOW, not the one the exception happened on. */
  currentDeviceDecision: DeviceDecision | null;
}

// ── typed refusals ────────────────────────────────────────────────────────────

/** The refusal vocabulary, as a VALUE the proof can iterate. The type is derived
 *  from it, so a code added here is covered by the proof's "every refusal was
 *  exercised" check the moment it exists — the same fossil-proofing
 *  posture-composition uses for `SignalKind`. The proof used to restate this list
 *  by hand and had drifted two codes behind while claiming "every". */
export const HANDOFF_SIM_ERROR_CODES = [
  /** Release named a task that is not held in this context. A release that
   *  silently succeeds on a non-held task is how a retry "frees" work that was
   *  never held while the real hold keeps standing. */
  "task_not_held",
  /** Release named an exception that is not the one holding the named task. */
  "exception_does_not_hold_task",
  /** The verification evidence ref is already recorded as a DIFFERENT exception's
   *  verification — one record proves one fix. */
  "verification_evidence_reused",
  /** No resolution has been recorded for the named exception (or the recorded
   *  ref is empty). The hold exists because the finding is open; releasing it
   *  against silence is the movement-based widening this fabric refuses. */
  "exception_unresolved",
  /** A resolution exists but no verification evidence does. The fix and the proof
   *  of the fix are different things: in the Oracle short-pick chain the
   *  discrepancy spawns a cycle-count task, and the COUNT confirms the fix — the
   *  resolution posting is not the verification. */
  "verification_missing",
  /** The verification evidence ref equals the resolution ref — the fix citing
   *  itself as its own proof. Independent evidence means a DIFFERENT record. */
  "verification_not_independent",
  /** The current device's own composition is restrict-grade or worse, or rests on
   *  no signals at all, or no device has been evaluated. Held work is not released
   *  into the hands of a device the fabric is currently restricting or cannot see
   *  — walk to a trusted device first. (Judged on the device's OWN composed
   *  action: the carried person-scoped ceiling is lowered only through its own
   *  resolution door, never by a release.) */
  "device_not_trusted_for_release",
  /** A non-assemble step arrived before any context existed. A script's first
   *  step must mint the context the rest of the script acts on. */
  "step_before_assemble",
  /** A step whose kind the simulator does not know (possible only past the type
   *  system — a script loaded from JSON). Refused, never recorded as applied. */
  "unknown_step_kind",
] as const;

export type HandoffSimErrorCode = (typeof HANDOFF_SIM_ERROR_CODES)[number];

/** WorkContextError-style typed refusal. Messages NEVER echo caller-supplied refs
 *  — the no-echo discipline `@workspace/work-context` enforces (an error that
 *  repeats an attacker-chosen string is a reflection primitive, and adversarial
 *  review has already burned one refusal path with exactly that defect). The code
 *  is the diagnosis; the withheld value is the caller's to know. */
export class HandoffSimError extends Error {
  readonly code: HandoffSimErrorCode;
  constructor(code: HandoffSimErrorCode, message: string) {
    super(message);
    this.name = "HandoffSimError";
    this.code = code;
  }
}

/** Every refusal code a trace entry can carry: this package's own, plus the
 *  underlying work-context doors' (e.g. `unknown_exception_ref` when a release
 *  names an entry the context never carried). */
export type TraceRefusalCode = HandoffSimErrorCode | WorkContextErrorCode;

// ── the trace: every step's output — the audit story ──────────────────────────

/** The device-scoped decision, as recorded per step (drivers elided: the trace
 *  narrates outcomes; the full driver list stays with the live decision). */
export interface TraceDecision {
  finalRequiredAction: UnifiedAction;
  deviceAction: UnifiedAction;
  carriedCeiling: ContextTrustCeiling;
  riskTier: RiskTier;
}

/** What the REAL task-exception chain concluded for an exception step. */
export interface TraceExceptionVerdict {
  posture: TaskExceptionPosture;
  reasonCode: TaskExceptionReasonCode;
  recommendedAction: UnifiedAction;
  /** The carried entry (`<reasonCode>:<exceptionRef>`) this verdict produced. */
  carriedEntry: string;
  /** Whether the verdict was hold-grade (alert-or-worse) and held the task. */
  taskHeld: boolean;
}

export interface HandoffTraceEntry {
  stepIndex: number;
  kind: HandoffScriptStep["kind"];
  status: "applied" | "refused";
  /** Typed refusal code when status is `refused`; the refusal is part of the
   *  story, not a crash — and the trace carries the CODE, never a caller ref. */
  refusalCode: TraceRefusalCode | null;
  /** The device the person is on after this step (null before the first handoff). */
  deviceRef: string | null;
  /** Context state AFTER this step (unchanged by a refused step). Null only while
   *  no context exists yet (a refused pre-assemble step). */
  contextVersion: number | null;
  requiredStepUpLevel: ContextTrustCeiling | null;
  decision: TraceDecision | null;
  exception: TraceExceptionVerdict | null;
  /** The full work section — active/held sets, exception entries, workflow, app
   *  catalog — snapshotted so "the work travelled unchanged" is assertable
   *  byte-for-byte from the trace alone. */
  work: WorkContextWork | null;
  activeRestrictions: string[];
  custodyRefs: string[];
}

export interface HandoffTrace {
  scriptRef: string;
  entries: HandoffTraceEntry[];
}

export interface HandoffRunResult {
  /** The context after the last step — null if the script never assembled one. */
  finalContext: PortableWorkContext | null;
  trace: HandoffTrace;
}
