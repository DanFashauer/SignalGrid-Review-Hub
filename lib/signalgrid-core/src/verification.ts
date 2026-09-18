// Cascade join 4 — monitor the fix: did the requested remediation ACTUALLY land?
//
// Serves the half of the owner's sentence nothing in this fabric answered:
// "…and monitor the fix or jump in and resolve problem". What existed was narrower.
// `simulateResolution` PREVIEWS the outcome once the resolvable fixes are applied — a
// projection, not an observation. Exception release lifts a restriction when a
// condition is observed to clear, but only for the exception family. Decision
// continuity settles which verdict wins after a partition. None of them watches a
// requested remediation and reports whether it happened;
// `docs/SIGNALGRID_CLOUD_PLATFORM_AND_CYBER_RESILIENCE_ARCHITECTURE.md` §9 says so in
// its own words.
//
// This module pairs a `RemediationAction` — the record `proposeRemediation` already
// mints — with the next real evidence read for the same target, and derives a verdict
// against a caller-supplied reference instant. It deliberately introduces NO parallel
// request type: a second shape for "a remediation we asked for" is how the two drift.
//
// ── FAIL-CLOSED, IN THE FOUR PLACES IT ACTUALLY MATTERS ──────────────────────
//
//  1. `unobserved` IS NOT `cleared`. The whole join exists because these two are easy
//     to conflate and are opposite facts: "we looked and the problem is gone" versus
//     "we never looked". An unobserved remediation KEEPS the restriction on —
//     `restrictionHolds` returns true — and on the second consecutive miss it
//     escalates, which is the "or jump in" half of the sentence. Silence is never
//     promoted to success by the passage of time.
//
//  2. A REMEDIATION NOBODY APPROVED CANNOT HAVE LANDED. Every proposal is born
//     `requires_approval` and nothing here executes (`simulatedOnly: true`), so an
//     unapproved action had nothing to observe. It reads `unobserved` REGARDLESS of
//     what the evidence says — otherwise an unrelated improvement would close a fix
//     that was never carried out, and the restriction would lift on a coincidence.
//     This is the state most proposals are in, so it must not read as success.
//
//  3. AN UNREADABLE INSTANT IS NOT A CLEARING OBSERVATION. A read whose `observedAt`
//     does not parse cannot be placed in time, so it cannot be shown to postdate the
//     request, so it is not evidence the fix landed. It is inadmissible and counts as
//     a miss — an unparseable timestamp tightens the answer, never loosens it.
//
//  4. A READ THAT PREDATES THE REQUEST PROVES NOTHING. Evidence gathered before the
//     remediation was asked for cannot testify to whether it was carried out. Only
//     reads STRICTLY AFTER `requestedAt` and at-or-before the reference instant are
//     admissible. Without this a stale clean read clears every future request.
//
// The one place escalation is deliberately WITHHELD is `dismissed`: a person already
// looked and made a call. The restriction still holds — the reason code was never
// cleared — but paging about it would be paging someone about their own decision.
//
// ── DETERMINISTIC ────────────────────────────────────────────────────────────
// No clock. The reference instant is an argument, exactly as on every recency axis in
// `lib/integrations`. No IO, no randomness, no network — the verdict is a pure
// function of the action, the reads the caller already holds, and `asOf`.

import { deterministicId } from "./util";
import type { RemediationAction } from "./types";

/**
 * One real evidence read for a target, as the caller already holds it.
 *
 * `reasonCodes` is what was STILL true at that read. A remediation cleared its code
 * when the code is ABSENT from an admissible read.
 */
export interface EvidenceRead {
  /** Matched against the action's `targetRef`. */
  readonly targetRef: string;
  readonly reasonCodes: readonly string[];
  readonly observedAt: string;
}

/**
 * - `cleared`      — an admissible read exists and the code is gone.
 * - `not_cleared`  — an admissible read exists and the code is still there.
 * - `unobserved`   — nothing admissible to judge by. NOT a synonym for cleared.
 */
export type VerificationState = "cleared" | "not_cleared" | "unobserved";

export interface RemediationVerification {
  readonly id: string;
  readonly remediationId: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly targetRef: string;
  /** The reason code this remediation was supposed to clear. */
  readonly reasonCode: string;
  readonly state: VerificationState;
  /** The instant of the read this verdict rests on. Null when `unobserved` — there is
   *  no observation to name, and naming one would be a fabricated status. */
  readonly observedAt: string | null;
  /** Consecutive times this remediation has come up unobserved, including this one. */
  readonly misses: number;
  /** True on the SECOND consecutive miss — the "or jump in" trigger. */
  readonly escalated: boolean;
  readonly note: string;
}

