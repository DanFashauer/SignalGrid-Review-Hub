import {
  type NormalizedPasskey,
  type PasskeyIdentityVerdict,
  type PasskeyAction,
  type PasskeyAssuranceGrade,
  type PasskeyCustody,
  type PasskeyPosture,
  type PasskeyReasonCode,
  type PasskeyVerdict,
} from "./types";

/**
 * Pure, deterministic PASSKEY-ASSURANCE evaluator. Grades what one registered
 * credential is actually worth, on the fabric's unified ladder, fail-closed.
 *
 * Doctrine ("a passkey is a passkey" is the misconception this exists to correct):
 *  - **Attestation is the tier boundary, not sync-ability.** An unattested
 *    device-bound passkey has no more device provenance than a synced one, and is
 *    graded the same (`step_up`). Grading by credential TYPE alone would reproduce
 *    the misconception one tier over: it would grant to a device-bound credential
 *    whose provenance was never verified.
 *  - **Synced custody is unknowable by construction → it FORECLOSES.** No
 *    administrator can query where a synced passkey has been synchronized. That is
 *    an axis with no reading available, not a weak reading. Under this fabric's
 *    grant discipline an unknown raises and never grants, so a synced credential
 *    cannot reach `none` no matter how healthy every other axis is.
 *  - **User verification decides whether it is MFA at all.** Registered with UV
 *    discouraged, the credential is exercisable on possession alone: single-factor
 *    behind a phishing-resistant label. That is an AFFIRMATIVE bad fact, so it
 *    restricts rather than merely raising — the same rung an OS below its floor
 *    gets, because in both cases something known-false is being relied upon.
 *  - **A claim that cannot be in force is config drift.** Entra excludes synced
 *    passkeys when attestation is enforced. A profile claiming `enforced` while
 *    holding a synced credential is asserting a control the platform is not
 *    applying → `alert`, the same shape as platform-sso's policy/method
 *    contradiction. The tenant believes it has provenance it does not have.
 *  - **Recovery is graded, not assumed.** No second credential registered is a
 *    `monitor` note plus `recoveryRisk` — one lost device from a lockout. It is an
 *    operational exposure, not a trust downgrade of the holder.
 *
 * The grant (`none`) requires POSITIVE CONFIRMATION of every axis: clean parse +
 * registered + security key or device-bound authenticator + attestation verified +
 * user verification required + a registered backup + a readable attestation policy.
 * Backup is in that list on purpose. It is not a trust judgement about the holder —
 * `none` means "nothing to say about this credential", and a holder one lost device
 * from a lockout is something to say. It lifts to `monitor`, the lowest non-grant
 * rung, which is the difference between "flagged" and "distrusted".
 *
 * `covered=false` = no passkey report came back for this identity → step_up.
 */

const ACTION_SEVERITY: Record<PasskeyAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluatePasskeyOptions {
  /** False when no passkey report was returned for this identity. Default true. */
  covered?: boolean;
}

export interface EvaluateIdentityPasskeysOptions extends EvaluatePasskeyOptions {
  /** How many credentials the IdP says this identity holds, when it can say.
   *  Supplying it turns completeness from an inference into a check: a set that
   *  does not match the authoritative count fails closed. */
  expectedCredentialCount?: number;
}

interface Candidate {
  posture: PasskeyPosture;
  action: PasskeyAction;
  reason: PasskeyReasonCode;
}

