import { Router, type IRouter } from "express";
import healthRouter from "./health";
import integrationsRouter from "./integrations";
import monitoringRouter from "./monitoring";
import simulatorRouter from "./simulator";
import simRouter from "./sim";
import radarRouter from "./radar";
import controlPlaneRouter from "./control-plane";
import v1Router from "./v1";
import { demoSurfacesEnabled, routeServedByGateway } from "../lib/profile";

const router: IRouter = Router();

// THE GA FENCE. Under `shared-device-gateway` this runs before every router below
// and 404s anything outside the Limited GA allowlist — the deferred `/v1` paths,
// the integrations catalog, the monitoring routes, the simulator and the signal
// radar included. Registered FIRST so no route can answer ahead of it.
//
// Under `review-demo` (the default) it is not registered at all, so the public
// review surface is untouched. That asymmetry is deliberate: the demo surfaces are
// how this repo is reviewable, and a gate that quietly switched them off would
// break the thing it is meant to protect.
router.use((req, res, next) => {
  if (demoSurfacesEnabled() || routeServedByGateway(req.method, req.path)) return next();
  res.status(404).json({ error: { code: "not_found", message: "Not found" } });
});

router.use(healthRouter);

// Deferred surfaces. Each is real, proven work outside Limited GA; under the
// gateway profile the fence above has already 404'd them, and they stay mounted
// so the review deployment is unchanged.
router.use(integrationsRouter);
router.use(monitoringRouter);
router.use(simulatorRouter);
router.use(radarRouter);

// DEMO-ONLY SURFACES — mounted only under the review-demo profile.
//
// Both are unauthenticated by construction and cannot be made safe by adding a
// check inside them, so the profile decides whether they exist at all:
//
//   simRouter        — POST /api/sim/room-entry derives a tenant from a CLIENT-SUPPLIED
//                      scenarioId, mints that tenant's own operator/owner token, and
//                      then WRITES (decision, evidence snapshot, two audit appends, a
//                      metrics increment). An anonymous caller can move another
//                      tenant's ledger.
//   controlPlaneRouter — /cp/v1 carries no principal at all, so its client-supplied
//                      `?tenant=` query parameter is the only scoping present.
//
// Not mounted rather than 403'd on purpose: a route that exists and refuses still
// answers "does this deployment have a control plane?", and there is no reason for a
// gateway deployment to answer it.
if (demoSurfacesEnabled()) {
  router.use(simRouter);
  router.use(controlPlaneRouter);
}
// The /v1 product surface is backed by the deterministic in-memory core and
// needs no database — it is the single source of truth for the product.
router.use(v1Router);

export default router;
