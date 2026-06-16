import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Decision =
  | "allow_candidate"
  | "deny_route_owner"
  | "restrict_step_up_ticket"
  | "step_up_ticket"
  | "approval_required"
  | "integration_health_event"
  | "degraded_confidence_route_integration_health";

type ReasonCode =
  | "GRAPH_HEALTHY_ALLOW_CANDIDATE"
  | "IDENTITY_DISABLED"
  | "DEVICE_NON_COMPLIANT"
  | "DEVICE_UNMANAGED"
  | "DEVICE_STALE"
  | "COMPLIANCE_STATE_MISSING"
  | "ACCESS_REVIEW_OVERDUE"
  | "GRAPH_PERMISSION_HEALTH_FAILED"
  | "GRAPH_PERMISSION_HEALTH_AMBIGUOUS"
  | "GRAPH_API_HEALTH_UNAVAILABLE"
  | "GRAPH_API_HEALTH_AMBIGUOUS"
  | "GRAPH_HEALTH_OR_POSTURE_UNKNOWN";

interface GraphFixtureCase {
  caseId: string;
  subjectId: string;
  deviceId: string;
  identityStatus: string;
  userRisk: string;
  deviceRegistrationState: string;
  deviceComplianceState: string;
  deviceManagementState: string;
  deviceLastSeenAt: string | null;
  configurationProfileState: string;
  policyAssignmentState: string;
  managedAppState: string;
  accessReviewState: string;
  permissionHealth: string;
  graphApiHealth: string;
  correlationId: string;
  expectedDecision: Decision;
  expectedReasonCode?: ReasonCode;
}

interface GraphFixtureFile {
  fixtureName: string;
  fixtureVersion: string;
  sourceSystem: string;
  observedAt: string;
  cases: GraphFixtureCase[];
}

interface NormalizedSignalGridInput extends GraphFixtureCase {
  sourceSystem: string;
  observedAt: string;
  fixtureVersion: string;
  postureFreshness: "fresh" | "stale" | "unknown";
}

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/microsoft-graph",
);
const requiredFields = [
  "sourceSystem",
  "subjectId",
  "deviceId",
  "identityStatus",
  "userRisk",
  "deviceRegistrationState",
  "deviceComplianceState",
  "deviceManagementState",
  "deviceLastSeenAt",
  "postureFreshness",
  "configurationProfileState",
  "policyAssignmentState",
  "managedAppState",
  "accessReviewState",
  "permissionHealth",
  "graphApiHealth",
  "correlationId",
  "observedAt",
  "fixtureVersion",
] as const;

const fixtureFiles = ["identity-device-posture.json", "graph-api-health.json"];
const loaded = await Promise.all(fixtureFiles.map(loadFixture));
const normalized = loaded.flatMap((fixture) =>
  fixture.cases.map((item) => normalize(fixture, item)),
);
const results = normalized.map((item) => ({
  caseId: item.caseId,
  expectedDecision: item.expectedDecision,
  expectedReasonCode: item.expectedReasonCode,
  ...mapDecision(item),
  normalizedFieldsPresent: requiredFields.every((field) => field in item),
}));
const failures = results.filter(
  (result) =>
    !result.normalizedFieldsPresent ||
    result.actualDecision !== result.expectedDecision ||
    (result.expectedReasonCode !== undefined &&
      result.actualReasonCode !== result.expectedReasonCode),
);

console.log("Microsoft Graph sandbox connector proof");
console.log(`fixtures=${fixtureFiles.join(",")}`);
console.log(`cases=${results.length}`);
for (const result of results) {
  console.log(
    `${result.caseId}: expected=${result.expectedDecision} actual=${result.actualDecision} reason=${result.actualReasonCode} fields=${result.normalizedFieldsPresent ? "ok" : "missing"}`,
  );
}
console.log(`summary=${failures.length === 0 ? "pass" : "fail"}`);

if (failures.length > 0) {
  process.exitCode = 1;
}

async function loadFixture(fileName: string): Promise<GraphFixtureFile> {
  const raw = await readFile(resolve(fixtureDir, fileName), "utf8");
  return JSON.parse(raw) as GraphFixtureFile;
}

function normalize(
  fixture: GraphFixtureFile,
  item: GraphFixtureCase,
): NormalizedSignalGridInput {
  return {
    ...item,
    sourceSystem: fixture.sourceSystem,
    observedAt: fixture.observedAt,
    fixtureVersion: fixture.fixtureVersion,
    postureFreshness: freshness(item.deviceLastSeenAt, fixture.observedAt),
  };
}

function freshness(lastSeenAt: string | null, observedAt: string) {
  if (!lastSeenAt) return "unknown";
  const ageMs = Date.parse(observedAt) - Date.parse(lastSeenAt);
  return ageMs <= 7 * 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

function mapDecision(input: NormalizedSignalGridInput): {
  actualDecision: Decision;
  actualReasonCode: ReasonCode;
} {
  if (input.graphApiHealth === "unavailable")
    return {
      actualDecision: "degraded_confidence_route_integration_health",
      actualReasonCode: "GRAPH_API_HEALTH_UNAVAILABLE",
    };
  if (input.permissionHealth === "failed")
    return {
      actualDecision: "integration_health_event",
      actualReasonCode: "GRAPH_PERMISSION_HEALTH_FAILED",
    };
  if (isAmbiguousHealth(input.graphApiHealth))
    return {
      actualDecision: "degraded_confidence_route_integration_health",
      actualReasonCode: "GRAPH_API_HEALTH_AMBIGUOUS",
    };
  if (isAmbiguousHealth(input.permissionHealth))
    return {
      actualDecision: "degraded_confidence_route_integration_health",
      actualReasonCode: "GRAPH_PERMISSION_HEALTH_AMBIGUOUS",
    };
  if (input.identityStatus === "disabled")
    return {
      actualDecision: "deny_route_owner",
      actualReasonCode: "IDENTITY_DISABLED",
    };
  if (input.accessReviewState === "overdue")
    return {
      actualDecision: "approval_required",
      actualReasonCode: "ACCESS_REVIEW_OVERDUE",
    };
  if (input.deviceManagementState === "unmanaged")
    return {
      actualDecision: "restrict_step_up_ticket",
      actualReasonCode: "DEVICE_UNMANAGED",
    };
  if (input.deviceComplianceState === "non_compliant")
    return {
      actualDecision: "restrict_step_up_ticket",
      actualReasonCode: "DEVICE_NON_COMPLIANT",
    };
  if (input.deviceComplianceState === "missing")
    return {
      actualDecision: "step_up_ticket",
      actualReasonCode: "COMPLIANCE_STATE_MISSING",
    };
  if (input.postureFreshness === "stale")
    return {
      actualDecision: "step_up_ticket",
      actualReasonCode: "DEVICE_STALE",
    };
  if (
    input.identityStatus === "enabled" &&
    input.deviceComplianceState === "compliant" &&
    input.permissionHealth === "healthy" &&
    input.graphApiHealth === "available"
  )
    return {
      actualDecision: "allow_candidate",
      actualReasonCode: "GRAPH_HEALTHY_ALLOW_CANDIDATE",
    };
  return {
    actualDecision: "step_up_ticket",
    actualReasonCode: "GRAPH_HEALTH_OR_POSTURE_UNKNOWN",
  };
}

function isAmbiguousHealth(value: string | undefined): boolean {
  return value === undefined || value === "unknown" || value === "degraded";
}