/** Parse an instant, or null. Never silently 0, which would place an unreadable
 *  instant before every request and admit it as evidence. */
function instant(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

const ESCALATE_AFTER_MISSES = 2;

/**
 * Derive whether a requested remediation landed, as of `asOf`. Pure and total.
 *
 * `priorMisses` carries the consecutive-miss count from the previous verification of
 * this same action, so the second miss escalates. It is an argument rather than state
 * held here: this module stores nothing, and a caller that forgets it gets a FRESH
 * count, which escalates LATER rather than sooner — the conservative direction for a
 * page, since a spurious escalation is its own failure mode.
 */
export function verifyRemediation(
  action: RemediationAction,
  reads: readonly EvidenceRead[],
  asOf: string,
  priorMisses = 0,
): RemediationVerification {
  const base = {
    id: deterministicId("remverify", action.id, action.reasonCode, asOf),
    remediationId: action.id,
    decisionId: action.decisionId,
    tenantId: action.tenantId,
    targetRef: action.targetRef,
    reasonCode: action.reasonCode,
  } as const;

  const miss = (note: string): RemediationVerification => {
    const misses = priorMisses + 1;
    return { ...base, state: "unobserved", observedAt: null, misses, escalated: misses >= ESCALATE_AFTER_MISSES, note };
  };

  // A person already ruled on this one. Not cleared, but not a page either.
  if (action.status === "dismissed") {
    return {
      ...base,
      state: "unobserved",
      observedAt: null,
      misses: 0,
      escalated: false,
      note: "dismissed — a person ruled on this; the reason code was never cleared, so the restriction stands",
    };
  }

  // Nothing executes here by design, so an unapproved action had nothing to observe.
  // Checked BEFORE the evidence so no coincidental read can close it.
  if (action.status !== "approved_simulated") {
    return miss("awaiting approval — nothing was actioned, so nothing can have landed");
  }

  const requestedMs = instant(action.requestedAt);
  const asOfMs = instant(asOf);
  // An unreadable window admits no read. Handled explicitly rather than left to
  // NaN comparisons, where every comparison is false and the result LOOKS like
  // "no reads existed" — the right answer for the wrong reason, one refactor from wrong.
  if (requestedMs === null) return miss("request instant is unparseable — nothing can be shown to postdate it");
  if (asOfMs === null) return miss("reference instant is unparseable — no window to judge within");

  const admissible = reads
    .map((r) => ({ read: r, ms: instant(r.observedAt) }))
    .filter(
      (x): x is { read: EvidenceRead; ms: number } =>
        x.ms !== null && x.read.targetRef === action.targetRef && x.ms > requestedMs && x.ms <= asOfMs,
    )
    .sort((a, b) => a.ms - b.ms);

  const first = admissible[0];
  if (first === undefined) {
    return miss("no evidence read for this target between the request and the reference instant");
  }

  // The EARLIEST admissible read decides. A later one may show the problem returning,
  // which is a new decision's business, not evidence that this fix never landed.
  const stillPresent = first.read.reasonCodes.includes(action.reasonCode);
  return {
    ...base,
    state: stillPresent ? "not_cleared" : "cleared",
    observedAt: first.read.observedAt,
    // A real observation ends the streak either way: we looked, and now we know.
    misses: 0,
    escalated: false,
    note: stillPresent
      ? `${action.reasonCode} still present at the first read after the request`
      : `${action.reasonCode} absent at the first read after the request`,
  };
}

/**
 * Does the restriction stay on? THE fail-closed question, and the reason this is a
 * function rather than a boolean field a caller can forget to read.
 *
 * Only an OBSERVED clear lifts it. `not_cleared` holds, and `unobserved` holds —
 * because not having looked is not the same as having found nothing wrong.
 */
export function restrictionHolds(verification: RemediationVerification): boolean {
  return verification.state !== "cleared";
}

/** The verifications that need a person. Escalation is surfaced, never inferred. */
export function needsIntervention(
  verifications: readonly RemediationVerification[],
): RemediationVerification[] {
  return verifications.filter((v) => v.escalated || v.state === "not_cleared");
}
