import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listSimulatorScenarios,
  runScenario,
  runSimulatorScenario,
  type DecisionOutcome,
  type RoutedAction,
  type SignalGridSignal,
  type SimulatorRunResult,
  type SimulatorScenario,
} from "@workspace/signalgrid-simulator";

interface Assertion {
  name: string;
  passed: boolean;
  detail?: string;
}

interface MutationSpec {
  id: string;
  summary: string;
  signal: SignalGridSignal;
  unsafeAllowGuard: boolean;
}

interface SafeMalformedResult {
  status: "validation_error" | "safe_decision";
  primaryOutcome: DecisionOutcome | "validation_error";
  reasonCodes: string[];
  auditEvidence: Array<{ id: string; summary: string; references: string[] }>;
  /** The message the guard actually threw. Empty on the safe_decision path. */
  rejectionMessage: string;
  /** Did the DECLARED guard reject this input, or did something else break? */
  matchedExpectedGuard: boolean;
}

const fixtureTimestamp = "2026-06-09T14:05:00.000Z";
const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const evidencePath = path.join(
  repoRoot,
  "artifacts",
  "proof",
  "signalgrid-grid-proof.json",
);
const evidencePathForSummary = path.relative(repoRoot, evidencePath);
const scenarios = listSimulatorScenarios();
const baselineResults = scenarios.map(runScenario);
const assertions: Assertion[] = [];
const mutationResults: SimulatorRunResult[] = [];
// These two sets MUST be initialised before the malformed-input loop runs.
// They used to sit ~650 lines below, after validateScenarioInput's definition
// but far below the top-level loop that calls it. `const` is not hoisted, so
// the enum check reached them inside the temporal dead zone and threw
// ReferenceError: Cannot access 'allowedSignalTypes' before initialization.
// The "invalid enum values" case therefore never tested the enum guard at all
// — it crashed, and the old fail-open catch recorded that crash as the guard
// working. The rewritten assertions surfaced it on their first run.
const allowedSignalTypes = new Set<SignalGridSignal["type"]>([
  "identity.authenticated",
  "identity.risk_detected",
  "apple.ddm_declared_state",
  "apple.platform_sso_status",
  "apple.audit_event_recorded",
  "device.configuration_observed",
  "device.enrollment_observed",
  "device.posture_observed",
  "device.non_compliant",
  "device.stale_checkin",
  "device.low_battery",
  "device.health_degraded",
  "dock.device_docked",
  "dock.device_undocked",
  "dock.wrong_slot_return",
  "dock.device_missing",
  "rtls.location_observed",
  "rtls.wrong_zone",
  "rts.staff_safety_alert",
  "workflow.assignment_changed",
  "api.integration_failed",
  "ticket.created",
  "ticket.updated",
  "remediation.requested",
  "remediation.verified",
  "audit.recorded",
]);
const allowedSeverity = new Set<SignalGridSignal["severity"]>([
  "info",
  "low",
  "medium",
  "high",
  "critical",
]);

const malformedResults: SafeMalformedResult[] = [];
/**
 * Action kinds that would CHANGE something on a device or an account.
 *
 * WHY THIS IS A DENYLIST AND NOT A GATE LIST. This was an array of seven names
 * `.map`ped to `{ simulatedOnly: true, approvalRequired: true }` — the flags were
 * stamped on by the proof itself, and the violation counter then filtered that same
 * array for an element where either flag was `false`. It was structurally zero.
 * Fourteen assertions read the same two literals, and the fabricated array was
 * serialised into the published evidence file, so a reader was told seven named
 * high-risk gates had been checked when nothing had been.
 *
 * Worse, the names corresponded to nothing: across the baseline plus every
 * mutation, the simulator emits only alert_operator, create_ticket, queue_retry,
 * record_audit, request_remediation, route_to_owner and verify_remediation. Not one
 * of the seven appears.
 *
 * That absence IS the real claim, and it is checkable. The assertions below derive
 * everything from the actions actually routed, and each one can fail.
 */
const DEVICE_MUTATING_KINDS = new Set([
  "quarantine",
  "lock_device",
  "revoke_session",
  "disable_account",
  "push_remediation",
  "change_security_rule",
]);
const custodyAllowBlockedMutations = new Set([
  "rtls-wrong-zone",
  "location-unknown",
  "dockbridge-missing-return",
  "overdue-checkout",
  "wrong-bay-return",
]);

