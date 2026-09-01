// Proof: the DeviceManagementEvidence contract is SOURCE-AGNOSTIC — swap the
// adapter, the decision does not change.
//
// The 2026-08-11 owner redirect (intake ledger row 77) made this the product's
// central claim: "The product should not care which source produced the
// evidence as long as the adapter emits the same normalized model." Open-source
// MDM (Fleet, Headwind-shaped Android) is the low-cost engineering lab;
// Microsoft Intune is the enterprise production connector — and the decision
// engine must be unable to tell them apart except by provenance.
//
// So this proof expresses the SAME logical device states through THREE
// adapters — a Fleet host report, a Headwind-shaped Android lab device, and
// Intune-shaped evidence — runs each through the identical seam
// (contract → fixture record → runFixtureSync → evaluateDecision → evidence)
// and asserts the outcomes and reason codes are IDENTICAL, with only the
// provenance strings differing. Plus the contract's own laws: silence for the
// unanswered, quality lowers and never raises, and the unearned NEGATIVE
// refused (unknown management may not become an "unmanaged" boolean).
//
// Zero network, enforced: `fetch` is replaced with a tripwire for the run.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateDecision,
  runFixtureSync,
  seedDemoStore,
  fixedClock,
  type Connector,
} from "@workspace/signalgrid-core";
import {
  ANDROID_LAB_DEVICES,
  ANDROID_LAB_OBSERVED_AT,
  deviceManagementEvidenceToDrafts,
  deviceManagementEvidenceToFixtureRecord,
  effectiveEvidence,
  fleetHostToDeviceManagementEvidence,
  fleetDMFreshness,
  headwindLabToDeviceManagementEvidence,
  type DeviceManagementEvidence,
  type EvidenceRecordContext,
} from "@workspace/integration-bridge";
import { DEMO_FLEET_REPORTS, FLEET_OBSERVED_AT, type FleetHostReport } from "@workspace/fleet-connector";

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

// ── Zero-network tripwire ────────────────────────────────────────────────────
let fetchAttempts = 0;
(globalThis as { fetch: unknown }).fetch = () => {
  fetchAttempts += 1;
  throw new Error("proof:evidence-adapter attempted a network call — the lab is offline by definition");
};

const NOW = "2026-07-16T14:00:00.000Z";
const SEEN = "2026-07-16T13:00:00.000Z"; // one hour before NOW → fresh everywhere

/** Intune-shaped evidence — the enterprise adapter's output, hand-shaped. */
function intuneEvidence(
  deviceId: string,
  state: { managed: boolean; compliant: boolean; policiesPass: boolean },
): DeviceManagementEvidence {
  return {
    tenantId: "tenant_lab",
    sourceSystem: "intune",
    sourceRecordId: `managedDevices/${deviceId}`,
    deviceId,
    platform: "ipados",
    managedState: state.managed ? "managed" : "unmanaged",
    complianceState: state.compliant ? "compliant" : "noncompliant",
    policyState: state.policiesPass ? "passing" : "failing",
    ownership: "shared",
    lastSeenAt: SEEN,
    observedAt: NOW,
    evidenceQuality: "source_verified",
    sourceReferences: [`intune:managedDevices#${deviceId}`],
  };
}

/** Fleet host expressing the same two logical states. */
function fleetHost(hostRef: string, state: { managed: boolean; compliant: boolean }): FleetHostReport {
  return state.compliant
    ? { hostRef, mdmEnrolled: state.managed, supervised: true, diskEncryption: "on", screenLock: "on", osMajor: 18, osFloor: 17, lastSeenAt: SEEN }
    : { hostRef, mdmEnrolled: state.managed, supervised: true, diskEncryption: "off", screenLock: "on", osMajor: 18, osFloor: 17, lastSeenAt: SEEN };
}

function draftPairs(e: DeviceManagementEvidence): string {
  return deviceManagementEvidenceToDrafts(e)
    .map((d) => `${d.category}=${String(d.value)}`)
    .sort()
    .join(",");
}

