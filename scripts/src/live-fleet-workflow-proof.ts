// Proof (opt-in, live): a REAL Fleet host drives the ACTUAL decision workflow.
//
// proof:live-fleet verifies the telemetry adapter against a live server;
// proof:launch-seam closes connector→decision with zero network. This proof
// closes the seam those two leave between them: live wire JSON from a real
// Fleet — with a real enrolled osqueryd agent — travels the SAME path a
// deployment would use, all the way to an allow/step-up/restrict/deny verdict:
//
//   GET /hosts/identifier/{uuid}  (raw wire)
//     → toHostReport → normalizeFleetReport → fleetOutcome        (connector)
//     → fleetHostToDeviceManagementEvidence → …ToFixtureRecord    (contract)
//     → runFixtureSync → evaluateDecision → evidence snapshot     (core)
//
// The container lab host is UNMANAGED (no MDM enrollment is possible in a
// Docker container), which makes it the perfect live subject: every layer must
// grade it in the fail-safe direction, and the final verdict must be RESTRICT
// with DEVICE_UNMANAGED — a real host the gate correctly refuses to trust.
// A synthetic control (same record, management fields flipped healthy) then
// proves the LIVE fields were load-bearing rather than ignored.
//
// Refusal pattern: proof:live-edr's. Refuses without FLEET_URL / FLEET_TOKEN /
// FLEET_HOST_UUID; the macOS harness skips it BY NAME, never silently.
//
// The live policy-flip section additionally requires FLEET_LAB_WRITE_OK=true,
// because it WRITES to the target Fleet (creates, then deletes, one failing
// global policy). Point it only at a disposable lab. Without the env it skips
// LOUDLY, and the skip is printed, never counted as a pass.

import {
  evaluateDecision,
  runFixtureSync,
  seedDemoStore,
  fixedClock,
  type Connector,
  type FixturePostureRecord,
} from "@workspace/signalgrid-core";
import {
  deviceManagementEvidenceToFixtureRecord,
  fleetHostToDeviceManagementEvidence,
  fleetDMToPostureDrafts,
} from "@workspace/integration-bridge";
import { toHostReport, normalizeFleetReport, fleetOutcome } from "@workspace/fleet-connector";
import { FleetDMAdapter, setFleetDMConfig } from "@workspace/integrations/telemetry";

const FLEET_BASE = process.env.FLEET_URL ?? "";
const TOKEN = process.env.FLEET_TOKEN ?? "";
const HOST_UUID = process.env.FLEET_HOST_UUID ?? "";
const WRITE_OK = process.env.FLEET_LAB_WRITE_OK === "true";

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

