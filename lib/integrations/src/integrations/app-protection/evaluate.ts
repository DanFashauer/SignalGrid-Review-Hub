import {
  type AppProtectionAction,
  type AppProtectionPosture,
  type AppProtectionReasonCode,
  type AppProtectionVerdict,
  type NormalizedAppProtection,
} from "./types";

/**
 * Pure, deterministic APP-PROTECTION / MAM evaluator. Grades ONE app registration —
 * is a mobile-application-management protection policy applied, clean and current,
 * for the app the worker is using — fail-closed, on the fabric's unified ladder.
 *
 * Doctrine ("a sensitive app running without applied protection is not a healthy
 * session"):
 *  - **missing policy on a sensitive app** → `restrict`. The management plane reports
 *    no app-protection policy applied and the caller marked the app sensitive. This
 *    is the state the connector emulator scripts as
 *    `MISSING_MAM_POLICY_SENSITIVE_APP → restrict`, and this evaluator is what makes
 *    that expectation come from the real fabric rather than a harness heuristic. The
 *    only rung above step-up here, and it earns it — corporate data would be flowing
 *    through an app with no MAM containment.
 *  - **flagged registration on a sensitive app** → `restrict`. A policy is applied
 *    but the plane flagged the registration (jailbroken / rooted / malicious apps).
 *    On a sensitive app that is the same severity as no policy at all.
 *  - **missing policy (standard / unassessed app)** → `step_up`. Common and often
 *    legitimate (a newly deployed app before assignment propagates); visible and
 *    answerable, not blocked.
 *  - **flagged (standard / unassessed app)** → `step_up`. The plane flagged the
 *    registration; a challenge resolves it.
 *  - **stale registration** → `step_up`. A read older than the caller's own maximum
 *    age is not evidence about now.
 *  - **unknown anything** → `step_up`. Unknown raises, never grants.
 *  - **not covered** → `step_up`. An app with no registration at all is an honest
 *    hole, not a pass.
 *
 * THE ASSERTED-POSITIVE. An app the caller marks `not_applicable` (legitimately
 * outside MAM scope) is affirmatively fine: its missing policy is expected, and the
 * evaluator returns `none` with `APP_PROTECTION_NOT_APPLICABLE`. That is distinct
 * from `unknown` applicability, which raises. A caller with no opinion
 * (`unassessed`) is treated as applicable — an unmanaged app is fail-closed, never
 * silently excused.
 *
 * THE ONE THING THIS EVALUATOR NEVER DOES is emit an action below `none`. There is
 * no rung for "a policy is applied, so relax another dimension" — posture
 * composition is worst-concern-wins and this family contributes only `none` or a
 * raise. And it never wipes: selective wipe is a non-feature by design (see types).
 *
 * The grant (`none`) requires a full positive conjunction: clean parse + covered +
 * (`not_applicable` OR (`applied` + `clean`)) + a recency answer of
 * `fresh`/`unassessed`. Not one clause has the form `!== bad`, so a value this
 * design has never heard of satisfies none of them.
 */

