import { runFixtureSync, type FixturePostureRecord } from "./connector";
import { appendAudit } from "./audit";
import { ruleSetDigest, SHARED_DEVICE_RULES_V1 } from "./policy";
import { MemoryStore } from "./store";
import type { Clock } from "./util";
import type {
  Connector,
  Device,
  Identity,
  Policy,
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
  store.putPolicy(policy);
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
      posture: { identityEnabled: true, managed: true, compliance: "compliant", encrypted: true, osSupported: true, lastSyncAt: fresh, sourceReference: "fixture:intune:managedDevices#ipad-ward-01" },
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
  ];
  return materializeSubjects(store, NORTHWIND, specs);
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
