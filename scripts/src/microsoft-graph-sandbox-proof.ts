import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GraphPostureConnector,
  createMockGraphTransport,
  type GraphManagedDeviceRaw,
  type GraphPostureSignal,
  type GraphUserRaw,
} from "@workspace/integrations/graph";

// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS AND IS NOT SHIPPED CODE HERE
//
// There is NO shipped Microsoft Graph *decision* function under lib/ or
// artifacts/. `mapDecision` below is an INLINE oracle: it encodes the intended
// posture→decision policy but is not (yet) product code that anything ships.
// The only shipped Graph code is `GraphPostureConnector` (lib/integrations),
// which normalizes raw Graph reads into `GraphPostureSignal` — posture
// vocabulary ONLY, with no permission/API-health or access-review signals.
//
// So, to avoid a purely self-referential proof, this file:
//   1. exercises the SHIPPED connector end-to-end and drives its REAL normalized
//      output through the inline decision oracle, pinning the decision + reason
//      each shipped posture must produce (non-tautological: the raw→normalized
//      expectations are authored independently in the committed fixture);
//   2. pins expectedReasonCode on ALL fixture cases — not just the two that
//      carry one — via an independently-authored reason-code table, so rule
//      precedence and code strings are both regression-guarded; and
//   3. records, as an explicit GAP check, that the shipped connector is NOT yet
//      wired to any health/access-review source, so a real decision core driven
//      solely by shipped signals cannot yet reach a posture decision. Until that
//      wiring exists, the oracle below is the specification, not shipped behavior.
// ─────────────────────────────────────────────────────────────────────────────

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

// Independently authored from the decision policy (NOT read back from
// mapDecision), so it is a genuine regression guard for both rule precedence and
// the exact reason-code string emitted on every case — including the nine cases
// whose fixtures do not carry an expectedReasonCode. A case with no entry here
// fails the proof, which forces new fixtures to pin their reason code too.
const canonicalReasonCode: Record<string, ReasonCode> = {
  "healthy-user-compliant-device": "GRAPH_HEALTHY_ALLOW_CANDIDATE",
  "disabled-user-active-device": "IDENTITY_DISABLED",
  "non-compliant-device": "DEVICE_NON_COMPLIANT",
  "stale-device": "DEVICE_STALE",
  "unmanaged-device": "DEVICE_UNMANAGED",
  "missing-compliance-state": "COMPLIANCE_STATE_MISSING",
  "access-review-overdue": "ACCESS_REVIEW_OVERDUE",
  "graph-permission-failure": "GRAPH_PERMISSION_HEALTH_FAILED",
  "graph-api-unavailable": "GRAPH_API_HEALTH_UNAVAILABLE",
  "compliant-device-degraded-permission-health": "GRAPH_PERMISSION_HEALTH_AMBIGUOUS",
  "compliant-device-unknown-graph-health": "GRAPH_API_HEALTH_AMBIGUOUS",
};

const fixtureFiles = ["identity-device-posture.json", "graph-api-health.json"];
const loaded = await Promise.all(fixtureFiles.map(loadFixture));
const normalized = loaded.flatMap((fixture) =>
  fixture.cases.map((item) => normalize(fixture, item)),
);
const results = normalized.map((item) => {
  const pinnedReasonCode = canonicalReasonCode[item.caseId];
  return {
    caseId: item.caseId,
    expectedDecision: item.expectedDecision,
    fixtureReasonCode: item.expectedReasonCode,
    pinnedReasonCode,
    ...mapDecision(item),
    normalizedFieldsPresent: requiredFields.every((field) => field in item),
  };
});
const failures = results.filter(
  (result) =>
    !result.normalizedFieldsPresent ||
    result.actualDecision !== result.expectedDecision ||
    // Every case must be pinned, and the actual reason must equal the pin.
    result.pinnedReasonCode === undefined ||
    result.actualReasonCode !== result.pinnedReasonCode ||
    // Where the fixture also carries a reason code, proof + fixture must agree.
    (result.fixtureReasonCode !== undefined &&
      result.fixtureReasonCode !== result.pinnedReasonCode),
);

