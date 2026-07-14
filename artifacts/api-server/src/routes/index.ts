import { Router, type IRouter } from "express";
import healthRouter from "./health";
import integrationsRouter from "./integrations";
import monitoringRouter from "./monitoring";
import simulatorRouter from "./simulator";
import simRouter from "./sim";
import v1Router from "./v1";

const router: IRouter = Router();

router.use(healthRouter);
router.use(integrationsRouter);
router.use(monitoringRouter);
router.use(simulatorRouter);
router.use(simRouter);
// The /v1 product surface is backed by the deterministic in-memory core and
// needs no database — it is the single source of truth for the product.
router.use(v1Router);

export default router;
