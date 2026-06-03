import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type LookupStatus = "found" | "missing" | "lookup_failed" | "malformed";
type ManagedState =
  | "managed"
  | "unmanaged"
  | "retired"
  | "inactive"
  | "unknown";
type ComplianceState =
  | "compliant"
  | "non_compliant"
  | "unknown"
  | "not_applicable";
type PostureFreshness = "fresh" | "stale" | "expired" | "unknown";
type Confidence = "high" | "medium" | "low" | "unknown";
type DecisionImpact =
  | "allow_candidate"
  | "step_up_or_review_candidate"
  | "deny_or_restrict_candidate"
  | "unknown_posture";

type ReasonCode =
  | "POSTURE_COMPLIANT_FRESH"
  | "POSTURE_NON_COMPLIANT"
  | "POSTURE_STALE_OR_UNKNOWN"
  | "POSTURE_DEVICE_NOT_FOUND"
  | "POSTURE_SOURCE_LOOKUP_FAILED"
  | "POSTURE_NOT_MANAGED_OR_INACTIVE";

interface SourcePayload {
  managedState: string;
  complianceState: string;
  lastCheckInAt: string;
  platform: string;
  ownershipContext?: string;
  rawReference: string;
  observedAt: string;
}

interface SourceFixture {
  caseId: string;
  description: string;
  environmentId: string;
  deviceId: string;
  lookupStatus: LookupStatus;
  payload?: SourcePayload;
  failureMode?: string;
  expectedDecisionImpact: DecisionImpact;
  expectedReasonCode: ReasonCode;
}

interface FixtureFile {
  proofName: string;
  proofVersion: string;
  sourceSystem: string;
  evaluatedAt: string;
  freshnessWindowHours: number;
  staleWindowHours: number;
  fixtures: SourceFixture[];
}

interface NormalizedPosture {
  deviceId: string;
  sourceSystem: string;
  managedState: ManagedState;
  complianceState: ComplianceState;
  postureFreshness: PostureFreshness;
  riskIndicators: string[];
  observedAt: string;
  rawReference: string;
  confidence: Confidence;
  decisionImpact: DecisionImpact;
}

interface AuditRecord {
  sourceSystem: string;
  lookupStartedAt: string;
  lookupCompletedAt: string;
  deviceId: string;
  normalizedPosture: NormalizedPosture;
  decisionOutcome: DecisionImpact;
  reasonCode: ReasonCode;
  policyVersion: string;
  rawReference: string;
  operatorOrAdminNote?: string;
  failureMode?: string;
}

interface CaseResult {
  caseId: string;
  passed: boolean;
  expectedDecisionImpact: DecisionImpact;
  actualDecisionImpact: DecisionImpact;
  expectedReasonCode: ReasonCode;
  actualReasonCode: ReasonCode;
  auditRecord: AuditRecord;
}

const defaultFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/intune-entra-posture/devices.json",
);

const lookupStatuses: LookupStatus[] = [
  "found",
  "missing",
  "lookup_failed",
  "malformed",
];
const decisionImpacts: DecisionImpact[] = [
  "allow_candidate",
  "step_up_or_review_candidate",
  "deny_or_restrict_candidate",
  "unknown_posture",
];
const reasonCodes: ReasonCode[] = [
  "POSTURE_COMPLIANT_FRESH",
  "POSTURE_NON_COMPLIANT",
  "POSTURE_STALE_OR_UNKNOWN",
  "POSTURE_DEVICE_NOT_FOUND",
  "POSTURE_SOURCE_LOOKUP_FAILED",
  "POSTURE_NOT_MANAGED_OR_INACTIVE",
];
const managedStates: ManagedState[] = [
  "managed",
  "unmanaged",
  "retired",
  "inactive",
  "unknown",
];
const complianceStates: ComplianceState[] = [
  "compliant",
  "non_compliant",
  "unknown",
  "not_applicable",
];
const postureFreshnessValues: PostureFreshness[] = [
  "fresh",
  "stale",
  "expired",
  "unknown",
];
const confidenceValues: Confidence[] = ["high", "medium", "low", "unknown"];

