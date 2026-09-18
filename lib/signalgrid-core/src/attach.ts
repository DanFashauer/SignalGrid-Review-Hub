/**
 * DR-043, Puck 1 + Puck 2 — the dock/attach signal domain, and removal → suspend.
 *
 * The session puck's hardware is a hypothesis behind the discovery gates and none of
 * it moves here. This is the half that needs no hardware: a fixture-backed reading of
 * whether a credential is PHYSICALLY SEATED in a receiver, and the cascade rule that
 * follows when it stops being seated.
 *
 * WHY IT SITS BESIDE `badgeBinding` RATHER THAN REPLACING IT. The badge read answers
 * *who is bound to this device*; this answers *is the credential still in the slot*.
 * They fail in different directions, and one substituting for the other is how a
 * session survives its holder walking away with the badge in their pocket.
 *
 * FAIL-CLOSED, and deliberately STRICTER than its siblings. `badgeBinding` and
 * `dockState` pin `unknown` to `allow` in `seed.ts` (lines 480 and 484) under the
 * day-one-quiet pattern — a new signal that shouts on day one gets switched off. This
 * domain does NOT inherit that: an unknown attach state is at least `step_up` and is
 * never a grant. The divergence is deliberate and is pinned by the proof rather than
 * left to be discovered, because inheriting the sibling rule is the silent, plausible
 * mistake here.
 *
 * `attached` grants NOTHING on its own. It is one axis; identity and posture must each
 * positively confirm. A seated puck is evidence about a credential, not about a person.
 *
 * DETERMINISTIC: the freshness bound and the reference instant are arguments. Nothing
 * here reads a clock.
 *
 * NOT CLAIMED: no dock, puck, reader or lock hardware exists, is touched, or is
 * commanded. SignalGrid OBSERVES an attach record and correlates it; the receiver is a
 * source of evidence, never the policy engine.
 */

import { CoreError } from "./types";
import type { RemediationAction } from "./types";
import { deterministicId } from "./util";

/** The three states, and only three. Anything else is `unknown` by construction. */
export const ATTACH_STATES = ["attached", "removed", "unknown"] as const;
export type AttachState = (typeof ATTACH_STATES)[number];

/** The two states a receiver can positively report. Everything else normalizes down. */
const POSITIVE_WIRE_STATES: readonly string[] = ["attached", "removed"];

/**
 * What a receiver reports. The shape a dock/cradle/locker bridge would normalize from
 * a vendor event API — here entirely synthetic and public-safe.
 */
export interface AttachRecord {
  /** The credential (puck, card, fob) the receiver read. */
  readonly credentialRef: string;
  /** The device the receiver is attached to or serving. */
  readonly deviceRef: string;
  /**
   * The receiver's OWN identity. Required, and its absence is the interesting case:
   * an attach record from a receiver that will not say who it is is an anonymous
   * assertion that a credential is seated, which is exactly the assertion an attacker
   * would like to make.
   */
  readonly receiverRef: string;
  /** Verbatim from the wire. A value outside the two positive states is `unknown`. */
  readonly wireState: string;
  readonly observedAt: string;
  /** True when the receiver reports the credential was torn out rather than lifted. */
  readonly forced?: boolean;
  readonly sourceReference?: string;
}

/** A normalized reading. `reason` always says why, including on the happy path. */
export interface AttachReading {
  readonly credentialRef: string;
  readonly deviceRef: string;
  readonly receiverRef: string | null;
  readonly state: AttachState;
  /** True only when the receiver positively reported a forced/torn removal. */
  readonly forced: boolean;
  readonly observedAt: string | null;
  readonly reason: string;
  readonly sourceReference: string;
}

const blank = (value: unknown): boolean => typeof value !== "string" || value.trim().length === 0;