const ACTION_SEVERITY: Record<AppProtectionAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateAppProtectionOptions {
  /** False when the MAM plane returned no registration for this app. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: AppProtectionPosture;
  action: AppProtectionAction;
  reason: AppProtectionReasonCode;
}

export function evaluateAppProtection(
  report: NormalizedAppProtection,
  opts: EvaluateAppProtectionOptions = {},
): AppProtectionVerdict {
  const covered = opts.covered ?? true;
  const verdict = evaluateCoveredReport(report);
  if (covered) return verdict;
  // NOT COVERED — the MAM plane returned no registration for this app: an honest hole,
  // normally step_up. But `covered: false` must be worst-concern-wins, never a CAP: if the
  // report handed in still confirms a STRICTLY higher concern (a flagged sensitive
  // registration → restrict), that confirmed fact is preserved rather than silently
  // downgraded to step_up; only a would-be grant or a step_up is reported as NOT_COVERED.
  // Either way it can never grant, and the missing registration is noted. (Codex P1.)
  const withHole = (v: AppProtectionVerdict): AppProtectionVerdict => ({
    ...v,
    unknownSignals: v.unknownSignals.includes("app_registration")
      ? v.unknownSignals
      : [...v.unknownSignals, "app_registration"],
  });
  if (ACTION_SEVERITY[verdict.recommendedAction] > ACTION_SEVERITY.step_up) {
    return withHole(verdict);
  }
  return withHole({
    appRef: report.appRef,
    posture: "app_protection_unverified",
    reasonCode: "NOT_COVERED",
    recommendedAction: "step_up",
    criticalFindings: verdict.criticalFindings,
    unknownSignals: verdict.unknownSignals,
    appProtected: false,
  });
}

function evaluateCoveredReport(report: NormalizedAppProtection): AppProtectionVerdict {
  const base = { appRef: report.appRef };
  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];

  const sensitive = report.appSensitivity === "sensitive";

  // The caller's affirmative out-of-scope declaration. MAM facts are moot for an app
  // legitimately outside MAM, so a CLEAN, un-flagged out-of-scope report short-circuits
  // to the grant. Two things override the declaration and are NOT suppressed by it:
  //  - a MALFORMED report → step_up (an unparseable record is not evidence the caller's
  //    declaration is safe to act on);
  //  - a positively FLAGGED registration (jailbroken/rooted) → restrict on a sensitive
  //    app, step_up otherwise. A flagged registration is device-integrity evidence that
  //    exists regardless of MAM scope, and its very existence contradicts "out of scope"
  //    (a flagged MAM registration means the app IS registered), so it must win rather
  //    than be hidden by the applicability classification. (Codex P1.)
  // A missing/not_applied policy stays expected and non-restricting here. This is
  // distinct from `unknown` applicability (posed, unreadable), which raises below.
  if (report.mamApplicability === "not_applicable") {
    // Ordered by severity, because this branch short-circuits (it does not use the
    // worst-concern-wins reducer below): the strongest concern must be checked first so
    // a weaker raise cannot cap it. A positively FLAGGED registration is device-integrity
    // evidence (jailbreak/root) that outranks BOTH the out-of-scope declaration AND report
    // malformity — malformity may never DOWNGRADE a confirmed restrict — so it comes before
    // the malformed check. (Codex P1.)
    if (report.complianceState === "flagged") {
      criticalFindings.push("mam_registration_flagged");
      return sensitive
        ? {
            ...base,
            posture: "app_protection_flagged",
            reasonCode: "MAM_FLAGGED_SENSITIVE_APP",
            recommendedAction: "restrict",
            criticalFindings,
            unknownSignals,
            appProtected: false,
          }
        : {
            ...base,
            posture: "app_protection_flagged",
            reasonCode: "APP_PROTECTION_FLAGGED",
            recommendedAction: "step_up",
            criticalFindings,
            unknownSignals,
            appProtected: false,
          };
    }
    // A report we could not parse is not evidence the caller's out-of-scope declaration
    // is safe to act on → raise (but below a confirmed flag, above the grant).
    if (report.reportIntegrity !== "clean") {
      return {
        ...base,
        posture: "app_protection_unverified",
        reasonCode: "REPORT_MALFORMED",
        recommendedAction: "step_up",
        criticalFindings,
        unknownSignals: ["report_integrity"],
        appProtected: false,
      };
    }
    // Out of scope grants only on a POSITIVELY clean compliance read. An UNKNOWN
    // flagged state (the plane never posed flagged_reasons) is not proof the
    // registration is un-flagged, and — because a flagged registration overrides the
    // out-of-scope declaration above — an unreadable flagged state must raise for the
    // same reason rather than be treated like a confirmed-clean one. (Codex P1.)
    if (report.complianceState !== "clean") {
      unknownSignals.push("compliance_state");
      return {
        ...base,
        posture: "app_protection_unverified",
        reasonCode: "COMPLIANCE_UNKNOWN",
        recommendedAction: "step_up",
        criticalFindings,
        unknownSignals,
        appProtected: false,
      };
    }
    // The clean-compliance read must itself be CURRENT when the caller posed a maximum
    // age: a jailbreak/root finding is device-integrity evidence, and a stale or
    // timestamp-less read cannot establish the registration is unflagged NOW. `unassessed`
    // (no bound posed) and `fresh` grant; `stale`/`unknown` raise, mirroring the applicable
    // path's freshness rungs. (Codex P1.)
    if (report.registrationFreshness === "stale") {
      criticalFindings.push("mam_registration_stale");
      return {
        ...base,
        posture: "app_protection_stale",
        reasonCode: "APP_PROTECTION_STALE",
        recommendedAction: "step_up",
        criticalFindings,
        unknownSignals,
        appProtected: false,
      };
    }
    // Anything that is not the posed-and-recognized `fresh`/`unassessed` — the posed
    // `unknown`, or an off-enum value ("bogus"/undefined) on a directly-constructed or
    // deserialized record — must RAISE: the out-of-scope grant requires a RECOGNIZED
    // current read, never a default-through of a malformed freshness. `stale` returned
    // its own code above. (Codex R10-1, mirroring the applicability widening R9-3.)
    if (report.registrationFreshness !== "fresh" && report.registrationFreshness !== "unassessed") {
      unknownSignals.push("registration_freshness");
      return {
        ...base,
        posture: "app_protection_unverified",
        reasonCode: "APP_PROTECTION_TIME_UNKNOWN",
        recommendedAction: "step_up",
        criticalFindings,
        unknownSignals,
        appProtected: false,
      };
    }
    return {
      ...base,
      posture: "app_protection_not_applicable",
      reasonCode: "APP_PROTECTION_NOT_APPLICABLE",
      recommendedAction: "none",
      criticalFindings,
      unknownSignals,
      appProtected: true,
    };
  }

  // Track the unknown axes for evidence (they also foreclose the grant below).
  if (report.policyState === "unknown") unknownSignals.push("policy_state");
  if (report.complianceState === "unknown") unknownSignals.push("compliance_state");
  if (report.mamApplicability === "unknown") unknownSignals.push("mam_applicability");
  if (report.registrationFreshness === "unknown") unknownSignals.push("registration_freshness");

  const candidates: Candidate[] = [];

  // A report we could not parse never grants, and — worst-concern-wins — it must never
  // LOWER a confirmed concern either: it is a raising CANDIDATE here, not an early return
  // that would cap a sensitive missing/flagged policy at step_up. Pushed first so it wins
  // step_up ties (a pure-malformed report still reads REPORT_MALFORMED). (Codex P1.)
  if (report.reportIntegrity !== "clean") {
    unknownSignals.push("report_integrity");
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "REPORT_MALFORMED" });
  }

  // ── the management plane's own state: is a policy applied? ───────────────────────
  if (report.policyState === "not_applied") {
    criticalFindings.push("mam_policy_not_applied");
    if (sensitive) {
      candidates.push({
        posture: "app_protection_missing",
        action: "restrict",
        reason: "MISSING_MAM_POLICY_SENSITIVE_APP",
      });
    } else {
      candidates.push({ posture: "app_protection_missing", action: "step_up", reason: "MISSING_MAM_POLICY" });
    }
  } else if (report.policyState === "unknown") {
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "POLICY_STATE_UNKNOWN" });
  }

  // ── the registration's compliance: any flagged reasons? ─────────────────────────
  if (report.complianceState === "flagged") {
    criticalFindings.push("mam_registration_flagged");
    if (sensitive) {
      candidates.push({
        posture: "app_protection_flagged",
        action: "restrict",
        reason: "MAM_FLAGGED_SENSITIVE_APP",
      });
    } else {
      candidates.push({ posture: "app_protection_flagged", action: "step_up", reason: "APP_PROTECTION_FLAGGED" });
    }
  } else if (report.complianceState === "unknown") {
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "COMPLIANCE_UNKNOWN" });
  }

  // ── is the registration current enough to be evidence about now? ────────────────
  if (report.registrationFreshness === "stale") {
    criticalFindings.push("mam_registration_stale");
    candidates.push({ posture: "app_protection_stale", action: "step_up", reason: "APP_PROTECTION_STALE" });
  } else if (report.registrationFreshness !== "fresh" && report.registrationFreshness !== "unassessed") {
    // The posed `unknown`, or an off-enum value past the normalizer — raise explicitly
    // here rather than leaning on the GRANT_BACKSTOP below, which must stay inert. (Codex
    // R10-1 shape; the not_applicable branch is fixed in kind above.)
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "APP_PROTECTION_TIME_UNKNOWN" });
  }

  // ── was MAM applicability posed but unreadable, or off-enum? ─────────────────────
  // `not_applicable` returned early above and `applicable`/`unassessed` are the only
  // other affirmative values. ANYTHING else — the posed-but-unreadable `unknown`, or an
  // off-enum value ("bogus"/undefined) that reached a directly-constructed or deserialized
  // NormalizedAppProtection from an unchecked boundary — must RAISE: the grant requires a
  // RECOGNIZED applicability, never a default-through. (Codex P1.)
  if (report.mamApplicability !== "applicable" && report.mamApplicability !== "unassessed") {
    if (!unknownSignals.includes("mam_applicability")) unknownSignals.push("mam_applicability");
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "APPLICABILITY_UNKNOWN" });
  }

  // Defence in depth: the grant is affirmative on every axis plus the parse.
  //
  // INERT TODAY, deliberately kept, and registered as such in
  // `scripts/mutation-guard.mjs`. Every non-confirmed state already pushes a raising
  // candidate above, so the candidate list is never empty when this is false. It is
  // kept as the last thing standing between a weakened branch and a surviving seed
  // grant, and it pushes its OWN reason code so a firing would be visible in the
  // record rather than disguised as a normal branch.
  // Report integrity and applicability are already handled by the early returns
  // above; by here the report is clean and MAM is applicable/unassessed, so the
  // grant is an applied+clean policy on a current read.
  const positivelyProtected =
    report.policyState === "applied" &&
    report.complianceState === "clean" &&
    (report.registrationFreshness === "fresh" || report.registrationFreshness === "unassessed");
  if (!positivelyProtected && candidates.length === 0) {
    candidates.push({ posture: "app_protection_unverified", action: "step_up", reason: "GRANT_BACKSTOP" });
  }

  // Worst-concern-wins. The grant survives only when nothing fired.
  const seed: Candidate = { posture: "app_protected", action: "none", reason: "APP_PROTECTED" };
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
    appProtected: winner.action === "none",
  };
}