async function main(): Promise<void> {
  console.log("proof:evidence-adapter — one contract, many sources, one decision\n");

  // ── 1. Contract laws ───────────────────────────────────────────────────────
  console.log("— contract laws —");
  const unknownEverything: DeviceManagementEvidence = {
    tenantId: "tenant_lab", sourceSystem: "nanomdm", sourceRecordId: "r1", deviceId: "d1",
    platform: "unknown", managedState: "unknown", complianceState: "unknown",
    observedAt: NOW, evidenceQuality: "source_verified", sourceReferences: ["nanomdm:devices#d1"],
  };
  check("silence law: an all-unknown read emits NO drafts (absence raises assurance, never fires a rule)",
    deviceManagementEvidenceToDrafts(unknownEverything).length === 0);

  const contradictory: DeviceManagementEvidence = {
    ...unknownEverything, managedState: "managed", complianceState: "compliant", policyState: "passing",
    evidenceQuality: "contradictory",
  };
  const eff = effectiveEvidence(contradictory);
  check("quality law: contradictory quality withdraws EVERY positive assertion",
    eff.managedState === "unknown" && eff.complianceState === "unknown" && eff.policyState === "unknown");
  const contradictoryBad: DeviceManagementEvidence = {
    ...contradictory, complianceState: "noncompliant", policyState: "failing",
  };
  const effBad = effectiveEvidence(contradictoryBad);
  check("quality law: the negative findings of a contradictory read STAND (the worst answer is still an answer)",
    effBad.complianceState === "noncompliant" && effBad.policyState === "failing");
  check("quality law: source_stale does NOT withdraw states — age is freshness's job, not a second unknown",
    effectiveEvidence({ ...contradictory, evidenceQuality: "source_stale" }).complianceState === "compliant");
  check("spelling translation: the contract's 'noncompliant' becomes the core's 'non_compliant' in drafts",
    draftPairs({ ...unknownEverything, complianceState: "noncompliant" }).includes("device_compliance=non_compliant"));

  let threw = false;
  try {
    deviceManagementEvidenceToFixtureRecord(unknownEverything, { identityRef: "i", identityEnabled: true, encrypted: true, osSupported: true });
  } catch { threw = true; }
  check("unearned-negative refusal: unknown management CANNOT become a fixture record's managed:false", threw);

  // ── 2. The Fleet adapter over the proven fixture ───────────────────────────
  console.log("\n— fleet adapter (the open-source lab source) —");
  const fleetEv = DEMO_FLEET_REPORTS.map((r) => fleetHostToDeviceManagementEvidence(r, { tenantId: "tenant_lab", nowIso: FLEET_OBSERVED_AT }));
  check("every demo Fleet host maps to contract evidence with sourceSystem 'fleet'",
    fleetEv.length === DEMO_FLEET_REPORTS.length && fleetEv.every((e) => e.sourceSystem === "fleet"));
  const unenrolled = fleetEv.find((e) => e.managedState === "unmanaged");
  check("an unenrolled Fleet host is affirmatively unmanaged", unenrolled !== undefined);
  check("a disk-encryption-off host is affirmatively noncompliant (Fleet's own fail-closed grading, not re-litigated here)",
    fleetEv.some((e) => e.complianceState === "noncompliant"));
  check("no Fleet evidence invents ownership — the host list does not carry it, so it is 'unknown'",
    fleetEv.every((e) => e.ownership === "unknown"));
  check("provenance flows: every Fleet evidence carries the connector's own sourceReference",
    fleetEv.every((e) => e.sourceReferences[0]!.includes("fleet")));

  // ── 3. The Headwind-shaped Android lab adapter ─────────────────────────────
  console.log("\n— headwind-shaped android lab adapter (fixture shape, not a family) —");
  const hwEv = ANDROID_LAB_DEVICES.map((d) => headwindLabToDeviceManagementEvidence(d, { tenantId: "tenant_lab", observedAt: ANDROID_LAB_OBSERVED_AT }));
  check("every lab device maps with sourceSystem 'headwind', platform 'android', ownership 'shared'",
    hwEv.every((e) => e.sourceSystem === "headwind" && e.platform === "android" && e.ownership === "shared"));
  check("positive compliant demands config applied AND kiosk engaged (hw-scanner-01)",
    hwEv.find((e) => e.deviceId === "hw-scanner-01")?.complianceState === "compliant");
  check("a failed config push is affirmatively noncompliant (hw-tablet-02)",
    hwEv.find((e) => e.deviceId === "hw-tablet-02")?.complianceState === "noncompliant");
  check("the unenrolled spare answers NOTHING about compliance — unknown, not bad (hw-spare-03)",
    hwEv.find((e) => e.deviceId === "hw-spare-03")?.complianceState === "unknown");

  // ── 4. THE SWAP — same state, three sources, one decision ──────────────────
  console.log("\n— the swap: fleet vs headwind vs intune, decided identically —");
  const clock = fixedClock(NOW);
  const seeded = seedDemoStore(clock);
  const store = seeded.store;
  const tenantId = seeded.tenants.northwind;

  const healthyBySource: Array<{ label: string; evidence: DeviceManagementEvidence }> = [
    { label: "fleet", evidence: fleetHostToDeviceManagementEvidence(fleetHost("lab-dev-fleet-ok", { managed: true, compliant: true }), { tenantId, nowIso: NOW }) },
    { label: "headwind", evidence: headwindLabToDeviceManagementEvidence({ deviceNumber: "lab-dev-hw-ok", model: "Zebra TC52", enrolled: true, kioskLocked: true, configApplied: "applied", lastSeenAt: SEEN }, { tenantId, observedAt: NOW }) },
    { label: "intune", evidence: intuneEvidence("lab-dev-intune-ok", { managed: true, compliant: true, policiesPass: true }) },
  ];
  const badBySource: Array<{ label: string; evidence: DeviceManagementEvidence }> = [
    { label: "fleet", evidence: fleetHostToDeviceManagementEvidence(fleetHost("lab-dev-fleet-bad", { managed: true, compliant: false }), { tenantId, nowIso: NOW }) },
    { label: "headwind", evidence: headwindLabToDeviceManagementEvidence({ deviceNumber: "lab-dev-hw-bad", model: "Samsung Tab Active4", enrolled: true, kioskLocked: true, configApplied: "failed", lastSeenAt: SEEN }, { tenantId, observedAt: NOW }) },
    { label: "intune", evidence: intuneEvidence("lab-dev-intune-bad", { managed: true, compliant: false, policiesPass: false }) },
  ];

  check("the three healthy readings emit IDENTICAL drafts — the engine cannot tell the sources apart",
    new Set(healthyBySource.map((s) => draftPairs(s.evidence))).size === 1,
    healthyBySource.map((s) => `${s.label}:[${draftPairs(s.evidence)}]`).join(" "));
  check("the three noncompliant readings emit IDENTICAL drafts",
    new Set(badBySource.map((s) => draftPairs(s.evidence))).size === 1,
    badBySource.map((s) => `${s.label}:[${draftPairs(s.evidence)}]`).join(" "));

  const recordCtx: EvidenceRecordContext = {
    identityRef: "", // per-subject below
    identityEnabled: true,
    encrypted: true,
    osSupported: true,
    managementHealth: "healthy",
    localAuthority: "verified",
  };
  const subjects = [...healthyBySource, ...badBySource].map((s) => ({
    ...s,
    identityRef: `lab.worker.${s.evidence.deviceId}`,
    record: deviceManagementEvidenceToFixtureRecord(s.evidence, { ...recordCtx, identityRef: `lab.worker.${s.evidence.deviceId}` }),
  }));
  for (const s of subjects) {
    store.putIdentity({ id: `id_${tenantId}_${s.identityRef}`, tenantId, externalRef: s.identityRef, displayName: s.identityRef, state: "enabled", assignedRole: "nurse" });
    store.putDevice({ id: `dev_${tenantId}_${s.evidence.deviceId}`, tenantId, externalRef: s.evidence.deviceId, name: s.evidence.deviceId, osPlatform: s.evidence.platform, osVersion: "n/a", ownerType: "shared", managementAgent: "unknown" });
  }
  const connector: Connector = {
    id: `conn_${tenantId}_evidence_adapter_lab`,
    tenantId,
    kind: "microsoft-entra-intune",
    mode: "fixture",
    permissionScope: "Read-only device-management evidence (lab adapters; no source system touched)",
    credentialRef: `keyvault-placeholder://${tenantId}/evidence-adapter-lab (non-secret placeholder)`,
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runFixtureSync(store, clock, connector, subjects.map((s) => s.record));
  check("the seam syncs all six lab subjects (two states × three sources)",
    run.status === "success" && run.recordsProcessed === 6, `processed=${run.recordsProcessed}`);

  const decide = (s: (typeof subjects)[number]) =>
    evaluateDecision(store, clock, tenantId, "proof:evidence-adapter", {
      identityRef: s.identityRef, deviceRef: s.evidence.deviceId, workflowKey: "clinical-session",
    }).result;

  const healthyResults = healthyBySource.map((_, i) => ({ label: subjects[i]!.label, r: decide(subjects[i]!) }));
  const badResults = badBySource.map((_, i) => ({ label: subjects[i + 3]!.label, r: decide(subjects[i + 3]!) }));

  const sig = (r: { outcome: string; reasonCodes: string[] }) => `${r.outcome}:${[...r.reasonCodes].sort().join(",")}`;
  check("HEALTHY: all three sources produce the SAME outcome and reason codes",
    new Set(healthyResults.map((x) => sig(x.r))).size === 1,
    healthyResults.map((x) => `${x.label}=${sig(x.r)}`).join(" "));
  check("HEALTHY: and that shared verdict is ALLOW", healthyResults[0]!.r.outcome === "allow", sig(healthyResults[0]!.r));
  check("NONCOMPLIANT: all three sources produce the SAME outcome and reason codes",
    new Set(badResults.map((x) => sig(x.r))).size === 1,
    badResults.map((x) => `${x.label}=${sig(x.r)}`).join(" "));
  check("NONCOMPLIANT: the shared verdict is RESTRICT carrying DEVICE_NONCOMPLIANT",
    badResults[0]!.r.outcome === "restrict" && badResults[0]!.r.reasonCodes.includes("DEVICE_NONCOMPLIANT"), sig(badResults[0]!.r));

  // Provenance is the ONLY divergence: each evidence snapshot names its own source.
  const provenance = subjects.slice(0, 3).map((s) => {
    const snap = store.getSnapshot(tenantId, decide(s).evidenceSnapshotId);
    return { label: s.label, refs: snap?.sourceReferences ?? [] };
  });
  check("provenance: the fleet-sourced snapshot cites fleet, and only fleet, for its posture read",
    provenance[0]!.refs.some((r) => r.includes("fleet")) && !provenance[0]!.refs.some((r) => r.includes("headwind")));
  check("provenance: the headwind-sourced snapshot cites headwind",
    provenance[1]!.refs.some((r) => r.includes("headwind")));
  check("provenance: the intune-shaped snapshot cites intune",
    provenance[2]!.refs.some((r) => r.includes("intune")));

  // ── 5. Determinism replay ──────────────────────────────────────────────────
  const seeded2 = seedDemoStore(fixedClock(NOW));
  const store2 = seeded2.store;
  for (const s of subjects) {
    store2.putIdentity({ id: `id_${tenantId}_${s.identityRef}`, tenantId, externalRef: s.identityRef, displayName: s.identityRef, state: "enabled", assignedRole: "nurse" });
    store2.putDevice({ id: `dev_${tenantId}_${s.evidence.deviceId}`, tenantId, externalRef: s.evidence.deviceId, name: s.evidence.deviceId, osPlatform: s.evidence.platform, osVersion: "n/a", ownerType: "shared", managementAgent: "unknown" });
  }
  store2.putConnector(connector);
  runFixtureSync(store2, fixedClock(NOW), connector, subjects.map((s) => s.record));
  const replay = evaluateDecision(store2, fixedClock(NOW), tenantId, "proof:evidence-adapter", {
    identityRef: subjects[3]!.identityRef, deviceRef: subjects[3]!.evidence.deviceId, workflowKey: "clinical-session",
  }).result;
  check("DETERMINISM: replaying the whole lab seam reproduces the same verdict byte for byte",
    sig(replay) === sig(badResults[0]!.r));

  // ── 6. Zero network ────────────────────────────────────────────────────────
  // ── 5. LIVE CAPTURES, when they exist (DR-013's second half) ────────────────
  // The Mac's source-independence run named this gap exactly: "proving 'same
  // decisions from either LIVE source' needs captures on disk and a proof
  // that reads them." This section is that proof-side. It reads
  // artifacts/live-captures/*.json — files MINTED by the live lanes
  // (proof:live-headwind writes headwind.json from a real CE server) — maps
  // them through the SAME adapters as the fixtures, and asserts the live
  // shape decides identically. fs.readFileSync, deliberately: the
  // zero-network tripwire below stays intact, because a capture on disk is
  // evidence with provenance, not a network dependency. When no capture
  // exists the section reports ABSENT and the proof stays green — a machine
  // that never ran the lane has nothing to assert, and saying so beats
  // pretending.
  console.log("\n— live captures (present = live shape must decide like the fixture shape) —");
  {
    // Repo-root anchored, matching where proof:live-headwind writes it — the
    // harness runs both via `pnpm --filter @workspace/scripts` (cwd = scripts/),
    // so a bare relative path would read scripts/artifacts/ and miss the capture.
    const capPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../artifacts/live-captures/headwind.json");
    if (existsSync(capPath)) {
      const cap = JSON.parse(readFileSync(capPath, "utf8")) as {
        serverImage?: string;
        devices?: Array<{ deviceNumber: string; model: string; enrolled: boolean; kioskLocked: boolean; configApplied: "applied" | "failed" | "unknown"; lastSeenAt: string | null }>;
      };
      const devs = cap.devices ?? [];
      check("headwind capture parses and carries at least one live-derived device", devs.length > 0, capPath);
      const capEv = devs.map((d) => headwindLabToDeviceManagementEvidence(d, { tenantId: "tenant_lab", observedAt: NOW }));
      check("every LIVE-captured device maps through the same adapter (sourceSystem 'headwind', platform 'android')",
        capEv.length === devs.length && capEv.every((e) => e.sourceSystem === "headwind" && e.platform === "android"));
      const liveOk = devs.find((d) => d.configApplied === "applied" && d.enrolled && d.kioskLocked);
      if (liveOk) {
        const fixtureTwin = headwindLabToDeviceManagementEvidence(
          { deviceNumber: liveOk.deviceNumber, model: liveOk.model, enrolled: true, kioskLocked: true, configApplied: "applied", lastSeenAt: liveOk.lastSeenAt },
          { tenantId: "tenant_lab", observedAt: NOW },
        );
        const liveEv = capEv.find((e) => e.deviceId === liveOk.deviceNumber)!;
        check("the live-captured state and its fixture twin normalize IDENTICALLY (compliance, managed, ownership)",
          liveEv.complianceState === fixtureTwin.complianceState &&
          liveEv.managedState === fixtureTwin.managedState &&
          liveEv.ownership === fixtureTwin.ownership,
          `live=${liveEv.complianceState}/${liveEv.managedState} fixture=${fixtureTwin.complianceState}/${fixtureTwin.managedState}`);
      }
      console.log(`  capture provenance: ${cap.serverImage ?? "unrecorded"}`);
    } else {
      console.log("  · headwind capture ABSENT — fixture-only run (mint one: ./scripts/run-live-lanes.sh --only headwind)");
    }
  }

  // fleetDMFreshness fail-closed law (ECC-role review, fail-closed-auditor, 2026-09-01):
  // a check-in in the FUTURE is a clock contradiction and must resolve to "unknown",
  // never to the freshest reading — the same inversion every sibling deriver guards.
  const fleetSig = (lastCheckAt: string): Parameters<typeof fleetDMFreshness>[0] =>
    ({ hostUuid: "h1", platform: "darwin", compliant: true, lastCheckAt, policies: [] });
  const now = "2026-09-01T00:00:00.000Z";
  check("fleetDMFreshness: a recent check-in is fresh",
    fleetDMFreshness(fleetSig("2026-08-31T18:00:00.000Z"), now) === "fresh");
  check("fleetDMFreshness: a FUTURE check-in resolves to unknown, not fresh (fail-closed)",
    fleetDMFreshness(fleetSig("2030-01-01T00:00:00.000Z"), now) === "unknown");
  check("fleetDMFreshness: an unparseable check-in resolves to unknown",
    fleetDMFreshness(fleetSig("not-a-date"), now) === "unknown");

  check("zero network: not one fetch() was attempted across the whole lab", fetchAttempts === 0, `attempts=${fetchAttempts}`);

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  console.log("figures=sourceSystems=3,swapScenarios=2");
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("source-agnostic: the engine could not tell fleet from headwind from intune — only the provenance can.");
}

main().catch((err) => {
  console.error(`proof:evidence-adapter crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
