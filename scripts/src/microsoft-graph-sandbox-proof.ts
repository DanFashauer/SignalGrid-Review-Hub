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
  actualDecision: mapDecision(item),
  normalizedFieldsPresent: requiredFields.every((field) => field in item),
}));
const failures = results.filter(
  (result) =>
    !result.normalizedFieldsPresent ||
    result.actualDecision !== result.expectedDecision,
);

console.log("Microsoft Graph sandbox connector proof");
console.log(`fixtures=${fixtureFiles.join(",")}`);
console.log(`cases=${results.length}`);
for (const result of results) {
  console.log(
    `${result.caseId}: expected=${result.expectedDecision} actual=${result.actualDecision} fields=${result.normalizedFieldsPresent ? "ok" : "missing"}`,
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

function mapDecision(input: NormalizedSignalGridInput): Decision {
  if (input.graphApiHealth === "unavailable")
    return "degraded_confidence_route_integration_health";
  if (input.permissionHealth === "failed") return "integration_health_event";
  if (input.identityStatus === "disabled") return "deny_route_owner";
  if (input.accessReviewState === "overdue") return "approval_required";
  if (input.deviceManagementState === "unmanaged")
    return "restrict_step_up_ticket";
  if (input.deviceComplianceState === "non_compliant")
    return "restrict_step_up_ticket";
  if (input.deviceComplianceState === "missing") return "step_up_ticket";
  if (input.postureFreshness === "stale") return "step_up_ticket";
  if (
    input.identityStatus === "enabled" &&
    input.deviceComplianceState === "compliant"
  )
    return "allow_candidate";
  return "step_up_ticket";
}
