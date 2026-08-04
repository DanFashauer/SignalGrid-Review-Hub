// Types for the read-only OBSERVABILITY-INTEGRITY dimension.
//
// THE QUESTION, and it is deliberately one question: **when a decision is about
// to rest on the ABSENCE of a reported problem, is that absence an observation
// or a gap?**
//
// Origin: intake ledger row 62 — the observability plane of an internal developer
// platform, and the owner's framing of it as SignalGrid's evidence nervous system:
// "observability explains why systems are in a state; SignalGrid decides what that
// state means for the workflow happening now."
//
// ── WHY THIS IS NOT session-readiness ────────────────────────────────────────
//
// `session-readiness` already grades a telemetry plane that goes SILENT. Its
// `not_instrumented` and `plane_unreachable` states exist precisely so that
// silence about readiness never reads as "ready". That is the loud failure, and
// it is covered.
//
// This family exists for the QUIET one. A pipeline can be reachable, healthy,
// returning data, green on every dashboard — and still be carrying one span in a
// hundred because someone set a sample rate, or dropping a metric family because
// it blew a cardinality budget, or capped for cost at the end of the month. The
// stream is UP. The evidence is nearly worthless for the only question that
// matters here: "did this bad thing happen?"
//
// Sampling is not a bug. It is correct, necessary practice at scale, and this
// family does not treat it as a defect. It treats it as a LIMIT ON WHAT THE
// SILENCE CAN SUPPORT. A 1%-sampled trace stream is excellent evidence for
// aggregate latency and nearly no evidence that a specific event did not occur.
// Those are different claims, and a fabric that lets the second one ride on the
// first is manufacturing an affirmative nobody earned.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────────
//
// It does not compute SLIs or spend error budgets — `@workspace/reliability` owns
// that, including the zero-tolerance fail-closed SLO. It does not grade whether a
// human answered an alert or whether the concern actually went away —
// `response-accountability` owns that (the watermelon). It does not grade whether
// the app in front of the worker is usable — `session-readiness` owns that. It
// does not collect, route, sample or store telemetry, and it emits nothing: the
// outbound emitters (`telemetry`, `siem`, `syslog`, `webhooks`, `itsm`) are
// separate families behind their own tier gates.
//
// It reads a self-description of ONE evidence stream and grades how much weight
// that stream's silence can bear.
//
// CEILING: `restrict`. Never `deny`. A dead metrics exporter is a reason to narrow
// what a session may do while the evidence is missing; it is not grounds to end
// the session, and a dimension that could hard-deny production traffic because a
// scrape target went down would be a blunt instrument wired to a collector.

/** Is the stream actually delivering? TRUSTED allowlist — the observability
 *  backend knows whether a target is up, down, or was never registered. */
export type CollectionState =
  | "reporting" // the backend is receiving from this source right now
  | "not_reporting" // registered, and currently delivering nothing
  | "never_instrumented" // no exporter/agent was ever attached to this source
  | "unknown";

/**
 * How much of the stream actually survives to the backend. TRUSTED allowlist.
 *
 * This is the axis that distinguishes this family from every neighbouring one,
 * and `sampled` is the reason it exists. A sampled stream is UP, CURRENT and
 * HEALTHY. It is also incapable of supporting "that did not happen", which is
 * exactly the claim a fail-closed decision would like to lean on.
 */
export type StreamFidelity =
  | "full" // everything generated reaches the backend
  | "sampled" // a declared fraction is kept; the rest never existed downstream
  | "partial_drop" // the pipeline is shedding load / failing to keep up
  | "cost_capped" // deliberately truncated against a spend or cardinality budget
  | "unknown";

/**
 * Where the newest datapoint stands against the interval the source itself
 * declares. DERIVED at a caller-supplied reference instant, never believed.
 *
 * `never_received` (registered, nothing ever arrived) is deliberately distinct
 * from `no_interval_declared` (data arrives, but nobody said how often it should,
 * so "current" was never a checkable claim) and from `unknown` (the instants or
 * the reference could not be read). Collapsing any pair would let a governance
 * failure hide inside "we're not sure" — the same asymmetry `credential-rotation`
 * keeps between `never_rotated`, `no_policy` and `unknown`.
 */
export type SignalFreshness =
  | "current"
  | "stale"
  | "never_received"
  | "no_interval_declared"
  | "unknown";

/**
 * Whether the pending decision actually rests on this stream's silence.
 *
 * THIS AXIS ONLY EVER ESCALATES. `load_bearing` — a TRUSTED, enumerated value the
 * caller must supply — raises the response one notch above the baseline for the
 * observed defect. `advisory` and `unstated` both take the baseline; neither buys
 * a softer verdict than the other, so a caller who says nothing gains nothing.
 *
 * That direction is deliberate. If the severest outcome required merely the
 * ABSENCE of a declaration, every unlabelled call would restrict and the family
 * would be unusable; if a missing declaration bought leniency, silence would
 * manufacture a grant. Escalation-only is the one arrangement where neither
 * happens, and `observability-integrity-proof` pins it by monotonicity across the
 * whole input space.
 */
