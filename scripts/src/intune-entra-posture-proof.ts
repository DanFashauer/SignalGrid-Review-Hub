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
type LastCheckInFreshness = "fresh" | "stale" | "missing";
type EnrollmentSource =
  | "intune"
  | "apple_business_manager"
  | "automated_device_enrollment"
  | "company_portal"
  | "unknown";
type OwnershipType = "corporate" | "personal" | "shared" | "unknown";
type EnrollmentMode =
  | "user_enrollment"
  | "device_enrollment"
  | "automated_device_enrollment"
  | "shared_ipad"
  | "single_app_kiosk"
  | "multi_app_kiosk"
  | "unknown";
type ManagementChannel =
  | "intune"
  | "jamf"
  | "workspace_one"
  | "fleet"
  | "unknown";
type DeviceLimitState = "within_limit" | "limit_reached" | "unknown";
type BooleanOrUnknown = boolean | "unknown";
type Confidence = "high" | "medium" | "low" | "unknown";
type DecisionImpact =
  | "allow_candidate"
  | "step_up_or_review_candidate"
  | "deny_or_restrict_candidate"
  | "limited_access_candidate"
  | "review_candidate"
  | "unknown_posture";

type ReasonCode =
  | "POSTURE_COMPLIANT_FRESH"
  | "POSTURE_NON_COMPLIANT"
  | "POSTURE_STALE_OR_UNKNOWN"
  | "POSTURE_DEVICE_NOT_FOUND"
  | "POSTURE_SOURCE_LOOKUP_FAILED"
  | "POSTURE_NOT_MANAGED_OR_INACTIVE"
  | "POSTURE_ENROLLMENT_LIMIT_REACHED"
  | "POSTURE_BYOD_USER_ENROLLMENT"
  | "POSTURE_WEAK_ENROLLMENT_CONFIDENCE"
  | "POSTURE_SHARED_DEVICE_CONTEXT";

