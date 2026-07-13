import { canonicalJson, digest } from "./util";
import type {
  DecisionEvidence,
  DecisionOutcome,
  MatchedRule,
  PolicyRuleSpec,
  PolicyVersion,
  RuleCondition,
} from "./types";

/** Severity of a degraded-evidence outcome, worst-first for precedence. */
const OUTCOME_RANK: Record<DecisionOutcome, number> = {
  deny: 4,
  restrict: 3,
  step_up: 2,
  allow: 1,
};

export interface PolicyEvaluation {
  outcome: DecisionOutcome;
  reasonCodes: string[];
  matchedRules: MatchedRule[];
  explanation: string;
}

/** Deterministic digest of a rule set — makes a policy version tamper-evident. */
export function ruleSetDigest(rules: PolicyRuleSpec[]): string {
  return digest(canonicalJson(rules));
}

/**
 * Evaluate normalized decision evidence against a versioned policy.
 *
 * Guarantees (verified by the core proof):
 *  1. Every firing rule contributes a reason code and an outcome.
 *  2. The final outcome is the most restrictive firing outcome (deny > restrict
 *     > step_up > allow).
 *  3. Fail-closed: if critical evidence is missing/degraded, `allow` can never
 *     be the outcome — it is suppressed in favour of step-up or higher.
 *  4. If no rule fires, the default is step-up (never a silent allow).
 */
export function evaluatePolicy(
  version: PolicyVersion,
  evidence: DecisionEvidence,
): PolicyEvaluation {
  const matchedRules: MatchedRule[] = [];
  const reasonCodes: string[] = [];

  for (const rule of version.rules) {
    if (rule.match.every((condition) => matches(condition, evidence))) {
      matchedRules.push({
        ruleId: rule.id,
        reasonCode: rule.reasonCode,
        outcome: rule.outcome,
        severity: rule.severity,
      });
      if (!reasonCodes.includes(rule.reasonCode)) {
        reasonCodes.push(rule.reasonCode);
      }
    }
  }

  let outcome: DecisionOutcome;
  if (matchedRules.length === 0) {
    // No rule matched: do not trust by default.
    outcome = "step_up";
    reasonCodes.push("NO_RULE_MATCHED_DEFAULT_STEP_UP");
  } else {
    outcome = mostRestrictive(matchedRules.map((rule) => rule.outcome));
  }

  // Fail-closed guardrail: never allow on degraded critical evidence.
  if (outcome === "allow" && !evidence.criticalSignalsPresent) {
    outcome = "step_up";
    reasonCodes.push("ALLOW_SUPPRESSED_DEGRADED_EVIDENCE");
  }

  return {
    outcome,
    reasonCodes,
    matchedRules,
    explanation: explain(outcome, reasonCodes),
  };
}

function mostRestrictive(outcomes: DecisionOutcome[]): DecisionOutcome {
  return outcomes.reduce((worst, next) =>
    OUTCOME_RANK[next] > OUTCOME_RANK[worst] ? next : worst,
  );
}

function matches(condition: RuleCondition, evidence: DecisionEvidence): boolean {
  switch (condition.field) {
    case "identityEnabled":
      return evidence.identityEnabled === condition.equals;
    case "deviceManaged":
      return evidence.deviceManaged === condition.equals;
    case "deviceEncrypted":
      return evidence.deviceEncrypted === condition.equals;
    case "osSupported":
      return evidence.osSupported === condition.equals;
    case "criticalSignalsPresent":
      return evidence.criticalSignalsPresent === condition.equals;
    case "deviceCompliance":
      return condition.in.includes(evidence.deviceCompliance);
    case "postureFreshness":
      return condition.in.includes(evidence.postureFreshness);
    case "ownerType":
      return condition.in.includes(evidence.ownerType);
    case "workflowRiskTier":
      return condition.in.includes(evidence.workflowRiskTier);
    default: {
      // Exhaustiveness guard: an unknown condition never silently passes.
      const _exhaustive: never = condition;
      return Boolean(_exhaustive);
    }
  }
}

