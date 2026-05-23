import { Router, type IRouter } from "express";
import healthRouter from "./health";
import decisionsRouter from "./decisions";
import integrationsRouter from "./integrations";
import metricsRouter from "./metrics";
import policiesRouter from "./policies";
import signalsRouter from "./signals";

const router: IRouter = Router();

router.use(healthRouter);
router.use(decisionsRouter);
router.use(integrationsRouter);
router.use(metricsRouter);
router.use(policiesRouter);
router.use(signalsRouter);

export default router;
