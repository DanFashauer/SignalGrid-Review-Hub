import {
  type CredentialAssurance,
  type PacsAccessAction,
  type PacsAccessPosture,
  type PacsAccessReasonCode,
  type PacsAccessVerdict,
  type NormalizedPacsAccess,
} from "./types";

/**
 * Pure, deterministic physical access-control (PACS) evaluator. Folds a controlled
 * entry's evaluated state into ONE posture + the action it warrants, fail-safe.
 *
 * The shared-device physical-custody question dominates:
 *  - a badge/biometric presentation actively DENIED, a REVOKED credential, or a PACS
 *    holder who does NOT match the checked-out device holder is the strongest
 *    negative → ESCALATE;
 *  - an anti-passback (tailgating) VIOLATION, or a FORCED door, is a physical breach
 *    → RESTRICT (contain);
 *  - an entry OUT OF SCHEDULE / OUT OF ZONE, or a door HELD open, → STEP_UP; anything
 *    unreadable, or the bridge unreachable, → STEP_UP (never trust silence);
 *  - only a POSITIVELY-confirmed clean entry — GRANTED, authorized, in-bounds, at a
 *    SECURE door, with the PACS identity matching the checked-out holder, on a KNOWN
 *    credential, with the bridge reachable — contributes 'none'. Worst-concern-wins.
 *
 * `covered=false` = no PACS result was returned for this entry → unknown (a gap),
 * step_up.
 */

const ACTION_SEVERITY: Record<PacsAccessAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

/** The floors a caller may pose. Ranked so a future finer ladder slots in without
 *  changing the comparison. */
const TECHNOLOGY_RANK = { static_identifier: 1, cryptographic: 2 } as const;
export type CredentialTechnologyFloor = keyof typeof TECHNOLOGY_RANK;

export interface EvaluatePacsAccessOptions {
  /** False when no PACS result was returned for this entry. Default true. */
  covered?: boolean;
  /** The mixed-estate question, POSED BY THE CALLER per workflow/door — never a
   *  tuned default. `"cryptographic"` = this workflow requires a credential that
   *  proved itself (PKOC/Aliro/DESFire-class); a static-identifier read then steps
   *  up — a challenge, never a lockout, because the legacy estate is serviceable
   *  and modernization is the operator's pace to set. `"static_identifier"` = the
   *  operator explicitly accepts any known technology (the choice stays theirs).
   *  Unposed = the axis is not graded and never forecloses. */
  minimumCredentialTechnology?: CredentialTechnologyFloor;
  /** The recency question (intake row 26's "event timestamp"), POSED BY THE
   *  CALLER: how old may the graded entry event be and still stand as evidence
   *  of a CURRENT physical entry? Graded against `referenceTime` — no clock in
   *  any decision path. Unposed = freshness is not graded and never forecloses
   *  (every bridge deployed before this axis keeps its behavior). */
  maxEventAgeSeconds?: number;
  /** The caller's "now", a strict ISO-8601 UTC (Zulu) instant — required for
   *  the freshness axis to answer; a posed age bound without a readable
   *  reference is posed-but-unanswerable (unknown raises). */
  referenceTime?: string;
}

/** Freshness of the graded entry event against the caller-posed bound.
 *  Derived, never trusted; `unassessed` when no bound was posed. */
export type EventFreshness = "fresh" | "stale" | "unassessed" | "unknown";

const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function instantMs(v: string | undefined | null): number | null {
  if (typeof v !== "string" || !INSTANT_RE.test(v.trim())) return null;
  const ms = Date.parse(v.trim());
  return Number.isFinite(ms) ? ms : null;
}

/** Derive the entry event's freshness. Deterministic on three supplied inputs.
 *  Boundary: an event exactly at the bound is fresh (inclusive); a future-dated
 *  event relative to the reference is a contradiction → unknown, never fresh. */
