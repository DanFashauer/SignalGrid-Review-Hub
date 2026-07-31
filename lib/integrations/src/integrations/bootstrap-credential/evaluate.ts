import {
  type BootstrapCredentialAction,
  type BootstrapCredentialPosture,
  type BootstrapCredentialReasonCode,
  type BootstrapCredentialVerdict,
  type NormalizedBootstrapCredential,
  type WorkflowFit,
} from "./types";

/**
 * Pure, deterministic BOOTSTRAP-CREDENTIAL evaluator. Grades ONE session's
 * credential context fail-closed, on the fabric's unified ladder.
 *
 * Doctrine (the row-17 rules, each made mechanical):
 *  - **bootstrap beyond enrollment scope** → `restrict`. "The pass can access
 *    only authenticator enrollment or recovery — not clinical data." This is a
 *    hard scope rule, not a challenge: a step-up would let the very credential
 *    under suspicion answer for itself.
 *  - **workflow unposed under bootstrap** → `step_up`. The caller did not say
 *    what the session is doing; the default posture of a bootstrap session is
 *    enrollment-only, and silence never widens it.
 *  - **expired in use** → `restrict`. The pass outlived its own expiry and the
 *    session is still alive — revocation did not propagate.
 *  - **minted broad / location-sole issuance** → `alert`. Issuance defects are
 *    operator-scale: the PASS is wrong, not just this session, and someone
 *    upstream must see it.
 *  - **reusable / unbounded lifetime** → `step_up`. Weaker than the mechanism
 *    promises ("one-time, shortest practical") — visible, challenged, never
 *    silently accepted.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. A session the IdP has no credential record
 *    for is an honest hole, not a pass.
 *
 * The clean state (`none`) is a STANDING strong credential — and only that. A
 * bootstrap pass used exactly as intended still reads `monitor`: used
 * perfectly, it is a temporary elevated state, and `credentialContextConfirmed`
 * is true ONLY for standing. Not one grant clause has the form `!== bad`, so a
 * value this design has never heard of satisfies none of them.
 *
 * This dimension never grades the STRENGTH of a standing method (that is
 * passkey-assurance / platform-sso), never says who holds the device (custody),
 * and never lowers what another dimension raised.
 */