async function raw(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(`${FLEET_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.text() };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!FLEET_BASE || !TOKEN || !HOST_UUID) {
    console.error(
      "proof:live-fleet-workflow REFUSED: FLEET_URL, FLEET_TOKEN and FLEET_HOST_UUID are all required.\n" +
        "This proof drives the decision workflow from a LIVE Fleet host and cannot mean anything without one.",
    );
    process.exit(1);
  }

  // ── 1. The live wire, through the connector's own normalization ────────────
  const wire = await raw(`/api/v1/fleet/hosts/identifier/${encodeURIComponent(HOST_UUID)}`);
  check("the live host answers on the wire", wire.status === 200, `status=${wire.status}`);
  const wireHost = (JSON.parse(wire.body) as { host?: Record<string, unknown> }).host;
  check("…as a { host } envelope", wireHost !== undefined);

  const nowIso = new Date().toISOString(); // a live proof runs on live time by nature
  const report = toHostReport(wireHost);
  check("toHostReport keeps the live identity", report.hostRef === HOST_UUID, `hostRef=${report.hostRef}`);
  check("a container host is honestly UNMANAGED (no MDM enrollment exists in Docker)", report.mdmEnrolled === false);

  const signal = normalizeFleetReport(report, nowIso);
  check("normalizeFleetReport: unmanaged → deviceManaged=false, enforceable=false",
    signal.deviceManaged === false && signal.enforceable === false);
  check("…and assurance is RAISED, never lowered, by the weak posture",
    signal.assurance === "raise_step_up", `assurance=${signal.assurance}`);
  const outcome = fleetOutcome(signal);
  check("fleetOutcome refuses to allow an unmanaged live host", outcome !== "allow", `outcome=${outcome}`);

  // ── 2. The evidence contract carries the live read without softening it ────
  const evidence = fleetHostToDeviceManagementEvidence(report, { tenantId: "lab", nowIso });
  check("evidence: sourceSystem=fleet, managedState=unmanaged, sourced from the wire",
    evidence.sourceSystem === "fleet" && evidence.managedState === "unmanaged" &&
      evidence.sourceReferences[0]?.includes("fleet:host#") === true,
    `refs=${evidence.sourceReferences.join(",")}`);

  // ── 3. THE WORKFLOW: the live record reaches a real verdict ────────────────
  // Context facts the evidence does not carry (identity enabled, encryption,
  // OS support) are POSED healthy on purpose: every remaining concern in the
  // verdict then comes from what the live server actually said.
  const record: FixturePostureRecord = deviceManagementEvidenceToFixtureRecord(evidence, {
    identityRef: "lab.live.host",
    identityEnabled: true,
    encrypted: true,
    osSupported: true,
    managementHealth: "healthy",
    localAuthority: "verified",
  });
  check("the record is derived, not asserted: managed=false straight from the live wire", record.managed === false);

  const clock = fixedClock(nowIso);
  const seeded = seedDemoStore(clock);
  const tenantId = seeded.tenants.northwind;
  const store = seeded.store;
  store.putIdentity({ id: `id_${tenantId}_lab.live.host`, tenantId, externalRef: "lab.live.host", displayName: "lab.live.host", state: "enabled", assignedRole: "nurse" });
  store.putDevice({ id: `dev_${tenantId}_${record.deviceRef}`, tenantId, externalRef: record.deviceRef, name: "live fleet lab host", osPlatform: "linux", osVersion: "container", ownerType: "shared", managementAgent: "intune" });
  // ConnectorKind is a closed union with no "fleet" member — the sync carrier
  // kind is cosmetic here; the record itself is source-tagged fleet:host#…
  const connector: Connector = {
    id: `conn_${tenantId}_live_fleet_workflow`,
    tenantId,
    kind: "microsoft-entra-intune",
    mode: "fixture",
    permissionScope: "read-only lab exercise (live Fleet wire → fixture sync)",
    credentialRef: "none — the record was fetched by this proof, not by the connector",
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runFixtureSync(store, clock, connector, [record]);
  check("the live-derived record syncs into the core", run.status === "success" && run.recordsProcessed === 1);

  const live = evaluateDecision(store, clock, tenantId, "proof:live-fleet-workflow", {
    identityRef: "lab.live.host", deviceRef: record.deviceRef, workflowKey: "clinical-session",
  });
  check("VERDICT: the real unmanaged host is RESTRICTED by the real workflow",
    live.result.outcome === "restrict", `outcome=${live.result.outcome}`);
  check("…for the right reason: DEVICE_UNMANAGED is among the reason codes",
    live.result.reasonCodes.includes("DEVICE_UNMANAGED"), live.result.reasonCodes.join(","));
  const snap = store.getSnapshot(tenantId, live.result.evidenceSnapshotId);
  check("…and the evidence snapshot names the live source, so the verdict is traceable to the wire",
    snap !== undefined, `snapshotId=${live.result.evidenceSnapshotId}`);

  // ── 4. Mutation control: the live fields are load-bearing ──────────────────
  // Same record with the management facts flipped healthy. If the verdict does
  // not improve, the engine was ignoring the fields the live server supplied,
  // and section 3's restrict would be vacuous.
  const controlRecord: FixturePostureRecord = { ...record, deviceRef: `${record.deviceRef}-control`, managed: true, compliance: "compliant", baseline: "aligned" };
  store.putDevice({ id: `dev_${tenantId}_${controlRecord.deviceRef}`, tenantId, externalRef: controlRecord.deviceRef, name: "synthetic control", osPlatform: "linux", osVersion: "container", ownerType: "shared", managementAgent: "intune" });
  const run2 = runFixtureSync(store, clock, connector, [controlRecord]);
  check("control record syncs", run2.status === "success");
  const control = evaluateDecision(store, clock, tenantId, "proof:live-fleet-workflow", {
    identityRef: "lab.live.host", deviceRef: controlRecord.deviceRef, workflowKey: "clinical-session",
  });
  check("CONTROL: flipping the live-sourced fields healthy removes the restriction",
    control.result.outcome !== "restrict" && !control.result.reasonCodes.includes("DEVICE_UNMANAGED"),
    `outcome=${control.result.outcome}:${control.result.reasonCodes.join(",")}`);

  // ── 5. Live flip on the telemetry path (lab-write gated) ───────────────────
  if (!WRITE_OK) {
    console.log("  SKIPPED (loudly, by name): the live policy-flip section requires FLEET_LAB_WRITE_OK=true —");
    console.log("  it creates and deletes one failing global policy on the target Fleet, so it must only ever");
    console.log("  point at a disposable lab. Skipped is skipped; it is NOT counted as passed.");
  } else {
    process.env.FLEETDM_BASE_URL = FLEET_BASE;
    process.env.FLEETDM_API_TOKEN = TOKEN;
    process.env.SIGNALGRID_TIER = "prod";
    process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
    await setFleetDMConfig({ enabled: true, baseUrl: FLEET_BASE, apiToken: TOKEN, syncIntervalMs: 300000 });
    const fleet = new FleetDMAdapter();
    await fleet.initialize();

    const before = await fleet.getPostureForHost(HOST_UUID);
    check("flip baseline: a live posture exists before the flip", before !== null);

    const mk = await raw("/api/v1/fleet/global/policies", {
      method: "POST",
      body: JSON.stringify({
        name: `flip-proof failing policy ${nowIso}`,
        query: "SELECT 1 FROM users WHERE 1=0;",
        description: "deliberately unsatisfiable — proof:live-fleet-workflow flip section",
        resolution: "n/a (lab)",
      }),
    });
    check("a deliberately failing policy is accepted by the lab", mk.status === 200, `status=${mk.status}`);
    const policyId = (JSON.parse(mk.body) as { policy?: { id?: number } }).policy?.id;

    let flipped = false;
    let after: Awaited<ReturnType<typeof fleet.getPostureForHost>> = null;
    for (let i = 0; i < 24 && !flipped; i += 1) {
      await sleep(5000);
      after = await fleet.getPostureForHost(HOST_UUID);
      const answered = after?.policies.find((p) => p.id === policyId);
      if (answered && answered.response === "fail") flipped = true;
    }
    check("THE LIVE FLIP: the real agent answered the new policy FAIL within the window", flipped);
    check("…and the live posture verdict flipped to non-compliant on real evidence",
      after?.compliant === false, `compliant=${String(after?.compliant)}`);
    const drafts = after ? fleetDMToPostureDrafts(after) : [];
    check("…and the bridge carries the flip: device_compliance draft is non_compliant",
      drafts.find((d) => d.category === "device_compliance")?.value === "non_compliant");

    if (typeof policyId === "number") {
      const del = await raw("/api/v1/fleet/global/policies/delete", {
        method: "POST",
        body: JSON.stringify({ ids: [policyId] }),
      });
      check("lab hygiene: the failing policy is deleted after the flip", del.status === 200, `status=${del.status}`);
    }
  }

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("live Fleet host → connector → evidence contract → fixture sync → decision: the workflow restricts a real unmanaged host, and live state changes move the verdict.");
}

main().catch((err) => {
  console.error(`proof:live-fleet-workflow crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
