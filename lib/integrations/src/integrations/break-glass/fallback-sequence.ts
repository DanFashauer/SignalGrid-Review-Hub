// Manual check-out fallback SEQUENCE — the badge→manual path at a charging dock.
//
// THE ROW THIS EXISTS FOR (docs/research/SHARED_DEVICE_CUSTODY_GROUND_TRUTH.md):
// "Manual check-out fallback (credentials when badge fails)". The generic override
// accountability grader (`evaluateBreakGlass`) already modeled that break-glass
// EXISTS and whether its record is accountable; what it did NOT model is the concrete
// SEQUENCE a clinician actually walks — a badge tap fails at the dock, and they fall
// back to an explicit, audited manual credential check-out that must itself grant or
// deny the device.
//
// WHY THIS IS A DIFFERENT SURFACE FROM evaluateBreakGlass, AND WHY IT CAN DENY.
// `evaluateBreakGlass` grades the accountability RECORD of an EHR override and its
// ceiling is `alert` — it must NEVER impede patient care, because it stands on the
// EHR-audit plane where the override already happened. THIS surface is a DEVICE
// check-out decision at a charging dock. Denying a shared iPhone is not a clinical
// safety harm: the clinician takes another device, or calls support. So this surface
// CAN deny and CAN step up — and it MUST, because the whole point of a manual
// fallback is that an unverifiable person does not walk off with a shared device.
//
// FAIL-CLOSED IS THE LOAD-BEARING LAW HERE (golden rule 2). An unknown, missing or
// unparseable signal TIGHTENS the decision — it is never a reason to hand out the
// device. Concretely: an unknown credential state denies exactly as a rejected one
// does; an unconfirmed badge precondition steps up; a malformed event sequence or an
// unauditable manual check-out denies. Nothing about ignorance ever reaches `allow`.
// No clock and no randomness: the decision is a pure function of the supplied state.

import { evaluateBreakGlass } from "./evaluate";
import { normalizeBreakGlassRecord } from "./index";
import type { BreakGlassPosture, NormalizedBreakGlass } from "./types";

/** Did the badge check-out attempt at the dock fail, succeed, or is it unconfirmed? */
export type BadgeAttempt = "failed" | "succeeded" | "unknown";

/**
 * What became of the manual fallback credential?
 *
 * `not_attempted` and `unknown` are DIFFERENT and must never be conflated. Folding a
 * flow that never invoked the manual path into `unknown` made the public evaluator
 * deny a perfectly normal successful badge check-out (it saw "unknown credential" and
 * refused before it ever looked at the badge). So:
 *   - `not_attempted` — no manual fallback happened; the decision reflects the BADGE.
 *   - `unknown` — a manual fallback WAS attempted but did not resolve. This still
 *     denies exactly as `rejected` does: an unverifiable credential is an unverifiable
 *     person, and a shared device does not leave the dock for one.
 */
export type ManualCredentialCheck = "verified" | "rejected" | "unknown" | "not_attempted";

/** Structural integrity of the event stream this sequence was read from. */
export type FallbackSequenceIntegrity = "intact" | "malformed";

/** The device-checkout decision. Unlike the EHR grader, this one can deny and step up. */
export type FallbackDecision = "allow" | "step_up" | "deny";

export type FallbackReasonCode =
  /** Badge failed, credential verified, and the manual check-out is fully accountable. */
  | "FALLBACK_GRANTED_ACCOUNTABLE"
  /** The badge check-out succeeded and no fallback was needed — the normal happy path. */
  | "FALLBACK_BADGE_CHECKOUT_OK"
  /** Granted with friction: the device is needed but the override record has gaps. */
  | "FALLBACK_GRANTED_NEEDS_AUDIT"
  /** No fallback was attempted and the badge did not succeed — no device by any path. */
  | "FALLBACK_NO_FALLBACK_ATTEMPTED"
  /** Fail-closed: the badge precondition is unconfirmed — verify before granting. */
  | "FALLBACK_BADGE_STATE_UNKNOWN"
  /** The manual path was used though the badge worked — anomalous, surface it. */
  | "FALLBACK_NOT_NEEDED_BADGE_OK"
  /** The fallback credential did not verify. No device. */
  | "FALLBACK_CREDENTIAL_REJECTED"
  /** Fail-closed: the credential state is unknown — treated exactly as rejected. */
  | "FALLBACK_CREDENTIAL_UNVERIFIED"
  /** Fail-closed: a verified check-out that cannot be audited is not granted. */
  | "FALLBACK_AUDIT_MALFORMED"
  /** Fail-closed: the event stream is empty, mis-correlated, or out of order. */
  | "FALLBACK_SEQUENCE_MALFORMED";

