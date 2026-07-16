import { Router, type IRouter, type Request, type Response } from "express";
import { CoreError, type EvaluateRequest } from "@workspace/signalgrid-core";
import { listAppIntegrations, findAppIntegration, planAppSession } from "@workspace/app-workflows";
import { core, DEMO_KEYS } from "../lib/core";
import { requireTenantContext } from "../middlewares/context";
import { v1RateLimiter } from "../middlewares/rateLimit";

/**
 * /v1 — the product-shaped SignalGrid surface.
 *
 * Every route is tenant-scoped: the tenant is derived from the authenticated
 * bearer token, never from a client-supplied id, so cross-tenant access is
 * structurally impossible. All data is the deterministic public-safe demo seed.
 */
const router: IRouter = Router();

// Public discovery route (no auth) so reviewers can find the demo keys.
router.get("/v1/keys", (req: Request, res: Response) => {
  res.json(
    envelope(req, {
      note: "Public-safe demo keys only. These are not real credentials.",
      keys: DEMO_KEYS,
    }),
  );
});

// Everything below requires a tenant context and is rate-limited.
router.use("/v1", v1RateLimiter, requireTenantContext);

router.get("/v1/context", (req: Request, res: Response) => {
  const { principal, tenant } = core.context(token(req));
  res.json(envelope(req, { principal, tenant }));
});

router.post("/v1/decisions/evaluate", (req: Request, res: Response) => {
  const body = parseEvaluate(req.body);
  const result = core.evaluate(token(req), body);
  res.json(envelope(req, { decision: result }));
});

router.get("/v1/decisions", (req: Request, res: Response) => {
  const decisions = core.listDecisions(token(req));
  res.json(envelope(req, { decisions, total: decisions.length }));
});

router.get("/v1/decisions/:id", (req: Request, res: Response) => {
  const decision = core.getDecision(token(req), param(req, "id"));
  res.json(envelope(req, { decision }));
});

router.get("/v1/decisions/:id/evidence", (req: Request, res: Response) => {
  const decision = core.getDecision(token(req), param(req, "id"));
  const evidence = core.getSnapshot(token(req), decision.evidenceSnapshotId);
  const verified = core.verifyEvidence(token(req), evidence.id);
  res.json(envelope(req, { evidence, verified }));
});

router.post("/v1/decisions/:id/simulate", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const policyVersionId = body["policyVersionId"];
  if (typeof policyVersionId !== "string") {
    throw new CoreError("validation", "policyVersionId is required.", 400);
  }
  const simulation = core.simulateDecision(
    token(req),
    param(req, "id"),
    policyVersionId,
  );
  res.json(envelope(req, { simulation }));
});

router.get("/v1/metrics", (req: Request, res: Response) => {
  const metrics = core.metrics(token(req));
  res.json(envelope(req, { metrics }));
});

router.get("/v1/decisions/:id/resolution", (req: Request, res: Response) => {
  const resolution = core.getResolution(token(req), param(req, "id"));
  res.json(envelope(req, { resolution }));
});

router.post("/v1/decisions/:id/resolve", (req: Request, res: Response) => {
  const simulation = core.simulateResolution(token(req), param(req, "id"));
  res.json(envelope(req, { simulation }));
});

router.get("/v1/policies", (req: Request, res: Response) => {
  const policies = core.listPolicies(token(req));
  res.json(envelope(req, { policies }));
});

router.get("/v1/policies/:id/versions", (req: Request, res: Response) => {
  const versions = core.listPolicyVersions(token(req), param(req, "id"));
  res.json(envelope(req, { versions }));
});

router.post("/v1/policies/:id/versions", (req: Request, res: Response) => {
  // The core fully validates the untrusted rule set (structure, field domains,
  // count/depth caps) and rejects malformed input with a 400, so a bad rule can
  // never be persisted and can never crash a later evaluation.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const version = core.createPolicyDraft(token(req), param(req, "id"), body["rules"]);
  res.status(201).json(envelope(req, { version }));
});

router.post(
  "/v1/policies/:id/versions/:versionId/activate",
  (req: Request, res: Response) => {
    const policy = core.activatePolicyVersion(
      token(req),
      param(req, "id"),
      param(req, "versionId"),
    );
    res.json(envelope(req, { policy }));
  },
);

router.get("/v1/policies/:id/tests", (req: Request, res: Response) => {
  const versionId =
    typeof req.query["versionId"] === "string"
      ? req.query["versionId"]
      : undefined;
  const results = core.runPolicyTests(token(req), param(req, "id"), versionId);
  const passed = results.every((r) => r.passed);
  res.json(envelope(req, { results, passed }));
});

router.get("/v1/connectors", (req: Request, res: Response) => {
  const connectors = core.listConnectors(token(req));
  res.json(envelope(req, { connectors }));
});

