import { runFixtureSync, type FixturePostureRecord } from "./connector";
import { runDockSync, type DockCustodyRecord } from "./dock";
import { appendAudit } from "./audit";
import {
  ruleSetDigest,
  SHARED_DEVICE_RULES_V1,
  SHARED_DEVICE_RULES_V2,
} from "./policy";
import { MemoryStore } from "./store";
import type { Clock } from "./util";
import type {
  Connector,
  ConnectorIngestionMode,
  DecisionEvidence,
  Device,
  Identity,
  Policy,
  PolicyTest,
  PolicyVersion,
  Workflow,
} from "./types";

/**
 * Deterministic, public-safe demo seed.
 *
 * Two tenants exist so cross-tenant isolation can be exercised directly. All
 * identities, devices, tokens, and posture records are synthetic. Tokens are
 * obviously-fake demo strings, never real credentials. `credentialRef` values
 * are placeholders that show WHERE a real secret reference would live in the
 * private core — they are not secrets.
 */
export interface SeededDemo {
  store: MemoryStore;
  clock: Clock;
  tenants: {
    northwind: string;
    atlas: string;
  };
  tokens: {
    northwindOwner: string;
    northwindOperator: string;
    northwindAuditor: string;
    atlasOwner: string;
  };
  /** Per-connector fixture posture records, so a sync can be replayed. */
  fixtureRecords: Record<string, FixturePostureRecord[]>;
  /** Per-connector fixture dock/custody records, so a sync can be replayed. */
  dockRecords: Record<string, DockCustodyRecord[]>;
}

const NORTHWIND = "tenant_northwind";
const ATLAS = "tenant_atlas";

export function seedDemoStore(clock: Clock): SeededDemo {
  const store = new MemoryStore();
  const createdAt = clock.now().toISOString();

  seedTenant(store, {
    tenantId: NORTHWIND,
    slug: "northwind-health",
    name: "Northwind Health (demo)",
    createdAt,
  });
  seedTenant(store, {
    tenantId: ATLAS,
    slug: "atlas-logistics",
    name: "Atlas Logistics (demo)",
    createdAt,
  });

  // Northwind: hospital shared-device workflows.
  seedWorkflows(store, NORTHWIND, [
    { key: "clinical-session", name: "Clinical shared-device session", riskTier: "elevated" },
    { key: "med-admin", name: "Medication administration", riskTier: "critical" },
    { key: "general-lookup", name: "General directory lookup", riskTier: "standard" },
  ]);
  // Atlas: warehouse handheld workflows.
  seedWorkflows(store, ATLAS, [
    { key: "pick-pack", name: "Warehouse pick/pack session", riskTier: "standard" },
  ]);

  seedPolicy(store, NORTHWIND, createdAt);
  seedPolicy(store, ATLAS, createdAt);

  // Northwind subjects: a deliberate spread of posture outcomes.
  const northwindRecords = seedNorthwindSubjects(store);
  // Atlas subjects: a single healthy case, used mainly for isolation tests.
  const atlasRecords = seedAtlasSubjects(store);

  const northwindConnectorId = runConnector(store, clock, NORTHWIND, northwindRecords);
  const atlasConnectorId = runConnector(store, clock, ATLAS, atlasRecords);

  // DockBridge custody connectors: the hospital ingests via an app embedded in
  // the dock; the warehouse polls a locker vendor's event API. Both fixture-only.
  const northwindDockRecords = northwindDockCustody();
  const atlasDockRecords = atlasDockCustody();
  const northwindDockId = runDockConnector(store, clock, NORTHWIND, "app_in_dock", northwindDockRecords);
  const atlasDockId = runDockConnector(store, clock, ATLAS, "vendor_api", atlasDockRecords);

  // Dedicated SignalGrid SmartDock: the embedded smart-charging dock reports the
  // full custody/charge/tamper/dock/badge signal set natively. Optional hardware
  // layer, fixture-only, no dock action performed. See docs/SIGNALGRID_SMARTDOCK.md.
  const northwindSmartDockRecords = northwindSmartDockCustody();
  const northwindSmartDockId = runDockConnector(
    store,
    clock,
    NORTHWIND,
    "embedded_smartdock",
    northwindSmartDockRecords,
    "smartdock",
  );

  seedWebhookEndpoints(store, NORTHWIND);
  seedWebhookEndpoints(store, ATLAS);

  // Per-organization resolution flow control: the hospital routes worker steps
  // to badge/credential readers; the warehouse routes them to smart lockers.
  store.putResolutionConfig({
    tenantId: NORTHWIND,
    primaryHardwareChannel: "credential_reader",
    autoProposeEnabled: true,
  });
  store.putResolutionConfig({
    tenantId: ATLAS,
    primaryHardwareChannel: "smart_locker",
    autoProposeEnabled: true,
  });

  seedApiKeys(store);

  return {
    store,
    clock,
    tenants: { northwind: NORTHWIND, atlas: ATLAS },
    tokens: {
      northwindOwner: "sgk_demo_northwind_owner",
      northwindOperator: "sgk_demo_northwind_operator",
      northwindAuditor: "sgk_demo_northwind_auditor",
      atlasOwner: "sgk_demo_atlas_owner",
    },
    fixtureRecords: {
      [northwindConnectorId]: northwindRecords,
      [atlasConnectorId]: atlasRecords,
    },
    dockRecords: {
      [northwindDockId]: northwindDockRecords,
      [atlasDockId]: atlasDockRecords,
      [northwindSmartDockId]: northwindSmartDockRecords,
    },
  };
}

