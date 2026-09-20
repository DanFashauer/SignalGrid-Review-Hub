import { deriveFreshness, type Freshness } from "../../utils/freshness";
import { posedBound } from "../../utils/posed-bound";
import type {
  NormalizedEndpointThreat,
  ThreatAction,
  ThreatPosture,
  ThreatReasonCode,
  ThreatSeverity,
  ThreatVerdict,
} from "./types";

/**
 * Pure, deterministic EDR/EPP threat-posture evaluator. Aggregates an endpoint's
 * agent health + detections into ONE threat posture + the action it warrants —
 * fail-safe, so the WORST concern drives the verdict and a device we can't see
 * (no agent / not reporting) is never mistaken for a protected one. No clock, no
 * randomness.
 *
 * `reporting=false` means "we have no EDR record for this device" → posture
 * unknown (a blind spot to investigate), which is different from an endpoint that
 * reports in with a healthy agent and no threats → protected.
 */

const SEVERITY_RANK: Record<ThreatSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  unknown: 0,
};

// Local action-severity ordering, consistent with the unified ladder
// (none < monitor < step_up < alert < restrict < escalate). Used only to pick
// the STRONGEST concern among an endpoint's independent risk factors, so a
// severe state is never diluted by a calmer one that happens to be checked later
// (order-proof — same discipline as posture-composition's fromDevicePosture).
const ACTION_SEVERITY: Record<ThreatAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

const STALE_SIGNATURE_HOURS_DEFAULT = 72;

/**
 * How long an endpoint may go unseen before its whole report is stale.
 *
 * `signatureAgeHours` is an AGE the source computes for us; `lastSeen` is a SIGHTING,
 * and a sighting needs a reference instant to mean anything. 24h is a day: an EDR agent
 * that has not checked in for a day is not reporting the machine's current state, and
 * "healthy as of some time last week" is not a reading anyone should grant on.
 */
const STALE_LAST_SEEN_HOURS_DEFAULT = 24;

export interface EvaluateThreatOptions {
  /** False when the device has no EDR/EPP record at all. Default true. */
  reporting?: boolean;
  /** Signature/definition age (hours) at/above which protection is stale. Default 72. */
  staleSignatureHours?: number;
  /**
   * The reference instant this endpoint's `lastSeen` is judged against. POSED BY THE
   * CALLER — this evaluator reads no clock (golden rule 2), so without it the sighting
   * cannot be graded and is reported `"ungraded"` rather than silently treated as fresh.
   *
   * Omitting it leaves the verdict exactly as it was before `lastSeen` was graded at
   * all, which is deliberate: the alternative — inventing a concern for every caller
   * that has not asked for one — is the failure mode the segment-policy branch in
   * `network-nac/evaluate.ts` names ("stop CLAIMING trust, not invent a concern nobody
   * asked for"). What is NOT deliberate any more is claiming `protected` while carrying
   * an ungraded sighting: `lastSeenFreshness` now says which of the two happened.
   */
  nowMs?: number;
  /** Hours after which an endpoint sighting is stale. Default 24. */
  staleLastSeenHours?: number;
}

interface Candidate {
  posture: ThreatPosture;
  action: ThreatAction;
  reason: ThreatReasonCode;
}