export interface NormalizedManualFallback {
  readonly correlationId: string;
  readonly badgeAttempt: BadgeAttempt;
  readonly manualCredential: ManualCredentialCheck;
  /** The accountability record of the MANUAL check-out (graded by evaluateBreakGlass). */
  readonly override: NormalizedBreakGlass;
  readonly sequenceIntegrity: FallbackSequenceIntegrity;
}

export interface FallbackVerdict {
  readonly decision: FallbackDecision;
  readonly reasonCode: FallbackReasonCode;
  /** The posture of the manual check-out's accountability record, carried through. */
  readonly overridePosture: BreakGlassPosture;
}

/**
 * The event-contract types this sequence is expressed in.
 *
 * These strings are members of `EventType` in @workspace/event-contract. This family
 * does not depend on that package (no family imports it), so the binding is asserted
 * in the proof instead: every string here must be a real contract event type, or the
 * proof fails. Naming them as a set keeps the normalizer honest about its vocabulary.
 */
export const FALLBACK_EVENT_TYPES = {
  badgeAccess: "badge_access",
  checkoutRequested: "checkout_requested",
  checkoutGranted: "checkout_granted",
  checkoutDenied: "checkout_denied",
} as const;

/** The minimal event shape this normalizer reads. A superset of real events is fine. */
export interface FallbackEventLike {
  readonly eventType: string;
  readonly correlationId?: string;
  /**
   * The tenant this event belongs to (a required anchor in the canonical contract).
   * Correlation alone is NOT enough to fuse events into one sequence — two tenants can
   * reuse a correlationId — so the normalizer requires one tenant across the stream.
   */
  readonly tenantId?: string;
  /** Present on a manual `checkout_requested` — the credential offered in lieu of a badge. */
  readonly mobileCredentialId?: string;
  /**
   * For a `badge_access` event: whether the badge auth SUCCEEDED or FAILED at the reader.
   * This is the POSITIVE evidence the normalizer needs to attribute a failed check-out to
   * the badge control. A bare `checkout_denied` may be posture/policy-caused, so without
   * a failed `badge_access` the badge state stays `unknown` and no fallback is enabled.
   */
  readonly outcome?: string;
}

const trimmed = (v: string | undefined): string => (typeof v === "string" ? v.trim() : "");

/**
 * Grade one device-checkout fallback decision.
 *
 * Pure and deterministic; no clock. Precedence is written so that TIGHTENING always
 * wins: every deny/step-up condition is checked before `allow` can be reached, and
 * each ignorance case resolves to a tighter action than the state it is ignorant of.
 */
