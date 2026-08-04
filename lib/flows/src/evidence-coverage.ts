// evidence-coverage — which of the decision engine's evidence axes can a given
// deployment ACTUALLY answer, and which are dark?
//
// This exists because of what an adversarial review found when a customer-facing
// "replay your history and see what we'd have decided" artifact was proposed.
//
// The v1 rule set is deliberately DAY-ONE QUIET on several axes: an `unknown`
// baseline, an `unverified` benchmark selection, an `unverified` shift context, an
// `unknown` badge binding and an `unknown` dock state all still grade `allow`, and
// `seed.ts` pins each of those as expected with the comment "no fabricated block".
// That is right for a live tenant whose connectors are still being deployed — you do
// not block a fleet because an integration is pending.
//
// It is catastrophic as the engine behind a backtest. In a replay of a customer's
// existing exports those axes are absent for EVERY row by construction, because the
// data plane that would fill them does not exist in that customer's estate. The
// engine emits a clean grant at scale, and the grant came from ABSENCE OF DATA. A
// prospect's security reviewer who traces one row finds exactly that — on the one
// product whose whole claim is that it refuses to convert silence into a pass.
//
// So the honest artifact is not "here is what we would have decided". It is:
//
//     "Here is what your systems can and cannot tell us, and here is the
//      question each missing one would have answered."
//
// That needs NO customer data, no CSV, no connector and no security review, and it
// cannot flatter the engine, because its entire output is the size of the gap.

import { isWireable } from "./signal-sourcing";

/**
 * A source plane a deployment either has or does not have.
 *
 * Deliberately coarse. This is a conversation instrument, not an inventory: the
 * question "do you have a workforce-management system we could read?" is answerable
 * in a meeting, and "which WFM, at what version, with which API scopes" is not.
 */
export type SourcePlane =
  | "identity" // Entra ID / an OIDC IdP
  | "device_management" // Intune / Jamf / Workspace ONE
  | "endpoint_security" // an EDR/EPP
  | "badge_custody" // an RFID/prox badge reader plane
  | "physical_access" // PACS / door controllers
  | "workforce_management" // WFM / scheduling / time-and-attendance
  | "dock_hardware"; // SmartDock or equivalent instrumented cradle
//
// `dex` (ControlUp-class digital-experience) and `access_governance` (IGA) were
// DECLARED HERE AND ANSWERED NO AXIS. Two consequences, both bad and both live: the
// API refused `?planes=dex` as "unrecognised" while the type, the docstring and
// `lib/integrations/src/integrations/access-governance/` all said it was real; and
// because neither appeared in any `answerableBy`, both bits were no-ops in the proof's
// power-set sweep, which reported 512 estates where only 128 were distinct.
//
// They are gone rather than wired up because the honest reason is a MODEL BOUNDARY:
// those planes feed `posture-composition` (38 signal kinds), not the 18-axis
// `DecisionEvidence` struct this report is about. A plane belongs here only when it
// answers one of THESE axes. Adding a `dex` axis is a real option later; declaring the
// plane without one was the unearned affirmative.

/**
 * One evidence axis of the decision engine, and what it takes to answer it.
 *
 * `answerableBy` is an EXPLICIT ALLOWLIST of planes. An axis with an empty list is
 * answerable by nothing this deployment could plausibly have, which is a legitimate
 * and important answer — it is how the report says "you cannot get this at all
 * without new instrumentation" rather than quietly omitting the row.
 */
export interface EvidenceAxis {
  /** Field name on `DecisionEvidence`. */
  readonly id: string;
  /** What the axis actually decides, in a sentence a non-engineer can act on. */
  readonly question: string;
  /** Planes that can supply it. First match wins for fidelity purposes. */
  readonly answerableBy: readonly SourcePlane[];
  /**
   * TRUE when the ACTIVE v1 rule set still grants on this axis's ignorance member.
   *
   * This is the field that makes the report honest rather than merely informative.
   * An axis that is BOTH unanswerable by the deployment AND day-one quiet is a
   * silent hole: the engine will not complain, no operator will see a finding, and
   * a naive backtest will read it as health. Those are the rows a prospect most
   * needs to see, and the report ranks them first.
   */
  readonly dayOneQuiet: boolean;
}

/**
 * The map, grounded in `DecisionEvidence` and in the v1 rule set as it actually is.
 *
 * `dayOneQuiet` is not an opinion — each `true` below corresponds to a policy test
 * pinned in `lib/signalgrid-core/src/seed.ts` asserting that the axis's ignorance
 * member still yields `allow` with reason `TRUST_ESTABLISHED`. If a future rule set
 * starts grading one of them, this flag must change with it, and the proof asserts
 * the two stay in step rather than trusting this comment.
 */