const ACTION_SEVERITY: Record<BootstrapCredentialAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateBootstrapCredentialOptions {
  /** What class of workflow the session is performing — POSED by the caller.
   *  Default "unposed": carried, visible, and fail-closed under bootstrap. */
  workflowFit?: WorkflowFit;
  /** False when the IdP returned no credential record for this session. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: BootstrapCredentialPosture;
  action: BootstrapCredentialAction;
  reason: BootstrapCredentialReasonCode;
}

export function evaluateBootstrapCredential(
  report: NormalizedBootstrapCredential,
  opts: EvaluateBootstrapCredentialOptions = {},
): BootstrapCredentialVerdict {
  const covered = opts.covered ?? true;
  const workflowFit: WorkflowFit = opts.workflowFit ?? "unposed";
  const base = { subjectRef: report.subjectRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "credential_unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      criticalFindings,
      unknownSignals: ["idp_credential_record"],
      credentialContextConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];

  // Track the unknown axes for evidence (they also foreclose the clean state).
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.credentialClass === "unknown") unknownSignals.push("credential_class");

  // Defence in depth: a report we could not fully parse is never clean.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "credential_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  if (report.credentialClass === "unknown") {
    candidates.push({ posture: "credential_unverified", action: "step_up", reason: "CREDENTIAL_CLASS_UNKNOWN" });
  }

  if (report.credentialClass === "bootstrap") {
    // ── the scope rule: enrollment/recovery only ────────────────────────────────
    if (workflowFit === "operational") {
      criticalFindings.push("bootstrap_on_operational_workflow");
      candidates.push({ posture: "bootstrap_out_of_scope", action: "restrict", reason: "BOOTSTRAP_BEYOND_ENROLLMENT_SCOPE" });
    } else if (workflowFit === "unposed") {
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "BOOTSTRAP_WORKFLOW_UNPOSED" });
    }

    // ── lifetime: derived, never believed ───────────────────────────────────────
    if (report.lifetime === "expired") {
      criticalFindings.push("expired_bootstrap_in_use");
      candidates.push({ posture: "bootstrap_expired", action: "restrict", reason: "BOOTSTRAP_EXPIRED_IN_USE" });
    } else if (report.lifetime === "unbounded") {
      criticalFindings.push("no_expiry_on_bootstrap_pass");
      candidates.push({ posture: "bootstrap_weakened", action: "step_up", reason: "BOOTSTRAP_UNBOUNDED_LIFETIME" });
    } else if (report.lifetime === "unknown") {
      unknownSignals.push("lifetime");
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "BOOTSTRAP_LIFETIME_UNKNOWN" });
    }

    // ── issuance defects: the PASS is wrong, not just this session ──────────────
    if (report.scope === "broad") {
      criticalFindings.push("bootstrap_minted_broad");
      candidates.push({ posture: "bootstrap_issuance_defect", action: "alert", reason: "BOOTSTRAP_MINTED_BROAD" });
    } else if (report.scope === "unknown") {
      unknownSignals.push("scope");
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "SCOPE_UNKNOWN" });
    }
    if (report.issuanceVerification === "location_only") {
      criticalFindings.push("location_sole_issuance_factor");
      candidates.push({ posture: "bootstrap_issuance_defect", action: "alert", reason: "LOCATION_SOLE_ISSUANCE_FACTOR" });
    } else if (report.issuanceVerification === "unknown") {
      unknownSignals.push("issuance_verification");
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "ISSUANCE_UNKNOWN" });
    }

    // ── one-time discipline ─────────────────────────────────────────────────────
    if (report.oneTime === "reusable") {
      criticalFindings.push("reusable_bootstrap_pass");
      candidates.push({ posture: "bootstrap_weakened", action: "step_up", reason: "BOOTSTRAP_NOT_ONE_TIME" });
    } else if (report.oneTime === "unknown") {
      unknownSignals.push("one_time");
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "ONE_TIME_UNKNOWN" });
    }

    // A bootstrap pass used exactly as intended: enrollment workflow, alive,
    // one-time, enrollment-only scope, verified issuance. Visible, never
    // silent. The conjuncts here are genuinely inert to single mutation: every
    // failure state of each conjunct already pushed a raising candidate above
    // that outranks this monitor rung, so weakening one adds only a losing
    // candidate — they are kept because the rung must state its OWN terms.
    const coherentBootstrap =
      report.reportIntegrity === "clean" &&
      workflowFit === "enrollment_recovery" &&
      report.lifetime === "within_lifetime" &&
      report.scope === "enrollment_only" &&
      report.oneTime === "one_time" &&
      (report.issuanceVerification === "help_desk" ||
        report.issuanceVerification === "manager" ||
        report.issuanceVerification === "in_person" ||
        report.issuanceVerification === "piv_cac");
    if (coherentBootstrap) {
      candidates.push({ posture: "bootstrap_in_scope", action: "monitor", reason: "BOOTSTRAP_IN_SCOPE" });
    }

    // Backstop: a bootstrap session must NEVER fall through to the standing
    // seed. Deliberately redundant defence-in-depth with its OWN reason — it
    // never fires today (every non-coherent state above pushes a candidate),
    // and the distinct reason means a weakened branch shows up as UNGRADED in
    // the record instead of impersonating the branch it replaced.
    if (candidates.length === 0) {
      candidates.push({ posture: "credential_unverified", action: "step_up", reason: "BOOTSTRAP_UNGRADED" });
    }
  }

  // Worst-concern-wins. The clean state survives only when nothing fired —
  // which, by construction, is only the standing-credential path.
  const seed: Candidate = {
    posture: "standing_credential",
    action: "none",
    reason: "STANDING_CREDENTIAL",
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
    criticalFindings,
    unknownSignals,
    credentialContextConfirmed: winner.action === "none" && report.credentialClass === "standing",
  };
}
