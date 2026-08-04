import type {
  NormalizedObservabilityIntegrity,
  ObservabilityIntegrityAction,
  ObservabilityIntegrityPosture,
  ObservabilityIntegrityReasonCode,
  ObservabilityIntegrityVerdict,
} from "./types";

/**
 * Pure, deterministic OBSERVABILITY-INTEGRITY evaluator. Grades ONE evidence
 * stream fail-closed, on the fabric's unified ladder.
 *
 * The precedence table below is ordered by SPECIFICITY, worst first, and every
 * clause tests an ENUMERATED value. Not one clause has the form `!== bad`, so a
 * spelling this design has never heard of satisfies none of them and falls through
 * to an unknown arm — which raises assurance rather than lowering it.
 *
 * Doctrine:
 *  - **never instrumented / not reporting** → `step_up`, or `restrict` when the
 *    decision was declared to rest on this stream. Nothing is arriving, so silence
 *    from it means nothing at all.
 *  - **nothing ever arrived** → `step_up`. The backend says it is collecting and no
 *    datapoint has ever landed. Those two statements disagree; the disagreement
 *    itself is the finding.
 *  - **stale** → `monitor`, or `step_up` when load-bearing. It reported once and is
 *    now past the interval its own source declares. The source's number, not ours.
 *  - **sampled / dropping / cost-capped** → `monitor`, or `step_up` when
 *    load-bearing. THIS IS THE CLAUSE THE FAMILY EXISTS FOR. The stream is up,
 *    current and healthy, and it still cannot support "that did not happen".
 *  - **no declared interval** → `alert`. Data is arriving and nobody ever said how
 *    often it should, so "current" was never a checkable claim. Nothing is wrong
 *    with THIS session — the governance gap is upstream and operator-scale, which
 *    is what `alert` is for.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. A stream the plane has no record for is an honest
 *    hole, not a pass.
 *
 * THE ESCALATION RULE IS THE DANGEROUS ONE, and it is written to be safe in the
 * only direction that matters: `load_bearing` — a TRUSTED, enumerated value — moves
 * a response UP one notch. `advisory` and `unstated` take the identical baseline.
 * A caller who declares nothing therefore gains nothing, and a caller who declares
 * reliance cannot be punished into leniency. `observability-integrity-proof` pins
 * that by monotonicity over the whole input space, so the property cannot decay
 * into a discount for silence.
 */
