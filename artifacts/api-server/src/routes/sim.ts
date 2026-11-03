import { Router, type IRouter } from "express";
import { listScenarios, runRoomEntry, tenantForScenario } from "@workspace/room-sim";
import { core, DEMO_KEYS } from "../lib/core";
import { logger } from "../lib/logger";

/**
 * Smart-hospital simulation surface (`/api/sim/*`) — Phase 1: Trusted Room Entry.
 *
 * A synthetic nurse with a managed device "approaches" a room. We run the real
 * deterministic decision core (identity + device posture + custody + badge +
 * baseline + workflow risk → allow/step-up/restrict/deny) and then the
 * orchestration layer turns that verdict into a plan of downstream actions
 * (door, session, device, lighting, clinical display, alerting), each auto /
 * assist / step-up / blocked.
 *
 * Scenarios + runner live in @workspace/room-sim, shared with the fully
 * client-side console so both surfaces run identical logic. Everything is
 * synthetic, fixture-backed, public-safe — no real hospital, patient data, or
 * vendor system.
 */
const router: IRouter = Router();

// One public-safe demo token per tenant. Hospital scenarios run under Northwind,
// warehouse scenarios under Atlas; cross-tenant evaluation is refused by design.
function tokenForTenant(tenant: string): string {
  const preferred = DEMO_KEYS.find((k) => k.tenant === tenant && (k.role === "operator" || k.role === "owner"));
  return (preferred ?? DEMO_KEYS.find((k) => k.tenant === tenant))?.token ?? "";
}

router.get("/sim/room-entry/scenarios", (req, res) => {
  res.json({
    requestId: req.requestId ?? null,
    demo: true,
    note: "Synthetic Trusted-Entry scenarios across verticals (smart-hospital, warehouse, and global-fleet), public-safe fixtures. No real facility, patient, customer, or vendor system is involved.",
    scenarios: listScenarios(),
  });
});

/**
 * Evaluate a room-entry scenario end to end: real decision → orchestration plan.
 * Body: { scenarioId: string, confirmedActionIds?: string[] }
 */
router.post("/sim/room-entry", (req, res) => {
  const scenarioId = typeof req.body?.scenarioId === "string" ? req.body.scenarioId : "";
  const confirmedActionIds: string[] = Array.isArray(req.body?.confirmedActionIds)
    ? req.body.confirmedActionIds.filter((x: unknown): x is string => typeof x === "string")
    : [];
  const stepUpSatisfied = req.body?.stepUpSatisfied === true;

  // Existence is decided BEFORE the run, by lookup — the same rule as
  // /api/simulator/run — never parsed out of a library's error string.
  if (!listScenarios().some((s) => s.id === scenarioId)) {
    res.status(404).json({ requestId: req.requestId ?? null, error: "not_found", message: "Room-entry scenario not found." });
    return;
  }

  const token = tokenForTenant(tenantForScenario(scenarioId));
  if (!token) {
    res.status(500).json({ requestId: req.requestId ?? null, error: "seed_error", message: "Demo token unavailable for scenario tenant" });
    return;
  }

  try {
    const result = runRoomEntry(core, token, scenarioId, { confirmedActionIds, stepUpSatisfied });
    res.json({ requestId: req.requestId ?? null, demo: true, ...result });
  } catch (err) {
    // Never forward a library's error string into a body: it is unfiltered text
    // from code this route does not own. It goes to the log under the requestId.
    logger.error({ err, requestId: req.requestId }, "room-entry evaluation failed");
    res.status(400).json({ requestId: req.requestId ?? null, error: "evaluate_failed", message: "Room-entry evaluation failed." });
  }
});

export default router;
