import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getDecisionStore, getSessionStore } from "@workspace/persistence";
import { getAuditBackend } from "@workspace/audit";
import { resolveTier, isLiveIntegrationsEnabled } from "../lib/tier";
import { demoSurfacesEnabled } from "../lib/profile";
import { loadEnterpriseAuthConfig } from "@workspace/enterprise-auth";

const router: IRouter = Router();

// LIVENESS. This answers "is the process up", nothing more, and it must stay
// that way: eleven callers across CI, the e2e suite, the live lanes and the
// proofs use it as a pure is-the-port-open probe. Wiring a database check into
// it would make a DB outage read as a dead process and restart-loop a server
// that is working. Readiness is the question below.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const tier = resolveTier();
  res.json({ ...data, tier, liveIntegrations: isLiveIntegrationsEnabled(tier) });
});

// READINESS. "Should this instance receive traffic right now?" — which is a
// different question from liveness exactly when the durable store is configured
// and unreachable: the process is alive, and sending it decision traffic would
// take writes that silently never persist.
//
// FAIL-CLOSED, in both directions that matter:
//   · A configured store is PROBED with a real round-trip on every call, never
//     assumed from "the pool object exists". An unreachable store answers 503.
//   · A store that offers no probe is NOT ready. "Cannot check" reported as
//     "ready" would be the unearned affirmative on the one route whose entire
//     job is honesty about state.
//
// With no DATABASE_URL there is no durable store BY DESIGN (the fixture-safe
// default; the core is in-memory and needs no database), so the instance is
// ready — and the body says `durableStore: "none"` so a green readyz can never
// be read as evidence that persistence is up.
/**
 * PROBE COALESCING (2026-09-05). /readyz is unauthenticated and, by the same
 * reasoning that keeps it out of the limiter (rateLimit.ts), exempt from BOTH
 * limiters — and each call cost seven database round-trips (three `SELECT 1`,
 * three privilege probes, one schema probe) against pools of ten. Measured:
 * 40 anonymous calls, 0 × 429, 280 probe units. An unauthenticated caller
 * could exhaust the pools the authenticated routes need. So one composite
 * probe is shared: concurrent callers await the SAME in-flight promise, and a
 * settled result is reused for `PROBE_TTL_MS`. The answer is at most one TTL
 * stale, which is the interval an orchestrator polls at anyway; a probe that
 * cannot be shared is a probe that can be weaponised.
 *
 * `probedAt` is returned in both bodies so the sharing is observable: N calls
 * inside one window carry one instant.
 */
export const PROBE_TTL_MS = 1000;
type ProbeResult = { ready: boolean; reason?: string; probedAt: string };
let lastProbe: { at: number; result: ProbeResult } | null = null;
let inFlight: Promise<ProbeResult> | null = null;

async function runProbes(store: { ping(): Promise<void> }): Promise<ProbeResult> {
  const sessions = getSessionStore();
  const ledger = getAuditBackend();
  // allSettled, not sequential awaits: every probe must get a handler even
  // when another has already failed — an abandoned rejected probe is an
  // unhandledRejection, and that kills the process the route exists to keep
  // honest.
  const probes = [store.ping()];
  if (typeof sessions.ping === "function") probes.push(sessions.ping());
  if (typeof ledger.ping === "function") probes.push(ledger.ping());
  const results = await Promise.allSettled(probes);
  const probedAt = new Date().toISOString();
  return results.every((r) => r.status === "fulfilled")
    ? { ready: true, probedAt }
    : { ready: false, reason: "A durable component is configured but unreachable or under-privileged. Not taking traffic.", probedAt };
}

function coalescedProbe(store: { ping(): Promise<void> }): Promise<ProbeResult> {
  const now = Date.now();
  if (lastProbe && now - lastProbe.at < PROBE_TTL_MS) return Promise.resolve(lastProbe.result);
  if (inFlight) return inFlight;
  inFlight = runProbes(store)
    .then((result) => {
      lastProbe = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

router.get("/readyz", async (req: Request, res: Response) => {
  // Body DETAIL is profile-gated (review finding): under the review-demo
  // profile the durableStore field and failure messages are diagnostic gold;
  // on a gateway deployment they announce persistence topology and live DB
  // outages to anonymous callers. The STATUS CODE — the thing an orchestrator
  // keys on — is identical in both profiles; only the prose narrows.
  const verbose = demoSurfacesEnabled();
  const notReady = (message: string, probedAt?: string) => {
    res.status(503).json({
      requestId: req.requestId ?? null,
      error: "not_ready",
      message: verbose ? message : "Not ready.",
      ...(probedAt ? { probedAt } : {}),
    });
  };
  // Under the gateway profile the ONLY credentials are verified enterprise
  // ones, so an instance whose OIDC configuration is absent or invalid can
  // authenticate nobody — every /v1 call is 401. Routing traffic to it is
  // routing traffic to a refusal machine, so readiness fails first (the
  // database probes below being green would only make the 200 more
  // misleading). Demo profile is unaffected: its bearer surface needs no IdP.
  if (!verbose) {
    const auth = loadEnterpriseAuthConfig();
    if (auth.status !== "enabled") {
      notReady(
        auth.status === "invalid"
          ? `enterprise auth configuration is invalid (${auth.reason}) — no caller can authenticate.`
          : "gateway profile with no enterprise auth configured (OIDC_ISSUER unset) — no caller can authenticate; set the OIDC variables from docs/DEPLOYMENT.md.",
      );
      return;
    }
  }
  const store = getDecisionStore();
  if (store === null) {
    res.json(verbose ? { status: "ready", durableStore: "none" } : { status: "ready" });
    return;
  }
  if (typeof store.ping !== "function") {
    notReady("A durable store is configured but offers no probe; unverifiable is not ready.");
    return;
  }
  // ALL durable components, not just the decision store (review finding: a
  // probe covering two of the four runtime tables let session or ledger grant
  // regressions ride under a green readyz). The session store and audit
  // backend expose ping() only in their Postgres forms — the in-memory
  // fixture defaults have nothing durable to probe and are skipped, which is
  // safe precisely because with DATABASE_URL set the selectors return the
  // Postgres forms. One composite probe, shared across concurrent callers and
  // reused for PROBE_TTL_MS (see above).
  // `store.ping` is narrowed above (a store without a probe is not ready).
  const probe = await coalescedProbe({ ping: () => store.ping!() });
  if (probe.ready) {
    res.json(verbose ? { status: "ready", durableStore: "postgres", probedAt: probe.probedAt } : { status: "ready", probedAt: probe.probedAt });
  } else {
    notReady(probe.reason ?? "Not ready.", probe.probedAt);
  }
});

export default router;
