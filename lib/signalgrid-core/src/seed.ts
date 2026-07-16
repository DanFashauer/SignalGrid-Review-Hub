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
 * Six tenants exist across six verticals (healthcare / warehouse / global-fleet
 * / retail / industrial / data-center-NOC) so cross-tenant isolation can be
 * exercised directly and each of the six app-workflow catalogs now gates
 * against a live decision. All identities, devices, tokens, and posture records
 * are synthetic. Tokens are
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
    meridian: string;
    vero: string;
    forge: string;
    orion: string;
  };
  tokens: {
    northwindOwner: string;
    northwindOperator: string;
    northwindAuditor: string;
    atlasOwner: string;
    meridianOwner: string;
    veroOwner: string;
    forgeOwner: string;
    orionOwner: string;
  };
  /** Per-connector fixture posture records, so a sync can be replayed. */
  fixtureRecords: Record<string, FixturePostureRecord[]>;
  /** Per-connector fixture dock/custody records, so a sync can be replayed. */
  dockRecords: Record<string, DockCustodyRecord[]>;
}

const NORTHWIND = "tenant_northwind";
const ATLAS = "tenant_atlas";
const MERIDIAN = "tenant_meridian";
const VERO = "tenant_vero";
const FORGE = "tenant_forge";
const ORION = "tenant_orion";

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
  seedTenant(store, {
    tenantId: MERIDIAN,
    slug: "meridian-field-ops",
    name: "Meridian Field Ops (demo)",
    createdAt,
  });
  seedTenant(store, {
    tenantId: VERO,
    slug: "vero-markets",
    name: "Vero Markets (demo)",
    createdAt,
  });
  seedTenant(store, {
    tenantId: FORGE,
    slug: "forge-industrial",
    name: "Forge Industrial (demo)",
    createdAt,
  });
  seedTenant(store, {
    tenantId: ORION,
    slug: "orion-datacenters",
    name: "Orion Data Centers (demo)",
    createdAt,
  });

  // Northwind: hospital shared-device workflows.
  seedWorkflows(store, NORTHWIND, [
    { key: "clinical-session", name: "Clinical shared-device session", riskTier: "elevated" },
    { key: "med-admin", name: "Medication administration", riskTier: "critical" },
    { key: "general-lookup", name: "General directory lookup", riskTier: "standard" },
  ]);
  // Atlas: warehouse handheld workflows, escalating with zone sensitivity —
  // an open pick aisle, a general lookup, and a controlled high-value/hazmat area.
  seedWorkflows(store, ATLAS, [
    { key: "general-lookup", name: "Warehouse directory lookup", riskTier: "standard" },
    { key: "pick-pack", name: "Warehouse pick/pack session", riskTier: "standard" },
    { key: "controlled-area", name: "Controlled-area entry (high-value / hazmat)", riskTier: "critical" },
  ]);
  // Meridian: global-fleet vehicle-mount workflows, escalating from a lookup to a
  // field session to a cross-region vehicle checkout (regulated cargo / long-haul).
  seedWorkflows(store, MERIDIAN, [
    { key: "general-lookup", name: "Fleet directory lookup", riskTier: "standard" },
    { key: "field-session", name: "Field vehicle-mount session", riskTier: "standard" },
    { key: "vehicle-checkout", name: "Cross-region vehicle checkout (regulated cargo)", riskTier: "critical" },
  ]);
  // Vero: retail shared-device workflows. Keys match the app-workflows catalog
  // (`pos-session`, `restricted-sale`) so the POS and age/rx-restricted app
  // catalogs gate against a LIVE decision, not a supplied one.
  seedWorkflows(store, VERO, [
    { key: "general-lookup", name: "Store directory lookup", riskTier: "standard" },
    { key: "pos-session", name: "Point-of-sale session", riskTier: "elevated" },
    { key: "restricted-sale", name: "Age / rx-restricted sale", riskTier: "critical" },
  ]);
  // Forge: industrial line-operations workflow. Key matches the app-workflows
  // catalog (`line-ops`) so the MES / SCADA-HMI catalog gates live.
  seedWorkflows(store, FORGE, [
    { key: "general-lookup", name: "Plant directory lookup", riskTier: "standard" },
    { key: "line-ops", name: "Line operations (MES / SCADA-HMI)", riskTier: "critical" },
  ]);
  // Orion: data-center / NOC workflows. Keys match the app-workflows catalog
  // (noc-session / network-change / power-control / incident-response /
  // facilities-control / compute-ops) so every NOC app catalog gates against a
  // live decision — uptime-affecting actions are the critical ones.
  seedWorkflows(store, ORION, [
    { key: "general-lookup", name: "NOC directory lookup", riskTier: "standard" },
    { key: "noc-session", name: "DCIM / change-management session", riskTier: "elevated" },
    { key: "network-change", name: "Network configuration change", riskTier: "critical" },
    { key: "power-control", name: "Power / PDU control", riskTier: "critical" },
    { key: "incident-response", name: "ITSM incident response", riskTier: "elevated" },
    { key: "facilities-control", name: "Cooling / BMS control", riskTier: "critical" },
    { key: "compute-ops", name: "Compute / orchestration", riskTier: "critical" },
  ]);

  seedPolicy(store, NORTHWIND, createdAt);
  seedPolicy(store, ATLAS, createdAt);
  seedPolicy(store, MERIDIAN, createdAt);
  seedPolicy(store, VERO, createdAt);
  seedPolicy(store, FORGE, createdAt);
  seedPolicy(store, ORION, createdAt);

  // Northwind subjects: a deliberate spread of posture outcomes.
  const northwindRecords = seedNorthwindSubjects(store);
  // Atlas (warehouse) subjects: a spread across allow / step-up / restrict / deny.
  const atlasRecords = seedAtlasSubjects(store);
  // Meridian (global-fleet) subjects: the same spread for vehicle-mount drivers.
  const meridianRecords = seedMeridianSubjects(store);
  // Vero (retail) subjects: the same spread for POS cashiers.
  const veroRecords = seedVeroSubjects(store);
  // Forge (industrial) subjects: the same spread for line operators.
  const forgeRecords = seedForgeSubjects(store);
  // Orion (data-center / NOC) subjects: the same spread for NOC engineers.
  const orionRecords = seedOrionSubjects(store);

  const northwindConnectorId = runConnector(store, clock, NORTHWIND, northwindRecords);
  const atlasConnectorId = runConnector(store, clock, ATLAS, atlasRecords);
  const meridianConnectorId = runConnector(store, clock, MERIDIAN, meridianRecords);
  const veroConnectorId = runConnector(store, clock, VERO, veroRecords);
  const forgeConnectorId = runConnector(store, clock, FORGE, forgeRecords);
  const orionConnectorId = runConnector(store, clock, ORION, orionRecords);

  // DockBridge custody connectors: the hospital ingests via an app embedded in
  // the dock; the warehouse polls a locker vendor's event API. Both fixture-only.
  const northwindDockRecords = northwindDockCustody();
  const atlasDockRecords = atlasDockCustody();
  const meridianDockRecords = meridianDockCustody();
  const veroDockRecords = veroDockCustody();
  const forgeDockRecords = forgeDockCustody();
  const orionDockRecords = orionDockCustody();
  const northwindDockId = runDockConnector(store, clock, NORTHWIND, "app_in_dock", northwindDockRecords);
  const atlasDockId = runDockConnector(store, clock, ATLAS, "vendor_api", atlasDockRecords);
  const meridianDockId = runDockConnector(store, clock, MERIDIAN, "vendor_api", meridianDockRecords);
  const veroDockId = runDockConnector(store, clock, VERO, "vendor_api", veroDockRecords);
  const forgeDockId = runDockConnector(store, clock, FORGE, "vendor_api", forgeDockRecords);
  const orionDockId = runDockConnector(store, clock, ORION, "vendor_api", orionDockRecords);

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
  seedWebhookEndpoints(store, MERIDIAN);
  seedWebhookEndpoints(store, VERO);
  seedWebhookEndpoints(store, FORGE);
  seedWebhookEndpoints(store, ORION);

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
  store.putResolutionConfig({
    tenantId: MERIDIAN,
    primaryHardwareChannel: "smart_locker",
    autoProposeEnabled: true,
  });
  store.putResolutionConfig({
    tenantId: VERO,
    primaryHardwareChannel: "smart_locker",
    autoProposeEnabled: true,
  });
  store.putResolutionConfig({
    tenantId: FORGE,
    primaryHardwareChannel: "credential_reader",
    autoProposeEnabled: true,
  });
  store.putResolutionConfig({
    tenantId: ORION,
    primaryHardwareChannel: "credential_reader",
    autoProposeEnabled: true,
  });

  seedApiKeys(store);

  return {
    store,
    clock,
    tenants: { northwind: NORTHWIND, atlas: ATLAS, meridian: MERIDIAN, vero: VERO, forge: FORGE, orion: ORION },
    tokens: {
      northwindOwner: "sgk_demo_northwind_owner",
      northwindOperator: "sgk_demo_northwind_operator",
      northwindAuditor: "sgk_demo_northwind_auditor",
      atlasOwner: "sgk_demo_atlas_owner",
      meridianOwner: "sgk_demo_meridian_owner",
      veroOwner: "sgk_demo_vero_owner",
      forgeOwner: "sgk_demo_forge_owner",
      orionOwner: "sgk_demo_orion_owner",
    },
    fixtureRecords: {
      [northwindConnectorId]: northwindRecords,
      [atlasConnectorId]: atlasRecords,
      [meridianConnectorId]: meridianRecords,
      [veroConnectorId]: veroRecords,
      [forgeConnectorId]: forgeRecords,
      [orionConnectorId]: orionRecords,
    },
    dockRecords: {
      [northwindDockId]: northwindDockRecords,
      [atlasDockId]: atlasDockRecords,
      [meridianDockId]: meridianDockRecords,
      [veroDockId]: veroDockRecords,
      [forgeDockId]: forgeDockRecords,
      [orionDockId]: orionDockRecords,
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
  // Benign locker custody for every warehouse handheld, so the decisive signal in
  // each scenario is posture / baseline / identity — not an incidental custody gap.
  return ["handheld-01", "handheld-02", "handheld-06", "handheld-04"].map((ref, i) => ({
    ...benignDock(ref, i + 1),
    dockId: "locker-fixture-dc-01",
    bayId: `bay-${String(i + 1).padStart(2, "0")}`,
  }));
}

function meridianDockCustody(): DockCustodyRecord[] {
  // Benign vehicle-mount cradle custody for every fleet tablet, so the decisive
  // signal in each scenario is posture / baseline / identity — not custody.
  return ["vehicle-mount-01", "vehicle-mount-02", "vehicle-mount-06", "vehicle-mount-04"].map((ref, i) => ({
    ...benignDock(ref, i + 1),
    dockId: "cradle-fixture-euw-01",
    bayId: `mount-${String(i + 1).padStart(2, "0")}`,
  }));
}

function veroDockCustody(): DockCustodyRecord[] {
  // Benign charging-bay custody for every POS device, so the decisive signal in
  // each scenario is posture / baseline / identity — not custody.
  return ["pos-station-01", "pos-station-02", "pos-handheld-06", "pos-station-04"].map((ref, i) => ({
    ...benignDock(ref, i + 1),
    dockId: "bay-fixture-store-01",
    bayId: `bay-${String(i + 1).padStart(2, "0")}`,
  }));
}

function forgeDockCustody(): DockCustodyRecord[] {
  // Benign cradle custody for every HMI panel, so the decisive signal in each
  // scenario is posture / baseline / identity — not custody.
  return ["hmi-panel-01", "hmi-panel-02", "hmi-panel-06", "hmi-panel-04"].map((ref, i) => ({
    ...benignDock(ref, i + 1),
    dockId: "cradle-fixture-plant-01",
    bayId: `panel-${String(i + 1).padStart(2, "0")}`,
  }));
}

function orionDockCustody(): DockCustodyRecord[] {
  // Benign secure-cabinet custody for every NOC console, so the decisive signal
  // in each scenario is posture / baseline / identity — not custody.
  return ["noc-console-01", "noc-console-02", "noc-console-06", "noc-console-04"].map((ref, i) => ({
    ...benignDock(ref, i + 1),
    dockId: "cabinet-fixture-noc-01",
    bayId: `slot-${String(i + 1).padStart(2, "0")}`,
  }));
}

function seedAtlasSubjects(store: MemoryStore): FixturePostureRecord[] {
  const fresh = "2026-07-13T14:00:00.000Z";
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "picker.compliant", displayName: "Compliant Picker", state: "enabled", assignedRole: "picker" },
      device: { externalRef: "handheld-01", name: "Warehouse Handheld 01", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#handheld-01" },
    },
    // Non-compliant handheld — the device posture is the decisive signal (restrict).
    {
      identity: { externalRef: "picker.noncompliant", displayName: "Picker (non-compliant device)", state: "enabled", assignedRole: "picker" },
      device: { externalRef: "handheld-02", name: "Warehouse Handheld 02", osPlatform: "Android", osVersion: "13", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#handheld-02" },
    },
    // Security-baseline drift — posture otherwise healthy, so the drift decides (step-up).
    {
      identity: { externalRef: "picker.baseline_drift", displayName: "Picker (baseline drift)", state: "enabled", assignedRole: "picker" },
      device: { externalRef: "handheld-06", name: "Warehouse Handheld 06", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#handheld-06" },
    },
    // Disabled account — trust fails at the identity layer (deny).
    {
      identity: { externalRef: "picker.disabled", displayName: "Disabled picker account", state: "disabled", assignedRole: "picker" },
      device: { externalRef: "handheld-04", name: "Warehouse Handheld 04", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#handheld-04" },
    },
  ];
  return materializeSubjects(store, ATLAS, specs);
}

function seedMeridianSubjects(store: MemoryStore): FixturePostureRecord[] {
  const fresh = "2026-07-13T14:00:00.000Z";
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "driver.compliant", displayName: "Compliant Driver", state: "enabled", assignedRole: "driver" },
      device: { externalRef: "vehicle-mount-01", name: "Vehicle Mount 01", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#vehicle-mount-01" },
    },
    // Non-compliant vehicle-mount tablet — device posture is decisive (restrict).
    {
      identity: { externalRef: "driver.noncompliant", displayName: "Driver (non-compliant mount)", state: "enabled", assignedRole: "driver" },
      device: { externalRef: "vehicle-mount-02", name: "Vehicle Mount 02", osPlatform: "Android", osVersion: "12", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#vehicle-mount-02" },
    },
    // Security-baseline drift — otherwise healthy, so the drift decides (step-up).
    {
      identity: { externalRef: "driver.baseline_drift", displayName: "Driver (baseline drift)", state: "enabled", assignedRole: "driver" },
      device: { externalRef: "vehicle-mount-06", name: "Vehicle Mount 06", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#vehicle-mount-06" },
    },
    // Disabled account — trust fails at the identity layer (deny).
    {
      identity: { externalRef: "driver.disabled", displayName: "Disabled driver account", state: "disabled", assignedRole: "driver" },
      device: { externalRef: "vehicle-mount-04", name: "Vehicle Mount 04", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#vehicle-mount-04" },
    },
  ];
  return materializeSubjects(store, MERIDIAN, specs);
}

function seedVeroSubjects(store: MemoryStore): FixturePostureRecord[] {
  const fresh = "2026-07-13T14:00:00.000Z";
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "cashier.compliant", displayName: "Compliant Cashier", state: "enabled", assignedRole: "cashier" },
      device: { externalRef: "pos-station-01", name: "POS Station 01", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#pos-station-01" },
    },
    // Non-compliant POS terminal — device posture is the decisive signal (restrict).
    {
      identity: { externalRef: "cashier.noncompliant", displayName: "Cashier (non-compliant terminal)", state: "enabled", assignedRole: "cashier" },
      device: { externalRef: "pos-station-02", name: "POS Station 02", osPlatform: "Android", osVersion: "12", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#pos-station-02" },
    },
    // Security-baseline drift — otherwise healthy, so the drift decides (step-up).
    {
      identity: { externalRef: "cashier.baseline_drift", displayName: "Cashier (baseline drift)", state: "enabled", assignedRole: "cashier" },
      device: { externalRef: "pos-handheld-06", name: "POS Handheld 06", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#pos-handheld-06" },
    },
    // Disabled account — trust fails at the identity layer (deny).
    {
      identity: { externalRef: "cashier.disabled", displayName: "Disabled cashier account", state: "disabled", assignedRole: "cashier" },
      device: { externalRef: "pos-station-04", name: "POS Station 04", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#pos-station-04" },
    },
  ];
  return materializeSubjects(store, VERO, specs);
}

function seedForgeSubjects(store: MemoryStore): FixturePostureRecord[] {
  const fresh = "2026-07-13T14:00:00.000Z";
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "operator.compliant", displayName: "Compliant Operator", state: "enabled", assignedRole: "line-operator" },
      device: { externalRef: "hmi-panel-01", name: "HMI Panel 01", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#hmi-panel-01" },
    },
    // Non-compliant HMI tablet — device posture is the decisive signal (restrict).
    {
      identity: { externalRef: "operator.noncompliant", displayName: "Operator (non-compliant panel)", state: "enabled", assignedRole: "line-operator" },
      device: { externalRef: "hmi-panel-02", name: "HMI Panel 02", osPlatform: "Android", osVersion: "12", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#hmi-panel-02" },
    },
    // Security-baseline drift — otherwise healthy, so the drift decides (step-up).
    {
      identity: { externalRef: "operator.baseline_drift", displayName: "Operator (baseline drift)", state: "enabled", assignedRole: "line-operator" },
      device: { externalRef: "hmi-panel-06", name: "HMI Panel 06", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#hmi-panel-06" },
    },
    // Disabled account — trust fails at the identity layer (deny).
    {
      identity: { externalRef: "operator.disabled", displayName: "Disabled operator account", state: "disabled", assignedRole: "line-operator" },
      device: { externalRef: "hmi-panel-04", name: "HMI Panel 04", osPlatform: "Android", osVersion: "14", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#hmi-panel-04" },
    },
  ];
  return materializeSubjects(store, FORGE, specs);
}

function seedOrionSubjects(store: MemoryStore): FixturePostureRecord[] {
  const fresh = "2026-07-13T14:00:00.000Z";
  const specs: SubjectSpec[] = [
    {
      identity: { externalRef: "noc.compliant", displayName: "Compliant NOC Engineer", state: "enabled", assignedRole: "noc-engineer" },
      device: { externalRef: "noc-console-01", name: "NOC Console 01", osPlatform: "Windows", osVersion: "11", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#noc-console-01" },
    },
    // Non-compliant workstation — device posture is the decisive signal (restrict).
    {
      identity: { externalRef: "noc.noncompliant", displayName: "NOC Engineer (non-compliant console)", state: "enabled", assignedRole: "noc-engineer" },
      device: { externalRef: "noc-console-02", name: "NOC Console 02", osPlatform: "Windows", osVersion: "10", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "non_compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#noc-console-02" },
    },
    // Security-baseline drift — otherwise healthy, so the drift decides (step-up).
    {
      identity: { externalRef: "noc.baseline_drift", displayName: "NOC Engineer (baseline drift)", state: "enabled", assignedRole: "noc-engineer" },
      device: { externalRef: "noc-console-06", name: "NOC Console 06", osPlatform: "Windows", osVersion: "11", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "drifted", sourceReference: "fixture:intune:managedDevices#noc-console-06" },
    },
    // Disabled account — trust fails at the identity layer (deny).
    {
      identity: { externalRef: "noc.disabled", displayName: "Disabled NOC account", state: "disabled", assignedRole: "noc-engineer" },
      device: { externalRef: "noc-console-04", name: "NOC Console 04", osPlatform: "Windows", osVersion: "11", ownerType: "corporate", managementAgent: "intune" },
      posture: { identityEnabled: false, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, baseline: "aligned", sourceReference: "fixture:intune:managedDevices#noc-console-04" },
    },
  ];
  return materializeSubjects(store, ORION, specs);
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
    { tenantId: MERIDIAN, role: "owner", token: "sgk_demo_meridian_owner", subjectId: "user_meridian_owner" },
    { tenantId: VERO, role: "owner", token: "sgk_demo_vero_owner", subjectId: "user_vero_owner" },
    { tenantId: FORGE, role: "owner", token: "sgk_demo_forge_owner", subjectId: "user_forge_owner" },
    { tenantId: ORION, role: "owner", token: "sgk_demo_orion_owner", subjectId: "user_orion_owner" },
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