const hashes = Array.from({ length: 3 }, () =>
  hashForResults(
    scenarios.map((scenario) => runScenario(cloneScenario(scenario))),
  ),
);
const determinismHash = hashes[0] ?? "missing";
assertions.push(
  assertion(
    "determinism: repeated scenario hash is stable",
    hashes.every((hash) => hash === determinismHash),
    hashes.join(", "),
  ),
);
// SELF-TEST ON THE COMPARATOR THAT MINTS THAT HASH. The check above runs three times
// in ONE process, so it shares a locale with itself and cannot see a locale-dependent
// comparator at all. These keys are ordered one way by codepoint ("B" < "a", because
// uppercase sorts first in ASCII) and the other way by `localeCompare` under every
// locale this repo has been run in. If `sortValue` ever reverts to `localeCompare`,
// this assertion fails HERE rather than on someone else's machine.
{
  const LOCALE_DIVERGENT_KEYS = ["a", "B"] as const;
  const codepointOrder = [...LOCALE_DIVERGENT_KEYS].sort(codepointCompare);
  const localeOrder = [...LOCALE_DIVERGENT_KEYS].sort((l, r) => l.localeCompare(r));
  const sorted = Object.keys(
    sortValue({ a: 1, B: 2 }) as Record<string, unknown>,
  );
  assertions.push(
    assertion(
      "determinism: the evidence comparator is CODEPOINT order, not localeCompare",
      JSON.stringify(sorted) === JSON.stringify(codepointOrder),
      `sortValue=[${sorted.join(", ")}] codepoint=[${codepointOrder.join(", ")}] locale=[${localeOrder.join(", ")}]`,
    ),
  );
  // NON-VACUITY: the two comparators must actually disagree on this pair, or the
  // assertion above passes under both and proves nothing.
  assertions.push(
    assertion(
      "determinism: …and the probe pair is one the two comparators order DIFFERENTLY",
      JSON.stringify(codepointOrder) !== JSON.stringify(localeOrder),
      `codepoint=[${codepointOrder.join(", ")}] locale=[${localeOrder.join(", ")}]`,
    ),
  );
}

for (const result of baselineResults) {
  assertBaselineCoverage(result);
  assertEvidenceIntegrity(result);
  assertRouteOwnership(result);
}

for (const scenario of scenarios) {
  const baseline = runScenario(cloneScenario(scenario));

  for (const mutation of mutationSpecsFor(scenario)) {
    const mutated = runScenario({
      ...cloneScenario(scenario),
      id: `${scenario.id}--${mutation.id}`,
      title: `${scenario.title} / ${mutation.summary}`,
      startingSignals: [
        ...cloneScenario(scenario).startingSignals,
        mutation.signal,
      ],
      expectedOutcomes: ["record_audit"],
    });

    mutationResults.push(mutated);
    assertions.push(
      assertion(
        `mutation ${scenario.id}/${mutation.id}: risk never silently decreases`,
        riskScore(mutated.decision.primaryOutcome) >=
          riskScore(baseline.decision.primaryOutcome),
        `${baseline.decision.primaryOutcome} -> ${mutated.decision.primaryOutcome}`,
      ),
    );

    if (mutation.unsafeAllowGuard) {
      assertions.push(
        assertion(
          `unsafe allow guard ${scenario.id}/${mutation.id}`,
          !isPlainAllow(mutated),
          mutated.decision.outcomes.join(","),
        ),
      );
    }

    if (custodyAllowBlockedMutations.has(mutation.id)) {
      assertions.push(
        assertion(
          `custody allow guard ${scenario.id}/${mutation.id}`,
          !mutated.decision.outcomes.includes("allow"),
          mutated.decision.outcomes.join(","),
        ),
      );
    }
  }
}

// ── What the routed actions actually are, derived rather than declared ────────
//
// Every assertion in this block reads the actions the simulator emitted during
// this run. Nothing is stamped on by the proof.
const routedActionsAll = [...baselineResults, ...mutationResults].flatMap(
  (result) => result.routedActions,
);
const emittedKinds = new Set(routedActionsAll.map((action) => action.kind));

// NON-VACUITY FIRST. Without this the three checks below pass trivially on an
// empty set, which is exactly how the version this replaced managed to prove
// nothing while reporting success.
assertions.push(
  assertion(
    `routed actions: the set is non-empty (${routedActionsAll.length} across ${emittedKinds.size} kinds)`,
    routedActionsAll.length > 0 && emittedKinds.size > 0,
  ),
);

