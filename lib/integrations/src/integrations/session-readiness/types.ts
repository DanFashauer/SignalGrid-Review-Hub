// session-readiness — is the app this worker needs actually USABLE right now?
//
// Intake ledger row 57, from the IGEL + ControlUp "Tap-to-App" work. That workflow
// measures the clinician's real login experience end to end: badge tap on an IGEL
// endpoint, the Imprivata credential workflow, VDI reconnect, application launch,
// merged in ControlUp and presented as one journey. It answers a genuinely useful
// question that nothing else answers as well — WHERE IS TIME BEING LOST.
//
// It does not answer the question this fabric exists for. "The app became usable
// after 42 seconds" is a measurement; "should this clinician, on this endpoint, in
// this workflow, be allowed to continue right now, and what happens if not" is a
// decision. Tap-to-app is an INPUT to that decision, not the decision.
//
// So this family consumes the measurement and does not attempt to reproduce it.
// ControlUp stays the DEX system of record, IGEL stays the endpoint OS, Imprivata
// stays the access workflow, the VDA stays the session broker. Read-only, no
// actuators, same boundary every other family here observes.
//
// THE ROW-45 CANDIDATE — the reason this is a decision dimension rather than a
// dashboard tile. If the DEX plane goes quiet, the fabric receives silence, and
// silence about readiness must never read as "ready". An endpoint that was never
// instrumented, a ControlUp instance that is down, and an app that genuinely came up
// in two seconds all produce the same *absence* of a bad reading. Treating that
// absence as a pass is precisely how a measurement plane manufactures a grant.

/**
 * Is the app usable from the WORKER's point of view — the only point of view that
 * matters for the decision.
 *
 * `degraded` is separate from `not_usable` on purpose: an app that launched but is
 * responding slowly is a different operational fact from one that never came up, and
 * conflating them would send the wrong owner to the wrong problem.
 */
export type AppReadiness = "usable" | "degraded" | "not_usable" | "unknown";

/**
 * WHY we do or do not have a reading. This axis is the honest half of the dimension,
 * and it exists because `AppReadiness.unknown` alone cannot distinguish three very
 * different worlds:
 *
 *   - `measured`            — the plane reported; the reading means something.
 *   - `not_instrumented`    — this endpoint has no DEX agent. Nobody is watching.
 *   - `plane_unreachable`   — the DEX plane itself could not be read just now.
 *
 * A deployment that never instrumented its endpoints and a deployment whose
 * monitoring is broken both "have no bad news", and neither is evidence of health.
 */
export type ReadinessMeasurement = "measured" | "not_instrumented" | "plane_unreachable";

/**
 * How this session came to exist, as reported by the session broker.
 *
 * `reconnected` is the interesting one. A VDI session that was RECONNECTED rather
 * than freshly established may still be carrying the previous clinician's context on
 * a shared workstation — the tap-to-app journey looks fast precisely BECAUSE nothing
 * was torn down. Speed here is not reassurance.
 *
 * NOTE THE BOUNDARY WITH `sso-session`: that family grades the identity-provider
 * session and shared-account attribution. This axis is the SESSION-BROKER's report
 * about the virtual desktop, which is a different plane that can disagree with it —
 * and the disagreement is a finding, not noise.
 */
export type SessionOrigin = "fresh" | "reconnected" | "unknown";

/**
 * How risky the action the worker is about to take is, POSED by the caller from the
 * workflow plane. Unposed is `unstated`, and unstated never buys a relaxation.
 *
 * This is what makes the dimension useful rather than merely noisy: the same 42-second
 * delay is a shrug for a chart view and a hold for a medication order. A dimension that
 * graded readiness without knowing what the readiness is FOR would have to pick one
 * answer for both.
 */
export type WorkflowRisk = "routine" | "elevated" | "critical" | "unstated";

/** Vendor-reported integrity of the record itself. One unreadable field makes the
 *  whole record `malformed`; a malformed record grades as ignorance, never as health. */
export type ReadinessReportIntegrity = "intact" | "malformed";

/**
 * A readiness budget POSED by the deployment — the threshold beyond which time-to-usable
 * stops being an annoyance and becomes an operational finding.
 *
 * POSED, NOT DEFAULTED, and the absence of a posed budget must not silence the
 * dimension. `sse-egress` uses the same discipline for its mandate and
 * `challenge-capability` for its accepted methods: an unposed policy forecloses the
 * clean read rather than granting it.
 */
