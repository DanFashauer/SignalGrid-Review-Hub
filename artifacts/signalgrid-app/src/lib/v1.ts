/**
 * Thin client for the `/v1` product API — the **deterministic decision core**.
 *
 * This is intentionally separate from the generated `@workspace/api-client-react`
 * client (which targets the `/api/*` monitoring fixtures). Calling `/v1` gives a
 * real, core-computed decision — evidence-backed, reason-coded — so the console
 * can show the engine actually deciding, not just fixture telemetry.
 *
 * The demo operator token is a public-safe fixture surfaced by `GET /api/v1/keys`
 * (see DEMO_KEYS in the api-server); it is not a real credential.
 */

const DEMO_OPERATOR_TOKEN = "sgk_demo_northwind_operator";

// Injectable token: defaults to the public-safe demo operator key, and a hosted
// deployment (or a future login flow) can swap it without touching call sites.
let activeToken = DEMO_OPERATOR_TOKEN;
export function setV1Token(token: string): void {
  activeToken = token.trim() || DEMO_OPERATOR_TOKEN;
}

// Mirror main.tsx: relative in dev (Vite proxies /api) and same-origin deploys;
// prefixed when a hosted build points at a remote api-server.
const BASE = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

export interface V1MatchedRule {
  ruleId: string;
  reasonCode: string;
  outcome: string;
  severity: string;
}

export type V1Outcome = "allow" | "step_up" | "restrict" | "deny";

export interface V1Decision {
  /** Absent on decisions minted before provenance stamping — "unstamped", not zero. */
  coreNormalizationVersion?: number;
  decisionId: string;
  outcome: V1Outcome;
  reasonCodes: string[];
  policyId: string;
  policyVersion: number;
  evidenceSnapshotId: string;
  matchedRules: V1MatchedRule[];
  reviewable: boolean;
  latencyMs: number;
  explanation: string;
}

export interface V1EvaluateRequest {
  identityRef: string;
  deviceRef: string;
  workflowKey: string;
}

/** Evaluate one decision against the live `/v1` core. */
export async function evaluateV1(req: V1EvaluateRequest): Promise<V1Decision> {
  const res = await fetch(`${BASE}/api/v1/decisions/evaluate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${activeToken}`,
    },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body.detail || body.message || body.title || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`/v1 evaluate failed — ${detail}`);
  }

  const json = (await res.json()) as { decision: V1Decision };
  return json.decision;
}

// ── decisions / evidence / audit / context: the console's read surface ────────
// These are the routes the launch profile publishes as "the console's list
// view" and "the claim" — served by the deterministic core, consumed here.

/** The full persisted decision record (`GET /v1/decisions[/:id]`) — a superset
 *  of the evaluate result: ids are `id` (not `decisionId`) and the record
 *  carries subjects, review state and creation time. */
export interface V1DecisionRecord {
  id: string;
  tenantId: string;
  identityId: string;
  deviceId: string;
  workflowId: string;
  outcome: V1Outcome;
  policyId: string;
  policyVersionId: string;
  policyVersion: number;
  matchedRules: V1MatchedRule[];
  reasonCodes: string[];
  signalIds: string[];
  evidenceSnapshotId: string;
  requestContext: Record<string, string>;
  latencyMs: number;
  createdAt: string;
  reviewStatus: string;
  reviewable: boolean;
  explanation: string;
  coreNormalizationVersion?: number;
}

export interface V1SignalUsed {
  id: string;
  category: string;
  value: string | number | boolean | null;
  observedAt: string;
  freshness: string;
  sourceReference: string;
}

export interface V1EvidenceSnapshot {
  id: string;
  tenantId: string;
  decisionId: string;
  capturedAt: string;
  /** The normalized facts the policy evaluated — key/value, rendered as-is. */
  evidence: Record<string, unknown>;
  signalsUsed: V1SignalUsed[];
  policyVersionId: string;
  policyVersion: number;
  sourceReferences: string[];
  coreNormalizationVersion?: number;
}

export interface V1AuditEvent {
  id: string;
  tenantId: string;
  seq: number;
  type: string;
  actor: string;
  subject: string;
  summary: string;
  references: string[];
  recordedAt: string;
  prevDigest: string;
  digest: string;
}

