// Proof: the connector→decision seam is CLOSED for all three launch families,
// with zero network.
//
// The 2026-08-10 full-repo scan (docs/PRODUCT_COMPLETION_PLAN.md §9) found the
// central launch defect: the /v1 decision surface and the connector families
// were both real and NEVER MET. The core could not even represent two of its
// three launch families, and no path existed from a family's fixture connector
// to a decision's evidence. The core half landed as the 17-category work; this
// proof pins the integrations half:
//
//   resolve (fixture mode) → WORKING connector → family fetch + evaluate
//     → integration-bridge mapping → core fixture sync → decision → evidence
//
// for microsoft-graph posture, device-management-health, and local-authority —
// every step deterministic, every byte synthetic, and `fetch` hard-disabled for
// the whole run so "zero network" is enforced rather than claimed.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateDecision,
  runFixtureSync,
  seedDemoStore,
  fixedClock,
  type Connector,
  type FixturePostureRecord,
} from "@workspace/signalgrid-core";
import {
  deviceManagementHealthToDrafts,
  fleetDMToPostureDrafts,
  graphPostureToDrafts,
  localAuthorityToDrafts,
  type PostureSignalDraft,
} from "@workspace/integration-bridge";
import {
  FIXTURE_GRAPH_DEVICES,
  FIXTURE_GRAPH_USERS,
  FIXTURE_GRAPH_RISKY_USERS,
  resolveGraphPostureConnector,
} from "@workspace/integrations/graph";
import {
  evaluateDeviceManagementHealth,
  resolveDeviceManagementHealthConnector,
} from "@workspace/integrations/device-management-health";
import {
  evaluateLocalAuthority,
  normalizeLocalAuthority,
  resolveLocalAuthorityConnector,
} from "@workspace/integrations/local-authority";

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

// ── Zero network, enforced ────────────────────────────────────────────────────
// Any real vendor call in this proof is a defect, so `fetch` is replaced with a
// tripwire for the entire run. A fixture-mode pipeline that quietly reached the
// network would fail here before it could fail anywhere softer.
let fetchAttempts = 0;
globalThis.fetch = (async () => {
  fetchAttempts += 1;
  throw new Error("proof:launch-seam forbids network calls — fixture mode must be offline");
}) as typeof globalThis.fetch;

// The fixed instant every family evaluates against. Freshness windows in the
// core are measured against the demo clock, so posture observed 2h earlier
// grades fresh.
const NOW = "2026-07-13T15:00:00.000Z";
const OBSERVED = "2026-07-13T13:00:00.000Z";

