import {
  type PlatformSsoAction,
  type PlatformSsoPosture,
  type PlatformSsoReasonCode,
  type PlatformSsoVerdict,
  type NormalizedPlatformSso,
  type PssoAssurance,
} from "./types";

/**
 * Pure, deterministic PLATFORM-SSO evaluator. Grades one Mac's Platform SSO
 * registration/method/policy posture on the fabric's unified ladder, fail-closed.
 *
 * Doctrine ("Platform SSO is a set of choices, not one passwordless-MFA switch"):
 *  - **The method decides the credential's worth.** Only a USER-registered Secure
 *    Enclave key or smart card on a clean report is `phishing_resistant`. The
 *    Password method is `password_grade` — legitimate, org-chosen (it is the only
 *    method compatible with login policies), and a `monitor` note, never a grant.
 *    Web-based flows are macOS 27 PRE-RELEASE material: a preview never grants
 *    (`step_up`) until it ships and the tenant's IdP supports it.
 *  - **A claimed policy that cannot be in force is config drift.** Require
 *    Authentication is only compatible with the Password method — claiming it on
 *    any other method → `alert` (POLICY_INCOMPATIBLE_WITH_METHOD). The tenant
 *    believes a control is enforced that the OS is not enforcing.
 *  - **A policy genuinely in force carries lockout exposure.** With the Password
 *    method + Require Authentication: an expired or never-configured offline grace
 *    period, or a missing break-glass exemption, can strand the holder of an
 *    offline Mac → `alert` + `lockoutRisk` (operational attention, not a trust
 *    downgrade of the user). Unknown grace/break-glass state → `step_up`.
 *  - **Unknown raises, never grants** — registration, method, and policy state
 *    must all be positively confirmed.
 *
 * The grant (`none`) requires: clean parse + user-registered + Secure Enclave key
 * or smart card + NO login policy claimed. Grace and break-glass are deliberately
 * moot when no policy is claimed (they only exist in service of the policy) — the
 * enumeration pins exactly that granting set. When a policy IS claimed, no state
 * grants: either it contradicts the method (alert) or it is password-grade by
 * construction (the only compatible method), which is monitor at best.
 *
 * `covered=false` = no Platform SSO report came back for this Mac → step_up.
 */

