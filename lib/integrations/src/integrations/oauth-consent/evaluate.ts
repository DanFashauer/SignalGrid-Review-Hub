import {
  type OAuthConsentAction,
  type OAuthConsentPosture,
  type OAuthConsentReasonCode,
  type OAuthConsentVerdict,
  type NormalizedOAuthConsent,
} from "./types";

/**
 * Pure, deterministic OAuth-consent evaluator. Folds a principal's riskiest
 * delegated grant into ONE posture + the action it warrants, fail-safe.
 *
 *  - an ILLICIT consent grant (user-consented, unverified publisher, broad/full
 *    scope — the consent-phishing signature) is the strongest negative → ESCALATE;
 *  - a FULL-ACCESS grant that is NOT admin-governed → RESTRICT (contain the broad
 *    delegated access); an admin-consented full-access or a merely BROAD scope, an
 *    UNVERIFIED publisher, or an UNMANAGED workload secret → STEP_UP;
 *  - the ONLY paths that contribute a grant are a positively-confirmed clean state —
 *    a KNOWN consent type (admin or user) + verified publisher + least scope +
 *    managed/no workload, OR no grants at all — AND ONLY with the IdP confirmed
 *    reachable (idpReachable===true); an UNKNOWN consent type never grants;
 *  - the IdP unreachable/unreported, or an unknown grant state, NEVER grants —
 *    step_up. Worst-concern-wins.
 *
 * `covered=false` = no consent result was returned for this principal → unknown
 * (a gap), step_up.
 */

const ACTION_SEVERITY: Record<OAuthConsentAction, number> = {
  none: 0,
  monitor: 1,
  step_up: 2,
  alert: 3,
  restrict: 4,
  escalate: 5,
};

export interface EvaluateOAuthConsentOptions {
  /** False when no consent result was returned for this principal. Default true. */
  covered?: boolean;
}

interface Candidate {
  posture: OAuthConsentPosture;
  action: OAuthConsentAction;
  reason: OAuthConsentReasonCode;
}

