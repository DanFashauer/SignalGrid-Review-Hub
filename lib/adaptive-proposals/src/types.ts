// @workspace/adaptive-proposals — the GOVERNED LIFECYCLE around a recommendation.
//
// This package is NOT a recommendations engine. `@workspace/recommendations` is the
// existing deterministic advisory engine (it turns observed usage into advisory
// change suggestions and never applies anything). What was missing is the governance
// lifecycle AROUND such a suggestion — the eight-step loop Issue #136 and
// `docs/VISION_PERSON_FIRST_GRID.md` fix as canonical:
//
//   observe → correlate → explain → recommend → simulate → require owner approval →
//   version & activate → measure
//
// This module builds that lifecycle as a STATE MACHINE with one structurally enforced
// core invariant: a proposal cannot activate itself. Activation is reachable only by
// passing through `approved`, and `approved` is reachable only by an approval carrying
// a non-empty approver ref — the human gate. There is no auto-approve flag and no code
// path that sets `status = "activated"` without a prior `approved` state carrying an
// approver. Simulation and measurement are DESCRIPTIVE: a proposal describes a change,
// it is never itself a mechanism that applies one.
//
// THE DISCIPLINE, inherited from `@workspace/work-context`:
//   • every ref is an OPAQUE handle into a system of record, never a value that IS the
//     thing (`approvedByRef` names the approver to the identity system; it is not an
//     approval authority in itself);
//   • the input proposal is NEVER mutated; every returned proposal is DEEP-FROZEN;
//   • `version` advances on every transition, so any consumer can reject a stale copy;
//   • refusals are typed `AdaptiveProposalError`s asserted WITH their reason, and NO
//     refusal message ever echoes a caller-supplied ref (an error that repeats a token
//     is a second leak — this repo has paid for that before).

import type { RecommendationKind } from "@workspace/recommendations";

// ── the recommendation, as DATA ────────────────────────────────────────────────

/** The proposed workflow/policy change, expressed as DATA — never executable. A
 *  `ProposedChange` DESCRIBES a change ("route these incidents to an automated flow");
 *  nothing in this package can enact it. `kind` reuses the existing advisory engine's
 *  vocabulary (`@workspace/recommendations`) rather than inventing a parallel one. */
export interface ProposedChange {
  kind: RecommendationKind;
  /** What the change is about — a flow id, "flowId:actionKey", or an opaque pattern
   *  key. An identifier into a system of record, not an instruction. */
  target: string;
  /** Human-readable description of the proposed change. Descriptive prose, never a
   *  command string a runtime could execute. */
  description: string;
}

// ── provenance: the "observe / correlate / explain" of the loop ────────────────

/** WHERE a proposal came from. Mined from synthetic audit history — the ledger the
 *  fabric already keeps — never from live production data. */
export interface ProposalProvenance {
  /** How many distinct incidents in the observed history exhibited this pattern.
   *  ALWAYS >= 1 for an emitted proposal; below the pattern floor (see `observe.ts`)
   *  nothing is emitted at all — a one-off is an incident, not a pattern. */
  observedIncidentCount: number;
  /** Opaque audit refs (the mined events' ids) the pattern was drawn from. Handles
   *  into the audit ledger, never the events' bodies. */
  sourceEventRefs: string[];
  /** The "explain" step, human-readable — e.g. "these 3 signals preceded this manual
   *  resolution 40 times." What an operator reads before deciding. */
  correlationSummary: string;
}

// ── simulate (step 5) and measure (step 8) ─────────────────────────────────────

/** The step-5 projection: would the proposed change have helped, against the SAME
 *  history it was mined from — WITHOUT changing anything. */
export interface SimulationResult {
  /** M — observed incidents the projection was run against. */
  observedIncidentCount: number;
  /** N — of those M, how many the proposed change would have auto-routed/resolved. */
  wouldHaveHelpedCount: number;
  /** N / M in [0,1]. The projection's predicted realization. */
  helpedRate: number;
  /** Human-readable projection summary — narrated, no side effects. */
  summary: string;
}

/** The step-8 "did it help": outcomes AFTER activation, compared to the simulation's
 *  prediction. A proposal that was approved and activated but did NOT help is a
 *  surfaced FINDING (`helped === false`), never a silent legacy. */
