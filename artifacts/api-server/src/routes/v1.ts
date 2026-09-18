import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CoreError,
  authorize,
  reconcileDecisions,
  verifySnapshot,
  type EvaluateRequest,
  type EvaluateResult,
  type ReconcilableDecision,
  type StandingBound,
} from "@workspace/signalgrid-core";
import { getDecisionStore, getSessionStore, type Session } from "@workspace/persistence";
import { appendAuditRecord, getAuditBackend, getAuditRecordsForTenant, verifyLedger, type Target as AuditTarget } from "@workspace/audit";
import { listAppIntegrations, findAppIntegration, planAppSession } from "@workspace/app-workflows";
import { webauthn, webauthnStore } from "@workspace/webauthn";
import { core, DEMO_KEYS } from "../lib/core";
import { decisionsTotal, auditEventsTotal } from "../lib/metrics";
import { requireTenantContext } from "../middlewares/context";
import { v1RateLimiter } from "../middlewares/rateLimit";
import { idempotencyReplay } from "../middlewares/idempotency";
import { demoSurfacesEnabled } from "../lib/profile";
import { resolveAssurancePosture } from "../lib/assurance";

/**
 * /v1 — the product-shaped SignalGrid surface.
 *
 * Every route is tenant-scoped: the tenant is derived from the authenticated
 * bearer token, never from a client-supplied id, so cross-tenant access is
 * structurally impossible. All data is the deterministic public-safe demo seed.
 */
const router: IRouter = Router();

// Public discovery route (no auth) so reviewers can find the demo keys.
//
// It sits ABOVE the auth guard on line 32 — Express matches in registration order, so
// `requireTenantContext` never runs for it — and `DEMO_KEYS` carries the RAW bearer.
// Under the review-demo profile that is the point: a reviewer needs a way in. Under
// any other profile it publishes an owner token for every seeded tenant to anonymous
// callers, so the route is not registered at all.
if (demoSurfacesEnabled()) {
router.get("/v1/keys", (req: Request, res: Response) => {
  res.json(
    envelope(req, {
      note: "Public-safe demo keys only. These are not real credentials.",
      keys: DEMO_KEYS,
    }),
  );
});
}

// Everything below requires a tenant context and is rate-limited. Idempotency
// replay sits AFTER the tenant guard on purpose: the replay key is scoped by
// the authenticated bearer, so an anonymous caller can neither seed nor read
// the replay cache.
router.use("/v1", v1RateLimiter, requireTenantContext, idempotencyReplay);

// `assurance` is derived on every call rather than cached: a deployment that is
// promoted, or has live integrations switched on, must not keep reporting the
// posture it booted with. `req.app` is handed over because `stepUpAnswerable`
// derives from the routes THIS process mounted — the live router stack, not a
// list of paths written down somewhere.
router.get("/v1/context", (req: Request, res: Response) => {
  const { principal, tenant } = core.context(token(req));
  res.json(envelope(req, { principal, tenant, assurance: resolveAssurancePosture(req.app) }));
});

// The decision core stays pure/in-memory; when a durable store is configured
// (DATABASE_URL set) each decision + its evidence snapshot is ALSO persisted, and
// the read paths serve from the database so records survive a restart. With no
// durable store the behavior is exactly as before (fixture-safe default).
router.post("/v1/decisions/evaluate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parseEvaluate(req.body);
    const result = core.evaluate(token(req), body);
    decisionsTotal.inc({ outcome: result.outcome });
    const store = getDecisionStore();
    if (store) {
      // Persist the full decision + snapshot the core just produced.
      const decision = core.getDecision(token(req), result.decisionId);
      const snapshot = core.getSnapshot(token(req), decision.evidenceSnapshotId);
      await store.saveDecision(decision, snapshot);
    }
    await audit(req, "decision.evaluated", body.identityRef, { type: "decision", id: result.decisionId },
      { outcome: result.outcome, policyVersionId: result.policyVersionId, workflowKey: body.workflowKey, deviceRef: body.deviceRef });
    res.json(envelope(req, { decision: result }));
  } catch (err) {
    next(err);
  }
});

/**
 * The Assist wire — the envelope the Kotlin and Rust host-app SDKs bind.
 *
 * DR-007 declared this route a gap because building it "would widen the FROZEN
 * launch surface." DR-021 lifted that freeze, and DR-023 closes the gap: the route
 * is now served. It is the SAME decision as /v1/decisions/evaluate — same request
 * body, same core.evaluate, same persisted record, same decisionId — presented in
 * the shape a frontline host app consumes: `{assist, reasons, decisionId}`.
 *
 * WHY A SECOND ROUTE AND NOT A SECOND FIELD. A host app on a shared device obeys
 * ONE word — allow / step_up / restrict / deny — and must fail closed on anything
 * else. The 42 shared conformance vectors (native/shared/assist-wire-conformance.json)
 * bind exactly that contract: top-level `assist`, the four-word vocabulary, unknown
 * fields tolerated, any non-2xx read as deny. EvaluateResult carries policy ids,
 * matched rules and an evidence reference a host app never needs and must not
 * have to parse to stay safe. Two envelopes over one decision keeps the console's
 * explainability surface and the host app's minimal obedience surface from
 * dragging each other.
 *
 * `assist` IS `outcome`: DecisionOutcome and the Assist vocabulary are the same four
 * strings by construction (lib/signalgrid-core/src/types.ts), so no mapping table
 * can drift. `reasons` is the engine's reasonCodes verbatim. The standard envelope
 * fields (requestId, timestamp) ride along at top level; the vectors prove every
 * client tolerates unknown top-level fields.
 */