// THE CLAIM THE FABRICATED LIST WAS GESTURING AT, now checkable: this simulator
// never routes an action that would change a device or an account.
const mutatingEmitted = [...emittedKinds].filter((kind) =>
  DEVICE_MUTATING_KINDS.has(kind),
);
assertions.push(
  assertion(
    "no routed action is a device-mutating kind",
    mutatingEmitted.length === 0,
  ),
);

// THE INVARIANT THAT ACTUALLY HOLDS ACROSS EVERY ACTION. Measured before it was
// asserted: 0 violations across every routed action in the baseline and all
// mutations.
const notSimulated = routedActionsAll.filter(
  (action) => action.simulatedOnly !== true,
);
assertions.push(
  assertion(
    "every routed action is marked simulated-only",
    notSimulated.length === 0,
  ),
);

// APPROVAL, STATED HONESTLY. "High severity implies approval" is NOT true here and
// is deliberately not asserted: of the routed actions at high or critical severity,
// well over half carry approvalRequired: false — create_ticket, queue_retry and
// route_to_owner are notification and bookkeeping, not changes to a device. What IS
// true is that the one kind which ASKS for a change is approval-gated, and that is
// the assertion worth having.
const remediationRequests = routedActionsAll.filter(
  (action) => action.kind === "request_remediation",
);
assertions.push(
  assertion(
    `request_remediation is approval-gated (${remediationRequests.length} emitted)`,
    remediationRequests.length > 0 &&
      remediationRequests.every((action) => action.approvalRequired === true),
  ),
);

for (const malformed of malformedInputs()) {
  const result = safeMalformedRun(
    malformed.name,
    malformed.input,
    malformed.expectRejectedBy,
  );
  malformedResults.push(result);
  assertions.push(
    assertion(
      `malformed input guard: ${malformed.name} never silently allows`,
      result.status === "validation_error"
        ? result.matchedExpectedGuard
        : ["deny", "restrict", "step_up"].includes(result.primaryOutcome),
      `${result.status}:${result.primaryOutcome}:${result.rejectionMessage || "(no rejection)"}`,
    ),
  );
  assertions.push(
    assertion(
      // The old form of this assertion read auditEvidence.length > 0 against an
      // array the catch block had just built. It now demands that the input was
      // turned away by the guard the case DECLARES, so a rejection arriving from
      // an unrelated crash fails instead of passing.
      `malformed input guard: ${malformed.name} is refused by its declared guard, not by an unrelated crash`,
      result.status === "validation_error"
        ? result.matchedExpectedGuard &&
            malformed.expectRejectedBy.test(result.rejectionMessage)
        : result.auditEvidence.length > 0,
      result.rejectionMessage || `${result.auditEvidence.length} audit records`,
    ),
  );
}

const proofOutput = {
  proof: "signalgrid-grid-proof",
  fixtureTimestamp,
  policyVersion: "simulator-fixture-v1",
  totalScenarios: scenarios.length,
  totalMutations: mutationResults.length,
  determinismHash,
  baseline: baselineResults.map(toEvidenceRecord),
  mutations: mutationResults.map(toEvidenceRecord),
  malformed: malformedResults,
  // The fabricated `highRiskActionGates` array used to be serialised here, so the
  // invented result left the proof as published evidence. Replaced by what was
  // actually observed.
  routedActionKinds: [...emittedKinds].sort(),
  deviceMutatingKindsEmitted: mutatingEmitted.sort(),
  routedActionCount: routedActionsAll.length,
};

assertPublicSafety(JSON.stringify({ scenarios, proofOutput }, null, 2));

const failed = assertions.filter((item) => !item.passed);
const unsafeAllowCount = mutationResults.filter(isPlainAllow).length;
// Counted from the actions the simulator ROUTED, not from a literal this file
// wrote. A device-mutating kind appearing at all, or any action not marked
// simulated-only, is a violation.
const approvalGateViolations =
  mutatingEmitted.length + notSimulated.length;

mkdirSync(path.dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, `${stableStringify(proofOutput)}\n`);

