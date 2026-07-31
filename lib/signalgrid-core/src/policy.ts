import { canonicalJson, digest } from "./util";
import {
  CoreError,
  type DecisionOutcome,
  type DecisionEvidence,
  type MatchedRule,
  type PolicyRuleSpec,
  type PolicyTest,
  type PolicyTestResult,
  type PolicyVersion,
  type RuleCondition,
  type Severity,
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

// ── Rule validation (untrusted input hardening) ──────────────────────────────
//
// Policy rules can arrive from an authenticated caller (POST a new draft
// version). Without structural validation, a malformed rule (e.g. one missing
// `match`, or a condition with a bad `field`/`in`) would flow untouched into
// `evaluatePolicy`, where `rule.match.every(...)` or `condition.in.includes(...)`
// would throw a raw TypeError on the *next* evaluation — turning an authoring
// request into a stored, deferred denial-of-service. Validation is enforced at
// the write boundary so only well-formed rules can ever be persisted, and the
// values are re-materialised into fresh objects so unexpected/prototype-y keys
// are dropped.

/** Upper bound on rules per policy version — bounds evaluation cost and body size. */
export const MAX_POLICY_RULES = 64;
/** Upper bound on conditions per rule. */
export const MAX_RULE_CONDITIONS = 16;
/** Upper bound on any string field in an authored rule. */
const MAX_RULE_STRING = 200;

const VALID_OUTCOMES = new Set<DecisionOutcome>([
  "allow",
  "step_up",
  "restrict",
  "deny",
]);
const VALID_SEVERITIES = new Set<Severity>([
  "low",
  "medium",
  "high",
  "critical",
]);

// Condition fields whose value is `equals: boolean | "unknown"`.
const TRISTATE_FIELDS = new Set([
  "identityEnabled",
  "deviceManaged",
  "deviceEncrypted",
  "osSupported",
]);
// Condition fields whose value is `equals: boolean`.
const BOOL_FIELDS = new Set(["criticalSignalsPresent"]);
// Condition fields whose value is `in: <enum>[]`, with the allowed members.
const IN_FIELDS: Record<string, ReadonlySet<string>> = {
  deviceCompliance: new Set(["compliant", "non_compliant", "unknown"]),
  postureFreshness: new Set(["fresh", "stale", "expired", "missing", "unknown"]),
  ownerType: new Set(["corporate", "personal", "shared", "unknown"]),
  workflowRiskTier: new Set(["low", "standard", "elevated", "critical"]),
  custodyState: new Set([
    "checked_in",
    "checked_out",
    "overdue",
    "exception",
    "maintenance",
    "unknown",
  ]),
  chargeState: new Set([
    "charging",
    "charged",
    "low",
    "critical",
    "not_present",
    "unknown",
  ]),
  batteryHealth: new Set(["healthy", "degraded", "failing", "unknown"]),
  tamperState: new Set([
    "none",
    "suspected",
    "confirmed",
    "sensor_unavailable",
    "unknown",
  ]),
  dockState: new Set([
    "occupied",
    "empty",
    "reserved",
    "faulted",
    "offline",
    "unknown",
  ]),
  baselineState: new Set([
    "aligned",
    "partial",
    "drifted",
    "not_assessed",
    "unknown",
  ]),
  benchmarkSelectionState: new Set([
    "confirmed",
    "misfit",
    "unverified",
  ]),
  shiftContextState: new Set([
    "confirmed",
    "misfit",
    "unverified",
  ]),
  badgeState: new Set([
    "present",
    "removed",
    "forced",
    "absent",
    "unknown",
  ]),
};

function reject(message: string): never {
  throw new CoreError("validation", message, 400);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    reject(`${label} must be a non-empty string.`);
  }
  if (value.length > MAX_RULE_STRING) {
    reject(`${label} exceeds the ${MAX_RULE_STRING}-character limit.`);
  }
  return value;
}