function seedTenant(
  store: MemoryStore,
  input: { tenantId: string; slug: string; name: string; createdAt: string },
): void {
  store.putTenant({
    id: input.tenantId,
    slug: input.slug,
    name: input.name,
    createdAt: input.createdAt,
  });
}

function seedWorkflows(
  store: MemoryStore,
  tenantId: string,
  specs: Array<Pick<Workflow, "key" | "name" | "riskTier">>,
): void {
  for (const spec of specs) {
    store.putWorkflow({
      id: `wf_${tenantId}_${spec.key}`,
      tenantId,
      key: spec.key,
      name: spec.name,
      riskTier: spec.riskTier,
    });
  }
}

function seedPolicy(
  store: MemoryStore,
  tenantId: string,
  createdAt: string,
): void {
  const policyId = `pol_${tenantId}_shared_device`;
  const versionId = `${policyId}_v1`;
  const version: PolicyVersion = {
    id: versionId,
    tenantId,
    policyId,
    version: 1,
    status: "active",
    rules: SHARED_DEVICE_RULES_V1,
    createdAt,
    digest: ruleSetDigest(SHARED_DEVICE_RULES_V1),
  };
  const policy: Policy = {
    id: policyId,
    tenantId,
    key: "shared-device-baseline",
    name: "Shared-device baseline access policy",
    description:
      "Baseline trust policy for shared managed-device sessions: identity, device compliance, posture freshness, and workflow risk.",
    workflowPattern: "*",
    activeVersionId: versionId,
  };
  store.putPolicyVersion(version);

  // A stricter v2 draft ships alongside v1 so operators can simulate/compare
  // before activating it. It is a draft, so it does not affect live decisions.
  const draftId = `${policyId}_v2`;
  const draft: PolicyVersion = {
    id: draftId,
    tenantId,
    policyId,
    version: 2,
    status: "draft",
    rules: SHARED_DEVICE_RULES_V2,
    createdAt,
    digest: ruleSetDigest(SHARED_DEVICE_RULES_V2),
  };
  store.putPolicyVersion(draft);

  store.putPolicy(policy);
  seedPolicyTests(store, tenantId, policyId);
  appendAudit(store, {
    tenantId,
    type: "policy.version_activated",
    actor: "seed",
    subject: versionId,
    summary: `Policy "${policy.key}" version 1 activated.`,
    references: [policyId, versionId],
    recordedAt: createdAt,
  });
}