// A lightweight assert helper (mirrors scripts/src/graph-connector-proof.ts) for
// the shipped-code and gap checks below.
const checkFailures: string[] = [];
let checksPassed = 0;
function check(name: string, ok: boolean): void {
  if (ok) {
    checksPassed += 1;
    console.log(`  ok — ${name}`);
  } else {
    checkFailures.push(name);
    console.log(`  FAIL — ${name}`);
  }
}

console.log("Microsoft Graph sandbox connector proof");
console.log(`fixtures=${fixtureFiles.join(",")}`);
console.log(`cases=${results.length}`);
for (const result of results) {
  console.log(
    `${result.caseId}: expected=${result.expectedDecision} actual=${result.actualDecision} reason=${result.actualReasonCode} pin=${result.pinnedReasonCode ?? "MISSING"} fields=${result.normalizedFieldsPresent ? "ok" : "missing"}`,
  );
}

// ── Shipped connector → decision oracle (real product code exercised) ──────────
// Drive the committed raw Graph fixture through the REAL GraphPostureConnector +
// its deterministic mock transport, then feed the shipped-normalized posture into
// the decision oracle. This ties shipped normalization to the decision path.
console.log("shipped-connector checks");
interface RawGraphFixture {
  accessToken: string;
  users: GraphUserRaw[];
  devices: GraphManagedDeviceRaw[];
  expectedNormalized: Record<string, Partial<GraphPostureSignal>>;
}
const rawFixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/microsoft-graph/graph-raw-responses.json",
);
const rawFixture = JSON.parse(await readFile(rawFixturePath, "utf8")) as RawGraphFixture;
const SHIPPED_BASE_URL = "https://graph.microsoft.com/v1.0";
const SHIPPED_OBSERVED_AT = "2026-07-19T12:00:00.000Z";
const shippedConnector = new GraphPostureConnector(
  { accessToken: rawFixture.accessToken, baseUrl: SHIPPED_BASE_URL, pageLimit: 50 },
  createMockGraphTransport({
    users: rawFixture.users,
    devices: rawFixture.devices,
    expectedToken: rawFixture.accessToken,
    pageSize: 2, // small page size forces real pagination through the connector
    baseUrl: SHIPPED_BASE_URL,
  }),
);
const shippedSignals = await shippedConnector.fetchPosture(SHIPPED_OBSERVED_AT);
const shippedByDevice = new Map(shippedSignals.map((s) => [s.deviceId, s]));

// (1) Shipped normalization emits exactly the posture vocabulary the decision
//     oracle consumes — verified against the fixture's independent expectations.
for (const [deviceId, expected] of Object.entries(rawFixture.expectedNormalized)) {
  const actual = shippedByDevice.get(deviceId);
  const ok =
    !!actual &&
    (Object.keys(expected) as Array<keyof GraphPostureSignal>).every(
      (k) => actual[k] === expected[k],
    );
  check(`shipped connector normalizes ${deviceId} to expected posture`, ok);
}

// (2) Fully-wired scenario: given healthy integration context, the SHIPPED
//     posture drives the decision oracle to the intended decision + reason.
//     Expectations authored from the policy, independent of mapDecision.
const shippedDecisionExpect: Record<string, { decision: Decision; reason: ReasonCode }> = {
  "device-1001": { decision: "allow_candidate", reason: "GRAPH_HEALTHY_ALLOW_CANDIDATE" },
  "device-1002": { decision: "deny_route_owner", reason: "IDENTITY_DISABLED" }, // disabled beats noncompliant
  "device-1003": { decision: "restrict_step_up_ticket", reason: "DEVICE_UNMANAGED" }, // unmanaged beats compliant
  "device-1004": { decision: "step_up_ticket", reason: "COMPLIANCE_STATE_MISSING" },
  "device-1005": { decision: "step_up_ticket", reason: "GRAPH_HEALTH_OR_POSTURE_UNKNOWN" }, // in_grace_period → catch-all
};
for (const [deviceId, exp] of Object.entries(shippedDecisionExpect)) {
  const signal = shippedByDevice.get(deviceId);
  const decision = signal
    ? mapDecision(
        liftShippedSignal(signal, {
          permissionHealth: "healthy",
          graphApiHealth: "available",
          accessReviewState: "current",
        }),
      )
    : undefined;
  check(
    `shipped posture ${deviceId} → ${exp.decision}/${exp.reason}`,
    decision?.actualDecision === exp.decision && decision?.actualReasonCode === exp.reason,
  );
}

