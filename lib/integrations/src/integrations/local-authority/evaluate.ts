import type {
  LocalAuthorityAction,
  LocalAuthorityPosture,
  LocalAuthorityReasonCode,
  LocalAuthorityVerdict,
  NormalizedLocalAuthority,
} from "./types";

/**
 * Pure, deterministic LOCAL-AUTHORITY evaluator. Grades ONE device's capacity to
 * act on its own authority, fail-closed, on the fabric's unified ladder.
 *
 * The precedence table below is ordered by SPECIFICITY, worst first, and every
 * clause tests an ENUMERATED value. Not one clause has the form `!== bad`, so a
 * spelling this design has never heard of satisfies none of them and falls
 * through to an unknown arm — which raises assurance rather than lowering it.
 *
 * Doctrine:
 *  - **awaiting first unlock** → `restrict`. The device restarted and nobody has
 *    entered the passcode, so the local vault, the network credential and the
 *    signed grant are on disk and unreadable. Every other surface looks healthy,
 *    which is exactly why this must be its own state and not folded into
 *    "unavailable": this one is fixed by a human walking over, and the response
 *    is to route them, not to declare the device broken.
 *  - **protected data otherwise unavailable** → `restrict`. Cannot read its own
 *    authority; cannot act on it.
 *  - **offline grant expired** → `restrict`. Capability must DECAY as the
 *    disconnected interval grows. A device that stays dark past the interval its
 *    own grant declares does not keep the authority it was issued.
 *  - **no human authenticated since boot** → `step_up`. There is a person-shaped
 *    hole in the chain and the natural response is to ask them to fill it.
 *  - **grant never issued** → `step_up`. Never had local authority; not a grant.
 *  - **no offline authority defined at all** → `alert`. Nothing is wrong with
 *    THIS session — the governance gap is upstream and operator-scale, which is
 *    what `alert` is for. Silence would let "our devices work offline safely"
 *    stay true-sounding while nothing bounds it.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. An honest hole, not a pass.
 *
 * WHY THE CLOCK CHECK COMES BEFORE THE STANDING CHECKS. `within_grant` is the
 * only standing that can contribute nothing, and it is a claim produced by
 * arithmetic. If the reference instant was one the device chose for itself, that
 * arithmetic proves nothing — rolling the clock back would otherwise renew the
 * grant forever, making CHANGING THE DATE a grant primitive, which is the harm
 * `signalgrid-core/continuity.ts` names in its own header. The normalizer
 * already refuses to derive a standing on untrusted time, so this clause is
 * belt-and-braces AND the place the reason code is emitted.
 */
export function evaluateLocalAuthority(
  normalized: NormalizedLocalAuthority,
): LocalAuthorityVerdict {
  const reasons: LocalAuthorityReasonCode[] = [];
  const decide = (
    posture: LocalAuthorityPosture,
    action: LocalAuthorityAction,
    mayActLocally: boolean,
    summary: string,
  ): LocalAuthorityVerdict => ({
    posture,
    action,
    reasonCodes: reasons,
    mayActLocally,
    summary,
  });

  // ── Not covered ────────────────────────────────────────────────────────────
  if (!normalized.covered) {
    reasons.push("LOCAL_AUTHORITY_NOT_COVERED");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "No local-authority record for this device — its offline standing is unmeasured, not fine.",
    );
  }

  // ── Worst first: the vault cannot be opened, so nothing in it can be relied on ─
  if (normalized.protectedData === "awaiting_first_unlock") {
    reasons.push("AWAITING_FIRST_UNLOCK");
    return decide(
      "awaiting_unlock",
      "restrict",
      false,
      "Restarted and not yet unlocked — the local vault, network credential and grant are unreadable.",
    );
  }

  if (normalized.protectedData === "unavailable") {
    reasons.push("PROTECTED_DATA_UNAVAILABLE");
    return decide(
      "authority_unverified",
      "restrict",
      false,
      "The protected local store cannot be read, so nothing it holds can be relied on.",
    );
  }

  if (normalized.protectedData === "unknown") {
    reasons.push("PROTECTED_DATA_STATE_UNKNOWN");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "Whether the protected local store is readable could not be established.",
    );
  }

  // ── Time the device chose for itself cannot establish that a grant is live ──
  if (normalized.clockConfidence !== "trusted") {
    reasons.push("LOCAL_CLOCK_UNTRUSTED");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "Grant expiry rests on a clock the device asserted about itself — that cannot prove a grant is current.",
    );
  }

  // ── The grant has run past the interval it declares for itself ─────────────
  if (normalized.standing === "expired") {
    reasons.push("OFFLINE_GRANT_EXPIRED");
    return decide(
      "authority_lapsed",
      "restrict",
      false,
      "Past the maximum disconnected interval this grant itself declares — authority has decayed.",
    );
  }

  if (normalized.standing === "never_issued") {
    reasons.push("OFFLINE_GRANT_NEVER_ISSUED");
    return decide(
      "authority_never_established",
      "step_up",
      false,
      "No offline grant has ever been minted for this device.",
    );
  }

  if (normalized.standing === "unknown") {
    reasons.push("GRANT_STANDING_UNKNOWN");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "Offline grant standing could not be derived — unknown raises, it does not grant.",
    );
  }

  // ── Nobody has authenticated on this device since it booted ────────────────
  if (normalized.localAuth === "not_verified") {
    reasons.push("LOCAL_USER_NOT_AUTHENTICATED");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "No human has authenticated on this device since it booted.",
    );
  }

  if (normalized.localAuth === "unknown") {
    reasons.push("LOCAL_AUTH_STATE_UNKNOWN");
    return decide(
      "authority_unverified",
      "step_up",
      false,
      "Whether anyone authenticated locally since boot could not be established.",
    );
  }

  // ── Readable, authenticated, on trusted time — and nobody bounded it ───────
  if (normalized.standing === "no_grant_policy") {
    reasons.push("NO_OFFLINE_GRANT_POLICY");
    return decide(
      "authority_ungoverned",
      "alert",
      false,
      "No offline authority is defined for this device — how long it may act alone was never bounded.",
    );
  }

  // ── standing === "within_grant" from here ──────────────────────────────────
  reasons.push("LOCAL_AUTHORITY_CURRENT");
  return decide(
    "local_authority_current",
    "none",
    true,
    "Vault readable, a human authenticated since boot, and an unexpired grant on trusted time.",
  );
}