export interface V1ChainVerification {
  valid: boolean;
  brokenAtSeq: number | null;
  length: number;
}

/** Deployment assurance posture from `/v1/context` — what these verdicts ARE. */
export interface V1Assurance {
  profile: string;
  tier: string;
  signalSource: "live" | "fixtures";
  verdictEffect: "advisory";
  stepUpAnswerable: boolean;
}

export async function listDecisionsV1(): Promise<V1DecisionRecord[]> {
  const json = await v1<{ decisions: V1DecisionRecord[] }>(`/api/v1/decisions`, { method: "GET" }, activeToken);
  return json.decisions;
}

export async function getDecisionV1(id: string): Promise<V1DecisionRecord> {
  const json = await v1<{ decision: V1DecisionRecord }>(
    `/api/v1/decisions/${encodeURIComponent(id)}`,
    { method: "GET" },
    activeToken,
  );
  return json.decision;
}

export async function getEvidenceV1(id: string): Promise<{ evidence: V1EvidenceSnapshot; verified: boolean }> {
  return v1<{ evidence: V1EvidenceSnapshot; verified: boolean }>(
    `/api/v1/decisions/${encodeURIComponent(id)}/evidence`,
    { method: "GET" },
    activeToken,
  );
}

// The audit ledger requires `audit:read`, which the operator role DELIBERATELY
// lacks (separation of duties: the person acting is not the person attesting).
// The console reads it with the public-safe demo AUDITOR key instead of
// widening the operator role — RBAC demonstrated, not weakened.
const DEMO_AUDITOR_TOKEN = "sgk_demo_northwind_auditor";

export async function getAuditV1(): Promise<{ events: V1AuditEvent[]; chain: V1ChainVerification }> {
  return v1<{ events: V1AuditEvent[]; chain: V1ChainVerification }>(`/api/v1/audit`, { method: "GET" }, DEMO_AUDITOR_TOKEN);
}

export async function getContextV1(): Promise<{ assurance: V1Assurance }> {
  return v1<{ assurance: V1Assurance }>(`/api/v1/context`, { method: "GET" }, activeToken);
}

export interface V1Metrics {
  totalDecisions: number;
  byOutcome: Record<V1Outcome, number>;
  allowRate: number;
  restrictDenyRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  decisionsWithPolicyVersion: number;
  decisionsWithEvidence: number;
  pendingReview: number;
}

export async function getMetricsV1(): Promise<V1Metrics> {
  const json = await v1<{ metrics: V1Metrics }>(`/api/v1/metrics`, { method: "GET" }, activeToken);
  return json.metrics;
}

// ── connectors: setup & health (launch wireframe screen 2) ────────────────────

export interface V1Connector {
  id: string;
  tenantId: string;
  kind: string;
  mode: string;
  ingestionMode?: string;
  permissionScope: string;
  credentialRef: string;
  status: string;
  lastSyncAt: string | null;
}

export interface V1SyncRun {
  id: string;
  tenantId: string;
  connectorId: string;
  startedAt: string;
  completedAt: string;
  status: string;
  recordsProcessed: number;
  signalsNormalized: number;
  note: string;
}

export async function listConnectorsV1(): Promise<V1Connector[]> {
  const json = await v1<{ connectors: V1Connector[] }>(`/api/v1/connectors`, { method: "GET" }, activeToken);
  return json.connectors;
}

export async function listSyncRunsV1(connectorId: string): Promise<V1SyncRun[]> {
  const json = await v1<{ syncRuns: V1SyncRun[] }>(
    `/api/v1/connectors/${encodeURIComponent(connectorId)}/sync-runs`,
    { method: "GET" },
    activeToken,
  );
  return json.syncRuns;
}

// Triggering a sync requires `connector:sync`, which the operator role
// DELIBERATELY lacks (owner/admin and the connector service role hold it).
// The demo uses the public-safe owner key for this one action and says so in
// the UI. The core refuses non-fixture connectors inside runFixtureSync, so
// this route can never touch a source system.
const DEMO_OWNER_TOKEN = "sgk_demo_northwind_owner";

