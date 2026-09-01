import { assertSameTenant, authenticate, authorize } from "./auth";
import { runFixtureSync, type FixturePostureRecord } from "./connector";
import { runDockSync, type DockCustodyRecord } from "./dock";
import { runShiftSync, type ShiftContextRecord } from "./shift";
import { evaluateDecision } from "./decision";
import { verifySnapshot } from "./evidence";
import { verifyAuditChain, type ChainVerification } from "./audit";
import { appendAudit } from "./audit";
import { computeMetrics } from "./metrics";
import {
  ruleSetDigest,
  runPolicyTests as runTests,
  validatePolicyRules,
} from "./policy";
import {
  buildResolutionPlan,
  simulateResolution as runResolutionSimulation,
} from "./resolution";
import { simulateDecision as simulate } from "./simulate";
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
  type Permission,
  type EvidenceSnapshot,
  type MetricsSummary,
  type Policy,
  type PolicyTestResult,
  type PolicyVersion,
  type Principal,
  type PrincipalType,
  type Role,
  type RemediationAction,
  type ResolutionPlan,
  type ResolutionSimulation,
  type SimulationResult,
  type Tenant,
  type WebhookDelivery,
  type WebhookEndpoint,
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
  private readonly dockRecords: Record<string, DockCustodyRecord[]>;
  private readonly shiftRecords: Record<string, ShiftContextRecord[]>;
  /** True only for a core built via `demo()`; gates the public-safe demo-key accessor. */
  private readonly demoMode: boolean;

  private constructor(
    store: MemoryStore,
    clock: Clock,
    fixtureRecords: Record<string, FixturePostureRecord[]>,
    dockRecords: Record<string, DockCustodyRecord[]>,
    shiftRecords: Record<string, ShiftContextRecord[]>,
    demoMode: boolean,
  ) {
    this.store = store;
    this.clock = clock;
    this.fixtureRecords = fixtureRecords;
    this.dockRecords = dockRecords;
    this.shiftRecords = shiftRecords;
    this.demoMode = demoMode;
  }

  /** Build a core preloaded with the deterministic public-safe demo seed. */
  static demo(clockIso: string = DEMO_CLOCK_ISO, storeOptions?: { maxDecisionsPerTenant?: number }): SignalGridCore {
    const seeded = seedDemoStore(fixedClock(clockIso), storeOptions);
    return new SignalGridCore(
      seeded.store,
      seeded.clock,
      seeded.fixtureRecords,
      seeded.dockRecords,
      seeded.shiftRecords,
      true,
    );
  }

  context(token: string): TenantContext {
    const principal = authenticate(this.store, token);
    const tenant = this.requireTenant(principal.tenantId);
    return { principal, tenant };
  }

  /**
   * `context()` AUTHENTICATES ONLY — it deliberately carries no permission, because
   * plenty of callers legitimately need the tenant before they know what they are
   * about to do. That is exactly how a hole opened.
   *
   * Three GA read routes are written as: if a durable decision store is configured,
   * take `context(token).tenant.id`, query Postgres directly, and RETURN. The
   * in-memory fallback on the very same handlers goes through `listDecisions` /
   * `getDecision` / `getSnapshot`, each of which calls
   * `authorize(principal, "decision:read")`. So the permission was enforced on the
   * path CI exercises most and skipped on the path production uses, and `connector`
   * — the one role WITHOUT `decision:read` — could read a tenant's whole decision
   * history the moment DATABASE_URL was set. Dev was stricter than prod.
   *
   * Tenant isolation still held throughout (every durable query is keyed by
   * tenantId), so this was privilege escalation inside a tenant, never across one.
   *
   * The fix is shaped so the mistake is hard to repeat: a caller that needs a
   * tenantId in order to READ must name the permission to get it. `permission` is
   * the typed `Permission` union, so a typo does not compile, and the throw is the
   * same `forbidden`/403 as every other path — raised BEFORE any query runs.
   */
  authorizedContext(token: string, permission: Permission): TenantContext {
    const ctx = this.context(token);
    authorize(ctx.principal, permission);
    return ctx;
  }

  /**
   * Bind a principal that was authenticated by an EXTERNAL provider (the gated
   * enterprise OIDC path) to its already-verified bearer token, so every
   * existing tenant-scoped method resolves that token to this principal with no
   * other change. The signature/claims of the token are verified upstream by
   * `@workspace/enterprise-auth`; this method performs only authorization-side
   * validation — the target tenant must exist and the role must be known — and
   * fails closed otherwise. It never mints a tenant and never widens a role.
   */
  registerVerifiedPrincipal(
    token: string,
    input: { tenantId: string; role: Role; subjectId: string; principalType: PrincipalType; keyReference: string },
  ): Principal {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new CoreError("unauthorized", "Missing bearer token.", 401);
    }
    // The tenant must already exist — an OIDC identity cannot conjure one.
    this.requireTenant(input.tenantId);
    const record: ApiKeyRecord = {
      id: `evk_${input.tenantId}_${input.subjectId}`,
      tenantId: input.tenantId,
      principalType: input.principalType,
      subjectId: input.subjectId,
      role: input.role,
      token: trimmed,
      keyReference: input.keyReference,
    };
    this.store.putVerifiedKey(record);
    return {
      tenantId: record.tenantId,
      principalType: record.principalType,
      subjectId: record.subjectId,
      role: record.role,
      keyReference: record.keyReference,
    };
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

  /** Where this deployment's signals come from — derived from the connectors it
   *  actually holds. No token: it is a fact about the process, not about a tenant. */
  signalSource(): "live" | "fixtures" {
    return this.store.hasNonFixtureConnector() ? "live" : "fixtures";
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
    if (connector.kind === "dockbridge-custody") {
      const dock = this.dockRecords[connector.id] ?? [];
      return runDockSync(this.store, this.clock, connector, dock);
    }
    if (connector.kind === "wfm-shift") {
      const shift = this.shiftRecords[connector.id] ?? [];
      return runShiftSync(this.store, this.clock, connector, shift);
    }
    const records = this.fixtureRecords[connector.id] ?? [];
    return runFixtureSync(this.store, this.clock, connector, records);
  }

  /**
   * Create a new draft policy version from a rule set (owner/admin).
   *
   * The rule set is untrusted request input, so it is fully validated and
   * re-materialised by `validatePolicyRules` before it is ever persisted. This
   * guarantees the stored version can only contain well-formed rules — a
   * malformed rule can never reach `evaluatePolicy` to crash a later decision.
   */
  createPolicyDraft(
    token: string,
    policyId: string,
    rules: unknown,
  ): PolicyVersion {
    const principal = authenticate(this.store, token);
    authorize(principal, "policy:write");
    const policy = this.store.getPolicy(principal.tenantId, policyId);
    if (!policy) {
      throw new CoreError("not_found", `Policy "${policyId}" not found.`, 404);
    }
    const validatedRules = validatePolicyRules(rules);
    const version = this.store.nextPolicyVersionNumber(
      principal.tenantId,
      policyId,
    );
    const createdAt = this.clock.now().toISOString();
    const draft: PolicyVersion = {
      id: `${policyId}_v${version}`,
      tenantId: principal.tenantId,
      policyId,
      version,
      status: "draft",
      rules: validatedRules,
      createdAt,
      digest: ruleSetDigest(validatedRules),
    };
    this.store.putPolicyVersion(draft);
    return draft;
  }

  /** Activate a policy version; supersedes the previously active one (owner/admin). */
  activatePolicyVersion(
    token: string,
    policyId: string,
    versionId: string,
  ): Policy {
    const principal = authenticate(this.store, token);
    authorize(principal, "policy:write");
    const policy = this.store.getPolicy(principal.tenantId, policyId);
    if (!policy) {
      throw new CoreError("not_found", `Policy "${policyId}" not found.`, 404);
    }
    const target = this.store.getPolicyVersion(principal.tenantId, versionId);
    if (!target || target.policyId !== policyId) {
      throw new CoreError(
        "not_found",
        `Policy version "${versionId}" not found for this policy.`,
        404,
      );
    }
    for (const version of this.store.listPolicyVersions(
      principal.tenantId,
      policyId,
    )) {
      if (version.status === "active" && version.id !== versionId) {
        this.store.putPolicyVersion({ ...version, status: "superseded" });
      }
    }
    this.store.putPolicyVersion({ ...target, status: "active" });
    const updated: Policy = { ...policy, activeVersionId: versionId };
    this.store.putPolicy(updated);
    appendAudit(this.store, {
      tenantId: principal.tenantId,
      type: "policy.version_activated",
      actor: this.actorLabel(principal),
      subject: versionId,
      summary: `Policy "${policy.key}" activated version ${target.version}.`,
      references: [policyId, versionId],
      recordedAt: this.clock.now().toISOString(),
    });
    return updated;
  }

  runPolicyTests(
    token: string,
    policyId: string,
    versionId?: string,
  ): PolicyTestResult[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "policy:read");
    const policy = this.store.getPolicy(principal.tenantId, policyId);
    if (!policy) {
      throw new CoreError("not_found", `Policy "${policyId}" not found.`, 404);
    }
    const version = this.store.getPolicyVersion(
      principal.tenantId,
      versionId ?? policy.activeVersionId,
    );
    if (!version) {
      throw new CoreError("not_found", "Policy version not found.", 404);
    }
    const tests = this.store.listPolicyTests(principal.tenantId, policyId);
    return runTests(version, tests);
  }

  /** Replay a stored decision against a chosen policy version (no mutation). */
  simulateDecision(
    token: string,
    decisionId: string,
    policyVersionId: string,
  ): SimulationResult {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    authorize(principal, "policy:read");
    const decision = this.store.getDecision(principal.tenantId, decisionId);
    if (!decision) {
      throw new CoreError("not_found", `Decision "${decisionId}" not found.`, 404);
    }
    const snapshot = this.store.getSnapshot(
      principal.tenantId,
      decision.evidenceSnapshotId,
    );
    if (!snapshot) {
      throw new CoreError("not_found", "Evidence snapshot not found.", 404);
    }
    const version = this.store.getPolicyVersion(
      principal.tenantId,
      policyVersionId,
    );
    if (!version) {
      throw new CoreError(
        "not_found",
        `Policy version "${policyVersionId}" not found.`,
        404,
      );
    }
    return simulate(decision, snapshot, version);
  }

  metrics(token: string): MetricsSummary {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    return computeMetrics(this.store.listDecisions(principal.tenantId));
  }

  /** The Resolution Assistant's plan for a decision (deterministic). */
  getResolution(token: string, decisionId: string): ResolutionPlan {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    const decision = this.store.getDecision(principal.tenantId, decisionId);
    if (!decision) {
      throw new CoreError("not_found", `Decision "${decisionId}" not found.`, 404);
    }
    const config = this.store.getResolutionConfig(principal.tenantId) ?? {
      tenantId: principal.tenantId,
      primaryHardwareChannel: "operator_console" as const,
      autoProposeEnabled: true,
    };
    return buildResolutionPlan(decision, config);
  }

  /**
   * Preview the outcome after the decision's resolvable fixes are (simulated)
   * applied — approval-gated, nothing is executed. No stored state changes.
   */
  simulateResolution(token: string, decisionId: string): ResolutionSimulation {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    const decision = this.store.getDecision(principal.tenantId, decisionId);
    if (!decision) {
      throw new CoreError("not_found", `Decision "${decisionId}" not found.`, 404);
    }
    const snapshot = this.store.getSnapshot(
      principal.tenantId,
      decision.evidenceSnapshotId,
    );
    if (!snapshot) {
      throw new CoreError("not_found", "Evidence snapshot not found.", 404);
    }
    const version = this.store.getPolicyVersion(
      principal.tenantId,
      decision.policyVersionId,
    );
    if (!version) {
      throw new CoreError("not_found", "Policy version not found.", 404);
    }
    return runResolutionSimulation(decision, snapshot.evidence, version);
  }

  listWebhookEndpoints(token: string): WebhookEndpoint[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "connector:read");
    return this.store.listWebhookEndpoints(principal.tenantId);
  }

  listWebhookDeliveries(token: string): WebhookDelivery[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "connector:read");
    return this.store.listWebhookDeliveries(principal.tenantId);
  }

  listRemediations(token: string): RemediationAction[] {
    const principal = authenticate(this.store, token);
    authorize(principal, "decision:read");
    return this.store.listRemediations(principal.tenantId);
  }

  /**
   * Approve a remediation request. Approval is simulated only: it records the
   * decision to act, it does NOT execute any change on a source system.
   */
  approveRemediation(token: string, id: string): RemediationAction {
    const principal = authenticate(this.store, token);
    authorize(principal, "remediation:approve");
    const action = this.store.getRemediation(principal.tenantId, id);
    if (!action) {
      throw new CoreError("not_found", `Remediation "${id}" not found.`, 404);
    }
    if (action.status !== "requires_approval") {
      throw new CoreError(
        "validation",
        `Remediation "${id}" is not awaiting approval.`,
        400,
      );
    }
    const approvedAt = this.clock.now().toISOString();
    const approved: RemediationAction = {
      ...action,
      status: "approved_simulated",
      approvedAt,
    };
    this.store.putRemediation(approved);
    appendAudit(this.store, {
      tenantId: principal.tenantId,
      type: "remediation.approved",
      actor: this.actorLabel(principal),
      subject: approved.id,
      summary: `Remediation ${approved.kind} approved (simulated only; no source-system change executed).`,
      references: [approved.decisionId, approved.id],
      recordedAt: approvedAt,
    });
    return approved;
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

  /**
   * The public-safe demo API keys. This exists ONLY because the review build
   * ships intentionally-public fixture tokens (`sgk_demo_*`) so reviewers can
   * authenticate against the seeded tenants. It is available only on a core
   * built via `SignalGridCore.demo()`; on any non-demo core it throws, so the
   * production-shaped surface never has an unscoped, raw-token accessor. A real
   * production core would expose only masked `keyReference`s, tenant-scoped and
   * behind `tenant:admin`. There is no `unsafeStore()` / caller-supplied-tenant
   * probe on this class — cross-tenant access is structurally impossible.
   */
  demoApiKeys(): ApiKeyRecord[] {
    if (!this.demoMode) {
      throw new CoreError(
        "forbidden",
        "Demo API keys are only available on a demo-seeded core.",
        403,
      );
    }
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
