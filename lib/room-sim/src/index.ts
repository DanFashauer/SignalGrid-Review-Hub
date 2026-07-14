// @workspace/room-sim — the Trusted Room Entry scenario set + runner.
//
// Single source of truth for the smart-hospital Phase 1 simulation, shared by
// the api-server route (/api/sim/room-entry) and the fully client-side console.
// It runs the REAL deterministic decision core over the public-safe hospital
// seed, then the orchestration layer — so the same logic backs both the hosted
// and the in-browser experience.

import { planOrchestration, type OrchestrationPlan, type RoomContext } from "@workspace/orchestration";
import type { DecisionEvidence, EvaluateRequest, EvaluateResult, EvidenceSnapshot } from "@workspace/signalgrid-core";

/** The subset of the SignalGridCore facade the runner needs. */
export interface CoreLike {
  evaluate(token: string, request: EvaluateRequest): EvaluateResult;
  getSnapshot(token: string, id: string): EvidenceSnapshot;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  identityRef: string;
  deviceRef: string;
  room: RoomContext;
}

export interface RoomEntryResult {
  scenario: { id: string; title: string; description: string; room: RoomContext };
  context: RoomContext;
  decision: {
    outcome: EvaluateResult["outcome"];
    reasonCodes: string[];
    explanation: string;
    matchedRules: EvaluateResult["matchedRules"];
    latencyMs: number;
    decisionId: string;
  };
  signals: DecisionEvidence;
  plan: OrchestrationPlan;
}

// Rooms of escalating sensitivity mapped to workflows of escalating risk, so the
// physical space and the clinical risk move together.
export const SCENARIOS: Scenario[] = [
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

export function listScenarios(): Array<Pick<Scenario, "id" | "title" | "description" | "room">> {
  return SCENARIOS.map((s) => ({ id: s.id, title: s.title, description: s.description, room: s.room }));
}

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

/**
 * Run one scenario end to end: real decision → orchestration plan. Throws if the
 * scenario is unknown. `confirmedActionIds` promotes `assist` actions to
 * `applied` (a clinician confirming a sensitive step).
 */
export function runRoomEntry(
  core: CoreLike,
  token: string,
  scenarioId: string,
  confirmedActionIds: string[] = [],
): RoomEntryResult {
  const scenario = findScenario(scenarioId);
  if (!scenario) throw new Error(`Unknown scenario '${scenarioId}'`);

  const result = core.evaluate(token, {
    identityRef: scenario.identityRef,
    deviceRef: scenario.deviceRef,
    workflowKey: scenario.room.workflowKey,
    requestContext: {
      room: scenario.room.roomId,
      unit: scenario.room.unit,
      sensitivity: scenario.room.sensitivity,
    },
  });

  const snapshot = core.getSnapshot(token, result.evidenceSnapshotId);
  const plan = planOrchestration({
    outcome: result.outcome,
    reasonCodes: result.reasonCodes,
    room: scenario.room,
    confirmedActionIds,
  });

  return {
    scenario: { id: scenario.id, title: scenario.title, description: scenario.description, room: scenario.room },
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
  };
}