export function evaluatePasskey(
  report: NormalizedPasskey,
  opts: EvaluatePasskeyOptions = {},
): PasskeyVerdict {
  const covered = opts.covered ?? true;
  const base = { identityRef: report.identityRef, credentialRef: report.credentialRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      assurance: "unknown",
      custody: "unknown",
      recoveryRisk: false,
      criticalFindings,
      unknownSignals: ["coverage"],
      passkeyConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];
  let recoveryRisk = false;

  const deviceHeld =
    report.credentialType === "security_key" || report.credentialType === "device_bound_authenticator";

  // Custody is DERIVED, never read from the wire. A synced credential's copies
  // cannot be enumerated by anyone, so the honest value is `unknowable_devices`
  // and the report is not entitled to overrule it.
  const custody: PasskeyCustody =
    report.reportIntegrity === "clean" && report.registration === "registered"
      ? deviceHeld
        ? "single_device"
        : report.credentialType === "synced"
          ? "unknowable_devices"
          : "unknown"
      : "unknown";

  // What the credential is worth. Attestation gates the top grade; UV gates
  // whether it counts as more than possession at all.
  const assurance: PasskeyAssuranceGrade =
    report.reportIntegrity === "clean" && report.registration === "registered"
      ? report.userVerification === "discouraged"
        ? "possession_only"
        : report.userVerification === "required"
          ? deviceHeld && report.attestation === "verified"
            ? "attested_phishing_resistant"
            : report.credentialType === "none" || report.credentialType === "unknown"
              ? "unknown"
              : "unattested_phishing_resistant"
          : "unknown"
      : "unknown";

  // Track unknown axes for evidence (they also foreclose the grant below).
  // A verdict that cannot name its subject cannot be bound to the credential it
  // graded, so the aggregator's "every usable credential was covered" claim would
  // rest on nothing (review finding). An unnamed credential therefore raises.
  if (report.credentialRef.length === 0) {
    unknownSignals.push("credential_ref");
    candidates.push({ posture: "unverified", action: "step_up", reason: "CREDENTIAL_REF_MISSING" });
  }
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.registration === "unknown") unknownSignals.push("registration");
  if (report.credentialType === "none" || report.credentialType === "unknown") {
    unknownSignals.push("credential_type");
  }
  if (report.userVerification === "unknown") unknownSignals.push("user_verification");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── registration ────────────────────────────────────────────────────────────────
  if (report.registration === "none") {
    candidates.push({ posture: "not_registered", action: "step_up", reason: "NOT_REGISTERED" });
  } else if (report.registration === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REGISTRATION_UNKNOWN" });
  }

  // ── user verification: is this MFA at all? ──────────────────────────────────────
  // Checked before attestation because it is the more fundamental claim. A
  // possession-only credential is single-factor whatever its provenance.
  if (report.userVerification === "discouraged") {
    criticalFindings.push("user_verification_discouraged");
    candidates.push({ posture: "possession_only", action: "restrict", reason: "USER_VERIFICATION_DISCOURAGED" });
  } else if (report.userVerification === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "USER_VERIFICATION_UNKNOWN" });
  }

  // ── credential type + attestation: the actual tier boundary ────────────────────
  if (report.credentialType === "synced") {
    // Not "weaker" — UNKNOWABLE. Nobody can enumerate where this key lives, so
    // device custody can never be positively confirmed for it.
    unknownSignals.push("device_custody");
    candidates.push({ posture: "synced_custody_unknowable", action: "step_up", reason: "SYNCED_CUSTODY_UNKNOWABLE" });
  } else if (report.credentialType === "none" || report.credentialType === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "CREDENTIAL_TYPE_UNKNOWN" });
  }

  // Attestation is graded for every credential type. For a synced credential it is
  // absent by construction and the branch above already raised; asserting it here
  // too is deliberate, because the REASON a synced credential cannot grant is not
  // only its custody — it also carries no device provenance.
  if (report.attestation === "not_provided") {
    criticalFindings.push("attestation_not_provided");
    candidates.push({ posture: "unattested_credential", action: "step_up", reason: "ATTESTATION_NOT_PROVIDED" });
  } else if (report.attestation === "unknown") {
    unknownSignals.push("attestation");
    candidates.push({ posture: "unverified", action: "step_up", reason: "ATTESTATION_UNKNOWN" });
  }

  // ── attestation policy: claim vs reality ────────────────────────────────────────
  if (report.attestationPolicy === "enforced" && report.credentialType === "synced") {
    // The platform excludes synced passkeys when attestation is enforced, so a
    // synced credential standing under an "enforced" profile means the claim is not
    // being applied. The tenant believes it has provenance it does not have.
    // Asserted ONLY for a KNOWN synced credential: with the type unreadable we
    // cannot affirmatively claim a contradiction, and the type-unknown step_up
    // above already covers that state without fabricating a finding.
    criticalFindings.push("attestation_claim_unenforceable");
    candidates.push({
      posture: "attestation_claim_unenforceable",
      action: "alert",
      reason: "ATTESTATION_CLAIM_UNENFORCEABLE",
    });
  } else if (report.attestationPolicy === "unknown") {
    unknownSignals.push("attestation_policy");
    candidates.push({ posture: "unverified", action: "step_up", reason: "ATTESTATION_POLICY_UNKNOWN" });
  }

  // ── recovery ────────────────────────────────────────────────────────────────────
  if (report.backup === "none") {
    recoveryRisk = true;
    criticalFindings.push("backup_missing");
    candidates.push({ posture: "recovery_exposed", action: "monitor", reason: "BACKUP_MISSING" });
  } else if (report.backup === "unknown") {
    unknownSignals.push("backup");
    candidates.push({ posture: "recovery_exposed", action: "monitor", reason: "BACKUP_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on parse, registration, credential
  // type, attestation, and user verification. The branches above already push a
  // raising candidate for every non-confirmed state, so today this never fires —
  // but if any branch were later weakened so a non-confirmed state produced an
  // empty candidate list, this backstop forces a step_up rather than letting the
  // seed grant survive.
  const positivelyConfirmed =
    report.credentialRef.length > 0 &&
    report.reportIntegrity === "clean" &&
    report.registration === "registered" &&
    deviceHeld &&
    report.attestation === "verified" &&
    report.userVerification === "required";
  if (!positivelyConfirmed && candidates.length === 0) {
    // A DISTINCT reason code, not a borrowed one. Reusing a real branch's code here
    // made the backstop indistinguishable from that branch — deleting the branch let
    // the backstop answer in its place with an identical verdict, and the mutation
    // guard caught exactly that as a survivor. It also matters at runtime: a
    // backstop firing means a branch that should have spoken did not, which an
    // auditor needs to be able to see rather than have disguised as normal routing.
    candidates.push({ posture: "unverified", action: "step_up", reason: "GRANT_BACKSTOP" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired.
  const seed: Candidate = {
    posture: "attested_device_bound",
    action: "none",
    reason: "ATTESTED_DEVICE_BOUND",
  };
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    seed,
  );

  return {
    ...base,
    posture: winner.posture,
    reasonCode: winner.reason,
    recommendedAction: winner.action,
    assurance,
    custody,
    recoveryRisk,
    criticalFindings,
    unknownSignals,
    passkeyConfirmed: winner.action === "none",
  };
}

/**
 * The IDENTITY-level verdict — worst-wins across every registered credential.
 *
 * `evaluatePasskey` answers for ONE credential, and that is the honest scope of a
 * single report. But an identity is only as strong as its weakest usable
 * authentication path: an attacker presented with an attested security key and a
 * synced backup uses the synced one. A per-credential `none` read as an identity
 * answer is therefore a fail-open, and it was one (review finding) — the previous
 * shape recorded only THAT a backup existed, discarding its type, attestation and
 * user-verification posture, so an attested primary alongside a synced backup
 * granted outright.
 *
 * An empty credential set is NOT a grant. No credentials is an absence of evidence,
 * and this fabric does not read absence as confirmation. Neither is an INCOMPLETE
 * set: worst-wins is only sound over every usable credential, so the set must be
 * evidently whole before it can confirm — see the completeness checks below.
 */
export function evaluateIdentityPasskeys(
  reports: readonly NormalizedPasskey[],
  opts: EvaluateIdentityPasskeysOptions = {},
): PasskeyIdentityVerdict {
  const credentials = reports.map((r) => evaluatePasskey(r, opts));
  const identityRef = reports[0]?.identityRef ?? "";

  // An upstream batching or grouping error must not become an unsafe allow (review
  // finding). Taking the first identityRef and grading the rest would let a set that
  // mixes identities — or one whose identity is unnamed — report identityConfirmed
  // for whichever identity happened to sort first, over someone else's credentials.
  const identityConsistent =
    reports.length > 0 && identityRef.length > 0 && reports.every((r) => r.identityRef === identityRef);
  if (reports.length > 0 && !identityConsistent) {
    return {
      identityRef,
      recommendedAction: "step_up",
      weakestCredentialRef: "",
      reasonCode: "IDENTITY_SET_INCONSISTENT",
      credentials,
      identityConfirmed: false,
    };
  }

  if (credentials.length === 0) {
    return {
      identityRef,
      recommendedAction: "step_up",
      weakestCredentialRef: "",
      reasonCode: "NOT_COVERED",
      credentials,
      identityConfirmed: false,
    };
  }

  // ── COMPLETENESS: the set must be evidently whole before it can confirm ───────
  // Worst-wins is only sound over EVERY usable credential. Nothing so far
  // established that the caller supplied them all, and the connector fetches one
  // credential per call, so it structurally cannot (review finding). Three ways the
  // set can be shown incomplete — each fails closed rather than confirming over a
  // set that was never whole:
  //
  //   1. Duplicate credential refs: the same credential counted twice looks like
  //      breadth while covering less than it appears to.
  //   2. A report asserts `backup: "registered"` — i.e. a SECOND authentication path
  //      exists — while the set holds fewer than two distinct credentials. The set
  //      contradicts its own contents.
  //   3. An authoritative expected count was supplied and does not match.
  const distinctRefs = new Set(reports.map((r) => r.credentialRef));
  const hasDuplicateRefs = distinctRefs.size !== reports.length;
  const claimsBackup = reports.some((r) => r.backup === "registered");
  const backupUnaccounted = claimsBackup && distinctRefs.size < 2;
  const countMismatch =
    typeof opts.expectedCredentialCount === "number" && distinctRefs.size !== opts.expectedCredentialCount;

  if (hasDuplicateRefs || backupUnaccounted || countMismatch) {
    return {
      identityRef,
      recommendedAction: "step_up",
      weakestCredentialRef: "",
      reasonCode: "CREDENTIAL_SET_INCOMPLETE",
      credentials,
      identityConfirmed: false,
    };
  }

  const weakest = credentials.reduce((worst, c) =>
    ACTION_SEVERITY[c.recommendedAction] > ACTION_SEVERITY[worst.recommendedAction] ? c : worst,
  );

  return {
    identityRef,
    recommendedAction: weakest.recommendedAction,
    weakestCredentialRef: weakest.credentialRef,
    reasonCode: weakest.reasonCode,
    credentials,
    // Every credential must grant. `weakest` already encodes that, but stating it
    // as an explicit universal keeps the intent legible if the reducer changes.
    identityConfirmed: credentials.every((c) => c.recommendedAction === "none"),
  };
}