export const EVIDENCE_AXES: readonly EvidenceAxis[] = [
  {
    id: "identityEnabled",
    question: "Is this person's account still enabled?",
    answerableBy: ["identity"],
    dayOneQuiet: false,
  },
  {
    id: "deviceManaged",
    question: "Is this device actually enrolled in management?",
    answerableBy: ["device_management"],
    dayOneQuiet: false,
  },
  {
    id: "deviceCompliance",
    question: "Does the device meet the compliance policy assigned to it?",
    answerableBy: ["device_management"],
    dayOneQuiet: false,
  },
  {
    id: "deviceEncrypted",
    question: "Is the disk encrypted?",
    answerableBy: ["device_management"],
    // MEASURED, not assumed. An ignorant `deviceEncrypted` returns allow on the active
    // v1 rules — the encryption question is graded only on an affirmative false.
    dayOneQuiet: true,
  },
  {
    id: "osSupported",
    question: "Is the OS still receiving security updates?",
    answerableBy: ["device_management"],
    dayOneQuiet: false,
  },
  {
    id: "ownerType",
    question: "Is this corporate hardware or someone's personal device?",
    answerableBy: ["device_management"],
    // MEASURED. An ignorant `ownerType` returns allow — v1 grades the affirmative
    // `personal` case, not the ignorance case.
    dayOneQuiet: true,
  },
  {
    id: "postureFreshness",
    question: "How old is the posture reading — is it describing the device NOW?",
    answerableBy: ["device_management"],
    dayOneQuiet: false,
  },
  {
    id: "workflowRiskTier",
    question: "How risky is the action being attempted?",
    // Posed by the calling application from its own workflow model. No source
    // plane supplies it, and that is not a gap — it is the host app's to state.
    answerableBy: [],
    dayOneQuiet: false,
  },
  {
    id: "custodyState",
    question: "Is the device in someone's hands, or in a drawer / in maintenance?",
    answerableBy: ["badge_custody", "dock_hardware"],
    // MEASURED. An ignorant `custodyState` returns allow. seed.ts pins the affirmative
    // `maintenance` state to restrict; nobody pinned the ignorance state.
    dayOneQuiet: true,
  },
  {
    id: "dockChargeState",
    question: "Will this device survive the shift, or die mid-task?",
    answerableBy: ["dock_hardware"],
    dayOneQuiet: true,
  },
  {
    id: "batteryHealth",
    question: "Is the battery degraded in a way charging cannot fix?",
    answerableBy: ["dock_hardware", "device_management"],
    dayOneQuiet: true,
  },
  {
    id: "tamperState",
    question: "Has the device or its cradle been physically interfered with?",
    answerableBy: ["dock_hardware"],
    // MEASURED. An ignorant `tamperState` returns allow. seed.ts pins
    // `sensor_unavailable` to step_up; plain ignorance is ungraded.
    dayOneQuiet: true,
  },
  {
    id: "dockState",
    question: "Is the custody/charge/tamper channel itself trustworthy right now?",
    answerableBy: ["dock_hardware"],
    dayOneQuiet: true,
  },
  {
    id: "baselineCompliance",
    question: "Is the device hardened to the security baseline you chose?",
    answerableBy: ["device_management", "endpoint_security"],
    dayOneQuiet: true,
  },
  {
    id: "benchmarkSelection",
    question: "Was that hardening answer produced by the RIGHT test for this device?",
    answerableBy: ["device_management", "endpoint_security"],
    dayOneQuiet: true,
  },
  {
    id: "shiftContext",
    question: "Does the labor plane agree this is the right person, time and site?",
    answerableBy: ["workforce_management"],
    dayOneQuiet: true,
  },
  {
    id: "badgeBinding",
    question: "Is the badge that started this session still present?",
    answerableBy: ["badge_custody", "physical_access"],
    dayOneQuiet: true,
  },
  {
    id: "criticalSignalsPresent",
    question: "Did the critical evidence arrive at all?",
    // Derived by the core from the other axes rather than sourced. Listed because
    // omitting it would make the axis count wrong, and a coverage report whose
    // denominator is wrong is the first thing a reviewer checks.
    answerableBy: [],
    dayOneQuiet: false,
  },
];

/** How well a deployment can answer one axis. */
export type AxisCoverage =
  /** A declared plane supplies it. */
  | "answerable"
  /** A plane could supply it, but this deployment does not have that plane. */
  | "needs_instrumentation"
  /** No source plane supplies it — it is posed by the caller or derived. */
  | "not_sourced";