export function evaluateObservabilityIntegrity(
  normalized: NormalizedObservabilityIntegrity,
): ObservabilityIntegrityVerdict {
  const reasons: ObservabilityIntegrityReasonCode[] = [];
  const decide = (
    posture: ObservabilityIntegrityPosture,
    action: ObservabilityIntegrityAction,
    silenceIsEvidence: boolean,
    summary: string,
  ): ObservabilityIntegrityVerdict => ({
    posture,
    action,
    reasonCodes: reasons,
    silenceIsEvidence,
    summary,
  });

  // Reachable ONLY by the trusted enumerated value. `unstated` is recorded as
  // itself rather than silently rewritten to `advisory` — the caller's omission is
  // a fact about the call, and a reviewer should be able to see it.
  const loadBearing = normalized.reliance === "load_bearing";
  if (loadBearing) reasons.push("OBSERVABILITY_EVIDENCE_LOAD_BEARING");
  if (normalized.reliance === "unstated") reasons.push("OBSERVABILITY_RELIANCE_UNSTATED");

  // ── Not covered ────────────────────────────────────────────────────────────
  if (!normalized.covered) {
    reasons.push("OBSERVABILITY_STREAM_NOT_COVERED");
    return decide(
      "evidence_unverified",
      "step_up",
      false,
      "No observability record for this stream — its silence is unmeasured, not clean.",
    );
  }

  // ── Worst first: nothing is arriving, so silence carries no information ─────
  if (normalized.collection === "never_instrumented") {
    reasons.push("OBSERVABILITY_NEVER_INSTRUMENTED");
    return decide(
      "evidence_absent",
      loadBearing ? "restrict" : "step_up",
      false,
      "No exporter was ever attached to this source — nothing has ever been watching it.",
    );
  }

  if (normalized.collection === "not_reporting") {
    reasons.push("OBSERVABILITY_STREAM_NOT_REPORTING");
    return decide(
      "evidence_absent",
      loadBearing ? "restrict" : "step_up",
      false,
      "The stream is registered and currently delivering nothing.",
    );
  }

  if (normalized.collection === "unknown") {
    reasons.push("OBSERVABILITY_COLLECTION_UNKNOWN");
    return decide(
      "evidence_unverified",
      "step_up",
      false,
      "Whether this stream is collecting at all could not be established.",
    );
  }

  // ── The backend says it is collecting and nothing has ever landed ──────────
  // Two statements that disagree. The contradiction is the finding, and it must
  // not resolve in favour of the more comfortable one.
  if (normalized.freshness === "never_received") {
    reasons.push("OBSERVABILITY_SIGNAL_NEVER_RECEIVED");
    return decide(
      "evidence_absent",
      loadBearing ? "restrict" : "step_up",
      false,
      "Reported as collecting, yet no datapoint has ever arrived — the two disagree.",
    );
  }

  if (normalized.freshness === "unknown") {
    reasons.push("OBSERVABILITY_FRESHNESS_UNKNOWN");
    return decide(
      "evidence_unverified",
      "step_up",
      false,
      "The age of the newest datapoint could not be derived — unknown raises, it does not grant.",
    );
  }

  if (normalized.fidelity === "unknown") {
    reasons.push("OBSERVABILITY_FIDELITY_UNKNOWN");
    return decide(
      "evidence_unverified",
      "step_up",
      false,
      "How much of this stream survives to the backend is unrecognised, so its silence is ungraded.",
    );
  }

  if (normalized.freshness === "stale") {
    reasons.push("OBSERVABILITY_SIGNAL_STALE");
    return decide(
      "evidence_stale",
      loadBearing ? "step_up" : "monitor",
      false,
      "The newest datapoint is past the interval this source itself declares.",
    );
  }

  // ── The quiet failure this family was built for ────────────────────────────
  // Up, current, healthy — and lossy. Excellent evidence for an aggregate; nearly
  // none for "this specific thing did not happen".
  if (normalized.fidelity === "partial_drop") {
    reasons.push("OBSERVABILITY_STREAM_DROPPING");
    return decide(
      "evidence_reduced",
      loadBearing ? "step_up" : "monitor",
      false,
      "The pipeline is shedding records — an unreported event may simply have been dropped.",
    );
  }

  if (normalized.fidelity === "cost_capped") {
    reasons.push("OBSERVABILITY_STREAM_COST_CAPPED");
    return decide(
      "evidence_reduced",
      loadBearing ? "step_up" : "monitor",
      false,
      "Deliberately truncated against a spend or cardinality budget — silence here is partly a billing artefact.",
    );
  }

  if (normalized.fidelity === "sampled") {
    reasons.push("OBSERVABILITY_STREAM_SAMPLED");
    return decide(
      "evidence_reduced",
      loadBearing ? "step_up" : "monitor",
      false,
      "Sampled: sound for aggregates, and not evidence that a specific event did not occur.",
    );
  }

  // ── Arriving at full fidelity, and nobody declared how often it should ─────
  if (normalized.freshness === "no_interval_declared") {
    reasons.push("OBSERVABILITY_NO_INTERVAL_DECLARED");
    return decide(
      "evidence_ungoverned",
      "alert",
      false,
      "Data is arriving, but no expected interval exists — 'current' was never a checkable claim.",
    );
  }

  // ── reporting + full + current: the only state where silence means something ─
  reasons.push("OBSERVABILITY_EVIDENCE_SOUND");
  return decide(
    "evidence_sound",
    "none",
    true,
    "Reporting at full fidelity and inside its declared interval — silence is admissible evidence.",
  );
}
