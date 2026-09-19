import { runPostureSync, type FixturePostureRecord } from "./connector";
import { appendAudit } from "./audit";
import { seedPolicy, seedTenant, seedWorkflows } from "./seed";
import { MemoryStore } from "./store";
import type { Clock } from "./util";
import {
  CoreError,
  type Connector,
  type ConnectorMode,
  type Device,
  type Identity,
  type RiskTier,
} from "./types";

/**
 * An ESTATE core: a customer's own tenant, identities and devices, with posture
 * the caller already read from its real source. This is the non-demo
 * constructor the launch profile's `non-demo-core-constructor` gap named — the
 * served API used to have exactly one way to build a core, `SignalGridCore.demo()`,
 * a seeded fixture world on a fixed clock.
 *
 * Boundaries, all deliberate:
 *   - The core still performs NO I/O. Whoever builds it fetches posture first
 *     (Graph, a fixture dataset, anything read-only) and hands over records;
 *     the same sync → normalize → decide pipeline runs on them.
 *   - Subjects come from the posture read, never from a request: an identity or
 *     device the source did not report does not exist here, and a decision about
 *     it is `not_found`, not a guess.
 *   - A fact the source did not read is left absent, and evidence reads absent as
 *     "unknown" — allow can never fire on it (see `FixturePostureRecord`).
 *   - No demo keys: `demoApiKeys()` refuses on an estate core. The bearer tokens
 *     are the deployment's, supplied in the spec, and are the only principals.
 */
export interface EstateSubject {
  identity: Pick<Identity, "externalRef" | "displayName" | "state" | "assignedRole">;
  device: Pick<Device, "externalRef" | "name" | "osPlatform" | "osVersion" | "ownerType" | "managementAgent">;
  posture: Omit<FixturePostureRecord, "deviceRef" | "identityRef">;
}

export interface EstateSpec {
  tenant: { id: string; slug: string; name: string };
  /** Bearer tokens for this deployment's principals. Never demo tokens. */
  principals: Array<{ role: "owner" | "operator" | "auditor"; token: string; subjectId: string }>;
  workflows?: Array<{ key: string; name: string; riskTier: RiskTier }>;
  connector: {
    id?: string;
    mode: ConnectorMode;
    /** Where the posture came from, for the sync run's provenance and the audit line. */
    sourceDescription: string;
    permissionScope: string;
    credentialRef: string;
  };
  subjects: EstateSubject[];
}

export interface EstateBuild {
  store: MemoryStore;
  connectorId: string;
  postureRecords: FixturePostureRecord[];
}

const MIN_TOKEN_LENGTH = 24;
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;

/** Validate the spec and populate a store. Refuses rather than booting a core that would lie. */
export function buildEstateStore(
  clock: Clock,
  spec: EstateSpec,
  storeOptions?: { maxDecisionsPerTenant?: number },
): EstateBuild {
  if (!SLUG.test(spec.tenant.slug)) {
    throw new CoreError("validation", `Estate tenant slug "${spec.tenant.slug}" must match ${SLUG}.`, 400);
  }
  if (spec.principals.length === 0 || !spec.principals.some((p) => p.role === "owner")) {
    throw new CoreError("validation", "An estate needs at least one owner principal.", 400);
  }
  const seenTokens = new Set<string>();
  for (const principal of spec.principals) {
    if (principal.token.length < MIN_TOKEN_LENGTH || /^sgk_demo_/.test(principal.token)) {
      throw new CoreError(
        "validation",
        `Estate principal "${principal.subjectId}" has a token shorter than ${MIN_TOKEN_LENGTH} characters or shaped like a demo key; refusing.`,
        400,
      );
    }
    if (seenTokens.has(principal.token)) {
      throw new CoreError("validation", "Two estate principals share one token.", 400);
    }
    seenTokens.add(principal.token);
  }

  const store = new MemoryStore(storeOptions);
  const tenantId = spec.tenant.id;
  const createdAt = clock.now().toISOString();
  seedTenant(store, { tenantId, slug: spec.tenant.slug, name: spec.tenant.name, createdAt });
  seedWorkflows(
    store,
    tenantId,
    spec.workflows ?? [{ key: "shared-device-session", name: "Shared device session", riskTier: "standard" }],
  );
  seedPolicy(store, tenantId, createdAt);

  for (const principal of spec.principals) {
    store.putUser({
      id: principal.subjectId,
      email: `${principal.subjectId}@${spec.tenant.slug}.invalid`,
      displayName: `${principal.role} (${spec.tenant.slug})`,
    });
    store.putMembership({ id: `mem_${principal.subjectId}`, tenantId, userId: principal.subjectId, role: principal.role });
    store.putApiKey({
      id: `key_${principal.subjectId}`,
      tenantId,
      principalType: "user",
      subjectId: principal.subjectId,
      role: principal.role,
      token: principal.token,
      keyReference: `${principal.token.slice(0, 6)}…${principal.token.slice(-2)}`,
    });
  }

  const postureRecords: FixturePostureRecord[] = [];
  for (const subject of spec.subjects) {
    store.putIdentity({ id: `id_${tenantId}_${subject.identity.externalRef}`, tenantId, ...subject.identity });
    store.putDevice({ id: `dev_${tenantId}_${subject.device.externalRef}`, tenantId, ...subject.device });
    postureRecords.push({
      deviceRef: subject.device.externalRef,
      identityRef: subject.identity.externalRef,
      ...subject.posture,
    });
  }

  const connector: Connector = {
    id: spec.connector.id ?? `conn_${tenantId}_entra_intune`,
    tenantId,
    kind: "microsoft-entra-intune",
    mode: spec.connector.mode,
    permissionScope: spec.connector.permissionScope,
    credentialRef: spec.connector.credentialRef,
    status: "never_synced",
    lastSyncAt: null,
  };
  store.putConnector(connector);
  const run = runPostureSync(store, clock, connector, postureRecords);
  appendAudit(store, {
    tenantId,
    type: "connector.synced",
    actor: "estate-boot",
    subject: connector.id,
    summary: `Estate posture applied from ${spec.connector.sourceDescription}: ${run.signalsNormalized} signals normalized from ${run.recordsProcessed} records (${run.status}). ${run.note}`,
    references: [connector.id, run.id],
    recordedAt: createdAt,
  });
  return { store, connectorId: connector.id, postureRecords };
}
