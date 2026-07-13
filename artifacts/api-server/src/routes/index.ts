import { Router, type IRouter } from "express";
import healthRouter from "./health";
import integrationsRouter from "./integrations";
import simulatorRouter from "./simulator";
import v1Router from "./v1";

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
