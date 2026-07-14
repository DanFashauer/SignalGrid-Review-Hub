import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { resolveTier, isLiveIntegrationsEnabled } from "../lib/tier";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  const tier = resolveTier();
  res.json({ ...data, tier, liveIntegrations: isLiveIntegrationsEnabled(tier) });
});

export default router;