export function evaluateThreatPosture(
  endpoint: NormalizedEndpointThreat,
  options: EvaluateThreatOptions = {},
): ThreatVerdict {
  const reporting = options.reporting ?? true;
  // posedBound: NaN/Infinity/<=0 → null (see utils/posed-bound.ts); null is treated like an
  // unreported age below — stale. An unguarded `??` once graded decade-old signatures protected.
  const staleHours = posedBound(options.staleSignatureHours, STALE_SIGNATURE_HOURS_DEFAULT);

  // THE SIGHTING. `lastSeen` was carried through the normalizer and read by NOTHING —
  // an endpoint whose agent last checked in years ago, still claiming an installed,
  // running agent with fresh signatures, graded `protected` / action `none`. The record
  // was not wrong; it was old, and nothing here could tell the difference.
  //
  // Graded only when the caller poses a reference instant, because this evaluator has
  // no clock. `deriveFreshness` is the shared body (future-dated sighting → `unknown`,
  // never `fresh`); `"ungraded"` is the fourth state and means the question was not
  // asked, which is not the same as asking it and learning nothing.
  const lastSeenStaleHours = posedBound(options.staleLastSeenHours, STALE_LAST_SEEN_HOURS_DEFAULT);
  const lastSeenFreshness: Freshness | "ungraded" =
    typeof options.nowMs === "number"
      ? deriveFreshness(
          endpoint.lastSeen,
          options.nowMs,
          lastSeenStaleHours === null ? null : lastSeenStaleHours * 3_600_000,
        )
      : "ungraded";

  // `null` means the source never reported a detection feed; `[]` means it did and
  // found nothing. Counting treats both as zero — which is correct arithmetic and
  // exactly why the distinction has to be carried separately into the verdict.
  const threatsObserved = endpoint.threats !== null;
  const threats = endpoint.threats ?? [];
  const threatCount = threats.length;
  const activeThreats = threats.filter((t) => t.active);
  const activeThreatCount = activeThreats.length;
  const highestThreatSeverity = threats.reduce<ThreatSeverity>(
    (max, t) => (SEVERITY_RANK[t.severity] > SEVERITY_RANK[max] ? t.severity : max),
    "unknown",
  );
  const highestActiveSeverity = activeThreats.reduce<ThreatSeverity>(
    (max, t) => (SEVERITY_RANK[t.severity] > SEVERITY_RANK[max] ? t.severity : max),
    "unknown",
  );

  // Fail-safe: an UNREPORTED signature age (null) is treated as stale. We never
  // report protection as fresh when its freshness cannot be confirmed — the same
  // "can't-see ≠ clean" discipline as the not-reporting and absent-agent paths.
  //
  // An UNREADABLE age (NaN — a source that sent "unknown", a parse that failed
  // upstream) is the same blind spot and must grade the same way. Until 2026-09-06
  // the test was `=== null || … >= staleHours`: `NaN >= n` is false, neither null
  // arm fires, and an unreadable age graded `protected` while an honestly absent
  // one graded `step_up` — the fifth NaN variant this repository has met, and the
  // one `check-nan-fail-open` cannot see because no Date is parsed here (the NaN
  // arrives as a plain `number | null` field). Number.isFinite rejects null, NaN
  // and ±Infinity in one predicate.
  const signaturesStale =
    !Number.isFinite(endpoint.signatureAgeHours) || staleHours === null || (endpoint.signatureAgeHours as number) >= staleHours;
  const agentPresent = endpoint.agentInstalled && endpoint.agentRunning;
  const protectionHealthy = agentPresent && endpoint.realtimeProtection && !signaturesStale;

  // No EDR record for this device → unknown (a blind spot to investigate), NOT
  // protected. Mirrors "unscanned ≠ clean" in the vulnerability dimension.
  if (!reporting) {
    return verdict("unknown", "NOT_REPORTING", "monitor", highestThreatSeverity, threatCount, activeThreatCount, protectionHealthy, lastSeenFreshness);
  }

  // Collect every applicable risk factor as a candidate, then let the STRONGEST
  // win — so a severe concern is never diluted by a calmer one (order-proof).
  const candidates: Candidate[] = [];
  if (!threatsObserved) {
    // The agent may be perfectly healthy — we simply never saw its detection feed,
    // so "no threats" is not a reading we are entitled to. Graded `monitor`, the
    // same level as NOT_REPORTING: a blind spot to investigate, not an alarm. It
    // beats the `none` default and loses to any genuinely observed problem below,
    // which is the correct precedence — a real active threat outranks "we could
    // not see".
    candidates.push({ posture: "monitored", action: "monitor", reason: "THREAT_FEED_UNOBSERVED" });
  }
  if (threatCount > 0 && activeThreatCount === 0) {
    // Detections exist but all are neutralized (quarantined/removed/blocked).
    candidates.push({ posture: "monitored", action: "monitor", reason: "THREATS_REMEDIATED" });
  }
  if (agentPresent && (!endpoint.realtimeProtection || signaturesStale)) {
    // The agent is up but its protection is weakened (RTP off or stale sigs).
    candidates.push({ posture: "degraded_protection", action: "step_up", reason: "PROTECTION_DEGRADED" });
  }
  if (!agentPresent) {
    // Not installed or not running: we can't trust any "no threats" reading.
    candidates.push({ posture: "unprotected", action: "alert", reason: "AGENT_ABSENT" });
  }
  if (lastSeenFreshness === "stale" || lastSeenFreshness === "unknown") {
    // A report we cannot date is a report we cannot rely on, and BOTH unreadable
    // members raise: `stale` means the agent stopped checking in, `unknown` means the
    // sighting was absent, unparseable, or dated in the future. Neither is evidence of
    // a healthy endpoint, and golden rule 2 forbids resolving either downward. Graded
    // at the same rung as PROTECTION_DEGRADED — the protection may well be fine, we
    // simply cannot say it is CURRENT — so a real active threat still outranks it.
    candidates.push({ posture: "degraded_protection", action: "step_up", reason: "ENDPOINT_NOT_RECENTLY_SEEN" });
  }
  if (activeThreatCount > 0) {
    if (highestActiveSeverity === "critical" || highestActiveSeverity === "high") {
      candidates.push({ posture: "critical_compromise", action: "escalate", reason: "CRITICAL_ACTIVE_THREAT" });
    } else {
      candidates.push({ posture: "active_threat", action: "restrict", reason: "ACTIVE_THREAT" });
    }
  }

  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "protected", action: "none", reason: "NO_THREATS_HEALTHY" },
  );

  return verdict(
    winner.posture,
    winner.reason,
    winner.action,
    highestThreatSeverity,
    threatCount,
    activeThreatCount,
    protectionHealthy,
    lastSeenFreshness,
  );
}

function verdict(
  posture: ThreatPosture,
  reasonCode: ThreatReasonCode,
  recommendedAction: ThreatAction,
  highestThreatSeverity: ThreatSeverity,
  threatCount: number,
  activeThreatCount: number,
  protectionHealthy: boolean,
  lastSeenFreshness: Freshness | "ungraded",
): ThreatVerdict {
  return { posture, highestThreatSeverity, threatCount, activeThreatCount, protectionHealthy, reasonCode, recommendedAction, lastSeenFreshness };
}