export function deriveEventFreshness(
  observedAt: string | null,
  maxEventAgeSeconds: number | undefined,
  referenceTime: string | undefined,
): EventFreshness {
  if (maxEventAgeSeconds === undefined) return "unassessed";
  if (typeof maxEventAgeSeconds !== "number" || !Number.isFinite(maxEventAgeSeconds) || maxEventAgeSeconds <= 0) {
    return "unknown"; // a garbled pose is a question we cannot read — never answered optimistically
  }
  const observedMs = instantMs(observedAt);
  const referenceMs = instantMs(referenceTime);
  if (observedMs === null || referenceMs === null) return "unknown";
  if (observedMs > referenceMs) return "unknown"; // future-dated evidence is a contradiction
  return referenceMs - observedMs <= maxEventAgeSeconds * 1000 ? "fresh" : "stale";
}

interface Candidate {
  posture: PacsAccessPosture;
  action: PacsAccessAction;
  reason: PacsAccessReasonCode;
}

export function evaluatePacsAccess(
  pacs: NormalizedPacsAccess,
  options: EvaluatePacsAccessOptions = {},
): PacsAccessVerdict {
  const covered = options.covered ?? true;
  const floor = options.minimumCredentialTechnology;

  // The credential-technology grade — derived BEFORE the covered check so an
  // uncovered entry still answers the posed question honestly ("unknown", not a
  // quietly-dropped axis). Only a POSED floor is graded: a deployment that has not
  // asked this dimension to police its estate is `unassessed`, never foreclosed —
  // readers do not all have to disappear overnight.
  let credentialAssurance: CredentialAssurance;
  if (floor === undefined) {
    credentialAssurance = "unassessed";
  } else if (!covered || pacs.credentialTechnology === "unknown") {
    credentialAssurance = "unknown";
  } else {
    credentialAssurance = TECHNOLOGY_RANK[pacs.credentialTechnology] >= TECHNOLOGY_RANK[floor] ? "meets_floor" : "below_floor";
  }

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, credentialAssurance, deviceId: pacs.deviceId };

  // No PACS result at all → a gap. Raise the bar (never a confirmed physical entry).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", physicalAccessConfirmed: false };
  }

  const candidates: Candidate[] = [];

  // ── escalate: the person should not be transacting here at all ────────────────
  // A denial, a revoked credential, or a PACS holder ≠ the checked-out device holder
  // are LOCALLY-known facts (from the access log / rule / subject compare) that do
  // not need the bridge's liveness, so they are collected regardless of reachability.
  if (pacs.accessResult === "denied") {
    criticalFindings.push("access_denied");
    candidates.push({ posture: "access_denied", action: "escalate", reason: "ACCESS_DENIED" });
  }
  if (pacs.authorization === "revoked") {
    criticalFindings.push("credential_revoked");
    candidates.push({ posture: "credential_revoked", action: "escalate", reason: "CREDENTIAL_REVOKED" });
  }
  if (pacs.identityMatched === false) {
    criticalFindings.push("identity_mismatch");
    candidates.push({ posture: "identity_mismatch", action: "escalate", reason: "IDENTITY_MISMATCH" });
  }

  // ── restrict: a physical breach at the door — contain ─────────────────────────
  if (pacs.antipassback === "violation") {
    criticalFindings.push("antipassback_violation");
    candidates.push({ posture: "antipassback_breach", action: "restrict", reason: "ANTIPASSBACK_VIOLATION" });
  }
  if (pacs.doorState === "forced") {
    criticalFindings.push("door_forced");
    candidates.push({ posture: "door_forced", action: "restrict", reason: "DOOR_FORCED" });
  }

  // ── step_up: out of bounds, a held door, or anything unreadable ───────────────
  if (pacs.authorization === "out_of_schedule") {
    candidates.push({ posture: "out_of_bounds", action: "step_up", reason: "OUT_OF_SCHEDULE" });
  } else if (pacs.authorization === "out_of_zone") {
    candidates.push({ posture: "out_of_bounds", action: "step_up", reason: "OUT_OF_ZONE" });
  } else if (pacs.authorization === "unknown") {
    unknownSignals.push("authorization");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  if (pacs.doorState === "held_open") {
    candidates.push({ posture: "door_held", action: "step_up", reason: "DOOR_HELD_OPEN" });
  } else if (pacs.doorState === "unknown") {
    unknownSignals.push("door_state");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // A grant demands a POSITIVELY-confirmed GRANT result — a denied case escalated
  // above; an `unknown` access result is not proof of entry.
  if (pacs.accessResult === "unknown") {
    unknownSignals.push("access_result");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // Anti-passback must be positively OK — an unreadable state is not proof.
  if (pacs.antipassback === "unknown") {
    unknownSignals.push("antipassback");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // The credential type must be known — an unrecognized reader/credential is not a
  // positively-confirmed presentation.
  if (pacs.credentialType === "unknown") {
    unknownSignals.push("credential_type");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // The mixed-estate axis, graded ONLY when the caller posed a floor. A read below
  // the posed technology floor steps up — the remedy is a stronger challenge at the
  // decision point, deliberately NEVER restrict/deny: the legacy reader estate is
  // serviceable, and condemning it would turn a grading dimension into the rip-out
  // this axis exists to make unnecessary. A posed floor the PACS could not answer
  // ("what did the reader verify?" → unknown) raises the same bar — a silence is
  // not a cryptographic credential.
  if (credentialAssurance === "below_floor") {
    candidates.push({ posture: "credential_below_floor", action: "step_up", reason: "CREDENTIAL_BELOW_FLOOR" });
  } else if (credentialAssurance === "unknown") {
    unknownSignals.push("credential_technology");
    candidates.push({ posture: "unverified", action: "step_up", reason: "CREDENTIAL_TECHNOLOGY_UNKNOWN" });
  }

  // The recency axis (row 26's "event timestamp"), graded ONLY when the caller
  // posed an age bound. A confirmed badge-in that happened long before the posed
  // bound is not evidence of a CURRENT entry — the row-11 recency doctrine
  // applied to the door: a confirmed answer does not stay confirmed forever.
  const eventFreshness = deriveEventFreshness(pacs.observedAt, options.maxEventAgeSeconds, options.referenceTime);
  if (eventFreshness === "stale") {
    candidates.push({ posture: "stale_evidence", action: "step_up", reason: "EVENT_STALE" });
  } else if (eventFreshness === "unknown") {
    unknownSignals.push("event_time");
    candidates.push({ posture: "unverified", action: "step_up", reason: "EVENT_TIME_UNKNOWN" });
  }

  // Reader/controller health (row 26's "reader/controller health") — DISTINCT
  // from bridge reachability: the bridge can answer perfectly about a door whose
  // controller is offline, which means the entry evidence may be blind.
  // AFFIRMATIVE-ONLY by design: explicit offline steps up (the evidence plane
  // behind this entry cannot be current), explicit degraded is a visible
  // monitor, and an UNREPORTED health forecloses nothing — the axis
  // corroborates, and bridges deployed before it keep their behavior.
  if (pacs.controllerHealth === "offline") {
    candidates.push({ posture: "controller_unhealthy", action: "step_up", reason: "CONTROLLER_OFFLINE" });
  } else if (pacs.controllerHealth === "degraded") {
    candidates.push({ posture: "controller_unhealthy", action: "monitor", reason: "CONTROLLER_DEGRADED" });
  }

  // Identity match must be POSITIVELY confirmed. `false` escalated above; a null
  // (unreported) means we cannot confirm the holder is the checked-out device holder.
  if (pacs.identityMatched === null) {
    unknownSignals.push("identity_matched");
    candidates.push({ posture: "unverified", action: "step_up", reason: "PACS_STATE_UNKNOWN" });
  }

  // The grant demands POSITIVE verification: without an explicit bridgeReachable===true
  // the clean read may be stale/cached, so it never grants. (An explicit false is an
  // outage — the same.)
  if (pacs.bridgeReachable !== true) {
    if (pacs.bridgeReachable === null) unknownSignals.push("bridge_reachable");
    candidates.push({ posture: "unverified", action: "step_up", reason: "BRIDGE_UNREACHABLE" });
  }

  // Worst-concern-wins. The seed is the positively-confirmed physical-access grant;
  // it survives only if NO candidate was raised — i.e. a granted, authorized,
  // anti-passback-ok, secure-door, identity-matched entry on a known credential with
  // the bridge reachable.
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    { posture: "physical_access_ok", action: "none", reason: "PHYSICAL_ACCESS_GRANTED" },
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    physicalAccessConfirmed: winner.action === "none",
  };
}
