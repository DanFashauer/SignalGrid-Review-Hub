import { Router, type IRouter } from "express";
import { planOrchestration, type RoomContext } from "@workspace/orchestration";
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
 * Everything is synthetic and fixture-backed: the identities, rooms, and
 * assignments are the public-safe demo seed. No real hospital, patient data,
 * vendor call, or employer system is touched — this is a self-contained model.
 */
const router: IRouter = Router();

// A public-safe demo operator token for the Northwind (hospital) tenant. These
// tokens are obviously-fake fixtures, not real credentials.
const NW_OPERATOR =
  DEMO_KEYS.find((k) => k.tenant === "tenant_northwind" && k.role === "operator")?.token ??
  DEMO_KEYS.find((k) => k.tenant === "tenant_northwind")?.token ??
  "";

interface Scenario {
  id: string;
  title: string;
  description: string;
  identityRef: string;
  deviceRef: string;
  room: RoomContext;
}

// Rooms of escalating sensitivity, mapped to workflows of escalating risk so the
// physical space and the clinical risk move together.
const SCENARIOS: Scenario[] = [
  {
    id: "compliant-standard",
    title: "Compliant nurse · standard room",
    description: "On-shift nurse, compliant shared iPad, general lookup in a standard patient room.",
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    room: { roomId: "RM-412", unit: "4 West · Med-Surg", sensitivity: "standard", workflowKey: "general-lookup", workflowLabel: "General lookup" },
  },
  {
    id: "compliant-bedside",
    title: "Compliant nurse · bedside care",
    description: "On-shift nurse, compliant device, bedside clinical session (elevated) — PHI display awaits confirmation.",
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    room: { roomId: "RM-418", unit: "4 West · Med-Surg", sensitivity: "elevated", workflowKey: "clinical-session", workflowLabel: "Bedside care" },
  },
  {
    id: "compliant-medroom",
    title: "Compliant nurse · controlled med room",
    description: "On-shift nurse entering a controlled-substance room for medication administration (critical).",
    identityRef: "nurse.compliant",
    deviceRef: "ipad-ward-01",
    room: { roomId: "MED-1", unit: "4 West · Medication", sensitivity: "controlled", workflowKey: "med-admin", workflowLabel: "Medication administration" },
  },
  {
    id: "noncompliant-device",
    title: "Non-compliant device · bedside",
    description: "Nurse on a non-compliant shared iPad attempting a bedside clinical session.",
    identityRef: "nurse.noncompliant",
    deviceRef: "ipad-ward-02",
    room: { roomId: "RM-418", unit: "4 West · Med-Surg", sensitivity: "elevated", workflowKey: "clinical-session", workflowLabel: "Bedside care" },
  },
  {
    id: "baseline-drift",
    title: "Security-baseline drift · bedside",
    description: "Device has drifted from its CIS security baseline; bedside session requested.",
    identityRef: "nurse.baseline_drift",
    deviceRef: "ipad-ward-06",
    room: { roomId: "RM-418", unit: "4 West · Med-Surg", sensitivity: "elevated", workflowKey: "clinical-session", workflowLabel: "Bedside care" },
  },
  {
    id: "badge-removed",
    title: "Badge withdrawn · controlled med room",
    description: "The bound badge left the reader case — custody of the shared device is no longer confirmed.",
    identityRef: "nurse.badge_removed",
    deviceRef: "ipad-badge-01",
    room: { roomId: "MED-1", unit: "4 West · Medication", sensitivity: "controlled", workflowKey: "med-admin", workflowLabel: "Medication administration" },
  },
  {
    id: "device-tamper",
    title: "Device tamper flag · bedside",
    description: "The device's tamper channel is flagged; bedside clinical session requested.",
    identityRef: "nurse.tamper",
    deviceRef: "ipad-loan-02",
    room: { roomId: "RM-418", unit: "4 West · Med-Surg", sensitivity: "elevated", workflowKey: "clinical-session", workflowLabel: "Bedside care" },
  },
  {
    id: "disabled-account",
    title: "Disabled account · standard room",
    description: "A disabled identity attempts entry — trust fails at the identity layer.",
    identityRef: "nurse.disabled",
    deviceRef: "ipad-ward-04",
    room: { roomId: "RM-412", unit: "4 West · Med-Surg", sensitivity: "standard", workflowKey: "general-lookup", workflowLabel: "General lookup" },
  },
];

const scenarioSummary = (s: Scenario) => ({
  id: s.id,
  title: s.title,
  description: s.description,
  room: s.room,
});

router.get("/sim/room-entry/scenarios", (_req, res) => {
  res.json({
    demo: true,
    note: "Synthetic smart-hospital scenarios (public-safe fixtures). No real hospital, patient, or vendor system is involved.",
    scenarios: SCENARIOS.map(scenarioSummary),
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

  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) {
    res.status(404).json({ error: "not_found", message: `Unknown scenario '${scenarioId}'` });
    return;
  }
  if (!NW_OPERATOR) {
    res.status(500).json({ error: "seed_error", message: "Demo operator token unavailable" });
    return;
  }

  try {
    const result = core.evaluate(NW_OPERATOR, {
      identityRef: scenario.identityRef,
      deviceRef: scenario.deviceRef,
      workflowKey: scenario.room.workflowKey,
      requestContext: {
        room: scenario.room.roomId,
        unit: scenario.room.unit,
        sensitivity: scenario.room.sensitivity,
      },
    });

    const snapshot = core.getSnapshot(NW_OPERATOR, result.evidenceSnapshotId);
    const plan = planOrchestration({
      outcome: result.outcome,
      reasonCodes: result.reasonCodes,
      room: scenario.room,
      confirmedActionIds,
    });

    res.json({
      demo: true,
      scenario: scenarioSummary(scenario),
      context: scenario.room,
      decision: {
        outcome: result.outcome,
        reasonCodes: result.reasonCodes,
        explanation: result.explanation,
        matchedRules: result.matchedRules,
        latencyMs: result.latencyMs,
        decisionId: result.decisionId,
      },
      signals: snapshot.evidence,
      plan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "evaluation failed";
    res.status(400).json({ error: "evaluate_failed", message });
  }
});

export default router;