export function evaluateManualFallback(state: NormalizedManualFallback): FallbackVerdict {
  const posture = evaluateBreakGlass(state.override).posture;
  const at = (decision: FallbackDecision, reasonCode: FallbackReasonCode): FallbackVerdict => ({
    decision,
    reasonCode,
    overridePosture: posture,
  });

  // 1. If we cannot trust the event stream at all, we grant nothing. Fail-closed.
  if (state.sequenceIntegrity === "malformed") return at("deny", "FALLBACK_SEQUENCE_MALFORMED");

  // 2. No manual fallback was attempted — this is NOT a fallback decision, so it reflects
  //    the BADGE outcome and nothing else. A successful badge check-out is the normal
  //    happy path and must not be falsely denied; anything short of a confirmed success
  //    (badge failed, or badge unconfirmed) means no device was granted by any path.
  //    NOTE this is distinct from `unknown` below: not-attempted is not ignorance.
  if (state.manualCredential === "not_attempted") {
    if (state.badgeAttempt === "succeeded") return at("allow", "FALLBACK_BADGE_CHECKOUT_OK");
    return at("deny", "FALLBACK_NO_FALLBACK_ATTEMPTED");
  }

  // 3. A manual fallback WAS attempted. The credential is the person. An unverifiable
  //    credential is an unverifiable person, and it denies EXACTLY as a rejected one
  //    does — ignorance is not softer than a refusal here, even if the badge succeeded.
  if (state.manualCredential === "unknown") return at("deny", "FALLBACK_CREDENTIAL_UNVERIFIED");
  if (state.manualCredential === "rejected") return at("deny", "FALLBACK_CREDENTIAL_REJECTED");

  // credential verified from here.

  // 4. Anomalous: the badge worked, yet a manual fallback was also used. Surface it.
  if (state.badgeAttempt === "succeeded") return at("step_up", "FALLBACK_NOT_NEEDED_BADGE_OK");

  // 5. Fail-closed: we lack POSITIVE evidence the badge was the failed control (a bare
  //    denial may be posture/policy-caused). We know WHO but not that the fallback was
  //    warranted, so we step up rather than grant silently — never allow.
  if (state.badgeAttempt === "unknown") return at("step_up", "FALLBACK_BADGE_STATE_UNKNOWN");

  // From here: the badge FAILED (positive evidence) and the credential verified.

  // 6. A verified check-out that cannot be audited is not granted. An unauditable
  //    manual override is the exact hole the break-glass family exists to close, so it
  //    denies rather than merely adding friction.
  if (state.override.reportIntegrity === "malformed") return at("deny", "FALLBACK_AUDIT_MALFORMED");

  // 7. Grant. Outright when the manual check-out is fully accountable; with friction
  //    (step_up) when it is not, so the device reaches the clinician but the missing
  //    justification/scope/review is forced to be captured.
  if (posture === "accountable") return at("allow", "FALLBACK_GRANTED_ACCOUNTABLE");
  return at("step_up", "FALLBACK_GRANTED_NEEDS_AUDIT");
}

/** Outcome tokens on a `badge_access` event that count as the badge auth having failed. */
const BADGE_FAILURE_OUTCOMES = new Set(["failure", "failed", "fail", "denied", "denial", "reject", "rejected"]);
/** …and the ones that count as the badge auth having succeeded. */
const BADGE_SUCCESS_OUTCOMES = new Set(["success", "succeeded", "succeed", "granted", "grant", "ok", "pass", "passed"]);

/**
 * Read a badge→manual fallback sequence out of an ordered event stream.
 *
 * Deterministic over ARRAY ORDER (the caller supplies the events in occurrence order);
 * no timestamp is read, so no clock enters the decision path. Fail-closed on structure —
 * every one of these reads as `malformed`, which denies:
 *   - an empty stream;
 *   - a missing or mixed `correlationId`, OR a missing or mixed `tenantId` (correlation
 *     alone cannot fuse a sequence — two tenants can share a correlationId);
 *   - an orphan resolution (a grant/deny with no badge tap or manual request before it);
 *   - a manual request that arrives before the badge attempt has resolved;
 *   - a SECOND or contradictory resolution for either phase (ambiguity tightens);
 *   - contradictory badge evidence (a failed AND a succeeded badge in one stream).
 *
 * BADGE CAUSATION IS POSITIVE-EVIDENCE ONLY. A bare `checkout_denied` may be caused by
 * device posture, policy, or any non-badge control, and the canonical event carries no
 * denial-cause field. So the badge is treated as `failed` ONLY when a `badge_access`
 * event explicitly reports a failure outcome; absent that, the badge state is `unknown`
 * and the manual fallback is NOT enabled to allow.
 *
 * The `override` accountability record is supplied separately (it lives on the EHR-audit
 * plane, not in the dock event stream) and normalized through the same asymmetric
 * normalizer the rest of the family uses.
 */
