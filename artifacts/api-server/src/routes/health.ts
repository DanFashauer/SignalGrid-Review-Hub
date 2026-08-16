import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getDecisionStore } from "@workspace/persistence";
import { resolveTier, isLiveIntegrationsEnabled } from "../lib/tier";

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
router.get("/readyz", async (req: Request, res: Response) => {
  const store = getDecisionStore();
  if (store === null) {
    res.json({ status: "ready", durableStore: "none" });
    return;
  }
  if (typeof store.ping !== "function") {
    res.status(503).json({
      requestId: req.requestId ?? null,
      error: "not_ready",
      message: "A durable store is configured but offers no probe; unverifiable is not ready.",
    });
    return;
  }
  try {
    await store.ping();
    res.json({ status: "ready", durableStore: "postgres" });
  } catch {
    res.status(503).json({
      requestId: req.requestId ?? null,
      error: "not_ready",
      message: "The durable store is configured but unreachable. Not taking traffic.",
    });
  }
});

export default router;
