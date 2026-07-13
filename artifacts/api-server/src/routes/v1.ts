import { Router, type IRouter, type Request, type Response } from "express";
import { CoreError, type EvaluateRequest } from "@workspace/signalgrid-core";
import { core, DEMO_KEYS } from "../lib/core";
import { requireTenantContext } from "../middlewares/context";
import { rateLimit } from "../middlewares/rateLimit";

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
router.use("/v1", rateLimit(240, 60_000), requireTenantContext);

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

router.get("/v1/policies", (req: Request, res: Response) => {
  const policies = core.listPolicies(token(req));
  res.json(envelope(req, { policies }));
});

router.get("/v1/policies/:id/versions", (req: Request, res: Response) => {
  const versions = core.listPolicyVersions(token(req), param(req, "id"));
  res.json(envelope(req, { versions }));
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

function sanitizeContext(
  input: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      out[key] = value;
    }
  }
  return out;
}

function envelope<T extends object>(req: Request, data: T) {
  return {
    requestId: req.requestId ?? null,
    timestamp: new Date().toISOString(),
    ...data,
  };
}