function seedPolicyTests(
  store: MemoryStore,
  tenantId: string,
  policyId: string,
): void {
  const base: DecisionEvidence = {
    identityEnabled: true,
    deviceManaged: true,
    deviceCompliance: "compliant",
    deviceEncrypted: true,
    osSupported: true,
    ownerType: "shared",
    postureFreshness: "fresh",
    workflowRiskTier: "elevated",
    custodyState: "checked_out",
    dockChargeState: "charged",
    tamperState: "none",
    dockState: "occupied",
    baselineCompliance: "aligned",
    badgeBinding: "present",
    criticalSignalsPresent: true,
  };
  const cases: Array<Omit<PolicyTest, "id" | "tenantId" | "policyId">> = [
    { name: "healthy → allow", evidence: base, expectedOutcome: "allow", expectedReasonCode: "TRUST_ESTABLISHED" },
    { name: "non-compliant → restrict", evidence: { ...base, deviceCompliance: "non_compliant" }, expectedOutcome: "restrict", expectedReasonCode: "DEVICE_NONCOMPLIANT" },
    { name: "disabled identity → deny", evidence: { ...base, identityEnabled: false, criticalSignalsPresent: false }, expectedOutcome: "deny", expectedReasonCode: "IDENTITY_DISABLED" },
    { name: "stale posture → step-up", evidence: { ...base, postureFreshness: "stale" }, expectedOutcome: "step_up", expectedReasonCode: "POSTURE_STALE" },
    { name: "missing posture → restrict", evidence: { ...base, postureFreshness: "missing", criticalSignalsPresent: false }, expectedOutcome: "restrict", expectedReasonCode: "POSTURE_MISSING" },
    { name: "baseline drift → step-up", evidence: { ...base, baselineCompliance: "drifted" }, expectedOutcome: "step_up", expectedReasonCode: "BASELINE_DRIFTED" },
    { name: "baseline unknown → still allow (no fabricated block)", evidence: { ...base, baselineCompliance: "unknown" }, expectedOutcome: "allow", expectedReasonCode: "TRUST_ESTABLISHED" },
    { name: "badge removed → restrict", evidence: { ...base, badgeBinding: "removed" }, expectedOutcome: "restrict", expectedReasonCode: "BADGE_REMOVED" },
    { name: "badge forced removal → deny", evidence: { ...base, badgeBinding: "forced" }, expectedOutcome: "deny", expectedReasonCode: "BADGE_FORCED_REMOVAL" },
    { name: "badge absent/unknown → no fabricated block (allow)", evidence: { ...base, badgeBinding: "unknown" }, expectedOutcome: "allow", expectedReasonCode: "TRUST_ESTABLISHED" },
    { name: "custody maintenance → restrict", evidence: { ...base, custodyState: "maintenance" }, expectedOutcome: "restrict", expectedReasonCode: "CUSTODY_MAINTENANCE" },
    { name: "SmartDock faulted → restrict", evidence: { ...base, dockState: "faulted" }, expectedOutcome: "restrict", expectedReasonCode: "DOCK_FAULTED" },
    { name: "SmartDock offline → step-up", evidence: { ...base, dockState: "offline" }, expectedOutcome: "step_up", expectedReasonCode: "DOCK_OFFLINE" },
    { name: "dock state unknown → still allow (no fabricated block)", evidence: { ...base, dockState: "unknown" }, expectedOutcome: "allow", expectedReasonCode: "TRUST_ESTABLISHED" },
    { name: "tamper sensor unavailable → step-up (no fail-open)", evidence: { ...base, tamperState: "sensor_unavailable" }, expectedOutcome: "step_up", expectedReasonCode: "TAMPER_SENSOR_UNAVAILABLE" },
  ];
  for (const [index, spec] of cases.entries()) {
    store.putPolicyTest({
      id: `test_${policyId}_${index}`,
      tenantId,
      policyId,
      ...spec,
    });
  }
}

interface SubjectSpec {
  identity: Pick<Identity, "externalRef" | "displayName" | "state" | "assignedRole">;
  device: Pick<
    Device,
    "externalRef" | "name" | "osPlatform" | "osVersion" | "ownerType" | "managementAgent"
  >;
  posture: Omit<FixturePostureRecord, "deviceRef" | "identityRef">;
}