router.post("/v1/authorize", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parseEvaluate(req.body);
    const result = core.evaluate(token(req), body);
    decisionsTotal.inc({ outcome: result.outcome });
    const store = getDecisionStore();
    if (store) {
      const decision = core.getDecision(token(req), result.decisionId);
      const snapshot = core.getSnapshot(token(req), decision.evidenceSnapshotId);
      await store.saveDecision(decision, snapshot);
    }
    await audit(req, "decision.evaluated", body.identityRef, { type: "decision", id: result.decisionId },
      { outcome: result.outcome, policyVersionId: result.policyVersionId, workflowKey: body.workflowKey, deviceRef: body.deviceRef });
    res.json(
      envelope(req, {
        assist: result.outcome,
        decisionId: result.decisionId,
        reasons: result.reasonCodes,
      }),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/v1/decisions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = getDecisionStore();
    if (store) {
      // authorizedContext, NOT context: context() only AUTHENTICATES. This branch
      // returns without ever reaching core.listDecisions/getDecision/getSnapshot, each
      // of which authorizes "decision:read" — so the permission was enforced in memory
      // and skipped on the durable path. See SignalGridCore.authorizedContext.
      const tenantId = core.authorizedContext(token(req), "decision:read").tenant.id;
      // `total` is the tenant's REAL count, not the page length: listDecisions
      // returns at most 100, and `total: decisions.length` reported 100 for a
      // tenant with 5,000 while the in-memory branch below reported 5,000 — the
      // two branches this comment block claims are equivalent were not.
      const [decisions, total] = await Promise.all([store.listDecisions(tenantId), store.countDecisions(tenantId)]);
      res.json(envelope(req, { decisions, total }));
      return;
    }
    const decisions = core.listDecisions(token(req));
    res.json(envelope(req, { decisions, total: decisions.length }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/decisions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = getDecisionStore();
    if (store) {
      // authorizedContext, NOT context: context() only AUTHENTICATES. This branch
      // returns without ever reaching core.listDecisions/getDecision/getSnapshot, each
      // of which authorizes "decision:read" — so the permission was enforced in memory
      // and skipped on the durable path. See SignalGridCore.authorizedContext.
      const tenantId = core.authorizedContext(token(req), "decision:read").tenant.id;
      // getDecision is keyed on (id, tenant_id): a cross-tenant id returns null,
      // which we surface as the same 404 the in-memory path throws.
      const decision = await store.getDecision(tenantId, param(req, "id"));
      if (!decision) throw new CoreError("not_found", `Decision "${param(req, "id")}" not found.`, 404);
      // The step-up answer lives in the core beside the decision; the durable store
      // holds decisions and evidence only. Absent means UNANSWERED, which is what a
      // host app must treat an unresolvable step_up as.
      res.json(envelope(req, { decision, stepUp: core.getStepUpAnswer(token(req), param(req, "id")) ?? null }));
      return;
    }
    const decision = core.getDecision(token(req), param(req, "id"));
    res.json(envelope(req, { decision, stepUp: core.getStepUpAnswer(token(req), param(req, "id")) ?? null }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/decisions/:id/evidence", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = getDecisionStore();
    if (store) {
      // authorizedContext, NOT context: context() only AUTHENTICATES. This branch
      // returns without ever reaching core.listDecisions/getDecision/getSnapshot, each
      // of which authorizes "decision:read" — so the permission was enforced in memory
      // and skipped on the durable path. See SignalGridCore.authorizedContext.
      const tenantId = core.authorizedContext(token(req), "decision:read").tenant.id;
      const decision = await store.getDecision(tenantId, param(req, "id"));
      if (!decision) throw new CoreError("not_found", `Decision "${param(req, "id")}" not found.`, 404);
      const evidence = await store.getSnapshot(tenantId, decision.evidenceSnapshotId);
      if (!evidence) throw new CoreError("not_found", `Evidence snapshot "${decision.evidenceSnapshotId}" not found.`, 404);
      // verifySnapshot recomputes the content digest — tamper-evidence works on
      // the durable record independently of any in-memory state.
      res.json(envelope(req, { evidence, verified: verifySnapshot(evidence) }));
      return;
    }
    const decision = core.getDecision(token(req), param(req, "id"));
    const evidence = core.getSnapshot(token(req), decision.evidenceSnapshotId);
    const verified = core.verifyEvidence(token(req), evidence.id);
    res.json(envelope(req, { evidence, verified }));
  } catch (err) {
    next(err);
  }
});

/**
 * Reconcile decisions that were made on both sides of a network partition.
 *
 * A frontline device that keeps working offline keeps DECIDING offline, so on
 * reconnect two answers exist for one subject and action. `reconcileDecisions`
 * (`lib/signalgrid-core/src/continuity.ts`) says which one stands; this is its wire arm.
 *
 * THE ROUTE STORES NOTHING AND READS NOTHING. Every record is caller-supplied and the
 * reduction is pure, so there is no decision id to mint, no evidence snapshot, and
 * nothing to persist. That is deliberate: the reconciler answers a question about
 * records the caller already holds, and minting a new decision here would create a
 * record with no evidence behind it.
 *
 * WHAT THIS PARSER DELIBERATELY DOES NOT DO: fill anything in. `evaluatedOffline` and
 * `policyKnownSuperseded` are passed through exactly as sent, absent included, so the
 * library's refusal is what the caller meets. A `?? false` here would be the MCP
 * adapter's defect at a different layer — an omitted field buying the record the right
 * to relax — and it would be invisible from the wire, because a defaulted request and
 * an honest one produce the same 200.
 *
 * ALL THREE OF THIS LAYER'S LAWS WERE MEASURED, not assumed. Each mutation below was
 * applied here, run through `pnpm --filter @workspace/api-server run test:api`, and
 * reverted; each killed exactly the assertions that name it, and nothing else:
 *
 *   227/227  baseline
 *   225/227  the parser completes the two provenance booleans with `?? false`
 *            (kills both "an omitted X is a 400, not an <affirmative>" assertions)
 *   226/227  the record cap truncates instead of refusing
 *   226/227  a posed standingBound with no stated ages becomes an ABSENT bound
 *            rather than an empty map
 *
 * That matters because all three are the kind of change a later reader makes while
 * tidying — completing a field looks like politeness, truncating looks like robustness,
 * and treating an empty map as "nothing posed" looks like simplification. Each is a
 * one-directional loss, and the suite now says so out loud.
 */
router.post("/v1/decisions/reconcile", (req: Request, res: Response) => {
  const { records, standingBound } = parseReconcile(req.body);
  const result = reconcileDecisions(records, standingBound ? { standingBound } : {});
  res.json(envelope(req, { reconciliation: result }));
});

// ── Sessions: durable start / refresh / end lifecycle ────────────────────────
// A session is gated by a real decision at start, then kept alive by refreshes
// until it ends or its TTL lapses. Sessions persist in-memory by default and to
// Postgres when DATABASE_URL is set, so they survive a restart in production.
router.post("/v1/sessions/start", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parseEvaluate(req.body);
    const result = core.evaluate(token(req), body);
    decisionsTotal.inc({ outcome: result.outcome });
    const startCtx = core.context(token(req));
    // A session is a durable write in the caller's tenant; evaluate alone must
    // not imply it. session:* closed the gate's last exemption — see
    // scripts/check-durable-path-authorization.mjs.
    authorize(startCtx.principal, "session:write");
    const tenantId = startCtx.tenant.id;
    const ttlSeconds = clampTtl((req.body as Record<string, unknown>)?.["ttlSeconds"]);
    const now = Date.now();
    const session: Session = {
      id: `sess_${randomUUID()}`,
      tenantId,
      identityRef: body.identityRef,
      deviceRef: body.deviceRef,
      workflowKey: body.workflowKey,
      status: "active",
      outcome: result.outcome,
      decisionId: result.decisionId,
      createdAt: new Date(now).toISOString(),
      lastSeenAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    };
    await getSessionStore().start(session);
    await audit(req, "session.start", startCtx.principal.subjectId, { type: "session", id: session.id },
      { workflowKey: body.workflowKey, deviceRef: body.deviceRef, outcome: result.outcome });
    res.json(envelope(req, { session, decision: result }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const readCtx = core.context(token(req));
    authorize(readCtx.principal, "session:read");
    const tenantId = readCtx.tenant.id;
    const session = await getSessionStore().get(tenantId, param(req, "id"), Date.now());
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found.`, 404);
    res.json(envelope(req, { session }));
  } catch (err) {
    next(err);
  }
});

router.post("/v1/sessions/:id/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshCtx = core.context(token(req));
    authorize(refreshCtx.principal, "session:write");
    const tenantId = refreshCtx.tenant.id;
    const ttlSeconds = clampTtl((req.body as Record<string, unknown>)?.["ttlSeconds"]);
    const session = await getSessionStore().refresh(tenantId, param(req, "id"), ttlSeconds, Date.now());
    // null covers unknown, another tenant's, EXPIRED and ENDED alike: none of those
    // can be extended, and the audit row below must only ever record a refresh that
    // happened.
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found or no longer active.`, 404);
    await audit(req, "session.refresh", refreshCtx.principal.subjectId, { type: "session", id: session.id },
      { ttlSeconds });
    res.json(envelope(req, { session }));
  } catch (err) {
    next(err);
  }
});

router.post("/v1/sessions/:id/end", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const endCtx = core.context(token(req));
    authorize(endCtx.principal, "session:write");
    const tenantId = endCtx.tenant.id;
    const session = await getSessionStore().end(tenantId, param(req, "id"));
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found.`, 404);
    await audit(req, "session.end", endCtx.principal.subjectId, { type: "session", id: session.id });
    res.json(envelope(req, { session }));
  } catch (err) {
    next(err);
  }
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

router.post("/v1/policies/:id/versions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The core fully validates the untrusted rule set (structure, field domains,
    // count/depth caps) and rejects malformed input with a 400, so a bad rule can
    // never be persisted and can never crash a later evaluation.
    const body = (req.body ?? {}) as Record<string, unknown>;
    const version = core.createPolicyDraft(token(req), param(req, "id"), body["rules"]);
    await audit(req, "policy.draft.created", core.context(token(req)).principal.subjectId,
      { type: "policy", id: param(req, "id") }, { versionId: version.id });
    res.status(201).json(envelope(req, { version }));
  } catch (err) {
    next(err);
  }
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

router.post("/v1/connectors/:id/sync", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = core.syncConnector(token(req), param(req, "id"));
    await audit(req, "connector.sync.triggered", core.context(token(req)).principal.subjectId,
      { type: "connector", id: param(req, "id") }, { syncRunId: run.id, status: run.status });
    res.json(envelope(req, { syncRun: run }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/audit", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Durable (Postgres, the /readyz predicate): the tenant's rows + the whole chain's verdict — DR-025 / listAudit in v1-openapi.yaml.
    if (typeof getAuditBackend().ping === "function") {
      const tenantId = core.authorizedContext(token(req), "audit:read").tenant.id;
      // parseInt, as clampLimit does: "1.5" must never reach a bigint bind parameter
      const limit = Math.min(Math.max(Number.parseInt(String(req.query["limit"] ?? 200), 10) || 200, 1), 1000);
      const offset = Math.max(Number.parseInt(String(req.query["offset"] ?? 0), 10) || 0, 0);
      const events = await getAuditRecordsForTenant(tenantId, limit, offset);
      const chain = { ...(await verifyLedger()), scope: "global-ledger" as const };
      res.json(envelope(req, { events, chain, source: "durable" as const, limit, offset }));
      return;
    }
    const events = core.listAudit(token(req));
    const chain = core.verifyAudit(token(req));
    res.json(envelope(req, { events, chain, source: "memory" as const }));
  } catch (err) {
    next(err);
  }
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
  // The app's session maps to the integration's decision-core workflow. Return
  // the plan AS DECIDED — a `step_up` keeps its high-assurance actions held. This
  // route NEVER releases held actions on a request-supplied signal (a
  // `stepUpSatisfied` in the body is not read). The one release path is
  // POST /v1/app-workflows/complete-step-up below: a real WebAuthn assertion,
  // cryptographically verified against a credential enrolled for this tenant +
  // identity, with user-verification required.
  const evalReq = parseEvaluate({ ...body, workflowKey: integration.workflowKey });
  const decision = core.evaluate(token(req), evalReq);
  const plan = planAppSession({
    integration,
    outcome: decision.outcome,
    reasonCodes: decision.reasonCodes,
  });
  res.json(envelope(req, { decision, plan }));
});

// ── Step-up completion (real, user-verified WebAuthn) ──────────────────────────
// ("User-verified", not "hardware-backed": registration requests attestation "none",
// so no authenticator provenance reaches the server and a software authenticator is
// accepted. The claim is a verified UV assertion over a single-use, action-bound
// challenge — nothing more.)
//
// Releasing a held `step_up` action is a WebAuthn ceremony, never a request flag:
// enroll (registration) → challenge → native gesture signs it → cryptographic
// verify (`@workspace/webauthn`, user-verification REQUIRED) → only then is the
// plan re-cut with `stepUpSatisfied: true`. The flag is derived server-side from
// the verified assertion; nothing in the request body can set it. A failed or
// replayed assertion is a 403 with NO plan — fail closed.
//
// Credentials are stored under `<tenantId>:<identityRef>`, so a credential
// enrolled in one tenant can never satisfy a step-up in another.

function webauthnUserId(req: Request, identityRef: string): string {
  // Tenant from the authenticated token, never from the body — same invariant as
  // every other /v1 route.
  return `${webauthnTenantId(req)}:${identityRef}`;
}

/** The ceremony's tenant, from the authenticated token, passed EXPLICITLY into the
 *  lib's verify calls so no `security.webauthn.*` audit row lands untenanted. */
function webauthnTenantId(req: Request): string {
  return core.context(token(req)).tenant.id;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new CoreError("validation", `${key} is required.`, 400);
  }
  return v;
}

/** A WebAuthn ceremony payload (`response` / `assertion`) must be a JSON object.
 *  Validated HERE, by a helper that throws, for the same reason `requireString`
 *  is: the payload is caller-provided and the verify call it feeds is the sensitive
 *  action, so the check must reject-or-return, never sit as an inline condition
 *  that CodeQL (js/user-controlled-bypass) reads as a caller-controlled gate. */
function requireObject(body: Record<string, unknown>, key: string, what: string): object {
  const v = body[key];
  if (!v || typeof v !== "object") {
    throw new CoreError("validation", `${key} (${what}) is required.`, 400);
  }
  return v;
}

/** Enrollment AUTHORIZATION (adversarial-review + CodeQL finding): `identityRef`
 *  necessarily comes from the request in the shared-device model — tokens belong to
 *  consoles/operators, not to each frontline worker — so enrolling a credential FOR
 *  an identity is a privileged, attributable ceremony, not something any bearer may
 *  do. Only an `owner` or `operator` principal may enroll, and the enrolling
 *  principal is recorded in the response for attribution. An `auditor` (or any
 *  other role) is refused BEFORE any WebAuthn work happens. */
function requireEnrollmentPrincipal(req: Request): { subjectId: string } {
  const { principal } = core.context(token(req));
  if (principal.role !== "owner" && principal.role !== "operator") {
    throw new CoreError(
      "forbidden",
      "Enrolling a step-up credential is an operator/owner ceremony; this key's role cannot enroll identities.",
      403,
    );
  }
  requireOutOfBandEnrollmentAuthorization(req);
  return { subjectId: principal.subjectId };
}

/** Out-of-band enrollment authorization (review finding). The role gate above is not
 *  sufficient by itself on a demo core: the unauthenticated `/v1/keys` route PUBLISHES
 *  operator/owner demo tokens, so any visitor can satisfy the role check and the
 *  "privileged" ceremony is self-service. That is acceptable for the fixture demo — a
 *  completed step-up releases only simulated fixture plans, and the responses say so
 *  (see `demoEnrollmentNote`) — but it must not be inherited by a real deployment.
 *
 *  When `SIGNALGRID_ENROLLMENT_SECRET` is configured, enrollment additionally requires
 *  the `x-enrollment-authorization` header to carry that secret — an authorization this
 *  server does NOT publish. Read at request time (not module load) so both modes are
 *  testable; compared as SHA-256 digests so `timingSafeEqual` gets equal-length inputs
 *  and the comparison never throws or leaks length. Fail closed on absent or wrong. */
function requireOutOfBandEnrollmentAuthorization(req: Request): void {
  const secret = process.env.SIGNALGRID_ENROLLMENT_SECRET;
  if (!secret) return; // fixture demo: self-service by design, labeled honestly
  const presented = req.get("x-enrollment-authorization") ?? "";
  const a = createHash("sha256").update(presented, "utf8").digest();
  const b = createHash("sha256").update(secret, "utf8").digest();
  if (!timingSafeEqual(a, b)) {
    throw new CoreError(
      "forbidden",
      "Enrollment requires out-of-band authorization (x-enrollment-authorization header).",
      403,
    );
  }
}

/** Honest framing for the self-service demo ceremony: present exactly when the
 *  out-of-band secret is NOT configured, so a reader of the response knows the role
 *  gate is satisfiable with the published demo keys and that completion releases only
 *  simulated fixture plans. Absent (undefined) once a real deployment sets the secret. */
function demoEnrollmentNote(): string | undefined {
  if (process.env.SIGNALGRID_ENROLLMENT_SECRET) return undefined;
  return (
    "Self-service demo ceremony: the operator/owner role gate is satisfiable with the " +
    "demo keys published by the unauthenticated /v1/keys route, and a completed step-up " +
    "releases only simulated fixture plans. Real deployments set " +
    "SIGNALGRID_ENROLLMENT_SECRET to require out-of-band enrollment authorization."
  );
}

// 1) Enrollment options — mint a registration challenge for this identity.
//    Role-gated (see requireEnrollmentPrincipal). ONE challenge record: the lib
//    mints, persists, and returns the id — no second copy is saved here.
router.post("/v1/step-up/enroll/options", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const enrolledBy = requireEnrollmentPrincipal(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identityRef = requireString(body, "identityRef");
    const userId = webauthnUserId(req, identityRef);
    const options = await webauthn.generateRegistrationOptions(userId, identityRef, identityRef, {
      enrolledByRef: enrolledBy.subjectId,
    });
    const { challengeId, ...publicKey } = options;
    res.json(envelope(req, { challengeId, publicKey, demoNote: demoEnrollmentNote() }));
  } catch (err) {
    next(err);
  }
});

// 2) Enrollment verify — store the credential iff the attestation verifies.
//    Role-gated; the enrolling principal is attributed in the response.
router.post("/v1/step-up/enroll/verify", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const enrolledBy = requireEnrollmentPrincipal(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identityRef = requireString(body, "identityRef");
    const challengeId = requireString(body, "challengeId");
    const response = requireObject(body, "response", "WebAuthn registration");
    // Bind verification to the principal who MINTED the ceremony (review finding):
    // the registration challenge context records enrolledByRef at options time, and
    // the verifier must be the same principal. Without this, a second operator could
    // submit the first operator's challengeId + attestation and the enrollment would
    // be attributed to the wrong principal — a false audit trail on a privileged
    // ceremony. Checked against the STORED context before any WebAuthn work; the
    // challenge is left unconsumed on mismatch.
    const storedReg = await webauthnStore.getChallengeContext(challengeId);
    if (!storedReg || !storedReg.context) {
      throw new CoreError("forbidden", "Unknown or expired enrollment challenge.", 403);
    }
    if (storedReg.context.enrolledByRef !== enrolledBy.subjectId) {
      throw new CoreError(
        "forbidden",
        "This enrollment ceremony was started by a different principal; the same operator/owner must complete it.",
        403,
      );
    }
    const userId = webauthnUserId(req, identityRef);
    const result = await webauthn.verifyRegistration(userId, challengeId, response as never, webauthnTenantId(req));
    if (!result.success) {
      throw new CoreError("forbidden", `Enrollment rejected: ${result.error ?? "verification failed"}.`, 403);
    }
    // `enrolled` is true only when a credential was STORED by this ceremony. A
    // re-enrollment of an id already on file verifies and stores nothing (no
    // silent key swap) — reported as alreadyEnrolled, never as a fresh enrollment.
    res.json(envelope(req, { enrolled: result.alreadyEnrolled !== true, alreadyEnrolled: result.alreadyEnrolled === true, credentialId: result.credentialId, enrolledByRef: storedReg.context.enrolledByRef, demoNote: demoEnrollmentNote() }));
  } catch (err) {
    next(err);
  }
});

// 3) Authentication challenge for a pending step-up. The challenge is BOUND to the
//    exact pending action at mint time (tenant + identity + integration + device +
//    the SELECTED ACTION KEY), and the completion route verifies that binding — so a
//    gesture signed for one pending action can never release a different one, and can
//    never release the integration's OTHER gated actions either (adversarial-review +
//    CodeQL + Codex findings). ONE challenge record: minted, persisted, id-returned.
router.post("/v1/step-up/challenge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Authorize BEFORE anything is minted or probed. Minting a step-up challenge is
    // part of the action-release flow, so it requires `decision:evaluate` — the same
    // permission complete-step-up ultimately enforces via core.evaluate. Without this
    // the endpoint authenticated only, letting a read-only `auditor` or a low-trust
    // `connector` (neither holds decision:evaluate) learn via 409-vs-200 whether an
    // identity has an enrolled credential — an authorization asymmetry with nothing
    // asserting the endpoint should refuse it. (ECC-role review, tdd-guide, 2026-09-01.)
    const stepUpCtx = core.context(token(req));
    authorize(stepUpCtx.principal, "decision:evaluate");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identityRef = requireString(body, "identityRef");
    const integrationId = requireString(body, "integrationId");
    const deviceRef = requireString(body, "deviceRef");
    const actionKey = requireString(body, "actionKey");
    const integration = findAppIntegration(integrationId);
    if (!integration) {
      throw new CoreError("not_found", `Unknown app integration '${integrationId}'.`, 404);
    }
    // The challenge names ONE concrete action of this integration. An unknown key has
    // nothing to bind to, so nothing is minted (fail closed).
    const action = integration.actions.find((a) => a.key === actionKey);
    if (!action) {
      throw new CoreError("not_found", `Unknown action '${actionKey}' for integration '${integrationId}'.`, 404);
    }
    // ...and it must be an action the planner can actually HOLD. planAppSession holds
    // only `gatedByStepUp || sensitive` actions; anything else stays `auto` even under a
    // step_up decision. Minting a challenge for such an action produced a verification
    // record asserting `released: true` for something that was never withheld — a step-up
    // ceremony that proves nothing, recorded as though it authorized access (review
    // finding). The record is the audit artifact, so a false release claim is the defect
    // even though no extra access is granted. Fail closed rather than mint a no-op.
    if (!action.gatedByStepUp && !action.sensitive) {
      throw new CoreError(
        "validation",
        `Action '${actionKey}' is not held pending step-up, so a step-up challenge for it would release nothing. Request the action directly.`,
        400,
      );
    }
    const userId = webauthnUserId(req, identityRef);
    // Fail closed: no enrolled credential ⇒ no challenge ⇒ nothing to sign. The
    // caller must enroll first; we never fall back to a weaker completion path.
    const enrolled = await webauthnStore.hasWebAuthnCredentials(userId);
    if (!enrolled) {
      throw new CoreError("forbidden", "No enrolled step-up credential for this identity. Enroll first.", 409);
    }
    const options = await webauthn.generateAuthenticationOptions(userId, {
      tenantId: stepUpCtx.tenant.id,
      identityRef,
      integrationId,
      deviceRef,
      actionKey,
    });
    const { challengeId, ...publicKey } = options;
    res.json(envelope(req, { challengeId, publicKey }));
  } catch (err) {
    next(err);
  }
});

// 4) Complete: verify the signed assertion, then — and only then — re-cut the
//    plan with the step-up satisfied.
router.post("/v1/app-workflows/complete-step-up", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const integrationId = requireString(body, "integrationId");
    const identityRef = requireString(body, "identityRef");
    const challengeId = requireString(body, "challengeId");
    const assertion = requireObject(body, "assertion", "WebAuthn authentication");
    const integration = findAppIntegration(integrationId);
    if (!integration) {
      throw new CoreError("not_found", `Unknown app integration '${integrationId}'.`, 404);
    }

    // THE BINDING GATE, checked BEFORE any cryptography: the challenge carries the
    // server-persisted context it was minted for, and this request must match it
    // exactly. The guarded values (tenant, identity, integration, device) come from
    // the STORED record — the caller's body is only compared against it, never
    // trusted. A gesture signed for one pending action can therefore never release
    // a different identity's, integration's, or device's action. Mismatch is a 403
    // with the challenge left unconsumed and the verify path never reached.
    const stored = await webauthnStore.getChallengeContext(challengeId);
    if (!stored || !stored.context) {
      throw new CoreError("forbidden", "Unknown or expired step-up challenge.", 403);
    }
    const ctx = stored.context;
    const tenantId = core.context(token(req)).tenant.id;
    const deviceRef = requireString(body, "deviceRef");
    const actionKey = requireString(body, "actionKey");
    if (
      ctx.tenantId !== tenantId ||
      ctx.identityRef !== identityRef ||
      ctx.integrationId !== integrationId ||
      ctx.deviceRef !== deviceRef ||
      ctx.actionKey !== actionKey
    ) {
      throw new CoreError(
        "forbidden",
        "This step-up challenge was minted for a different action; request a new challenge for this one.",
        403,
      );
    }

    // The cryptographic gate. Single-use challenge (fetched-and-deleted by the
    // lib), purpose- and user-bound, signature verified against the enrolled
    // public key, user-verification flag REQUIRED. Any failure is a 403 with no
    // plan attached. The userId is derived from the STORED binding, so the
    // verification target is the identity the challenge was minted for.
    const userId = webauthnUserId(req, ctx.identityRef);
    const verification = await webauthn.verifyAuthentication(userId, challengeId, assertion as never, tenantId);
    if (!verification.success) {
      throw new CoreError("forbidden", `Step-up assertion rejected: ${verification.error ?? "verification failed"}.`, 403);
    }

    // Re-evaluate the decision fresh — the release applies to the CURRENT
    // posture, not the one from when the step-up was requested. If posture has
    // degraded past step_up (restrict/deny), the verified gesture releases
    // nothing: planAppSession only honors stepUpSatisfied when the outcome is
    // step_up, so a valid assertion can never upgrade a restrict or deny.
    const evalReq = parseEvaluate({ ...body, workflowKey: integration.workflowKey });
    const decision = core.evaluate(token(req), evalReq);
    const released = decision.outcome === "step_up";
    // SCOPED release (review finding): the gesture releases ONLY the action the
    // challenge was minted for — taken from the STORED binding, never the caller's
    // body — so one verified gesture cannot release the integration's other gated
    // actions. The plan honestly stays in step_up mode when other actions remain held.
    const plan = planAppSession({
      integration,
      outcome: decision.outcome,
      reasonCodes: decision.reasonCodes,
      stepUpSatisfiedActionKeys: released ? [ctx.actionKey] : [],
    });
    res.json(
      envelope(req, {
        decision,
        plan,
        stepUp: {
          released,
          actionKey: ctx.actionKey,
          method: "webauthn",
          credentialId: verification.credentialId,
          verifiedAt: verification.timestamp,
        },
      }),
    );
  } catch (err) {
    next(err);
  }
});

// ── WHAT THIS PROCESS ACTUALLY DOES, PER SIGNAL FAMILY ───────────────────────
//
// Blocker 10 is "mixed autonomy claims": nothing states, per deployment, whether
// behaviour is ENFORCED, merely OBSERVED, or SIMULATED. The labels existed only in
// `scripts/launch-profile.mjs` — a governance file — so an operator could read what
// the product INTENDS and never ask the running server what it is doing. That was
// the `runtime-launch-status` gap.
//
// EVERY FIELD IS DERIVED FROM THE CONNECTORS THE CORE HOLDS. Not one is configured.
// `SIGNALGRID_LIVE_INTEGRATIONS` already caused this exact defect once — it PERMITS
// live calls, and /v1/context once read it as "signals are live" while every verdict
// came from fixture records. A status route that could be told what to say would be
// worse than none, because it would be believed.
//
// THE THREE LABELS, and what each one is allowed to mean here:
//
//   "simulated"  the signals in this family come from committed fixture data. The
//                verdict is reproducible and is NOT a statement about any real
//                device. This is what a review deployment reports.
//   "observed"   the signals come from a live read of a real source, and the verdict
//                is advisory: SignalGrid answers, the host app acts.
//   "enforced"   the verdict is APPLIED by something this service controls.
//
// The third is UNREACHABLE in this product and the route says so rather than leaving
// the reader to notice. `verdictEffect` is "advisory" as a product law, not a current
// limitation: under the embedded-UX rule SignalGrid is invisible to the worker, who
// uses their own host app, and this service actuates nothing on any device and has no
// path to. So the response carries `enforced: { reachable: false, because: … }` — an
// enum value nothing can produce is an overclaim by implication unless the report
// itself retires it, and retiring it is the honest half of answering Blocker 10.
//
// AGGREGATE AND ANONYMOUS. Counts and modes only: no connector id, no subject, no
// ref, no tenant. That is what lets an unscoped process fact be served from a
// tenant-scoped surface at all — the same rule /metrics already follows.
router.get("/v1/launch-status", (req: Request, res: Response) => {
  // Authenticated (it sits below the /v1 guard) and authorized as a connector read:
  // it describes the connector estate, so the role that may read connectors may read
  // this. It returns no tenant's rows, so it needs nothing stronger.
  authorize(core.context(token(req)).principal, "connector:read");
  const posture = resolveAssurancePosture(req.app);
  const families = core.signalInventory().map((family) => {
    // A family whose signals came from ANY live connector is observed; only a family
    // sourced entirely from fixtures is simulated. A family with NO resolvable
    // connector mode reports `simulated` too: an unknown provenance must never be
    // read as a live one, which is the fail-closed direction for a claim about how
    // real the data is.
    const live = family.modes.includes("live");
    const status: "enforced" | "observed" | "simulated" = live ? "observed" : "simulated";
    return {
      category: family.category,
      status,
      signalsHeld: family.signalsHeld,
      connectorModes: family.modes,
      note:
        status === "observed"
          ? "Read live from a real source. The verdict is advisory: SignalGrid answers, the host app acts."
          : "Committed fixture data. Reproducible, and NOT a statement about any real device.",
    };
  });
  res.json(
    envelope(req, {
      process: {
        profile: posture.profile,
        tier: posture.tier,
        signalSource: posture.signalSource,
        verdictEffect: posture.verdictEffect,
        stepUpAnswerable: posture.stepUpAnswerable,
      },
      families,
      enforced: {
        reachable: false,
        because:
          "No verdict this service returns is applied by this service. Under the embedded-UX rule " +
          "SignalGrid is invisible to the worker, who uses their own host app; the gate answers and " +
          "the host app acts. Enforcement on a device is an MDM/OS capability on a supervised device, " +
          "which this service neither has nor claims. `enforced` is listed so the vocabulary is " +
          "complete, and reported unreachable so it is never inferred.",
      },
    }),
  );
});

// ── ANSWERING A step_up, AT LAUNCH ────────────────────────────────────────────
//
// The gate returns one of four words, and until these two routes existed only three
// of them could be acted on. `step_up` means "challenge this person"; the launch
// surface had no route that could carry the challenge's ANSWER back, so a deployment
// shipped in shadow mode by omission — the gate said step_up and the host app had
// nowhere to say it had been satisfied. That is the `step-up-answerability` gap.
//
// The ceremony is the one already in this file, bound to a DECISION instead of to an
// app integration:
//
//   1. the host app's gate call returns a decision with outcome `step_up`;
//   2. POST /v1/decisions/:id/step-up/challenge mints a WebAuthn authentication
//      challenge bound to THAT decision (tenant, decision id, and the subjects taken
//      from the decision — never from the request body);
//   3. the worker's own device signs it with a user-verifying gesture;
//   4. POST /v1/decisions/:id/step-up carries the assertion back. It is verified
//      cryptographically against the credential enrolled for that identity, and only
//      then is the answer recorded against the decision.
//
// WHAT FAILS CLOSED, and each of these is a 4xx with nothing recorded:
//   · a decision this tenant does not hold                            404
//   · a decision whose outcome is not step_up                         409
//   · an unknown, expired or already-consumed challenge               403
//   · a challenge minted for a DIFFERENT decision or tenant           403
//   · an identity with no enrolled credential                         409 (enroll first)
//   · an assertion that does not verify, or was not user-verified     403
//   · a second answer for the same decision (replay)                  409
//
// WHAT THIS DOES NOT DO. It does not rewrite the decision. A `step_up` stays a
// `step_up`: it was computed from digested, immutable evidence, and editing a stored
// verdict because a gesture arrived afterwards would make the audit chain describe
// something that never happened. The host app reads `stepUp` beside the decision —
// `GET /v1/decisions/:id` carries it — and proceeds on the answer, which is the
// embedded-UX contract: SignalGrid answers, the host app acts.

/** The decision-bound challenge context, all of it server-derived. */
function decisionChallengeContext(tenantId: string, decisionId: string, refs: { identityRef: string; deviceRef: string }) {
  return { tenantId, purpose: "decision-step-up", decisionId, identityRef: refs.identityRef, deviceRef: refs.deviceRef };
}

router.post("/v1/decisions/:id/step-up/challenge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Authorize BEFORE anything is minted or probed — minting is part of the release
    // flow, so it takes the same permission the answer ultimately enforces. Without
    // it a read-only auditor could learn from 409-vs-200 whether an identity has an
    // enrolled credential.
    const ctx = core.context(token(req));
    authorize(ctx.principal, "decision:evaluate");
    const decisionId = param(req, "id");
    const decision = core.getDecision(token(req), decisionId);
    if (decision.outcome !== "step_up") {
      throw new CoreError(
        "validation",
        `Decision "${decisionId}" answered "${decision.outcome}", not "step_up" — there is nothing to challenge.`,
        409,
      );
    }
    if (core.getStepUpAnswer(token(req), decisionId)) {
      throw new CoreError("validation", `Decision "${decisionId}" has already been answered.`, 409);
    }
    // The subjects come from the DECISION. A body-supplied identityRef would let a
    // caller mint a challenge against one identity's enrolled credential and spend it
    // on another identity's decision.
    const refs = core.decisionSubjectRefs(token(req), decisionId);
    const userId = webauthnUserId(req, refs.identityRef);
    // Fail closed: no enrolled credential ⇒ no challenge ⇒ nothing to sign. There is
    // no weaker completion path to fall back to.
    if (!(await webauthnStore.hasWebAuthnCredentials(userId))) {
      throw new CoreError("forbidden", "No enrolled step-up credential for this identity. Enroll first.", 409);
    }
    const options = await webauthn.generateAuthenticationOptions(
      userId,
      decisionChallengeContext(ctx.tenant.id, decisionId, refs),
    );
    const { challengeId, ...publicKey } = options;
    res.json(envelope(req, { challengeId, publicKey, decisionId }));
  } catch (err) {
    next(err);
  }
});

router.post("/v1/decisions/:id/step-up", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const decisionId = param(req, "id");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const challengeId = requireString(body, "challengeId");
    const assertion = requireObject(body, "assertion", "WebAuthn authentication");
    const ctx = core.context(token(req));
    // 404 before anything else: a decision this tenant does not hold gets the same
    // answer a nonexistent id gets.
    const decision = core.getDecision(token(req), decisionId);

    // THE BINDING GATE, checked BEFORE any cryptography. The guarded values come from
    // the STORED challenge record; the request is only compared against it. A gesture
    // signed for one decision can therefore never answer another, and a challenge
    // minted by the app-workflows flow (a different `purpose`) cannot answer a
    // decision at all. Mismatch leaves the challenge unconsumed and never reaches
    // verify.
    const stored = await webauthnStore.getChallengeContext(challengeId);
    if (!stored || !stored.context) {
      throw new CoreError("forbidden", "Unknown or expired step-up challenge.", 403);
    }
    const bound = stored.context;
    if (bound.purpose !== "decision-step-up" || bound.tenantId !== ctx.tenant.id || bound.decisionId !== decisionId) {
      throw new CoreError(
        "forbidden",
        "This step-up challenge was minted for a different decision; request a new challenge for this one.",
        403,
      );
    }

    // The cryptographic gate. Single-use challenge (fetched-and-deleted by the lib),
    // purpose- and user-bound, signature verified against the enrolled public key,
    // user-verification flag REQUIRED. The userId comes from the STORED binding.
    const userId = webauthnUserId(req, bound.identityRef as string);
    const verification = await webauthn.verifyAuthentication(userId, challengeId, assertion as never, ctx.tenant.id);
    if (!verification.success) {
      throw new CoreError("forbidden", `Step-up assertion rejected: ${verification.error ?? "verification failed"}.`, 403);
    }

    // Only now is anything recorded. The core re-checks the outcome and the
    // one-answer-per-decision rule, so the invariants hold even if this handler is
    // ever called from somewhere else.
    const stepUp = core.answerStepUp(token(req), decisionId, {
      // MASKED, never the credential: the id is the authenticator's handle and there
      // is no reason for the audit chain to carry it whole.
      credentialReference: `${String(verification.credentialId ?? "").slice(0, 8)}…`,
    });
    await audit(req, "security.webauthn.step_up.success", ctx.principal.subjectId, { type: "decision", id: decisionId },
      { stepUpAnswerId: stepUp.id, method: stepUp.method });
    res.json(envelope(req, { decision, stepUp }));
  } catch (err) {
    next(err);
  }
});

export default router;

/** Append a route-level audit event through the real redacting ledger path and
 *  witness it at /metrics. AWAITED, not fire-and-forget: an admin action whose
 *  audit record silently failed to persist is the unearned affirmative with a
 *  paper trail missing, so the failure surfaces as the request's error. */
async function audit(
  req: Request,
  eventType: Parameters<typeof appendAuditRecord>[0],
  subjectId: string | undefined,
  target: AuditTarget,
  meta?: Record<string, unknown>,
): Promise<void> {
  await appendAuditRecord(eventType, { type: "user", id: subjectId }, {
    requestId: req.requestId,
    target,
    meta,
    tenantId: core.context(token(req)).tenant.id,
  });
  auditEventsTotal.inc({ event_type: eventType });
}

function token(req: Request): string {
  // requireTenantContext guarantees this is set.
  return req.bearerToken as string;
}

/** Read a route parameter as a single string (Express 5 params may be arrays). */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[]>)[name];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

// Session TTL in seconds: default 15 min; clamped to [60s, 24h] so a caller
// cannot request an unbounded (or zero) lifetime.
function clampTtl(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 900;
  return Math.min(86400, Math.max(60, Math.floor(n)));
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

/**
 * How many decision records one reconcile call may carry.
 *
 * The reduction computes a Pareto frontier, which is O(n²) in the record count, so an
 * unbounded array is a cost the caller controls. The bound REFUSES rather than
 * truncates, and that is the load-bearing half: truncating would silently drop records
 * from the set, and dropping a record can only ever remove a restriction — the same
 * asymmetry that makes an expired local decision get RAISED to a floor instead of
 * dropped. A partial answer here would be indistinguishable from a complete one.
 *
 * Sized for what the surface actually is: the decisions held for ONE subject and action
 * across a partition, which is a handful in practice. A caller that genuinely has more
 * has a different problem than reconciliation.
 */
const MAX_RECONCILE_RECORDS = 64;

/**
 * Parse a reconcile request WITHOUT completing it.
 *
 * Shape and type are checked here so a malformed body is a clean 400 instead of a
 * library exception; SEMANTICS are left entirely to `reconcileDecisions`, which already
 * refuses an unstated `evaluatedOffline`, a non-integer `policyVersion`, a negative
 * elapsed, a duplicate id carrying two different answers, and an empty set. Re-checking
 * those here would create a second place for the rules to live and a second place for
 * them to drift.
 */
function parseReconcile(body: unknown): {
  records: ReconcilableDecision[];
  standingBound?: StandingBound;
} {
  if (!body || typeof body !== "object") {
    throw new CoreError("validation", "Request body must be a JSON object.", 400);
  }
  const record = body as Record<string, unknown>;
  const raw = record["records"];
  if (!Array.isArray(raw)) {
    throw new CoreError("validation", "records must be an array of decision records.", 400);
  }
  if (raw.length > MAX_RECONCILE_RECORDS) {
    throw new CoreError(
      "validation",
      `records may carry at most ${MAX_RECONCILE_RECORDS} decisions; ${raw.length} were sent. ` +
        "The request is refused rather than truncated — a dropped record can only remove a restriction.",
      400,
    );
  }
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CoreError("validation", "Each record must be a JSON object.", 400);
    }
    const provenance = (entry as Record<string, unknown>)["provenance"];
    if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
      throw new CoreError("validation", "Each record must carry a provenance object.", 400);
    }
  }
  const records = raw as ReconcilableDecision[];

  const boundRaw = record["standingBound"];
  if (boundRaw === undefined) return { records };
  if (!boundRaw || typeof boundRaw !== "object" || Array.isArray(boundRaw)) {
    throw new CoreError("validation", "standingBound must be a JSON object when present.", 400);
  }
  const bound = boundRaw as Record<string, unknown>;
  const elapsed = bound["elapsedSecondsById"];
  if (elapsed !== undefined && (!elapsed || typeof elapsed !== "object" || Array.isArray(elapsed))) {
    throw new CoreError("validation", "standingBound.elapsedSecondsById must be an object.", 400);
  }
  // A missing `elapsedSecondsById` becomes an EMPTY map rather than an absent bound —
  // so every offline record reads as age-unstated and expires. Treating it as "no bound
  // posed" would let a caller pose a bound and then escape it by omitting the ages,
  // which is the shape this whole surface exists to refuse.
  return {
    records,
    standingBound: {
      ...(bound as unknown as StandingBound),
      elapsedSecondsById: (elapsed ?? {}) as Record<string, number>,
    },
  };
}

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
// Linear, length-bounded key pattern (no nested quantifiers → no ReDoS).
const CONTEXT_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
const MAX_CONTEXT_ENTRIES = 32;
// Over-long values are dropped, not truncated — see docs/DATA_RETENTION_AND_PERSONAL_DATA.md.
const MAX_CONTEXT_VALUE_CHARS = 256;

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
    if (FORBIDDEN_KEYS.has(key) || !CONTEXT_KEY.test(key) || value.length > MAX_CONTEXT_VALUE_CHARS) {
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