export interface AxisFinding {
  readonly axis: EvidenceAxis;
  readonly coverage: AxisCoverage;
  // NO `fidelity` FIELD, DELIBERATELY. One used to be here and it was a CONSTANT
  // dressed as a measurement: the construction below hardcoded `method: "api"`, so
  // `fidelityOf` returned "high" for every answerable axis in every estate. It also
  // contradicted this server's own `/cp/v1/grid/sourcing`, which rates badge binding
  // as `native` and RTLS custody as degraded `grid_collected` — LOW fidelity. Two
  // routes on one deployment, opposite confidence for the same signal. This model
  // holds no per-axis method data, so it reports no per-axis confidence rather than
  // inventing one a prospect would read as measured.
  /** Planes that would answer it and are NOT declared. Empty when answerable. */
  readonly missingPlanes: readonly SourcePlane[];
  /**
   * TRUE when the axis is unanswerable AND the active rule set stays quiet on its
   * ignorance member. These are the silent holes — the engine grants, no operator
   * sees a finding, and a naive backtest reads it as health.
   */
  readonly silentHole: boolean;
}

export interface CoverageReport {
  readonly declaredPlanes: readonly SourcePlane[];
  readonly findings: readonly AxisFinding[];
  readonly answerable: number;
  readonly needsInstrumentation: number;
  readonly notSourced: number;
  /** The headline. Axes that are dark AND ungraded — where silence looks like health. */
  readonly silentHoles: number;
  readonly totalAxes: number;
}

/**
 * Build the coverage report for a declared estate.
 *
 * FAIL-CLOSED BY CONSTRUCTION, and that is the whole design. An axis is
 * `answerable` ONLY when a plane that supplies it was explicitly declared. There is
 * no inference, no "they probably have that", and no default plane — an
 * undeclared plane can never make an axis answerable, which is asserted directly
 * rather than left to review.
 *
 * The report cannot flatter the product: every number it emits gets WORSE as the
 * estate gets thinner, and the headline figure counts holes rather than coverage.
 */
export function buildCoverageReport(declaredPlanes: readonly SourcePlane[]): CoverageReport {
  const declared = new Set(declaredPlanes);
  const findings: AxisFinding[] = EVIDENCE_AXES.map((axis) => {
    if (axis.answerableBy.length === 0) {
      return {
        axis,
        coverage: "not_sourced" as const,
        missingPlanes: [],
        // Not a hole: nobody expected a source plane to supply it. Calling a
        // caller-posed axis a gap would inflate the finding count, and an inflated
        // finding count is as dishonest as a suppressed one.
        silentHole: false,
      };
    }
    const present = axis.answerableBy.filter((p) => declared.has(p));
    if (present.length > 0) {
      return {
        axis,
        coverage: "answerable" as const,
        missingPlanes: [],
        silentHole: false,
      };
    }
    return {
      axis,
      coverage: "needs_instrumentation" as const,
      fidelity: "none" as const,
      missingPlanes: axis.answerableBy,
      silentHole: axis.dayOneQuiet,
    };
  });

  return {
    declaredPlanes: [...declaredPlanes],
    findings,
    answerable: findings.filter((f) => f.coverage === "answerable").length,
    needsInstrumentation: findings.filter((f) => f.coverage === "needs_instrumentation").length,
    notSourced: findings.filter((f) => f.coverage === "not_sourced").length,
    silentHoles: findings.filter((f) => f.silentHole).length,
    totalAxes: EVIDENCE_AXES.length,
  };
}

/**
 * Every source plane any axis can be answered by, DERIVED from the axis table.
 *
 * Hand-listing these would be a second copy of a fact the table already states, and
 * a copy that drifts silently the moment an axis names a new plane. Callers need the
 * runtime list to tell a user what is valid — a 400 that refuses an unrecognised
 * plane without naming the recognised ones is a dead end, not a control.
 */
export const KNOWN_SOURCE_PLANES: readonly SourcePlane[] = [
  ...new Set(EVIDENCE_AXES.flatMap((a) => a.answerableBy)),
].sort();

/**
 * Sanity check on the model itself: a declared plane must be one this map knows.
 *
 * Exported so a caller reading a plane list from a form or a file can refuse an
 * unrecognised entry rather than silently ignoring it — an ignored plane would make
 * the report understate coverage, which is the one direction of error a prospect
 * would never catch, because it flatters THEM rather than us.
 */
export function isKnownPlane(value: string): value is SourcePlane {
  return EVIDENCE_AXES.some((a) => (a.answerableBy as readonly string[]).includes(value));
}

/** Re-exported so a caller can reason about wireability without a second import. */
export { isWireable };