export interface MeasurementResult {
  /** Post-activation incidents observed. */
  activatedIncidentCount: number;
  /** Of those, how many the activated change actually auto-resolved. */
  helpedCount: number;
  /** helpedCount / activatedIncidentCount in [0,1] (0 when no incidents observed). */
  helpedRate: number;
  /** The simulation's predicted rate, carried here so the comparison is legible. */
  predictedRate: number;
  /** TRUE only when the realized rate meets at least half the prediction on real
   *  post-activation incidents. FALSE is a finding to surface, not an error. */
  helped: boolean;
  /** Human-readable measurement summary. */
  summary: string;
}

// ── the approval gate (step 6) ─────────────────────────────────────────────────

/** The human gate. Both refs are OPAQUE handles: `approvedByRef` names the approver to
 *  the identity system (it is not an authority in itself), `approvedAtRef` is a
 *  monotonic sequence handle (deliberately NOT a wall-clock — determinism must be
 *  provable, and a timestamp would make two identical runs differ). A proposal only
 *  carries this once it has passed `pending_approval → approved` with a NON-EMPTY
 *  `approvedByRef`. */
export interface ProposalApproval {
  approvedByRef: string;
  approvedAtRef: string;
}

// ── lifecycle status ───────────────────────────────────────────────────────────

/** The eight-step loop's states. `activated` is reachable ONLY from `approved`; see
 *  `LEGAL_TRANSITIONS` in `lifecycle.ts`, and the exhaustive proof over that table. */
export const PROPOSAL_STATUSES = [
  "draft",
  "simulated",
  "pending_approval",
  "approved",
  "activated",
  "rejected",
  "superseded",
] as const;

export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** The adaptive proposal. DESCRIPTIVE, NEVER PERMISSIVE: presenting this object enacts
 *  nothing — it describes a candidate change and where it stands in the governed loop.
 *  The change is only ever applied by the system of record, after an owner approves. */
export interface AdaptiveProposal {
  proposalId: string;
  provenance: ProposalProvenance;
  /** The proposed change, as DATA — never executable. */
  recommendation: ProposedChange;
  /** null until `simulate()` attaches it. Gates the move to `pending_approval`. */
  simulation: SimulationResult | null;
  status: ProposalStatus;
  /** null until `approve()` records a non-empty approver ref. */
  approval: ProposalApproval | null;
  /** null until `measureActivated()` records the post-activation outcome. */
  measurement: MeasurementResult | null;
  /** Monotone counter, +1 on every transition/attach. A minted draft is version 1. */
  version: number;
}

// ── typed refusals ─────────────────────────────────────────────────────────────

export type AdaptiveProposalErrorCode =
  /** The requested (from → to) status change is not in `LEGAL_TRANSITIONS`. In
   *  particular, ANY pre-approval state → `activated` lands here: activation is
   *  reachable only from `approved`. */
  | "illegal_transition"
  /** A move to `pending_approval` was attempted without a simulation attached —
   *  step 5 gates step 6, structurally. */
  | "simulation_required"
  /** An approval was attempted with an empty (or whitespace-only) approver ref. The
   *  human gate cannot be satisfied by silence. */
  | "approver_required"
  /** `approved → activated` was attempted, but the proposal carries no approval with a
   *  non-empty approver ref — defence in depth behind the transition table, so a
   *  hand-crafted "approved" object still cannot activate itself. */
  | "activation_without_approval"
  /** A measurement was attempted on a proposal that is not `activated`. Only an
   *  activated change has post-activation outcomes to measure. */
  | "not_activated";

export class AdaptiveProposalError extends Error {
  readonly code: AdaptiveProposalErrorCode;
  /** The status the proposal was in (safe enum value). */
  readonly from: ProposalStatus | null;
  /** The status the caller tried to reach (safe enum value). */
  readonly to: ProposalStatus | null;
  constructor(
    code: AdaptiveProposalErrorCode,
    message: string,
    from: ProposalStatus | null = null,
    to: ProposalStatus | null = null,
  ) {
    super(message);
    this.name = "AdaptiveProposalError";
    this.code = code;
    this.from = from;
    this.to = to;
  }
}

// ── deep freeze ────────────────────────────────────────────────────────────────

/** Recursively freeze an object graph so a handed-out proposal cannot be mutated in
 *  place. Every proposal this package returns passes through here. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