console.log("SignalGrid grid proof summary");
console.log(`- total scenarios: ${scenarios.length}`);
console.log(`- total mutations: ${mutationResults.length}`);
console.log(`- total assertions: ${assertions.length}`);
console.log(
  `- pass/fail count: ${assertions.length - failed.length}/${failed.length}`,
);
console.log(`- unsafe allow count: ${unsafeAllowCount}`);
console.log(`- approval-gate violations: ${approvalGateViolations}`);
console.log(`- determinism hash: ${determinismHash}`);
console.log(`- generated evidence file path: ${evidencePathForSummary}`);

if (failed.length > 0 || unsafeAllowCount > 0 || approvalGateViolations > 0) {
  console.error("Failed SignalGrid grid proof assertions:");
  for (const item of failed) {
    console.error(`- ${item.name}${item.detail ? ` (${item.detail})` : ""}`);
  }
  process.exit(1);
}

function assertBaselineCoverage(result: SimulatorRunResult): void {
  assertions.push(
    assertion(
      `${result.scenario.id}: scenario id exists`,
      Boolean(result.scenario.id),
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: normalized signals exist`,
      result.normalizedSignals.length > 0 &&
        result.normalizedSignals.every(
          (signal) => signal.attributes.normalized === true,
        ),
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: trust decision exists`,
      Boolean(result.decision.primaryOutcome),
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: reason codes exist`,
      result.decision.reasonCodes.length > 0,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: baseline decision matches expected outcomes`,
      result.status === "PASS",
      `status=${result.status} expected=[${result.scenario.expectedOutcomes.join(",")}] actual=[${result.decision.outcomes.join(",")}]`,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: routed actions exist`,
      result.routedActions.length > 0,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: audit evidence exists`,
      result.auditEvidence.length > 0,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: simulated verification state exists`,
      toEvidenceRecord(result).simulatedVerificationState.length > 0,
    ),
  );
}

function assertEvidenceIntegrity(result: SimulatorRunResult): void {
  const record = toEvidenceRecord(result);
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence correlation id`,
      Boolean(record.correlationId),
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence scenario id`,
      record.scenarioId === result.scenario.id,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence policy version`,
      Boolean(record.policyVersion),
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence source signal summary`,
      record.sourceSignalSummary.length === result.normalizedSignals.length,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence reason codes`,
      record.reasonCodes.length === result.decision.reasonCodes.length,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence routed action summary`,
      record.routedActionSummary.length === result.routedActions.length,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: evidence verification state`,
      record.simulatedVerificationState.length > 0,
    ),
  );
  assertions.push(
    assertion(
      `${result.scenario.id}: deterministic timestamp`,
      record.fixtureTimestamp === fixtureTimestamp,
    ),
  );
}

function assertRouteOwnership(result: SimulatorRunResult): void {
  for (const action of result.routedActions) {
    assertions.push(
      assertion(
        `${result.scenario.id}/${action.id}: owner category`,
        Boolean(action.ownerCategory),
      ),
    );
    assertions.push(
      assertion(
        `${result.scenario.id}/${action.id}: destination system`,
        Boolean(action.destinationSystem),
      ),
    );
    assertions.push(
      assertion(
        `${result.scenario.id}/${action.id}: severity`,
        Boolean(action.severity),
      ),
    );
    assertions.push(
      assertion(
        // `typeof action.approvalRequired === "boolean"` was the old test, and
        // `false` is a boolean — an action that dropped its approval requirement
        // passed it. Pin the VALUE against the kind's own contract instead.
        `${result.scenario.id}/${action.id}: approval requirement matches its kind`,
        action.approvalRequired ===
          (action.kind === "request_remediation" ||
            action.kind === "alert_operator"),
      ),
    );
    assertions.push(
      assertion(
        `${result.scenario.id}/${action.id}: simulated marker`,
        action.simulatedOnly === true,
      ),
    );
    assertions.push(
      assertion(
        `${result.scenario.id}/${action.id}: verification expectation`,
        Boolean(action.verificationExpectation),
      ),
    );
  }
}