function parse(instant: string | undefined): number | null {
  if (blank(instant)) return null;
  const ms = Date.parse(instant as string);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalize one attach record against a caller-supplied reference instant and
 * freshness bound. Pure and total — it never throws, because an unreadable record is
 * an ANSWER (`unknown`), not an exception the cascade has to survive.
 *
 * Everything below resolves to `unknown`: a wire value outside the two positive
 * states, an unparseable or absent observation instant, a missing receiver identity,
 * an observation older than the bound, and an observation from the future.
 */
export function normalizeAttachRecord(
  record: AttachRecord,
  referenceInstant: string,
  freshnessBoundSeconds: number,
): AttachReading {
  const sourceReference = record.sourceReference ?? `fixture:attach:${record.credentialRef}`;
  const base = {
    credentialRef: record.credentialRef,
    deviceRef: record.deviceRef,
    receiverRef: blank(record.receiverRef) ? null : record.receiverRef,
    forced: record.forced === true,
    sourceReference,
  };
  const unknown = (reason: string): AttachReading => ({
    ...base,
    state: "unknown",
    observedAt: null,
    reason,
  });

  if (blank(record.receiverRef)) {
    return unknown("the record names no receiver — an anonymous assertion that a credential is seated");
  }
  const observedMs = parse(record.observedAt);
  const referenceMs = parse(referenceInstant);
  if (observedMs === null) return unknown("the observation instant is unparseable");
  if (referenceMs === null) return unknown("the reference instant is unparseable — no window to judge within");
  // freshness: local-by-design — same rule as utils/freshness (tolerance 0, future reads `unknown`); signalgrid-core is the BASE package with zero dependencies and cannot import @workspace/integrations, the same reason util.ts's classifyFreshness carries this marker
  if (observedMs > referenceMs) return unknown("the observation postdates the reference instant");
  // freshness: local-by-design — the age arithmetic guarded by the future check immediately above; same local-by-design reason
  if (referenceMs - observedMs > Math.max(0, freshnessBoundSeconds) * 1000) {
    return unknown(`the observation is older than the caller's ${freshnessBoundSeconds}s bound`);
  }
  if (!POSITIVE_WIRE_STATES.includes(record.wireState)) {
    return unknown(`the receiver reported "${record.wireState}", which is neither attached nor removed`);
  }

  const state = record.wireState as "attached" | "removed";
  return {
    ...base,
    state,
    observedAt: record.observedAt,
    reason:
      state === "attached"
        ? "the receiver reports the credential seated, within the freshness bound"
        : base.forced
          ? "the receiver reports the credential torn out"
          : "the receiver reports the credential lifted",
  };
}

// ── Puck 4's policy matrix, as rows ──────────────────────────────────────────
//
// The situation table from the hardware hypothesis, on this tree's verdict ladder.
// It lives here rather than in the simulator because the simulator's decision engine
// is a byte-faithful twin of the Swift port (golden rule 1) and must not grow branches;
// the simulator scenario exercises the LIFECYCLE, and this grades the MATRIX.

/** The ladder, most restrictive first. Same vocabulary the /v1 gate returns. */
export type PuckVerdict = "deny" | "restrict" | "step_up" | "allow";

/** How the worker's credential was enrolled, and how this read arrived. */
export type CredentialStrength = "strong" | "legacy_125khz" | "unknown";

/** What the organization knows about the credential itself. */
export type CredentialStanding = "valid" | "lost" | "revoked" | "unknown";

export interface PuckSituation {
  readonly attach: AttachState;
  /** A forced/torn removal, as the receiver reported it. */
  readonly forced: boolean;
  /** Identity positively confirmed for THIS session. `false` covers unknown. */
  readonly identityConfirmed: boolean;
  /** Device posture positively confirmed. `false` covers unknown. */
  readonly postureCompliant: boolean;
  readonly credentialStanding: CredentialStanding;
  /** How this read arrived — the downgrade rule's whole input. */
  readonly readStrength: CredentialStrength;
  /** How the worker is ENROLLED. A strong-enrolled worker read over 125 kHz is a downgrade. */
  readonly enrolledStrength: CredentialStrength;
  /** The action's own risk tier. A higher-risk app raises the bar on an otherwise fine session. */
  readonly higherRiskAction: boolean;
  /** The radio says the holder is gone. NOT the same as the puck being gone. */
  readonly presenceRadioLost: boolean;
  /** No interaction for longer than policy allows. */
  readonly inactive: boolean;
  /** A re-dock happened within the policy window and nothing has re-evaluated yet. */
  readonly redockPendingReevaluation: boolean;
}

export interface PuckMatrixRow {
  readonly verdict: PuckVerdict;
  readonly reasonCode: string;
  readonly reason: string;
}

/**
 * Grade one situation. Ordered most-restrictive-first and returning on the first hit,
 * so a row can only ever be REPLACED by a stricter one above it — the ordering is the
 * fail-closed property, not a style choice.
 *
 * The two rows worth arguing about, argued here rather than discovered later:
 *
 *   · LEGACY 125 kHz FOR A STRONG-ENROLLED WORKER IS `deny`, not `step_up`. A worker
 *     enrolled on a strong credential cannot arrive over a cloneable one; that read is
 *     evidence of a clone, and stepping up would ask the attacker to try again.
 *
 *   · RADIO SAYS GONE, PUCK SEATED IS NOT "GONE". Treating a lost radio as departure
 *     ends live sessions on a dropped packet. But a presence signal that disagrees with
 *     the seat is still an unknown, and golden rule 2 says an unknown RAISES — so it is
 *     `step_up`, never `allow`, and never a suspend. Both halves matter; either one
 *     alone is a defect.
 */
export function puckVerdict(s: PuckSituation): PuckMatrixRow {
  if (s.credentialStanding === "lost" || s.credentialStanding === "revoked") {
    return { verdict: "deny", reasonCode: "CREDENTIAL_NOT_IN_GOOD_STANDING", reason: `the credential is ${s.credentialStanding}` };
  }
  if (s.enrolledStrength === "strong" && s.readStrength === "legacy_125khz") {
    return { verdict: "deny", reasonCode: "CREDENTIAL_DOWNGRADE", reason: "a strong-enrolled worker cannot arrive over a cloneable 125 kHz read" };
  }
  if (s.attach === "removed" && s.forced) {
    return { verdict: "deny", reasonCode: "CUSTODY_TORN", reason: "the credential was torn out of the receiver" };
  }
  if (s.attach === "removed") {
    return { verdict: "restrict", reasonCode: "CUSTODY_REMOVED", reason: "the credential left the receiver — the key is out of the ignition" };
  }
  if (s.inactive) {
    return { verdict: "restrict", reasonCode: "SESSION_INACTIVE", reason: "the puck is seated and nobody is there — the session locks on inactivity, it does not stay open on the seat" };
  }
  if (s.attach === "unknown") {
    return { verdict: "step_up", reasonCode: "CUSTODY_UNKNOWN", reason: "the attach state is unknown, which raises the bar and never grants" };
  }
  if (s.credentialStanding === "unknown") {
    return { verdict: "step_up", reasonCode: "CREDENTIAL_STANDING_UNKNOWN", reason: "nothing confirms the credential is in good standing" };
  }
  if (!s.identityConfirmed || !s.postureCompliant) {
    return {
      verdict: "step_up",
      reasonCode: "AXIS_UNCONFIRMED",
      reason: "a seated credential is one axis — identity and posture must each positively confirm",
    };
  }
  if (s.redockPendingReevaluation) {
    return { verdict: "step_up", reasonCode: "REDOCK_AWAITING_REEVALUATION", reason: "a re-dock resumes only after a full re-evaluation, never silently" };
  }
  if (s.presenceRadioLost) {
    return { verdict: "step_up", reasonCode: "PRESENCE_UNCERTAIN", reason: "the radio says gone and the puck is seated — do not assume gone, but do not assume present either" };
  }
  if (s.higherRiskAction) {
    return { verdict: "step_up", reasonCode: "ACTION_RISK_TIER", reason: "a higher-risk action asks for more than a seated credential and a fresh posture" };
  }
  return { verdict: "allow", reasonCode: "CUSTODY_AND_TRUST_CONFIRMED", reason: "known worker, compliant device, credential seated" };
}

// ── Puck 2 — removal → suspend, through the cascade's existing seam ──────────

/** Everything the suspend request needs. Every instant is an argument. */
export interface SuspendRequestInput {
  readonly tenantId: string;
  readonly decisionId: string;
  /** The session/workflow to suspend. */
  readonly sessionRef: string;
  readonly requestedAt: string;
}

/**
 * Request that a live session be suspended because its credential left the receiver.
 *
 * It mints the SAME `RemediationAction` the rest of the cascade already carries —
 * approval-required, simulated-only, no "executed" status — so `verifyRemediation`
 * grades the suspend exactly as it grades any other requested fix, and an UNOBSERVED
 * suspend is not a suspended session. Nothing here suspends anything: SignalGrid has
 * no session to end. The host app does, and this is how it is asked.
 *
 * Throws only on a `reading` that is not a removal, because a suspend derived from a
 * non-removal is a caller bug rather than a state of the world — every genuinely
 * uncertain input is already `unknown`, and `unknown` does not reach here.
 */
export function requestSessionSuspend(reading: AttachReading, input: SuspendRequestInput): RemediationAction {
  if (reading.state !== "removed") {
    throw new CoreError("validation", `A suspend can only follow a removal; this reading is "${reading.state}".`, 400);
  }
  const reasonCode = reading.forced ? "CUSTODY_TORN" : "CUSTODY_REMOVED";
  return {
    id: deterministicId("rem", input.decisionId, "request_session_suspend", input.sessionRef),
    tenantId: input.tenantId,
    decisionId: input.decisionId,
    kind: "request_session_suspend",
    targetType: "workflow",
    targetRef: input.sessionRef,
    reasonCode,
    status: "requires_approval",
    approvalRequired: true,
    simulatedOnly: true,
    requestedAt: input.requestedAt,
    approvedAt: null,
    note: `${reading.reason} — the host app is asked to suspend ${input.sessionRef}. SignalGrid records and simulates; it does not end sessions.`,
  };
}

/**
 * Does a re-dock inside the policy window resume the session?
 *
 * No — not by itself, ever. It returns whether the re-dock is INSIDE the window, which
 * is a different question from whether anything resumes, and the caller must still run
 * a full re-evaluation. The function is named for what it answers so nobody reads a
 * `true` as permission: `puckVerdict` with `redockPendingReevaluation: true` is
 * `step_up` regardless of how quick the re-dock was.
 *
 * Outside the window, or with either instant unreadable, the answer is `false` — a
 * re-dock nobody can time is not a quick one.
 */
export function redockWithinWindow(removedAt: string, redockedAt: string, windowSeconds: number): boolean {
  const from = parse(removedAt);
  const to = parse(redockedAt);
  if (from === null || to === null) return false;
  const gap = to - from;
  return gap >= 0 && gap <= Math.max(0, windowSeconds) * 1000;
}
