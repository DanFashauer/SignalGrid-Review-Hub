import type {
  ApiKeyRecord,
  AuditEvent,
  Connector,
  ConnectorSyncRun,
  Decision,
  Device,
  EvidenceSnapshot,
  Identity,
  Membership,
  NormalizedSignal,
  Policy,
  PolicyTest,
  PolicyVersion,
  RemediationAction,
  ResolutionConfig,
  Tenant,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  Workflow,
} from "./types";
import { constantTimeEquals } from "./util";

/**
 * In-memory, tenant-scoped store.
 *
 * Isolation invariant: every customer-owned entity carries a `tenantId`, and
 * every read accessor requires the caller's `tenantId` and returns only rows
 * whose `tenantId` matches. A customer-owned object is NEVER looked up by id
 * alone. This mirrors the plan's rule: `object.id + tenant_id`, always.
 */
export class MemoryStore {
  readonly tenants = new Map<string, Tenant>();
  readonly users = new Map<string, User>();
  readonly memberships = new Map<string, Membership>();
  readonly apiKeys = new Map<string, ApiKeyRecord>();

  private readonly identities = new Map<string, Identity>();
  private readonly devices = new Map<string, Device>();
  private readonly workflows = new Map<string, Workflow>();
  private readonly connectors = new Map<string, Connector>();
  private readonly syncRuns = new Map<string, ConnectorSyncRun>();
  private readonly signals = new Map<string, NormalizedSignal>();
  private readonly policies = new Map<string, Policy>();
  private readonly policyVersions = new Map<string, PolicyVersion>();
  private readonly policyTests = new Map<string, PolicyTest>();
  private readonly decisions = new Map<string, Decision>();
  private readonly snapshots = new Map<string, EvidenceSnapshot>();
  private readonly webhookEndpoints = new Map<string, WebhookEndpoint>();
  private readonly webhookDeliveries = new Map<string, WebhookDelivery>();
  private readonly remediations = new Map<string, RemediationAction>();
  private readonly resolutionConfigs = new Map<string, ResolutionConfig>();
  private readonly decisionSeq = new Map<string, number>();
  private readonly auditEvents: AuditEvent[] = [];
  private readonly auditTail = new Map<string, { seq: number; digest: string }>();

  // Composite-key indexes for the per-decision hot path, so device/identity/
  // workflow resolution and per-subject signal gathering are O(1) instead of a
  // full-store scan on every evaluation. Every key is prefixed with the tenant
  // id, so the indexes preserve the same tenant-isolation invariant as the
  // scans they replace — a lookup can only ever return rows for the queried
  // tenant. The signal index buckets by subject and dedupes by signal id,
  // preserving insertion order so derived evidence and snapshots are identical.
  private readonly identityByRef = new Map<string, Identity>();
  private readonly deviceByRef = new Map<string, Device>();
  private readonly workflowByKey = new Map<string, Workflow>();
  private readonly signalsBySubject = new Map<string, Map<string, NormalizedSignal>>();

  // ── Tenant-independent registries (auth resolution only) ──────────────────

  putTenant(tenant: Tenant): void {
    this.tenants.set(tenant.id, tenant);
  }

  putUser(user: User): void {
    this.users.set(user.id, user);
  }

  putMembership(membership: Membership): void {
    this.memberships.set(membership.id, membership);
  }

  putApiKey(key: ApiKeyRecord): void {
    this.apiKeys.set(key.id, key);
  }