function mutationSpecsFor(scenario: SimulatorScenario): MutationSpec[] {
  return [
    mutation(
      scenario,
      "identity-invalid",
      "Identity invalid",
      "identity.risk_detected",
      "identity",
      "Identity fixture",
      "user:invalid-fixture",
      "high",
      { identityState: "invalid", risk: "high" },
      true,
    ),
    mutation(
      scenario,
      "identity-disabled",
      "Identity disabled",
      "identity.risk_detected",
      "identity",
      "Identity fixture",
      "user:disabled-fixture",
      "high",
      { identityState: "disabled" },
      true,
    ),
    mutation(
      scenario,
      "identity-high-risk",
      "Identity high-risk",
      "identity.risk_detected",
      "identity",
      "Identity risk fixture",
      "user:risk-fixture",
      "high",
      { risk: "high" },
      true,
    ),
    mutation(
      scenario,
      "device-non-compliant",
      "Device non-compliant",
      "device.non_compliant",
      "device",
      "Device posture fixture",
      "device:mutation-noncompliant",
      "high",
      { compliance: "non_compliant" },
      false,
    ),
    mutation(
      scenario,
      "device-stale",
      "Device stale",
      "device.stale_checkin",
      "device",
      "Device posture fixture",
      "device:mutation-stale",
      "medium",
      { freshness: "stale" },
      false,
    ),
    mutation(
      scenario,
      "device-unmanaged",
      "Device unmanaged",
      "device.non_compliant",
      "device",
      "Device posture fixture",
      "device:mutation-unmanaged",
      "high",
      { managementState: "unmanaged" },
      false,
    ),
    mutation(
      scenario,
      "device-state-degraded",
      "Device state degraded",
      "device.health_degraded",
      "operational_health",
      "DEX fixture",
      "device:mutation-health",
      "medium",
      { state: "degraded" },
      false,
    ),
    mutation(
      scenario,
      "apple-ddm-stale",
      "Apple DDM stale",
      "apple.ddm_declared_state",
      "device_state_compliance",
      "Apple DDM fixture",
      "device:mutation-ddm",
      "medium",
      { declaredState: "stale" },
      false,
    ),
    mutation(
      scenario,
      "platform-sso-missing",
      "Platform SSO missing",
      "apple.platform_sso_status",
      "device_state_compliance",
      "Apple Platform SSO fixture",
      "device:mutation-sso",
      "medium",
      { ssoStatus: "missing" },
      false,
    ),
    mutation(
      scenario,
      "dex-degraded",
      "Operational health degraded",
      "device.health_degraded",
      "operational_health",
      "DEX fixture",
      "device:mutation-dex",
      "medium",
      { appCrashes: 4, latencyMs: 1600 },
      false,
    ),
    mutation(
      scenario,
      "api-health-degraded",
      "Application/API health degraded",
      "api.integration_failed",
      "integration",
      "Integration health fixture",
      "integration:mutation-api",
      "high",
      { state: "unavailable" },
      false,
    ),
    mutation(
      scenario,
      "rtls-wrong-zone",
      "RTLS wrong zone",
      "rtls.wrong_zone",
      "location",
      "RTLS fixture",
      "asset:mutation-zone",
      "high",
      { zone: "wrong" },
      true,
    ),
    mutation(
      scenario,
      "location-unknown",
      "Location unknown",
      "rtls.location_observed",
      "location",
      "RTLS fixture",
      "asset:mutation-unknown",
      "medium",
      { location: "unknown" },
      false,
    ),
    mutation(
      scenario,
      "dockbridge-missing-return",
      "DockBridge missing return",
      "dock.device_missing",
      "dockbridge",
      "DockBridge fixture",
      "slot:mutation-missing",
      "critical",
      { missingReturn: true },
      true,
    ),
    mutation(
      scenario,
      "overdue-checkout",
      "Overdue checkout",
      "dock.device_missing",
      "dockbridge",
      "DockBridge fixture",
      "slot:mutation-overdue",
      "critical",
      { overdue: true },
      true,
    ),
    mutation(
      scenario,
      "wrong-bay-return",
      "Wrong bay return",
      "dock.wrong_slot_return",
      "dockbridge",
      "DockBridge fixture",
      "slot:mutation-wrong",
      "high",
      { returnBay: "wrong" },
      true,
    ),
    mutation(
      scenario,
      "workflow-owner-missing",
      "Workflow owner missing",
      "workflow.assignment_changed",
      "workflow",
      "Workflow fixture",
      "workflow:mutation-owner",
      "medium",
      { workflowOwner: "missing" },
      false,
    ),
    mutation(
      scenario,
      "escalation-destination-unavailable",
      "Escalation destination unavailable",
      "api.integration_failed",
      "integration",
      "Integration health fixture",
      "integration:mutation-escalation",
      "high",
      { escalationDestination: "unavailable" },
      false,
    ),
    mutation(
      scenario,
      "edr-high-risk",
      "EDR high risk",
      "device.posture_observed",
      "device",
      "EDR fixture",
      "device:mutation-edr",
      "critical",
      { edrRisk: "high", securityRisk: "high" },
      true,
    ),
    mutation(
      scenario,
      "integration-source-unavailable",
      "Integration source unavailable",
      "api.integration_failed",
      "integration",
      "Integration fixture",
      "integration:mutation-source",
      "high",
      { sourceIntegrity: "failed" },
      true,
    ),
    mutation(
      scenario,
      "malformed-critical-input",
      "Malformed critical input",
      "audit.recorded",
      "audit",
      "Validation fixture",
      "audit:mutation-malformed",
      "high",
      { criticalInput: "malformed" },
      true,
    ),
  ];
}