export function evaluateOAuthConsent(
  consent: NormalizedOAuthConsent,
  options: EvaluateOAuthConsentOptions = {},
): OAuthConsentVerdict {
  const covered = options.covered ?? true;

  const criticalFindings: string[] = [];
  const unknownSignals: string[] = [];
  const base = { criticalFindings, unknownSignals, principalId: consent.principalId };

  // No consent result at all → a gap. Raise the bar (never a governed grant).
  if (!covered) {
    return { ...base, posture: "unknown", reasonCode: "NOT_COVERED", recommendedAction: "step_up", governanceConfirmed: false };
  }

  // A grant state we cannot read → never trust it. Raise the bar.
  if (consent.grants === "unknown") {
    unknownSignals.push("grants");
    return { ...base, posture: "unverified", reasonCode: "CONSENT_STATE_UNKNOWN", recommendedAction: "step_up", governanceConfirmed: false };
  }

  // Collect risk from the riskiest reported grant. These are POSITIVE negative facts
  // — reported regardless of reachability (a known-bad grant during an IdP outage is
  // still known-bad). Only the clean/grant path below demands positive verification.
  const candidates: Candidate[] = [];
  if (consent.grants === "present") {
    // The consent-phishing signature: a user consented to an UNVERIFIED app with
    // broad/full access — the strongest negative.
    if (consent.consentType === "user" && consent.publisher === "unverified" && (consent.scope === "broad" || consent.scope === "full_access")) {
      criticalFindings.push("illicit_consent_grant");
      candidates.push({ posture: "illicit_grant", action: "escalate", reason: "ILLICIT_CONSENT_GRANT" });
    }

    // Full-access (full mailbox / broad offline access). Not admin-governed → contain.
    if (consent.scope === "full_access") {
      if (consent.consentType === "admin") {
        candidates.push({ posture: "over_scoped", action: "step_up", reason: "FULL_ACCESS_ADMIN_CONSENTED" });
      } else {
        criticalFindings.push("full_access_grant");
        candidates.push({ posture: "over_scoped", action: "restrict", reason: "FULL_ACCESS_GRANT" });
      }
    } else if (consent.scope === "broad") {
      candidates.push({ posture: "over_scoped", action: "step_up", reason: "BROAD_SCOPE_GRANT" });
    } else if (consent.scope === "unknown") {
      unknownSignals.push("scope");
      candidates.push({ posture: "unverified", action: "step_up", reason: "CONSENT_STATE_UNKNOWN" });
    }

    // An unverified-publisher app holding a grant.
    if (consent.publisher === "unverified") {
      candidates.push({ posture: "unverified_app", action: "step_up", reason: "UNVERIFIED_PUBLISHER" });
    } else if (consent.publisher === "unknown") {
      unknownSignals.push("publisher");
      candidates.push({ posture: "unverified", action: "step_up", reason: "CONSENT_STATE_UNKNOWN" });
    }

    // Workload identity with a long-lived unmanaged secret.
    if (consent.workloadCredential === "unmanaged_secret") {
      candidates.push({ posture: "workload_exposed", action: "step_up", reason: "UNMANAGED_WORKLOAD_SECRET" });
    } else if (consent.workloadCredential === "unknown") {
      unknownSignals.push("workload_credential");
      candidates.push({ posture: "unverified", action: "step_up", reason: "CONSENT_STATE_UNKNOWN" });
    }

    // The grant demands POSITIVE confirmation of every input: we must know HOW the
    // grant was consented (admin vs user). An unknown consent type never grants —
    // an admin- OR user-consented verified least-scope app is fine, but "unknown"
    // is not, so raise the bar. (This is the same positive-confirmation rule the
    // other fields above enforce.)
    if (consent.consentType === "unknown") {
      unknownSignals.push("consent_type");
      candidates.push({ posture: "unverified", action: "step_up", reason: "CONSENT_STATE_UNKNOWN" });
    }
  }

  // No risky fact found → the clean/grant path. It demands POSITIVE verification:
  // without an explicit idpReachable===true, the clean state may be a stale/cached
  // view, so it NEVER grants. (An explicit false is the same — an outage.)
  if (candidates.length === 0) {
    // The bridge's own risky-grant tally must AGREE with the clean read to grant: the
    // only clean count is exactly 0. A reported count that is anything else — positive
    // (real risky grants it didn't detail), or malformed (negative / non-integer) — is
    // a self-contradictory / ambiguous high-risk report (AGENTS.md L28). Fail closed;
    // do not out-vote the bridge's count with a clean field read. (A null count is
    // "not reported" and is fine — the field-level checks above already gate the grant.)
    if (consent.riskyGrantCount !== null && consent.riskyGrantCount !== 0) {
      unknownSignals.push("risky_grant_count_conflict");
      return { ...base, posture: "unverified", reasonCode: "CONSENT_STATE_UNKNOWN", recommendedAction: "step_up", governanceConfirmed: false };
    }
    // A "none" report that nonetheless carries a POSITIVE risky field value (a
    // full-access/broad scope, an unverified publisher, or an unmanaged workload
    // secret) is self-contradictory — no grants, yet risky grant detail. The risky
    // fields above are only evaluated for `present`, so a "none" report would
    // otherwise sail through here; fail closed instead of granting.
    // The `grants === "none"` term is INERT at today's ordering — the risky-field checks
    // above already push a candidate whenever grants is "present", so this disjunct can
    // only be true for a "none" report. Verified by behavioural diff (all 6,480
    // enumerated states, zero verdicts changed when mutated to `true`), and kept because
    // it states the scope exactly and goes load-bearing if that block's scoping changes.
    if (
      consent.grants === "none" &&
      (consent.scope === "broad" ||
        consent.scope === "full_access" ||
        consent.publisher === "unverified" ||
        consent.workloadCredential === "unmanaged_secret")
    ) {
      unknownSignals.push("no_grants_conflict");
      return { ...base, posture: "unverified", reasonCode: "CONSENT_STATE_UNKNOWN", recommendedAction: "step_up", governanceConfirmed: false };
    }
    if (consent.idpReachable !== true) {
      unknownSignals.push("idp_reachable");
      return { ...base, posture: "unverified", reasonCode: "IDP_UNREACHABLE", recommendedAction: "step_up", governanceConfirmed: false };
    }
    if (consent.grants === "none") {
      return { ...base, posture: "no_grants", reasonCode: "NO_RISKY_GRANTS", recommendedAction: "none", governanceConfirmed: true };
    }
    return { ...base, posture: "governed", reasonCode: "GOVERNED_CONSENT", recommendedAction: "none", governanceConfirmed: true };
  }

  // Worst-concern-wins among the reported risks.
  const winner = candidates.reduce<Candidate>(
    (max, c) => (ACTION_SEVERITY[c.action] > ACTION_SEVERITY[max.action] ? c : max),
    candidates[0],
  );
  return { ...base, posture: winner.posture, reasonCode: winner.reason, recommendedAction: winner.action, governanceConfirmed: false };
}
