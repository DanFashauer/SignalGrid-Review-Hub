import type {
  CredentialRotationAction,
  CredentialRotationPosture,
  CredentialRotationReasonCode,
  CredentialRotationVerdict,
  NormalizedCredentialRotation,
} from "./types";

/**
 * Pure, deterministic CREDENTIAL-ROTATION evaluator. Grades ONE credential's
 * rotation context fail-closed, on the fabric's unified ladder.
 *
 * The precedence table below is ordered by SPECIFICITY, worst first, and every
 * clause tests an ENUMERATED value. Not one grant clause has the form `!== bad`,
 * so a spelling this design has never heard of satisfies none of them and falls
 * through to the unknown arm — which raises assurance rather than lowering it.
 *
 * Doctrine:
 *  - **never rotated, copied out of the vault** → `restrict`. The two worst axes
 *    together: a secret that has never been rotated AND now exists in places the
 *    owning system cannot reach. Rotating it is no longer an operation, it is a
 *    migration, and until someone does it every copy is a standing key.
 *  - **never rotated** → `step_up`. Minted and never touched. Distinct from a
 *    missed cycle because it is a different failure and a reviewer should be
 *    able to count them separately.
 *  - **overdue** → `step_up`. The policy declared a maximum age and the
 *    credential is past it. The policy's own number, not ours.
 *  - **no rotation policy at all** → `alert`. Nothing here is wrong with THIS
 *    session — the governance gap is upstream and operator-scale, which is what
 *    `alert` is for. Silence would let "we rotate our secrets" stay true-sounding
 *    while nothing enforces it.
 *  - **copied out of the vault, otherwise current** → `monitor`. Visible, not
 *    challenged: a current secret in a config file is a real weakening but not
 *    grounds to interrupt the actor holding it.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. A subject the secrets manager has no record
 *    for is an honest hole, not a pass.
 *
 * THE SHORT-LIVED EXEMPTION IS THE DANGEROUS CLAUSE, and it is written to be
 * hard to reach by accident: it fires only on the TRUSTED, enumerated value
 * `short_lived`. An unknown kind does not get it. That matters because it is the
 * one clause that ends the evaluation early with `none` — exactly the shape that
 * turns into an unearned affirmative if it can be reached by a value nobody
 * classified.
 */
export function evaluateCredentialRotation(
  normalized: NormalizedCredentialRotation,
): CredentialRotationVerdict {
  const reasons: CredentialRotationReasonCode[] = [];
  const decide = (
    posture: CredentialRotationPosture,
    action: CredentialRotationAction,
    rotationConfirmed: boolean,
    summary: string,
  ): CredentialRotationVerdict => ({
    posture,
    action,
    reasonCodes: reasons,
    rotationConfirmed,
    summary,
  });

  // ── Not covered ────────────────────────────────────────────────────────────
  if (!normalized.covered) {
    reasons.push("CREDENTIAL_NOT_COVERED");
    return decide(
      "rotation_unverified",
      "step_up",
      false,
      "No secrets-manager record for this subject — rotation state is unknown, not fine.",
    );
  }

  // ── The exemption, reachable ONLY by the trusted enumerated value ──────────
  if (normalized.kind === "short_lived") {
    reasons.push("ROTATION_NOT_APPLICABLE_SHORT_LIVED");
    return decide(
      "rotation_not_applicable",
      "none",
      true,
      "Short-lived credential — minted per session, so rotation age is not the question.",
    );
  }

  // ── Unknown kind: never coerced into the exemption above ───────────────────
  if (normalized.kind === "unknown") {
    reasons.push("CREDENTIAL_KIND_UNKNOWN");
    return decide(
      "rotation_unverified",
      "step_up",
      false,
      "Credential kind unrecognised — it does not inherit the short-lived exemption.",
    );
  }

  const copiedOut = normalized.custody === "distributed_copy";

  // ── Worst first: never rotated AND copied out of the vault ────────────────
  if (normalized.standing === "never_rotated" && copiedOut) {
    reasons.push("CREDENTIAL_NEVER_ROTATED", "CREDENTIAL_COPIED_OUT_OF_VAULT");
    return decide(
      "rotation_never_performed",
      "restrict",
      false,
      "Never rotated and copied outside the vault — every copy is a standing key.",
    );
  }

  if (normalized.standing === "never_rotated") {
    reasons.push("CREDENTIAL_NEVER_ROTATED");
    return decide(
      "rotation_never_performed",
      "step_up",
      false,
      "This credential has never been rotated since it was created.",
    );
  }

  if (normalized.standing === "overdue") {
    reasons.push("CREDENTIAL_ROTATION_OVERDUE");
    if (copiedOut) reasons.push("CREDENTIAL_COPIED_OUT_OF_VAULT");
    return decide(
      "rotation_overdue",
      copiedOut ? "restrict" : "step_up",
      false,
      copiedOut
        ? "Past its declared maximum age AND copied outside the vault."
        : "Past the maximum age its own rotation policy declares.",
    );
  }

  if (normalized.standing === "no_policy") {
    reasons.push("CREDENTIAL_NO_ROTATION_POLICY");
    return decide(
      "rotation_ungoverned",
      "alert",
      false,
      "No rotation policy exists for this credential — the gap is upstream of this session.",
    );
  }

  if (normalized.standing === "unknown") {
    reasons.push("ROTATION_STANDING_UNKNOWN");
    return decide(
      "rotation_unverified",
      "step_up",
      false,
      "Rotation standing could not be derived — unknown raises, it does not grant.",
    );
  }

  // ── standing === "within_policy" from here ─────────────────────────────────
  if (normalized.custody === "unknown") {
    reasons.push("CREDENTIAL_CUSTODY_UNKNOWN");
    return decide(
      "rotation_unverified",
      "step_up",
      false,
      "Within policy, but where the secret actually lives is unknown.",
    );
  }

  if (copiedOut) {
    reasons.push("ROTATION_WITHIN_POLICY", "CREDENTIAL_COPIED_OUT_OF_VAULT");
    return decide(
      "rotation_current",
      "monitor",
      false,
      "Within policy, but copied outside the vault — rotating it is now a migration.",
    );
  }

  reasons.push("ROTATION_WITHIN_POLICY");
  return decide(
    "rotation_current",
    "none",
    true,
    "Within its rotation policy and held in the managed vault.",
  );
}
