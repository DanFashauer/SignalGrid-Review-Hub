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

  // Ephemeral keys for principals authenticated by an EXTERNAL provider (the
  // gated enterprise OIDC path): the bearer here is a JWT whose signature and
  // claims were already verified upstream, so we bind it to a resolved principal
  // and let the existing token→principal resolution serve every downstream call
  // unchanged. Bounded FIFO so a stream of rotated tokens can never grow the map
  // without limit. Keyed by the exact token — a JWT is a high-entropy verified
  // credential, so an exact-match lookup carries no secret-guessing timing risk
  // the way the static demo tokens do.
  private readonly verifiedKeys = new Map<string, ApiKeyRecord>();
  private static readonly MAX_VERIFIED_KEYS = 1024;

  // ONE KNOB (FIFO, per tenant, default 5000, no clock); every collection an
  // evaluate grows derives its cap from it, so no bound is enforced at a smaller
  // constant than the memory it holds:
  //
  //   decisions + snapshots  1x  one snapshot per decision
  //   auditEvents            2x  decision.evaluated + evidence.snapshot.created
  //                              (lib/signalgrid-core/src/decision.ts:157,166)
  //   webhookDeliveries      2x  one per ACTIVE subscribed endpoint — a fan-out
  //   remediations           1x  bounded by the decision that proposed them
  private readonly maxDecisionsPerTenant: number;
  private readonly maxAuditEventsPerTenant: number;
  private readonly maxWebhookDeliveriesPerTenant: number;
  private readonly maxRemediationsPerTenant: number;
  private readonly decisionOrder = new Map<string, string[]>();
  private readonly decisionsEvicted = new Map<string, number>();
  private readonly webhookDeliveryOrder = new Map<string, string[]>();
  private readonly remediationOrder = new Map<string, string[]>();

  constructor(options: { maxDecisionsPerTenant?: number } = {}) {
    const n = options.maxDecisionsPerTenant ?? 5000;
    if (!Number.isInteger(n) || n < 1) throw new Error(`maxDecisionsPerTenant must be a positive integer, got ${String(n)}`);
    this.maxDecisionsPerTenant = n;
    this.maxAuditEventsPerTenant = n * 2;
    this.maxWebhookDeliveriesPerTenant = n * 2;
    this.maxRemediationsPerTenant = n;
  }

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
  // Per tenant. `auditTail` deliberately not trimmed: seq must stay monotonic.
  private readonly auditByTenant = new Map<string, AuditEvent[]>();
  private readonly auditEvicted = new Map<string, { count: number; lastDigest: string }>();
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

  /**
   * Bind an externally-verified principal to its (already-authenticated) bearer
   * token. Bounded FIFO eviction keeps the registry from growing without limit.
   */
  putVerifiedKey(key: ApiKeyRecord): void {
    if (
      this.verifiedKeys.size >= MemoryStore.MAX_VERIFIED_KEYS &&
      !this.verifiedKeys.has(key.token)
    ) {
      const oldest = this.verifiedKeys.keys().next().value;
      if (oldest !== undefined) {
        this.verifiedKeys.delete(oldest);
      }
    }
    this.verifiedKeys.set(key.token, key);
  }

  findApiKeyByToken(token: string): ApiKeyRecord | undefined {
    // Externally-verified tokens resolve by exact match first: their signature
    // was already checked upstream, so there is no static secret to protect with
    // a constant-time scan here.
    const verified = this.verifiedKeys.get(token);
    if (verified) {
      return verified;
    }
    // Fixture demo keys: compare with a length-independent equality so token
    // lookup does not leak a per-character timing signal (see `constantTimeEquals`).
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

  /**
   * Whether ANY connector in this process is something other than a fixture — a
   * deployment fact, so deliberately unscoped by tenant. `ConnectorMode` is
   * fixture-only today, so this cannot return true until a live mode exists; that
   * is the point. The deployment's stated signal source derives from THIS, not from
   * an environment flag that could assert a posture the core does not have.
   */
  hasNonFixtureConnector(): boolean {
    return [...this.connectors.values()].some((row) => (row.mode as string) !== "fixture");
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

  /** Bounded per-tenant FIFO: append, then evict from the front past `max`. */
  private track<T>(
    order: Map<string, T[]>,
    tenantId: string,
    item: T,
    max: number,
    evict: (evicted: T) => void,
  ): void {
    const rows = order.get(tenantId) ?? [];
    rows.push(item);
    while (rows.length > max) evict(rows.shift()!);
    order.set(tenantId, rows);
  }

  putDecision(decision: Decision): void {
    const fresh = !this.decisions.has(decision.id);
    this.decisions.set(decision.id, decision);
    if (!fresh) return;
    this.track(this.decisionOrder, decision.tenantId, decision.id, this.maxDecisionsPerTenant, (evictId) => {
      const evicted = this.decisions.get(evictId);
      this.decisions.delete(evictId);
      if (evicted) this.snapshots.delete(evicted.evidenceSnapshotId);
      // Counted so /v1/metrics can say its numbers cover a WINDOW, not the whole history.
      this.decisionsEvicted.set(decision.tenantId, (this.decisionsEvicted.get(decision.tenantId) ?? 0) + 1);
    });
  }

  /**
   * What window the decision-derived aggregates were computed over. `capped` is
   * true once ANY row has been evicted for this tenant — from that moment the
   * retained list is a suffix of the tenant's history, not the whole of it.
   */
  decisionBound(tenantId: string): { capped: boolean; maxPerTenant: number } {
    return { capped: (this.decisionsEvicted.get(tenantId) ?? 0) > 0, maxPerTenant: this.maxDecisionsPerTenant };
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
    const fresh = !this.webhookDeliveries.has(delivery.id);
    this.webhookDeliveries.set(delivery.id, delivery);
    if (!fresh) return;
    this.track(this.webhookDeliveryOrder, delivery.tenantId, delivery.id, this.maxWebhookDeliveriesPerTenant,
      (id) => { this.webhookDeliveries.delete(id); });
  }

  listWebhookDeliveries(tenantId: string): WebhookDelivery[] {
    return [...this.webhookDeliveries.values()]
      .filter((row) => row.tenantId === tenantId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  // ── Remediation ───────────────────────────────────────────────────────────

  putRemediation(action: RemediationAction): void {
    // `fresh` matters: approving a remediation re-puts the SAME id, and counting
    // that as a new row would evict a live one on every approval.
    const fresh = !this.remediations.has(action.id);
    this.remediations.set(action.id, action);
    if (!fresh) return;
    this.track(this.remediationOrder, action.tenantId, action.id, this.maxRemediationsPerTenant,
      (id) => { this.remediations.delete(id); });
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
    this.track(this.auditByTenant, event.tenantId, event, this.maxAuditEventsPerTenant, (evicted) => {
      // The evicted event's digest is REMEMBERED, not discarded: the chain is a
      // hash chain, so a verifier that still started at GENESIS would report the
      // surviving head as broken. Keeping the boundary digest lets the verifier
      // check the retained window honestly and SAY that it is a window
      // (`truncated`), which is the same treatment LedgerVerification.truncated
      // gives the durable ledger. Silently reporting `valid: true` over a
      // re-anchored chain without saying so would be the false all-clear.
      const prior = this.auditEvicted.get(event.tenantId);
      this.auditEvicted.set(event.tenantId, {
        count: (prior?.count ?? 0) + 1,
        lastDigest: evicted.digest,
      });
    });
    // Maintain an O(1) per-tenant chain tail so appends do not rescan the log.
    this.auditTail.set(event.tenantId, { seq: event.seq, digest: event.digest });
  }

  listAudit(tenantId: string): AuditEvent[] {
    return [...(this.auditByTenant.get(tenantId) ?? [])].sort((a, b) => a.seq - b.seq);
  }

  /** The eviction boundary, or undefined: `lastDigest` is what the oldest RETAINED event links to. */
  auditEviction(tenantId: string): { count: number; lastDigest: string } | undefined {
    return this.auditEvicted.get(tenantId);
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