function validateCondition(input: unknown, ruleId: string): RuleCondition {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    reject(`Rule "${ruleId}" has a condition that is not an object.`);
  }
  const record = input as Record<string, unknown>;
  const field = record["field"];
  if (typeof field !== "string") {
    reject(`Rule "${ruleId}" has a condition with a missing/invalid field.`);
  }

  if (TRISTATE_FIELDS.has(field)) {
    const equals = record["equals"];
    if (typeof equals !== "boolean" && equals !== "unknown") {
      reject(
        `Condition on "${field}" requires equals to be a boolean or "unknown".`,
      );
    }
    return { field, equals } as RuleCondition;
  }

  if (BOOL_FIELDS.has(field)) {
    const equals = record["equals"];
    if (typeof equals !== "boolean") {
      reject(`Condition on "${field}" requires equals to be a boolean.`);
    }
    return { field, equals } as RuleCondition;
  }

  const allowed = IN_FIELDS[field];
  if (allowed) {
    const members = record["in"];
    if (!Array.isArray(members) || members.length === 0) {
      reject(`Condition on "${field}" requires a non-empty "in" array.`);
    }
    if (members.length > MAX_RULE_CONDITIONS) {
      reject(`Condition on "${field}" has too many members.`);
    }
    for (const member of members) {
      if (typeof member !== "string" || !allowed.has(member)) {
        reject(`Condition on "${field}" has an unsupported value.`);
      }
    }
    return { field, in: [...members] } as RuleCondition;
  }

  reject(`Rule "${ruleId}" references an unknown condition field "${field}".`);
}

function validateRule(input: unknown, index: number): PolicyRuleSpec {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    reject(`Rule at index ${index} is not an object.`);
  }
  const record = input as Record<string, unknown>;
  const id = requireString(record["id"], `Rule[${index}].id`);
  const description = requireString(
    record["description"],
    `Rule "${id}".description`,
  );
  const outcome = record["outcome"];
  if (typeof outcome !== "string" || !VALID_OUTCOMES.has(outcome as DecisionOutcome)) {
    reject(`Rule "${id}" has an invalid outcome.`);
  }
  const reasonCode = requireString(record["reasonCode"], `Rule "${id}".reasonCode`);
  const severity = record["severity"];
  if (typeof severity !== "string" || !VALID_SEVERITIES.has(severity as Severity)) {
    reject(`Rule "${id}" has an invalid severity.`);
  }
  const match = record["match"];
  if (!Array.isArray(match) || match.length === 0) {
    reject(`Rule "${id}" requires a non-empty "match" array.`);
  }
  if (match.length > MAX_RULE_CONDITIONS) {
    reject(`Rule "${id}" has too many conditions (max ${MAX_RULE_CONDITIONS}).`);
  }
  const conditions = match.map((condition) => validateCondition(condition, id));
  // Re-materialise as a clean object so only known keys survive.
  return {
    id,
    description,
    match: conditions,
    outcome: outcome as DecisionOutcome,
    reasonCode,
    severity: severity as Severity,
  };
}

/**
 * Validate an untrusted rule set from an authenticated authoring request.
 * Returns fully-typed, re-materialised rules on success; throws a
 * `validation` CoreError (HTTP 400) on any structural problem. This is the
 * single choke point that guarantees `evaluatePolicy` only ever sees
 * well-formed rules.
 */