router.get("/v1/connectors/:id/sync-runs", (req: Request, res: Response) => {
  const runs = core.listSyncRuns(token(req), param(req, "id"));
  res.json(envelope(req, { syncRuns: runs }));
});

router.post("/v1/connectors/:id/sync", (req: Request, res: Response) => {
  const run = core.syncConnector(token(req), param(req, "id"));
  res.json(envelope(req, { syncRun: run }));
});

router.get("/v1/audit", (req: Request, res: Response) => {
  const events = core.listAudit(token(req));
  const chain = core.verifyAudit(token(req));
  res.json(envelope(req, { events, chain }));
});

router.get("/v1/webhooks", (req: Request, res: Response) => {
  const endpoints = core.listWebhookEndpoints(token(req));
  res.json(envelope(req, { endpoints }));
});

router.get("/v1/webhooks/deliveries", (req: Request, res: Response) => {
  const deliveries = core.listWebhookDeliveries(token(req));
  res.json(envelope(req, { deliveries }));
});

router.get("/v1/remediation", (req: Request, res: Response) => {
  const actions = core.listRemediations(token(req));
  res.json(envelope(req, { actions }));
});

router.post("/v1/remediation/:id/approve", (req: Request, res: Response) => {
  const action = core.approveRemediation(token(req), param(req, "id"));
  res.json(envelope(req, { action }));
});

// ── App-workflow gating: the surface an integrated app calls to gate its own
// actions. Discovery lists the catalog; evaluate runs the REAL decision core for
// the actor + device, then returns which of the app's actions may run
// automatically vs. which must be human-confirmed (the Assist model). ──────────
router.get("/v1/app-workflows/integrations", (req: Request, res: Response) => {
  const vertical = typeof req.query.vertical === "string" ? req.query.vertical : undefined;
  const integrations = listAppIntegrations(vertical as never);
  res.json(envelope(req, { integrations, total: integrations.length }));
});

router.post("/v1/app-workflows/evaluate", (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const integrationId = body["integrationId"];
  if (typeof integrationId !== "string") {
    throw new CoreError("validation", "integrationId is required.", 400);
  }
  const integration = findAppIntegration(integrationId);
  if (!integration) {
    throw new CoreError("not_found", `Unknown app integration '${integrationId}'.`, 404);
  }
  // The app's session maps to the integration's decision-core workflow.
  const evalReq = parseEvaluate({ ...body, workflowKey: integration.workflowKey });
  const decision = core.evaluate(token(req), evalReq);
  const confirmedActionKeys = Array.isArray(body["confirmedActionKeys"])
    ? (body["confirmedActionKeys"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  const stepUpSatisfied = body["stepUpSatisfied"] === true;
  const plan = planAppSession({
    integration,
    outcome: decision.outcome,
    reasonCodes: decision.reasonCodes,
    confirmedActionKeys,
    stepUpSatisfied,
  });
  res.json(envelope(req, { decision, plan }));
});

export default router;

function token(req: Request): string {
  // requireTenantContext guarantees this is set.
  return req.bearerToken as string;
}

/** Read a route parameter as a single string (Express 5 params may be arrays). */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[]>)[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function parseEvaluate(body: unknown): EvaluateRequest {
  if (!body || typeof body !== "object") {
    throw new CoreError("validation", "Request body must be a JSON object.", 400);
  }
  const record = body as Record<string, unknown>;
  const identityRef = record["identityRef"];
  const deviceRef = record["deviceRef"];
  const workflowKey = record["workflowKey"];
  if (
    typeof identityRef !== "string" ||
    typeof deviceRef !== "string" ||
    typeof workflowKey !== "string"
  ) {
    throw new CoreError(
      "validation",
      "identityRef, deviceRef, and workflowKey are required strings.",
      400,
    );
  }
  const requestContext =
    record["requestContext"] && typeof record["requestContext"] === "object"
      ? sanitizeContext(record["requestContext"] as Record<string, unknown>)
      : undefined;
  return { identityRef, deviceRef, workflowKey, requestContext };
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Linear, length-bounded key pattern (no nested quantifiers → no ReDoS).
const CONTEXT_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const MAX_CONTEXT_ENTRIES = 32;

function sanitizeContext(
  input: Record<string, unknown>,
): Record<string, string> {
  // Validate each client-provided key against a strict allowlist pattern and a
  // forbidden set, then build the object from validated entries. No dynamic
  // `obj[userKey] = …` write happens on our side, so a client-controlled
  // property name cannot inject onto or pollute the result object.
  const entries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (entries.length >= MAX_CONTEXT_ENTRIES) {
      break;
    }
    if (typeof value !== "string") {
      continue;
    }
    if (FORBIDDEN_KEYS.has(key) || !CONTEXT_KEY.test(key)) {
      continue;
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function envelope<T extends object>(req: Request, data: T) {
  return {
    requestId: req.requestId ?? null,
    timestamp: new Date().toISOString(),
    ...data,
  };
}