  findApiKeyByToken(token: string): ApiKeyRecord | undefined {
    // Compare with a length-independent equality so token lookup does not leak a
    // per-character timing signal (see `constantTimeEquals`).
    let match: ApiKeyRecord | undefined;
    for (const key of this.apiKeys.values()) {
      if (constantTimeEquals(key.token, token)) {
        match = key;
      }
    }
    return match;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  // ── Identities ────────────────────────────────────────────────────────────

  putIdentity(identity: Identity): void {
    this.identities.set(identity.id, identity);
    this.identityByRef.set(refKey(identity.tenantId, identity.externalRef), identity);
  }

  getIdentity(tenantId: string, id: string): Identity | undefined {
    return scoped(this.identities.get(id), tenantId);
  }

  findIdentityByRef(tenantId: string, ref: string): Identity | undefined {
    return this.identityByRef.get(refKey(tenantId, ref));
  }

  // ── Devices ───────────────────────────────────────────────────────────────

  putDevice(device: Device): void {
    this.devices.set(device.id, device);
    this.deviceByRef.set(refKey(device.tenantId, device.externalRef), device);
  }

  getDevice(tenantId: string, id: string): Device | undefined {
    return scoped(this.devices.get(id), tenantId);
  }

  findDeviceByRef(tenantId: string, ref: string): Device | undefined {
    return this.deviceByRef.get(refKey(tenantId, ref));
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  putWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
    this.workflowByKey.set(refKey(workflow.tenantId, workflow.key), workflow);
  }

  findWorkflowByKey(tenantId: string, key: string): Workflow | undefined {
    return this.workflowByKey.get(refKey(tenantId, key));
  }

  // ── Connectors ────────────────────────────────────────────────────────────

  putConnector(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  getConnector(tenantId: string, id: string): Connector | undefined {
    return scoped(this.connectors.get(id), tenantId);
  }

  listConnectors(tenantId: string): Connector[] {
    return [...this.connectors.values()].filter(
      (row) => row.tenantId === tenantId,
    );
  }

  putSyncRun(run: ConnectorSyncRun): void {
    this.syncRuns.set(run.id, run);
  }

  listSyncRuns(tenantId: string, connectorId: string): ConnectorSyncRun[] {
    return [...this.syncRuns.values()]
      .filter(
        (row) => row.tenantId === tenantId && row.connectorId === connectorId,
      )
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  // ── Normalized signals ────────────────────────────────────────────────────

  putSignal(signal: NormalizedSignal): void {
    this.signals.set(signal.id, signal);
    const key = subjectKey(signal.tenantId, signal.subjectType, signal.subjectId);
    let bucket = this.signalsBySubject.get(key);
    if (!bucket) {
      bucket = new Map();
      this.signalsBySubject.set(key, bucket);
    }
    // Keyed by signal id so a re-put overwrites in place (preserving order),
    // exactly as the by-id primary map does.
    bucket.set(signal.id, signal);
  }

  listSignalsForSubject(
    tenantId: string,
    subjectType: NormalizedSignal["subjectType"],
    subjectId: string,
  ): NormalizedSignal[] {
    const bucket = this.signalsBySubject.get(
      subjectKey(tenantId, subjectType, subjectId),
    );
    return bucket ? [...bucket.values()] : [];
  }

  // ── Policies ──────────────────────────────────────────────────────────────

  putPolicy(policy: Policy): void {
    this.policies.set(policy.id, policy);
  }

  listPolicies(tenantId: string): Policy[] {
    return [...this.policies.values()].filter(
      (row) => row.tenantId === tenantId,
    );
  }

  getPolicy(tenantId: string, id: string): Policy | undefined {
    return scoped(this.policies.get(id), tenantId);
  }

  findPolicyForWorkflow(tenantId: string, workflowKey: string): Policy | undefined {
    const policies = this.listPolicies(tenantId);
    const match = policies.find(
      (policy) => policy.workflowPattern === workflowKey,
    );
    return match ?? policies.find((policy) => policy.workflowPattern === "*");
  }

  putPolicyVersion(version: PolicyVersion): void {
    this.policyVersions.set(version.id, version);
  }

  getPolicyVersion(tenantId: string, id: string): PolicyVersion | undefined {
    return scoped(this.policyVersions.get(id), tenantId);
  }

  listPolicyVersions(tenantId: string, policyId: string): PolicyVersion[] {
    return [...this.policyVersions.values()]
      .filter((row) => row.tenantId === tenantId && row.policyId === policyId)
      .sort((a, b) => b.version - a.version);
  }

  nextPolicyVersionNumber(tenantId: string, policyId: string): number {
    const versions = this.listPolicyVersions(tenantId, policyId);
    return versions.length === 0 ? 1 : versions[0].version + 1;
  }

  putPolicyTest(test: PolicyTest): void {
    this.policyTests.set(test.id, test);
  }

  listPolicyTests(tenantId: string, policyId: string): PolicyTest[] {
    return [...this.policyTests.values()].filter(
      (row) => row.tenantId === tenantId && row.policyId === policyId,
    );
  }

  // ── Decisions & snapshots ─────────────────────────────────────────────────

  putDecision(decision: Decision): void {
    this.decisions.set(decision.id, decision);
  }

  /**
   * Monotonic per-tenant evaluation counter (O(1)). Returns the count of prior
   * evaluations and increments — a fresh store starts each tenant at 0, so two
   * fresh cores agree on their first decision while repeated evaluations in one
   * core stay unique.
   */
  nextDecisionSeq(tenantId: string): number {
    const current = this.decisionSeq.get(tenantId) ?? 0;
    this.decisionSeq.set(tenantId, current + 1);
    return current;
  }

  getDecision(tenantId: string, id: string): Decision | undefined {
    return scoped(this.decisions.get(id), tenantId);
  }

  listDecisions(tenantId: string): Decision[] {
    return [...this.decisions.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  putSnapshot(snapshot: EvidenceSnapshot): void {
    this.snapshots.set(snapshot.id, snapshot);
  }

  getSnapshot(tenantId: string, id: string): EvidenceSnapshot | undefined {
    return scoped(this.snapshots.get(id), tenantId);
  }

  // ── Webhooks ──────────────────────────────────────────────────────────────

  putWebhookEndpoint(endpoint: WebhookEndpoint): void {
    this.webhookEndpoints.set(endpoint.id, endpoint);
  }

  listWebhookEndpoints(tenantId: string): WebhookEndpoint[] {
    return [...this.webhookEndpoints.values()].filter(
      (row) => row.tenantId === tenantId,
    );
  }

  putWebhookDelivery(delivery: WebhookDelivery): void {
    this.webhookDeliveries.set(delivery.id, delivery);
  }

  listWebhookDeliveries(tenantId: string): WebhookDelivery[] {
    return [...this.webhookDeliveries.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Remediation ───────────────────────────────────────────────────────────

  putRemediation(action: RemediationAction): void {
    this.remediations.set(action.id, action);
  }

  getRemediation(tenantId: string, id: string): RemediationAction | undefined {
    return scoped(this.remediations.get(id), tenantId);
  }

  listRemediations(tenantId: string): RemediationAction[] {
    return [...this.remediations.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  }

  // ── Resolution config ─────────────────────────────────────────────────────

  putResolutionConfig(config: ResolutionConfig): void {
    this.resolutionConfigs.set(config.tenantId, config);
  }

  getResolutionConfig(tenantId: string): ResolutionConfig | undefined {
    return this.resolutionConfigs.get(tenantId);
  }

  // ── Audit ledger ──────────────────────────────────────────────────────────

  appendAudit(event: AuditEvent): void {
    this.auditEvents.push(event);
    // Maintain an O(1) per-tenant chain tail so appends do not rescan the log.
    this.auditTail.set(event.tenantId, { seq: event.seq, digest: event.digest });
  }

  listAudit(tenantId: string): AuditEvent[] {
    return this.auditEvents
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => a.seq - b.seq);
  }

  /** Digest of the last event in a tenant's chain (O(1)), or undefined. */
  lastAuditDigest(tenantId: string): string | undefined {
    return this.auditTail.get(tenantId)?.digest;
  }

  nextAuditSeq(tenantId: string): number {
    return (this.auditTail.get(tenantId)?.seq ?? 0) + 1;
  }
}

// Composite index keys. The tenant id is always the first segment, so an index
// lookup is inherently tenant-scoped. `|` is safe as a separator: tenant ids,
// external refs, workflow keys, and subject ids in this core are alphanumeric
// with `_`/`-`/`.` and never contain `|`.
function refKey(tenantId: string, ref: string): string {
  return `${tenantId}|${ref}`;
}

function subjectKey(
  tenantId: string,
  subjectType: string,
  subjectId: string,
): string {
  return `${tenantId}|${subjectType}|${subjectId}`;
}

/** Return the row only if it belongs to the caller's tenant; else undefined. */
function scoped<T extends { tenantId: string }>(
  row: T | undefined,
  tenantId: string,
): T | undefined {
  if (!row || row.tenantId !== tenantId) {
    return undefined;
  }
  return row;
}