function explain(outcome: DecisionOutcome, reasonCodes: string[]): string {
  const codes = reasonCodes.join(", ");
  switch (outcome) {
    case "deny":
      return `Access denied: critical trust conditions failed (${codes}).`;
    case "restrict":
      return `Access restricted: risk exceeded the allow threshold (${codes}).`;
    case "step_up":
      return `Step-up required: trust is incomplete, so additional verification is requested before access (${codes}).`;
    case "allow":
      return `Access allowed: identity, device posture, and workflow context are aligned and fresh (${codes}).`;
    default: {
      const _exhaustive: never = outcome;
      return String(_exhaustive);
    }
  }
}

// ── Default rule sets used by the seed ───────────────────────────────────────

/**
 * Baseline shared-device access policy (v1). Ordered general → specific; the
 * engine combines all firing rules by precedence, so order is for readability.
 */
export const SHARED_DEVICE_RULES_V1: PolicyRuleSpec[] = [
  {
    id: "identity-disabled",
    description: "A disabled or unknown identity cannot start a session.",
    match: [{ field: "identityEnabled", equals: false }],
    outcome: "deny",
    reasonCode: "IDENTITY_DISABLED",
    severity: "critical",
  },
  {
    id: "identity-unknown",
    description: "Unknown identity state fails closed to step-up.",
    match: [{ field: "identityEnabled", equals: "unknown" }],
    outcome: "step_up",
    reasonCode: "IDENTITY_STATE_UNKNOWN",
    severity: "high",
  },
  {
    id: "device-noncompliant",
    description: "A non-compliant managed device is restricted.",
    match: [{ field: "deviceCompliance", in: ["non_compliant"] }],
    outcome: "restrict",
    reasonCode: "DEVICE_NONCOMPLIANT",
    severity: "high",
  },
  {
    id: "device-unmanaged",
    description: "An unmanaged device is restricted from shared-device sessions.",
    match: [{ field: "deviceManaged", equals: false }],
    outcome: "restrict",
    reasonCode: "DEVICE_UNMANAGED",
    severity: "high",
  },
  {
    id: "posture-stale",
    description: "Stale or expired posture requires step-up before trust.",
    match: [{ field: "postureFreshness", in: ["stale", "expired"] }],
    outcome: "step_up",
    reasonCode: "POSTURE_STALE",
    severity: "medium",
  },
  {
    id: "posture-missing",
    description: "Missing/unknown posture fails closed to restrict.",
    match: [{ field: "postureFreshness", in: ["missing", "unknown"] }],
    outcome: "restrict",
    reasonCode: "POSTURE_MISSING",
    severity: "high",
  },
  {
    id: "critical-workflow-personal-device",
    description: "Critical workflows on personal devices are denied.",
    match: [
      { field: "workflowRiskTier", in: ["critical"] },
      { field: "ownerType", in: ["personal", "unknown"] },
    ],
    outcome: "deny",
    reasonCode: "CRITICAL_WORKFLOW_UNTRUSTED_DEVICE",
    severity: "critical",
  },
  {
    id: "elevated-workflow-needs-encryption",
    description: "Elevated/critical workflows require device encryption.",
    match: [
      { field: "workflowRiskTier", in: ["elevated", "critical"] },
      { field: "deviceEncrypted", equals: false },
    ],
    outcome: "step_up",
    reasonCode: "ENCRYPTION_REQUIRED_FOR_WORKFLOW",
    severity: "medium",
  },
  {
    id: "healthy-allow",
    description:
      "Enabled identity + compliant, managed, fresh, encrypted device on a corporate/shared device is an allow candidate.",
    match: [
      { field: "identityEnabled", equals: true },
      { field: "deviceManaged", equals: true },
      { field: "deviceCompliance", in: ["compliant"] },
      { field: "postureFreshness", in: ["fresh"] },
      { field: "osSupported", equals: true },
      { field: "criticalSignalsPresent", equals: true },
    ],
    outcome: "allow",
    reasonCode: "TRUST_ESTABLISHED",
    severity: "low",
  },
];