export function normalizeManualFallbackSequence(
  events: readonly FallbackEventLike[],
  overrideRaw: Record<string, unknown> = {},
): NormalizedManualFallback {
  const override = normalizeBreakGlassRecord(overrideRaw);

  const corr = trimmed(events.find((e) => trimmed(e.correlationId) !== "")?.correlationId);
  const correlationBroken =
    events.length === 0 ||
    corr === "" ||
    events.some((e) => trimmed(e.correlationId) !== corr);

  // Tenant fusion: exactly one nonempty tenant across every correlated event. Missing or
  // mixed tenant cannot be trusted to be one sequence, so it fails closed.
  const tenant = trimmed(events.find((e) => trimmed(e.tenantId) !== "")?.tenantId);
  const tenantBroken =
    events.length === 0 ||
    tenant === "" ||
    events.some((e) => trimmed(e.tenantId) !== tenant);

  let sawBadge = false;
  let badgeAuthFailed = false;
  let badgeAuthSucceeded = false;
  let badgeCheckoutGranted = false;
  let badgeCheckoutDenied = false;
  let manualRequested = false;
  let manualResolved: "granted" | "denied" | null = null;
  let structureBroken = false;

  const badgeResolvedSoFar = (): boolean =>
    badgeAuthFailed || badgeAuthSucceeded || badgeCheckoutGranted || badgeCheckoutDenied;

  for (const e of events) {
    switch (e.eventType) {
      case FALLBACK_EVENT_TYPES.badgeAccess: {
        sawBadge = true;
        const o = trimmed(e.outcome).toLowerCase();
        if (BADGE_FAILURE_OUTCOMES.has(o)) badgeAuthFailed = true;
        else if (BADGE_SUCCESS_OUTCOMES.has(o)) badgeAuthSucceeded = true;
        // No/unrecognised outcome: no positive evidence either way — stays unknown.
        break;
      }
      case FALLBACK_EVENT_TYPES.checkoutRequested:
        // A manual fallback request is the one that carries a credential in lieu of a badge.
        if (trimmed(e.mobileCredentialId) !== "") {
          // Out of order: the manual fallback cannot precede the badge attempt resolving.
          if (sawBadge && !badgeResolvedSoFar()) structureBroken = true;
          manualRequested = true;
        }
        break;
      case FALLBACK_EVENT_TYPES.checkoutGranted:
      case FALLBACK_EVENT_TYPES.checkoutDenied: {
        const outcome = e.eventType === FALLBACK_EVENT_TYPES.checkoutGranted ? "granted" : "denied";
        if (manualRequested) {
          // A second manual resolution — duplicate or contradictory — is ambiguous, and
          // ambiguity on high-risk grant evidence must tighten, never keep the first.
          if (manualResolved === null) manualResolved = outcome;
          else structureBroken = true;
        } else if (sawBadge) {
          // Badge-phase resolution. A second one (of either kind) is ambiguous.
          if (badgeCheckoutGranted || badgeCheckoutDenied) structureBroken = true;
          else if (outcome === "granted") badgeCheckoutGranted = true;
          else badgeCheckoutDenied = true;
        } else {
          // A resolution with neither a badge tap nor a manual request before it.
          structureBroken = true;
        }
        break;
      }
      default:
        // Unrelated event types (posture_changed, dock_*, …) are ignored, not fatal.
        break;
    }
  }

  // Positive evidence in BOTH directions is a contradiction — fail closed.
  const badgeFailed = badgeAuthFailed;
  const badgeSucceeded = badgeAuthSucceeded || badgeCheckoutGranted;
  if (badgeFailed && badgeSucceeded) structureBroken = true;

  if (correlationBroken || tenantBroken || structureBroken) {
    return { correlationId: corr, badgeAttempt: "unknown", manualCredential: "not_attempted", override, sequenceIntegrity: "malformed" };
  }

  // Badge is `failed` ONLY on positive badge-auth-failure evidence; a bare denial is not
  // enough (it may be posture/policy-caused). Otherwise succeeded, else unknown.
  const badgeAttempt: BadgeAttempt = badgeFailed ? "failed" : badgeSucceeded ? "succeeded" : "unknown";

  // `not_attempted` and `unknown` are distinct: no manual request at all is not_attempted;
  // a request that never resolved is unknown (and denies).
  const manualCredential: ManualCredentialCheck = !manualRequested
    ? "not_attempted"
    : manualResolved === "granted"
      ? "verified"
      : manualResolved === "denied"
        ? "rejected"
        : "unknown";

  return { correlationId: corr, badgeAttempt, manualCredential, override, sequenceIntegrity: "intact" };
}

