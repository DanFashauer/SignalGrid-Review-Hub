import { assertSameTenant, authenticate, authorize } from "./auth";
import { runFixtureSync, type FixturePostureRecord } from "./connector";
import { evaluateDecision } from "./decision";
import { verifySnapshot } from "./evidence";
import { verifyAuditChain, type ChainVerification } from "./audit";
import { seedDemoStore } from "./seed";
import { MemoryStore } from "./store";
import { fixedClock, type Clock } from "./util";
import {
  CoreError,
  type ApiKeyRecord,
  type AuditEvent,
  type Connector,
  type ConnectorSyncRun,
  type Decision,
  type EvaluateRequest,
  type EvaluateResult,
  type EvidenceSnapshot,
  type Policy,
  type PolicyVersion,
  type Principal,
  type Tenant,
} from "./types";

/** The fixed evaluation clock used by the deterministic demo. */
export const DEMO_CLOCK_ISO = "2026-07-13T15:00:00.000Z";

export interface TenantContext {
  principal: Omit<Principal, "keyReference"> & { keyReference: string };
  tenant: Tenant;
}

/**
 * SignalGridCore is the tenant-safe facade over the in-memory product core.
 * Every method takes a bearer token, authenticates it to a principal, and
 * operates strictly inside that principal's tenant. There is no method that
 * accepts a tenant id from the caller — the tenant always comes from the
 * authenticated key, which is what makes cross-tenant access structurally
 * impossible through this surface.
 */
export class SignalGridCore {
  private readonly store: MemoryStore;
  private readonly clock: Clock;
  private readonly fixtureRecords: Record<string, FixturePostureRecord[]>;

  private constructor(
    store: MemoryStore,
    clock: Clock,
    fixtureRecords: Record<string, FixturePostureRecord[]>,
  ) {
    this.store = store;
    this.clock = clock;
    this.fixtureRecords = fixtureRecords;
  }

  /** Build a core preloaded with the deterministic public-safe demo seed. */
  static demo(clockIso: string = DEMO_CLOCK_ISO): SignalGridCore {
    const seeded = seedDemoStore(fixedClock(clockIso));
    return new SignalGridCore(seeded.store, seeded.clock, seeded.fixtureRecords);
  }

  context(token: string): TenantContext {
    const principal = authenticate(this.store, token);
    const tenant = this.requireTenant(principal.tenantId);
    return { principal, tenant };
  }

  evaluate(token: string, request: EvaluateRequest): EvaluateResult {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:evaluate");
    const { result } = evaluateDecision(
      this.store,
      this.clock,
      principal.tenantId,
      this.actorLabel(principal),
      request,
    );
    return result;
  }

  listDecisions(token: string): Decision[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    return this.store.listDecisions(principal.tenantId);
  }

  getDecision(token: string, id: string): Decision {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    const decision = this.store.getDecision(principal.tenantId, id);
    if (!decision) {
      throw new CoreError("not_found", `Decision "${id}" not found.`, 404);
    }
    return decision;
  }

  getSnapshot(token: string, id: string): EvidenceSnapshot {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    const snapshot = this.store.getSnapshot(principal.tenantId, id);
    if (!snapshot) {
      throw new CoreError("not_found", `Evidence snapshot "${id}" not found.`, 404);
    }
    return snapshot;
  }

  verifyEvidence(token: string, snapshotId: string): boolean {
    return verifySnapshot(this.getSnapshot(token, snapshotId));
  }

  listPolicies(token: string): Policy[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "policy:read");
    return this.store.listPolicies(principal.tenantId);
  }

  listPolicyVersions(token: string, policyId: string): PolicyVersion[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "policy:read");
    const policy = this.store.getPolicy(principal.tenantId, policyId);
    if (!policy) {
      throw new CoreError("not_found", `Policy "${policyId}" not found.`, 404);
    }
    return this.store.listPolicyVersions(principal.tenantId, policyId);
  }

  listConnectors(token: string): Connector[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "connector:read");
    return this.store.listConnectors(principal.tenantId);
  }

  listSyncRuns(token: string, connectorId: string): ConnectorSyncRun[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "connector:read");
    const connector = this.store.getConnector(principal.tenantId, connectorId);
    if (!connector) {
      throw new CoreError("not_found", `Connector "${connectorId}" not found.`, 404);
    }
    return this.store.listSyncRuns(principal.tenantId, connectorId);
  }

  /** Replay the fixture connector sync deterministically (read-only). */
  syncConnector(token: string, connectorId: string): ConnectorSyncRun {
    const principal = authenticate(this.store, token);
    authorize(principal, "connector:sync");
    const connector = this.store.getConnector(principal.tenantId, connectorId);
    if (!connector) {
      throw new CoreError("not_found", `Connector "${connectorId}" not found.`, 404);
    }
    const records = this.fixtureRecords[connector.id] ?? [];
    return runFixtureSync(this.store, this.clock, connector, records);
  }

  listAudit(token: string): AuditEvent[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "audit:read");
    return this.store.listAudit(principal.tenantId);
  }

  verifyAudit(token: string): ChainVerification {
    const principal = authenticate(this.store, token);
    authorize(principal, "audit:read");
    return verifyAuditChain(this.store, principal.tenantId);
  }

  // ── Test-only affordances (used by the proof harness) ─────────────────────

  /**
   * Direct, unauthenticated tenant-scoped device lookup — used ONLY by the
   * cross-tenant isolation proof to demonstrate that a device belonging to one
   * tenant is invisible under another tenant's id.
   */
  probeDeviceVisibility(tenantId: string, deviceExternalRef: string): boolean {
    return Boolean(this.store.findDeviceByRef(tenantId, deviceExternalRef));
  }

  /** Expose the underlying store for tamper simulations in the proof only. */
  unsafeStore(): MemoryStore {
    return this.store;
  }

  apiKeys(): ApiKeyRecord[] {
    return [...this.store.apiKeys.values()];
  }

  private requireTenant(tenantId: string): Tenant {
    const tenant = this.store.getTenant(tenantId);
    if (!tenant) {
      throw new CoreError("not_found", `Tenant "${tenantId}" not found.`, 404);
    }
    return tenant;
  }

  private actorLabel(principal: Principal): string {
    return `${principal.principalType}:${principal.subjectId}`;
  }
}

export { assertSameTenant };