function mutation(
  scenario: SimulatorScenario,
  id: string,
  summary: string,
  type: SignalGridSignal["type"],
  layer: SignalGridSignal["layer"],
  source: string,
  subject: string,
  severity: SignalGridSignal["severity"],
  attributes: SignalGridSignal["attributes"],
  unsafeAllowGuard: boolean,
): MutationSpec {
  return {
    id,
    summary,
    unsafeAllowGuard,
    signal: {
      id: `${type}:${scenario.id}:${id}`.replace(/[^a-zA-Z0-9:_-]/g, "-"),
      type,
      layer,
      source,
      subject,
      observedAt: "2026-06-09T14:00:00.000Z",
      severity,
      summary,
      attributes,
    },
  };
}

function malformedInputs(): Array<{
  name: string;
  input: unknown;
  expectRejectedBy: RegExp;
}> {
  return [
    {
      name: "missing scenario id",
      input: { ...cloneScenario(scenarios[0]), id: undefined },
      expectRejectedBy: /Scenario id is required/,
    },
    {
      name: "unknown scenario id",
      input: "unknown-scenario-id",
      expectRejectedBy: /Unknown simulator scenario/,
    },
    {
      name: "null critical fields",
      input: { ...cloneScenario(scenarios[0]), startingSignals: null },
      expectRejectedBy: /startingSignals must be an array/,
    },
    {
      name: "undefined critical fields",
      input: { ...cloneScenario(scenarios[0]), expectedOwnerTeam: undefined },
      expectRejectedBy: /expectedOwnerTeam is required/,
    },
    {
      name: "invalid enum values",
      input: {
        ...cloneScenario(scenarios[0]),
        startingSignals: [
          {
            ...scenarios[0]?.startingSignals[0],
            type: "invalid.enum",
            severity: "urgent",
          },
        ],
      },
      expectRejectedBy: /invalid enum value/,
    },
    {
      name: "unexpected extra fields",
      input: {
        ...cloneScenario(scenarios[0]),
        unexpected: "ignored-public-safe-fixture",
      },
      expectRejectedBy: /Unexpected scenario fields/,
    },
    {
      name: "malformed signal payload",
      input: {
        ...cloneScenario(scenarios[0]),
        startingSignals: [{ payload: "not-a-signal" }],
      },
      expectRejectedBy: /Signal payload is incomplete/,
    },
  ];
}

// WHY THIS FUNCTION LOOKS THE WAY IT DOES.
//
// It used to catch every error and RETURN a synthesized result: status
// "validation_error", reasonCodes ["VALIDATION_FAILURE"], and a one-element
// auditEvidence array built right here in the catch block. The two assertions
// downstream then checked that status was "validation_error" and that
// auditEvidence.length > 0 — both against data this catch had just written.
// All seven malformed inputs throw, so all fourteen assertions passed
// unconditionally, and nothing in the simulator was exercised on this path.
//
// Worse than unfailable: it was fail-OPEN. Any error at all became "the guard
// worked". A TypeError from an unrelated regression inside runScenario would
// have been recorded as proof that malformed input is safely rejected.
//
// Now the caller DECLARES which guard must reject each input, the catch
// reports the real thrown message instead of inventing evidence, and an
// unexpected error fails the proof — which is the only way this path can say
// anything true about the guards.
function safeMalformedRun(
  name: string,
  input: unknown,
  expectRejectedBy: RegExp,
): SafeMalformedResult {
  try {
    let result: SimulatorRunResult;
    if (typeof input === "string") {
      result = runSimulatorScenario(input);
    } else {
      validateScenarioInput(input);
      result = runScenario(input as SimulatorScenario);
    }

    return {
      status: "safe_decision",
      primaryOutcome: result.decision.primaryOutcome,
      reasonCodes: result.decision.reasonCodes,
      auditEvidence: result.auditEvidence.map((item) => ({
        id: item.id,
        summary: item.summary,
        references: item.references,
      })),
      rejectionMessage: "",
      matchedExpectedGuard: false,
    };
  } catch (error) {
    const rejectionMessage =
      error instanceof Error ? error.message : String(error);
    return {
      status: "validation_error",
      primaryOutcome: "validation_error",
      reasonCodes: ["VALIDATION_FAILURE"],
      // Deliberately EMPTY. Evidence minted by the catch block is evidence of
      // the catch block, and asserting on it proved only that this file can
      // build an array.
      auditEvidence: [],
      rejectionMessage,
      matchedExpectedGuard: expectRejectedBy.test(rejectionMessage),
    };
  }
}