export async function triggerSyncV1(connectorId: string): Promise<V1SyncRun> {
  const json = await v1<{ syncRun: V1SyncRun }>(
    `/api/v1/connectors/${encodeURIComponent(connectorId)}/sync`,
    { method: "POST" },
    DEMO_OWNER_TOKEN,
  );
  return json.syncRun;
}

// ── policies: the versioned "what decided this" surface (wireframe screen 5) ──

export interface V1Policy {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  description: string;
  workflowPattern: string;
  activeVersionId: string;
}

export interface V1PolicyRule {
  id: string;
  description: string;
  match: Array<Record<string, unknown>>;
  outcome: V1Outcome;
  reasonCode: string;
  severity: string;
}

export interface V1PolicyVersion {
  id: string;
  tenantId: string;
  policyId: string;
  version: number;
  status: string;
  rules: V1PolicyRule[];
  createdAt: string;
  digest: string;
}

export interface V1PolicyTestResult {
  testId: string;
  name: string;
  passed: boolean;
  expectedOutcome: V1Outcome;
  actualOutcome: V1Outcome;
  expectedReasonCode?: string;
  actualReasonCodes: string[];
}

export async function listPoliciesV1(): Promise<V1Policy[]> {
  const json = await v1<{ policies: V1Policy[] }>(`/api/v1/policies`, { method: "GET" }, activeToken);
  return json.policies;
}

export async function listPolicyVersionsV1(policyId: string): Promise<V1PolicyVersion[]> {
  const json = await v1<{ versions: V1PolicyVersion[] }>(
    `/api/v1/policies/${encodeURIComponent(policyId)}/versions`,
    { method: "GET" },
    activeToken,
  );
  return json.versions;
}

export async function runPolicyTestsV1(
  policyId: string,
  versionId?: string,
): Promise<{ results: V1PolicyTestResult[]; passed: boolean }> {
  const qs = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
  return v1<{ results: V1PolicyTestResult[]; passed: boolean }>(
    `/api/v1/policies/${encodeURIComponent(policyId)}/tests${qs}`,
    { method: "GET" },
    activeToken,
  );
}

// ── app-workflows: gate the software people use, not just the doors ───────────

export type AppVertical = "healthcare" | "warehouse" | "industrial" | "global_fleet" | "retail" | "data_center" | "government";

export interface V1AppAction {
  key: string;
  label: string;
  riskTier: "standard" | "elevated" | "critical";
  sensitive: boolean;
  gatedByStepUp: boolean;
}
export interface V1AppIntegration {
  id: string;
  name: string;
  category: string;
  vertical: AppVertical;
  workflowKey: string;
  actions: V1AppAction[];
}
export interface V1AppActionPlan {
  key: string;
  label: string;
  riskTier: "standard" | "elevated" | "critical";
  sensitive: boolean;
  disposition: "auto" | "assist" | "step_up" | "blocked" | "applied";
  requiresConfirmation: boolean;
  reason: string;
}
export interface V1AppSessionPlan {
  integrationId: string;
  integrationName: string;
  outcome: V1Outcome;
  mode: "proceed" | "assist" | "step_up" | "hold" | "deny";
  summary: string;
  actions: V1AppActionPlan[];
}

async function v1<T>(path: string, init: RequestInit, token: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try { const b = await res.json(); detail = b.detail || b.message || b.title || detail; } catch { /* */ }
    throw new Error(`${path} — ${detail}`);
  }
  return (await res.json()) as T;
}

export async function listAppWorkflowIntegrations(): Promise<V1AppIntegration[]> {
  const json = await v1<{ integrations: V1AppIntegration[] }>(
    `/api/v1/app-workflows/integrations`,
    { method: "GET" },
    activeToken,
  );
  return json.integrations;
}

export async function evaluateAppWorkflow(req: {
  integrationId: string;
  identityRef: string;
  deviceRef: string;
  token: string;
}): Promise<{ decision: V1Decision; plan: V1AppSessionPlan }> {
  return v1<{ decision: V1Decision; plan: V1AppSessionPlan }>(
    `/api/v1/app-workflows/evaluate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ integrationId: req.integrationId, identityRef: req.identityRef, deviceRef: req.deviceRef }),
    },
    req.token,
  );
}