export interface ReadinessBudget {
  /** Seconds. A DURATION, never a timestamp — no clock is read in this family. */
  readonly thresholdSeconds: number;
}

/** The normalized shape every vendor payload is reduced to before grading. */
export interface NormalizedSessionReadiness {
  readonly sessionRef: string;
  readonly appReadiness: AppReadiness;
  readonly measurement: ReadinessMeasurement;
  readonly sessionOrigin: SessionOrigin;
  /**
   * Observed time from tap to usable app, in whole seconds, or null when the plane
   * did not report one.
   *
   * A DURATION SUPPLIED BY THE CALLER, not computed here. The same rule `uem` learned
   * the hard way: `Date.now() - start` inside a read path puts a wall-clock read into a
   * decision path, which golden rule 2 forbids and which makes replay impossible.
   */
  readonly elapsedToUsableSeconds: number | null;
  /** Posed budget, or null when the deployment stated none. */
  readonly budget: ReadinessBudget | null;
  /** Posed risk of the action being gated. */
  readonly workflowRisk: WorkflowRisk;
  readonly reportIntegrity: ReadinessReportIntegrity;
}

export type SessionReadinessPosture =
  /** Measured, usable, inside budget. The only corroborated-healthy state. */
  | "ready"
  /** Usable but slow, or a soft finding that does not block. */
  | "degraded"
  /** A confirmed readiness failure. */
  | "not_ready"
  /** We cannot say. Nobody measured, or the plane could not be read. */
  | "unassessed";

/**
 * Actions this dimension can recommend.
 *
 * NOTE THE CEILING: never `escalate`, and never `deny`. A slow or unmeasured app is an
 * operational fact, not evidence of an intrusion, and this family has no standing to
 * end a clinician's shift over a broker delay. `restrict` is the strongest it goes, and
 * only where a POSED critical workflow meets a readiness state that cannot be trusted.
 */
export type SessionReadinessAction = "none" | "monitor" | "step_up" | "alert" | "restrict";

export type SessionReadinessReasonCode =
  | "SESSION_READY"
  | "READINESS_UNMEASURED_NOT_INSTRUMENTED"
  | "READINESS_PLANE_UNREACHABLE"
  | "READINESS_UNKNOWN"
  | "APP_NOT_USABLE"
  | "APP_DEGRADED"
  | "READINESS_BUDGET_EXCEEDED"
  | "READINESS_BUDGET_UNPOSED"
  | "READINESS_BUDGET_UNREADABLE"
  | "SESSION_RECONNECTED_UNVERIFIED"
  | "REPORT_MALFORMED";

export interface SessionReadinessVerdict {
  readonly posture: SessionReadinessPosture;
  readonly recommendedAction: SessionReadinessAction;
  /** Names WHICH input drove the outcome. An operator reading
   *  `READINESS_UNMEASURED_NOT_INSTRUMENTED` learns something an operator reading
   *  `NOT_READY` does not — one is a fleet-instrumentation gap they can fix, the
   *  other sounds like a broken app. */
  readonly reasonCode: SessionReadinessReasonCode;
  readonly reportIntegrity: ReadinessReportIntegrity;
}

export type SessionReadinessConnectorErrorCode =
  | "auth_failed"
  | "read_only_violation"
  | "upstream_error"
  | "bad_response";

/** What a live read would require, stated so a permission gap cannot present as a
 *  finding — the same failure mode `service-lifecycle`'s read contract exists to
 *  prevent. */
export const SESSION_READINESS_READ_CONTRACT = {
  /** ControlUp is the DEX system of record. This family reads it and never writes. */
  systemOfRecord: "controlup",
  requiredScopes: ["dex.read", "session.read"] as const,
  /** Endpoint OS and access-workflow planes this correlates against, none of which
   *  this family manages or replaces. */
  correlatedPlanes: ["igel-os", "imprivata", "vdi-vda"] as const,
  /** No write, reboot, wake, shadow, or profile-update action is exposed here even
   *  though the vendor API offers them — those belong to the systems of record. */
  actuatorsExposed: false,
} as const;
