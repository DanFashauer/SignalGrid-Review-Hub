import { Router, type IRouter } from "express";
import { listScenarios, runRoomEntry } from "@workspace/room-sim";
import { core, DEMO_KEYS } from "../lib/core";

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

// A public-safe demo operator token for the Northwind (hospital) tenant.
const NW_OPERATOR =
  DEMO_KEYS.find((k) => k.tenant === "tenant_northwind" && k.role === "operator")?.token ??
  DEMO_KEYS.find((k) => k.tenant === "tenant_northwind")?.token ??
  "";

router.get("/sim/room-entry/scenarios", (_req, res) => {
  res.json({
    demo: true,
    note: "Synthetic smart-hospital scenarios (public-safe fixtures). No real hospital, patient, or vendor system is involved.",
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

  if (!NW_OPERATOR) {
    res.status(500).json({ error: "seed_error", message: "Demo operator token unavailable" });
    return;
  }

  try {
    const result = runRoomEntry(core, NW_OPERATOR, scenarioId, { confirmedActionIds, stepUpSatisfied });
    res.json({ demo: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "evaluation failed";
    const unknown = message.startsWith("Unknown scenario");
    res.status(unknown ? 404 : 400).json({ error: unknown ? "not_found" : "evaluate_failed", message });
  }
});

export default router;