const ACTION_SEVERITY: Record<PlatformSsoAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluatePlatformSsoOptions {
  /** False when no Platform SSO report was returned for this Mac. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: PlatformSsoPosture;
  action: PlatformSsoAction;
  reason: PlatformSsoReasonCode;
}

export function evaluatePlatformSso(
  report: NormalizedPlatformSso,
  opts: EvaluatePlatformSsoOptions = {},
): PlatformSsoVerdict {
  const covered = opts.covered ?? true;
  const base = { deviceRef: report.deviceRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  if (!covered) {
    return {
      ...base,
      posture: "unverified",
      reasonCode: "NOT_COVERED",
      recommendedAction: "step_up",
      assurance: "unknown",
      lockoutRisk: false,
      criticalFindings,
      unknownSignals: ["coverage"],
      ssoConfirmed: false,
    };
  }

  const candidates: Candidate[] = [];
  let lockoutRisk = false;

  // What the credential is actually worth — vendor "passwordless" labels
  // notwithstanding. Method decides; user registration and a clean parse are
  // preconditions for asserting anything.
  const hardwareBacked = report.method === "secure_enclave_key" || report.method === "smart_card";
  const assurance: PssoAssurance =
    report.reportIntegrity === "clean" && report.registration === "user"
      ? hardwareBacked
        ? "phishing_resistant"
        : report.method === "password_sync"
          ? "password_grade"
          : "unknown"
      : "unknown";

  // Track unknown axes for evidence (they also foreclose the grant below). Grace
  // and break-glass are only tracked while a policy is genuinely in force — they
  // exist in service of the policy and are moot without one.
  if (report.reportIntegrity !== "clean") unknownSignals.push("report_integrity");
  if (report.registration === "unknown") unknownSignals.push("registration");
  if (report.method === "none" || report.method === "unknown") unknownSignals.push("method");
  if (report.loginPolicy === "unknown") unknownSignals.push("login_policy");

  // Defence in depth: a report we could not fully parse is never a grant.
  if (report.reportIntegrity !== "clean") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── registration ────────────────────────────────────────────────────────────────
  if (report.registration === "none") {
    candidates.push({ posture: "not_registered", action: "step_up", reason: "NOT_REGISTERED" });
  } else if (report.registration === "device_only") {
    candidates.push({ posture: "registration_partial", action: "step_up", reason: "USER_NOT_REGISTERED" });
  } else if (report.registration === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "REGISTRATION_UNKNOWN" });
  }

  // ── method ──────────────────────────────────────────────────────────────────────
  if (report.method === "password_sync") {
    // Legitimate and org-chosen — the only policy-compatible method — but the
    // credential is a synced password. A note, never a grant.
    candidates.push({ posture: "password_grade", action: "monitor", reason: "PASSWORD_GRADE_METHOD" });
  } else if (report.method === "web_based") {
    // macOS 27 pre-release material. A preview is a preview.
    candidates.push({ posture: "preview_method", action: "step_up", reason: "PREVIEW_METHOD_NEVER_GRANTS" });
  } else if (report.method === "none" || report.method === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "METHOD_UNKNOWN" });
  }

  // ── login policy: the compatibility detail that matters ─────────────────────────
  if (report.loginPolicy === "unknown") {
    candidates.push({ posture: "unverified", action: "step_up", reason: "POLICY_UNKNOWN" });
  } else if (report.loginPolicy === "required") {
    if (report.method === "secure_enclave_key" || report.method === "smart_card" || report.method === "web_based") {
      // The incompatibility is asserted only for a KNOWN non-Password method
      // (review finding): with the method UNREADABLE we cannot affirmatively
      // claim the policy contradicts it — the method-unknown step_up above
      // already covers that state without fabricating a finding.
      // Require Authentication is ONLY compatible with the Password method. The
      // tenant believes a control is enforced that the OS is not enforcing —
      // config drift, and the claimed protection is absent. NOT a lockout risk:
      // an unenforceable policy cannot strand anyone.
      criticalFindings.push("policy_incompatible_with_method");
      candidates.push({ posture: "policy_incompatible", action: "alert", reason: "POLICY_INCOMPATIBLE_WITH_METHOD" });
    } else {
      // The policy is genuinely in force. Grade the operational exposure the
      // guidance warns about: an online Mac must reach the IdP even with a grace
      // period configured, and an OFFLINE Mac cannot use the local password
      // unless the grace period is configured and still valid.
      if (report.offlineGrace === "expired") {
        lockoutRisk = true;
        criticalFindings.push("offline_grace_expired");
        candidates.push({ posture: "lockout_exposed", action: "alert", reason: "OFFLINE_GRACE_EXPIRED" });
      } else if (report.offlineGrace === "not_configured") {
        lockoutRisk = true;
        criticalFindings.push("offline_grace_not_configured");
        candidates.push({ posture: "lockout_exposed", action: "alert", reason: "OFFLINE_GRACE_NOT_CONFIGURED" });
      } else if (report.offlineGrace === "unknown") {
        unknownSignals.push("offline_grace");
        candidates.push({ posture: "lockout_exposed", action: "step_up", reason: "OFFLINE_GRACE_UNKNOWN" });
      }
      if (report.breakGlass === "none") {
        // Apple's guidance: exempt a break-glass account BEFORE enforcement — the
        // temporary local-account grace window is not a recovery path.
        lockoutRisk = true;
        criticalFindings.push("break_glass_missing");
        candidates.push({ posture: "lockout_exposed", action: "alert", reason: "BREAK_GLASS_MISSING" });
      } else if (report.breakGlass === "unknown") {
        unknownSignals.push("break_glass");
        candidates.push({ posture: "lockout_exposed", action: "step_up", reason: "BREAK_GLASS_UNKNOWN" });
      }
    }
  }
  // loginPolicy === "not_required": nothing — grace/break-glass are moot.

  // Defence in depth: the grant is affirmative on parse, registration, method, and
  // policy. The branches above already push a raising candidate for every
  // non-confirmed state, so today this never fires — but if any branch were later
  // weakened so a non-confirmed state produced an empty candidate list, this
  // backstop forces a step_up rather than letting the seed grant survive.
  const positivelyConfirmed =
    report.reportIntegrity === "clean" &&
    report.registration === "user" &&
    hardwareBacked &&
    report.loginPolicy === "not_required";
  if (!positivelyConfirmed && candidates.length === 0) {
    candidates.push({ posture: "unverified", action: "step_up", reason: "METHOD_UNKNOWN" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired: clean +
  // user-registered + hardware-backed method + no policy claimed.
  const seed: Candidate = { posture: "phishing_resistant_confirmed", action: "none", reason: "PHISHING_RESISTANT_CONFIRMED" };
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
    lockoutRisk,
    criticalFindings,
    unknownSignals,
    ssoConfirmed: winner.action === "none",
  };
}
