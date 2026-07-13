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
  Tenant,
  User,
  WebhookDelivery,
  WebhookEndpoint,
  Workflow,
} from "./types";

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
  private readonly auditEvents: AuditEvent[] = [];

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
    for (const key of this.apiKeys.values()) {
      if (key.token === token) {
        return key;
      }
    }
    return undefined;
  }

  getTenant(tenantId: string): Tenant | undefined {
    return this.tenants.get(tenantId);
  }

  // ── Identities ────────────────────────────────────────────────────────────

  putIdentity(identity: Identity): void {
    this.identities.set(identity.id, identity);
  }

  getIdentity(tenantId: string, id: string): Identity | undefined {
    return scoped(this.identities.get(id), tenantId);
  }

  findIdentityByRef(tenantId: string, ref: string): Identity | undefined {
    for (const identity of this.identities.values()) {
      if (identity.tenantId === tenantId && identity.externalRef === ref) {
        return identity;
      }
    }
    return undefined;
  }

  // ── Devices ───────────────────────────────────────────────────────────────

  putDevice(device: Device): void {
    this.devices.set(device.id, device);
  }

  getDevice(tenantId: string, id: string): Device | undefined {
    return scoped(this.devices.get(id), tenantId);
  }

  findDeviceByRef(tenantId: string, ref: string): Device | undefined {
    for (const device of this.devices.values()) {
      if (device.tenantId === tenantId && device.externalRef === ref) {
        return device;
      }
    }
    return undefined;
  }

  // ── Workflows ─────────────────────────────────────────────────────────────

  putWorkflow(workflow: Workflow): void {
    this.workflows.set(workflow.id, workflow);
  }

  findWorkflowByKey(tenantId: string, key: string): Workflow | undefined {
    for (const workflow of this.workflows.values()) {
      if (workflow.tenantId === tenantId && workflow.key === key) {
        return workflow;
      }
    }
    return undefined;
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
  }

  listSignalsForSubject(
    tenantId: string,
    subjectType: NormalizedSignal["subjectType"],
    subjectId: string,
  ): NormalizedSignal[] {
    return [...this.signals.values()].filter(
      (row) =>
        row.tenantId === tenantId &&
        row.subjectType === subjectType &&
        row.subjectId === subjectId,
    );
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

  // ── Audit ledger ──────────────────────────────────────────────────────────

  appendAudit(event: AuditEvent): void {
    this.auditEvents.push(event);
  }

  listAudit(tenantId: string): AuditEvent[] {
    return this.auditEvents
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => a.seq - b.seq);
  }

  lastAudit(tenantId: string): AuditEvent | undefined {
    const events = this.listAudit(tenantId);
    return events.length > 0 ? events[events.length - 1] : undefined;
  }

  nextAuditSeq(tenantId: string): number {
    return this.listAudit(tenantId).length + 1;
  }
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