function seedNorthwindSubjects(store: MemoryStore): FixturePostureRecord[] {
  // lastSyncAt anchors are relative to the fixed demo clock (2026-07-13T15:00Z).
  const fresh = "2026-07-13T13:00:00.000Z"; // 2h old  → fresh
  const stale = "2026-07-11T23:00:00.000Z"; // 40h old → stale
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "nurse.compliant", displayName: "Compliant Nurse", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-01", name: "Ward iPad 01", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-ward-01" },
    },
    {
      identity: { externalRef: "nurse.noncompliant", displayName: "Nurse (non-compliant device)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-02", name: "Ward iPad 02", osPlatform: "iPadOS", osVersion: "17.0", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-ward-02" },
    },
    {
      identity: { externalRef: "nurse.stale", displayName: "Nurse (stale posture)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-03", name: "Ward iPad 03", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: stale, sourceReference: "fixture:intune:managedDevices#ipad-ward-03" },
    },
    {
      identity: { externalRef: "tech.unmanaged", displayName: "Tech (unmanaged device)", state: "enabled", assignedRole: "technician" },
      device: { externalRef: "ipad-byod-01", name: "Personal iPad", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "personal", managementAgent: "unknown" },
      posture: { identityEnabled: true, managed: false, compliance: "unknown", encrypted: false, osSupported: true, lastSyncAt: "2026-07-13T12:30:00.000Z", sourceReference: "fixture:intune:managedDevices#ipad-byod-01" },
    },
    {
      identity: { externalRef: "nurse.disabled", displayName: "Disabled account", state: "disabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-04", name: "Ward iPad 04", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-ward-04" },
    },
    {
      identity: { externalRef: "nurse.nosync", displayName: "Nurse (missing posture)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-05", name: "Ward iPad 05", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: null, sourceReference: "fixture:intune:managedDevices#ipad-ward-05" },
    },
    // Custody scenarios: posture is healthy so the DockBridge signal is decisive.
    {
      identity: { externalRef: "nurse.overdue", displayName: "Nurse (overdue return)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-loan-01", name: "Loaner iPad 01", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-loan-01" },
    },
    {
      identity: { externalRef: "nurse.tamper", displayName: "Nurse (device flagged)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-loan-02", name: "Loaner iPad 02", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-loan-02" },
    },
    {
      identity: { externalRef: "nurse.lowbatt", displayName: "Nurse (low battery)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-loan-03", name: "Loaner iPad 03", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-loan-03" },
    },
    // Security-baseline scenario: posture is otherwise healthy, so the device's
    // drift from its assigned CIS/hardening baseline is the decisive signal.
    {
      identity: { externalRef: "nurse.baseline_drift", displayName: "Nurse (baseline drift)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-ward-06", name: "Ward iPad 06", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#ipad-ward-06" },
    },
    // Badge-reader-case scenarios: posture is healthy so the badge read decides.
    {
      identity: { externalRef: "nurse.badge_removed", displayName: "Nurse (badge withdrawn)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-badge-01", name: "Case iPad 01", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-badge-01" },
    },
    {
      identity: { externalRef: "nurse.badge_forced", displayName: "Nurse (badge forced out)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-badge-02", name: "Case iPad 02", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-badge-02" },
    },
    // SmartDock scenarios: posture is healthy, so the dock's own hardware state
    // (reported by the embedded SmartDock) is the decisive signal.
    {
      identity: { externalRef: "nurse.dock_faulted", displayName: "Nurse (faulted dock)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-dock-01", name: "SmartDock iPad 01", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-dock-01" },
    },
    {
      identity: { externalRef: "nurse.dock_offline", displayName: "Nurse (offline dock)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-dock-02", name: "SmartDock iPad 02", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-dock-02" },
    },
    {
      identity: { externalRef: "nurse.tamper_blind", displayName: "Nurse (tamper sensor down)", state: "enabled", assignedRole: "nurse" },
      device: { externalRef: "ipad-dock-03", name: "SmartDock iPad 03", osPlatform: "iPadOS", osVersion: "18.5", ownerType: "shared", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#ipad-dock-03" },
    },
  ];
  return materializeSubjects(store, NORTHWIND, specs);
}

// Public-safe candidate hardware labels (matching the repo's custody schema).
const DOCK_VENDOR = "CandidateHealthcareDockVendor";
const DOCK_MODEL = "FixtureDock-SharedApple-01";
const CUSTODY_OBSERVED_AT = "2026-07-13T14:30:00.000Z"; // 30m before the demo clock

function benignDock(deviceRef: string, index: number): DockCustodyRecord {
  return {
    deviceRef,
    hardwareVendor: DOCK_VENDOR,
    hardwareModel: DOCK_MODEL,
    caseSerial: `case-fixture-${String(index).padStart(4, "0")}`,
    dockId: "dock-fixture-ward-01",
    bayId: `bay-${String(index).padStart(2, "0")}`,
    chargeState: "charged",
    dockState: "occupied",
    custodyState: "checked_out",
    tamperState: "none",
    badgeBinding: "present",
    observedAt: CUSTODY_OBSERVED_AT,
    sourceReference: `fixture:dockbridge:events#${deviceRef}`,
  };
}

function northwindDockCustody(): DockCustodyRecord[] {
  const benignDevices = [
    "ipad-ward-01",
    "ipad-ward-02",
    "ipad-ward-03",
    "ipad-ward-04",
    "ipad-ward-05",
  ];
  const records = benignDevices.map((ref, i) => benignDock(ref, i + 1));
  // Adverse custody scenarios.
  records.push({
    ...benignDock("ipad-loan-01", 11),
    custodyState: "overdue",
    dockState: "empty",
  });
  records.push({
    ...benignDock("ipad-loan-02", 12),
    tamperState: "suspected",
  });
  records.push({
    ...benignDock("ipad-loan-03", 13),
    chargeState: "critical",
    dockState: "empty",
  });
  return records;
}

/**
 * Custody events reported by the dedicated SignalGrid SmartDock (the embedded
 * smart-charging dock). These devices sit in the reader-case SmartDock, so the
 * badge-binding and the dock's own hardware state are the decisive signals.
 * See docs/SIGNALGRID_SMARTDOCK.md.
 */
function northwindSmartDockCustody(): DockCustodyRecord[] {
  const records: DockCustodyRecord[] = [];
  // Badge-reader-case scenarios: posture is healthy so the badge read is decisive.
  records.push({
    ...benignDock("ipad-badge-01", 14),
    dockId: "smartdock-fixture-ward-01",
    badgeBinding: "removed",
  });
  records.push({
    ...benignDock("ipad-badge-02", 15),
    dockId: "smartdock-fixture-ward-01",
    badgeBinding: "forced",
    tamperState: "suspected",
  });
  // Dock-hardware scenarios: the SmartDock reports its own health.
  records.push({
    ...benignDock("ipad-dock-01", 16),
    dockId: "smartdock-fixture-ward-02",
    dockState: "faulted",
  });
  records.push({
    ...benignDock("ipad-dock-02", 17),
    dockId: "smartdock-fixture-ward-03",
    dockState: "offline",
  });
  records.push({
    ...benignDock("ipad-dock-03", 18),
    dockId: "smartdock-fixture-ward-04",
    tamperState: "sensor_unavailable",
  });
  return records;
}

function atlasDockCustody(): DockCustodyRecord[] {
  return [
    {
      ...benignDock("handheld-01", 1),
      dockId: "locker-fixture-dc-01",
      bayId: "bay-01",
    },
  ];
}

function seedAtlasSubjects(store: MemoryStore): FixturePostureRecord[] {
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "picker.compliant", displayName: "Compliant Picker", state: "enabled", assignedRole: "picker" },
      device: { externalRef: "handheld-01", name: "Warehouse Handheld 01", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: "2026-07-13T14:00:00.000Z", sourceReference: "fixture:intune:managedDevices#handheld-01" },
    },
  ];
  return materializeSubjects(store, ATLAS, specs);
}

function materializeSubjects(
  store: MemoryStore,
  tenantId: string,
  specs: SubjectSpec[],
): FixturePostureRecord[] {
  const records: FixturePostureRecord[] = [];
  for (const spec of specs) {
    const identityId = `id_${tenantId}_${spec.identity.externalRef}`;
    const deviceId = `dev_${tenantId}_${spec.device.externalRef}`;
    store.putIdentity({ id: identityId, tenantId, ...spec.identity });
    store.putDevice({ id: deviceId, tenantId, ...spec.device });
    records.push({
      deviceRef: spec.device.externalRef,
      identityRef: spec.identity.externalRef,
      ...spec.posture,
    });
  }
  return records;
}

function runConnector(
  store: MemoryStore,
  clock: Clock,
  tenantId: string,
  records: FixturePostureRecord[],
): string {
  const connector: Connector = {
    id: `conn_${tenantId}_entra_intune`,
    tenantId,
    kind: "microsoft-entra-intune",
    mode: "fixture",
    permissionScope: "DeviceManagementManagedDevices.Read.All (read-only, documented not exercised)",
    credentialRef: `keyvault-placeholder://${tenantId}/entra-intune-readonly (non-secret placeholder)`,
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runFixtureSync(store, clock, connector, records);
  appendAudit(store, {
    tenantId,
    type: "connector.synced",
    actor: "seed",
    subject: connector.id,
    summary: `Fixture connector sync normalized ${run.signalsNormalized} signals from ${run.recordsProcessed} records.`,
    references: [connector.id, run.id],
    recordedAt: run.completedAt,
  });
  return connector.id;
}

function runDockConnector(
  store: MemoryStore,
  clock: Clock,
  tenantId: string,
  ingestionMode: ConnectorIngestionMode,
  records: DockCustodyRecord[],
  idKey = "dockbridge",
): string {
  const connector: Connector = {
    id: `conn_${tenantId}_${idKey}`,
    tenantId,
    kind: "dockbridge-custody",
    mode: "fixture",
    ingestionMode,
    permissionScope: "Read-only dock/custody events (fixture; no dock action performed)",
    credentialRef: `keyvault-placeholder://${tenantId}/${idKey}-readonly (non-secret placeholder)`,
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runDockSync(store, clock, connector, records);
  appendAudit(store, {
    tenantId,
    type: "connector.synced",
    actor: "seed",
    subject: connector.id,
    summary: `DockBridge fixture sync normalized ${run.signalsNormalized} custody signals from ${run.recordsProcessed} events.`,
    references: [connector.id, run.id],
    recordedAt: run.completedAt,
  });
  return connector.id;
}

function seedWebhookEndpoints(store: MemoryStore, tenantId: string): void {
  // A reliable sink and a flaky one, so retry/backoff is visible in deliveries.
  store.putWebhookEndpoint({
    id: `wh_${tenantId}_siem`,
    tenantId,
    url: `https://sink.demo.invalid/${tenantId}/siem`,
    events: ["decision.evaluated"],
    active: true,
    failuresBeforeSuccess: 0,
    maxAttempts: 5,
  });
  store.putWebhookEndpoint({
    id: `wh_${tenantId}_itsm`,
    tenantId,
    url: `https://sink.demo.invalid/${tenantId}/itsm`,
    events: ["decision.evaluated"],
    active: true,
    failuresBeforeSuccess: 2,
    maxAttempts: 5,
  });
}

function seedApiKeys(store: MemoryStore): void {
  const keys: Array<{
    tenantId: string;
    role: "owner" | "operator" | "auditor";
    token: string;
    subjectId: string;
  }> = [
    { tenantId: NORTHWIND, role: "owner", token: "sgk_demo_northwind_owner", subjectId: "user_northwind_owner" },
    { tenantId: NORTHWIND, role: "operator", token: "sgk_demo_northwind_operator", subjectId: "user_northwind_operator" },
    { tenantId: NORTHWIND, role: "auditor", token: "sgk_demo_northwind_auditor", subjectId: "user_northwind_auditor" },
    { tenantId: ATLAS, role: "owner", token: "sgk_demo_atlas_owner", subjectId: "user_atlas_owner" },
  ];
  for (const key of keys) {
    store.putUser({
      id: key.subjectId,
      email: `${key.subjectId}@demo.invalid`,
      displayName: `${key.role} (${key.tenantId})`,
    });
    store.putMembership({
      id: `mem_${key.subjectId}`,
      tenantId: key.tenantId,
      userId: key.subjectId,
      role: key.role,
    });
    store.putApiKey({
      id: `key_${key.subjectId}`,
      tenantId: key.tenantId,
      principalType: "user",
      subjectId: key.subjectId,
      role: key.role,
      token: key.token,
      keyReference: maskToken(key.token),
    });
  }
}

function maskToken(token: string): string {
  return `${token.slice(0, 12)}…${token.slice(-2)}`;
}