export function validatePolicyRules(input: unknown): PolicyRuleSpec[] {
  if (!Array.isArray(input) || input.length === 0) {
    reject("A policy version requires a non-empty array of rules.");
  }
  if (input.length > MAX_POLICY_RULES) {
    reject(`A policy version may contain at most ${MAX_POLICY_RULES} rules.`);
  }
  const seen = new Set<string>();
  const rules = input.map((rule, index) => {
    const validated = validateRule(rule, index);
    if (seen.has(validated.id)) {
      reject(`Duplicate rule id "${validated.id}".`);
    }
    seen.add(validated.id);
    return validated;
  });
  return rules;
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
    // Defense-in-depth: rules are validated at authoring, but never let a
    // malformed rule (empty/absent match) crash evaluation or fire vacuously.
    // A rule with no real conditions fails closed (does not match).
    if (!Array.isArray(rule.match) || rule.match.length === 0) {
      continue;
    }
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
    case "custodyState":
      return condition.in.includes(evidence.custodyState);
    case "chargeState":
      return condition.in.includes(evidence.dockChargeState);
    case "batteryHealth":
      return condition.in.includes(evidence.batteryHealth);
    case "tamperState":
      return condition.in.includes(evidence.tamperState);
    case "dockState":
      return condition.in.includes(evidence.dockState);
    case "baselineState":
      return condition.in.includes(evidence.baselineCompliance);
    case "benchmarkSelectionState":
      return condition.in.includes(evidence.benchmarkSelection);
    case "shiftContextState":
      return condition.in.includes(evidence.shiftContext);
    case "badgeState":
      return condition.in.includes(evidence.badgeBinding);
    default: {
      // Exhaustiveness guard at compile time; fail-closed at runtime so an
      // unknown/malformed condition (e.g. from an authored draft) never matches.
      const _exhaustive: never = condition;
      void _exhaustive;
      return false;
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

/** Run a version's test fixtures against the engine; pins version behaviour. */
export function runPolicyTests(
  version: PolicyVersion,
  tests: PolicyTest[],
): PolicyTestResult[] {
  return tests.map((test) => {
    const evaluation = evaluatePolicy(version, test.evidence);
    const outcomeOk = evaluation.outcome === test.expectedOutcome;
    const reasonOk =
      test.expectedReasonCode === undefined ||
      evaluation.reasonCodes.includes(test.expectedReasonCode);
    return {
      testId: test.id,
      name: test.name,
      passed: outcomeOk && reasonOk,
      expectedOutcome: test.expectedOutcome,
      actualOutcome: evaluation.outcome,
      expectedReasonCode: test.expectedReasonCode,
      actualReasonCodes: evaluation.reasonCodes,
    };
  });
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
    id: "tamper-confirmed",
    description: "Confirmed physical tamper on the device is denied.",
    match: [{ field: "tamperState", in: ["confirmed"] }],
    outcome: "deny",
    reasonCode: "TAMPER_CONFIRMED",
    severity: "critical",
  },
  {
    id: "tamper-suspected",
    description: "Suspected tamper is restricted pending inspection.",
    match: [{ field: "tamperState", in: ["suspected"] }],
    outcome: "restrict",
    reasonCode: "TAMPER_SUSPECTED",
    severity: "high",
  },
  {
    id: "tamper-sensor-unavailable",
    description:
      "A blinded tamper sensor cannot witness the device — fail closed to step-up rather than trust an unwitnessed shared device.",
    match: [{ field: "tamperState", in: ["sensor_unavailable"] }],
    outcome: "step_up",
    reasonCode: "TAMPER_SENSOR_UNAVAILABLE",
    severity: "medium",
  },
  {
    id: "custody-overdue",
    description: "A device overdue for return/check-in is restricted.",
    match: [{ field: "custodyState", in: ["overdue"] }],
    outcome: "restrict",
    reasonCode: "CUSTODY_OVERDUE",
    severity: "high",
  },
  {
    id: "custody-exception",
    description: "A custody exception (e.g. removed without a session) is restricted.",
    match: [{ field: "custodyState", in: ["exception"] }],
    outcome: "restrict",
    reasonCode: "CUSTODY_EXCEPTION",
    severity: "high",
  },
  {
    id: "custody-maintenance",
    description:
      "A device pulled for maintenance is not for general use — a shared-device session on it is restricted until it is released from maintenance.",
    match: [{ field: "custodyState", in: ["maintenance"] }],
    outcome: "restrict",
    reasonCode: "CUSTODY_MAINTENANCE",
    severity: "high",
  },
  {
    id: "battery-critical",
    description:
      "A critically low battery on a shared device requires step-up before a session (operational risk).",
    match: [{ field: "chargeState", in: ["critical"] }],
    outcome: "step_up",
    reasonCode: "BATTERY_CRITICAL",
    severity: "medium",
  },
  {
    id: "battery-failing",
    // Deliberately RESTRICT where `battery-critical` steps up, and deliberately
    // matched on health rather than charge. A critically low battery is fixed by
    // charging, so a step-up plus "go dock it" is a real path back to allow. A
    // FAILING battery is not fixed by charging, so the same treatment would route
    // a worker to a bay, return them `low` again, and loop — the device needs a
    // battery, not a bay. Restrict is the honest outcome for a device that should
    // not be handed out for a shift, and it matches `custody-maintenance`: a
    // device awaiting service is out of general rotation until it is serviced.
    //
    // `degraded` is deliberately NOT matched here. It is reduced capacity that is
    // still serviceable, and is carried as evidence only — the same treatment
    // `chargeState: "low"` gets. A rule on `degraded` would restrict a large part
    // of any real fleet for a condition nobody would pull a device for.
    description:
      "A failing battery cannot hold a shift and charging will not fix it — restrict the shared-device session until the battery is replaced.",
    match: [{ field: "batteryHealth", in: ["failing"] }],
    outcome: "restrict",
    reasonCode: "BATTERY_FAILING",
    severity: "high",
  },
  {
    id: "dock-faulted",
    description:
      "A faulted SmartDock/dock cannot vouch for the device's custody, charge, or tamper state — the shared-device session is restricted until custody is re-established on a healthy dock.",
    match: [{ field: "dockState", in: ["faulted"] }],
    outcome: "restrict",
    reasonCode: "DOCK_FAULTED",
    severity: "high",
  },
  {
    id: "dock-offline",
    description:
      "An offline SmartDock/dock has lost its live custody channel, so recent custody/charge/tamper reads may be stale — require step-up before a session.",
    match: [{ field: "dockState", in: ["offline"] }],
    outcome: "step_up",
    reasonCode: "DOCK_OFFLINE",
    severity: "medium",
  },
  {
    id: "badge-forced-removal",
    description:
      "A forcibly-removed badge or a tampered reader case is a hard deny — physical binding was broken under duress.",
    match: [{ field: "badgeState", in: ["forced"] }],
    outcome: "deny",
    reasonCode: "BADGE_FORCED_REMOVAL",
    severity: "critical",
  },
  {
    id: "badge-removed",
    description:
      "The assigned worker's badge was withdrawn from the reader case — the shared-device session is restricted until the badge is re-bound.",
    match: [{ field: "badgeState", in: ["removed"] }],
    outcome: "restrict",
    reasonCode: "BADGE_REMOVED",
    severity: "high",
  },
  {
    id: "baseline-drifted",
    description:
      "A device that has materially drifted from its assigned security (CIS/hardening) baseline requires step-up before a session.",
    match: [{ field: "baselineState", in: ["drifted"] }],
    outcome: "step_up",
    reasonCode: "BASELINE_DRIFTED",
    severity: "medium",
  },
  // Matches ONLY the affirmative bad state. `unverified` is deliberately excluded
  // from this ACTIVE rule: nothing emits the benchmark_selection signal until a
  // connector is wired, so a rule matching the default value would step up the
  // entire fleet on day one. The unverified arm ships in the v2 STRICT draft,
  // where a tenant opts into demanding a positively-established selection.
  {
    id: "benchmark-selection-misfit",
    description:
      "The hardening result rests on the WRONG benchmark — another platform's document, an empty assessment, or one this workflow does not accept — so the baseline answer is unreliable whatever it says.",
    match: [{ field: "benchmarkSelectionState", in: ["misfit"] }],
    outcome: "step_up",
    reasonCode: "BENCHMARK_SELECTION_MISFIT",
    severity: "medium",
  },
  // Same day-one-quiet shape for the labor plane: the ACTIVE rule matches only the
  // affirmative mismatch (scheduled-but-clocked-out, off-duty operation, wrong
  // site). `unverified` — the default until a WFM connector emits the signal —
  // stays quiet in v1 and ships as the v2 STRICT arm below.
  {
    id: "shift-context-misfit",
    description:
      "The labor plane disagrees with this moment — the worker is scheduled but clocked out, operating while off duty, or at a site their shift does not place them — so step up before the action proceeds.",
    match: [{ field: "shiftContextState", in: ["misfit"] }],
    outcome: "step_up",
    reasonCode: "SHIFT_CONTEXT_MISFIT",
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

/**
 * Stricter shared-device policy (v2 draft). Tightens four rules relative to v1
 * so a decision replayed against v2 can diverge — useful for demonstrating
 * versioned-policy simulation:
 *  - stale/expired posture escalates to RESTRICT (v1: step-up)
 *  - unknown identity state escalates to DENY (v1: step-up)
 *  - security-baseline drift escalates to RESTRICT (v1: step-up)
 *  - a wrong-benchmark (misfit) hardening result WIDENS to also match
 *    `unverified` (v1: misfit only). This is the deferred arm: only a tenant
 *    that has opted into the strict draft asks every device to positively
 *    establish its benchmark selection — v1 never punishes the default.
 */
export const SHARED_DEVICE_RULES_V2: PolicyRuleSpec[] = SHARED_DEVICE_RULES_V1.map(
  (rule) => {
    if (rule.id === "posture-stale") {
      return {
        ...rule,
        outcome: "restrict",
        reasonCode: "POSTURE_STALE_STRICT",
        severity: "high",
      };
    }
    if (rule.id === "identity-unknown") {
      return {
        ...rule,
        outcome: "deny",
        reasonCode: "IDENTITY_STATE_UNKNOWN_STRICT",
        severity: "critical",
      };
    }
    if (rule.id === "baseline-drifted") {
      return {
        ...rule,
        outcome: "restrict",
        reasonCode: "BASELINE_DRIFTED_STRICT",
        severity: "high",
      };
    }
    if (rule.id === "benchmark-selection-misfit") {
      return {
        ...rule,
        match: [{ field: "benchmarkSelectionState", in: ["misfit", "unverified"] }],
        reasonCode: "BENCHMARK_SELECTION_UNESTABLISHED_STRICT",
        severity: "high",
      };
    }
    if (rule.id === "shift-context-misfit") {
      return {
        ...rule,
        match: [{ field: "shiftContextState", in: ["misfit", "unverified"] }],
        reasonCode: "SHIFT_CONTEXT_UNESTABLISHED_STRICT",
        severity: "high",
      };
    }
    return rule;
  },
);
