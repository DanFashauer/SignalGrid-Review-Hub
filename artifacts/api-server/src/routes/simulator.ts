import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  getSimulatorScenario,
  listSimulatorScenarios,
  runSimulatorScenario,
  type AuditEvidence,
} from "@workspace/signalgrid-simulator";

const router: IRouter = Router();
// Bounded in-memory demo ledger. Capped so repeated unauthenticated
// `POST /simulator/run` calls cannot grow it without bound (memory DoS); the
// oldest entries are dropped past the cap (ring-buffer semantics).
const MAX_LEDGER_ENTRIES = 500;
const auditLedger: AuditEvidence[] = [];

router.get("/simulator/scenarios", (_req, res) => {
  res.json(envelope({ scenarios: listSimulatorScenarios() }));
});

router.get("/simulator/scenarios/:id", (req, res) => {
  const scenario = getSimulatorScenario(req.params.id);
  if (!scenario) {
    res.status(404).json(envelope({ error: "not_found", message: "Simulator scenario not found." }));
    return;
  }

  res.json(envelope({ scenario }));
});

router.post("/simulator/run", (req, res) => {
  const scenarioId = typeof req.body?.scenarioId === "string" ? req.body.scenarioId : "";
  if (!scenarioId) {
    res.status(400).json(envelope({ error: "validation", message: "scenarioId is required." }));
    return;
  }

  try {
    const result = runSimulatorScenario(scenarioId);
    auditLedger.push(...result.auditEvidence);
    if (auditLedger.length > MAX_LEDGER_ENTRIES) {
      auditLedger.splice(0, auditLedger.length - MAX_LEDGER_ENTRIES);
    }
    res.json(envelope(result));
  } catch (_err) {
    res.status(404).json(envelope({ error: "not_found", message: "Simulator scenario not found." }));
  }
});

router.get("/simulator/audit", (_req, res) => {
  res.json(envelope({ auditEvidence: auditLedger }));
});

router.post("/simulator/reset", (_req, res) => {
  auditLedger.splice(0, auditLedger.length);
  res.json(envelope({ status: "reset", auditEvidence: auditLedger }));
});

function envelope<T extends object>(data: T) {
  return {
    requestId: randomUUID(),
    timestamp: new Date().toISOString(),
    ...data,
  };
}

export default router;