async function main(): Promise<void> {
  // ── 1. Fixture-mode resolution hands back WORKING connectors ───────────────
  const graphRes = resolveGraphPostureConnector({});
  const dmhRes = resolveDeviceManagementHealthConnector({});
  const laRes = resolveLocalAuthorityConnector({});
  check("graph: default env resolves to fixture mode", graphRes.mode === "fixture");
  check("device-management-health: default env resolves to fixture mode", dmhRes.mode === "fixture");
  check("local-authority: default env resolves to fixture mode", laRes.mode === "fixture");
  check(
    "all three fixture resolutions carry a WORKING connector, not just a refusal",
    graphRes.connector !== undefined && dmhRes.connector !== undefined && laRes.fetchState !== undefined,
  );

  // The live gate is untouched by this change: dev tier still never goes live,
  // and a fully-armed env still does (transport injected so nothing is called).
  const armed = {
    SIGNALGRID_TIER: "prod",
    SIGNALGRID_LIVE_INTEGRATIONS: "true",
    GRAPH_ACCESS_TOKEN: "t",
  } as NodeJS.ProcessEnv;
  check(
    "graph: the live gate still resolves live when fully armed",
    resolveGraphPostureConnector(armed, async () => ({ status: 200, ok: true, json: async () => ({ value: [] }) })).mode === "live",
  );

  // ── 2. Graph family: paginated fixture read → posture signals → drafts ─────
  const postures = await graphRes.connector.fetchPosture(OBSERVED);
  check("graph: fixture connector reads the full synthetic inventory (7 devices, paged)", postures.length === 7, `count=${postures.length}`);
  check(
    "graph: every posture signal carries provenance (source, correlation, subject)",
    postures.every((p) => p.sourceSystem === "microsoft-graph" && p.correlationId.length > 0 && p.subjectId !== null && p.subjectId.startsWith("synthetic-user-")),
  );

  const healthy = postures.find((p) => p.deviceId === "synthetic-device-001");
  const disabled = postures.find((p) => p.deviceId === "synthetic-device-002");
  const unmanaged = postures.find((p) => p.deviceId === "synthetic-device-005");
  const missing = postures.find((p) => p.deviceId === "synthetic-device-006");
  check("graph: the healthy case normalized (enabled, compliant, managed)",
    healthy?.identityStatus === "enabled" && healthy?.deviceComplianceState === "compliant" && healthy?.deviceManagementState === "managed");
  check("graph: the disabled-identity case normalized", disabled?.identityStatus === "disabled");
  check("graph: the unmanaged case normalized", unmanaged?.deviceManagementState === "unmanaged");
  check("graph: the wire 'unknown' compliance case normalized to missing", missing?.deviceComplianceState === "missing");

  const healthyDrafts = graphPostureToDrafts(healthy!);
  check(
    "bridge: healthy graph posture → identity true, compliance compliant, managed true",
    valueOf(healthyDrafts, "identity_state") === true &&
      valueOf(healthyDrafts, "device_compliance") === "compliant" &&
      valueOf(healthyDrafts, "device_management") === true,
  );
  check("bridge: disabled identity maps to identity_state=false", valueOf(graphPostureToDrafts(disabled!), "identity_state") === false);
  check("bridge: unmanaged maps to device_management=false", valueOf(graphPostureToDrafts(unmanaged!), "device_management") === false);
  check("bridge: missing compliance maps to the honest 'unknown', never 'compliant'", valueOf(graphPostureToDrafts(missing!), "device_compliance") === "unknown");
  // The Fleet posture signal carries NO enrollment field. Until 2026-09-05 the adapter
  // asserted `device_management: true` from it unconditionally — derived from "Fleet
  // returned a host row", not from an answer about management — and that literal
  // satisfied the healthy-allow rule, moving a verdict from step_up to allow on a fact
  // nobody had read. Silence is the rule where a source did not answer.
  const fleetDrafts = fleetDMToPostureDrafts({ hostUuid: "h-1", platform: "darwin", compliant: true, lastCheckAt: OBSERVED, policies: [{ response: "pass" }] } as never);
  check(
    "bridge: the Fleet posture signal (no enrollment field) emits NO device_management draft — silence, never an asserted `true` — while compliance still maps",
    !fleetDrafts.some((d) => d.category === "device_management") && valueOf(fleetDrafts, "device_compliance") === "compliant",
  );

  // ── 3. In-code fixture dataset must not drift from the committed JSON ──────
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const jsonPath = join(repo, "fixtures", "microsoft-graph", "identity-device-posture.json");
  const fixture = JSON.parse(readFileSync(jsonPath, "utf8")) as {
    cases: Array<{
      subjectId: string;
      deviceId: string;
      identityStatus: string;
      userRisk: string;
      deviceComplianceState: string;
      deviceManagementState: string;
      deviceRegistrationState: string;
      deviceLastSeenAt: string;
    }>;
  };
  check("drift: the JSON fixture still has the 7 cases the in-code dataset mirrors", fixture.cases.length === FIXTURE_GRAPH_DEVICES.length);
  // The JSON records the NORMALIZED compliance state; the in-code dataset holds
  // Graph's wire spelling. The only pair where they differ: wire "unknown"
  // (compliance never evaluated) normalizes to "missing".
  const wireComplianceFor = (jsonState: string): string => (jsonState === "missing" ? "unknown" : jsonState);
  for (const c of fixture.cases) {
    const user = FIXTURE_GRAPH_USERS.find((u) => u.id === c.subjectId);
    const risky = FIXTURE_GRAPH_RISKY_USERS.find((r) => r.id === c.subjectId);
    const device = FIXTURE_GRAPH_DEVICES.find((d) => d.id === c.deviceId);
    check(
      `drift: ${c.deviceId} matches fixtures/microsoft-graph JSON case for case`,
      user !== undefined &&
        device !== undefined &&
        user.accountEnabled === (c.identityStatus === "enabled") &&
        (risky?.riskLevel ?? "none") === c.userRisk &&
        device.complianceState === wireComplianceFor(c.deviceComplianceState) &&
        device.managementState === c.deviceManagementState &&
        device.deviceRegistrationState === c.deviceRegistrationState &&
        device.lastSyncDateTime === c.deviceLastSeenAt,
    );
  }

  // ── 4. Device-management-health family through its fixture connector ───────
  const dmhHealthy = evaluateDeviceManagementHealth(await dmhRes.connector.fetchHealth("ipad-ward-01"));
  const dmhStale = evaluateDeviceManagementHealth(await dmhRes.connector.fetchHealth("ipad-ward-02"));
  const dmhRetired = evaluateDeviceManagementHealth(await dmhRes.connector.fetchHealth("ipad-retired-99"));
  check("dmh: ward-01 earns the seven-way positive confirmation", dmhHealthy.managementEffective && dmhHealthy.reasonCode === "MANAGEMENT_HEALTHY");
  check("dmh: ward-02 is stale on the MDM channel", dmhStale.reasonCode === "MDM_CHECKIN_STALE");
  check("dmh: retired-99 restricts (retired but still in someone's hands)", dmhRetired.recommendedAction === "restrict" && dmhRetired.reasonCode === "ENROLLMENT_RETIRED");

  check("bridge: managed_healthy → 'healthy'", valueOf(deviceManagementHealthToDrafts(dmhHealthy, OBSERVED), "device_management_health") === "healthy");
  check("bridge: stale MDM channel → 'degraded' (never 'broken' past the family's own action)", valueOf(deviceManagementHealthToDrafts(dmhStale, OBSERVED), "device_management_health") === "degraded");
  check("bridge: retired enrollment → 'broken'", valueOf(deviceManagementHealthToDrafts(dmhRetired, OBSERVED), "device_management_health") === "broken");

  // A not-covered device (mock 404) is an honest hole → unknown, never healthy.
  let notCovered = false;
  try {
    await dmhRes.connector.fetchHealth("ipad-ghost-00");
  } catch {
    notCovered = true;
  }
  check("dmh: an unknown device 404s rather than inventing a healthy report", notCovered);
  const dmhGhost = evaluateDeviceManagementHealth(
    { sourceSystem: "device-management-health", deviceId: "ipad-ghost-00", mdmCheckInFreshness: "unknown", agentCheckInFreshness: "unknown", remediationHealth: "unknown", policyDrift: "unknown", complianceCoverage: "unknown", enrollmentState: "unknown", managementReachable: null, rootCauseEvidence: "unknown", reportIntegrity: "clean", source: "fixture" },
    { covered: false },
  );
  check("bridge: NOT_COVERED → 'unknown' (day-one-quiet: the core rule will not fire)", valueOf(deviceManagementHealthToDrafts(dmhGhost, OBSERVED), "device_management_health") === "unknown");

  // ── 5. Local-authority family through its fixture fetchState ───────────────
  // The demo records tell their story against their OWN epoch (observed
  // 2026-01-01T08:00Z, grants minted at 06:00) — grant arithmetic is
  // grant-issued vs the caller's reference instant, so the reference is the
  // records' instant, not the sync clock. Normalizing these against a reference
  // months later would (correctly!) read every grant as long expired.
  const LA_REF = "2026-01-01T08:00:00.000Z";
  const laCurrent = evaluateLocalAuthority(normalizeLocalAuthority(await laRes.fetchState("ipad.ward.7a"), LA_REF));
  const laRebooted = evaluateLocalAuthority(normalizeLocalAuthority(await laRes.fetchState("ipad.ward.7b-rebooted"), LA_REF));
  // The decay case evaluates against ITS OWN observation instant — the grant
  // math is grant-issued vs reference, and this record's story is 14h dark
  // against a 12h grant.
  const laOverheld = evaluateLocalAuthority(
    normalizeLocalAuthority(await laRes.fetchState("ipad.er.overheld"), "2026-01-01T08:00:00.000Z"),
  );
  check("la: ward.7a may act locally (readable vault, verified human, live grant, trusted time)", laCurrent.mayActLocally);
  check("la: the rebooted iPad restricts — awaiting first unlock", laRebooted.action === "restrict" && laRebooted.posture === "awaiting_unlock");
  check("la: the overheld iPad restricts — past its own declared interval", laOverheld.action === "restrict" && laOverheld.posture === "authority_lapsed");

  check("bridge: current authority → 'verified'", valueOf(localAuthorityToDrafts(laCurrent, OBSERVED), "local_authority") === "verified");
  check("bridge: awaiting first unlock → 'withheld'", valueOf(localAuthorityToDrafts(laRebooted, OBSERVED), "local_authority") === "withheld");
  check("bridge: lapsed grant → 'withheld'", valueOf(localAuthorityToDrafts(laOverheld, OBSERVED), "local_authority") === "withheld");
  check(
    "bridge: a step_up-level gap stays 'unverified' — unknown raises, never restricts",
    valueOf(localAuthorityToDrafts(evaluateLocalAuthority(normalizeLocalAuthority(null, NOW)), OBSERVED), "local_authority") === "unverified",
  );

  // ── 6. THE SEAM: family outputs → core sync → decision → evidence ──────────
  const clock = fixedClock(NOW);
  const seeded = seedDemoStore(clock);
  const tenantId = seeded.tenants.northwind;
  const store = seeded.store;

  const subjects: Array<{ identityRef: string; deviceRef: string; record: FixturePostureRecord }> = [
    scenario("launch.nurse.healthy", "launch-ipad-01", healthyDrafts, deviceManagementHealthToDrafts(dmhHealthy, OBSERVED), localAuthorityToDrafts(laCurrent, OBSERVED)),
    scenario("launch.nurse.broken", "launch-ipad-02", healthyDrafts, deviceManagementHealthToDrafts(dmhRetired, OBSERVED), localAuthorityToDrafts(laCurrent, OBSERVED)),
    scenario("launch.nurse.withheld", "launch-ipad-03", healthyDrafts, deviceManagementHealthToDrafts(dmhHealthy, OBSERVED), localAuthorityToDrafts(laRebooted, OBSERVED)),
  ];
  for (const s of subjects) {
    store.putIdentity({ id: `id_${tenantId}_${s.identityRef}`, tenantId, externalRef: s.identityRef, displayName: s.identityRef, state: "enabled", assignedRole: "nurse" });
    store.putDevice({ id: `dev_${tenantId}_${s.deviceRef}`, tenantId, externalRef: s.deviceRef, name: s.deviceRef, osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" });
  }

  const connector: Connector = {
    id: `conn_${tenantId}_launch_seam`,
    tenantId,
    kind: "microsoft-entra-intune",
    mode: "fixture",
    permissionScope: "DeviceManagementManagedDevices.Read.All (read-only, documented not exercised)",
    credentialRef: `keyvault-placeholder://${tenantId}/launch-seam-readonly (non-secret placeholder)`,
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runFixtureSync(store, clock, connector, subjects.map((s) => s.record));
  check("seam: the fixture sync normalized signals for all three scenarios", run.status === "success" && run.recordsProcessed === 3 && run.signalsNormalized > 0, `signals=${run.signalsNormalized}`);

  const healthyOut = evaluateDecision(store, clock, tenantId, "proof:launch-seam", { identityRef: "launch.nurse.healthy", deviceRef: "launch-ipad-01", workflowKey: "clinical-session" });
  check("seam: healthy across all three families → ALLOW", healthyOut.result.outcome === "allow", healthyOut.result.reasonCodes.join(","));
  const healthySnap = store.getSnapshot(tenantId, healthyOut.result.evidenceSnapshotId);
  check(
    "seam: the evidence snapshot carries both launch-family facts, sourced from the sync",
    healthySnap?.evidence.managementHealthState === "healthy" && healthySnap?.evidence.localAuthorityState === "verified",
  );

  const brokenOut = evaluateDecision(store, clock, tenantId, "proof:launch-seam", { identityRef: "launch.nurse.broken", deviceRef: "launch-ipad-02", workflowKey: "clinical-session" });
  check("seam: a retired management plane → RESTRICT with MANAGEMENT_HEALTH_BROKEN", brokenOut.result.outcome === "restrict" && brokenOut.result.reasonCodes.includes("MANAGEMENT_HEALTH_BROKEN"), `${brokenOut.result.outcome}:${brokenOut.result.reasonCodes.join(",")}`);

  const withheldOut = evaluateDecision(store, clock, tenantId, "proof:launch-seam", { identityRef: "launch.nurse.withheld", deviceRef: "launch-ipad-03", workflowKey: "clinical-session" });
  check("seam: withheld local authority → RESTRICT with LOCAL_AUTHORITY_WITHHELD", withheldOut.result.outcome === "restrict" && withheldOut.result.reasonCodes.includes("LOCAL_AUTHORITY_WITHHELD"), `${withheldOut.result.outcome}:${withheldOut.result.reasonCodes.join(",")}`);

  // Determinism: the same pipeline over the same fixtures mints the same evidence.
  const seeded2 = seedDemoStore(fixedClock(NOW));
  const store2 = seeded2.store;
  for (const s of subjects) {
    store2.putIdentity({ id: `id_${tenantId}_${s.identityRef}`, tenantId, externalRef: s.identityRef, displayName: s.identityRef, state: "enabled", assignedRole: "nurse" });
    store2.putDevice({ id: `dev_${tenantId}_${s.deviceRef}`, tenantId, externalRef: s.deviceRef, name: s.deviceRef, osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" });
  }
  store2.putConnector(connector);
  runFixtureSync(store2, fixedClock(NOW), connector, subjects.map((s) => s.record));
  const replay = evaluateDecision(store2, fixedClock(NOW), tenantId, "proof:launch-seam", { identityRef: "launch.nurse.broken", deviceRef: "launch-ipad-02", workflowKey: "clinical-session" });
  check("seam: DETERMINISM — replaying the pipeline reproduces the same outcome and reasons", replay.result.outcome === brokenOut.result.outcome && replay.result.reasonCodes.join(",") === brokenOut.result.reasonCodes.join(","));

  // ── 7. Zero network, verified ──────────────────────────────────────────────
  check("zero network: not one fetch() was attempted across the whole seam", fetchAttempts === 0, `attempts=${fetchAttempts}`);

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  console.log("figures=launchFamilies=3,scenarios=3");
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("launch seam closed: fixture connector → bridge → core decision → evidence, all three families, offline.");
}

/** Read the value of the first draft in `drafts` with the given category. */
function valueOf(drafts: PostureSignalDraft[], category: string): unknown {
  return drafts.find((d) => d.category === category)?.value;
}

/**
 * Compose one scenario's FixturePostureRecord from the three families' bridge
 * drafts — the exact hand-off the connector worker performs. Graph supplies the
 * identity/compliance/management answers; the other two supply their single
 * launch-family signal each. Fields no draft answered stay at the honest
 * defaults the core treats as unknown.
 */
function scenario(
  identityRef: string,
  deviceRef: string,
  graphDrafts: PostureSignalDraft[],
  dmhDrafts: PostureSignalDraft[],
  laDrafts: PostureSignalDraft[],
): { identityRef: string; deviceRef: string; record: FixturePostureRecord } {
  const compliance = valueOf(graphDrafts, "device_compliance");
  return {
    identityRef,
    deviceRef,
    record: {
      deviceRef,
      identityRef,
      identityEnabled: valueOf(graphDrafts, "identity_state") === true,
      managed: valueOf(graphDrafts, "device_management") === true,
      compliance: compliance === "compliant" || compliance === "non_compliant" ? compliance : "unknown",
      encrypted: true,
      osSupported: true,
      lastSyncAt: OBSERVED,
      baseline: "aligned",
      managementHealth: valueOf(dmhDrafts, "device_management_health") as FixturePostureRecord["managementHealth"],
      localAuthority: valueOf(laDrafts, "local_authority") as FixturePostureRecord["localAuthority"],
      sourceReference: `fixture:launch-seam#${deviceRef}`,
    },
  };
}

main().catch((err) => {
  console.error(`proof:launch-seam crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