// The accountability shapes the fixtures reuse, written as LITERAL normalized records
// rather than built through `normalizeBreakGlassRecord` at module-init time: that
// function lives in ./index, which re-exports this module, so calling it while this
// module is initializing would touch an index-scoped const still in its temporal dead
// zone. The runtime `normalizeManualFallbackSequence` below calls it safely — by then
// index has finished initializing. These literals are validated against the normalizer
// in the proof, so they cannot silently drift from what the normalizer would produce.
const OVERRIDE_ACCOUNTABLE: NormalizedBreakGlass = {
  invocationRef: "bg-fallback-good",
  justification: "recorded",
  scope: "single_encounter",
  expiry: "bounded",
  review: "reviewed",
  assignmentAtInvocation: "not_assigned",
  reportIntegrity: "intact",
};
const OVERRIDE_UNDER_DOCUMENTED: NormalizedBreakGlass = {
  invocationRef: "bg-fallback-thin",
  justification: "recorded",
  scope: "single_encounter",
  expiry: "bounded",
  // The manual check-out was captured but its review has not happened yet — a real
  // accountability gap, so the device is granted WITH friction rather than silently.
  review: "pending",
  assignmentAtInvocation: "not_assigned",
  reportIntegrity: "intact",
};
// An unidentifiable record: exactly what `normalizeBreakGlassRecord({})` produces.
const OVERRIDE_MALFORMED: NormalizedBreakGlass = {
  invocationRef: "",
  justification: "absent",
  scope: "unknown",
  expiry: "unknown",
  review: "unknown",
  assignmentAtInvocation: "unknown",
  reportIntegrity: "malformed",
};

/**
 * Deterministic fixture corpus for the badge→manual fallback sequence, each named for
 * the real branch it demonstrates. Distinct from BREAK_GLASS_FIXTURES: those grade an
 * EHR override record, these decide a device check-out.
 */
export const MANUAL_FALLBACK_FIXTURES: Readonly<Record<string, NormalizedManualFallback>> = {
  // The NORMAL path: the badge succeeded and no manual fallback was needed. This must NOT
  // be falsely denied just because the fallback credential was never presented.
  "badge-succeeded-no-fallback": {
    correlationId: "cust-0",
    badgeAttempt: "succeeded",
    manualCredential: "not_attempted",
    override: OVERRIDE_ACCOUNTABLE, // irrelevant here — the manual path was never used
    sequenceIntegrity: "intact",
  },
  // The honest happy path: badge failed at the dock, the clinician's manual credential
  // verified, and the manual check-out is fully accountable → the device is granted.
  "badge-failed-manual-verified-accountable": {
    correlationId: "cust-1",
    badgeAttempt: "failed",
    manualCredential: "verified",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "intact",
  },
  // Same path, but the manual check-out never captured a reason → granted WITH friction,
  // so the device reaches the bedside while the missing audit is forced to be filled.
  "badge-failed-manual-verified-underdocumented": {
    correlationId: "cust-2",
    badgeAttempt: "failed",
    manualCredential: "verified",
    override: OVERRIDE_UNDER_DOCUMENTED,
    sequenceIntegrity: "intact",
  },
  // The credential was offered and rejected → no device.
  "badge-failed-credential-rejected": {
    correlationId: "cust-3",
    badgeAttempt: "failed",
    manualCredential: "rejected",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "intact",
  },
  // FAIL-CLOSED: the credential state is unknown → denied exactly as rejected.
  "badge-failed-credential-unknown": {
    correlationId: "cust-4",
    badgeAttempt: "failed",
    manualCredential: "unknown",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "intact",
  },
  // FAIL-CLOSED: we cannot confirm the badge failed, so the fallback is unwarranted →
  // step up rather than grant silently.
  "badge-state-unknown": {
    correlationId: "cust-5",
    badgeAttempt: "unknown",
    manualCredential: "verified",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "intact",
  },
  // Anomalous: the badge worked, yet the manual path was used → surface it, do not grant.
  "badge-succeeded-manual-used": {
    correlationId: "cust-6",
    badgeAttempt: "succeeded",
    manualCredential: "verified",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "intact",
  },
  // FAIL-CLOSED: the event stream is unusable → nothing is granted.
  "sequence-malformed": {
    correlationId: "",
    badgeAttempt: "unknown",
    manualCredential: "unknown",
    override: OVERRIDE_ACCOUNTABLE,
    sequenceIntegrity: "malformed",
  },
  // FAIL-CLOSED: credential verified and badge failed, but the manual check-out cannot
  // be audited → denied, not merely stepped up. An unauditable override is the hole.
  "audit-malformed": {
    correlationId: "cust-8",
    badgeAttempt: "failed",
    manualCredential: "verified",
    override: OVERRIDE_MALFORMED, // no invocationRef → malformed record
    sequenceIntegrity: "intact",
  },
};

export function evaluateManualFallbackFixture(name: string): FallbackVerdict | undefined {
  const state = MANUAL_FALLBACK_FIXTURES[name];
  return state ? evaluateManualFallback(state) : undefined;
}