export type EvidenceReliance =
  | "load_bearing" // the decision rests on "no problem was reported"
  | "advisory" // useful context; the decision does not turn on it
  | "unstated"; // the caller did not say — takes the baseline, never a discount

export type ObservabilityIntegrityPosture =
  | "evidence_sound" // clean: reporting, full fidelity, current
  | "evidence_reduced" // up and current, but lossy — silence proves less than it looks
  | "evidence_stale" // was reporting; the newest datapoint is past its own interval
  | "evidence_absent" // never instrumented, not reporting, or nothing ever arrived
  | "evidence_ungoverned" // arriving, but no declared interval to judge currency against
  | "evidence_unverified"; // any axis unknown / malformed / uncovered

export type ObservabilityIntegrityAction =
  | "none"
  | "monitor"
  | "alert"
  | "step_up"
  | "restrict";

export type ObservabilityIntegrityReasonCode =
  | "OBSERVABILITY_EVIDENCE_SOUND"
  | "OBSERVABILITY_STREAM_NOT_COVERED"
  | "OBSERVABILITY_NEVER_INSTRUMENTED"
  | "OBSERVABILITY_STREAM_NOT_REPORTING"
  | "OBSERVABILITY_COLLECTION_UNKNOWN"
  | "OBSERVABILITY_SIGNAL_NEVER_RECEIVED"
  | "OBSERVABILITY_SIGNAL_STALE"
  | "OBSERVABILITY_FRESHNESS_UNKNOWN"
  | "OBSERVABILITY_NO_INTERVAL_DECLARED"
  | "OBSERVABILITY_STREAM_SAMPLED"
  | "OBSERVABILITY_STREAM_DROPPING"
  | "OBSERVABILITY_STREAM_COST_CAPPED"
  | "OBSERVABILITY_FIDELITY_UNKNOWN"
  | "OBSERVABILITY_EVIDENCE_LOAD_BEARING"
  | "OBSERVABILITY_RELIANCE_UNSTATED";

/** One evidence stream's normalized state. Every field is already graded; the
 *  evaluator does arithmetic on none of them. */
export interface NormalizedObservabilityIntegrity {
  /** Opaque ref for the observed subject — a service, a scrape target, a pipeline
   *  stage. Never a URL, never a body. */
  readonly streamRef: string;
  readonly collection: CollectionState;
  readonly fidelity: StreamFidelity;
  readonly freshness: SignalFreshness;
  readonly reliance: EvidenceReliance;
  /** TRUE only when the observability plane actually returned a record for this
   *  stream. A stream the backend has never heard of is an honest hole. */
  readonly covered: boolean;
  /** Age of the newest datapoint in whole seconds at the caller's reference
   *  instant, when derivable. Reported for the operator, never re-derived into a
   *  verdict here. */
  readonly ageSeconds: number | null;
  /** The interval the SOURCE declares it should deliver on, when one exists. */
  readonly expectedIntervalSeconds: number | null;
  /** The kept fraction in (0,1] when the source declares one, else null. Reported
   *  so an operator can see HOW sampled; the verdict turns on the enumerated
   *  `fidelity`, not on this number. */
  readonly keptFraction: number | null;
  readonly source: string;
  readonly observedAt: string;
}

export interface ObservabilityIntegrityVerdict {
  readonly posture: ObservabilityIntegrityPosture;
  readonly action: ObservabilityIntegrityAction;
  readonly reasonCodes: readonly ObservabilityIntegrityReasonCode[];
  /**
   * TRUE only when this stream's SILENCE is admissible as evidence — reporting,
   * full fidelity, current, and actually covered. Never true on a sampled stream,
   * never true on an unknown.
   *
   * This is the field a caller should read before letting "no problem was
   * reported" carry any weight.
   */
  readonly silenceIsEvidence: boolean;
  readonly summary: string;
}

/** The raw shape an observability backend returns. Everything optional and
 *  unknown — the normalizer is where trust is applied, once. */
export interface ObservabilityStreamReportRaw {
  readonly streamRef?: unknown;
  readonly collectionState?: unknown;
  readonly fidelity?: unknown;
  readonly reliance?: unknown;
  readonly lastDatapointAt?: unknown;
  readonly expectedIntervalSeconds?: unknown;
  readonly keptFraction?: unknown;
  readonly source?: unknown;
  readonly observedAt?: unknown;
}

export type ObservabilityIntegrityConnectorErrorCode =
  | "auth_failed"
  | "upstream_error"
  | "bad_response"
  | "not_configured";

export class ObservabilityIntegrityConnectorError extends Error {
  constructor(
    readonly code: ObservabilityIntegrityConnectorErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ObservabilityIntegrityConnectorError";
  }
}
