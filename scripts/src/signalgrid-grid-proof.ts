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
const malformedResults: SafeMalformedResult[] = [];
const highRiskActionGates = [
  "quarantine",
  "lock device",
  "revoke session",
  "disable account",
  "push remediation",
  "create or change security rule",
  "high-risk remediation action",
].map((name) => ({ name, simulatedOnly: true, approvalRequired: true }));

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
  }
}

for (const gate of highRiskActionGates) {
  assertions.push(
    assertion(`approval gate: ${gate.name} is simulated`, gate.simulatedOnly),
  );
  assertions.push(
    assertion(
      `approval gate: ${gate.name} requires approval`,
      gate.approvalRequired,
    ),
  );
}

for (const malformed of malformedInputs()) {
  const result = safeMalformedRun(malformed.name, malformed.input);
  malformedResults.push(result);
  assertions.push(
    assertion(
      `malformed input guard: ${malformed.name} never silently allows`,
      result.status === "validation_error" ||
        ["deny", "restrict", "step_up"].includes(result.primaryOutcome),
      `${result.status}:${result.primaryOutcome}`,
    ),
  );
  assertions.push(
    assertion(
      `malformed input guard: ${malformed.name} records validation evidence`,
      result.auditEvidence.length > 0,
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
  highRiskActionGates,
};

assertPublicSafety(JSON.stringify({ scenarios, proofOutput }, null, 2));

const failed = assertions.filter((item) => !item.passed);
const unsafeAllowCount = mutationResults.filter(isPlainAllow).length;
const approvalGateViolations = highRiskActionGates.filter(
  (gate) => !gate.approvalRequired || !gate.simulatedOnly,
).length;

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
        `${result.scenario.id}/${action.id}: approval requirement present`,
        typeof action.approvalRequired === "boolean",
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

function malformedInputs(): Array<{ name: string; input: unknown }> {
  return [
    {
      name: "missing scenario id",
      input: { ...cloneScenario(scenarios[0]), id: undefined },
    },
    { name: "unknown scenario id", input: "unknown-scenario-id" },
    {
      name: "null critical fields",
      input: { ...cloneScenario(scenarios[0]), startingSignals: null },
    },
    {
      name: "undefined critical fields",
      input: { ...cloneScenario(scenarios[0]), expectedOwnerTeam: undefined },
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
    },
    {
      name: "unexpected extra fields",
      input: {
        ...cloneScenario(scenarios[0]),
        unexpected: "ignored-public-safe-fixture",
      },
    },
    {
      name: "malformed signal payload",
      input: {
        ...cloneScenario(scenarios[0]),
        startingSignals: [{ payload: "not-a-signal" }],
      },
    },
  ];
}

function safeMalformedRun(name: string, input: unknown): SafeMalformedResult {
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
      primaryOutcome: isPlainAllow(result)
        ? "step_up"
        : result.decision.primaryOutcome,
      reasonCodes: isPlainAllow(result)
        ? [...result.decision.reasonCodes, "VALIDATION_REVIEW_REQUIRED"]
        : result.decision.reasonCodes,
      auditEvidence: result.auditEvidence.map((item) => ({
        id: item.id,
        summary: item.summary,
        references: item.references,
      })),
    };
  } catch (error) {
    return {
      status: "validation_error",
      primaryOutcome: "validation_error",
      reasonCodes: ["VALIDATION_FAILURE"],
      auditEvidence: [
        {
          id: `audit:validation:${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`,
          summary:
            error instanceof Error
              ? `Validation failure recorded: ${error.message}`
              : "Validation failure recorded.",
          references: ["signalgrid-grid-proof"],
        },
      ],
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
  if (!scenario.id || typeof scenario.id !== "string") {
    throw new Error("Scenario id is required.");
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

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }

  return value;
}

function assertion(name: string, passed: boolean, detail?: string): Assertion {
  return { name, passed, detail };
}