function validateScenarioInput(
  input: unknown,
): asserts input is SimulatorScenario {
  if (!input || typeof input !== "object") {
    throw new Error("Scenario input must be an object.");
  }

  const scenario = input as Partial<SimulatorScenario>;
  const allowedScenarioKeys = new Set([
    "id",
    "title",
    "summary",
    "persona",
    "startingSignals",
    "expectedOutcomes",
    "expectedOwnerTeam",
    "safeDemoNote",
  ]);
  const unexpectedKeys = Object.keys(input).filter(
    (key) => !allowedScenarioKeys.has(key),
  );

  if (unexpectedKeys.length > 0) {
    throw new Error(
      `Unexpected scenario fields: ${unexpectedKeys.join(", ")}.`,
    );
  }

  if (!scenario.id || typeof scenario.id !== "string") {
    throw new Error("Scenario id is required.");
  }

  if (
    !scenario.expectedOwnerTeam ||
    typeof scenario.expectedOwnerTeam !== "string"
  ) {
    throw new Error("Scenario expectedOwnerTeam is required.");
  }

  if (!Array.isArray(scenario.startingSignals)) {
    throw new Error("Scenario startingSignals must be an array.");
  }

  for (const signal of scenario.startingSignals) {
    if (!signal || typeof signal !== "object") {
      throw new Error("Signal must be an object.");
    }

    const maybeSignal = signal as Partial<SignalGridSignal>;
    if (
      !maybeSignal.id ||
      !maybeSignal.type ||
      !maybeSignal.layer ||
      !maybeSignal.severity ||
      !maybeSignal.attributes ||
      typeof maybeSignal.attributes !== "object"
    ) {
      throw new Error("Signal payload is incomplete.");
    }

    if (
      !allowedSignalTypes.has(maybeSignal.type) ||
      !allowedSeverity.has(maybeSignal.severity)
    ) {
      throw new Error("Signal payload contains an invalid enum value.");
    }
  }
}


function toEvidenceRecord(result: SimulatorRunResult) {
  return {
    correlationId: `corr:${result.scenario.id}`,
    scenarioId: result.scenario.id,
    policyVersion: "simulator-fixture-v1",
    fixtureTimestamp,
    decision: {
      id: result.decision.id,
      primaryOutcome: result.decision.primaryOutcome,
      outcomes: result.decision.outcomes,
      confidence: result.decision.confidence,
    },
    sourceSignalSummary: result.normalizedSignals.map((signal) => ({
      id: signal.id,
      type: signal.type,
      layer: signal.layer,
      source: signal.source,
      severity: signal.severity,
      summary: signal.summary,
    })),
    reasonCodes: result.decision.reasonCodes,
    routedActionSummary: result.routedActions.map((action) => ({
      id: action.id,
      kind: action.kind,
      ownerCategory: action.ownerCategory,
      ownerTeam: action.ownerTeam,
      destinationSystem: action.destinationSystem,
      severity: action.severity,
      approvalRequired: action.approvalRequired,
      simulatedOnly: action.simulatedOnly,
      verificationExpectation: action.verificationExpectation,
    })),
    auditEvidence: result.auditEvidence.map((evidence) => ({
      id: evidence.id,
      recordedAt: evidence.recordedAt,
      evidenceType: evidence.evidenceType,
      references: evidence.references,
    })),
    simulatedVerificationState: result.routedActions.map((action) => ({
      actionId: action.id,
      status: action.status,
      expectation: action.verificationExpectation,
    })),
  };
}

