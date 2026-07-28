import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { CoreError, verifySnapshot, type EvaluateRequest } from "@workspace/signalgrid-core";
import { getDecisionStore, getSessionStore, type Session } from "@workspace/persistence";
import { listAppIntegrations, findAppIntegration, planAppSession } from "@workspace/app-workflows";
import { webauthn, webauthnStore } from "@workspace/webauthn";
import { core, DEMO_KEYS } from "../lib/core";
import { decisionsTotal } from "../lib/metrics";
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
    res.json(envelope(req, { decision: result }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/decisions", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = getDecisionStore();
    if (store) {
      const tenantId = core.context(token(req)).tenant.id;
      const decisions = await store.listDecisions(tenantId);
      res.json(envelope(req, { decisions, total: decisions.length }));
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
      const tenantId = core.context(token(req)).tenant.id;
      // getDecision is keyed on (id, tenant_id): a cross-tenant id returns null,
      // which we surface as the same 404 the in-memory path throws.
      const decision = await store.getDecision(tenantId, param(req, "id"));
      if (!decision) throw new CoreError("not_found", `Decision "${param(req, "id")}" not found.`, 404);
      res.json(envelope(req, { decision }));
      return;
    }
    const decision = core.getDecision(token(req), param(req, "id"));
    res.json(envelope(req, { decision }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/decisions/:id/evidence", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const store = getDecisionStore();
    if (store) {
      const tenantId = core.context(token(req)).tenant.id;
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

// ── Sessions: durable start / refresh / end lifecycle ────────────────────────
// A session is gated by a real decision at start, then kept alive by refreshes
// until it ends or its TTL lapses. Sessions persist in-memory by default and to
// Postgres when DATABASE_URL is set, so they survive a restart in production.
router.post("/v1/sessions/start", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = parseEvaluate(req.body);
    const result = core.evaluate(token(req), body);
    decisionsTotal.inc({ outcome: result.outcome });
    const tenantId = core.context(token(req)).tenant.id;
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
    res.json(envelope(req, { session, decision: result }));
  } catch (err) {
    next(err);
  }
});

router.get("/v1/sessions/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = core.context(token(req)).tenant.id;
    const session = await getSessionStore().get(tenantId, param(req, "id"), Date.now());
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found.`, 404);
    res.json(envelope(req, { session }));
  } catch (err) {
    next(err);
  }
});

router.post("/v1/sessions/:id/refresh", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = core.context(token(req)).tenant.id;
    const ttlSeconds = clampTtl((req.body as Record<string, unknown>)?.["ttlSeconds"]);
    const session = await getSessionStore().refresh(tenantId, param(req, "id"), ttlSeconds, Date.now());
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found.`, 404);
    res.json(envelope(req, { session }));
  } catch (err) {
    next(err);
  }
});

router.post("/v1/sessions/:id/end", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = core.context(token(req)).tenant.id;
    const session = await getSessionStore().end(tenantId, param(req, "id"));
    if (!session) throw new CoreError("not_found", `Session "${param(req, "id")}" not found.`, 404);
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

// ── Step-up completion (real, hardware-backed) ─────────────────────────────────
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
  return `${core.context(token(req)).tenant.id}:${identityRef}`;
}

function requireString(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new CoreError("validation", `${key} is required.`, 400);
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
    const response = body["response"];
    if (!response || typeof response !== "object") {
      throw new CoreError("validation", "response (WebAuthn registration) is required.", 400);
    }
    const userId = webauthnUserId(req, identityRef);
    const result = await webauthn.verifyRegistration(userId, challengeId, response as never);
    if (!result.success) {
      throw new CoreError("forbidden", `Enrollment rejected: ${result.error ?? "verification failed"}.`, 403);
    }
    res.json(envelope(req, { enrolled: true, credentialId: result.credentialId, enrolledByRef: enrolledBy.subjectId, demoNote: demoEnrollmentNote() }));
  } catch (err) {
    next(err);
  }
});

// 3) Authentication challenge for a pending step-up. The challenge is BOUND to the
//    exact pending action at mint time (tenant + identity + integration + device),
//    and the completion route verifies that binding — so a gesture signed for one
//    pending action can never release a different one (adversarial-review + CodeQL
//    finding). ONE challenge record: minted, persisted, and id-returned by the lib.
router.post("/v1/step-up/challenge", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const identityRef = requireString(body, "identityRef");
    const integrationId = requireString(body, "integrationId");
    const deviceRef = requireString(body, "deviceRef");
    if (!findAppIntegration(integrationId)) {
      throw new CoreError("not_found", `Unknown app integration '${integrationId}'.`, 404);
    }
    const userId = webauthnUserId(req, identityRef);
    // Fail closed: no enrolled credential ⇒ no challenge ⇒ nothing to sign. The
    // caller must enroll first; we never fall back to a weaker completion path.
    const enrolled = await webauthnStore.hasWebAuthnCredentials(userId);
    if (!enrolled) {
      throw new CoreError("forbidden", "No enrolled step-up credential for this identity. Enroll first.", 409);
    }
    const options = await webauthn.generateAuthenticationOptions(userId, {
      tenantId: core.context(token(req)).tenant.id,
      identityRef,
      integrationId,
      deviceRef,
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
    const assertion = body["assertion"];
    if (!assertion || typeof assertion !== "object") {
      throw new CoreError("validation", "assertion (WebAuthn authentication) is required.", 400);
    }
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
    if (
      ctx.tenantId !== tenantId ||
      ctx.identityRef !== identityRef ||
      ctx.integrationId !== integrationId ||
      ctx.deviceRef !== deviceRef
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
    const verification = await webauthn.verifyAuthentication(userId, challengeId, assertion as never);
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
    const plan = planAppSession({
      integration,
      outcome: decision.outcome,
      reasonCodes: decision.reasonCodes,
      stepUpSatisfied: released,
    });
    res.json(
      envelope(req, {
        decision,
        plan,
        stepUp: {
          released,
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
