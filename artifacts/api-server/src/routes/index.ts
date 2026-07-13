import { Router, type IRouter } from "express";
import healthRouter from "./health";
import integrationsRouter from "./integrations";
import simulatorRouter from "./simulator";
import v1Router from "./v1";
import { requireTenantContext } from "../middlewares/context";

const router: IRouter = Router();

router.use(healthRouter);
router.use(integrationsRouter);
router.use(simulatorRouter);
// The /v1 product surface is backed by the in-memory core and needs no database.
router.use(v1Router);

if (process.env["DATABASE_URL"]) {
  const [
    { default: decisionsRouter },
    { default: metricsRouter },
    { default: policiesRouter },
    { default: signalsRouter },
  ] = await Promise.all([
    import("./decisions"),
    import("./metrics"),
    import("./policies"),
    import("./signals"),
  ]);

  // Fail-closed: the legacy DB-backed routers (including write routes that
  // rewrite policies and ingest signals) MUST NOT be reachable anonymously.
  // Require a valid bearer context in front of all of them, matching /v1. A
  // deployment that sets DATABASE_URL therefore never exposes an unauthenticated
  // read/write surface. (These routers predate /v1 and are not tenant-scoped at
  // the data layer; authentication is the minimum gate, and /v1 remains the
  // tenant-isolated product surface.)
  router.use(requireTenantContext);
  router.use(decisionsRouter);
  router.use(metricsRouter);
  router.use(policiesRouter);
  router.use(signalsRouter);
} else {
  const databaseUnavailable: IRouter = Router();

  databaseUnavailable.use((_req, res) => {
    res.status(503).json({
      error: "database_unavailable",
      message: "DATABASE_URL is required for this endpoint.",
    });
  });

  router.use("/decisions", databaseUnavailable);
  router.use("/metrics", databaseUnavailable);
  router.use("/policies", databaseUnavailable);
  router.use("/signals", databaseUnavailable);
}

export default router;