function normalizeManagedState(value: string | undefined): ManagedState {
  switch (value) {
    case "managed":
    case "unmanaged":
    case "retired":
    case "inactive":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function normalizeComplianceState(value: string | undefined): ComplianceState {
  switch (value) {
    case "compliant":
      return "compliant";
    case "nonCompliant":
    case "non_compliant":
      return "non_compliant";
    case "notApplicable":
    case "not_applicable":
      return "not_applicable";
    case "unknown":
      return "unknown";
    default:
      return "unknown";
  }
}

function classifyFreshness(
  lastCheckInAt: string | undefined,
  evaluatedAt: string,
  freshnessWindowHours: number,
  staleWindowHours: number,
): PostureFreshness {
  if (!lastCheckInAt) {
    return "unknown";
  }

  const lastCheckInMs = Date.parse(lastCheckInAt);
  const evaluatedMs = Date.parse(evaluatedAt);

  if (
    Number.isNaN(lastCheckInMs) ||
    Number.isNaN(evaluatedMs) ||
    lastCheckInMs > evaluatedMs
  ) {
    return "unknown";
  }

  const ageHours = (evaluatedMs - lastCheckInMs) / (1000 * 60 * 60);

  if (ageHours <= freshnessWindowHours) {
    return "fresh";
  }

  if (ageHours <= staleWindowHours) {
    return "stale";
  }

  return "expired";
}

function hasRequiredPayloadFields(
  payload: SourcePayload | undefined,
): payload is SourcePayload {
  return Boolean(
    payload?.managedState &&
    payload.complianceState &&
    payload.lastCheckInAt &&
    payload.platform &&
    payload.rawReference &&
    payload.observedAt,
  );
}

function buildUnknownPosture(
  fixture: SourceFixture,
  fixtureFile: FixtureFile,
  riskIndicator: string,
  reasonCode: ReasonCode,
): {
  normalizedPosture: NormalizedPosture;
  reasonCode: ReasonCode;
  failureMode?: string;
} {
  return {
    normalizedPosture: {
      deviceId: fixture.deviceId,
      sourceSystem: fixtureFile.sourceSystem,
      managedState: "unknown",
      complianceState: "unknown",
      postureFreshness: "unknown",
      riskIndicators: [riskIndicator],
      observedAt: fixtureFile.evaluatedAt,
      rawReference: `fixture:${fixture.caseId}`,
      confidence: "unknown",
      decisionImpact: "unknown_posture",
    },
    reasonCode,
    failureMode: fixture.failureMode ?? riskIndicator,
  };
}

function normalizePosture(
  fixture: SourceFixture,
  fixtureFile: FixtureFile,
): {
  normalizedPosture: NormalizedPosture;
  reasonCode: ReasonCode;
  failureMode?: string;
} {
  if (fixture.lookupStatus === "missing") {
    return buildUnknownPosture(
      fixture,
      fixtureFile,
      "missing_device",
      "POSTURE_DEVICE_NOT_FOUND",
    );
  }

  if (fixture.lookupStatus === "lookup_failed") {
    return buildUnknownPosture(
      fixture,
      fixtureFile,
      "source_lookup_failed",
      "POSTURE_SOURCE_LOOKUP_FAILED",
    );
  }

  if (
    fixture.lookupStatus === "malformed" ||
    !hasRequiredPayloadFields(fixture.payload)
  ) {
    return buildUnknownPosture(
      fixture,
      fixtureFile,
      "malformed_source_payload",
      "POSTURE_SOURCE_LOOKUP_FAILED",
    );
  }

  const managedState = normalizeManagedState(fixture.payload.managedState);
  const complianceState = normalizeComplianceState(
    fixture.payload.complianceState,
  );
  const postureFreshness = classifyFreshness(
    fixture.payload.lastCheckInAt,
    fixtureFile.evaluatedAt,
    fixtureFile.freshnessWindowHours,
    fixtureFile.staleWindowHours,
  );
  const riskIndicators: string[] = [];

  if (managedState !== "managed") {
    riskIndicators.push("unmanaged_device");
  }

  if (complianceState === "non_compliant") {
    riskIndicators.push("non_compliant");
  }

  if (postureFreshness === "stale") {
    riskIndicators.push("stale_check_in");
  }

  if (postureFreshness === "expired") {
    riskIndicators.push("expired_check_in");
  }

  if (postureFreshness === "unknown") {
    riskIndicators.push("unknown_check_in_freshness");
  }

  const { decisionImpact, reasonCode } = mapDecision(
    managedState,
    complianceState,
    postureFreshness,
  );

  return {
    normalizedPosture: {
      deviceId: fixture.deviceId,
      sourceSystem: fixtureFile.sourceSystem,
      managedState,
      complianceState,
      postureFreshness,
      riskIndicators,
      observedAt: fixture.payload.observedAt,
      rawReference: fixture.payload.rawReference,
      confidence: determineConfidence(
        managedState,
        complianceState,
        postureFreshness,
      ),
      decisionImpact,
    },
    reasonCode,
  };
}

function determineConfidence(
  managedState: ManagedState,
  complianceState: ComplianceState,
  postureFreshness: PostureFreshness,
): Confidence {
  if (
    managedState === "managed" &&
    complianceState === "compliant" &&
    postureFreshness === "fresh"
  ) {
    return "high";
  }

  if (
    postureFreshness === "fresh" &&
    managedState !== "unknown" &&
    complianceState !== "unknown"
  ) {
    return "medium";
  }

  if (postureFreshness === "stale" || postureFreshness === "expired") {
    return "low";
  }

  return "unknown";
}

function mapDecision(
  managedState: ManagedState,
  complianceState: ComplianceState,
  postureFreshness: PostureFreshness,
): { decisionImpact: DecisionImpact; reasonCode: ReasonCode } {
  if (managedState !== "managed") {
    return {
      decisionImpact: "deny_or_restrict_candidate",
      reasonCode: "POSTURE_NOT_MANAGED_OR_INACTIVE",
    };
  }

  if (complianceState === "non_compliant") {
    return {
      decisionImpact: "deny_or_restrict_candidate",
      reasonCode: "POSTURE_NON_COMPLIANT",
    };
  }

  if (postureFreshness !== "fresh") {
    return {
      decisionImpact: "step_up_or_review_candidate",
      reasonCode: "POSTURE_STALE_OR_UNKNOWN",
    };
  }

  if (complianceState === "compliant") {
    return {
      decisionImpact: "allow_candidate",
      reasonCode: "POSTURE_COMPLIANT_FRESH",
    };
  }

  return {
    decisionImpact: "unknown_posture",
    reasonCode: "POSTURE_STALE_OR_UNKNOWN",
  };
}

function buildAuditRecord(
  fixture: SourceFixture,
  fixtureFile: FixtureFile,
  normalizedPosture: NormalizedPosture,
  reasonCode: ReasonCode,
  failureMode?: string,
): AuditRecord {
  return {
    sourceSystem: fixtureFile.sourceSystem,
    lookupStartedAt: fixtureFile.evaluatedAt,
    lookupCompletedAt: fixtureFile.evaluatedAt,
    deviceId: fixture.deviceId,
    normalizedPosture,
    decisionOutcome: normalizedPosture.decisionImpact,
    reasonCode,
    policyVersion: fixtureFile.proofVersion,
    rawReference: normalizedPosture.rawReference,
    operatorOrAdminNote:
      "Proof scaffold uses deterministic fake fixtures only; no Microsoft credentials or customer data are used.",
    failureMode,
  };
}

function evaluateCase(
  fixture: SourceFixture,
  fixtureFile: FixtureFile,
): CaseResult {
  const { normalizedPosture, reasonCode, failureMode } = normalizePosture(
    fixture,
    fixtureFile,
  );
  validateNormalizedPosture(normalizedPosture, fixture.caseId);

  const auditRecord = buildAuditRecord(
    fixture,
    fixtureFile,
    normalizedPosture,
    reasonCode,
    failureMode,
  );
  const passed =
    fixture.expectedDecisionImpact === normalizedPosture.decisionImpact &&
    fixture.expectedReasonCode === reasonCode &&
    !(
      normalizedPosture.decisionImpact === "allow_candidate" &&
      normalizedPosture.complianceState !== "compliant"
    );

  return {
    caseId: fixture.caseId,
    passed,
    expectedDecisionImpact: fixture.expectedDecisionImpact,
    actualDecisionImpact: normalizedPosture.decisionImpact,
    expectedReasonCode: fixture.expectedReasonCode,
    actualReasonCode: reasonCode,
    auditRecord,
  };
}

function assertString(
  value: unknown,
  fieldName: string,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
}

function assertNumber(
  value: unknown,
  fieldName: string,
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number.`);
  }
}

function assertEnum<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string,
): asserts value is T {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new Error(
      `${fieldName} must be one of: ${allowedValues.join(", ")}.`,
    );
  }
}

function validateSourceFixture(fixture: unknown, index: number): SourceFixture {
  const candidate = fixture as Partial<SourceFixture>;
  const prefix = `fixtures[${index}]`;

  assertString(candidate.caseId, `${prefix}.caseId`);
  assertString(candidate.description, `${prefix}.description`);
  assertString(candidate.environmentId, `${prefix}.environmentId`);
  assertString(candidate.deviceId, `${prefix}.deviceId`);
  assertEnum(candidate.lookupStatus, lookupStatuses, `${prefix}.lookupStatus`);
  assertEnum(
    candidate.expectedDecisionImpact,
    decisionImpacts,
    `${prefix}.expectedDecisionImpact`,
  );
  assertEnum(
    candidate.expectedReasonCode,
    reasonCodes,
    `${prefix}.expectedReasonCode`,
  );

  if (candidate.lookupStatus === "found") {
    if (!hasRequiredPayloadFields(candidate.payload)) {
      throw new Error(
        `${prefix}.payload must include all required source payload fields.`,
      );
    }

    assertString(
      candidate.payload.managedState,
      `${prefix}.payload.managedState`,
    );
    assertString(
      candidate.payload.complianceState,
      `${prefix}.payload.complianceState`,
    );
    assertString(
      candidate.payload.lastCheckInAt,
      `${prefix}.payload.lastCheckInAt`,
    );
    assertString(candidate.payload.platform, `${prefix}.payload.platform`);
    assertString(
      candidate.payload.rawReference,
      `${prefix}.payload.rawReference`,
    );
    assertString(candidate.payload.observedAt, `${prefix}.payload.observedAt`);
  }

  return candidate as SourceFixture;
}

function validateNormalizedPosture(
  posture: NormalizedPosture,
  caseId: string,
): void {
  assertString(posture.deviceId, `${caseId}.normalizedPosture.deviceId`);
  assertString(
    posture.sourceSystem,
    `${caseId}.normalizedPosture.sourceSystem`,
  );
  assertEnum(
    posture.managedState,
    managedStates,
    `${caseId}.normalizedPosture.managedState`,
  );
  assertEnum(
    posture.complianceState,
    complianceStates,
    `${caseId}.normalizedPosture.complianceState`,
  );
  assertEnum(
    posture.postureFreshness,
    postureFreshnessValues,
    `${caseId}.normalizedPosture.postureFreshness`,
  );
  assertEnum(
    posture.confidence,
    confidenceValues,
    `${caseId}.normalizedPosture.confidence`,
  );
  assertEnum(
    posture.decisionImpact,
    decisionImpacts,
    `${caseId}.normalizedPosture.decisionImpact`,
  );
  assertString(posture.observedAt, `${caseId}.normalizedPosture.observedAt`);
  assertString(
    posture.rawReference,
    `${caseId}.normalizedPosture.rawReference`,
  );

  if (!Array.isArray(posture.riskIndicators)) {
    throw new Error(
      `${caseId}.normalizedPosture.riskIndicators must be an array.`,
    );
  }
}

function validateFixtureFile(value: unknown): asserts value is FixtureFile {
  const fixtureFile = value as Partial<FixtureFile>;

  assertString(fixtureFile.proofName, "proofName");
  assertString(fixtureFile.proofVersion, "proofVersion");
  assertString(fixtureFile.sourceSystem, "sourceSystem");
  assertString(fixtureFile.evaluatedAt, "evaluatedAt");
  assertNumber(fixtureFile.freshnessWindowHours, "freshnessWindowHours");
  assertNumber(fixtureFile.staleWindowHours, "staleWindowHours");

  if (!fixtureFile.sourceSystem.includes("fixture")) {
    throw new Error(
      "Proof scaffold must use a fixture source system, not a live Microsoft tenant.",
    );
  }

  if (
    !Array.isArray(fixtureFile.fixtures) ||
    fixtureFile.fixtures.length === 0
  ) {
    throw new Error("Fixture file must include at least one posture fixture.");
  }

  fixtureFile.fixtures = fixtureFile.fixtures.map((fixture, index) =>
    validateSourceFixture(fixture, index),
  );
}

async function main(): Promise<void> {
  const fixturePath = process.argv[2]
    ? resolve(process.argv[2])
    : defaultFixturePath;
  const rawFixture = await readFile(fixturePath, "utf8");
  const fixtureFile = JSON.parse(rawFixture) as unknown;

  validateFixtureFile(fixtureFile);

  const results = fixtureFile.fixtures.map((fixture) =>
    evaluateCase(fixture, fixtureFile),
  );
  const passedCount = results.filter((result) => result.passed).length;
  const failedResults = results.filter((result) => !result.passed);

  console.log(`Intune/Entra posture proof scaffold: ${fixtureFile.proofName}`);
  console.log(`Fixture source: ${fixtureFile.sourceSystem}`);
  console.log(`Policy version: ${fixtureFile.proofVersion}`);
  console.log(`Cases: ${passedCount}/${results.length} PASS`);

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `${status} ${result.caseId}: ${result.actualDecisionImpact} (${result.actualReasonCode})`,
    );
  }

  console.log("\nAudit evidence bundle:");
  console.log(
    JSON.stringify(
      results.map((result) => result.auditRecord),
      null,
      2,
    ),
  );

  if (failedResults.length > 0) {
    process.exitCode = 1;
  }
}

await main();