// (3) GAP: the shipped connector supplies NO permission/API-health signal today.
//     Feeding shipped posture straight into the oracle therefore cannot reach a
//     posture decision — it degrades to integration-health routing. This pins the
//     missing wiring as a known, asserted TODO rather than an untested assumption.
const gapSignal = shippedByDevice.get("device-1001");
const gapDecision = gapSignal
  ? mapDecision(
      liftShippedSignal(gapSignal, {
        // "unknown" models the health context the connector does not yet provide.
        permissionHealth: "unknown",
        graphApiHealth: "unknown",
        accessReviewState: "current",
      }),
    )
  : undefined;
check(
  "GAP (connector not yet wired): shipped posture without health signals → integration-health routing",
  gapDecision?.actualDecision === "degraded_confidence_route_integration_health" &&
    gapDecision?.actualReasonCode === "GRAPH_API_HEALTH_AMBIGUOUS",
);

const allPass = failures.length === 0 && checkFailures.length === 0;
console.log(
  `summary=${allPass ? "pass" : "fail"} fixtures=${results.length - failures.length}/${results.length} checks=${checksPassed}/${checksPassed + checkFailures.length}`,
);
if (!allPass) {
  if (checkFailures.length > 0) {
    console.error("Failed checks:");
    for (const f of checkFailures) console.error(`  - ${f}`);
  }
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

/**
 * Lift a SHIPPED `GraphPostureSignal` into the decision-oracle input shape. The
 * shipped signal carries posture only, so the integration-health/access-review
 * context — which the connector does not yet emit — is supplied explicitly by
 * the caller. This is exactly the seam a future real decision core would fill.
 */
function liftShippedSignal(
  signal: GraphPostureSignal,
  ctx: { permissionHealth: string; graphApiHealth: string; accessReviewState: string },
): NormalizedSignalGridInput {
  return {
    caseId: signal.deviceId,
    subjectId: signal.subjectId,
    deviceId: signal.deviceId,
    identityStatus: signal.identityStatus,
    userRisk: signal.userRisk,
    deviceRegistrationState: signal.deviceRegistrationState,
    deviceComplianceState: signal.deviceComplianceState,
    deviceManagementState: signal.deviceManagementState,
    deviceLastSeenAt: signal.deviceLastSeenAt,
    configurationProfileState: "assigned",
    policyAssignmentState: "assigned",
    managedAppState: "healthy",
    accessReviewState: ctx.accessReviewState,
    permissionHealth: ctx.permissionHealth,
    graphApiHealth: ctx.graphApiHealth,
    correlationId: signal.correlationId,
    expectedDecision: "allow_candidate", // unused by mapDecision; present for typing
    sourceSystem: signal.sourceSystem,
    observedAt: signal.observedAt,
    fixtureVersion: "shipped-connector",
    postureFreshness: freshness(signal.deviceLastSeenAt, signal.observedAt),
  };
}

function freshness(lastSeenAt: string | null, observedAt: string) {
  if (!lastSeenAt) return "unknown";
  // An unreadable date already fell to "stale" here, because NaN <= threshold is
  // false — safe in DIRECTION, but not what the shipped connector does: it
  // returns "unknown" (see the deriveFreshness helpers in
  // lib/integrations/src/integrations/*/evaluate.ts, which guard with a
  // rejecting Number.isNaN before comparing). A proof that models a connector
  // should model the connector it has, so the two now agree. Made explicit
  // rather than left implicit: relying on which way a NaN comparison happens to
  // fall is how the seven auth-path sites were written in the first place.
  const ageMs = Date.parse(observedAt) - Date.parse(lastSeenAt);
  if (!Number.isFinite(ageMs)) return "unknown";
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
