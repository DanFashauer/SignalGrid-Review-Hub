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
      authorization: `Bearer ${DEMO_OPERATOR_TOKEN}`,
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

// ── app-workflows: gate the software people use, not just the doors ───────────

export type AppVertical = "healthcare" | "warehouse" | "industrial" | "global_fleet" | "retail";

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
    DEMO_OPERATOR_TOKEN,
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