interface SourcePayload {
  managedState: string;
  complianceState: string;
  lastCheckInAt: string;
  platform: string;
  ownershipContext?: string;
  enrollmentSource?: string;
  ownershipType?: string;
  enrollmentMode?: string;
  managementChannel?: string;
  deviceLimitState?: string;
  abmLinked?: BooleanOrUnknown;
  supervised?: BooleanOrUnknown;
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
  expectedNormalizedComplianceState?: ComplianceState;
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
  lastCheckInFreshness: LastCheckInFreshness;
  enrollmentSource: EnrollmentSource;
  ownershipType: OwnershipType;
  enrollmentMode: EnrollmentMode;
  managementChannel: ManagementChannel;
  deviceLimitState: DeviceLimitState;
  abmLinked: BooleanOrUnknown;
  supervised: BooleanOrUnknown;
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
  "limited_access_candidate",
  "review_candidate",
  "unknown_posture",
];
const reasonCodes: ReasonCode[] = [
  "POSTURE_COMPLIANT_FRESH",
  "POSTURE_NON_COMPLIANT",
  "POSTURE_STALE_OR_UNKNOWN",
  "POSTURE_DEVICE_NOT_FOUND",
  "POSTURE_SOURCE_LOOKUP_FAILED",
  "POSTURE_NOT_MANAGED_OR_INACTIVE",
  "POSTURE_ENROLLMENT_LIMIT_REACHED",
  "POSTURE_BYOD_USER_ENROLLMENT",
  "POSTURE_WEAK_ENROLLMENT_CONFIDENCE",
  "POSTURE_SHARED_DEVICE_CONTEXT",
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
const lastCheckInFreshnessValues: LastCheckInFreshness[] = [
  "fresh",
  "stale",
  "missing",
];
const enrollmentSources: EnrollmentSource[] = [
  "intune",
  "apple_business_manager",
  "automated_device_enrollment",
  "company_portal",
  "unknown",
];
const ownershipTypes: OwnershipType[] = [
  "corporate",
  "personal",
  "shared",
  "unknown",
];
const enrollmentModes: EnrollmentMode[] = [
  "user_enrollment",
  "device_enrollment",
  "automated_device_enrollment",
  "shared_ipad",
  "single_app_kiosk",
  "multi_app_kiosk",
  "unknown",
];
const managementChannels: ManagementChannel[] = [
  "intune",
  "jamf",
  "workspace_one",
  "fleet",
  "unknown",
];
const deviceLimitStates: DeviceLimitState[] = [
  "within_limit",
  "limit_reached",
  "unknown",
];
const confidenceValues: Confidence[] = ["high", "medium", "low", "unknown"];

function normalizeManagedState(value: string | undefined): ManagedState {
  return managedStates.includes(value as ManagedState)
    ? (value as ManagedState)
    : "unknown";
}

function normalizeComplianceState(value: string | undefined): ComplianceState {
  switch (value) {
    case "compliant":
      return "compliant";
    case "noncompliant":
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

function normalizeEnrollmentSource(
  value: string | undefined,
): EnrollmentSource {
  return enrollmentSources.includes(value as EnrollmentSource)
    ? (value as EnrollmentSource)
    : "unknown";
}

function normalizeOwnershipType(value: string | undefined): OwnershipType {
  return ownershipTypes.includes(value as OwnershipType)
    ? (value as OwnershipType)
    : "unknown";
}

function normalizeEnrollmentMode(value: string | undefined): EnrollmentMode {
  return enrollmentModes.includes(value as EnrollmentMode)
    ? (value as EnrollmentMode)
    : "unknown";
}

function normalizeManagementChannel(
  value: string | undefined,
): ManagementChannel {
  return managementChannels.includes(value as ManagementChannel)
    ? (value as ManagementChannel)
    : "unknown";
}

function normalizeDeviceLimitState(
  value: string | undefined,
): DeviceLimitState {
  return deviceLimitStates.includes(value as DeviceLimitState)
    ? (value as DeviceLimitState)
    : "unknown";
}

function normalizeBooleanOrUnknown(value: unknown): BooleanOrUnknown {
  return typeof value === "boolean" ? value : "unknown";
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

function toLastCheckInFreshness(
  postureFreshness: PostureFreshness,
): LastCheckInFreshness {
  if (postureFreshness === "fresh") {
    return "fresh";
  }

  if (postureFreshness === "stale" || postureFreshness === "expired") {
    return "stale";
  }

  return "missing";
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
      lastCheckInFreshness: "missing",
      enrollmentSource: "unknown",
      ownershipType: "unknown",
      enrollmentMode: "unknown",
      managementChannel: "unknown",
      deviceLimitState: "unknown",
      abmLinked: "unknown",
      supervised: "unknown",
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

function isAdeOrAbm(
  enrollmentSource: EnrollmentSource,
  enrollmentMode: EnrollmentMode,
): boolean {
  return (
    enrollmentSource === "apple_business_manager" ||
    enrollmentSource === "automated_device_enrollment" ||
    enrollmentMode === "automated_device_enrollment"
  );
}

function isSharedOrKiosk(enrollmentMode: EnrollmentMode): boolean {
  return (
    enrollmentMode === "shared_ipad" ||
    enrollmentMode === "single_app_kiosk" ||
    enrollmentMode === "multi_app_kiosk"
  );
}

function collectRiskIndicators(
  posture: Omit<
    NormalizedPosture,
    "riskIndicators" | "confidence" | "decisionImpact"
  >,
): string[] {
  const riskIndicators: string[] = [];

  if (posture.managedState !== "managed") {
    riskIndicators.push("unmanaged_device");
  }

  if (posture.complianceState === "non_compliant") {
    riskIndicators.push("non_compliant");
  }

  if (posture.lastCheckInFreshness === "stale") {
    riskIndicators.push("stale_check_in");
  }

  if (posture.lastCheckInFreshness === "missing") {
    riskIndicators.push("missing_check_in");
  }

  if (posture.deviceLimitState === "limit_reached") {
    riskIndicators.push("device_limit_reached");
  }

  if (
    posture.ownershipType === "personal" ||
    posture.enrollmentMode === "user_enrollment"
  ) {
    riskIndicators.push("byod_or_user_enrollment");
  }

  if (
    posture.ownershipType === "corporate" &&
    posture.enrollmentSource === "unknown"
  ) {
    riskIndicators.push("unknown_enrollment_source");
  }

  if (
    posture.ownershipType === "corporate" &&
    (posture.abmLinked !== true || posture.supervised !== true)
  ) {
    riskIndicators.push("weak_apple_enrollment_confidence");
  }

  if (isSharedOrKiosk(posture.enrollmentMode)) {
    riskIndicators.push("shared_or_kiosk_context");
  }

  return riskIndicators;
}

function mapDecision(
  posture: Omit<
    NormalizedPosture,
    "riskIndicators" | "confidence" | "decisionImpact"
  >,
): {
  decisionImpact: DecisionImpact;
  reasonCode: ReasonCode;
} {
  if (posture.managedState !== "managed") {
    return {
      decisionImpact: "deny_or_restrict_candidate",
      reasonCode: "POSTURE_NOT_MANAGED_OR_INACTIVE",
    };
  }

  if (posture.complianceState === "non_compliant") {
    return {
      decisionImpact: "deny_or_restrict_candidate",
      reasonCode: "POSTURE_NON_COMPLIANT",
    };
  }

  if (posture.lastCheckInFreshness !== "fresh") {
    return {
      decisionImpact: "step_up_or_review_candidate",
      reasonCode: "POSTURE_STALE_OR_UNKNOWN",
    };
  }

  if (posture.deviceLimitState === "limit_reached") {
    return {
      decisionImpact: "review_candidate",
      reasonCode: "POSTURE_ENROLLMENT_LIMIT_REACHED",
    };
  }

  if (
    posture.ownershipType === "personal" ||
    posture.enrollmentMode === "user_enrollment"
  ) {
    return {
      decisionImpact: "limited_access_candidate",
      reasonCode: "POSTURE_BYOD_USER_ENROLLMENT",
    };
  }

  if (
    posture.ownershipType === "corporate" &&
    posture.enrollmentSource === "unknown"
  ) {
    return {
      decisionImpact: "review_candidate",
      reasonCode: "POSTURE_WEAK_ENROLLMENT_CONFIDENCE",
    };
  }

  if (
    posture.ownershipType === "corporate" &&
    (posture.abmLinked !== true || posture.supervised !== true)
  ) {
    return {
      decisionImpact: "review_candidate",
      reasonCode: "POSTURE_WEAK_ENROLLMENT_CONFIDENCE",
    };
  }

  if (
    posture.complianceState === "compliant" &&
    posture.lastCheckInFreshness === "fresh" &&
    posture.ownershipType === "corporate" &&
    isAdeOrAbm(posture.enrollmentSource, posture.enrollmentMode) &&
    posture.abmLinked === true &&
    posture.supervised === true
  ) {
    return {
      decisionImpact: "allow_candidate",
      reasonCode: "POSTURE_COMPLIANT_FRESH",
    };
  }

  // THE SHARED/KIOSK ARM SITS BELOW THE COMPLIANCE READ, AND TESTS IT POSITIVELY.
  //
  // It used to sit above every positive compliance test, and every guard before it is a
  // NEGATIVE test (`!== "managed"`, `=== "non_compliant"`, `!== "fresh"`,
  // `=== "limit_reached"`, `=== "personal"`) while the two enrollment-confidence arms
  // are gated on `ownershipType === "corporate"`, which a shared device is not. So a
  // managed, fresh, shared iPad whose compliance Intune had NEVER EVALUATED
  // (`complianceState: "unknown"`) reached `allow_candidate`, and `buildAuditRecord`
  // copied that into `decisionOutcome` — an allow at `confidence: "unknown"`, on a
  // device whose compliance was never read. `evaluateCase` failed the CASE, so the gate
  // was not green, but the emitted audit bundle still carried the unearned affirmative
  // for anyone reading the record rather than the PASS line. Unknown compliance now
  // falls through to `unknown_posture` / `POSTURE_STALE_OR_UNKNOWN`, fail-closed.
  // Pinned by the committed case `shared-ipad-compliance-unknown`.
  if (
    posture.complianceState === "compliant" &&
    isSharedOrKiosk(posture.enrollmentMode)
  ) {
    return {
      decisionImpact: "allow_candidate",
      reasonCode: "POSTURE_SHARED_DEVICE_CONTEXT",
    };
  }

  if (posture.complianceState === "compliant") {
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

function determineConfidence(
  posture: Omit<
    NormalizedPosture,
    "riskIndicators" | "confidence" | "decisionImpact"
  >,
): Confidence {
  if (
    posture.managedState === "managed" &&
    posture.complianceState === "compliant" &&
    posture.lastCheckInFreshness === "fresh" &&
    posture.ownershipType === "corporate" &&
    isAdeOrAbm(posture.enrollmentSource, posture.enrollmentMode) &&
    posture.abmLinked === true &&
    posture.supervised === true
  ) {
    return "high";
  }

  if (
    posture.lastCheckInFreshness !== "fresh" ||
    posture.enrollmentSource === "unknown"
  ) {
    return "low";
  }

  if (
    posture.managedState !== "unknown" &&
    posture.complianceState !== "unknown"
  ) {
    return "medium";
  }

  return "unknown";
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

  const postureFreshness = classifyFreshness(
    fixture.payload.lastCheckInAt,
    fixtureFile.evaluatedAt,
    fixtureFile.freshnessWindowHours,
    fixtureFile.staleWindowHours,
  );
  const basePosture: Omit<
    NormalizedPosture,
    "riskIndicators" | "confidence" | "decisionImpact"
  > = {
    deviceId: fixture.deviceId,
    sourceSystem: fixtureFile.sourceSystem,
    managedState: normalizeManagedState(fixture.payload.managedState),
    complianceState: normalizeComplianceState(fixture.payload.complianceState),
    postureFreshness,
    lastCheckInFreshness: toLastCheckInFreshness(postureFreshness),
    enrollmentSource: normalizeEnrollmentSource(
      fixture.payload.enrollmentSource,
    ),
    ownershipType: normalizeOwnershipType(fixture.payload.ownershipType),
    enrollmentMode: normalizeEnrollmentMode(fixture.payload.enrollmentMode),
    managementChannel: normalizeManagementChannel(
      fixture.payload.managementChannel,
    ),
    deviceLimitState: normalizeDeviceLimitState(
      fixture.payload.deviceLimitState,
    ),
    abmLinked: normalizeBooleanOrUnknown(fixture.payload.abmLinked),
    supervised: normalizeBooleanOrUnknown(fixture.payload.supervised),
    observedAt: fixture.payload.observedAt,
    rawReference: fixture.payload.rawReference,
  };
  const { decisionImpact, reasonCode } = mapDecision(basePosture);

  return {
    normalizedPosture: {
      ...basePosture,
      riskIndicators: collectRiskIndicators(basePosture),
      confidence: determineConfidence(basePosture),
      decisionImpact,
    },
    reasonCode,
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
  const expectedComplianceMatches =
    fixture.expectedNormalizedComplianceState === undefined ||
    fixture.expectedNormalizedComplianceState ===
      normalizedPosture.complianceState;
  const passed =
    expectedComplianceMatches &&
    fixture.expectedDecisionImpact === normalizedPosture.decisionImpact &&
    fixture.expectedReasonCode === reasonCode &&
    !(
      normalizedPosture.decisionImpact === "allow_candidate" &&
      normalizedPosture.complianceState !== "compliant"
    ) &&
    !(
      normalizedPosture.decisionImpact === "unknown_posture" &&
      normalizedPosture.complianceState === "non_compliant"
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
  if (candidate.expectedNormalizedComplianceState !== undefined) {
    assertEnum(
      candidate.expectedNormalizedComplianceState,
      complianceStates,
      `${prefix}.expectedNormalizedComplianceState`,
    );
  }

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
    posture.lastCheckInFreshness,
    lastCheckInFreshnessValues,
    `${caseId}.normalizedPosture.lastCheckInFreshness`,
  );
  assertEnum(
    posture.enrollmentSource,
    enrollmentSources,
    `${caseId}.normalizedPosture.enrollmentSource`,
  );
  assertEnum(
    posture.ownershipType,
    ownershipTypes,
    `${caseId}.normalizedPosture.ownershipType`,
  );
  assertEnum(
    posture.enrollmentMode,
    enrollmentModes,
    `${caseId}.normalizedPosture.enrollmentMode`,
  );
  assertEnum(
    posture.managementChannel,
    managementChannels,
    `${caseId}.normalizedPosture.managementChannel`,
  );
  assertEnum(
    posture.deviceLimitState,
    deviceLimitStates,
    `${caseId}.normalizedPosture.deviceLimitState`,
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