function assertPublicSafety(content: string): void {
  const checks = [
    {
      name: "secret-like strings",
      pattern:
        /(api[_-]?key|secret|token|password)\s*[:=]\s*[a-z0-9_\-.]{12,}/i,
    },
    {
      name: "tenant IDs",
      pattern:
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
    },
    {
      name: "real-looking emails",
      pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    },
    {
      name: "phone numbers",
      pattern: /(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
    },
    {
      name: "patient/customer-like data",
      pattern: /\b(patient|customer)\s*[:=]\s*[A-Z][a-z]+\s+[A-Z][a-z]+\b/,
    },
    { name: "real vendor endpoint URLs", pattern: /https?:\/\//i },
    {
      name: "live API tokens",
      pattern: /\b(?:ghp|sk|xoxb|eyJ)[A-Za-z0-9_-]{16,}\b/,
    },
    {
      name: "proprietary screenshot references",
      pattern: /\b(?:proprietary|confidential).*\.(?:png|jpg|jpeg|webp)\b/i,
    },
  ];

  for (const check of checks) {
    assertions.push(
      assertion(`public safety: ${check.name}`, !check.pattern.test(content)),
    );
  }
}

function isPlainAllow(result: SimulatorRunResult): boolean {
  return (
    result.decision.primaryOutcome === "allow" &&
    result.decision.outcomes.every(
      (outcome) => outcome === "allow" || outcome === "record_audit",
    )
  );
}

function riskScore(outcome: DecisionOutcome): number {
  const scores: Record<DecisionOutcome, number> = {
    allow: 0,
    verify_remediation: 1,
    record_audit: 1,
    route_to_owner: 2,
    create_ticket: 3,
    alert_operator: 3,
    request_remediation: 4,
    step_up: 4,
    restrict: 5,
    deny: 6,
  };

  return scores[outcome];
}

function hashForResults(results: SimulatorRunResult[]): string {
  return createHash("sha256")
    .update(
      stableStringify(
        results.map((result) => ({
          scenarioId: result.scenario.id,
          normalizedSignals: result.normalizedSignals.map((signal) => ({
            id: signal.id,
            type: signal.type,
            layer: signal.layer,
            severity: signal.severity,
            attributes: signal.attributes,
          })),
          decision: result.decision,
          routedActions: result.routedActions,
          auditEvidence: result.auditEvidence,
        })),
      ),
    )
    .digest("hex");
}

function cloneScenario(
  scenario: SimulatorScenario | undefined,
): SimulatorScenario {
  if (!scenario) {
    throw new Error("Missing baseline scenario fixture.");
  }

  return JSON.parse(JSON.stringify(scenario)) as SimulatorScenario;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

/** CODEPOINT order, never `localeCompare`.
 *
 *  This function feeds `stableStringify` → `hashForResults` → the printed
 *  `determinismHash` and the generated evidence file, so its comparator decides a
 *  digest. `String.prototype.localeCompare` is locale- and ICU-build-dependent: the
 *  same keys can order differently under `sv_SE` than under `en_US`, which would make
 *  the digest a fact about the machine rather than about the run. Three sibling proofs
 *  in this directory forbid it for exactly this reason and say so in their comments
 *  (`signal-radar-proof.ts:59-64`, `signal-discovery-proof.ts:71-75`,
 *  `recommendations-proof.ts:92`), and `scripts/review-invariants.mjs` gates it — but
 *  only over `determinismScope()`, a lib/ derivation, so `scripts/src/*.ts` sat outside
 *  the gate that exists for it and this call survived until 2026-09-06.
 *
 *  Measured before the change: across the C, sv_SE.UTF-8, de_DE.UTF-8 and en_US.UTF-8
 *  locales the two comparators produced the same digest, because every key in the
 *  hashed structure is a lowercase ASCII identifier. It was a latent hazard, not a live
 *  defect — and it goes live the day a signal `attributes` object carries a mixed-case
 *  or non-ASCII key, which is caller-supplied data. The determinism check at :137-149
 *  could never have caught it: three runs in ONE process share a locale.
 *
 *  `codepointCompare` is asserted below against a key pair the two comparators order
 *  differently, so a silent revert to `localeCompare` fails rather than passing until
 *  someone changes locale. */
function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => codepointCompare(left, right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }

  return value;
}

function assertion(name: string, passed: boolean, detail?: string): Assertion {
  return { name, passed, detail };
}
